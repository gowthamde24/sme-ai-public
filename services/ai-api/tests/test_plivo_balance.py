# ruff: noqa: E501
"""The daily Plivo balance check (owner decision, 19 Nov 2026; app/ops/plivo_balance.py): the comparison with Rs 300 and how Plivo's credits become rupees, one read a day (the database says when), one WhatsApp message to the
owner's own number (and none to anyone else), a failed read, a failed send, the switch (off by default), and the worker never stopping for it. Plivo is a FAKE client in every test: no network, no key, no provider call."""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from decimal import Decimal
from typing import Any

import pytest
from pydantic import SecretStr

from app.config import ConfigurationError, Settings
from app.ops.plivo_balance import (
    AdapterOwnerNotice,
    Limit,
    PlivoBalanceCheck,
    alert_detail,
    build_plivo_balance,
    parse_account,
    whatsapp_text,
)
from app.outbox.adapter import LocalFakeAdapter, SendResult
from app.telephony.plivo_api import FakePlivoApi, PlivoApi, PlivoError
from app.tenancy.repository import TokenRejected

OWNER = "+919800000001"   # a made-up number
RATE = 90.0
TOKEN = "scheduler-token"


class FakeRpc:
    """The database's side of the check, scripted: `due` is what ops_plivo_balance_due answers, `report` what ops_plivo_balance_report answers (a function of its arguments)."""

    def __init__(self, due: dict[str, Any] | None = None) -> None:
        self.due = due or {"read_due": True, "state": None, "whatsapp_due": False, "balance_inr": None, "auto_recharge": None}
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def object(self, token: str, function: str, args: dict[str, Any]) -> dict[str, Any]:
        assert token == TOKEN
        self.calls.append((function, args))
        if function == "ops_plivo_balance_due":
            return self.due
        assert function == "ops_plivo_balance_report"
        state = args["p_state"]
        return {"state": state, "whatsapp_due": state == "low", "balance_inr": args.get("p_balance_inr"), "auto_recharge": args.get("p_auto_recharge")}

    def call(self, token: str, function: str, args: dict[str, Any]) -> Any:
        assert token == TOKEN
        self.calls.append((function, args))

    def names(self) -> list[str]:
        return [name for name, _ in self.calls]


class FakeNotice:
    def __init__(self, ok: bool = True) -> None:
        self.ok, self.sent = ok, []   # type: ignore[var-annotated]

    def send(self, text: str, key: str) -> bool:
        self.sent.append((text, key))
        return self.ok


def limit(currency: str = "USD", rate: float = RATE) -> Limit:
    return Limit.build(300, currency, rate)


def plivo(credits: str, auto: Any = False) -> FakePlivoApi:
    api = FakePlivoApi()
    api.account_body = {"cash_credits": credits, "auto_recharge": auto}
    return api


NOON = datetime(2026, 11, 20, 12, 0, tzinfo=UTC)


def check(api: FakePlivoApi, rpc: FakeRpc, notice: FakeNotice | None = None, lim: Limit | None = None) -> PlivoBalanceCheck:
    return PlivoBalanceCheck(api, rpc, lim or limit(), notice, clock=lambda: NOON)


# ------------------------------------------------------------------------------------------------------------------------ the comparison
def test_credits_become_rupees_with_the_configured_rate_and_the_limit_is_strictly_below() -> None:
    usd = limit("USD", 90.0)
    assert usd.rupees(Decimal("3.33")) == Decimal("299.70") and usd.is_low(Decimal("3.33"))
    assert usd.rupees(Decimal("3.3334")) == Decimal("300.01") and not usd.is_low(Decimal("3.3334"))
    assert not usd.is_low(Decimal("10"))
    rupees = limit("INR", 0.0)   # an account that reports rupees needs no rate
    assert rupees.rupees(Decimal("299.99")) == Decimal("299.99") and rupees.is_low(Decimal("299.99"))
    assert not rupees.is_low(Decimal("300")), "exactly Rs 300 is not below it"


