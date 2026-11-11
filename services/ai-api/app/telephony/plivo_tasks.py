"""The Lead Desk call flow on Plivo (job 3 step 3, owner 10 Nov 2026): a task the owner APPROVED (Vijaya's plan card) places its calls here, one person at a time.

  TaskRunner (app/tasks/runner.py)  ->  PlivoTaskDialer.call(...)  ->  PlivoOutbound.place(...)  [the gate decides: mode, sandbox list, hours 09:00-21:00 IST, DND, consent, "says it is an AI", concurrency]
                                                                    ->  wait for the call row to end  ->  CallResult

Before a dial the DATABASE has already decided the money: `task_claim` hands out the next person only while the task is running and under its cap (a paused or capped task claims nobody), and the runner adds the
cost of each finished call (`task_contact_result`), which pauses the task at the cap. Nothing here calculates a price. Real calls go only to numbers on the sandbox list; any other number is refused by the gate,
the refusal is kept as a refused call (with its closed word) and the person's row ends `failed`.

What the result says: an answered call where the person spoke returns the call's own record (11 Nov 2026): the outcome, a one-line English summary, and a CHECKED answer for each question of the plan (see outcome.clean_answers). A call where nobody spoke, or whose record did not reach us, ends `unclear` with no answers and a transcript of the one line we know we
said, the opening, which carries the AI mention. The opening is the gate's own check, so a task call that would not say it is an AI is refused before it dials."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import math
import time
import uuid
from collections.abc import Callable
from typing import Any

from app.tasks.dialer import CallResult
from app.telephony import persona
from app.telephony.handover import FINISHED
from app.telephony.plivo_api import PlivoError
from app.telephony.plivo_outbound import (
    MAX_GOAL,
    OutboundRefused,
    OutboundRepo,
    PlivoOutbound,
    opening_for,
)

log = logging.getLogger("app.telephony.plivo_tasks")
ACTIVE = ("queued", "ringing", "in_progress")
PURPOSE = "sales_followup"   # the stricter gate rules (promotional): do-not-disturb unknown refuses; every task call is treated as promotional until the owner decides otherwise


def ask_list(questions: list[dict[str, Any]]) -> tuple[dict[str, str], ...]:
    """The plan's questions as the call's record needs them: {key, type, text} only, the plan's own keys."""
    return tuple({"key": str(q["key"]), "type": str(q.get("type") or "text"), "text": str(q.get("text") or "")} for q in questions if q.get("key"))


def goal_text(goal: str, questions: list[dict[str, Any]]) -> str:
    """The approved plan as the words the assistant gets: the goal, then the questions in order. Cut at a word end inside the limit."""
    asks = "; ".join(str(q.get("text") or "").strip() for q in questions if q.get("text"))
    text = " ".join(f"{goal.strip()} Ask, one at a time: {asks}.".split()) if asks else " ".join(goal.split())
    if len(text) <= MAX_GOAL:
        return text
    return text[:MAX_GOAL].rsplit(" ", 1)[0]


class PlivoTaskDialer:
    """`app.tasks.dialer.Dialer` on Plivo. Blocks for the length of the call (the task runs in the background, one person at a time); a call still running at `max_wait_s` is given up on here and ended by Plivo's own time limit."""

    name = "plivo"

    def __init__(self, outbound: PlivoOutbound, repo: OutboundRepo, *, max_wait_s: float = 230.0, poll_s: float = 2.0, sleep: Callable[[float], None] = time.sleep,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self._outbound, self._repo, self._max_wait, self._poll, self._sleep, self._clock = outbound, repo, max_wait_s, poll_s, sleep, clock

    def call(self, *, business: str, language: str, questions: list[dict[str, Any]], template: str, seed: str, phone: str = "", token: str = "", tenant_id: uuid.UUID | None = None, goal: str = "") -> CallResult:
        if not phone or not token or tenant_id is None:
            return _failed()
        try:
            placed = self._outbound.place(token, tenant_id, phone, language=language, purpose=PURPOSE, kind="goal", business=business, goal=goal_text(goal or "Follow up with the person.", questions), questions=ask_list(questions))
        except OutboundRefused as exc:
            log.info("plivo_task call refused reason=%s", exc.reason)   # a closed word; the refused call row holds it too
            return _failed()
        except PlivoError as exc:
            log.warning("plivo_task call not placed reason=%s", exc.reason)
            return _failed()
        deadline = self._clock() + self._max_wait
        state: dict[str, Any] | None = None
        while self._clock() < deadline:
            state = self._repo.state(token, tenant_id, placed.call_id)
            if state is not None and state.get("state") not in ACTIVE:
                break
            self._sleep(self._poll)
        if state is None or state.get("state") in ACTIVE:
            return _failed(minutes=math.ceil(self._max_wait / 60))   # still going when we gave up: counted, never hidden
        end = str(state.get("state"))
        seconds = float(state.get("duration_s") or 0)
        if end in ("no_answer", "busy"):
            return CallResult("no_answer", None, {}, [], 0, simulated=False)
        if end in ("failed", "refused", "cancelled"):
            return _failed()
        opening = persona.opening_line(language, business=business, assistant=None, customer=None, owner_line=opening_for("goal", language), inbound=False)
        minutes = max(1, math.ceil(seconds / 60))
        learned = FINISHED.take(placed.call_id) if end == "completed" else None
        if learned is None or not any(t.get("who") == "caller" for t in learned.transcript):
            # nobody spoke, or the record did not reach us (a restart): what is known is only the opening, as before; the call itself is in the Calls list
            return CallResult("unclear", None, {}, [{"who": "assistant", "text": opening}], minutes, simulated=False)
        lines = [{"who": "assistant" if t.get("who") == "assistant" else "contact", "text": " ".join(str(t.get("text", "")).split())[:400]} for t in learned.transcript[:80]]
        if lines[0]["who"] != "assistant":
            lines.insert(0, {"who": "assistant", "text": opening})   # the opening (which says it is an AI) is always the first line of a task call's record
        captured: dict[str, Any] = dict(learned.answers)
        if learned.answers_how:
            captured["_how"] = learned.answers_how   # per answer: said | implied, and the transcript line it came from (keys that start with "_" are not answers)
        outcome = learned.outcome if learned.outcome in ("positive", "negative", "unclear") else "unclear"
        return CallResult(outcome, learned.category, captured, lines, minutes, simulated=False, summary=learned.summary)


def _failed(minutes: int = 0) -> CallResult:
    return CallResult("failed", None, {}, [], minutes, simulated=False)
