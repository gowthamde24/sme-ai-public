"""Job AT (ADR 0066): the HTTP side of the outbox and call requests against an in-memory fake: authorization order and the role matrix on every endpoint, WHAT is sent to the database, that no body
can carry a phone number, a contact, a status, a reason or an approver, the fixed error mapping, the dispatch loop with the local fake adapter, and the boundary (nothing here can reach a network).
The database rules are pgTAP 76; the real stack is tests/integration/test_outbox_api.py."""

from __future__ import annotations

import ast
import base64
import inspect
import logging
import re
import uuid
from pathlib import Path
from typing import Any, get_args

import pytest

from app.config import ConfigurationError, Settings
from app.main import _outbox_adapter
from app.outbox import adapter as adapter_module
from app.outbox import service
from app.outbox.adapter import LocalFakeAdapter, OutgoingMessage, SendResult, build_adapter
from app.outbox.errors import CustomerStoppedError, OutboxStateError
from app.outbox.models import REASON_TEXT, Category, Reason, Status
from app.tenancy.repository import MfaRequired, UpstreamError
from app.today import service as today_service
from tests.fakes import TENANT_A, TENANT_B, auth, make_client
from tests.outbox_fakes import FakeOutbox, call_row, message_row

M1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
M2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"
C1 = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1"
LEAD = "33333333-3333-4333-8333-333333333333"
BASE = f"/v1/tenants/{TENANT_A.id}"
PHONE = "+91 98765 43210"


# what a dispatch that did not report the "still waiting" counts answers (the submit / approve responses): sent, failed, retry_later and three nulls
def _done(sent: int, failed: int, retry_later: int = 0) -> dict[str, Any]:
    return {
        "sent": sent,
        "failed": failed,
        "retry_later": retry_later,
        "still_due": None,
        "held_for_later": None,
        "platform_switch_on": None,
    }


class World:
    def __init__(self) -> None:
        self.db = FakeOutbox()
        self.adapter = LocalFakeAdapter()
        self.client, _ = make_client(outbox=self.db, outbox_adapter=self.adapter)
        self.db.messages[M1] = message_row(
            M1, status="needs_approval", reason="money", flags=["money"], scheduled_for=None
        )
        self.db.messages[M2] = message_row(M2)
        self.db.calls_rows[C1] = call_row(C1)

    def call(
        self, method: str, path: str, user: str | None, body: Any = None, **claims: Any
    ) -> Any:
        headers = auth(user, **claims) if user else {}
        return self.client.request(method, BASE + path, json=body, headers=headers)


@pytest.fixture
def w() -> World:
    return World()


SUBMIT = {
    "message_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1",
    "lead_id": LEAD,
    "text": "Thank you for writing to us.",
    "language": "en",
    "category": "reply_to_inbound",
}
CALL = {
    "request_id": "dddddddd-dddd-4ddd-8ddd-ddddddddddd1",
    "lead_id": LEAD,
    "reason": "The customer asked for a call",
    "script_draft": "Hello, this is the shop.",
    "language": "en",
}
# (method, path, body, the roles that may, whether a second factor is needed for the roles that may)
MATRIX: list[tuple[str, str, Any, tuple[str, ...], bool]] = [
    ("POST", "/outbox/messages", SUBMIT, ("a_owner", "a_admin", "a_sales"), False),
    ("GET", "/outbox/messages", None, ("a_owner", "a_admin", "a_sales"), False),
    ("GET", f"/outbox/messages/{M2}", None, ("a_owner", "a_admin", "a_sales"), False),
    ("GET", "/outbox/approvals", None, ("a_owner", "a_admin"), False),
    (
        "POST",
        f"/outbox/messages/{M1}/edit",
        {"text": "The new words"},
        ("a_owner", "a_admin"),
        False,
    ),
    ("POST", f"/outbox/messages/{M1}/approve", None, ("a_owner", "a_admin"), True),
    ("POST", f"/outbox/messages/{M1}/reject", None, ("a_owner", "a_admin"), False),
    ("POST", "/outbox/dispatch", None, ("a_owner", "a_admin"), False),
    ("GET", "/outbox/settings", None, ("a_owner", "a_admin"), False),
    (
        "PUT",
        "/outbox/settings",
        {"auto_send_enabled": True, "per_customer_daily_limit": 3},
        ("a_owner",),
        True,
    ),
    ("POST", "/call-requests", CALL, ("a_owner", "a_admin", "a_sales"), False),
    ("GET", "/call-requests", None, ("a_owner", "a_admin", "a_sales"), False),
    ("GET", f"/call-requests/{C1}", None, ("a_owner", "a_admin", "a_sales"), False),
    ("POST", f"/call-requests/{C1}/approve", None, ("a_owner",), True),
    ("POST", f"/call-requests/{C1}/reject", None, ("a_owner",), True),
]
IDS = [f"{m} {p.replace(M1, '<m>').replace(M2, '<m>').replace(C1, '<c>')}" for m, p, *_ in MATRIX]


