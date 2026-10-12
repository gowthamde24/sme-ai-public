"""Job BR: the HTTP side of WhatsApp against in-memory fakes. The public webhook (handshake, signature, size, rate, nothing configured), the role matrix and what reaches the data layer for the
account, templates and conversations, template submission against a fake Graph, and the secrets that must never come back. The database rules are pgTAP 86; the real stack is
tests/integration/test_br_whatsapp.py."""

from __future__ import annotations

import json
import uuid
from typing import Any

import httpx
import pytest

from app.integrations.ratelimit import SlidingWindow
from app.suppression.keys import KeyRing, KeyVersion
from app.whatsapp import payloads, routes, webhook
from app.whatsapp.fake_graph import FakeGraph
from app.whatsapp.graph import GraphClient
from app.whatsapp.ingest import WhatsAppIngest
from app.whatsapp.runtime import WhatsAppRuntime
from app.whatsapp.tokens import TokenResolver
from tests.fakes import TENANT_A, auth, make_client
from tests.test_whatsapp_units import PNI, SECRET, Session
from tests.whatsapp_fakes import FakeWhatsAppRepo

T = f"/v1/tenants/{TENANT_A.id}"
VERIFY = "verify-token-for-tests"
TPL = "55555555-5555-4555-8555-555555555555"
LEAD = "66666666-6666-4666-8666-666666666666"
ACCOUNT = {"waba_id": "100000000000009", "phone_number_id": PNI, "display_phone": "+91 98765 43210", "coexistence": True, "token_ref": "shop_a"}


