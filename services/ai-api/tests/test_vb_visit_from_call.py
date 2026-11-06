"""Visit booking from a call (owner, 5 Nov 2026; job calls-like-a-pro part 5): the call offers the business's next FREE slots, the outcome keeps a visit time ONLY if it is one of them, and
Today says "a caller wants to visit on <day, time>" (migration 20261231180000; pgTAP 164)."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from typing import Any

from app.telephony import outcome as outcome_mod
from app.telephony import persona
from app.telephony.inbound_routes import visit_label
from app.today.service import needs_item

OFFERED = ("2026-11-03T10:00:00+05:30", "2026-11-03T10:30:00+05:30")


class Model:
    def __init__(self, answer: str) -> None:
        self.answer = answer
        self.systems: list[str] = []

    async def stream(self, system: str, messages: list[dict[str, str]], model: str) -> AsyncIterator[str]:
        self.systems.append(system)
        yield self.answer


def outcome(answer: str, offered: tuple[str, ...] = OFFERED) -> outcome_mod.CallOutcome:
    base = outcome_mod.CallOutcome("completed", "goodbye", "unclear", None, transcript=[{"who": "caller", "text": "Tuesday at 10 is fine"}])
    return asyncio.run(outcome_mod.from_model(Model(answer), "m", base, "en", "2026-11-02", offered_slots=offered))


def test_the_visit_the_caller_agreed_to_is_kept_only_when_it_was_offered() -> None:
    got = outcome('{"summary": "Will visit Tuesday.", "outcome": "positive", "category": "visit_booked", "visit_at": "2026-11-03T04:30:00+00:00"}')
    assert got.captured.get("visit_at") == OFFERED[0], "the same instant, written as the offered slot"
    made_up = outcome('{"outcome": "positive", "category": "visit_booked", "visit_at": "2026-11-03T15:00:00+05:30"}')
    assert "visit_at" not in made_up.captured, "a time that was not offered is never kept"
    none_offered = outcome('{"outcome": "positive", "category": "visit_booked", "visit_at": "2026-11-03T10:00:00+05:30"}', offered=())
    assert "visit_at" not in none_offered.captured


def test_the_call_offers_only_the_free_slots_in_plain_words() -> None:
    labels = tuple(visit_label({"date": "2026-11-03", "start": s}) for s in ("10:00", "10:30"))
    assert labels == ("Tue 3 Nov 10:00", "Tue 3 Nov 10:30")
    system = persona.system_prompt(business="Lakshmi Silks", assistant=None, language="en", purpose="inbound", facts=[], customer_first_name=None, visit_slots=labels)
    assert "offer ONLY these free times" in system and "Tue 3 Nov 10:30" in system and "Never offer or agree to any other time" in system
    assert "offer ONLY" not in persona.system_prompt(business="X", assistant=None, language="en", purpose="inbound", facts=[], customer_first_name=None), "no slots: no visit offer"
    system, _ = outcome_mod.prompt([{"who": "caller", "text": "ok"}], "en", "2026-11-02", OFFERED)
    assert OFFERED[1] in system and "copied exactly from this list" in system


def test_today_says_it_in_india_time() -> None:
    item = needs_item({"kind": "visit_requested", "id": str(uuid.uuid4()), "customer": "A caller", "city": None, "agent": "followup_desk", "ref": "2026-11-03T04:30:00+00:00",
                       "amount_paise": None, "at": "2026-11-02T06:00:00+00:00", "target": {"type": "phone_call", "id": str(uuid.uuid4())}})
    assert item.summary == "A caller wants to visit on Tue 3 Nov, 10:00. Book it in Visits, then mark it done."


def test_an_inbound_call_reads_the_slots_and_offers_them(monkeypatch: Any) -> None:
    from app.telephony import inbound
    from tests.test_ph_inbound import EXOPHONE, OWNER, SECRET, FakeCalls, FakeStore, _call, service
    from tests.test_ph_trial_rule import APP

    class SlotStore(FakeStore):
        def visit_slots(self, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
            return [{"date": "2026-11-03", "start": "10:00", "starts_at": OFFERED[0]}]

    seen: dict[str, Any] = {}
    import app.telephony.inbound_routes as routes

    real = routes.run_call  # type: ignore[attr-defined]

    async def spy(plan: Any, *args: Any, **kwargs: Any) -> Any:
        seen["slots"] = plan.visit_slots
        return await real(plan, *args, **kwargs)

    monkeypatch.setattr(routes, "run_call", spy)
    store = SlotStore()
    svc = service(store=store, calls=FakeCalls(from_number=None))
    svc.our_sid = "sim"
    svc.trial = inbound.trial_rule(EXOPHONE, OWNER, "sim", APP)

    async def go() -> None:
        sim, task = await _call(svc, inbound.mint(SECRET, inbound.monotonic(), "CA123", inbound.TRIAL_MARK), {"to_number": "+918037091588"})
        await asyncio.sleep(0.3)
        await sim.hang_up()
        await asyncio.wait_for(task, 10)

    asyncio.run(go())
    assert seen.get("slots") == (OFFERED[0],)
