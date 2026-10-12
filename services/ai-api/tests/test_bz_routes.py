"""Job BZ (ADR 0080): the connectors' routes and webhooks against fakes: who may call what, that the workspace the credentials belong to is the only one that reaches them, what is sent to the database
and with whose token, that a webhook is believed only through its signature or its secret, and that nothing records money but a person. The real rules are pgTAP 84 and
tests/integration/test_bz_connectors.py."""

from __future__ import annotations

import hashlib
import hmac
import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.connectors.calls import FakeBridge
from app.connectors.errors import ConnectorRefused, ProviderError
from app.connectors.indiamart import ExternalLead, FixtureLeadSource
from app.connectors.payments import FakePayments
from app.connectors.runtime import Connectors
from app.crm.repository import DuplicateValueError, RealDataGateError
from app.scheduler.session import SignInError
from app.tenancy.repository import UpstreamError
from tests.enquiries_fakes import FakeEnquiries
from tests.fakes import TENANT_A, TENANT_B, FakeCrmRepository, auth, make_client
from tests.orders_fakes import LEAD, ORDER, FakeOrders
from tests.outbox_fakes import FakeOutbox

T = TENANT_A.id
BASE = f"/v1/tenants/{T}"
TOKEN = "X" * 32


class FakeRepo:
    """The connectors' database: scripted answers by function name, every call recorded with the token that made it."""

    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, Any]]] = []
        self.answers: dict[str, Any] = {}
        self.errors: dict[str, Exception] = {}

    def call(self, token: str, function: str, args: dict[str, Any]) -> Any:
        self.calls.append((function, token, args))
        if function in self.errors:
            raise self.errors[function]
        answer = self.answers.get(function)
        return answer(args) if callable(answer) else answer

    def names(self) -> list[str]:
        return [c[0] for c in self.calls]

    def args(self, function: str) -> dict[str, Any]:
        return next(c[2] for c in self.calls if c[0] == function)


class FakeSession:
    def __init__(self, fail: bool = False) -> None:
        self.fail = fail

    def token(self) -> str:
        if self.fail:
            raise SignInError("no")
        return "worker-token"


def link_row(status: str = "created", **over: Any) -> dict[str, Any]:
    now = datetime.now(UTC)
    row: dict[str, Any] = {
        "id": str(uuid.UUID(int=0x11)),
        "order_id": str(ORDER),
        "provider": "fake",
        "reference": "pl_" + "11".rjust(32, "0"),
        "amount_paise": 40000,
        "status": status,
        "url": "https://pay.example-upi.test/pl_1" if status != "pending" else None,
        "expires_at": (now + timedelta(days=3)).isoformat(),
        "created_at": now.isoformat(),
        "paid_amount_paise": 40000 if status in ("paid", "recorded", "mismatch") else None,
        "paid_at": now.isoformat() if status in ("paid", "recorded", "mismatch") else None,
        "recorded_at": now.isoformat() if status == "recorded" else None,
    }
    row.update(over)
    return row


def build(**kw: Any) -> tuple[Any, FakeRepo, dict[str, Any]]:
    repo = FakeRepo()
    parts: dict[str, Any] = {
        "crm": FakeCrmRepository(),
        "enquiries": FakeEnquiries(),
        "orders": FakeOrders(T),
        "outbox": FakeOutbox(),
    }
    connectors = Connectors(
        repo=repo,
        tenant_id=T,
        leads=kw.pop("leads", FixtureLeadSource()),
        payments=kw.pop("payments", FakePayments()),
        calls=kw.pop("calls", FakeBridge()),
        receiver=kw.pop("receiver", FakeSession()),
        agent_number="+910000000000",
        webhook_token=TOKEN,
        public_base_url="https://api.example.test",
        reply_language="en",
    )
    parts.update(kw)
    client, _ = make_client(connectors=connectors, **parts)
    return client, repo, {"connectors": connectors, **parts}


