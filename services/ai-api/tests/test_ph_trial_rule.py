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
    assert calls.asked == [], "the trial rule does not ask Exotel's call record"


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
        (dict(st=start(app_id="")), "trial_app_id"),                               # Exotel named no app id: not admitted
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
        sim, task = await _call(svc, inbound.mint(SECRET, inbound.monotonic(), "CA123"), {"custom": {"app_id": APP}})
        await asyncio.sleep(0.5)
        await sim.hang_up()
        await asyncio.wait_for(task, 10)
    finally:
        log.removeHandler(handler)
    assert store.begun == [(TENANT, "en")]
    assert "exotel_inbound admitted rule=trial_number" in records
    diag = next(r for r in records if r.startswith("exotel_start "))
    assert "account_matches=yes" in diag and "app_id_matches=yes" in diag and "trial_number=yes" in diag and "custom=app_id" in diag
    assert all(v not in r for r in records for v in (APP, "sim ", OWNER, "9502380998", "CA123")), "names and yes/no only, never a value"
