"""Job BR on the real stack: the WhatsApp channel end to end with a fake Graph server on a local port. A signed webhook becomes a contact, a lead and an enquiry; the owner's reply goes through the
outbox, the policy and the real adapter to the fake Graph; delivery statuses come back by webhook; a STOP stops everything; outside the 24-hour window only an approved template is sent. The database
rules are pgTAP 86. All data is synthetic (numbers start +00, so the real-data gate stays closed)."""

# ruff: noqa: E501, S608

from __future__ import annotations

import json
import threading
import uuid
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import operator_sql
import pytest
from conftest import TEST_SUPPRESSION_KEY, Stack, aal1_token, bearer
from crm_support import Tenant, World
from evidence_support import uid
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app.config import Settings
from app.main import create_app
from app.whatsapp import payloads, webhook
from app.whatsapp.fake_graph import FakeGraph

APP_SECRET = "integration-app-secret"
VERIFY = "integration-verify-token"
IST = timedelta(hours=5, minutes=30)


class GraphServer:
    """FakeGraph on a local port (the API's adapter speaks real HTTP to it)."""

    def __init__(self) -> None:
        self.now = datetime.now(UTC)
        self.graph = FakeGraph({"fake-token"}, clock=lambda: self.now)
        graph = self.graph

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:  # noqa: N802
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                status, answer = graph.handle("POST", self.path, {k.lower(): v for k, v in self.headers.items()}, body)
                data = json.dumps(answer).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *_: object) -> None:
                return

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


def pin(at: datetime, graph: GraphServer | None = None) -> None:
    """The database's outbox clock (and the fake Graph's, when given) is `at`."""
    if graph is not None:
        graph.now = at
    operator_sql.sql(f"create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '' as $b$ select timestamptz '{at.isoformat()}' $b$")


def restore_clock() -> None:
    operator_sql.sql("create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '' as $b$ select now() $b$")


@pytest.fixture(scope="module")
def graph() -> Iterator[GraphServer]:
    server = GraphServer()
    yield server
    server.close()


@pytest.fixture(scope="module")
def world(eval_world: World) -> World:
    return eval_world


@pytest.fixture(scope="module")
def pni() -> str:
    return str(uuid.uuid4().int)[:15]


@pytest.fixture(scope="module")
def wa(stack: Stack, signup: Any, graph: GraphServer, world: World, pni: str) -> Iterator[TestClient]:
    channel = signup("br-channel", mfa=False)
    operator_sql.sql(f"select app.operator_register_channel_agent('{channel.email}')")
    scheduler = signup("br-sched", mfa=False)
    operator_sql.sql(f"select app.operator_register_scheduler('{scheduler.email}')")
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None,
        api_env="development",
        supabase_url=stack.url,
        supabase_anon_key=stack.anon_key,
        suppression_hmac_key=SecretStr(TEST_SUPPRESSION_KEY),
        outbox_adapter="whatsapp",
        whatsapp_api_base=graph.url,
        whatsapp_app_secret=SecretStr(APP_SECRET),
        whatsapp_verify_token=SecretStr(VERIFY),
        whatsapp_access_tokens=SecretStr('{"shop_a": "fake-token"}'),
        channel_agent_email=channel.email,
        channel_agent_password=SecretStr(channel.password),
    )
    operator_sql.sql("update public.platform_flags set enabled = true where key = 'outbox_enabled'")
    try:
        with TestClient(create_app(settings)) as client:
            owner = world.a.users["owner"]
            put = client.put(f"/v1/tenants/{world.a.id}/whatsapp/account", json={"waba_id": "200000000000001", "phone_number_id": pni, "display_phone": "+00 90000 00001", "coexistence": False, "token_ref": "shop_a"}, headers=bearer(owner))
            assert put.status_code == 200, put.text
            assert client.post(f"/v1/tenants/{world.a.id}/whatsapp/account/activate", headers=bearer(owner)).json()["status"] == "active"
            assert client.put(f"/v1/tenants/{world.a.id}/outbox/settings", json={"auto_send_enabled": True, "per_customer_daily_limit": 10}, headers=bearer(owner)).status_code == 200
            yield client
    finally:
        restore_clock()
        operator_sql.sql("update public.platform_flags set enabled = false where key = 'outbox_enabled'")
        operator_sql.sql(f"select app.operator_remove_channel_agent('{channel.email}')")
        operator_sql.sql(f"select app.operator_remove_scheduler('{scheduler.email}')")


def url(t: Tenant, path: str) -> str:
    return f"/v1/tenants/{t.id}{path}"