def test_a_foreign_currency_without_a_rate_is_a_configuration_error_not_a_silent_pass() -> None:
    with pytest.raises(ConfigurationError, match="PLIVO_BALANCE_INR_PER_UNIT"):
        Limit.build(300, "USD", 0.0)
    with pytest.raises(ConfigurationError):
        Limit.build(300, "dollars", 90.0)
    with pytest.raises(ConfigurationError):
        Limit.build(0, "INR", 0.0)


def test_plivos_account_object_is_read_and_anything_odd_is_a_bad_response() -> None:
    acc = parse_account({"cash_credits": "1.80900", "auto_recharge": False, "billing_mode": "prepaid"})
    assert acc.credits == Decimal("1.80900") and acc.auto_recharge is False
    assert parse_account({"cash_credits": 12, "auto_recharge": "true"}).auto_recharge is True
    assert parse_account({"cash_credits": "2"}).auto_recharge is None, "not reported is not guessed"
    for bad in ({}, {"cash_credits": None}, {"cash_credits": "abc"}, {"cash_credits": "NaN"}, {"cash_credits": True}, {"cash_credits": "1e30"}):
        with pytest.raises(PlivoError) as caught:
            parse_account(bad)
        assert caught.value.reason == "bad_response"


# ------------------------------------------------------------------------------------------------------------------------ one pass
def test_nothing_due_means_no_call_to_plivo() -> None:
    api, rpc = plivo("1.00"), FakeRpc({"read_due": False, "state": "ok", "whatsapp_due": False, "balance_inr": 500.0, "auto_recharge": False})
    result = check(api, rpc, FakeNotice()).run(TOKEN)
    assert (result.read, result.told) == ("idle", False) and rpc.names() == ["ops_plivo_balance_due"]
    assert api.placed == [] and api.hung_up == []   # (the fake has no read counter: the due answer said no, so nothing in the check asked it)


def test_a_healthy_balance_is_reported_ok_without_a_sentence_and_nobody_is_messaged() -> None:
    notice, rpc = FakeNotice(), FakeRpc()
    result = check(plivo("5.00000"), rpc, notice).run(TOKEN)   # 5 USD at Rs 90 = Rs 450
    assert (result.read, result.told) == ("ok", False) and notice.sent == []
    assert rpc.calls[1] == ("ops_plivo_balance_report", {"p_state": "ok", "p_balance_inr": 450.0, "p_auto_recharge": False})


def test_a_low_balance_is_reported_with_its_sentence_and_the_owner_is_told_once() -> None:
    notice, rpc = FakeNotice(), FakeRpc()
    result = check(plivo("2.35000", auto=False), rpc, notice).run(TOKEN)   # 2.35 USD at Rs 90 = Rs 211.50
    assert (result.read, result.told) == ("low", True)
    name, args = rpc.calls[1]
    assert name == "ops_plivo_balance_report" and args["p_state"] == "low" and args["p_balance_inr"] == 211.5
    assert "2.35 USD" in args["p_detail"] and "about Rs 212 at Rs 90 to the USD" in args["p_detail"] and "limit is Rs 300" in args["p_detail"] and "Auto-recharge is off" in args["p_detail"]
    assert len(args["p_detail"]) <= 500
    assert notice.sent == [("Plivo balance is low: about Rs 212 left (limit Rs 300). Auto-recharge: off. Top up at plivo.com so calls keep working.", "2026-11-20")]
    assert rpc.names() == ["ops_plivo_balance_due", "ops_plivo_balance_report", "ops_plivo_balance_told"], "the database is told the message went"


def test_the_message_is_one_line_with_no_number_or_name() -> None:
    text = whatsapp_text(Decimal("211.5"), Decimal(300), True)
    assert "\n" not in text and "\t" not in text and "  " not in text and "Auto-recharge: on" in text and OWNER not in text
    assert "not reported" in whatsapp_text(Decimal(10), Decimal(300), None)


def test_once_it_has_gone_the_next_ticks_of_the_day_send_nothing() -> None:
    notice = FakeNotice()
    rpc = FakeRpc({"read_due": False, "state": "low", "whatsapp_due": False, "balance_inr": 211.5, "auto_recharge": False})
    assert check(plivo("2.35"), rpc, notice).run(TOKEN).told is False and notice.sent == []


