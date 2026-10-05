"""The agent loop (app.agents.runtime) against an in-memory database that models the definer
functions' rules.

What is proved here: the loop obeys the allowlist, the schemas, the budgets, the kill flags
and the clock; a model that OBEYS an injection still cannot do anything outside its scope; a
retry replays instead of duplicating; and nothing a model, a company name or the database says
is ever logged or stored as free text. The real functions are proved in pgTAP and in
tests/integration; the real stack is also exercised end to end there."""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any

import pytest

from app.agents import inputs, runtime, selftest
from app.agents.errors import DataLayerUnavailable
from app.agents.llm.fake import (
    FakeProvider,
    call,
    final,
    respond,
    selftest_responses,
    selftest_script,
)
from app.agents.llm.interface import LlmRateLimited, LlmRequest, LlmResponse
from tests.agent_fakes import Clock, FakeAgentDb

CANARY = "CANARY-91c2d4"
STEP_KEY = re.compile(r"^[a-z0-9][a-z0-9_.:-]{0,63}$")


def make_db(**kw: Any) -> FakeAgentDb:
    db = FakeAgentDb(**kw)
    if db.input_sha256 is None:
        db.input_sha256 = inputs.input_sha256(inputs.model_input_from_company(db.facts))
    return db


def run_agent(db: FakeAgentDb, provider: FakeProvider) -> runtime.RunOutcome:
    return runtime.AgentRunner(
        db=db, llm=provider, spec=selftest.SELFTEST, now=db.clock, delimiter="feedc0de"
    ).run()


# ---- the happy path
def test_a_complete_run_writes_one_note_and_its_observations_and_succeeds() -> None:
    db, provider = make_db(), FakeProvider(selftest_script())
    out = run_agent(db, provider)
    assert out.status == "succeeded" and out.error_code is None
    assert [e["kind"] for e in db.evidence] == ["note"]
    assert len(db.claims) == 2
    assert all(c["evidence_id"] == db.evidence[0]["id"] for c in db.claims), (
        "claims link to the run's own note"
    )
    assert all(c["confidence"] == "unverified" and c["created_via"] == "agent" for c in db.claims)
    assert db.finished == [("succeeded", None)]
    assert len(provider.requests) == 3


def test_usage_is_recorded_for_every_model_call() -> None:
    db = make_db()
    run_agent(db, FakeProvider(selftest_script()))
    assert [k for k in db.steps if k.startswith("usage-")] == ["usage-1", "usage-2", "usage-3"]
    assert db.used["in"] == 3 * 100 and db.used["out"] == 3 * 50


def test_step_keys_are_deterministic_and_valid_for_the_database() -> None:
    a, b = make_db(), make_db()
    run_agent(a, FakeProvider(selftest_script()))
    run_agent(b, FakeProvider(selftest_script()))
    assert list(a.steps) == list(b.steps) and all(STEP_KEY.match(k) for k in a.steps)


def test_a_retry_after_a_crash_replays_the_same_steps_and_duplicates_nothing() -> None:
    db = make_db()

    class Crash(BaseException):  # not an Exception: nothing in the loop may swallow it
        pass

    def crash(_: LlmRequest) -> LlmResponse:
        raise Crash

    first = FakeProvider([*selftest_script()[:2], crash])
    with pytest.raises(Crash):
        run_agent(db, first)
    snapshot = (len(db.evidence), len(db.claims))
    assert db.status == "running", "a crash finishes nothing"
    out = run_agent(db, FakeProvider(selftest_script()))
    assert out.status == "succeeded"
    assert (len(db.evidence), len(db.claims)) == (1, 2) == snapshot, (
        "no second note, no second claim"
    )
    assert db.used["writes"] == 3 and db.used["in"] == 3 * 100, (
        "replayed steps are not charged twice"
    )


# ---- a model that OBEYS an injection
def test_unknown_tools_and_hostile_arguments_are_refused_and_change_nothing() -> None:
    hostile = respond(
        call("send_email", to="x@demo.test", body=CANARY),
        call("agent_write_evidence", text="direct"),
        call("write_note", text="ok", tenant_id=str(uuid.uuid4())),
        call("write_note;drop table claims", text="x"),
        call("write_observation", value="v", stance="supports"),  # before any note: nothing to link
    )
    db = make_db()
    out = run_agent(db, FakeProvider([hostile, final()]))
    assert out.refused_calls == 5
    assert not any(c["value"] == "v" for c in db.claims), "an observation before a note is refused"
    assert all(
        s["tool"] in {"refused_call", "usage", "agent_write_evidence", "agent_write_claim"}
        for s in db.steps.values()
    ), "refused calls are recorded under a fixed name, never the model's"