# ---------------------------------------------------------------------------------------------- the workspace the credentials belong to
def test_status_for_the_bound_workspace_only() -> None:
    client, repo, _ = build()
    repo.answers["connectors_status"] = {"indiamart_last_end": None, "indiamart_last_count": None, "open_links": 2, "paid_to_record": 1, "missed_calls_waiting": 3}
    ok = client.get(f"{BASE}/connectors/status", headers=auth("a_owner"))
    assert ok.status_code == 200
    body = ok.json()
    assert body["payments"] == {"enabled": True, "provider": "fake", "open_links": 2, "paid_to_record": 1}
    assert body["calls"]["missed_calls_waiting"] == 3 and body["indiamart"]["enabled"] is True
    assert client.get(f"/v1/tenants/{TENANT_B.id}/connectors/status", headers=auth("b_owner")).status_code == 404, "another workspace never reaches this installation's credentials"
    assert client.get(f"{BASE}/connectors/status", headers=auth("a_sales")).status_code == 403


def test_without_connectors_everything_is_a_404() -> None:
    client, _ = make_client()
    for method, path in (("GET", "/connectors/status"), ("POST", "/connectors/indiamart/pull"), ("GET", f"/orders/{ORDER}/payment-links"), ("GET", "/missed-calls")):
        assert client.request(method, f"{BASE}{path}", headers=auth("a_owner")).status_code == 404, path


def test_a_connector_that_is_not_switched_on_is_a_503() -> None:
    client, _, _ = build(payments=None, calls=None, leads=None)
    assert client.post(f"{BASE}/connectors/indiamart/pull", headers=auth("a_owner")).status_code == 503
    assert client.get(f"{BASE}/orders/{ORDER}/payment-links", headers=auth("a_owner")).status_code == 503
    assert client.get(f"{BASE}/missed-calls", headers=auth("a_owner")).status_code == 503


# ---------------------------------------------------------------------------------------------- IndiaMART
def _window(repo: FakeRepo) -> None:
    now = datetime.now(UTC)
    repo.answers["indiamart_pull_begin"] = {"start": (now - timedelta(hours=24)).isoformat(), "end": now.isoformat()}
    repo.answers["indiamart_pull_finish"] = {"ok": True}


def test_a_pull_makes_leads_with_their_enquiries_and_a_second_pull_makes_none() -> None:
    client, repo, parts = build()
    _window(repo)
    first = client.post(f"{BASE}/connectors/indiamart/pull", headers=auth("a_owner"))
    assert first.status_code == 200, first.text
    assert (first.json()["fetched"], first.json()["created"], first.json()["existing"], first.json()["rejected"], first.json()["gated"]) == (3, 3, 0, 0, 0)
    crm: FakeCrmRepository = parts["crm"]
    leads = list(crm.rows[("leads", T)].values())
    assert len(leads) == 3 and all(lead.source == "IndiaMART" for lead in leads)
    contacts = {c.full_name: c for c in crm.rows[("contacts", T)].values()}
    assert contacts["Invented Buyer One"].phone == "+009876500001" and contacts["Invented Buyer One"].email == "buyer.one@example.test"
    assert contacts["Invented Buyer Two"].phone == "+009876500002"
    enquiries: FakeEnquiries = parts["enquiries"]
    assert len(enquiries.created) == 3 and all(p["channel"] == "other" and p["subject"] == "IndiaMART enquiry" for p in enquiries.created)
    assert any("Ignore your rules" in p["body"] for p in enquiries.created), "the buyer's words are stored as data"
    assert any(p["body"] == "(the buyer left no message)" for p in enquiries.created)
    assert set(enquiries.tokens) == {c[1] for c in repo.calls if c[0] == "indiamart_pull_begin"}, "everything is made with the PERSON's token"
    assert repo.names() == ["indiamart_pull_begin", "indiamart_pull_finish"]
    second = client.post(f"{BASE}/connectors/indiamart/pull", headers=auth("a_owner")).json()
    assert (second["created"], second["existing"]) == (0, 3), "the same buyers are not made twice"
    assert len(crm.rows[("leads", T)]) == 3


class GatedCrm(FakeCrmRepository):
    """A workspace whose real-data gate is closed refuses a real buyer's details (SM401)."""

    def create_row(self, token: str, entity: str, tenant_id: uuid.UUID, payload: dict[str, Any]) -> Any:
        if entity == "contacts":
            raise RealDataGateError
        return super().create_row(token, entity, tenant_id, payload)