@pytest.mark.parametrize(("method", "path", "body", "allowed", "strong"), MATRIX, ids=IDS)
def test_the_role_matrix_of_every_endpoint(
    method: str, path: str, body: Any, allowed: tuple[str, ...], strong: bool
) -> None:
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        w = World()
        r = w.call(method, path, user, body)
        if user in allowed:
            assert r.status_code == 200, (user, r.status_code, r.text)
        else:
            assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden", (
                user,
                r.status_code,
                r.text,
            )
            assert not [c for c in w.db.calls if c[0] not in ("get_message", "get_call")], (
                f"{user} reached the data layer"
            )
    w = World()
    assert w.call(method, path, "outsider", body).status_code == 404, "a stranger learns nothing"
    assert w.call(method, path, "b_owner", body).status_code == 404, (
        "another business's owner learns nothing"
    )
    assert w.call(method, path, None, body).status_code == 401
    assert w.db.calls == []
    if strong:
        for user in allowed:
            w = World()
            r = w.call(method, path, user, body, aal="aal1")
            assert r.status_code == 403 and r.json()["error"]["code"] == "mfa_required", (
                user,
                r.text,
            )
            assert w.db.calls == [], "a missing second factor never reaches the data layer"


def test_the_caller_token_is_what_the_data_layer_gets(w: World) -> None:
    headers = auth("a_sales")
    assert w.client.post(BASE + "/outbox/messages", json=SUBMIT, headers=headers).status_code == 200
    (name, token, args), *_ = w.db.calls
    assert name == "outbox_submit" and token == headers["Authorization"].removeprefix("Bearer ")
    assert args == {
        "p_message_id": SUBMIT["message_id"],
        "p_tenant_id": str(TENANT_A.id),
        "p_lead_id": LEAD,
        "p_channel": "whatsapp",
        "p_body": SUBMIT["text"],
        "p_language": "en",
        "p_category": "reply_to_inbound",
        "p_source": "owner",
        "p_model_flagged": False,
        "p_uncertain": False,
        "p_media": [],
        "p_keep_record": False,
        "p_gloss_en": None,
    }, "no phone number, no contact, no status, no approver: only what the person said"


@pytest.mark.parametrize(
    "extra",
    [
        {"phone": PHONE},
        {"to": PHONE},
        {"contact_id": C1},
        {"status": "queued"},
        {"reason": "auto_allowed"},
        {"channel": "email"},
        {"approved_by": C1},
        {"tenant_id": str(TENANT_B.id)},
        {"flags": []},
    ],
)
def test_a_body_cannot_name_a_phone_a_contact_a_status_a_reason_or_an_approver(
    w: World, extra: dict[str, Any]
) -> None:
    r = w.call("POST", "/outbox/messages", "a_owner", {**SUBMIT, **extra})
    assert r.status_code == 422, r.text
    assert w.db.calls == []


@pytest.mark.parametrize(
    "bad",
    [
        {"text": "x"},
        {"text": "x" * 3001},
        {"language": "fr"},
        {"category": "sms"},
        {"model_flagged": "yes"},
        {"lead_id": "nope"},
        {"source": "system"},
        {"message_id": None},
    ],
)
def test_invalid_input_is_refused_before_the_data_layer(w: World, bad: dict[str, Any]) -> None:
    assert w.call("POST", "/outbox/messages", "a_owner", {**SUBMIT, **bad}).status_code == 422
    assert w.db.calls == []


def test_a_call_request_body_is_closed_too(w: World) -> None:
    for extra in ({"phone": PHONE}, {"status": "approved"}, {"contact_id": C1}):
        assert w.call("POST", "/call-requests", "a_owner", {**CALL, **extra}).status_code == 422
    assert w.call("POST", "/call-requests", "a_owner", {**CALL, "reason": "x"}).status_code == 422
    assert w.db.calls == []


# ---- dispatch
def claim(message_id: str = M2, phone: str = PHONE) -> dict[str, Any]:
    return {
        "id": message_id,
        "lead_id": LEAD,
        "contact_id": C1,
        "phone": phone,
        "body": "Hello there",
        "language": "en",
    }


def test_owner_and_admin_hand_due_messages_to_the_channel_right_after_submitting(w: World) -> None:
    w.db.claims = [claim()]
    r = w.call("POST", "/outbox/messages", "a_owner", SUBMIT)
    assert r.status_code == 200 and r.json()["dispatched"] == _done(1, 0)
    assert w.db.names() == [
        "outbox_submit",
        "outbox_claim_due",
        "outbox_mark",
        "get_message",
        "list_events",
    ]
    assert len(w.adapter.sent) == 1 and w.adapter.sent[0].body == "Hello there"


def test_sales_submits_but_cannot_dispatch(w: World) -> None:
    w.db.claims = [claim()]
    r = w.call("POST", "/outbox/messages", "a_sales", SUBMIT)
    assert r.status_code == 200 and r.json()["dispatched"] is None
    assert "outbox_claim_due" not in w.db.names() and w.adapter.sent == []


def test_a_replay_dispatches_nothing_and_says_so(w: World) -> None:
    w.db.submit_answer = {"replayed": True}
    w.db.claims = [claim()]
    r = w.call("POST", "/outbox/messages", "a_owner", SUBMIT)
    assert r.json()["replayed"] is True and r.json()["dispatched"] is None and w.adapter.sent == []


