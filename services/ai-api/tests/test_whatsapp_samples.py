"""Job CD: the WhatsApp channel against sample payloads in the shape Meta documents (tests/fixtures/whatsapp/, see its README). Every webhook file is signed with a test secret and goes through the real
parser, the real route and the real ingest (an in-memory repository behind it); every Graph answer goes through the real client and adapter on an in-process transport. NO NETWORK: a guard makes any
real socket connection fail the test. The rules these samples touch (the 24-hour window, STOP, status steps) are proven in the database by pgTAP 86 and tests/integration/test_br_whatsapp.py."""

from __future__ import annotations

import json
import socket
import uuid
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.outbox.adapter import OutgoingMessage, SendContext, TemplateRef
from app.whatsapp import optout, webhook
from app.whatsapp.adapter import WhatsAppCloudAdapter
from app.whatsapp.graph import GraphClient
from app.whatsapp.tokens import TokenResolver
from tests.test_whatsapp_routes import (  # noqa: F401  (the autouse fixture is re-used)
    World,
    _fresh_limits,
)
from tests.test_whatsapp_units import SECRET

FIXTURES = Path(__file__).parent / "fixtures" / "whatsapp"
PNI = "106540352242922"  # the phone number id inside every sample
MSG = uuid.UUID("11111111-1111-4111-8111-111111111111")


@pytest.fixture(autouse=True)
def _no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    def refuse(*_: Any, **__: Any) -> None:
        raise AssertionError("a test tried to open a network connection")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)


def raw(name: str) -> bytes:
    return (FIXTURES / f"{name}.json").read_bytes()


def events_of(name: str) -> list[webhook.Event]:
    return webhook.parse(json.loads(raw(name)))


def post(w: World, name: str, *, secret: str = SECRET) -> Any:
    body = raw(name)
    return w.client.post("/v1/webhooks/whatsapp", content=body, headers={"Content-Type": "application/json", "X-Hub-Signature-256": webhook.sign(body, secret)})


def test_the_folder_holds_what_the_tests_below_expect() -> None:
    names = {p.stem for p in FIXTURES.glob("*.json")}
    assert len(names) >= 25 and {"in_text", "in_stop", "status_failed_outside_window", "graph_send_ok", "batch_message_and_status"} <= names
    for p in FIXTURES.glob("*.json"):
        json.loads(p.read_text(encoding="utf-8"))  # every file is valid JSON


# ------------------------------------------------------------------------------------------------------------------------ inbound messages
@pytest.mark.parametrize(
    ("name", "kind", "text"),
    [
        ("in_text", "text", "Does the red Kanjivaram come in another colour?"),
        ("in_text_telugu", "text", "ఈ చీర ధర ఎంత? రేపు షాపుకి వస్తాను."),
        ("in_image_with_caption", "image", "I want this one"),
        ("in_audio_voice_note", "audio", None),
        ("in_button_reply", "button", "Yes, confirm the visit"),
        ("in_interactive_list_reply", "interactive", "Saturday 11 am"),
        ("in_unsupported_type", "unsupported", None),
        ("in_location", "location", None),
    ],
)
def test_each_sample_inbound_message_is_read(name: str, kind: str, text: str | None) -> None:
    (event,) = events_of(name)
    assert isinstance(event, webhook.Inbound)
    assert (event.kind, event.text, event.sender, event.phone_number_id, event.name) == (kind, text, "919876543210", PNI, "Ravi Kumar")
    assert event.sent_at is not None


def test_a_reaction_and_a_template_review_result_are_not_messages_to_answer() -> None:
    assert events_of("in_reaction_ignored") == []
    assert events_of("other_field_template_status") == []


def test_stop_is_found_in_the_samples_and_only_where_it_is_the_whole_message() -> None:
    flags = {n: optout.is_optout(next(e for e in events_of(n) if isinstance(e, webhook.Inbound)).text) for n in ("in_stop", "in_stop_hindi", "in_not_a_stop", "in_text", "in_text_telugu")}
    assert flags == {"in_stop": True, "in_stop_hindi": True, "in_not_a_stop": False, "in_text": False, "in_text_telugu": False}