def test_a_message_that_did_not_go_is_not_marked_and_is_offered_again_from_the_database_record() -> None:
    notice = FakeNotice(ok=False)
    rpc = FakeRpc({"read_due": False, "state": "low", "whatsapp_due": True, "balance_inr": 211.5, "auto_recharge": False})
    result = check(plivo("2.35"), rpc, notice).run(TOKEN)
    assert result.told is False and len(notice.sent) == 1 and "ops_plivo_balance_told" not in rpc.names()
    notice.ok = True
    assert check(plivo("2.35"), rpc, notice).run(TOKEN).told is True and rpc.names()[-1] == "ops_plivo_balance_told"
    assert [text for text, _ in notice.sent][0] == [text for text, _ in notice.sent][1] and notice.sent[0][1] == notice.sent[1][1], "the retry is the same message (same key)"


def test_the_low_item_is_raised_even_when_no_message_can_go() -> None:
    rpc = FakeRpc()
    result = check(plivo("1.00"), rpc, None).run(TOKEN)
    assert result.read == "low" and result.told is False and rpc.calls[1][1]["p_state"] == "low" and "ops_plivo_balance_told" not in rpc.names()


def test_a_failed_read_is_reported_as_failed_with_no_amount_and_the_owner_is_not_told() -> None:
    api, notice, rpc = plivo("1.00"), FakeNotice(), FakeRpc()
    api.fail_with = "unauthorized"
    result = check(api, rpc, notice).run(TOKEN)
    assert result.read == "failed" and notice.sent == [] and rpc.calls[1] == ("ops_plivo_balance_report", {"p_state": "failed"})


def test_an_unreadable_answer_is_a_failed_read_too() -> None:
    api, rpc = plivo("1.00"), FakeRpc()
    api.account_body = {"cash_credits": "not a number"}
    assert check(api, rpc, FakeNotice()).run(TOKEN).read == "failed" and rpc.calls[1][1] == {"p_state": "failed"}


def test_a_refused_token_reaches_the_worker() -> None:
    class Refusing(FakeRpc):
        def object(self, token: str, function: str, args: dict[str, Any]) -> dict[str, Any]:
            raise TokenRejected("401")

    with pytest.raises(TokenRejected):
        check(plivo("1.00"), Refusing(), FakeNotice()).run(TOKEN)


# ------------------------------------------------------------------------------------------------------------------------ the message path
def test_the_message_goes_to_the_owners_own_number_through_the_approved_template_and_to_nobody_else() -> None:
    adapter = LocalFakeAdapter()
    notice = AdapterOwnerNotice(adapter, to_phone=OWNER, phone_number_id="123456", token_ref="platform", template="platform_alert", language="en")
    assert notice.send("Plivo balance is low: about Rs 212 left.", "2026-11-20") is True
    (sent,) = adapter.sent
    assert sent.to_phone == OWNER and sent.tenant_id is None, "the owner's number; no workspace, no customer"
    assert sent.wa is not None and sent.wa.window_open is False and sent.wa.phone_number_id == "123456"
    assert sent.wa.template is not None and (sent.wa.template.name, sent.wa.template.language, sent.wa.template.category) == ("platform_alert", "en", "utility") and sent.wa.template.variables == (sent.body,)
    assert OWNER not in repr(notice) and OWNER not in repr(sent)
    notice.send("Plivo balance is low: about Rs 212 left.", "2026-11-20")
    assert adapter.sent[1].message_id == adapter.sent[0].message_id, "the same day is the same message id (the provider sees a repeat)"
    notice.send("Plivo balance is low: about Rs 212 left.", "2026-11-21")
    assert adapter.sent[2].message_id != adapter.sent[0].message_id