def post(client: TestClient, payload: dict[str, Any], secret: str = APP_SECRET) -> Any:
    body = payloads.raw(payload)
    return client.post("/v1/webhooks/whatsapp", content=body, headers={"Content-Type": "application/json", "X-Hub-Signature-256": webhook.sign(body, secret)})


def yesterday_noon() -> datetime:
    day = (datetime.now(UTC) + IST).date() - timedelta(days=2)
    return datetime(day.year, day.month, day.day, 12, 0, tzinfo=UTC) - IST


def ts(at: datetime) -> int:
    return int(at.timestamp())


def number(n: int) -> str:
    return f"00912345{n:05d}"


# ============================================================================ the webhook's door
def test_the_handshake_and_the_signature_on_the_real_app(wa: TestClient, pni: str) -> None:
    ok = wa.get("/v1/webhooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": VERIFY, "hub.challenge": "123456"})
    assert ok.status_code == 200 and ok.text == "123456"
    assert wa.get("/v1/webhooks/whatsapp", params={"hub.mode": "subscribe", "hub.verify_token": "no", "hub.challenge": "1"}).status_code == 403
    p = payloads.inbound(pni, number(1), "wamid.SIG1", text="hello")
    assert post(wa, p, "wrong-secret").status_code == 401
    assert wa.post("/v1/webhooks/whatsapp", content=payloads.raw(p)).status_code == 401
    assert operator_sql.sql("select count(*) from integrations.wa_events where external_id = 'wamid.SIG1'") == "0"


# ============================================================================ the whole conversation
def test_a_customer_writes_the_owner_replies_and_delivery_comes_back(wa: TestClient, graph: GraphServer, world: World, pni: str) -> None:
    t, owner = world.a, world.a.users["owner"]
    t0 = yesterday_noon()
    pin(t0, graph)
    graph.graph.inbound_from(number(10), t0)
    num = number(10)
    r = post(wa, payloads.inbound(pni, num, "wamid.C1", text="Do you have kanjivaram sarees in red?", name="Ravi Kumar", timestamp=ts(t0)))
    assert r.status_code == 200 and r.json()["stored"] == 1, r.text
    assert post(wa, payloads.inbound(pni, num, "wamid.C1", text="Do you have kanjivaram sarees in red?", timestamp=ts(t0))).json()["duplicates"] == 1, "Meta's retry changes nothing"
    contact = operator_sql.sql(f"select id || '|' || whatsapp_consent || '|' || coalesce(company_id::text, '') from public.contacts where tenant_id = '{t.id}' and phone = '+{num}'")
    contact_id, consent, company = contact.split("|")
    assert consent == "granted" and company, "opted in by writing to us; with a generic company"
    assert operator_sql.sql(f"select count(*) from suppression.contact_keys where contact_id = '{contact_id}' and phone_hmac is not null") == "1"
    convs = wa.get(url(t, "/conversations"), headers=bearer(owner)).json()["conversations"]
    mine = next(c for c in convs if c["contact_id"] == contact_id)
    assert mine["unread"] is True and mine["window_open"] is True and mine["name"] == "Ravi Kumar" and "kanjivaram" in mine["preview"]
    lead = mine["lead_id"]
    # the enquiry is the customer's words, available to the existing flows
    assert wa.get(url(t, f"/conversations/{lead}"), headers=bearer(owner)).json()["items"][0]["text"].startswith("Do you have")
    assert wa.post(url(t, f"/conversations/{lead}/read"), headers=bearer(owner)).status_code == 204
    assert next(c for c in wa.get(url(t, "/conversations"), headers=bearer(owner)).json()["conversations"] if c["lead_id"] == lead)["unread"] is False
    # the owner replies (the outbox's policy, then the real adapter, then the fake Graph)
    mid = uid()
    sent = wa.post(url(t, "/outbox/messages"), json={"message_id": mid, "lead_id": lead, "text": "Yes, we have red kanjivaram sarees. Please visit us.", "language": "en", "category": "reply_to_inbound"}, headers=bearer(owner))
    assert sent.status_code == 200, sent.text
    assert sent.json()["message"]["status"] == "sent", sent.text
    (out,) = [m for m in graph.graph.sent if m["to"] == num]
    assert out["type"] == "text" and out["payload"]["biz_opaque_callback_data"] == mid and out["payload"]["to"] == f"+{num}"
    assert "AI assistant" in out["payload"]["text"]["body"] or "Yes, we have red" in out["payload"]["text"]["body"]
    wamid = out["wamid"]
    # Meta reports delivery and the customer reading it
    assert post(wa, payloads.status(pni, wamid, "sent", num, callback=mid, timestamp=ts(t0))).json()["statuses"] == 1
    assert post(wa, payloads.status(pni, wamid, "delivered", num, callback=mid, timestamp=ts(t0) + 5)).json()["statuses"] == 1
    assert post(wa, payloads.status(pni, wamid, "read", num, callback=mid, timestamp=ts(t0) + 60)).json()["statuses"] == 1
    thread = wa.get(url(t, f"/conversations/{lead}"), headers=bearer(owner)).json()
    outgoing = next(i for i in thread["items"] if i["direction"] == "out")
    assert outgoing["status"] == "sent" and outgoing["delivery"] == "read" and outgoing["read_at"] is not None
    detail = wa.get(url(t, f"/outbox/messages/{mid}"), headers=bearer(owner)).json()
    kinds = [e["kind"] for e in detail["events"]]
    assert "delivered" in kinds and "read" in kinds, kinds
    # a delivery failure from Meta is kept as a step, in words
    assert post(wa, payloads.status(pni, wamid, "failed", num, error_code=131026, timestamp=ts(t0) + 90)).json()["statuses"] == 1
    assert wa.get(url(t, f"/conversations/{lead}"), headers=bearer(owner)).json()["items"][0]["delivery_error"] == "unreachable"