# ------------------------------------------------------------------------------------------------------------------------ status callbacks
@pytest.mark.parametrize(
    ("name", "status", "error_code"),
    [
        ("status_sent", "sent", None),
        ("status_delivered", "delivered", None),
        ("status_read", "read", None),
        ("status_failed_outside_window", "failed", 131047),
        ("status_failed_unreachable", "failed", 131026),
        ("status_failed_template_paused", "failed", 132015),
    ],
)
def test_each_sample_status_is_read_with_its_error_and_the_message_id_we_sent(name: str, status: str, error_code: int | None) -> None:
    (event,) = events_of(name)
    assert isinstance(event, webhook.Status)
    assert (event.status, event.error_code, event.callback, event.phone_number_id) == (status, error_code, str(MSG), PNI)
    assert event.wamid.startswith("wamid.") and event.at is not None


def test_a_batch_with_a_message_and_a_status_gives_both_in_order() -> None:
    first, second = events_of("batch_message_and_status")
    assert isinstance(first, webhook.Inbound) and first.text == "Thank you" and isinstance(second, webhook.Status) and second.status == "read"


# ------------------------------------------------------------------------------------------------------------------------ through the route (signature, parse, ingest)
@pytest.mark.parametrize(
    ("name", "counts"),
    [
        ("in_text", {"received": 1, "stored": 1, "optouts": 0, "statuses": 0}),
        ("in_stop", {"received": 1, "stored": 1, "optouts": 1, "statuses": 0}),
        ("in_stop_hindi", {"received": 1, "stored": 1, "optouts": 1, "statuses": 0}),
        ("in_not_a_stop", {"received": 1, "stored": 1, "optouts": 0, "statuses": 0}),
        ("in_audio_voice_note", {"received": 1, "stored": 1, "optouts": 0, "statuses": 0}),
        ("in_reaction_ignored", {"received": 0, "stored": 0, "optouts": 0, "statuses": 0}),
        ("other_field_template_status", {"received": 0, "stored": 0, "optouts": 0, "statuses": 0}),
        ("status_delivered", {"received": 1, "stored": 0, "optouts": 0, "statuses": 1}),
        ("status_failed_outside_window", {"received": 1, "stored": 0, "optouts": 0, "statuses": 1}),
        ("batch_message_and_status", {"received": 2, "stored": 1, "optouts": 0, "statuses": 1}),
    ],
)
def test_a_signed_sample_goes_through_the_route(name: str, counts: dict[str, int]) -> None:
    w = World()
    r = post(w, name)
    assert r.status_code == 200
    assert {k: r.json()[k] for k in counts} == counts


def test_the_ingest_hands_the_database_the_flags_the_samples_call_for() -> None:
    w = World()
    for name in ("in_stop", "in_not_a_stop", "status_failed_outside_window"):
        assert post(w, name).status_code == 200
    stop, not_stop, failed = (args for _, args in w.repo.calls)
    assert stop["p_optout"] is True and not_stop["p_optout"] is False
    assert (failed["p_status"], failed["p_error_code"], failed["p_callback"]) == ("failed", 131047, str(MSG))
    assert stop["p_from"] == "919876543210" and stop["p_phone_hmac"] and "p_phone" not in stop, "the number's key travels, not the number twice"


def test_a_sample_with_the_wrong_signature_or_one_changed_byte_is_refused_and_nothing_is_stored() -> None:
    w = World()
    assert post(w, "in_text", secret="not-the-app-secret").status_code == 401
    body = raw("in_text")
    changed = body.replace(b"Kanjivaram", b"Kanjivaran")
    r = w.client.post("/v1/webhooks/whatsapp", content=changed, headers={"Content-Type": "application/json", "X-Hub-Signature-256": webhook.sign(body, SECRET)})
    assert r.status_code == 401 and w.repo.calls == []