def test_the_dispatch_endpoint_counts_what_the_channel_did(w: World) -> None:
    w.db.claims = [claim(M1), claim(M2)]
    w.adapter.fail_next(uuid.UUID(M2), "timeout")
    r = w.call("POST", "/outbox/dispatch", "a_admin")
    assert r.status_code == 200 and r.json() == {
        "sent": 1,
        "failed": 1,
        "retry_later": 0,
        "still_due": 0,
        "held_for_later": 0,
        "platform_switch_on": True,
    }
    marks = [c[2] for c in w.db.calls if c[0] == "outbox_mark"]
    assert (
        marks[0]["p_outcome"] == "sent"
        and marks[0]["p_adapter"] == "fake"
        and marks[0]["p_adapter_message_id"].startswith("fake-")
    )
    assert marks[1]["p_outcome"] == "failed" and marks[1]["p_failure_code"] == "timeout"


def test_an_adapter_that_raises_is_a_failed_delivery_not_a_crash(w: World) -> None:
    class Broken:
        name = "fake"

        def send(self, message: OutgoingMessage) -> SendResult:
            raise RuntimeError(f"boom {message.to_phone}")

    w.db.claims = [claim()]
    out = service.dispatch_due(w.db, Broken(), "tok", TENANT_A.id)
    assert (out.sent, out.failed) == (0, 1)
    assert [c[2]["p_failure_code"] for c in w.db.calls if c[0] == "outbox_mark"] == [
        "adapter_error"
    ]


def test_if_the_database_cannot_be_told_the_loop_goes_on(w: World) -> None:
    w.db.claims = [claim(M1), claim(M2)]
    real_mark = w.db.mark
    seen: list[str] = []

    def mark(token: str, args: dict[str, Any]) -> dict[str, Any]:
        seen.append(args["p_message_id"])
        if len(seen) == 1:
            raise OutboxStateError("SM501")
        return real_mark(token, args)

    w.db.mark = mark  # type: ignore[method-assign]
    out = service.dispatch_due(w.db, w.adapter, "tok", TENANT_A.id)
    assert seen == [M1, M2] and (out.sent, out.failed) == (1, 0)


def test_a_malformed_claim_is_skipped(w: World) -> None:
    w.db.claims = [{"id": "not-a-uuid", "phone": PHONE}, claim()]
    out = service.dispatch_due(w.db, w.adapter, "tok", TENANT_A.id)
    assert out.sent == 1 and len(w.adapter.sent) == 1


def test_the_phone_number_and_the_text_never_reach_a_log_or_an_answer(
    w: World, caplog: pytest.LogCaptureFixture
) -> None:
    w.db.claims = [claim(phone=PHONE)]
    w.adapter.fail_next(uuid.UUID(M2))
    with caplog.at_level(logging.DEBUG):
        r = w.call("POST", "/outbox/dispatch", "a_owner")
    assert (
        PHONE not in caplog.text and "98765" not in caplog.text and "Hello there" not in caplog.text
    )
    assert PHONE not in r.text and "98765" not in r.text
    assert PHONE not in repr(OutgoingMessage(uuid.uuid4(), PHONE, "Hello there", "en")), (
        "the dataclass hides both in its repr"
    )


# ---- decisions
def test_approving_hands_due_messages_to_the_channel_and_rejecting_does_not(w: World) -> None:
    w.db.claims = [claim()]
    r = w.call("POST", f"/outbox/messages/{M1}/approve", "a_owner")
    assert (
        r.status_code == 200
        and r.json()["message"]["reason"] == "owner_approved"
        and r.json()["dispatched"] == _done(1, 0)
    )
    w2 = World()
    w2.db.claims = [claim()]
    r = w2.call("POST", f"/outbox/messages/{M1}/reject", "a_owner")
    assert (
        r.json()["message"]["status"] == "blocked"
        and r.json()["dispatched"] is None
        and "outbox_claim_due" not in w2.db.names()
    )


def test_an_edit_sends_only_the_words(w: World) -> None:
    w.call("POST", f"/outbox/messages/{M1}/edit", "a_admin", {"text": "  New words here  "})
    name, _token, args = next(c for c in w.db.calls if c[0] == "outbox_edit")
    assert name == "outbox_edit" and args["text"] == "New words here"
    assert (
        w.call(
            "POST", f"/outbox/messages/{M1}/edit", "a_admin", {"text": "x", "status": "queued"}
        ).status_code
        == 422
    )


def test_ids_that_are_not_uuids_or_not_visible_are_404(w: World) -> None:
    for path in (
        "/outbox/messages/nope",
        "/outbox/messages/nope/approve",
        "/call-requests/nope",
        f"/outbox/messages/{uuid.uuid4()}",
        f"/call-requests/{uuid.uuid4()}",
    ):
        method = "POST" if path.endswith("approve") else "GET"
        assert w.call(method, path, "a_owner").status_code == 404, path