def test_an_obeying_model_cannot_exceed_the_write_budget() -> None:
    greedy = respond(
        call("write_note", text="n"),
        *[call("write_observation", value=f"v{i}", stance="supports") for i in range(4)],
    )
    db = make_db(max_writes=2)
    out = run_agent(db, FakeProvider([greedy, final()]))
    assert db.used["writes"] <= 2 and len(db.evidence) + len(db.claims) <= 2
    assert out.status == "failed" and out.error_code == "budget"


def test_at_most_a_few_tool_calls_per_turn_are_executed() -> None:
    many = respond(*[call("write_note", text=f"n{i}") for i in range(20)])
    db = make_db()
    out = run_agent(db, FakeProvider([many, final()]))
    assert out.refused_calls == 19, "one note is written; the other nineteen are refused or ignored"
    assert len(db.evidence) == 1, "one note per run, whatever the model asks for"
    assert db.used["tool_calls"] <= selftest.SELFTEST.max_calls_per_turn, (
        "calls beyond the per-turn cap are ignored, not even recorded"
    )


# ---- limits, kill flags, the clock
def test_a_cancel_between_steps_stops_before_the_next_model_call() -> None:
    db = make_db()
    steps = selftest_responses()

    def cancel_during_turn_two(request: LlmRequest) -> LlmResponse:
        db.cancel()  # the user cancels while the model is thinking
        return steps[1]

    provider = FakeProvider([steps[0], cancel_during_turn_two, steps[2]])
    out = run_agent(db, provider)
    assert out.status == "cancelled"
    assert len(provider.requests) == 2, "no third model call"
    assert db.claims == [], "turn 2's writes were not executed after the cancel"


def test_a_cancel_noticed_between_turns_saves_the_next_model_call() -> None:
    """The database would refuse the next write anyway; the loop must not pay for the next call."""
    db = make_db()
    # the cancel lands right after turn 1's note
    db.after["write_evidence"] = lambda d: d.cancel()
    provider = FakeProvider(selftest_script())
    out = run_agent(db, provider)
    assert out.status == "cancelled"
    assert len(provider.requests) == 1


def test_an_expiry_noticed_between_turns_saves_the_next_model_call() -> None:
    clock = Clock()
    db = make_db(clock=clock, ttl_seconds=60)
    db.after["write_evidence"] = lambda d: clock.advance(120)  # the clock passes the expiry
    provider = FakeProvider(selftest_script())
    out = run_agent(db, provider)
    assert out.status == "expired" and out.error_code == "expired"
    assert len(provider.requests) == 1
    assert db.claims == []


def test_the_run_stops_when_the_clock_passes_its_expiry() -> None:
    clock = Clock()
    db = make_db(clock=clock, ttl_seconds=60)
    steps = selftest_responses()

    def slow(request: LlmRequest) -> LlmResponse:
        clock.advance(120)
        return steps[1]

    out = run_agent(db, FakeProvider([steps[0], slow, steps[2]]))
    assert out.status == "expired" and out.error_code == "expired"
    assert db.finished[-1] == ("expired", "expired")
    assert db.claims == [], "nothing is written after the expiry"


def test_the_platform_switch_turning_off_mid_run_kills_the_run() -> None:
    db = make_db()
    db.before["write_evidence"] = lambda d: setattr(d, "switches_on", False)
    out = run_agent(db, FakeProvider(selftest_script()))
    assert out.status == "killed" and out.error_code == "killed"
    assert db.evidence == []


def test_budget_exhaustion_on_usage_stops_before_any_tool_runs() -> None:
    db = make_db(max_input_tokens=50)  # the first call alone costs 100
    out = run_agent(db, FakeProvider(selftest_script()))
    assert out.status == "failed" and out.error_code == "budget"
    assert db.evidence == [] and db.claims == []


def test_losing_the_run_to_the_database_ends_quietly_without_finishing() -> None:
    db = make_db()
    db.denied = True
    out = run_agent(db, FakeProvider(selftest_script()))
    assert out.status == "denied" and db.finished == []


def test_a_run_that_is_not_running_is_left_alone() -> None:
    db = make_db()
    db.status = "cancelled"
    provider = FakeProvider(selftest_script())
    out = run_agent(db, provider)
    assert out.status == "not_running" and provider.requests == [] and db.finished == []


def test_a_changed_input_fails_the_run_before_the_model_sees_anything() -> None:
    db = make_db()
    db.facts["name"] = "Renamed After Start"
    provider = FakeProvider(selftest_script())
    out = run_agent(db, provider)
    assert out.status == "failed" and out.error_code == "tool_failed"
    assert provider.requests == [] and db.evidence == []