def test_a_refused_or_crashing_send_is_false_and_logs_no_number(caplog: pytest.LogCaptureFixture) -> None:
    class Refusing:
        name = "whatsapp"

        def send(self, message: Any) -> SendResult:
            return SendResult(False, None, "rejected")

    class Crashing:
        name = "whatsapp"

        def send(self, message: Any) -> SendResult:
            raise RuntimeError(f"boom {OWNER}")

    caplog.set_level(logging.INFO)
    for adapter in (Refusing(), Crashing()):
        assert AdapterOwnerNotice(adapter, to_phone=OWNER, phone_number_id="1", token_ref="platform", template="platform_alert", language="en").send("x text", "k") is False
    assert OWNER not in caplog.text and "boom" not in caplog.text


# ------------------------------------------------------------------------------------------------------------------------ the switch and the wiring
def settings(**over: Any) -> Settings:
    base: dict[str, Any] = {"plivo_balance_check": True, "plivo_balance_inr_per_unit": RATE, "plivo_balance_alert_to": OWNER, "whatsapp_phone_number_id": "123456", "plivo_auth_id": "MAABCDEFGHIJ", "plivo_auth_token": SecretStr("not-a-real-token")}
    base.update(over)
    return Settings(_env_file=None, **base)  # type: ignore[call-arg]


class WhatsappNamed(LocalFakeAdapter):
    name = "whatsapp"


def test_off_by_default_nothing_is_built_and_no_client_is_made() -> None:
    assert Settings(_env_file=None).plivo_balance_check is False  # type: ignore[call-arg]
    assert build_plivo_balance(Settings(_env_file=None), "http://rest", "anon", LocalFakeAdapter()) is None  # type: ignore[call-arg]


def test_on_it_builds_the_real_client_without_calling_plivo_and_the_owner_notice_only_over_whatsapp(caplog: pytest.LogCaptureFixture) -> None:
    built = build_plivo_balance(settings(), "http://rest", "anon", WhatsappNamed())
    assert built is not None and isinstance(built._reader, PlivoApi) and isinstance(built._notice, AdapterOwnerNotice)   # (constructing the client opens no connection)
    caplog.set_level(logging.WARNING)
    fake_channel = build_plivo_balance(settings(), "http://rest", "anon", LocalFakeAdapter())
    assert fake_channel is not None and fake_channel._notice is None and "only the Needs-you item" in caplog.text and OWNER not in caplog.text
    no_number = build_plivo_balance(settings(plivo_balance_alert_to=None), "http://rest", "anon", WhatsappNamed())
    assert no_number is not None and no_number._notice is None


@pytest.mark.parametrize(
    "over",
    [
        {"plivo_auth_id": None},
        {"plivo_auth_token": None},
        {"plivo_balance_inr_per_unit": 0.0},
        {"plivo_balance_alert_to": "not a number"},
        {"whatsapp_phone_number_id": None},
        {"plivo_balance_template": "Bad Name"},
        {"plivo_balance_min_inr": 0},
    ],
)
def test_a_switch_that_is_on_but_cannot_work_stops_the_worker_at_start(over: dict[str, Any]) -> None:
    with pytest.raises(ConfigurationError):
        build_plivo_balance(settings(**over), "http://rest", "anon", WhatsappNamed())


def test_rupees_need_no_rate() -> None:
    built = build_plivo_balance(settings(plivo_balance_currency="INR", plivo_balance_inr_per_unit=0.0), "http://rest", "anon", WhatsappNamed())
    assert built is not None


def test_the_alert_sentence_for_rupees_has_no_rate_in_it() -> None:
    acc = parse_account({"cash_credits": "212.50", "auto_recharge": None})
    text = alert_detail(acc, limit("INR", 0.0))
    assert "Plivo reports 212.5 INR." in text and " at Rs " not in text and "Auto-recharge is not reported" in text


# ------------------------------------------------------------------------------------------------------------------------ the worker
class Session:
    def token(self) -> str:
        return TOKEN

    def invalidate(self) -> None:
        self.invalidated = True


