"""The assistant's loop: one run per message, in the agent runtime's frame (explicit and app-owned, no agent framework).

For each turn: check the run is still running and inside its time (the kill switches and the clock are re-read between steps), build the prompt, reserve the worst-case
cost of the call under the workspace's daily cap BEFORE it is made, call the model, record its usage, run the tools it asked for (looked up by exact name, arguments
parsed with a closed schema; an unknown tool or extra field is a refused step), then judge a final reply. The model can only ASK; what happens is the tools' doing, and the
tools only read through the caller's own rights or leave drafts.

THE CODE, NOT THE MODEL, decides what is shown as a fact:
  * sources are the handles the reply cites that a tool really returned in this run (unknown handles are dropped); an answer with none is asked for again, then replaced
    by a fixed "I could not find that" in the owner's language;
  * every rupee amount in an answer must be one a tool returned (or one the owner typed): the assistant never prices;
  * the reply must be written in the owner's language (decided by script, see language.py);
  * draft cards come from the drafts the tools made, never from what the model says it made."""

from __future__ import annotations

import hashlib
import json
import logging
import re
import secrets
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError

from app.agents.errors import (
    AgentDbError,
    AgentsDisabled,
    BudgetExhausted,
    CostCapReached,
    LimitReached,
    ReferenceRefused,
    RunDenied,
    RunExpired,
    RunNotRunning,
    ValueRefused,
)
from app.agents.llm.interface import Block, LlmClient, LlmError, LlmRequest
from app.agents.llm.routing import ModelRouter, as_router
from app.agents.runtime import NOT_BILLED, input_token_bound
from app.assistant import prompts
from app.assistant.db import AssistantDb
from app.assistant.language import NO_ANSWER, Language, reply_matches
from app.assistant.models import DraftCardOut, SourceOut
from app.assistant.tools import TOOLS, Ctx, Item, State
from app.errors import ApiError

logger = logging.getLogger("app.assistant.runner")

MAX_TURNS = 5
MAX_CALLS_PER_TURN = 5
MAX_ACTIONS_PER_RUN = 4
MAX_OUTPUT_TOKENS = 1500
REFUSED_TOOL = "refused_call"
FAILED_TOOL = "tool_error"

_MONEY = re.compile(
    r"(?:₹|\brs\.?|\binr\b|రూ\.?|रु\.?|ரூ\.?|ರೂ\.?)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)|([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:rupees?|/-|రూపాయల?|रुपये|ரூபாய்|ರೂಪಾಯಿ)",
    re.IGNORECASE,
)


def money_amounts(text: str) -> list[int]:
    """Every rupee amount written in a text, as integer paise."""
    found: list[int] = []
    for m in _MONEY.finditer(text):
        raw = (m.group(1) or m.group(2)).replace(",", "")
        whole, _, frac = raw.partition(".")
        found.append(int(whole) * 100 + int((frac + "00")[:2] or "0"))
    return found


@dataclass
class Reply:
    text: str
    language: Language
    kind: str
    sources: list[SourceOut] = field(default_factory=list)
    drafts: list[DraftCardOut] = field(default_factory=list)


@dataclass(frozen=True)
class Outcome:
    status: str  # succeeded | failed | cancelled | expired | killed | denied
    error_code: str | None = None
    reply: Reply | None = None
    turns: int = 0


class _Stop(Exception):
    def __init__(self, status: str, error_code: str | None) -> None:
        super().__init__(status)
        self.status, self.error_code = status, error_code


def _sha(obj: Any) -> str:
    return hashlib.sha256(
        json.dumps(
            obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str
        ).encode()
    ).hexdigest()


def source_of(item: Item) -> SourceOut:
    return SourceOut.model_validate(
        {
            "kind": item.type,
            "id": item.id,
            "label": item.label,
            "target": {"type": item.open[0], "id": item.open[1]} if item.open else None,
        }
    )