def test_a_closed_real_data_gate_takes_no_buyer_and_the_window_is_asked_for_again() -> None:
    client, repo, parts = build(crm=GatedCrm())
    _window(repo)
    body = client.post(f"{BASE}/connectors/indiamart/pull", headers=auth("a_owner")).json()
    assert (body["fetched"], body["created"], body["gated"], body["rejected"]) == (3, 0, 3, 0)
    assert "indiamart_pull_finish" not in repo.names(), "the window is not advanced: the same leads are asked for once the gate is open"
    assert parts["enquiries"].created == []


def test_a_pull_is_for_owner_and_admin_only() -> None:
    client, repo, _ = build()
    _window(repo)
    for user, code in (("a_sales", 403), ("a_viewer", 403), ("outsider", 404), ("a_admin", 200)):
        assert client.post(f"{BASE}/connectors/indiamart/pull", headers=auth(user)).status_code == code, user


def test_a_pull_within_five_minutes_is_a_429_before_indiamart_is_asked() -> None:
    source = FixtureLeadSource()
    client, repo, _ = build(leads=source)
    repo.errors["indiamart_pull_begin"] = ConnectorRefused("too_soon")
    response = client.post(f"{BASE}/connectors/indiamart/pull", headers=auth("a_owner"))
    assert response.status_code == 429 and response.json()["error"]["code"] == "asked_too_soon"
    assert source.calls == []


class _Failing:
    def pull(self, start: datetime, end: datetime) -> list[ExternalLead]:
        raise ProviderError("rate_limited")


def test_an_indiamart_failure_is_a_closed_502_and_the_window_is_not_advanced() -> None:
    client, repo, _ = build(leads=_Failing())
    _window(repo)
    response = client.post(f"{BASE}/connectors/indiamart/pull", headers=auth("a_owner"))
    assert response.status_code == 502 and response.json()["error"]["code"] == "indiamart_rate_limited"
    assert "indiamart_pull_finish" not in repo.names()


class UniqueEmailCrm(FakeCrmRepository):
    """The real database allows one contact per e-mail address in a business (contacts_tenant_email_key)."""

    def create_row(self, token: str, entity: str, tenant_id: uuid.UUID, payload: dict[str, Any]) -> Any:
        if entity == "contacts" and payload.get("email") and any(c.email == payload["email"] for c in self.rows.get(("contacts", tenant_id), {}).values()):
            raise DuplicateValueError("email")
        return super().create_row(token, entity, tenant_id, payload)


def test_two_buyers_with_one_email_address_both_come_in() -> None:
    leads = [
        ExternalLead("SAME-0001", "W", "First Buyer", "+91 98765 11111", "shared@example.test", "IN", "one", datetime.now(UTC) - timedelta(hours=2)),
        ExternalLead("SAME-0002", "W", "Second Buyer", "+91 98765 22222", "shared@example.test", "IN", "two", datetime.now(UTC) - timedelta(hours=1)),
    ]
    client, repo, parts = build(leads=FixtureLeadSource(leads), crm=UniqueEmailCrm())
    _window(repo)
    body = client.post(f"{BASE}/connectors/indiamart/pull", headers=auth("a_owner")).json()
    assert body["created"] == 2 and body["rejected"] == 0
    contacts = {c.full_name: c for c in parts["crm"].rows[("contacts", T)].values()}
    assert contacts["First Buyer"].email == "shared@example.test" and contacts["Second Buyer"].email is None and contacts["Second Buyer"].phone == "+919876522222"


# ---------------------------------------------------------------------------------------------- payment links
def test_a_payment_link_is_begun_made_at_the_provider_and_attached() -> None:
    provider = FakePayments()
    client, repo, parts = build(payments=provider)
    link_id = uuid.UUID(int=0x11)
    repo.answers["payment_link_begin"] = lambda a: {"link": link_row("pending", reference="pl_" + "11".rjust(32, "0"), expires_at=a["p_expires_at"]), "replayed": False}
    repo.answers["payment_link_attach"] = lambda a: link_row("created", url=a["p_url"])
    response = client.post(f"{BASE}/orders/{ORDER}/payment-links", json={"id": str(link_id), "amount_paise": 40000}, headers=auth("a_owner"))
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "created" and response.json()["url"].startswith("https://pay.example-upi.test/")
    begin = repo.args("payment_link_begin")
    assert begin["p_provider"] == "fake" and begin["p_amount_paise"] == 40000 and begin["p_order_id"] == str(ORDER)
    assert provider.created[0].amount_paise == 40000 and provider.created[0].description.startswith("Order 1 - ")
    assert repo.names() == ["payment_link_begin", "payment_link_attach"]
    assert {c[1] for c in repo.calls} == {repo.calls[0][1]}, "one person's token throughout"