# ---- the fixed error mapping
@pytest.mark.parametrize(
    ("error", "status", "code"),
    [
        (OutboxStateError("SM501"), 409, "outbox_state"),
        (CustomerStoppedError("SM502"), 409, "customer_stopped"),
        (MfaRequired("SM306"), 403, "mfa_required"),
        (UpstreamError("PGRST000 boom with a phone +91 98765 43210"), 502, "upstream_error"),
    ],
)
def test_a_refusal_has_a_fixed_sentence_and_no_data_layer_text(
    w: World, error: Exception, status: int, code: str
) -> None:
    w.db.raise_next = error
    r = w.call("POST", f"/outbox/messages/{M1}/approve", "a_owner")
    assert (r.status_code, r.json()["error"]["code"]) == (status, code)
    assert "98765" not in r.text and "PGRST" not in r.text and "boom" not in r.text


# ---- paging
def test_the_cursor_round_trips_and_a_bad_one_is_a_422(w: World) -> None:
    stamp = "2026-10-10T10:00:00+00:00"
    cursor = service.encode_cursor(stamp, uuid.UUID(M1))
    assert service.decode_cursor(cursor) == (stamp, uuid.UUID(M1))
    assert service.decode_cursor(None) is None
    for bad in (
        "!!",
        base64.urlsafe_b64encode(b"nope").decode(),
        base64.urlsafe_b64encode(b"2026-10-10T10:00:00+00:00|nope").decode(),
    ):
        assert w.call("GET", f"/outbox/messages?after={bad}", "a_owner").status_code == 422, bad
    page = w.call("GET", "/outbox/messages?limit=2", "a_owner").json()
    assert len(page["items"]) == 2 and page["next_cursor"] is not None
    assert w.call("GET", "/outbox/messages?limit=5", "a_owner").json()["next_cursor"] is None
    assert w.call("GET", "/outbox/messages?status=unknown", "a_owner").status_code == 422
    assert w.call("GET", "/outbox/messages?limit=101", "a_owner").status_code == 422


def test_the_approval_queue_is_only_what_waits(w: World) -> None:
    items = w.call("GET", "/outbox/approvals", "a_owner").json()["items"]
    assert [i["id"] for i in items] == [M1] and items[0]["status"] == "needs_approval"
    assert (
        items[0]["customer"] == "Synthetic Silks"
        and items[0]["reason_text"] == REASON_TEXT["money"]
    )
    assert "phone" not in str(items[0]) and "contact_id" in items[0]


def test_a_row_that_does_not_fit_the_contract_is_an_upstream_failure_never_a_half_answer(
    w: World,
) -> None:
    w.db.messages[M2]["status"] = "teleported"
    r = w.call("GET", f"/outbox/messages/{M2}", "a_owner")
    assert r.status_code == 502 and r.json()["error"]["code"] == "upstream_error"


# ---- the contract is pinned to the migration
def migration_text() -> str:
    path = next(
        (Path(__file__).resolve().parents[3] / "supabase" / "migrations").glob("*_at_outbox.sql")
    )
    return path.read_text()


def check_list(table_sql: str, column: str) -> set[str]:
    match = re.search(rf"\b{column}\s+text\b[^,]*?check \({column} in \(([^)]*)\)", table_sql, re.S)
    assert match, column
    return set(re.findall(r"'([a-z_]+)'", match.group(1)))


def test_the_reasons_statuses_and_categories_are_the_databases() -> None:
    sql = migration_text()
    table = sql[
        sql.index("create table public.outbox_messages") : sql.index(
            "create table public.call_requests"
        )
    ]
    assert check_list(table, "status") == set(get_args(Status))
    assert check_list(table, "category") == set(get_args(Category))
    reason_block = table[table.index("reason ") : table.index("flags ")]
    # job CP added one reason (the campaign worker's message under an approved campaign) in its own migration
    campaign_words = {"campaign_approved"}
    assert (
        set(re.findall(r"'([a-z_]+)'", reason_block)) | campaign_words
        == set(get_args(Reason))
        == set(REASON_TEXT)
    )


def test_today_knows_the_two_new_kinds() -> None:
    raw: dict[str, Any] = {
        "cards": {"waiting": 2, "money_held_paise": 0, "orders_open": 0},
        "needs_you": [
            {
                "kind": "outbox_approval",
                "id": M1,
                "customer": "Synthetic Silks",
                "city": None,
                "agent": "followup_desk",
                "ref": "followup",
                "amount_paise": None,
                "at": "2026-10-10T10:00:00+00:00",
                "target": {"type": "outbox_message", "id": M1},
            },
            {
                "kind": "call_approval",
                "id": C1,
                "customer": "Synthetic Silks",
                "city": None,
                "agent": "followup_desk",
                "ref": "call",
                "amount_paise": None,
                "at": "2026-10-10T10:00:00+00:00",
                "target": {"type": "call_request", "id": C1},
            },
        ],
        "recent": [],
    }
    out = today_service.shape_today(raw)
    assert [i.kind for i in out.needs_you] == ["outbox_approval", "call_approval"]
    assert all("waiting for your approval" in i.summary for i in out.needs_you)