# ---- structured output
def test_an_invalid_final_output_gets_one_repair_attempt_then_fails() -> None:
    bad = respond(structured={"summary": CANARY})
    db = make_db()
    provider = FakeProvider([bad, bad, bad])
    out = run_agent(db, provider)
    assert out.status == "failed" and out.error_code == "invalid_output"
    assert len(provider.requests) == 2, "the original try and exactly one repair"
    repair_text = " ".join(
        b.text for b in provider.requests[1].blocks if b.trust.value != "untrusted"
    )
    assert CANARY not in repair_text, "the repair request never echoes what the model said"


def test_a_valid_output_after_the_repair_succeeds() -> None:
    db = make_db()
    out = run_agent(db, FakeProvider([respond(structured={"nope": 1}), final()]))
    assert out.status == "succeeded"


def test_a_response_with_nothing_in_it_is_invalid_output() -> None:
    out = run_agent(make_db(), FakeProvider([respond(), respond()]))
    assert out.status == "failed" and out.error_code == "invalid_output"


def test_a_provider_error_is_a_model_failure() -> None:
    db = make_db()
    out = run_agent(db, FakeProvider([LlmRateLimited()]))
    assert out.status == "failed" and out.error_code == "model_failed"
    assert db.finished == [("failed", "model_failed")]


def test_an_unreachable_data_layer_ends_the_run_as_failed() -> None:
    db = make_db()

    def boom(d: FakeAgentDb) -> None:
        raise DataLayerUnavailable

    db.before["record_usage"] = boom
    out = run_agent(db, FakeProvider(selftest_script()))
    assert out.status == "failed" and out.error_code == "tool_failed"


def test_a_run_with_no_company_to_read_ends_before_any_reservation_or_model_call() -> None:
    db, provider = make_db(), FakeProvider(selftest_script())
    db.facts = {}  # a lead without a company: the database layer has nothing to read
    out = run_agent(db, provider)
    assert out.status == "failed" and out.error_code == "tool_failed"
    assert provider.requests == [] and db.reserve_requests == [], "no model call, no reservation"
    assert db.finished == [("failed", "tool_failed")]


# ---- the daily cost cap: the worst case of every call is reserved BEFORE the call
class _OtherModel(FakeProvider):
    model_id = "some-model-nobody-priced"


def test_the_worst_case_is_reserved_before_every_model_call() -> None:
    db = make_db()
    seen: list[int] = []

    def check(provider_request: LlmRequest) -> LlmResponse:
        # at the moment the model is called, this call's reservation must already exist
        seen.append(len(db.reserve_requests))
        return selftest_responses()[len(seen) - 1]

    out = run_agent(db, FakeProvider([check, check, check]))
    assert out.status == "succeeded"
    assert seen == [1, 2, 3], "reserve (turn N) happens before the Nth model call"
    assert [r[0] for r in db.reserve_requests] == ["usage-1", "usage-2", "usage-3"]
    assert all(STEP_KEY.fullmatch(r[0]) for r in db.reserve_requests)


def test_the_reservation_names_the_clients_model_and_declares_its_bounds() -> None:
    db, provider = make_db(), FakeProvider(selftest_script())
    run_agent(db, provider)
    for (_, model, max_in, max_out), request in zip(
        db.reserve_requests, provider.requests, strict=True
    ):
        assert model == "fake-selftest" == provider.model_id
        assert max_out == request.max_output_tokens
        assert max_in == runtime.input_token_bound(request)
        sent = sum(len(b.text.encode("utf-8")) for b in request.blocks)
        assert max_in >= sent + runtime.INPUT_TOKEN_OVERHEAD, "bytes bound the tokens"


def test_the_input_bound_counts_bytes_and_tool_definitions() -> None:
    from app.agents.llm.interface import Block, ToolSpec, Trust

    plain = LlmRequest(
        blocks=(Block(Trust.SYSTEM, "abc"),), tools=(), max_output_tokens=10, final_result=None
    )
    assert runtime.input_token_bound(plain) == 3 + runtime.INPUT_TOKEN_OVERHEAD
    multibyte = LlmRequest(
        blocks=(Block(Trust.UNTRUSTED, "é€"),), tools=(), max_output_tokens=10, final_result=None
    )
    assert runtime.input_token_bound(multibyte) == 2 + 3 + runtime.INPUT_TOKEN_OVERHEAD
    tool = ToolSpec("t", "d", {"type": "object"})
    with_tools = LlmRequest(
        blocks=(Block(Trust.SYSTEM, "abc"),),
        tools=(tool,),
        max_output_tokens=10,
        final_result=tool,
    )
    assert runtime.input_token_bound(with_tools) > runtime.input_token_bound(plain) + 20


