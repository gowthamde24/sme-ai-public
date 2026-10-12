"""Job BZ (ADR 0080): the connectors' provider adapters against recorded-shape fake servers (httpx.MockTransport), their signatures and refusals, the phone and text hygiene, and the wiring from settings.
No network, no key, no database."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import pytest
from pydantic import SecretStr

from app.config import ConfigurationError, Settings
from app.connectors import calls, phone
from app.connectors.errors import ProviderError, WebhookRejected
from app.connectors.indiamart import (
    ExternalLead,
    FixtureLeadSource,
    IndiaMartPull,
    lead_of,
    provider_time,
)
from app.connectors.payments import (
    FAKE_SECRET,
    CashfreePayments,
    FakePayments,
    LinkRequest,
    RazorpayPayments,
)
from app.connectors.wiring import build_connectors

KEY = "crm-key-do-not-log-0123456789abcdef"
TENANT = "00000000-0000-0000-0000-00000000000a"


def _client(handler: Any) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler))


def _settings(**kw: Any) -> Settings:
    return Settings(_env_file=None, **kw)  # type: ignore[call-arg]


# ---------------------------------------------------------------------------------------------- phone numbers
@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("+91-98765 43210", "+919876543210"),
        ("09876543210", "+919876543210"),
        ("9876543210", "+919876543210"),
        ("919876543210", "+919876543210"),
        ("+1 202 555 0101", "+12025550101"),
        ("12345", None),
        ("5876543210", None),  # an Indian mobile starts with 6, 7, 8 or 9
        ("", None),
        (None, None),
        (9876543210, None),
    ],
)
def test_phone_numbers(raw: object, expected: str | None) -> None:
    assert phone.normalise(raw) == expected


def test_last4() -> None:
    assert phone.last4("+91 98765 43210") == "3210" and phone.last4("12") == "" and phone.last4(None) == ""


# ---------------------------------------------------------------------------------------------- IndiaMART
def _row(**over: Any) -> dict[str, Any]:
    row = {"UNIQUE_QUERY_ID": "2026101200001", "QUERY_TYPE": "W", "QUERY_TIME": "2026-10-12 09:30:00", "SENDER_NAME": "A Buyer", "SENDER_MOBILE": "+91-98765 43210", "SENDER_EMAIL": "a@x.test", "SENDER_COUNTRY_ISO": "IN", "QUERY_MESSAGE": "Need sarees"}
    row.update(over)
    return row


def test_provider_time_is_ist_without_a_space() -> None:
    assert provider_time(datetime(2026, 10, 12, 3, 30, tzinfo=UTC)) == "12-10-202609:00:00"


def test_indiamart_request_and_parsing() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"] = str(request.url.copy_with(query=None))
        seen["params"] = dict(request.url.params)
        return httpx.Response(200, json={"CODE": 200, "STATUS": "SUCCESS", "MESSAGE": "", "TOTAL_RECORDS": 3, "RESPONSE": [_row(), _row(), _row(UNIQUE_QUERY_ID="2026101200002", QUERY_TYPE="ZZ"), _row(UNIQUE_QUERY_ID="bad id!"), _row(UNIQUE_QUERY_ID="2026101200003", SENDER_MOBILE="", SENDER_EMAIL=None), "junk"]})

    source = IndiaMartPull(KEY, client=_client(handler))
    end = datetime(2026, 10, 12, 4, 0, tzinfo=UTC)
    leads = source.pull(end - timedelta(hours=1), end)
    assert seen["url"] == "https://mapi.indiamart.com/wservce/crm/crmListing/v2/"
    assert seen["params"] == {"glusr_crm_key": KEY, "start_time": "12-10-202608:30:00", "end_time": "12-10-202609:30:00"}
    assert [lead.external_id for lead in leads] == ["2026101200001", "2026101200002"], "a repeated id once; an unusable row (bad id, no way to reach the buyer) dropped"
    assert leads[1].kind == "W" and leads[0].phone == "+91-98765 43210" and leads[0].received_at == datetime(2026, 10, 12, 4, 0, tzinfo=UTC)
    assert KEY not in repr(source)


@pytest.mark.parametrize(
    ("body", "status", "code"),
    [
        ({"CODE": 401, "STATUS": "FAILURE"}, 200, "unauthorized"),
        ({"CODE": 429, "STATUS": "FAILURE"}, 200, "rate_limited"),
        ({"CODE": 400}, 200, "bad_window"),
        ({"CODE": 500}, 200, "unavailable"),
        ({"x": 1}, 429, "rate_limited"),
        ({"x": 1}, 401, "unauthorized"),
        ({"CODE": 200, "RESPONSE": "no"}, 200, "bad_response"),
    ],
)
def test_indiamart_errors(body: dict[str, Any], status: int, code: str) -> None:
    source = IndiaMartPull(KEY, client=_client(lambda r: httpx.Response(status, json=body)))
    with pytest.raises(ProviderError) as err:
        source.pull(datetime(2026, 10, 11, tzinfo=UTC), datetime(2026, 10, 12, tzinfo=UTC))
    assert err.value.code == code and KEY not in str(err.value)


def test_indiamart_204_is_no_leads_and_the_window_is_checked_before_the_call() -> None:
    calls_made: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls_made.append(1)
        return httpx.Response(200, json={"CODE": 204, "STATUS": "SUCCESS", "RESPONSE": []})

    source = IndiaMartPull(KEY, client=_client(handler))
    assert source.pull(datetime(2026, 10, 11, tzinfo=UTC), datetime(2026, 10, 12, tzinfo=UTC)) == []
    for start, end in ((datetime(2026, 10, 1, tzinfo=UTC), datetime(2026, 10, 12, tzinfo=UTC)), (datetime(2026, 10, 12, tzinfo=UTC), datetime(2026, 10, 12, tzinfo=UTC))):
        with pytest.raises(ProviderError) as err:
            source.pull(start, end)
        assert err.value.code == "bad_window"
    assert len(calls_made) == 1


def test_indiamart_key_never_reaches_a_log(caplog: pytest.LogCaptureFixture) -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError(f"cannot reach {request.url}")

    with caplog.at_level(logging.DEBUG):
        with pytest.raises(ProviderError):
            IndiaMartPull(KEY, client=_client(down)).pull(datetime(2026, 10, 11, tzinfo=UTC), datetime(2026, 10, 12, tzinfo=UTC))
    assert KEY not in " ".join(r.getMessage() for r in caplog.records)
    assert logging.getLogger("httpx").level >= logging.WARNING


def test_lead_of_refuses_the_unusable() -> None:
    assert lead_of(_row()) is not None
    assert lead_of(_row(UNIQUE_QUERY_ID=12345678)) is not None and lead_of(_row(UNIQUE_QUERY_ID=True)) is None
    assert lead_of(_row(UNIQUE_QUERY_ID="a/b")) is None and lead_of(_row(SENDER_MOBILE=None, SENDER_EMAIL=None)) is None
    assert lead_of(_row(SENDER_NAME=None)).name == "IndiaMART Buyer"  # type: ignore[union-attr]


def test_the_fixture_source_has_an_unreachable_free_of_instructions_buyer() -> None:
    fixture = FixtureLeadSource()
    leads = fixture.pull(datetime.now(UTC) - timedelta(days=1), datetime.now(UTC))
    assert len(leads) == 3 and any("Ignore your rules" in lead.message for lead in leads)
    assert fixture.calls


# ---------------------------------------------------------------------------------------------- Razorpay
def _req(**over: Any) -> LinkRequest:
    base: dict[str, Any] = {"reference": "pl_" + "ab" * 16, "amount_paise": 250000, "description": "Order 7 - Test Shop", "expires_at": datetime(2026, 10, 15, 12, 0, tzinfo=UTC), "customer_name": "A Buyer", "customer_phone": "+919876543210"}
    base.update(over)
    return LinkRequest(**base)


def test_razorpay_link_request_and_response() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["url"], seen["auth"], seen["body"] = str(request.url), request.headers.get("authorization"), json.loads(request.content)
        return httpx.Response(200, json={"id": "plink_Abc123", "short_url": "https://rzp.io/i/abc", "status": "created"})

    rzp = RazorpayPayments("rzp_test_id", "key-secret-xyz", "whsec", client=_client(handler))
    made = rzp.create_link(_req(), "idem-1")
    assert seen["url"] == "https://api.razorpay.com/v1/payment_links/"
    assert seen["auth"] == "Basic " + base64.b64encode(b"rzp_test_id:key-secret-xyz").decode()
    body = seen["body"]
    assert body["upi_link"] is True and body["amount"] == 250000 and body["currency"] == "INR" and body["reference_id"] == "pl_" + "ab" * 16
    assert body["expire_by"] == int(datetime(2026, 10, 15, 12, 0, tzinfo=UTC).timestamp())
    assert body["notify"] == {"sms": False, "email": False} and body["customer"] == {"name": "A Buyer", "contact": "+919876543210"}
    assert (made.provider_link_id, made.url) == ("plink_Abc123", "https://rzp.io/i/abc")
    assert "key-secret-xyz" not in repr(rzp) and "whsec" not in repr(rzp)


@pytest.mark.parametrize(("status", "code"), [(401, "unauthorized"), (400, "rejected"), (429, "rate_limited"), (502, "unavailable")])
def test_razorpay_errors(status: int, code: str) -> None:
    rzp = RazorpayPayments("i", "s", "w", client=_client(lambda r: httpx.Response(status, json={"error": {"description": "SECRET DETAIL"}})))
    with pytest.raises(ProviderError) as err:
        rzp.create_link(_req(), "k")
    assert err.value.code == code and "SECRET" not in str(err.value)


def test_razorpay_refuses_an_unsafe_answer() -> None:
    answer: Any
    for answer in ({"id": "plink_x", "short_url": "http://insecure.test/x"}, {"id": "bad id", "short_url": "https://x.test/y"}, {"short_url": "https://x.test/y"}, []):
        rzp = RazorpayPayments("i", "s", "w", client=_client(lambda r, a=answer: httpx.Response(200, json=a)))
        with pytest.raises(ProviderError) as err:
            rzp.create_link(_req(), "k")
        assert err.value.code == "bad_response"


def _rzp_body(event: str = "payment_link.paid", **over: Any) -> bytes:
    link = {"id": "plink_Abc123", "reference_id": "pl_" + "ab" * 16, "amount": 250000, "amount_paid": 250000, "status": "paid"}
    link.update(over)
    doc: dict[str, Any] = {"event": event, "payload": {"payment_link": {"entity": link}}}
    if event in ("payment_link.paid", "payment_link.partially_paid"):
        doc["payload"]["payment"] = {"entity": {"id": "pay_Xyz789", "amount": 250000, "status": "captured", "vpa": "someone@upi", "card": {"last4": "1234"}}}
    return json.dumps(doc).encode()


def _sign(secret: str, raw: bytes) -> dict[str, str]:
    return {"x-razorpay-signature": hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()}


def test_razorpay_webhook_paid() -> None:
    rzp = RazorpayPayments("i", "s", "whsec")
    raw = _rzp_body()
    event = rzp.verify_webhook(_sign("whsec", raw), raw)
    assert event is not None
    assert (event.provider_link_id, event.reference, event.status, event.amount_paise, event.payment_ref) == ("plink_Abc123", "pl_" + "ab" * 16, "paid", 250000, "pay_Xyz789")
    assert event.event_id == rzp.verify_webhook(_sign("whsec", raw), raw).event_id  # type: ignore[union-attr]
    assert "someone@upi" not in repr(event) and "1234" not in repr(event), "no UPI address and no card detail is read from the message"


def test_razorpay_webhook_other_events() -> None:
    rzp = RazorpayPayments("i", "s", "whsec")
    for name, status in (("payment_link.expired", "expired"), ("payment_link.cancelled", "cancelled"), ("payment_link.partially_paid", "partially_paid")):
        raw = _rzp_body(name, status=status)
        event = rzp.verify_webhook(_sign("whsec", raw), raw)
        assert event is not None and event.status == status
        assert (event.amount_paise is None) == (status != "partially_paid")
    raw = _rzp_body("payment.captured")
    assert rzp.verify_webhook(_sign("whsec", raw), raw) is None, "signed, but not about a payment link"
    raw = b'{"nothing": true}'
    assert rzp.verify_webhook(_sign("whsec", raw), raw) is None


def test_razorpay_webhook_signature_is_checked_on_the_raw_bytes() -> None:
    rzp = RazorpayPayments("i", "s", "whsec")
    raw = _rzp_body()
    for headers in ({}, {"x-razorpay-signature": ""}, _sign("wrong", raw), {"x-razorpay-signature": "a" * 64}):
        with pytest.raises(WebhookRejected):
            rzp.verify_webhook(headers, raw)
    with pytest.raises(WebhookRejected):  # the same JSON, spaced differently: not the signed bytes
        rzp.verify_webhook(_sign("whsec", raw), json.dumps(json.loads(raw), indent=1).encode())
    with pytest.raises(WebhookRejected):
        rzp.verify_webhook(_sign("whsec", raw), raw + b" ")


def test_razorpay_event_id_changes_with_the_body() -> None:
    rzp = RazorpayPayments("i", "s", "whsec")
    a, b = _rzp_body(), _rzp_body("payment_link.expired", status="expired")
    ea, eb = rzp.verify_webhook(_sign("whsec", a), a), rzp.verify_webhook(_sign("whsec", b), b)
    assert ea is not None and eb is not None and ea.event_id != eb.event_id


# ---------------------------------------------------------------------------------------------- Cashfree
def test_cashfree_link_request_and_response() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(url=str(request.url), headers=dict(request.headers), body=json.loads(request.content))
        return httpx.Response(200, json={"cf_link_id": 98765, "link_id": "pl_x", "link_url": "https://payments-test.cashfree.com/links/abc", "link_status": "ACTIVE"})

    cf = CashfreePayments("cfid", "cfsecret", notify_url="https://api.example.test/v1/webhooks/cashfree", client=_client(handler))
    made = cf.create_link(_req(), "0a0b0c0d-0000-4000-8000-000000000001")
    assert seen["url"] == "https://sandbox.cashfree.com/pg/links"
    assert seen["headers"]["x-client-id"] == "cfid" and seen["headers"]["x-client-secret"] == "cfsecret" and seen["headers"]["x-api-version"] == "2025-01-01"
    assert seen["headers"]["x-idempotency-key"] == "0a0b0c0d-0000-4000-8000-000000000001"
    body = seen["body"]
    assert body["link_id"] == "pl_" + "ab" * 16 and body["link_amount"] == 2500.0 and body["link_currency"] == "INR"
    assert body["customer_details"] == {"customer_phone": "9876543210", "customer_name": "A Buyer"}
    assert body["link_notify"] == {"send_sms": False, "send_email": False} and body["link_meta"] == {"notify_url": "https://api.example.test/v1/webhooks/cashfree"}
    assert body["link_expiry_time"].startswith("2026-10-15T12:00:00")
    assert (made.provider_link_id, made.url) == ("98765", "https://payments-test.cashfree.com/links/abc")
    assert "cfsecret" not in repr(cf)
    assert CashfreePayments("a", "b", production=True)._base == "https://api.cashfree.com"


def test_cashfree_needs_the_customers_phone() -> None:
    cf = CashfreePayments("a", "b", client=_client(lambda r: httpx.Response(200, json={})))
    with pytest.raises(ProviderError) as err:
        cf.create_link(_req(customer_phone=None), "k")
    assert err.value.code == "customer_phone_needed"


def _cf_body(status: str = "PAID", paid: str = "2500.00", **over: Any) -> bytes:
    data = {"link_id": "pl_" + "ab" * 16, "cf_link_id": 98765, "link_status": status, "link_amount": 2500.0, "link_amount_paid": paid, "link_currency": "INR", "order": {"order_id": "o1", "transaction_id": 4455, "transaction_status": "SUCCESS", "customer_details": {"customer_phone": "9876543210"}}}
    data.update(over)
    return json.dumps({"data": data, "type": "PAYMENT_LINK_EVENT", "version": "1", "event_time": "2026-10-12T10:00:00+05:30"}).encode()


def _cf_sign(secret: str, raw: bytes, timestamp: str = "1760000000000", dot: bool = False) -> dict[str, str]:
    mac = hmac.new(secret.encode(), timestamp.encode() + (b"." if dot else b"") + raw, hashlib.sha256).digest()
    return {"x-webhook-timestamp": timestamp, "x-webhook-signature": base64.b64encode(mac).decode()}


def test_cashfree_webhook_paid_in_both_documented_spellings() -> None:
    cf = CashfreePayments("cfid", "cfsecret")
    raw = _cf_body()
    for dot in (False, True):
        event = cf.verify_webhook(_cf_sign("cfsecret", raw, dot=dot), raw)
        assert event is not None
        assert (event.provider_link_id, event.reference, event.status, event.amount_paise, event.payment_ref) == ("98765", "pl_" + "ab" * 16, "paid", 250000, "4455")
    assert "9876543210" not in repr(event), "the customer's phone in the message is not read"


def test_cashfree_webhook_statuses_and_unrelated_types() -> None:
    cf = CashfreePayments("cfid", "cfsecret")
    for status, expected in (("EXPIRED", "expired"), ("CANCELLED", "cancelled"), ("PARTIALLY_PAID", "partially_paid")):
        raw = _cf_body(status, "100.50")
        event = cf.verify_webhook(_cf_sign("cfsecret", raw), raw)
        assert event is not None and event.status == expected
        assert event.amount_paise == (10050 if expected == "partially_paid" else None)
    raw = json.dumps({"data": {}, "type": "PAYMENT_SUCCESS_WEBHOOK"}).encode()
    assert cf.verify_webhook(_cf_sign("cfsecret", raw), raw) is None
    raw = _cf_body("UNKNOWN")
    assert cf.verify_webhook(_cf_sign("cfsecret", raw), raw) is None


def test_cashfree_webhook_rejects_bad_signatures() -> None:
    cf = CashfreePayments("cfid", "cfsecret")
    raw = _cf_body()
    good = _cf_sign("cfsecret", raw)
    for headers in ({}, {"x-webhook-signature": good["x-webhook-signature"]}, {"x-webhook-timestamp": "1"}, _cf_sign("other", raw), {**good, "x-webhook-timestamp": "1760000000001"}):
        with pytest.raises(WebhookRejected):
            cf.verify_webhook(headers, raw)
    with pytest.raises(WebhookRejected):
        cf.verify_webhook(good, raw + b"\n")


def test_the_fake_provider_signs_and_verifies_the_same_way() -> None:
    fake = FakePayments()
    raw, headers = FakePayments.signed(json.loads(_rzp_body()))
    event = fake.verify_webhook(headers, raw)
    assert event is not None and event.status == "paid"
    with pytest.raises(WebhookRejected):
        fake.verify_webhook({"x-razorpay-signature": "0" * 64}, raw)
    made = fake.create_link(_req(), "k")
    assert made.url.startswith("https://") and ".test/" in made.url and FAKE_SECRET


# ---------------------------------------------------------------------------------------------- Exotel
def test_exotel_connect_request_and_response() -> None:
    seen: dict[str, Any] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.update(url=str(request.url), auth=request.headers.get("authorization"), form=dict(httpx.QueryParams(request.content.decode())))
        return httpx.Response(200, json={"Call": {"Sid": "abc123def456", "Status": "queued", "From": "x", "To": "y"}})

    bridge = calls.ExotelBridge("sid1", "key1", "token1", "08012345678", client=_client(handler))
    sid, status = bridge.connect("+919000000001", "+919876543210", "bridge-1", "https://api.example.test/v1/webhooks/exotel/TOKEN/call-status")
    assert seen["url"] == "https://api.in.exotel.com/v1/Accounts/sid1/Calls/connect.json"
    assert seen["auth"] == "Basic " + base64.b64encode(b"key1:token1").decode()
    form = seen["form"]
    assert form["From"] == "+919000000001" and form["To"] == "+919876543210" and form["CallerId"] == "08012345678" and form["CustomField"] == "bridge-1"
    assert form["TimeLimit"] == "1800" and form["StatusCallbackEvents[]"] == "terminal" and "CallType" not in form, "the call is not declared transactional"
    assert (sid, status) == ("abc123def456", "queued")
    assert "token1" not in repr(bridge)


@pytest.mark.parametrize(("status", "code"), [(401, "unauthorized"), (429, "rate_limited"), (400, "rejected"), (503, "unavailable")])
def test_exotel_errors(status: int, code: str) -> None:
    bridge = calls.ExotelBridge("s", "k", "t", "0801", client=_client(lambda r: httpx.Response(status, json={"x": "TO NUMBER 9876543210"})))
    with pytest.raises(ProviderError) as err:
        bridge.connect("+919000000001", "+919876543210", "b", None)
    assert err.value.code == code and "9876543210" not in str(err.value)


def test_exotel_odd_answers_and_host_name() -> None:
    answer: Any
    for answer in ({}, {"Call": {}}, {"Call": {"Sid": "bad sid!"}}):
        bridge = calls.ExotelBridge("s", "k", "t", "0801", client=_client(lambda r, a=answer: httpx.Response(200, json=a)))
        with pytest.raises(ProviderError):
            bridge.connect("+919000000001", "+919876543210", "b", None)
    bridge = calls.ExotelBridge("s", "k", "t", "0801", client=_client(lambda r: httpx.Response(200, json={"Call": {"Sid": "abcd1234", "Status": "weird"}})))
    assert bridge.connect("+919000000001", "+919876543210", "b", None) == ("abcd1234", "queued")
    with pytest.raises(ValueError):
        calls.ExotelBridge("s", "k", "t", "0801", subdomain="evil.test/x?")


def test_passthru_and_status_parsing() -> None:
    assert calls.passthru({"CallSid": "abc12345", "CallFrom": "09876543210", "Direction": "incoming"}) == ("abc12345", "09876543210")
    assert calls.passthru({"CallSid": "abc12345", "CallFrom": "09876543210"}) is not None
    assert calls.passthru({"CallSid": "abc12345", "CallFrom": "09876543210", "Direction": "outbound-api"}) is None
    assert calls.passthru({"CallSid": "x", "CallFrom": "1"}) is None and calls.passthru({}) is None
    assert calls.status_of({"CallSid": "abc12345", "Status": "Completed"}) == ("abc12345", "completed")
    assert calls.status_of({"CallSid": "abc12345", "Status": "ringing"}) is None and calls.status_of({"Status": "completed"}) is None


def test_the_fake_bridge_remembers_who_was_asked() -> None:
    bridge = calls.FakeBridge()
    sid, status = bridge.connect("+910000000000", "+919876543210", "b1", None)
    assert sid.startswith("fakecall") and status == "queued" and bridge.sids == [sid]
    assert bridge.connect("+910000000000", "+919876543210", "b2", None)[0] != sid
    assert bridge.calls[0] == ("+910000000000", "+919876543210", "b1")


# ---------------------------------------------------------------------------------------------- wiring
def test_everything_is_off_by_default() -> None:
    assert build_connectors(_settings(), "http://x", "http://x/auth", "anon") is None


def test_a_connector_needs_its_workspace() -> None:
    with pytest.raises(ConfigurationError):
        build_connectors(_settings(indiamart_provider="fake"), "http://x", "http://x/auth", "anon")
    with pytest.raises(ConfigurationError):
        build_connectors(_settings(indiamart_provider="fake", integrations_tenant_id="not-a-uuid"), "http://x", "http://x/auth", "anon")


def test_fakes_build_and_report_what_is_on() -> None:
    c = build_connectors(_settings(integrations_tenant_id=TENANT, indiamart_provider="fake", payments_provider="fake", calls_provider="fake", exotel_webhook_token=SecretStr("x" * 30)), "http://x", "http://x/auth", "anon")
    assert c is not None and c.enabled() == {"indiamart": True, "payments": True, "calls": True}
    assert str(c.tenant_id) == TENANT and c.receiver is None and c.agent_number == "+910000000000"
    assert "x" * 30 not in repr(c)


def test_real_providers_need_their_keys() -> None:
    base = {"integrations_tenant_id": TENANT}
    for extra in (
        {"indiamart_provider": "real"},
        {"payments_provider": "razorpay"},
        {"payments_provider": "razorpay", "razorpay_key_id": "i", "razorpay_key_secret": SecretStr("s")},
        {"payments_provider": "cashfree", "cashfree_client_id": "i"},
        {"calls_provider": "exotel"},
        {"calls_provider": "exotel", "exotel_sid": "s", "exotel_api_key": "k", "exotel_api_token": SecretStr("t"), "exotel_caller_id": "08012345678", "exotel_agent_number": "09000000001"},
    ):
        with pytest.raises(ConfigurationError):
            build_connectors(_settings(**base, **extra), "http://x", "http://x/auth", "anon")


def test_real_providers_build_with_their_keys() -> None:
    c = build_connectors(
        _settings(
            integrations_tenant_id=TENANT,
            indiamart_provider="real",
            indiamart_crm_key=SecretStr(KEY),
            payments_provider="cashfree",
            cashfree_client_id="cfid",
            cashfree_client_secret=SecretStr("cfsecret"),
            cashfree_env="production",
            public_base_url="https://api.example.test/",
            calls_provider="exotel",
            exotel_sid="s",
            exotel_api_key="k",
            exotel_api_token=SecretStr("t"),
            exotel_caller_id="08012345678",
            exotel_agent_number="09000000001",
            exotel_webhook_token=SecretStr("A" * 32),
            scheduler_email="worker@x.test",
            scheduler_password=SecretStr("pw"),
        ),
        "http://x",
        "http://x/auth",
        "anon",
    )
    assert c is not None and c.receiver is not None and c.agent_number == "+919000000001" and c.public_base_url == "https://api.example.test"
    assert c.payments is not None and c.payments._base == "https://api.cashfree.com"  # type: ignore[attr-defined]
    text = repr(c)
    assert KEY not in text and "cfsecret" not in text and "A" * 32 not in text


@pytest.mark.parametrize(
    "extra",
    [
        {"indiamart_provider": "maybe"},
        {"payments_provider": "paypal"},
        {"calls_provider": "skype"},
        {"cashfree_env": "staging", "payments_provider": "cashfree", "cashfree_client_id": "i", "cashfree_client_secret": SecretStr("s")},
        {"calls_provider": "fake", "exotel_webhook_token": SecretStr("short")},
        {"calls_provider": "fake", "exotel_webhook_token": SecretStr("a b" * 10)},
        {"indiamart_provider": "fake", "public_base_url": "http://insecure.example.test"},
        {"indiamart_provider": "fake", "missed_call_reply_language": "xx"},
    ],
)
def test_odd_settings_stop_the_process(extra: dict[str, Any]) -> None:
    with pytest.raises(ConfigurationError):
        build_connectors(_settings(integrations_tenant_id=TENANT, **extra), "http://x", "http://x/auth", "anon")


def test_an_external_lead_is_plain_data() -> None:
    lead = ExternalLead("ID-0001", "W", "Name")
    assert lead.message == "" and lead.phone is None