def test_the_same_sample_twice_is_counted_as_a_duplicate_by_the_database_answer() -> None:
    w = World()
    w.repo.inbound_outcomes = [{"outcome": "stored", "optout": False}, {"outcome": "duplicate"}]
    first, second = post(w, "in_text").json(), post(w, "in_text").json()
    assert (first["stored"], first["duplicates"], second["stored"], second["duplicates"]) == (1, 0, 0, 1), "Meta retries: the second delivery changes nothing"


# ------------------------------------------------------------------------------------------------------------------------ the Graph API's answers
def adapter_answering(name: str, http_status: int, seen: list[httpx.Request] | None = None) -> WhatsAppCloudAdapter:
    body = json.loads(raw(name))

    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        return httpx.Response(http_status, json=body)

    graph = GraphClient("https://graph.example.test", "v25.0", client=httpx.Client(transport=httpx.MockTransport(handler)))
    return WhatsAppCloudAdapter(graph, TokenResolver("a-token-for-tests"))


def outgoing(*, window: bool = True, template: TemplateRef | None = None, body: str = "Your saree is ready.") -> OutgoingMessage:
    return OutgoingMessage(MSG, "+919876543210", body, "en", (), 1, SendContext(PNI, "ref", window, template))


def test_a_send_the_graph_accepts_returns_the_message_id_and_goes_to_the_documented_address() -> None:
    seen: list[httpx.Request] = []
    result = adapter_answering("graph_send_ok", 200, seen).send(outgoing())
    assert result.ok and result.adapter_message_id and result.adapter_message_id.startswith("wamid.")
    (request,) = seen
    assert str(request.url) == f"https://graph.example.test/v25.0/{PNI}/messages" and request.headers["authorization"] == "Bearer a-token-for-tests"
    sent = json.loads(request.content)
    assert sent == {"messaging_product": "whatsapp", "recipient_type": "individual", "to": "+919876543210", "type": "text", "text": {"preview_url": False, "body": "Your saree is ready."}, "biz_opaque_callback_data": str(MSG)}


def test_outside_the_window_the_same_text_goes_as_an_approved_template() -> None:
    seen: list[httpx.Request] = []
    template = TemplateRef("visit_reminder", "en", "Reminder from the shop: {{1}} Reply STOP to stop.")
    assert adapter_answering("graph_send_ok", 200, seen).send(outgoing(window=False, template=template)).ok
    sent = json.loads(seen[0].content)
    assert sent["type"] == "template" and sent["template"] == {"name": "visit_reminder", "language": {"code": "en"}, "components": [{"type": "body", "parameters": [{"type": "text", "text": "Your saree is ready."}]}]}


@pytest.mark.parametrize(
    ("name", "http_status", "failure", "retry"),
    [
        ("graph_error_outside_window_131047", 400, "window_closed", False),
        ("graph_error_unreachable_131026", 400, "recipient_unreachable", False),
        ("graph_error_token_expired_190", 401, "not_configured", False),
        ("graph_error_rate_130429", 429, "rate_limited", True),
        ("graph_error_param_100", 400, "rejected", False),
        ("graph_error_recipient_not_allowed_131030", 400, "rejected", False),
        ("graph_error_server_500", 500, "adapter_error", True),
    ],
)
def test_each_graph_refusal_becomes_the_outboxs_closed_word(name: str, http_status: int, failure: str, retry: bool) -> None:
    result = adapter_answering(name, http_status).send(outgoing())
    assert (result.ok, result.failure_code, result.retry) == (False, failure, retry)


def test_nothing_secret_or_personal_from_the_samples_is_logged(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level("DEBUG"):
        adapter_answering("graph_error_unreachable_131026", 400).send(outgoing(body="a private sentence about a saree"))
        post(World(), "in_text")
    assert "919876543210" not in caplog.text and "a-token-for-tests" not in caplog.text and "private sentence" not in caplog.text and "Kanjivaram" not in caplog.text