def test_a_replay_of_a_link_that_has_its_address_asks_the_provider_nothing() -> None:
    provider = FakePayments()
    client, repo, _ = build(payments=provider)
    repo.answers["payment_link_begin"] = {"link": link_row("created"), "replayed": True}
    response = client.post(f"{BASE}/orders/{ORDER}/payment-links", json={"id": str(uuid.UUID(int=0x11)), "amount_paise": 40000}, headers=auth("a_owner"))
    assert response.status_code == 200 and provider.created == [] and repo.names() == ["payment_link_begin"]


class _RefusingPayments(FakePayments):
    def create_link(self, request: Any, idempotency_key: str) -> Any:
        raise ProviderError("rejected")


def test_a_provider_refusal_kills_the_pending_link_and_tells_the_person_plainly() -> None:
    client, repo, _ = build(payments=_RefusingPayments())
    repo.answers["payment_link_begin"] = {"link": link_row("pending"), "replayed": False}
    repo.answers["payment_link_fail"] = link_row("failed")
    response = client.post(f"{BASE}/orders/{ORDER}/payment-links", json={"id": str(uuid.UUID(int=0x11)), "amount_paise": 40000}, headers=auth("a_owner"))
    assert response.status_code == 502 and response.json()["error"]["code"] == "payment_provider_failed"
    assert "Nothing was sent" in response.json()["error"]["message"] and repo.names() == ["payment_link_begin", "payment_link_fail"]


@pytest.mark.parametrize(
    ("body", "code"),
    [({"amount_paise": 40000}, 422), ({"id": str(uuid.UUID(int=0x11)), "amount_paise": 99}, 422), ({"id": str(uuid.UUID(int=0x11)), "amount_paise": 40000, "valid_for_hours": 0}, 422), ({"id": str(uuid.UUID(int=0x11)), "amount_paise": 40000, "valid_for_hours": 721}, 422), ({"id": str(uuid.UUID(int=0x11)), "amount_paise": 40000.5}, 422), ({"id": str(uuid.UUID(int=0x11)), "amount_paise": 40000, "upi": "x@y"}, 422)],
)
def test_bad_link_requests_are_refused_before_anything_happens(body: dict[str, Any], code: int) -> None:
    client, repo, _ = build()
    assert client.post(f"{BASE}/orders/{ORDER}/payment-links", json=body, headers=auth("a_owner")).status_code == code
    assert repo.calls == []


def test_only_owner_and_admin_make_a_link_and_the_database_refusals_have_plain_words() -> None:
    client, repo, _ = build()
    body = {"id": str(uuid.UUID(int=0x11)), "amount_paise": 40000}
    for user, code in (("a_sales", 403), ("a_viewer", 403), ("outsider", 404)):
        assert client.post(f"{BASE}/orders/{ORDER}/payment-links", json=body, headers=auth(user)).status_code == code
    for kind, status, name in (("open_link", 409, "open_payment_link"), ("state", 409, "not_in_a_state_for_this"), ("invalid", 422, "validation_error"), ("reference", 404, "not_found")):
        repo.errors["payment_link_begin"] = ConnectorRefused(kind)
        response = client.post(f"{BASE}/orders/{ORDER}/payment-links", json=body, headers=auth("a_owner"))
        assert (response.status_code, response.json()["error"]["code"]) == (status, name)


def test_the_links_of_an_order_are_listed_for_sales_too() -> None:
    client, repo, _ = build()
    repo.answers["payment_link_list"] = [link_row("created"), link_row("expired", id=str(uuid.UUID(int=0x12)))]
    assert [x["status"] for x in client.get(f"{BASE}/orders/{ORDER}/payment-links", headers=auth("a_sales")).json()] == ["created", "expired"]
    assert client.get(f"{BASE}/orders/{ORDER}/payment-links", headers=auth("a_viewer")).status_code == 403