@pytest.fixture(autouse=True)
def _fresh_limits(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(routes, "PER_ADDRESS", SlidingWindow(1200, 60))
    monkeypatch.setattr(routes, "BAD_PER_ADDRESS", SlidingWindow(20, 60))


class World:
    def __init__(self, *, configured: bool = True, graph: FakeGraph | None = None) -> None:
        self.repo = FakeWhatsAppRepo()
        self.graph = graph or FakeGraph()
        ring = KeyRing(KeyVersion(1, b"k" * 32))
        self.runtime = WhatsAppRuntime(
            repository=self.repo,
            ingest=WhatsAppIngest(self.repo, Session(), ring) if configured else None,
            app_secret=SECRET if configured else None,
            verify_token=VERIFY if configured else None,
            graph=GraphClient("https://graph.example.test", "v25.0", client=httpx.Client(transport=self.graph.transport())),
            tokens=TokenResolver(None, {"shop_a": "fake-token"}),
        )
        self.client, _ = make_client(whatsapp=self.runtime)

    def call(self, method: str, path: str, user: str | None, body: Any = None, **claims: Any) -> Any:
        return self.client.request(method, path, json=body, headers=auth(user, **claims) if user else {})

    def post_webhook(self, payload: dict[str, Any], secret: str | None = SECRET, *, sign: bool = True) -> Any:
        body = payloads.raw(payload)
        headers = {"Content-Type": "application/json"}
        if sign:
            headers["X-Hub-Signature-256"] = webhook.sign(body, secret or "")
        return self.client.post("/v1/webhooks/whatsapp", content=body, headers=headers)


@pytest.fixture
def w() -> World:
    return World()


# ------------------------------------------------------------------------------------------------------------------------ the webhook
def test_the_handshake(w: World) -> None:
    ok = w.client.get("/v1/webhooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "1158201444"})
    assert ok.status_code == 200 and ok.text == "1158201444"
    for params in ({"hub.mode": "subscribe", "hub.verify_token": "bad", "hub.challenge": "1"}, {"hub.mode": "subscribe", "hub.challenge": "1"}, {"hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "abc"}):
        assert w.client.get("/v1/webhooks/whatsapp", params=params).status_code == 403
    assert w.repo.calls == []


def test_a_signed_notification_is_stored_and_needs_no_sign_in(w: World) -> None:
    r = w.post_webhook(payloads.inbound(PNI, "919876543210", "wamid.1", text="Hello"))
    assert r.status_code == 200 and r.json() == {"received": 1, "stored": 1, "optouts": 0, "statuses": 0, "duplicates": 0, "ignored": 0}
    assert [c[0] for c in w.repo.calls] == ["ingest_inbound"]


def test_a_stop_message_is_counted_as_an_optout(w: World) -> None:
    assert w.post_webhook(payloads.inbound(PNI, "919876543210", "wamid.2", text="STOP")).json()["optouts"] == 1


def test_a_status_notification(w: World) -> None:
    r = w.post_webhook(payloads.status(PNI, "wamid.S", "delivered", callback=str(uuid.uuid4())))
    assert r.json()["statuses"] == 1 and w.repo.calls[0][0] == "ingest_status"


def test_a_wrong_missing_or_malformed_signature_is_a_401_and_nothing_happens(w: World) -> None:
    payload = payloads.inbound(PNI, "919876543210", "wamid.1")
    assert w.post_webhook(payload, "another-secret").status_code == 401
    assert w.post_webhook(payload, sign=False).status_code == 401
    body = payloads.raw(payload)
    assert w.client.post("/v1/webhooks/whatsapp", content=body, headers={"X-Hub-Signature-256": "sha256=zz"}).status_code == 401
    assert w.client.post("/v1/webhooks/whatsapp", content=body + b" ", headers={"X-Hub-Signature-256": webhook.sign(body, SECRET)}).status_code == 401
    assert w.repo.calls == []


def test_bad_signatures_are_rate_limited_per_address(w: World) -> None:
    payload = payloads.inbound(PNI, "919876543210", "wamid.1")
    codes = [w.post_webhook(payload, "bad").status_code for _ in range(25)]
    assert codes[:20] == [401] * 20 and set(codes[20:]) == {429}
    assert w.post_webhook(payload).status_code in (200, 429), "the limit counts failures; a good one is judged on its own allowance"


def test_the_body_size_is_capped_before_it_is_read_into_the_database(w: World) -> None:
    big = b"{" + b" " * (webhook.MAX_BODY_BYTES + 10) + b"}"
    r = w.client.post("/v1/webhooks/whatsapp", content=big, headers={"X-Hub-Signature-256": webhook.sign(big, SECRET)})
    assert r.status_code == 413 and w.repo.calls == []


def test_a_signed_body_that_is_not_json_is_a_400(w: World) -> None:
    body = b"not json"
    r = w.client.post("/v1/webhooks/whatsapp", content=body, headers={"X-Hub-Signature-256": webhook.sign(body, SECRET)})
    assert r.status_code == 400


def test_a_data_layer_failure_is_a_5xx_so_meta_retries(w: World) -> None:
    from app.tenancy.repository import UpstreamError

    w.repo.fail = UpstreamError("down")
    assert w.post_webhook(payloads.inbound(PNI, "919876543210", "wamid.1")).status_code >= 500


def test_nothing_configured_means_503_not_an_open_door() -> None:
    w = World(configured=False)
    assert w.post_webhook(payloads.inbound(PNI, "919876543210", "wamid.1")).status_code == 503
    assert w.client.get("/v1/webhooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1"}).status_code == 503
    bare, _ = make_client()
    assert bare.get("/v1/webhooks/whatsapp", params={"hub.mode": "subscribe", "hub.challenge": "1"}).status_code == 503


# ------------------------------------------------------------------------------------------------------------------------ the account
def test_the_account_roles_and_what_is_sent(w: World) -> None:
    assert w.call("GET", T + "/whatsapp/account", "a_admin").json() == {"configured": False, "status": "none"}
    for user in ("a_sales", "a_viewer"):
        assert w.call("GET", T + "/whatsapp/account", user).status_code == 403
    assert w.call("PUT", T + "/whatsapp/account", "a_admin", ACCOUNT).status_code == 403
    assert w.call("PUT", T + "/whatsapp/account", "a_owner", ACCOUNT, aal="aal1").status_code == 403
    assert w.call("PUT", T + "/whatsapp/account", "outsider", ACCOUNT).status_code == 404
    saved = w.call("PUT", T + "/whatsapp/account", "a_owner", ACCOUNT)
    assert saved.status_code == 200 and saved.json()["status"] == "pending" and saved.json()["token_available"] is True and saved.json()["token_ref"] == "shop_a"
    assert "token" not in {k for k in saved.json() if k != "token_ref" and k != "token_available"}
    assert w.repo.calls[-1][1]["p_coexistence"] is True
    assert w.call("POST", T + "/whatsapp/account/activate", "a_admin").status_code == 403
    assert w.call("POST", T + "/whatsapp/account/activate", "a_owner").json()["status"] == "active"
    assert w.call("POST", T + "/whatsapp/account/disable", "a_owner").json()["status"] == "disabled"


def test_account_input_is_strict(w: World) -> None:
    for bad in ({**ACCOUNT, "phone_number_id": "abc"}, {**ACCOUNT, "token_ref": "bad ref!"}, {**ACCOUNT, "extra": 1}, {k: v for k, v in ACCOUNT.items() if k != "waba_id"}, {**ACCOUNT, "token": "EAAGsecret"}):
        assert w.call("PUT", T + "/whatsapp/account", "a_owner", bad).status_code == 422, bad


def test_a_token_value_is_never_accepted_or_returned() -> None:
    w = World()
    w.call("PUT", T + "/whatsapp/account", "a_owner", ACCOUNT)
    got = w.call("GET", T + "/whatsapp/account", "a_owner")
    assert "fake-token" not in got.text and "EAAG" not in got.text and got.json()["token_available"] is True


# ------------------------------------------------------------------------------------------------------------------------ templates
TEMPLATE = {"name": "shop_update", "language": "te", "category": "utility", "purpose": "followup", "body": "మీ షాప్ నుండి వార్త: {{1}} ఆపడానికి STOP అని పంపండి."}


def test_template_roles_and_flow(w: World) -> None:
    assert w.call("GET", T + "/whatsapp/templates", "a_sales").status_code == 403
    assert w.call("PUT", T + f"/whatsapp/templates/{TPL}", "a_sales", TEMPLATE).status_code == 403
    saved = w.call("PUT", T + f"/whatsapp/templates/{TPL}", "a_admin", TEMPLATE)
    assert saved.status_code == 200 and saved.json()["template"]["status"] == "draft"
    assert w.call("PUT", T + "/whatsapp/templates/not-a-uuid", "a_admin", TEMPLATE).status_code == 404
    for bad in ({**TEMPLATE, "language": "fr"}, {**TEMPLATE, "purpose": "marketing_blast"}, {**TEMPLATE, "name": "Bad Name"}, {**TEMPLATE, "body": "short"}):
        assert w.call("PUT", T + f"/whatsapp/templates/{TPL}", "a_admin", bad).status_code == 422
    assert w.call("POST", T + f"/whatsapp/templates/{TPL}/status", "a_admin", {"status": "approved"}).json()["template"]["status"] == "approved"
    assert w.call("PUT", T + f"/whatsapp/templates/{TPL}", "a_admin", TEMPLATE).status_code == 409, "an approved template is not edited"
    assert w.call("POST", T + f"/whatsapp/templates/{TPL}/status", "a_admin", {"status": "draft"}).status_code == 422
    assert len(w.call("GET", T + "/whatsapp/templates", "a_owner").json()["templates"]) == 1


def test_a_draft_is_sent_to_meta_for_review_with_the_documented_payload(w: World) -> None:
    w.call("PUT", T + "/whatsapp/account", "a_owner", ACCOUNT)
    w.call("PUT", T + f"/whatsapp/templates/{TPL}", "a_admin", TEMPLATE)
    r = w.call("POST", T + f"/whatsapp/templates/{TPL}/submit", "a_admin")
    assert r.status_code == 200 and r.json()["template"]["status"] == "submitted"
    (created,) = w.graph.templates_created
    assert created["name"] == "shop_update" and created["category"] == "UTILITY" and created["language"] == "te"
    assert created["components"][0]["type"] == "BODY" and "{{1}}" in created["components"][0]["text"]
    assert w.call("POST", T + f"/whatsapp/templates/{TPL}/submit", "a_admin").status_code == 409, "only a draft goes to review"


def test_submitting_without_a_number_or_a_token_is_a_409_and_nothing_goes_to_meta(w: World) -> None:
    w.call("PUT", T + f"/whatsapp/templates/{TPL}", "a_admin", TEMPLATE)
    assert w.call("POST", T + f"/whatsapp/templates/{TPL}/submit", "a_admin").status_code == 409
    w.call("PUT", T + "/whatsapp/account", "a_owner", {**ACCOUNT, "token_ref": "no_such_ref"})
    assert w.call("POST", T + f"/whatsapp/templates/{TPL}/submit", "a_admin").status_code == 409
    assert w.graph.templates_created == []


def test_a_refusal_by_meta_is_a_502_without_its_words(w: World) -> None:
    w.call("PUT", T + "/whatsapp/account", "a_owner", ACCOUNT)
    w.call("PUT", T + f"/whatsapp/templates/{TPL}", "a_admin", TEMPLATE)
    w.graph.tokens = {"other"}
    r = w.call("POST", T + f"/whatsapp/templates/{TPL}/submit", "a_admin")
    assert r.status_code == 502 and r.json()["error"]["code"] == "whatsapp_refused"
    assert w.repo.templates[TPL]["status"] == "draft"


# ------------------------------------------------------------------------------------------------------------------------ conversations
def test_the_inbox_is_for_owner_admin_and_sales(w: World) -> None:
    w.repo.conversations = [{"lead_id": LEAD, "name": "Ravi", "last_at": "2026-10-05T10:00:00+00:00", "unread": True}]
    for user in ("a_owner", "a_admin", "a_sales"):
        r = w.call("GET", T + "/conversations", user)
        assert r.status_code == 200 and r.json()["conversations"][0]["unread"] is True and r.json()["next_before"] is None, user
    assert w.call("GET", T + "/conversations", "a_viewer").status_code == 403
    assert w.call("GET", T + "/conversations", "outsider").status_code == 404
    assert w.call("GET", T + "/conversations?limit=0", "a_owner").status_code == 422


def test_a_full_page_says_where_the_next_begins(w: World) -> None:
    w.repo.conversations = [{"lead_id": LEAD, "last_at": f"2026-10-05T10:0{i}:00+00:00"} for i in range(3)]
    r = w.call("GET", T + "/conversations?limit=3", "a_owner").json()
    assert r["next_before"] == "2026-10-05T10:02:00+00:00"


def test_a_thread_and_marking_it_read(w: World) -> None:
    r = w.call("GET", T + f"/conversations/{LEAD}", "a_sales")
    assert r.status_code == 200 and r.json()["items"][0]["direction"] == "in" and r.json()["window_open"] is True
    assert w.call("GET", T + "/conversations/nope", "a_sales").status_code == 404
    assert w.call("POST", T + f"/conversations/{LEAD}/read", "a_viewer").status_code == 403
    assert w.call("POST", T + f"/conversations/{LEAD}/read", "a_sales").status_code == 204 and w.repo.read == [LEAD]
    assert all(t.count(".") == 2 for t in w.repo.tokens), "every call carried the caller's own token"


def test_the_unwired_feature_is_a_503() -> None:
    bare, _ = make_client()
    assert bare.get(T + "/conversations", headers=auth("a_owner")).status_code == 503
    assert bare.get(T + "/whatsapp/account", headers=auth("a_owner")).status_code == 503
    assert json.loads(bare.get(T + "/whatsapp/account", headers=auth("a_owner")).text)["error"]["code"] == "whatsapp_unavailable"