def test_a_stop_message_stops_everything(wa: TestClient, graph: GraphServer, world: World, pni: str) -> None:
    t, owner = world.a, world.a.users["owner"]
    t0 = yesterday_noon() + timedelta(minutes=10)
    pin(t0, graph)
    graph.graph.inbound_from(number(11), t0)
    num = number(11)
    assert post(wa, payloads.inbound(pni, num, "wamid.D1", text="Hi", name="Lakshmi", timestamp=ts(t0))).json()["stored"] == 1
    lead = next(c["lead_id"] for c in wa.get(url(t, "/conversations"), headers=bearer(owner)).json()["conversations"] if c["name"] == "Lakshmi")
    queued = wa.post(url(t, "/outbox/messages"), json={"message_id": uid(), "lead_id": lead, "text": "Our shop opens at ten. Welcome!", "language": "en", "category": "info"}, headers=bearer(owner))
    assert queued.json()["message"]["status"] == "sent"
    before = len(graph.graph.sent)
    stop = post(wa, payloads.inbound(pni, num, "wamid.D2", text=" stop ", name="Lakshmi", timestamp=ts(t0) + 30))
    assert stop.json()["optouts"] == 1
    assert operator_sql.sql(f"select suppression_reason || '/' || whatsapp_consent from public.contacts where tenant_id = '{t.id}' and phone = '+{num}'") == "opted_out/withdrawn"
    blocked = wa.post(url(t, "/outbox/messages"), json={"message_id": uid(), "lead_id": lead, "text": "One more thing about the sale.", "language": "en", "category": "reply_to_inbound"}, headers=bearer(owner))
    assert blocked.json()["message"]["status"] == "blocked" and blocked.json()["message"]["reason"] == "stopped", blocked.text
    assert len(graph.graph.sent) == before, "nothing reached Meta after the STOP"
    assert next(c for c in wa.get(url(t, "/conversations"), headers=bearer(owner)).json()["conversations"] if c["lead_id"] == lead)["stopped"] is True


def test_outside_the_window_only_an_approved_template_goes(wa: TestClient, graph: GraphServer, world: World, pni: str) -> None:
    t, owner = world.a, world.a.users["owner"]
    t0 = yesterday_noon() + timedelta(minutes=20)
    pin(t0, graph)
    graph.graph.inbound_from(number(12), t0)
    num = number(12)
    post(wa, payloads.inbound(pni, num, "wamid.T1", text="Hello", name="Meena", timestamp=ts(t0)))
    lead = next(c["lead_id"] for c in wa.get(url(t, "/conversations"), headers=bearer(owner)).json()["conversations"] if c["name"] == "Meena")
    pin(t0 + timedelta(hours=26), graph)  # the window closed two hours ago
    refused = wa.post(url(t, "/outbox/messages"), json={"message_id": uid(), "lead_id": lead, "text": "We have new silk sarees this week.", "language": "en", "category": "followup"}, headers=bearer(owner))
    assert refused.json()["message"]["status"] == "failed" and refused.json()["message"]["failure_code"] == "template_required", refused.text
    assert not [m for m in graph.graph.sent if m["to"] == num], "nothing was sent to Meta without a template"
    # the owner writes a template, Meta approves it (here: the Owner says so, and the fake Graph knows it)
    tid = uid()
    body = {"name": f"shop_news_{tid[:6].replace('-', '')}", "language": "en", "category": "utility", "purpose": "followup", "body": "News from our shop: {{1}} Reply STOP to stop these messages."}
    assert wa.put(url(t, f"/whatsapp/templates/{tid}"), json=body, headers=bearer(owner)).status_code == 200
    assert wa.post(url(t, f"/whatsapp/templates/{tid}/submit"), headers=bearer(owner)).json()["template"]["status"] == "submitted"
    assert graph.graph.templates_created[-1]["name"] == body["name"]
    assert wa.post(url(t, f"/whatsapp/templates/{tid}/status"), json={"status": "approved"}, headers=bearer(owner)).json()["template"]["status"] == "approved"
    graph.graph.approve_template(body["name"], "en")
    ok = wa.post(url(t, "/outbox/messages"), json={"message_id": uid(), "lead_id": lead, "text": "We have new silk sarees this week.\nCome and see them.", "language": "en", "category": "followup"}, headers=bearer(owner))
    assert ok.json()["message"]["status"] == "sent", ok.text
    (out,) = [m for m in graph.graph.sent if m["to"] == num]
    assert out["type"] == "template" and out["payload"]["template"]["name"] == body["name"]
    assert "\n" not in out["payload"]["template"]["components"][0]["parameters"][0]["text"]