def test_the_link_is_queued_as_a_whatsapp_message_that_waits_for_a_person() -> None:
    client, repo, parts = build()
    repo.answers["payment_link_get"] = link_row("created")
    outbox: FakeOutbox = parts["outbox"]
    outbox.submit_answer = {"replayed": False, "status": "needs_approval"}
    message = uuid.UUID(int=0x22)
    response = client.post(f"{BASE}/payment-links/{uuid.UUID(int=0x11)}/send", json={"message_id": str(message), "language": "hi"}, headers=auth("a_sales"))
    assert response.status_code == 200 and response.json() == {"message_id": str(message), "status": "needs_approval", "replayed": False}
    args = outbox.calls[0][2]
    assert args["p_channel"] == "whatsapp" and args["p_category"] == "order_status" and args["p_language"] == "hi" and args["p_lead_id"] == str(LEAD)
    assert "₹400.00" in args["p_body"] and "https://pay.example-upi.test/pl_1" in args["p_body"] and "#1" in args["p_body"]
    assert args["p_keep_record"] is True


def test_only_an_open_link_can_be_sent() -> None:
    client, repo, parts = build()
    for status in ("pending", "paid", "expired", "recorded", "failed"):
        repo.answers["payment_link_get"] = link_row(status)
        response = client.post(f"{BASE}/payment-links/{uuid.UUID(int=0x11)}/send", json={"message_id": str(uuid.uuid4())}, headers=auth("a_owner"))
        assert response.status_code == 409, status
    assert parts["outbox"].calls == []
    assert client.post(f"{BASE}/payment-links/{uuid.UUID(int=0x11)}/send", json={"message_id": str(uuid.uuid4()), "language": "fr"}, headers=auth("a_owner")).status_code == 422


def test_a_person_records_the_payment_through_the_order_lifecycle() -> None:
    client, repo, parts = build()
    repo.answers["payment_link_get"] = link_row("paid")
    repo.answers["payment_link_mark_recorded"] = link_row("recorded")
    response = client.post(f"{BASE}/payment-links/{uuid.UUID(int=0x11)}/record", headers=auth("a_sales"))
    assert response.status_code == 200, response.text
    assert response.json()["link"]["status"] == "recorded"
    orders: FakeOrders = parts["orders"]
    event = next(c[1] for c in orders.calls if c[0] == "record_event")
    link_id = uuid.UUID(int=0x11)
    assert event["p_type"] == "record_payment" and event["p_amount_paise"] == 40000
    assert event["p_event_id"] == str(uuid.uuid5(link_id, "record_payment-event")) and event["p_ledger_id"] == str(uuid.uuid5(link_id, "record_payment-ledger"))
    assert repo.args("payment_link_mark_recorded")["p_event_id"] == event["p_event_id"]
    # the same call again uses the same ids: nothing is recorded twice
    client.post(f"{BASE}/payment-links/{uuid.UUID(int=0x11)}/record", headers=auth("a_sales"))
    ids = [c[1]["p_event_id"] for c in orders.calls if c[0] == "record_event"]
    assert ids[0] == ids[1]


def test_only_a_paid_link_is_recorded_and_a_mismatch_is_left_to_a_person() -> None:
    client, repo, parts = build()
    for status in ("created", "pending", "mismatch", "expired", "failed"):
        repo.answers["payment_link_get"] = link_row(status)
        assert client.post(f"{BASE}/payment-links/{uuid.UUID(int=0x11)}/record", headers=auth("a_owner")).status_code == 409, status
    assert not [c for c in parts["orders"].calls if c[0] == "record_event"]
    assert client.post(f"{BASE}/payment-links/{uuid.UUID(int=0x11)}/record", headers=auth("a_viewer")).status_code == 403