class AssistantRunner:
    def __init__(
        self,
        *,
        db: AssistantDb,
        llm: LlmClient | ModelRouter,
        ctx: Ctx,
        now: Callable[[], datetime] | None = None,
        delimiter: str | None = None,
    ) -> None:
        self._db, self._router, self._ctx = db, as_router(llm), ctx
        self._now = now or (lambda: datetime.now(UTC))
        self._delimiter = delimiter or secrets.token_hex(8)
        self._state: State = ctx.state

    # ------------------------------------------------------------------ the run
    def run(
        self,
        *,
        question: str,
        language: Language,
        history: list[dict[str, Any]],
        emit: Callable[[str, dict[str, Any]], None],
        message_id: uuid.UUID,
    ) -> Outcome:
        turns = 0
        try:
            run = self._db.read_run()
            if run.status != "running":
                return Outcome("failed", "tool_failed")
            if run.expires_at <= self._now():
                raise RunExpired
            results: list[Block] = []
            notes: tuple[str, ...] = ()
            repaired: set[str] = set()
            actions = 0
            for turn in range(1, MAX_TURNS + 1):
                turns = turn
                self._guard()
                request = prompts.build_request(
                    turn=turn,
                    delimiter=self._delimiter,
                    question=question,
                    language=language,
                    history=history,
                    results=results,
                    notes=notes,
                    today=self._now(),
                    max_output_tokens=MAX_OUTPUT_TOKENS,
                )
                llm = self._pick(request)
                self._db.reserve_cost(
                    f"usage-{turn}",
                    model=llm.model_id,
                    max_input_tokens=input_token_bound(request),
                    max_output_tokens=request.max_output_tokens,
                )
                try:
                    response = llm.complete(request)
                except LlmError as exc:
                    logger.warning(
                        "assistant run %s: model call failed (%s)", self._ctx.run_id, exc.code
                    )
                    if exc.code in NOT_BILLED:
                        try:
                            self._db.release_cost(f"usage-{turn}", reason=exc.code)
                        except AgentDbError:
                            pass
                    raise _Stop("failed", "model_failed") from None
                self._db.record_usage(f"usage-{turn}", response.usage)

                notes = ()
                for index, call in enumerate(response.tool_calls):
                    if index >= MAX_CALLS_PER_TURN:
                        notes = (prompts.NOTE_TOOL_REFUSED,)
                        continue
                    key = f"t{turn}-c{index}"
                    tool = next((t for t in TOOLS if t.name == call.name), None)
                    args: Any = None
                    if tool is not None:
                        try:
                            args = tool.args.model_validate(call.arguments)
                        except ValidationError:
                            tool = None
                    if tool is None or (tool.action and actions >= MAX_ACTIONS_PER_RUN):
                        self._guard()
                        self._db.record_step(
                            key,
                            REFUSED_TOOL,
                            _sha({"name": call.name, "args": call.arguments}),
                            "refused",
                            None,
                        )
                        results.append(
                            prompts.result_block(
                                self._delimiter,
                                "refused_call",
                                "refused: not an allowed tool or not allowed arguments",
                                (),
                            )
                        )
                        notes = (prompts.NOTE_TOOL_REFUSED,)
                        continue
                    self._guard()
                    actions += 1 if tool.action else 0
                    status, items, note, facts = self._execute(tool, args)
                    self._db.record_step(
                        key,
                        tool.name,
                        _sha({"name": call.name, "args": call.arguments}),
                        "ok"
                        if status == "ok"
                        else ("refused" if status == "refused" else "failed"),
                        {"items": len(items)},
                    )
                    results.append(
                        prompts.result_block(self._delimiter, tool.name, note, items, facts)
                    )
                    if status != "ok":
                        notes = (prompts.NOTE_TOOL_REFUSED,)

                verdict = self._judge(response.structured, language, repaired)
                if isinstance(verdict, Reply):
                    return self._finish(verdict, message_id, emit, turns)
                if verdict is not None:
                    notes = (*notes, verdict)
                elif response.structured is not None:
                    break  # a final reply that was asked for again and is still not acceptable: the fixed reply below
                elif not response.tool_calls:
                    if "shape" in repaired:
                        break
                    repaired.add("shape")
                    notes = (*notes, prompts.NOTE_REPAIR_SHAPE)
            # no acceptable reply: a fixed one, in the owner's language, with whatever drafts were made
            fallback = Reply(NO_ANSWER[language], language, "refusal", [], list(self._state.drafts))
            return self._finish(
                fallback, message_id, emit, turns, status="failed", code="invalid_output"
            )
        except _Stop as stop:
            return self._end(stop.status, stop.error_code, turns)
        except AgentDbError as exc:
            status, code = self._classify(exc)
            return self._end(status, code, turns)

    # ------------------------------------------------------------------ the tools
    def _execute(
        self, tool: Any, args: Any
    ) -> tuple[str, tuple[Item, ...], str, tuple[tuple[str, str], ...]]:
        try:
            out = tool.handler(self._ctx, args)
        except ApiError as exc:
            return "refused", (), f"refused: {exc.code}", ()
        except (ValueRefused, ReferenceRefused):
            return "refused", (), "refused: not allowed", ()
        except (
            AgentsDisabled,
            BudgetExhausted,
            LimitReached,
            CostCapReached,
            RunDenied,
            RunExpired,
            RunNotRunning,
        ):
            raise
        except AgentDbError:
            return "failed", (), "failed: the data layer", ()
        except Exception as exc:  # a repository or service error: only its CLASS is kept
            logger.warning("assistant tool %s failed: %s", tool.name, exc.__class__.__name__)
            return "failed", (), "failed: unavailable", ()
        return (
            ("ok" if out.note == "ok" else "refused"),
            out.items,
            ("ok" if out.note == "ok" else f"refused: {out.note}"),
            out.facts,
        )

    # ------------------------------------------------------------------ judging a final reply
    def _judge(
        self, structured: dict[str, Any] | None, language: Language, repaired: set[str]
    ) -> Reply | str | None:
        """A Reply that may be shown, a fixed repair note to send back (once per kind), or None when there is no reply yet."""
        if structured is None:
            return None
        try:
            final = prompts.FinalReply.model_validate(structured)
        except ValidationError:
            return self._once("shape", prompts.NOTE_REPAIR_SHAPE, repaired)
        if final.language != language or not reply_matches(final.answer, language):
            return self._once("language", prompts.NOTE_REPAIR_LANGUAGE, repaired)
        known = [
            self._state.items[h] for h in dict.fromkeys(final.sources) if h in self._state.items
        ]
        if final.kind == "answer" and not known:
            return self._once("sources", prompts.NOTE_REPAIR_SOURCES, repaired)
        # an amount is stated only exactly as a tool returned it: not the owner's own number repeated back as if it were done, not a sum, not a guess
        if any(a not in self._state.allowed_paise for a in money_amounts(final.answer)):
            return self._once("money", prompts.NOTE_REPAIR_MONEY, repaired)
        return Reply(
            final.answer,
            language,
            final.kind,
            [source_of(i) for i in known] if final.kind == "answer" else [],
            list(self._state.drafts),
        )

    @staticmethod
    def _once(kind: str, note: str, repaired: set[str]) -> str | None:
        if kind in repaired:
            return None  # asked once already: the loop ends in the fixed reply
        repaired.add(kind)
        return note

    # ------------------------------------------------------------------ ending
    def _finish(
        self,
        reply: Reply,
        message_id: uuid.UUID,
        emit: Callable[[str, dict[str, Any]], None],
        turns: int,
        *,
        status: str = "succeeded",
        code: str | None = None,
    ) -> Outcome:
        self._guard()
        self._db.save_reply(
            message_id=message_id,
            text=reply.text,
            language=reply.language,
            sources=[{"type": s.kind, "id": str(s.id)} for s in reply.sources],
            drafts=[{"type": d.kind, "id": str(d.id)} for d in reply.drafts],
        )
        words = reply.text.split(" ")
        chunk = ""
        for word in words:
            chunk = f"{chunk} {word}" if chunk else word
            if len(chunk) >= 24:
                emit("text", {"type": "text", "delta": chunk + " "})
                chunk = ""
        if chunk:
            emit("text", {"type": "text", "delta": chunk})
        for source in reply.sources:
            emit("source", {"type": "source", **source.model_dump(mode="json")})
        for draft in reply.drafts:
            emit("draft", {"type": "draft", **draft.model_dump(mode="json")})
        try:
            self._db.finish(status, code)
        except AgentDbError as exc:
            logger.warning("assistant run could not be closed (%s)", exc.code)
        return Outcome(status, code, reply, turns)

    @staticmethod
    def _classify(exc: AgentDbError) -> tuple[str, str | None]:
        if isinstance(exc, RunDenied):
            return "denied", None
        if isinstance(exc, RunNotRunning):
            return "cancelled", "cancelled"
        if isinstance(exc, RunExpired):
            return "expired", "expired"
        if isinstance(exc, AgentsDisabled):
            return "killed", "killed"
        if isinstance(exc, BudgetExhausted | LimitReached | CostCapReached):
            return "failed", "budget"
        return "failed", "tool_failed"

    def _end(self, status: str, code: str | None, turns: int) -> Outcome:
        if status != "denied":
            try:
                self._db.finish(status, code)
            except AgentDbError as exc:
                logger.warning("assistant run could not be closed (%s)", exc.code)
        logger.info("assistant run ended: status=%s code=%s turns=%d", status, code or "-", turns)
        return Outcome(status, code, None, turns)

    def _pick(self, request: LlmRequest) -> LlmClient:
        """The model for THIS call (see ModelRouter.choose)."""
        return self._router.choose(request.task_class, self._db.ai_mode)

    def _guard(self) -> None:
        run = self._db.read_run()
        if run.status != "running" or run.cancel_requested_at is not None:
            raise RunNotRunning
        if run.expires_at <= self._now():
            raise RunExpired