def test_the_worker_runs_the_check_each_tick_and_a_crash_never_fails_the_tick(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture) -> None:
    from app.scheduler.worker import Worker

    ran: list[str] = []

    class Pass:
        def run(self, token: str) -> None:
            ran.append(token)
            raise RuntimeError(f"boom {OWNER}")

    monkeypatch.setattr("app.scheduler.worker.run_tick", lambda *a, **k: "ticked")
    caplog.set_level(logging.ERROR)
    worker = Worker(object(), object(), Session(), plivo_balance=Pass())  # type: ignore[arg-type]
    assert worker.tick_once() == "ticked"  # type: ignore[comparison-overlap]
    assert ran == [TOKEN] and "RuntimeError" in caplog.text and OWNER not in caplog.text


def test_a_refused_token_in_the_check_makes_the_worker_sign_in_again(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.scheduler.worker import Worker

    class Pass:
        def run(self, token: str) -> None:
            raise TokenRejected("401")

    monkeypatch.setattr("app.scheduler.worker.run_tick", lambda *a, **k: "ticked")
    session = Session()
    assert Worker(object(), object(), session, plivo_balance=Pass()).tick_once() is None  # type: ignore[arg-type]
    assert session.invalidated is True


def test_the_worker_without_the_check_is_unchanged(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.scheduler.worker import Worker

    monkeypatch.setattr("app.scheduler.worker.run_tick", lambda *a, **k: "ticked")
    assert Worker(object(), object(), Session()).tick_once() == "ticked"  # type: ignore[arg-type, comparison-overlap]


def test_the_real_client_reads_the_account_with_one_get_and_nothing_else() -> None:
    import httpx

    seen: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"cash_credits": "4.20000", "auto_recharge": False, "auth_id": "MAABCDEFGHIJ"})

    api = PlivoApi("MAABCDEFGHIJ", "not-a-real-token", client=httpx.Client(transport=httpx.MockTransport(handler)))
    assert api.account_details()["cash_credits"] == "4.20000"
    (request,) = seen
    assert request.method == "GET" and str(request.url) == "https://api.plivo.com/v1/Account/MAABCDEFGHIJ/"
    for status, reason in ((401, "unauthorized"), (429, "rate_limited"), (500, "unavailable")):
        failing = PlivoApi("MAABCDEFGHIJ", "x", client=httpx.Client(transport=httpx.MockTransport(lambda r, s=status: httpx.Response(s))))
        with pytest.raises(PlivoError) as caught:
            failing.account_details()
        assert caught.value.reason == reason
    not_json = PlivoApi("MAABCDEFGHIJ", "x", client=httpx.Client(transport=httpx.MockTransport(lambda r: httpx.Response(200, content=b"<html>"))))
    with pytest.raises(PlivoError) as bad:
        not_json.account_details()
    assert bad.value.reason == "bad_response"


# ---- days of cover (26 Nov 2026): the "Needs you" item says how long the wallet lasts at the last 7 days' call use ----

def test_cover_sentence_works_out_the_days_from_the_last_seven_days() -> None:
    from app.ops.plivo_balance import cover_sentence

    text = cover_sentence(Decimal("420"), 7 * 6000)   # Rs 60 a day (6,000 paise a day for 7 days)
    assert "about Rs 60 a day" in text and "about 7 more days" in text and "number and channel fees come on top" in text
    assert "1 more day of" in cover_sentence(Decimal("60"), 7 * 6000)
    assert "No calls were made in the last 7 days" in cover_sentence(Decimal("420"), 0)
    assert "no days of cover are left" in cover_sentence(Decimal("0"), 7 * 6000)
    assert cover_sentence(Decimal("420"), None) == ""   # the database did not say: nothing is guessed


def test_the_alert_carries_the_cover_only_when_the_database_gave_the_spend() -> None:
    limit = Limit.build(500, "INR", 0.0)
    account = parse_account({"cash_credits": "420", "auto_recharge": False})
    assert "more day" not in alert_detail(account, limit, "VoiceLink")
    assert "about 7 more days" in alert_detail(account, limit, "VoiceLink", 7 * 6000)
    assert len(alert_detail(account, limit, "VoiceLink", 7 * 6000)) < 500   # the database refuses a longer sentence