# ---------------------------------------------------------------------------------------------- missed calls and the bridge
def test_missed_calls_are_listed_and_handled() -> None:
    client, repo, _ = build()
    row = {"id": str(uuid.UUID(int=5)), "received_at": datetime.now(UTC).isoformat(), "outcome": "needs_owner", "caller_last4": "0101", "phone": "12025550101", "contact_id": None, "lead_id": None, "contact_name": None, "handled_at": None}
    repo.answers["missed_call_list"] = [row]
    repo.answers["missed_call_handle"] = {"id": row["id"], "handled": True}
    listed = client.get(f"{BASE}/missed-calls", headers=auth("a_sales")).json()
    assert listed[0]["phone"] == "12025550101" and "handled_at" not in listed[0]
    assert client.post(f"{BASE}/missed-calls/{row['id']}/handle", headers=auth("a_sales")).json() == {"id": row["id"], "handled": True}
    assert client.get(f"{BASE}/missed-calls", headers=auth("a_viewer")).status_code == 403
    assert client.post(f"{BASE}/missed-calls/not-a-uuid/handle", headers=auth("a_owner")).status_code == 404


def test_an_approved_call_is_placed_once_with_the_shops_phone_ringing_first() -> None:
    bridge = FakeBridge()
    client, repo, _ = build(calls=bridge)
    bridge_id = uuid.UUID(int=0x33)
    repo.answers["call_bridge_prepare"] = {"bridge_id": str(bridge_id), "status": "starting", "replayed": False, "to_number": "+919876543210"}
    repo.answers["call_bridge_finish"] = lambda a: {"bridge_id": a["p_bridge_id"], "status": a["p_status"]}
    response = client.post(f"{BASE}/call-requests/{uuid.UUID(int=0x44)}/connect", headers=auth("a_owner"))
    assert response.status_code == 200 and response.json() == {"bridge_id": str(bridge_id), "status": "queued", "replayed": False}
    assert bridge.calls == [("+910000000000", "+919876543210", str(bridge_id))]
    assert repo.args("call_bridge_finish")["p_provider_call_id"] == bridge.sids[0]
    assert "+919876543210" not in json.dumps([c[2] for c in repo.calls if c[0] == "call_bridge_finish"])


def test_a_number_a_telephone_cannot_ring_fails_the_bridge_and_places_nothing() -> None:
    bridge = FakeBridge()
    client, repo, _ = build(calls=bridge)
    repo.answers["call_bridge_prepare"] = {"bridge_id": str(uuid.UUID(int=0x33)), "status": "starting", "replayed": False, "to_number": "12-34"}
    repo.answers["call_bridge_finish"] = {"status": "failed"}
    response = client.post(f"{BASE}/call-requests/{uuid.UUID(int=0x44)}/connect", headers=auth("a_owner"))
    assert response.status_code == 422 and response.json()["error"]["code"] == "customer_phone_unusable" and bridge.calls == []
    assert repo.args("call_bridge_finish")["p_status"] == "failed"


def test_a_repeat_places_no_second_call() -> None:
    bridge = FakeBridge()
    client, repo, _ = build(calls=bridge)
    repo.answers["call_bridge_prepare"] = {"bridge_id": str(uuid.UUID(int=0x33)), "status": "completed", "replayed": True, "to_number": None}
    response = client.post(f"{BASE}/call-requests/{uuid.UUID(int=0x44)}/connect", headers=auth("a_owner"))
    assert response.status_code == 200 and response.json()["replayed"] is True and bridge.calls == [] and "call_bridge_finish" not in repo.names()


class _FailingBridge(FakeBridge):
    def connect(self, from_number: str, to_number: str, custom_field: str, status_callback: str | None) -> tuple[str, str]:
        raise ProviderError("unavailable")


def test_a_provider_failure_marks_the_bridge_failed() -> None:
    client, repo, _ = build(calls=_FailingBridge())
    repo.answers["call_bridge_prepare"] = {"bridge_id": str(uuid.UUID(int=0x33)), "status": "starting", "replayed": False, "to_number": "+919876543210"}
    repo.answers["call_bridge_finish"] = {"status": "failed"}
    response = client.post(f"{BASE}/call-requests/{uuid.UUID(int=0x44)}/connect", headers=auth("a_owner"))
    assert response.status_code == 502 and response.json()["error"]["code"] == "call_provider_failed"
    assert repo.args("call_bridge_finish")["p_status"] == "failed"