def test_meta_being_busy_leaves_the_message_to_be_offered_again(wa: TestClient, graph: GraphServer, world: World, pni: str) -> None:
    t, owner = world.a, world.a.users["owner"]
    t0 = yesterday_noon() + timedelta(minutes=30)
    pin(t0, graph)
    graph.graph.inbound_from(number(13), t0)
    num = number(13)
    post(wa, payloads.inbound(pni, num, "wamid.R1", text="Hello", name="Sita", timestamp=ts(t0)))
    lead = next(c["lead_id"] for c in wa.get(url(t, "/conversations"), headers=bearer(owner)).json()["conversations"] if c["name"] == "Sita")
    graph.graph.fail(num, 429, 130429)
    mid = uid()
    r = wa.post(url(t, "/outbox/messages"), json={"message_id": mid, "lead_id": lead, "text": "Welcome to our shop, Sita.", "language": "en", "category": "info"}, headers=bearer(owner))
    assert r.json()["dispatched"]["retry_later"] == 1 and r.json()["message"]["status"] == "queued", r.text
    pin(t0 + timedelta(minutes=3), graph)  # the claim has lapsed
    again = wa.post(url(t, "/outbox/dispatch"), headers=bearer(owner))
    assert again.json()["sent"] == 1, again.text
    assert len([m for m in graph.graph.sent if m["to"] == num]) == 1


# ============================================================================ roles and isolation
def test_the_inbox_and_the_account_are_for_the_right_roles(wa: TestClient, stack: Stack, world: World, pni: str) -> None:
    a, b = world.a, world.b
    assert wa.get(url(a, "/conversations"), headers=bearer(a.users["viewer"])).status_code == 403
    assert wa.get(url(a, "/conversations"), headers=bearer(b.users["owner"])).status_code == 404
    assert wa.get(url(a, "/whatsapp/account"), headers=bearer(a.users["sales"])).status_code == 403
    assert wa.put(url(a, "/whatsapp/account"), json={"waba_id": "200000000000009", "phone_number_id": "100000000000009", "coexistence": False, "token_ref": "x"}, headers={"Authorization": f"Bearer {aal1_token(stack, a.users['owner'])}"}).status_code == 403
    got = wa.get(url(a, "/whatsapp/account"), headers=bearer(a.users["owner"])).json()
    assert got["status"] == "active" and got["token_available"] is True and "fake-token" not in json.dumps(got)
    # business B cannot take A's number, and sees none of A's conversations
    taken = wa.put(url(b, "/whatsapp/account"), json={"waba_id": "200000000000002", "phone_number_id": pni, "coexistence": False, "token_ref": "shop_a"}, headers=bearer(b.users["owner"]))
    assert taken.status_code == 409, taken.text
    assert wa.get(url(b, "/conversations"), headers=bearer(b.users["owner"])).json()["conversations"] == []


def test_a_message_to_an_unknown_number_or_from_a_real_number_stores_nothing(wa: TestClient, pni: str) -> None:
    unknown = post(wa, payloads.inbound("999999999999999", number(50), "wamid.U1"))
    assert unknown.json()["ignored"] == 1 and unknown.json()["stored"] == 0
    real = post(wa, payloads.inbound(pni, "919876543210", "wamid.U2"))
    assert real.json()["ignored"] == 1, "the real-data gate is closed: a real number is not stored"
    assert operator_sql.sql("select count(*) from public.contacts where phone = '+919876543210'") == "0"
    assert operator_sql.sql("select count(*) from integrations.wa_events where external_id = 'wamid.U2'") == "0"