def test_a_refused_voicelink_login_is_reported_with_its_reason_at_once_and_a_plivo_failure_is_not_changed() -> None:
    """28 Nov 2026: the stored username was the display name, VoiceLink answered 401 and nothing showed. A known reason now goes to the database WITH its sentence (the item is raised on the first failed read)."""
    api, rpc = plivo("1.00"), FakeRpc()
    api.fail_with = "auth"
    result = PlivoBalanceCheck(api, rpc, limit(), None, clock=lambda: NOON, brand="VoiceLink").run(TOKEN)
    args = rpc.calls[1][1]
    assert result.read == "failed" and args["p_state"] == "failed" and "REGISTERED username" in args["p_detail"] and "display name" in args["p_detail"]
    other = FakeRpc()
    plain = plivo("1.00")
    plain.fail_with = "auth"
    PlivoBalanceCheck(plain, other, limit(), None, clock=lambda: NOON).run(TOKEN)
    assert other.calls[1][1] == {"p_state": "failed"}, "Plivo's own failures behave as before"


class _Reader:
    def __init__(self, recording: object) -> None:
        self.recording = recording

    def account_details(self) -> dict[str, Any]:
        return {"cash_credits": "900", "auto_recharge": None, "recording_numbers": self.recording}


def test_a_number_that_records_raises_one_item_and_none_clears_it_and_a_failed_report_never_spoils_the_read() -> None:
    rpc = FakeRpc()
    PlivoBalanceCheck(_Reader(2), rpc, limit("INR", 0.0), None, clock=lambda: NOON, brand="VoiceLink").run(TOKEN)
    sent = [(n, a) for n, a in rpc.calls if n == "ops_telephony_setting_report"]
    assert len(sent) == 1 and sent[0][1]["p_ok"] is False and "ON for 2 of our numbers" in sent[0][1]["p_detail"] and "not recorded" in sent[0][1]["p_detail"]
    rpc2 = FakeRpc()
    PlivoBalanceCheck(_Reader(0), rpc2, limit("INR", 0.0), None, clock=lambda: NOON, brand="VoiceLink").run(TOKEN)
    assert [(n, a) for n, a in rpc2.calls if n == "ops_telephony_setting_report"] == [("ops_telephony_setting_report", {"p_ok": True})]
    rpc3 = FakeRpc()
    PlivoBalanceCheck(_Reader(None), rpc3, limit("INR", 0.0), None, clock=lambda: NOON).run(TOKEN)
    assert "ops_telephony_setting_report" not in [n for n, _ in rpc3.calls], "a reader that does not say (Plivo) reports nothing"

    class Down(FakeRpc):
        def call(self, token: str, function: str, args: dict[str, Any]) -> Any:
            if function == "ops_telephony_setting_report":
                raise RuntimeError("not pushed yet")
            return super().call(token, function, args)

    result = PlivoBalanceCheck(_Reader(1), Down(), limit("INR", 0.0), None, clock=lambda: NOON, brand="VoiceLink").run(TOKEN)
    assert result.read in ("ok", "low"), "the balance read stands"


def test_when_recording_is_expected_on_the_item_is_raised_only_when_it_is_off() -> None:
    """28 Nov 2026 (owner, option B): VOICELINK_RECORDING_EXPECTED=true: recording ON is the plan, so ON clears the item and OFF raises one."""
    on = FakeRpc()
    PlivoBalanceCheck(_Reader(2), on, limit("INR", 0.0), None, clock=lambda: NOON, brand="VoiceLink", recording_expected=True).run(TOKEN)
    assert [(n, a) for n, a in on.calls if n == "ops_telephony_setting_report"] == [("ops_telephony_setting_report", {"p_ok": True})]
    off = FakeRpc()
    PlivoBalanceCheck(_Reader(0), off, limit("INR", 0.0), None, clock=lambda: NOON, brand="VoiceLink", recording_expected=True).run(TOKEN)
    sent = [a for n, a in off.calls if n == "ops_telephony_setting_report"]
    assert len(sent) == 1 and sent[0]["p_ok"] is False and "recording is OFF" in sent[0]["p_detail"] and "VOICELINK_RECORDING_EXPECTED" in sent[0]["p_detail"]