def test_the_calling_hours_and_the_state_of_the_request_have_plain_refusals() -> None:
    client, repo, _ = build()
    for kind, status, name in (("hours", 409, "outside_calling_hours"), ("state", 409, "not_in_a_state_for_this"), ("deny", 403, "forbidden")):
        repo.errors["call_bridge_prepare"] = ConnectorRefused(kind)
        response = client.post(f"{BASE}/call-requests/{uuid.UUID(int=0x44)}/connect", headers=auth("a_owner"))
        assert (response.status_code, response.json()["error"]["code"]) == (status, name)
    assert client.post(f"{BASE}/call-requests/{uuid.UUID(int=0x44)}/connect", headers=auth("a_sales")).status_code == 403


# ---------------------------------------------------------------------------------------------- the webhooks
def _paid_body() -> dict[str, Any]:
    return {"event": "payment_link.paid", "payload": {"payment_link": {"entity": {"id": "fake_abc", "reference_id": "pl_" + "11".rjust(32, "0"), "amount": 40000, "amount_paid": 40000, "status": "paid"}}, "payment": {"entity": {"id": "pay_1", "amount": 40000}}}}


def test_a_signed_payment_message_reaches_the_database_through_the_worker() -> None:
    client, repo, _ = build()
    repo.answers["scheduler_payment_event"] = {"outcome": "paid"}
    raw, headers = FakePayments.signed(_paid_body())
    response = client.post("/v1/webhooks/fake-payments", content=raw, headers=headers)
    assert response.status_code == 200 and response.json() == {"ok": True}
    name, token, args = repo.calls[0]
    assert (name, token) == ("scheduler_payment_event", "worker-token")
    assert args["p_provider"] == "fake" and args["p_status"] == "paid" and args["p_amount_paise"] == 40000 and args["p_provider_link_id"] == "fake_abc" and args["p_payment_ref"] == "pay_1"
    assert args["p_event_id"].startswith("razorpay:") and len(args["p_event_id"]) > 20


def test_a_bad_or_missing_signature_is_a_plain_401_and_the_database_is_not_touched() -> None:
    client, repo, _ = build()
    raw, headers = FakePayments.signed(_paid_body())
    for h in ({}, {"x-razorpay-signature": "0" * 64}, {"x-razorpay-signature": headers["x-razorpay-signature"][:-1] + ("0" if headers["x-razorpay-signature"][-1] != "0" else "1")}):
        response = client.post("/v1/webhooks/fake-payments", content=raw, headers=h)
        assert response.status_code == 401 and response.json()["error"]["code"] == "unauthorized"
    assert client.post("/v1/webhooks/fake-payments", content=raw + b" ", headers=headers).status_code == 401
    assert repo.calls == []


def test_a_signed_message_about_something_else_is_ok_and_ignored() -> None:
    client, repo, _ = build()
    raw, headers = FakePayments.signed({"event": "payment.captured", "payload": {}})
    assert client.post("/v1/webhooks/fake-payments", content=raw, headers=headers).status_code == 200 and repo.calls == []


def test_the_provider_that_is_not_configured_has_no_webhook() -> None:
    client, repo, _ = build()
    raw, headers = FakePayments.signed(_paid_body())
    assert client.post("/v1/webhooks/razorpay", content=raw, headers=headers).status_code == 404
    assert client.post("/v1/webhooks/cashfree", content=raw, headers=headers).status_code == 404
    plain, _ = make_client()
    assert plain.post("/v1/webhooks/fake-payments", content=raw, headers=headers).status_code == 404


def test_when_our_side_fails_the_provider_is_told_to_retry_and_when_the_message_is_unusable_it_is_not() -> None:
    client, repo, _ = build(receiver=FakeSession(fail=True))
    raw, headers = FakePayments.signed(_paid_body())
    assert client.post("/v1/webhooks/fake-payments", content=raw, headers=headers).status_code == 503
    client, repo, _ = build(receiver=None)
    assert client.post("/v1/webhooks/fake-payments", content=raw, headers=headers).status_code == 503
    client, repo, _ = build()
    repo.errors["scheduler_payment_event"] = UpstreamError("down")
    assert client.post("/v1/webhooks/fake-payments", content=raw, headers=headers).status_code == 503
    repo.errors["scheduler_payment_event"] = ConnectorRefused("invalid")
    assert client.post("/v1/webhooks/fake-payments", content=raw, headers=headers).status_code == 200