def test_a_full_day_stops_the_run_before_the_model_is_ever_called() -> None:
    db, provider = make_db(), FakeProvider(selftest_script())
    db.cap_micros = 0
    out = run_agent(db, provider)
    assert out.status == "failed" and out.error_code == "budget"
    assert provider.requests == [], "no model call, so nothing was spent"
    assert db.finished == [("failed", "budget")]
    assert db.evidence == []


def test_the_cap_filling_mid_run_stops_before_the_next_call_and_keeps_what_was_written() -> None:
    db, provider = make_db(), FakeProvider(selftest_script())
    probe = FakeProvider(selftest_script())
    run_agent(make_db(), probe)
    first_worst = runtime.input_token_bound(probe.requests[0]) + probe.requests[0].max_output_tokens
    db.cap_micros = first_worst + 1  # room for the first call's worst case, not for a second one
    out = run_agent(db, provider)
    assert out.status == "failed" and out.error_code == "budget"
    assert len(provider.requests) == 1
    assert len(db.evidence) == 1, "what the first call produced stays (and stays 'unverified')"
    assert db.finished == [("failed", "budget")]


def test_a_model_with_no_price_fails_closed_before_any_call() -> None:
    db, provider = make_db(), _OtherModel(selftest_script())
    out = run_agent(db, provider)
    assert out.status == "failed" and out.error_code == "budget"
    assert provider.requests == []


def test_a_zero_price_fails_closed_too() -> None:
    db, provider = make_db(), FakeProvider(selftest_script())
    db.prices["fake-selftest"] = (0, 1_000_000)
    out = run_agent(db, provider)
    assert out.status == "failed" and out.error_code == "budget"
    assert provider.requests == []


def test_a_failed_model_call_of_unknown_outcome_is_not_refunded() -> None:
    from app.agents.llm.interface import LlmTimeout

    db = make_db()
    out = run_agent(db, FakeProvider([LlmTimeout()]))
    assert out.error_code == "model_failed"
    assert db.reservations.get("usage-1", 0) > 0 and db.day_spend_micros > 0, (
        "the call may have been billed before it failed, so its reservation keeps counting"
    )


# ---- nothing the model says is kept or logged
def test_model_output_never_reaches_the_ledger_or_the_logs_except_inside_the_note_itself(
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    hostile = respond(
        call(f"tool_{CANARY}", payload=CANARY),
        call("write_note", text=f"note {CANARY}"),
        call("write_note", text=f"second {CANARY}", extra=CANARY),
    )
    db = make_db()
    run_agent(db, FakeProvider([hostile, *selftest_script()[1:]]))
    assert CANARY not in caplog.text
    for key, step in db.steps.items():
        assert (
            CANARY not in key and CANARY not in step["tool"] and CANARY not in str(step["result"])
        )


# ---- a reservation that is never settled (ADR 0013, "Open reservations")
@pytest.mark.parametrize("error_code", ["rate_limited", "rejected", "not_configured"])
def test_a_call_that_provably_never_reached_billing_is_released_at_zero(error_code: str) -> None:
    from app.agents.llm import interface

    errors = {
        "rate_limited": interface.LlmRateLimited,
        "rejected": interface.LlmRejected,
        "not_configured": interface.LlmNotConfigured,
    }
    db = make_db()
    out = run_agent(db, FakeProvider([errors[error_code]()]))
    assert out.status == "failed" and out.error_code == "model_failed"
    assert db.released == [("usage-1", error_code)]
    assert db.reservations == {} and db.day_spend_micros == 0, "nothing stays counted"


@pytest.mark.parametrize("error_code", ["unavailable", "timeout", "bad_response"])
def test_a_call_that_may_have_been_billed_stays_open_at_its_worst_case(error_code: str) -> None:
    from app.agents.llm import interface

    errors = {
        "unavailable": interface.LlmUnavailable,
        "timeout": interface.LlmTimeout,
        "bad_response": interface.LlmBadResponse,
    }
    db = make_db()
    out = run_agent(db, FakeProvider([errors[error_code]()]))
    assert out.error_code == "model_failed"
    assert db.released == [], "an unknown outcome is never released"
    assert db.reservations.get("usage-1", 0) > 0 and db.day_spend_micros > 0


def test_the_not_billed_list_is_exactly_the_documented_three() -> None:
    assert runtime.NOT_BILLED == {"rate_limited", "rejected", "not_configured"}


def test_a_failed_release_never_hides_the_model_failure() -> None:
    from app.agents.llm import interface

    db = make_db()

    def boom(d: FakeAgentDb) -> None:
        raise DataLayerUnavailable

    db.before["release_cost"] = boom
    out = run_agent(db, FakeProvider([interface.LlmRateLimited()]))
    assert out.status == "failed" and out.error_code == "model_failed"
