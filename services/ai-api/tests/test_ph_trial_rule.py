"""The shared trial number's rule (owner, 4 Nov 2026): Exotel's shared trial ExoPhone records its calls under Exotel's trial host account, so our "is this call real" lookup can never confirm one.
On THAT number only, in sandbox mode only, a call is admitted when ALL hold: our per-call signed token, the one caller, the start message's account_sid = ours, its app id = ours, no other call open,
at most 10 a day, cut at 3 minutes. Every other number keeps the strict Exotel lookup. The log says which rule admitted each call, and whether the account and app id matched (yes / no, never the value)."""

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
    return await inbound.admit(st or start(), gs, find_line=s.line_find, calls=calls if calls is not None else FakeCalls(status="completed"), active_calls=active, now=now,  # type: ignore[arg-type]
                               our_sid=OUR_SID, trial=trial if trial is not None else rule(), trial_count=count if count is not None else inbound.DayCount())


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
async def test_on_the_trial_number_a_call_is_admitted_when_all_hold_without_the_exotel_lookup() -> None:
    calls = FakeCalls(status="completed")   # the lookup would refuse it
    out = await admit(calls=calls)
    assert isinstance(out, inbound.Admitted) and out.rule == "trial_number" and out.tenant_id == TENANT and out.max_call_s == 180
    assert calls.asked == ["CA9"], "Exotel's record is asked once first; it does not confirm, so the trial rule decides"


@arun
async def test_on_the_trial_number_exotels_own_confirmation_still_wins() -> None:
    out = await admit(calls=FakeCalls())
    assert isinstance(out, inbound.Admitted) and out.rule == "exotel_lookup" and out.max_call_s is None


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
        (dict(st=start(from_number="+919000000002")), "trial_caller"),            # on the sandbox list, but not the trial's caller
        (dict(st=start(account_sid="someone-else")), "trial_account"),
        (dict(st=start(account_sid="")), "trial_account"),
        (dict(st=start(app_id="999")), "trial_app_id"),
        (dict(active=1), "trial_busy"),
        (dict(count=full), "trial_day_limit"),
        (dict(gs=gate.Settings(mode="live", sandbox_numbers=frozenset({OWNER}), outbound=False, live_confirmed=True)), "trial_not_sandbox"),
        (dict(store=FakeStore(line={"tenant_id": str(TENANT), "inbound_on": False})), "inbound_off"),   # the gate still decides after the rule
        (dict(st=start(from_number="+919876543210")), "not_on_sandbox_list"),     # the sandbox list comes first, as for every call
    ]
    for over, reason in cases:
        out = await admit(**over)
        assert isinstance(out, gate.Refused) and out.reason == reason, (over, out)
        assert reason in gate.REASONS


@arun
async def test_the_app_id_is_checked_only_when_exotel_names_one() -> None:
    absent = await admit(start(app_id=""))
    assert isinstance(absent, inbound.Admitted) and absent.rule == "trial_number", "Exotel's start message names no app id (owner: then it is not a condition)"
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
async def test_every_other_number_keeps_the_strict_exotel_lookup() -> None:
    other = "+918000000009"
    out = await admit(start(to_number=other), calls=FakeCalls(status="completed"))
    assert isinstance(out, gate.Refused) and out.reason == "not_approved"
    ok = await admit(start(to_number=other), calls=FakeCalls())
    assert isinstance(ok, inbound.Admitted) and ok.rule == "exotel_lookup" and ok.max_call_s is None
    no_rule = await inbound.admit(start(), GS, find_line=FakeStore().line_find, calls=FakeCalls(status="completed"), active_calls=0, now=NOW, our_sid=OUR_SID, trial=None)  # type: ignore[arg-type]
    assert isinstance(no_rule, gate.Refused) and no_rule.reason == "not_approved", "without the rule the trial number is checked like any other"


def test_the_rule_exists_only_with_every_part_and_only_in_sandbox_mode() -> None:
    assert inbound.trial_rule("09513886363", OWNER, OUR_SID, "") is None
    assert inbound.trial_rule("09513886363", OWNER, None, APP) is None
    assert inbound.trial_rule("", OWNER, OUR_SID, APP) is None
    assert inbound.trial_rule("09513886363", "", OUR_SID, APP) is None
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
    svc = service(store=store, calls=FakeCalls(status="completed"))
    svc.our_sid = "sim"   # the simulator's account_sid
    svc.trial = inbound.trial_rule(EXOPHONE, OWNER, "sim", APP)
    try:
        sim, task = await _call(svc, inbound.mint(SECRET, inbound.monotonic(), "CA123"))   # no app id, as Exotel sends it
        await asyncio.sleep(0.5)
        await sim.hang_up()
        await asyncio.wait_for(task, 10)
    finally:
        log.removeHandler(handler)
    assert store.begun == [(TENANT, "en")]
    assert "exotel_inbound admitted rule=trial_number" in records
    diag = next(r for r in records if r.startswith("exotel_start "))
    assert "account_matches=yes" in diag and "app_id_matches=absent" in diag and "trial_number=yes" in diag and "custom=-" in diag
    assert all(v not in r for r in records for v in (APP, "sim ", OWNER, "9502380998", "CA123")), "names and yes/no only, never a value"
    assert any(r.startswith("exotel_stream start call_sid_fp=") and r.split("call_sid_fp=")[1].split(" ")[0] == inbound.fingerprint(SECRET, "CA123") for r in records)