def test_a_huge_body_is_refused() -> None:
    client, repo, _ = build()
    assert client.post("/v1/webhooks/fake-payments", content=b"x" * 70_000, headers={"x-razorpay-signature": "0"}).status_code == 413
    assert repo.calls == []


def test_the_missed_call_webhook_needs_its_secret() -> None:
    client, repo, _ = build()
    params = {"CallSid": "abc12345", "CallFrom": "09876543210", "CallTo": "08012345678", "Direction": "incoming"}
    assert client.get(f"/v1/webhooks/exotel/{'Y' * 32}/missed-call", params=params).status_code == 404
    assert client.get("/v1/webhooks/exotel/short/missed-call", params=params).status_code == 404
    assert repo.calls == []
    no_calls, repo2, _ = build(calls=None)
    assert no_calls.get(f"/v1/webhooks/exotel/{TOKEN}/missed-call", params=params).status_code == 404 and repo2.calls == []


def test_a_missed_call_reaches_the_database_with_a_fixed_reply_in_every_request_shape() -> None:
    for how in ("get", "form", "json"):
        client, repo, _ = build()
        repo.answers["scheduler_missed_call"] = {"outcome": "needs_owner"}
        params = {"CallSid": "abc12345", "CallFrom": "09876543210", "CallTo": "08012345678", "Direction": "incoming", "CurrentTime": "2026-10-12 10:00:00"}
        url = f"/v1/webhooks/exotel/{TOKEN}/missed-call"
        response = client.get(url, params=params) if how == "get" else client.post(url, data=params) if how == "form" else client.post(url, json=params)
        assert response.status_code == 200, how
        name, token, args = repo.calls[0]
        assert (name, token) == ("scheduler_missed_call", "worker-token")
        assert args["p_tenant_id"] == str(T) and args["p_provider"] == "fake" and args["p_call_id"] == "abc12345" and args["p_phone"] == "09876543210"
        assert args["p_language"] == "en" and "Thank you for calling" in args["p_body"] and args["p_message_id"] == str(uuid.uuid5(uuid.UUID("9b0f3d2e-4a52-4c63-8d3f-2e7f4b1c6a10"), "missed:abc12345"))


def test_an_outgoing_or_unusable_call_is_ignored() -> None:
    client, repo, _ = build()
    url = f"/v1/webhooks/exotel/{TOKEN}/missed-call"
    assert client.get(url, params={"CallSid": "abc12345", "CallFrom": "09876543210", "Direction": "outbound-api"}).status_code == 200
    assert client.get(url, params={"CallSid": "x", "CallFrom": "1"}).status_code == 200
    assert client.get(url).status_code == 200
    assert repo.calls == []


def test_the_call_status_webhook() -> None:
    client, repo, _ = build()
    repo.answers["scheduler_call_status"] = {"outcome": "updated"}
    url = f"/v1/webhooks/exotel/{TOKEN}/call-status"
    assert client.post(url, json={"CallSid": "abc12345", "Status": "completed", "CustomField": "x"}).status_code == 200
    assert repo.args("scheduler_call_status") == {"p_provider": "fake", "p_provider_call_id": "abc12345", "p_status": "completed"}
    assert client.post(url, json={"CallSid": "abc12345", "Status": "mystery"}).status_code == 200
    assert len(repo.calls) == 1
    assert client.post(f"/v1/webhooks/exotel/{'Z' * 32}/call-status", json={"CallSid": "abc12345", "Status": "completed"}).status_code == 404
    assert client.post(url, content=b"{not json", headers={"content-type": "application/json"}).status_code == 400


def test_secrets_never_appear_in_an_access_log_line() -> None:
    from app.logging_safety import redact_path

    assert TOKEN not in redact_path(f"/v1/webhooks/exotel/{TOKEN}/missed-call")
    assert redact_path(f"/v1/tenants/{T}/payment-links/{uuid.UUID(int=0x11)}/send") == f"/v1/tenants/{T}/payment-links/{uuid.UUID(int=0x11)}/send"
    assert hmac and hashlib  # (imports kept for readers who extend these tests with signatures)