# ---- the boundary: nothing here reaches a network
def test_the_only_adapter_is_the_local_fake_and_it_opens_no_connection() -> None:
    imported: set[str] = set()
    for node in ast.walk(ast.parse(inspect.getsource(adapter_module))):
        if isinstance(node, ast.Import):
            imported |= {n.name.split(".")[0] for n in node.names}
        elif isinstance(node, ast.ImportFrom) and node.module:
            imported.add(node.module.split(".")[0])
    # ("app" is the lazy import of the WhatsApp factory inside build_adapter, job BR: the module itself opens no connection)
    assert imported <= {"__future__", "hashlib", "threading", "uuid", "dataclasses", "typing", "app"}, (
        imported
    )
    assert isinstance(build_adapter("fake"), LocalFakeAdapter)
    for name in ("twilio", "whatsapp", "meta", "", "FAKE"):
        with pytest.raises(ValueError):
            build_adapter(name)


def test_an_unknown_adapter_setting_stops_the_process() -> None:
    with pytest.raises(ConfigurationError):
        _outbox_adapter(Settings(_env_file=None, outbox_adapter="twilio"))  # type: ignore[call-arg]
    assert isinstance(_outbox_adapter(Settings(_env_file=None)), LocalFakeAdapter)  # type: ignore[call-arg]


def test_the_fake_adapter_is_deterministic_and_keeps_what_it_was_given() -> None:
    a = LocalFakeAdapter()
    m = OutgoingMessage(uuid.UUID(M1), PHONE, "Hi", "en")
    r1, r2 = a.send(m), a.send(m)
    assert r1.ok and r1.adapter_message_id == r2.adapter_message_id
    assert r1.adapter_message_id is not None and r1.adapter_message_id.startswith("fake-")
    assert len(a.sent) == 2, "every attempt is kept (a lapsed claim offers the same message again)"
    assert a.sent[0].idempotency_key == a.sent[1].idempotency_key == M1, "...with the same key"
    assert m.media_key(2) == f"{M1}:2"
    a.fail_next(uuid.UUID(M1), "rejected")
    assert a.send(m) == SendResult(False, None, "rejected") and a.send(m).ok


