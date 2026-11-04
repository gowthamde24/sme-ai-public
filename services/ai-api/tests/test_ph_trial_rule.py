"""The shared trial number's rule (owner, 4 Nov 2026). Exotel's trial number asks a caller it does not recognise for the PIN; roaming, the owner's number arrives altered, so the caller cannot be a
condition there. On THAT number only, in sandbox mode only, a call is admitted when ALL hold: our per-call signed token, the start message's account_sid = ours, its app id = ours when it names one, no
other call open, at most 10 a day, and Exotel's record of the CallSid under OUR account (asked again on a 404) exists and has not ended. The call is cut at 3 minutes. Every other number keeps the strict
rule (sandbox list, Exotel's record, same caller). The log says which rule admitted each call and compares the caller with ours as yes / no and a shape, never a digit."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import json
import logging
from datetime import UTC, datetime, timedelta
from typing import Any

from app.config import Settings
from app.telephony import exotel, gate, inbound
from app.telephony.wiring import build_phone_inbound
from tests.test_dv_browser_voice import arun
from tests.test_ph_inbound import (
    EXOPHONE,
    OWNER,
    SECRET,
    TENANT,
    FakeCalls,
    FakeStore,
    _call,
    service,
)

OUR_SID = "stack191"
APP = "1371752"
NOW = datetime(2026, 11, 4, 9, 0, tzinfo=UTC)
GS = gate.Settings(mode="sandbox", sandbox_numbers=frozenset({OWNER, "+919000000002"}), outbound=False)


def rule(**kw: Any) -> inbound.TrialRule:
    out = inbound.trial_rule(kw.pop("number", "09513886363"), kw.pop("caller", OWNER), kw.pop("sid", OUR_SID), kw.pop("app", APP), **kw)
    assert out is not None
    return out


def start(*, from_number: str = OWNER, to_number: str = EXOPHONE, account_sid: str = OUR_SID, app_id: str = APP) -> exotel.Start:
    return exotel.Start(stream_sid="XP1", call_sid="CA9", account_sid=account_sid, from_number=from_number, to_number=to_number, sample_rate=16000, fields=("account_sid", "call_sid"), app_id=app_id)


async def admit(st: exotel.Start | None = None, *, gs: gate.Settings = GS, trial: inbound.TrialRule | None = None, count: inbound.DayCount | None = None, calls: Any = None, store: FakeStore | None = None,
                active: int = 0, now: datetime = NOW) -> inbound.Admitted | gate.Refused:
    s = store or FakeStore()
    return await inbound.admit(st or start(), gs, find_line=s.line_find, calls=calls if calls is not None else FakeCalls(), active_calls=active, now=now,  # type: ignore[arg-type]
                               our_sid=OUR_SID, trial=trial if trial is not None else rule(), trial_count=count if count is not None else inbound.DayCount())


class NoRecord:
    """Exotel has no record of the call under our account (a 404 after the retries)."""

    def __init__(self) -> None:
        self.asked: list[str] = []

    async def get(self, call_sid: str, *, retries_s: tuple[float, ...] = ()) -> None:
        self.asked.append(call_sid)
        return None


def test_the_start_message_keeps_its_field_names_and_any_app_id() -> None:
    body: dict[str, Any] = {"stream_sid": "XP", "call_sid": "CA", "account_sid": "acc", "from": "0950", "to": "0951", "flow_id": 1371752, "custom_parameters": {}}
    msg = {"event": "start", "start": body}
    st = exotel.parse(json.dumps(msg))
    assert isinstance(st, exotel.Start) and st.app_id == "1371752" and "flow_id" in st.fields and "account_sid" in st.fields
    body.pop("flow_id")
    body["custom_parameters"] = {"app_id": "42"}
    st = exotel.parse(json.dumps(msg))
    assert isinstance(st, exotel.Start) and st.app_id == "42"
    body["custom_parameters"] = {}
    st = exotel.parse(json.dumps(msg))
    assert isinstance(st, exotel.Start) and st.app_id == ""


@arun
async def test_on_the_trial_number_a_call_from_an_altered_caller_number_is_admitted_through_the_pin_path() -> None:
    for caller in ("+4915112345678", "", "unknown", OWNER):   # roaming: the number arrives altered, masked or not at all
        calls = FakeCalls(from_number=None)
        out = await admit(start(from_number=caller), calls=calls)
        assert isinstance(out, inbound.Admitted) and out.rule == "trial_pin_path" and out.tenant_id == TENANT and out.max_call_s == 180, (caller, out)
        assert calls.asked == ["CA9"], "Exotel's record of the CallSid is read under our account"


@arun
async def test_on_the_trial_number_exotels_record_under_our_account_is_required() -> None:
    none = NoRecord()
    out = await admit(calls=none)
    assert isinstance(out, gate.Refused) and out.reason == "not_approved" and none.asked == ["CA9"]
    for ended in ("completed", "failed", "busy", "no-answer", "canceled"):
        out = await admit(calls=FakeCalls(status=ended))
        assert isinstance(out, gate.Refused) and out.reason == "not_approved", ended
    no_key = await inbound.admit(start(), GS, find_line=FakeStore().line_find, calls=None, active_calls=0, now=NOW, our_sid=OUR_SID, trial=rule(), trial_count=inbound.DayCount())
    assert isinstance(no_key, gate.Refused) and no_key.reason == "telephony_off", "without our key nothing confirms the call: closed"


@arun
async def test_the_lookup_asks_again_on_a_404_and_never_on_another_answer() -> None:
    import httpx

    def client(statuses: list[int]) -> tuple[httpx.AsyncClient, list[str]]:
        seen: list[str] = []

        def reply(request: httpx.Request) -> httpx.Response:
            seen.append(request.url.path)
            code = statuses[min(len(seen) - 1, len(statuses) - 1)]
            return httpx.Response(code, json={"Call": {"Status": "in-progress", "From": "09502380998", "To": "09513886363"}} if code == 200 else {})

        return httpx.AsyncClient(transport=httpx.MockTransport(reply)), seen

    c, seen = client([404, 404, 200])
    got = await inbound.ExotelCalls("https://api.exotel.com", OUR_SID, "k", "t", client=c).get("abc123", retries_s=(0.01, 0.01))
    assert got is not None and got.status == "in-progress" and got.from_number == OWNER and len(seen) == 3
    assert seen[0] == f"/v1/Accounts/{OUR_SID}/Calls/abc123.json", "the call_sid of the start message, under our account"
    c, seen = client([404])
    assert await inbound.ExotelCalls("https://api.exotel.com", OUR_SID, "k", "t", client=c).get("abc123", retries_s=(0.01, 0.01)) is None and len(seen) == 3
    c, seen = client([401])
    assert await inbound.ExotelCalls("https://api.exotel.com", OUR_SID, "k", "t", client=c).get("abc123", retries_s=(0.01, 0.01)) is None and len(seen) == 1, "a refused key is not asked again"


def test_a_call_id_is_logged_as_a_fingerprint_never_the_id() -> None:
    sid = "0123456789abcdef0123456789abcdef"
    fp = inbound.fingerprint(SECRET, sid)
    assert fp == inbound.fingerprint(SECRET, sid) and fp.endswith("/32") and sid[:6] not in fp and inbound.fingerprint(SECRET, "") == "-"
    assert fp != inbound.fingerprint(b"other" * 10, sid)


@arun
async def test_every_condition_of_the_trial_rule_is_needed() -> None:
    full = inbound.DayCount()
    for _ in range(10):
        full.add(NOW)
    cases: list[tuple[dict[str, Any], str]] = [
        (dict(st=start(account_sid="someone-else")), "trial_account"),
        (dict(st=start(account_sid="")), "trial_account"),
        (dict(st=start(app_id="999")), "trial_app_id"),
        (dict(active=1), "trial_busy"),
        (dict(count=full), "trial_day_limit"),
        (dict(gs=gate.Settings(mode="live", sandbox_numbers=frozenset({OWNER}), outbound=False, live_confirmed=True)), "trial_not_sandbox"),
        (dict(store=FakeStore(line={"tenant_id": str(TENANT), "inbound_on": False})), "inbound_off"),   # the gate still decides after the rule
        (dict(store=FakeStore(line={})), "no_such_line"),
        (dict(calls=FakeCalls(status="completed")), "not_approved"),
    ]
    for over, reason in cases:
        out = await admit(**over)
        assert isinstance(out, gate.Refused) and out.reason == reason, (over, out)
        assert reason in gate.REASONS


@arun
async def test_the_app_id_is_checked_only_when_exotel_names_one() -> None:
    absent = await admit(start(app_id=""))
    assert isinstance(absent, inbound.Admitted) and absent.rule == "trial_pin_path", "Exotel's start message names no app id (owner: then it is not a condition)"
    other = await admit(start(app_id="999"))
    assert isinstance(other, gate.Refused) and other.reason == "trial_app_id", "a different app id is still refused"


def test_the_stream_takes_the_token_from_the_path_or_the_query_and_the_log_never_shows_it() -> None:
    from app.logging_safety import RedactWebSocketFilter
    from app.telephony.inbound_routes import router

    paths = {getattr(r, "path", "") for r in router.routes}
    assert {"/v1/telephony/exotel/stream", "/v1/telephony/exotel/stream/{token}"} <= paths
    token = inbound.mint(SECRET, inbound.monotonic(), "CA1")
    url = inbound.stream_url("https://api.example.test", token)
    assert f"/stream/{token}?" in url and "t=" not in url
    record = logging.LogRecord("uvicorn.error", logging.INFO, "", 0, '%s - "WebSocket %s" [accepted]', ("1.2.3.4:5", f"/v1/telephony/exotel/stream/{token}?sample-rate=16000"), None)
    RedactWebSocketFilter().filter(record)
    assert token not in record.getMessage() and "/v1/telephony/exotel/stream/<redacted>?<redacted>" in record.getMessage()


@arun
async def test_ten_calls_a_day_then_none_until_the_next_india_day() -> None:
    count = inbound.DayCount()
    for _ in range(10):
        assert isinstance(await admit(count=count), inbound.Admitted)
    assert isinstance(await admit(count=count), gate.Refused)
    tomorrow = datetime(2026, 11, 4, 18, 31, tzinfo=UTC)   # 00:01 on 5 Nov in India
    assert isinstance(await admit(count=count, now=tomorrow), inbound.Admitted)
    assert count.count(tomorrow) == 1 and count.count(tomorrow + timedelta(days=1)) == 0


@arun
async def test_every_other_number_keeps_the_strict_rule_with_the_caller() -> None:
    other = "+918000000009"
    out = await admit(start(to_number=other), calls=FakeCalls(status="completed"))
    assert isinstance(out, gate.Refused) and out.reason == "not_approved"
    out = await admit(start(to_number=other, from_number="+4915112345678"))
    assert isinstance(out, gate.Refused) and out.reason == "not_on_sandbox_list", "off the trial number the caller is still checked"
    out = await admit(start(to_number=other, from_number=""))
    assert isinstance(out, gate.Refused) and out.reason == "bad_number"
    out = await admit(start(to_number=other), calls=FakeCalls(from_number="+919000000001"))
    assert isinstance(out, gate.Refused) and out.reason == "not_approved", "Exotel's record must name the same caller"
    ok = await admit(start(to_number=other), calls=FakeCalls())
    assert isinstance(ok, inbound.Admitted) and ok.rule == "exotel_lookup" and ok.max_call_s is None
    no_rule = await inbound.admit(start(from_number="+4915112345678"), GS, find_line=FakeStore().line_find, calls=FakeCalls(), active_calls=0, now=NOW, our_sid=OUR_SID, trial=None)  # type: ignore[arg-type]
    assert isinstance(no_rule, gate.Refused) and no_rule.reason == "not_on_sandbox_list", "without the rule the trial number is checked like any other"


def test_the_caller_is_described_by_shape_and_yes_no_never_its_digits() -> None:
    assert inbound.caller_diagnosis("+919502380998", OWNER) == "caller_matches=yes caller_shape=plus12 caller_india=yes"
    assert inbound.caller_diagnosis("09502380998", OWNER).startswith("caller_matches=yes caller_shape=zero11")
    assert inbound.caller_diagnosis("+4915112345678", OWNER) == "caller_matches=no caller_shape=plus13 caller_india=no"
    assert inbound.caller_diagnosis("", OWNER) == "caller_matches=absent caller_shape=absent caller_india=no"
    assert inbound.caller_diagnosis("anonymous", OWNER) == "caller_matches=no caller_shape=digits0+letters caller_india=no"


def test_the_rule_exists_only_with_the_number_and_our_account_and_only_in_sandbox_mode() -> None:
    assert inbound.trial_rule("09513886363", OWNER, None, APP) is None
    assert inbound.trial_rule("", OWNER, OUR_SID, APP) is None
    r = inbound.trial_rule("09513886363", "", OUR_SID, "", max_call_s=900)
    assert r is not None and r.caller is None and r.app_id == "" and r.max_call_s == 180, "the caller and the app id are not needed for the rule"
    r = inbound.trial_rule("09513886363", "9502380998", OUR_SID, APP, max_call_s=900)
    assert r is not None and r.number == EXOPHONE and r.caller == OWNER and r.max_call_s == 180 and r.max_concurrent == 1
    base = dict(exotel_stream_secret="x" * 40, public_base_url="https://api.example.test", scheduler_email="s@example.test", scheduler_password="p" * 20, exotel_sid=OUR_SID,
                exotel_api_key="k", exotel_api_token="t", exotel_trial_number="09513886363", exotel_trial_caller=OWNER, exotel_trial_app_id=APP, telephony_sandbox_numbers=OWNER)
    sandbox = build_phone_inbound(Settings(telephony_mode="sandbox", **base), "http://rest", "http://sb", "anon")  # type: ignore[arg-type]
    assert sandbox is not None and sandbox.trial is not None and sandbox.trial.account_sid == OUR_SID and sandbox.our_sid == OUR_SID
    live = build_phone_inbound(Settings(telephony_mode="live", telephony_live_confirmed=True, **base), "http://rest", "http://sb", "anon")  # type: ignore[arg-type]
    assert live is None or live.trial is None


@arun
async def test_a_whole_trial_call_is_answered_and_the_log_names_the_rule_but_no_value() -> None:
    records: list[str] = []
    handler = logging.Handler()
    handler.emit = lambda record: records.append(record.getMessage())  # type: ignore[method-assign]
    log = logging.getLogger("app.telephony.inbound")
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    store = FakeStore()
    svc = service(store=store, calls=FakeCalls(from_number=None))
    svc.our_sid = "sim"   # the simulator's account_sid
    svc.trial = inbound.trial_rule(EXOPHONE, OWNER, "sim", APP)
    try:
        sim, task = await _call(svc, inbound.mint(SECRET, inbound.monotonic(), "CA123"), {"from_number": "+4915112345678"})   # no app id, an altered caller number
        await asyncio.sleep(0.5)
        await sim.hang_up()
        await asyncio.wait_for(task, 10)
    finally:
        log.removeHandler(handler)
    assert store.begun == [(TENANT, "en")]
    assert "exotel_inbound admitted rule=trial_pin_path" in records
    diag = next(r for r in records if r.startswith("exotel_start "))
    assert "account_matches=yes" in diag and "app_id_matches=absent" in diag and "trial_number=yes" in diag and "custom=-" in diag and "caller_matches=no caller_shape=plus13 caller_india=no" in diag
    assert all(v not in r for r in records for v in (APP, "sim ", OWNER, "9502380998", "CA123", "4915112345678")), "names and yes/no only, never a value"
    assert any(r.startswith("exotel_stream start call_sid_fp=") and r.split("call_sid_fp=")[1].split(" ")[0] == inbound.fingerprint(SECRET, "CA123") for r in records)


def test_on_the_trial_number_an_altered_caller_still_gets_the_stream_address_and_the_log_compares_it() -> None:
    from tests.test_ph_inbound import _client

    records: list[str] = []
    handler = logging.Handler()
    handler.emit = lambda record: records.append(record.getMessage())  # type: ignore[method-assign]
    log = logging.getLogger("app.telephony.inbound")
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    try:
        strict = service()
        assert _client(strict).get("/v1/telephony/exotel/stream-url", params={"CallSid": "CA9", "CallFrom": "+4915112345678"}).status_code == 403, "no trial rule: refused as before"
        svc = service()
        svc.trial = rule()
        r = _client(svc).get("/v1/telephony/exotel/stream-url", params={"CallSid": "CA9", "CallFrom": "+4915112345678", "From": "+4915112345678"})
    finally:
        log.removeHandler(handler)
    assert r.status_code == 200 and "/stream/" in r.json()["url"]
    line = [m for m in records if m.startswith("exotel_stream_url caller_matches=")][-1]
    assert line == "exotel_stream_url caller_matches=no caller_shape=plus13 caller_india=no from_vs_callfrom=same"
    assert "4915112345678" not in " ".join(records)