def test_the_outbox_is_unavailable_without_a_repository_or_adapter() -> None:
    client, _ = make_client()
    r = client.get(BASE + "/outbox/messages", headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "outbox_unavailable"


# ---------------------------------------------------------------------------------------------- job AY: photos and "keep a record"
PH1 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1"
PH2 = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2"


def test_photos_and_keep_record_are_passed_on_by_id_and_flag_only(w: World) -> None:
    body = {**SUBMIT, "message_id": str(uuid.uuid4()), "photo_ids": [PH1, PH2], "keep_record": True}
    assert w.call("POST", "/outbox/messages", "a_sales", body).status_code == 200
    args = w.db.calls[0][2]
    assert args["p_media"] == [PH1, PH2] and args["p_keep_record"] is True


@pytest.mark.parametrize(
    "bad",
    [
        {"photo_ids": ["nope"]},
        {"photo_ids": [PH1, PH2, PH1, PH2, PH1]},
        {"photo_ids": "x"},
        {"keep_record": "yes"},
        {"keep_record": 1},
        {"photos": [PH1]},
        {"media": [{"url": "http://x"}]},
    ],
)
def test_photos_and_keep_record_are_validated_before_the_data_layer(
    w: World, bad: dict[str, Any]
) -> None:
    r = w.call(
        "POST", "/outbox/messages", "a_owner", {**SUBMIT, "message_id": str(uuid.uuid4()), **bad}
    )
    assert r.status_code == 422 and w.db.calls == []


def test_a_message_shows_its_photos_as_short_lived_thumbnails_and_never_a_path() -> None:
    from tests.catalogue_fakes import FakeStorage

    db, storage = FakeOutbox(), FakeStorage()
    client, _ = make_client(outbox=db, outbox_adapter=LocalFakeAdapter(), catalogue_storage=storage)
    db.messages[M1] = message_row(
        M1,
        keep_record=True,
        media=[
            {
                "photo_id": PH2,
                "position": 2,
                "photo": {"bucket": "cat-x", "thumb_path": "i/b_t.jpg"},
            },
            {
                "photo_id": PH1,
                "position": 1,
                "photo": {"bucket": "cat-x", "thumb_path": "i/a_t.jpg"},
            },
        ],
    )
    body = client.get(BASE + f"/outbox/messages/{M1}", headers=auth("a_sales")).json()
    assert body["keep_record"] is True
    assert [(m["photo_id"], m["position"]) for m in body["media"]] == [(PH1, 1), (PH2, 2)], (
        "in order"
    )
    assert (
        body["media"][0]["thumb_url"]
        == "http://storage.local/object/sign/cat-x/i/a_t.jpg?token=abc"
    )
    assert (
        set(body["media"][0]) == {"photo_id", "position", "thumb_url"}
        and "thumb_path" not in str(body)
        and "bucket" not in str(body)
    )
    signs = [c for c in storage.calls if c[0] == "sign"]
    assert len(signs) == 1 and sorted(signs[0][3]) == ["i/a_t.jpg", "i/b_t.jpg"], (
        "one batch, thumbnails only"
    )
    listing = client.get(BASE + "/outbox/messages", headers=auth("a_sales")).json()
    assert listing["items"][0]["media"][0]["thumb_url"] is not None


def test_a_message_without_photos_has_an_empty_list_and_no_signing(w: World) -> None:
    body = w.call("GET", f"/outbox/messages/{M2}", "a_owner").json()
    assert body["media"] == [] and body["keep_record"] is False


MEDIA_CLAIM = {
    "id": M2,
    "lead_id": LEAD,
    "contact_id": C1,
    "phone": PHONE,
    "body": "Two sarees",
    "language": "en",
    "media": [
        {"photo_id": PH1, "bucket": "cat-x", "path": "i/a.jpg", "content_type": "image/jpeg"},
        {"photo_id": PH2, "bucket": "cat-x", "path": "i/b.jpg", "content_type": "image/jpeg"},
    ],
}


def _media_world(storage: Any) -> tuple[Any, Any, Any]:
    db, adapter = FakeOutbox(), LocalFakeAdapter()
    client, _ = make_client(outbox=db, outbox_adapter=adapter, catalogue_storage=storage)
    db.claims = [dict(MEDIA_CLAIM)]
    db.messages[M2] = message_row(M2, status="queued")
    return client, db, adapter


def test_the_channel_is_handed_the_photos_by_reference_and_a_short_lived_signed_address() -> None:
    from tests.catalogue_fakes import FakeStorage

    storage = FakeStorage()
    client, db, adapter = _media_world(storage)
    headers = auth("a_owner")
    r = client.post(BASE + "/outbox/dispatch", headers=headers)
    assert r.json()["sent"] == 1 and r.json()["retry_later"] == 0
    (sent,) = adapter.sent
    assert [(m.photo_id, m.bucket, m.path, m.content_type) for m in sent.media] == [
        (uuid.UUID(PH1), "cat-x", "i/a.jpg", "image/jpeg"),
        (uuid.UUID(PH2), "cat-x", "i/b.jpg", "image/jpeg"),
    ]
    assert [m.url for m in sent.media] == [
        "http://storage.local/object/sign/cat-x/i/a.jpg?token=abc",
        "http://storage.local/object/sign/cat-x/i/b.jpg?token=abc",
    ], "the channel gets an address it can fetch from"
    assert storage.expires == [300], "five minutes, not the ten of a page"
    (call,) = [c for c in storage.calls if c[0] == "sign"]
    assert call[1] == headers["Authorization"].removeprefix("Bearer "), (
        "signed with the caller's own token"
    )
    assert "http" not in repr(sent) and "token=abc" not in repr(sent.media[0]), (
        "an address is never in a log line"
    )
    assert sent.idempotency_key == M2 and sent.media_key(1) == f"{M2}:1"


def test_a_message_whose_photos_cannot_be_signed_is_not_sent_and_not_marked() -> None:
    from tests.catalogue_fakes import FakeStorage

    storage = FakeStorage()
    storage.fail_sign = True
    client, db, adapter = _media_world(storage)
    r = client.post(BASE + "/outbox/dispatch", headers=auth("a_owner"))
    assert r.json()["sent"] == 0 and r.json()["failed"] == 0 and r.json()["retry_later"] == 1
    assert adapter.sent == [] and "outbox_mark" not in db.names(), (
        "nothing is told to the database: the lease lapses and the message is offered again"
    )


def test_a_message_with_photos_is_not_sent_without_a_storage_to_sign_with() -> None:
    client, db, adapter = _media_world(None)
    r = client.post(BASE + "/outbox/dispatch", headers=auth("a_owner"))
    assert r.json()["retry_later"] == 1 and adapter.sent == [] and "outbox_mark" not in db.names()


def test_one_photo_storage_cannot_sign_holds_the_whole_message_back() -> None:
    from tests.catalogue_fakes import FakeStorage

    class Partial(FakeStorage):
        def sign(
            self, token: str, bucket: str, paths: list[str], expires: int = 600
        ) -> dict[str, str]:
            return {p: "http://storage.local/x" for p in paths if p.endswith("a.jpg")}

    client, db, adapter = _media_world(Partial())
    r = client.post(BASE + "/outbox/dispatch", headers=auth("a_owner"))
    assert r.json()["retry_later"] == 1 and adapter.sent == []


def test_a_message_without_photos_needs_no_signing() -> None:
    from tests.catalogue_fakes import FakeStorage

    storage = FakeStorage()
    client, db, adapter = _media_world(storage)
    db.claims = [claim()]
    client.post(BASE + "/outbox/dispatch", headers=auth("a_owner"))
    assert len(adapter.sent) == 1 and [c for c in storage.calls if c[0] == "sign"] == []


# ---------------------------------------------------------------------------------------------- job BB: gloss, events, the filtered log, counts, quiet hours
USER1 = "11111111-1111-4111-8111-111111111111"
T0 = "2026-10-10T10:00:00+00:00"
T1_ = "2026-10-10T10:05:00+00:00"
T2_ = "2026-10-11T03:30:00+00:00"


def test_the_gloss_is_passed_on_with_the_words_and_comes_back(w: World) -> None:
    body = {**SUBMIT, "message_id": str(uuid.uuid4()), "gloss_en": "Thank you for writing to us."}
    assert w.call("POST", "/outbox/messages", "a_sales", body).status_code == 200
    assert w.db.calls[0][2]["p_gloss_en"] == "Thank you for writing to us."
    w.db.messages[M2]["gloss_en"] = "An English gloss."
    assert (
        w.call("GET", f"/outbox/messages/{M2}", "a_owner").json()["gloss_en"] == "An English gloss."
    )
    assert w.call("GET", "/outbox/messages", "a_owner").json()["items"][0]["gloss_en"] in (
        None,
        "An English gloss.",
    )


@pytest.mark.parametrize(
    "bad", [{"gloss_en": "x"}, {"gloss_en": "y" * 3001}, {"gloss_en": 5}, {"gloss": "hello"}]
)
def test_a_bad_gloss_is_refused_before_the_data_layer(w: World, bad: dict[str, Any]) -> None:
    r = w.call(
        "POST", "/outbox/messages", "a_owner", {**SUBMIT, "message_id": str(uuid.uuid4()), **bad}
    )
    assert r.status_code == 422 and w.db.calls == []


def test_an_edit_passes_the_gloss_and_without_one_clears_it(w: World) -> None:
    assert (
        w.call(
            "POST",
            f"/outbox/messages/{M1}/edit",
            "a_owner",
            {"text": "New words here", "gloss_en": "New gloss here"},
        ).status_code
        == 200
    )
    assert [c[2] for c in w.db.calls if c[0] == "outbox_edit"][-1]["gloss_en"] == "New gloss here"
    assert (
        w.call(
            "POST", f"/outbox/messages/{M1}/edit", "a_owner", {"text": "Other words here"}
        ).status_code
        == 200
    )
    assert [c[2] for c in w.db.calls if c[0] == "outbox_edit"][-1]["gloss_en"] is None


def test_the_detail_lists_the_steps_in_order_with_who_and_when_and_no_text(w: World) -> None:
    w.db.people = {USER1: "Asha"}
    w.db.events = [
        {
            "message_id": M2,
            "kind": "made",
            "reason": None,
            "at": T0,
            "actor_kind": "assistant",
            "actor_user_id": USER1,
        },
        {
            "message_id": M2,
            "kind": "needs_approval",
            "reason": "money",
            "at": T0,
            "actor_kind": "system",
            "actor_user_id": None,
        },
        {
            "message_id": M2,
            "kind": "approved",
            "reason": None,
            "at": T1_,
            "actor_kind": "person",
            "actor_user_id": USER1,
        },
        {
            "message_id": M2,
            "kind": "held",
            "reason": "quiet_hours",
            "at": T1_,
            "actor_kind": "system",
            "actor_user_id": None,
        },
        {
            "message_id": M2,
            "kind": "sent",
            "reason": None,
            "at": T2_,
            "actor_kind": "worker",
            "actor_user_id": None,
        },
        {
            "message_id": M1,
            "kind": "made",
            "reason": None,
            "at": T0,
            "actor_kind": "person",
            "actor_user_id": USER1,
        },
    ]
    body = w.call("GET", f"/outbox/messages/{M2}", "a_sales").json()
    steps = body["events"]
    assert [e["kind"] for e in steps] == ["made", "needs_approval", "approved", "held", "sent"]
    assert steps[0]["actor"] == {"kind": "assistant", "user_id": USER1, "name": "Asha"}
    assert steps[1]["reason"] == "money" and "A person decides" in steps[1]["reason_text"]
    assert steps[3]["reason"] == "quiet_hours" and "quiet hours" in steps[3]["reason_text"]
    assert steps[4]["actor"] == {"kind": "worker", "user_id": None, "name": None}
    assert set(steps[0]) == {"kind", "reason", "reason_text", "at", "actor"}
    assert "Thank you for writing" not in str(
        {k: v for k, v in body.items() if k not in ("text",)}["events"]
    ), "no message text in an event"
    names_call = [c for c in w.db.calls if c[0] == "display_names"]
    assert len(names_call) == 1 and names_call[0][2]["ids"] == [USER1], (
        "one read of the people involved, and nobody else"
    )
    events_call = [c for c in w.db.calls if c[0] == "list_events"]
    assert events_call[0][2]["ids"] == [M2], "only this message's events"


def test_the_log_and_the_approvals_do_not_carry_events(w: World) -> None:
    items = w.call("GET", "/outbox/messages", "a_owner").json()["items"]
    assert items and all(i["events"] is None for i in items)
    assert "list_events" not in w.db.names()


def test_the_filtered_log_asks_the_database_for_the_page(w: World) -> None:
    w.db.filtered_rows = [message_row(M2)]
    r = w.call(
        "GET",
        "/outbox/messages?tab=waiting&customer=Ravi&from=2026-10-01&to=2026-10-04&limit=5",
        "a_sales",
    )
    assert r.status_code == 200 and [i["id"] for i in r.json()["items"]] == [M2]
    (call,) = [c for c in w.db.calls if c[0] == "outbox_list"]
    assert call[2] == {
        "tab": "waiting",
        "customer": "Ravi",
        "from": "2026-10-01",
        "to": "2026-10-04",
        "after": None,
        "limit": 5,
    }
    assert "list_messages" not in w.db.names()


def test_the_cursor_of_a_filtered_page_continues_it(w: World) -> None:
    w.db.filtered_rows = [message_row(M2, created_at="2026-10-09T10:00:00+00:00")]
    page = w.call("GET", "/outbox/messages?tab=sent&limit=1", "a_owner").json()
    assert page["next_cursor"]
    w.call("GET", f"/outbox/messages?tab=sent&limit=1&after={page['next_cursor']}", "a_owner")
    last = [c for c in w.db.calls if c[0] == "outbox_list"][-1][2]
    assert last["after"] == ("2026-10-09T10:00:00+00:00", uuid.UUID(M2))


@pytest.mark.parametrize(
    "query",
    [
        "tab=bogus",
        "customer=a",
        "customer=" + "x" * 61,
        "from=not-a-date",
        "to=2026-13-01",
        "tab=sent&status=sent",
        "customer=Ravi&lead_id=" + LEAD,
    ],
)
def test_bad_filters_are_refused_before_the_data_layer(w: World, query: str) -> None:
    r = w.call("GET", "/outbox/messages?" + query, "a_owner")
    assert r.status_code == 422 and w.db.calls == []


def test_the_old_filters_still_use_the_plain_list(w: World) -> None:
    w.call("GET", f"/outbox/messages?status=sent&lead_id={LEAD}", "a_owner")
    assert w.db.names()[0] == "list_messages" and "outbox_list" not in w.db.names()


def test_the_summary_is_the_counts_and_who_may_ask(w: World) -> None:
    w.db.summary_answer = {
        "waiting": 3,
        "scheduled": 1,
        "sent": 7,
        "blocked": 2,
        "due_now": 1,
        "held_for_later": 4,
    }
    r = w.call("GET", "/outbox/summary?customer=Ravi&from=2026-10-01", "a_sales")
    assert r.status_code == 200 and r.json() == w.db.summary_answer
    (call,) = [c for c in w.db.calls if c[0] == "outbox_summary"]
    assert call[2] == {"customer": "Ravi", "from": "2026-10-01", "to": None}
    for user, code in (("a_viewer", 403), ("outsider", 404), ("b_owner", 404)):
        assert w.call("GET", "/outbox/summary", user).status_code == code, user
    assert w.call("GET", "/outbox/summary", None).status_code == 401


def test_the_dispatch_button_says_what_is_still_waiting(w: World) -> None:
    w.db.claims = []
    w.db.summary_answer = {
        "waiting": 0,
        "scheduled": 5,
        "sent": 0,
        "blocked": 0,
        "due_now": 2,
        "held_for_later": 3,
    }
    w.db.settings["platform_switch_on"] = False
    r = w.call("POST", "/outbox/dispatch", "a_owner")
    assert r.json() == {
        "sent": 0,
        "failed": 0,
        "retry_later": 0,
        "still_due": 2,
        "held_for_later": 3,
        "platform_switch_on": False,
    }
    # it is this business's: the tenant in the path is the only one the database is asked about
    assert all(c[0] != "outbox_claim_due" or c[2]["tenant"] == str(TENANT_A.id) for c in w.db.calls)
    assert w.call("POST", "/outbox/dispatch", "a_sales").status_code == 403


def test_quiet_hours_are_read_and_set_with_the_other_settings(w: World) -> None:
    got = w.call("GET", "/outbox/settings", "a_admin").json()
    assert got["quiet_hours_start"] == 21 and got["quiet_hours_end"] == 9
    r = w.call(
        "PUT",
        "/outbox/settings",
        "a_owner",
        {
            "auto_send_enabled": True,
            "per_customer_daily_limit": 4,
            "quiet_hours_start": 19,
            "quiet_hours_end": 10,
        },
    )
    assert r.status_code == 200 and (
        r.json()["quiet_hours_start"],
        r.json()["quiet_hours_end"],
    ) == (19, 10)
    assert [c[2] for c in w.db.calls if c[0] == "outbox_set_settings"][-1] == {
        "auto": True,
        "limit": 4,
        "start": 19,
        "end": 10,
    }
    w.call(
        "PUT",
        "/outbox/settings",
        "a_owner",
        {"auto_send_enabled": True, "per_customer_daily_limit": 4},
    )
    assert [c[2] for c in w.db.calls if c[0] == "outbox_set_settings"][-1] == {
        "auto": True,
        "limit": 4,
        "start": None,
        "end": None,
    }, "a field left out is not sent: it keeps its value"
    assert w.db.settings["quiet_hours_start"] == 19


@pytest.mark.parametrize(
    "bad",
    [
        {"quiet_hours_start": 18},
        {"quiet_hours_start": 24},
        {"quiet_hours_end": 6},
        {"quiet_hours_end": 11},
        {"quiet_hours_start": "21"},
        {"quiet_hours_start": 21.5},
        {"quiet_hours_start": True},
    ],
)
def test_quiet_hours_outside_the_allowed_range_never_reach_the_data_layer(
    w: World, bad: dict[str, Any]
) -> None:
    r = w.call(
        "PUT",
        "/outbox/settings",
        "a_owner",
        {"auto_send_enabled": False, "per_customer_daily_limit": 3, **bad},
    )
    assert r.status_code == 422 and w.db.calls == []


def test_the_quiet_hours_sentence_no_longer_says_nine(w: World) -> None:
    assert "9" not in REASON_TEXT["quiet_hours"] and "quiet hours" in REASON_TEXT["quiet_hours"]
