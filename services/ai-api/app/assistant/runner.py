"""The assistant's loop: one run per message, in the agent runtime's frame (explicit and app-owned, no agent framework).

For each turn: check the run is still running and inside its time (the kill switches and the clock are re-read between steps), build the prompt, reserve the worst-case
cost of the call under the workspace's daily cap BEFORE it is made, call the model, record its usage, run the tools it asked for (looked up by exact name, arguments
parsed with a closed schema; an unknown tool or extra field is a refused step), then judge a final reply. The model can only ASK; what happens is the tools' doing, and the
tools only read through the caller's own rights or leave drafts.

THE CODE, NOT THE MODEL, decides what is shown as a fact:
  * sources are the handles the reply cites that a tool really returned in this run (unknown handles are dropped); an answer with none is asked for again, then replaced
    by a fixed "I could not find that" in the owner's language;
  * an answer that names a tool, a function or an internal field (hygiene.py) is not shown: a fixed sentence in the owner's language takes its place;
  * every rupee amount in an answer must be one a tool returned (or one the owner typed): the assistant never prices;
  * the reply must be written in the owner's language (decided by script, see language.py);
  * draft cards come from the drafts the tools made, never from what the model says it made."""

from __future__ import annotations

import hashlib
import json
import logging
import re
import secrets
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError

from app.agents.errors import (
    AgentDbError,
    AgentsDisabled,
    BudgetExhausted,
    CostCapReached,
    LimitReached,
    ModelNotConfigured,
    ReferenceRefused,
    RunDenied,
    RunExpired,
    RunNotRunning,
    ValueRefused,
)
from app.agents.llm.interface import Block, LlmClient, LlmError, LlmRequest
from app.agents.llm.routing import ModelRouter, as_router
from app.agents.register import address
from app.agents.runtime import NOT_BILLED, input_token_bound
from app.assistant import prompts, router
from app.assistant.db import AssistantDb
from app.assistant.hygiene import leaked_names
from app.assistant.language import (
    COULD_NOT_ANSWER,
    NO_ANSWER,
    NO_MONEY_PENDING,
    NO_RECORD_HELP,
    PLAIN_WORDS,
    SEE_CARDS,
    WAITING_ALSO,
    WEB_SOURCES,
    Language,
    reply_matches,
)
from app.assistant.models import NOT_STORED_SOURCES, DraftCardOut, SourceOut
from app.assistant.notes import NOTES_HANDLE_LABEL, NOTES_ID
from app.assistant.tools import TOOLS, Ctx, Item, State, friendly_names
from app.assistant.web_tools import WEB_TOOL_NAMES, question_urls
from app.assistant.wording import is_money_held_question
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
    # job EA: the task a `confirm_action` reply proposes, or a `clarify` reply asks about (stored with the reply)
    task_id: uuid.UUID | None = None


@dataclass(frozen=True)
class Outcome:
    status: str  # succeeded | failed | cancelled | expired | killed | denied
    error_code: str | None = None  # what the run records (the database's own list)
    reply: Reply | None = None
    turns: int = 0
    # what the client is told when it is more precise than the recorded code: "model_busy" (the provider said 429) or "model_not_configured" (the model has no price row).
    # Neither is a spending limit, and the recorded code (model_failed) is the closest one the database knows.
    shown: str | None = None


RETRYABLE = frozenset({"timeout", "unavailable", "bad_response"})   # LlmError codes worth one more try; a 429, a refusal or a missing setting is not


class _Stop(Exception):
    def __init__(self, status: str, error_code: str | None, shown: str | None = None) -> None:
        super().__init__(status)
        self.status, self.error_code, self.shown = status, error_code, shown


def _sha(obj: Any) -> str:
    return hashlib.sha256(
        json.dumps(
            obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str
        ).encode()
    ).hexdigest()


def source_of(item: Item) -> SourceOut:
    link = (
        item.fields.get("map" if item.type == "place" else "address")
        if item.type in ("web", "place")
        else None
    )
    return SourceOut.model_validate(
        {
            "kind": item.type,
            "id": item.id,
            "label": item.label,
            "target": {"type": item.open[0], "id": item.open[1]} if item.open else None,
            "url": str(link) if link else None,
            "place_id": str(item.fields["place_id"])
            if item.type == "place" and item.fields.get("place_id")
            else None,
        }
    )


def web_sources_line(language: Language, items: list[Item]) -> str:
    """One line naming the web pages an answer rests on (the answer's text is what is kept)."""
    pages = [i for i in items if i.type == "web"]
    if not pages:
        return ""
    return f"{WEB_SOURCES[language]} " + "; ".join(
        f"{i.label} ({i.fields.get('address')})" for i in pages
    )


def hide_places(text: str, state: State, language: Language) -> str:
    """Google's terms keep us from storing the names and addresses of places: the answer's text is stored, so wherever it repeats one it says "(see the cards)" instead."""
    for item in state.items.values():
        if item.type != "place":
            continue
        address = str(item.fields.get("address") or "")
        for needle in (item.label, address, address.split(",")[0].strip()):
            if len(needle) >= 6:
                text = re.sub(re.escape(needle), SEE_CARDS[language], text, flags=re.IGNORECASE)
    return text


class AssistantRunner:
    def __init__(
        self,
        *,
        db: AssistantDb,
        llm: LlmClient | ModelRouter,
        ctx: Ctx,
        now: Callable[[], datetime] | None = None,
        delimiter: str | None = None,
        on_reply: Callable[[str, str], None] | None = None,
        help_on_empty: bool = False,
        typed_replies: bool = False,
        owner_notes: str = "",
        address_as: str = "",
    ) -> None:
        self.address_as = address_as.strip()   # how the person chose to be addressed (their profile); '' = the neutral forms only, never sir / madam
        self.owner_notes = owner_notes.strip()   # job EB: the owner's own notes; a source the model may cite ("From your notes")
        self._typed = typed_replies   # job EA: the conversational route stores the type of each reply (confirm_action, clarify); the written Ask does not
        # job EA: the conversational assistant says "no record" AND offers one way forward (NO_RECORD_HELP); the written Ask keeps the bare NO_ANSWER
        self._empty = NO_RECORD_HELP if help_on_empty else NO_ANSWER
        self._question = ""
        self._on_reply = on_reply  # job BD: the voice route speaks the finished answer here, while the run is still open (so it can be charged to it)
        self._db, self._router, self._ctx = db, as_router(llm), ctx
        self._now = now or (lambda: datetime.now(UTC))
        self._delimiter = delimiter or secrets.token_hex(8)
        self._state: State = ctx.state
        self._started = time.perf_counter()
        self._model_ms = 0.0  # time spent waiting for the model in this run (the part of a slow answer that is not ours)

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
        self._question = question
        try:
            run = self._db.read_run()
            if run.status != "running":
                return Outcome("failed", "tool_failed")
            if run.expires_at <= self._now():
                raise RunExpired
            results: list[Block] = []
            notes: tuple[str, ...] = ()
            repaired: set[str] = set()
            notes_handle: str | None = None
            if self.owner_notes:
                notes_item = self._state.add("notes", NOTES_ID, NOTES_HANDLE_LABEL, {}, None, money=tuple(money_amounts(self.owner_notes)))
                notes_handle = notes_item.handle
                results.append(prompts.notes_block(self._delimiter, notes_handle, self.owner_notes))
            tools_before = len(results)
            actions = 0
            # job BB: the tools offered are decided ONCE per question from the question and the lines before it (a deterministic router, no model call). A call to a tool that was not offered is refused.
            self._state.question_urls = question_urls(question)
            offered = router.offered_tools(question, history, self._web_tools())
            widened = (
                False  # job BD, the safety net: at most ONE widening per question, to every tool
            )
            for turn in range(1, MAX_TURNS + 1):
                turns = turn
                self._guard()
                # job DG: progress is told AS IT HAPPENS, so the first byte of the answer's stream does not wait for the whole run. The answer text itself is still sent only after the checks below
                # (cited sources, amounts, hygiene), because a sentence that fails them must never have been shown
                emit("step", {"type": "step", "step": "working"})
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
                    offered=offered,
                    widened=widened,
                    notes_handle=notes_handle,
                    address_as=self.address_as,
                )
                llm = self._pick(request)
                self._db.reserve_cost(
                    f"usage-{turn}",
                    model=llm.model_id,
                    max_input_tokens=input_token_bound(request),
                    max_output_tokens=request.max_output_tokens,
                )
                try:
                    called = time.perf_counter()
                    response = self._call_model(llm, request)
                    self._model_ms += (time.perf_counter() - called) * 1000.0
                except LlmError as exc:
                    logger.warning(
                        "assistant run %s: model call failed (%s)", self._ctx.run_id, exc.code
                    )
                    if exc.code in NOT_BILLED:
                        try:
                            self._db.release_cost(f"usage-{turn}", reason=exc.code)
                        except AgentDbError:
                            pass
                    raise _Stop(
                        "failed",
                        "model_failed",
                        "model_busy" if exc.code == "rate_limited" else None,
                    ) from None
                self._db.record_usage(f"usage-{turn}", response.usage)

                notes = ()
                for index, call in enumerate(response.tool_calls):
                    if index >= MAX_CALLS_PER_TURN:
                        notes = (prompts.NOTE_TOOL_REFUSED,)
                        continue
                    key = f"t{turn}-c{index}"
                    hidden = router.group_of(call.name)
                    if (
                        hidden is not None
                        and call.name not in offered
                        and not widened
                        and router.could_need(hidden, question, history)
                    ):
                        # a ROUTER MISS: the model asked for a tool the router did not offer and the question could need it. Offer everything once; count it in the log (tool and language only)
                        offered, widened = router.ALL_TOOLS, True
                        self._note_router_miss(call.name, language)
                    tool = next(
                        (t for t in TOOLS if t.name == call.name and t.name in offered), None
                    )
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
                    emit("step", {"type": "step", "step": "looking"})
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

                verdict = self._judge(response.structured, language, repaired, turn, searched=len(results) > tools_before)
                if isinstance(verdict, Reply) and verdict.kind == "refusal":
                    # the model says it cannot help. If a hidden group could have helped, ask once more with every tool offered (the one retry; its model call is counted like any other)
                    missed = (
                        None
                        if widened or turn >= MAX_TURNS or results
                        else router.missed_group(offered, question, history)
                    )
                    if missed is not None:
                        offered, widened = router.ALL_TOOLS, True
                        self._note_router_miss(f"none:{missed}", language)
                        notes = (*notes, prompts.NOTE_MORE_TOOLS)
                        continue
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
            self._note_fallback(turns, repaired)
            # no usable reply at all (blank or unreadable, still so after the one repair): the could-not-answer sentence. A reply the checks refused (no source, a made-up amount) keeps the kind "nothing found".
            text = self._nothing(language) if "shape" not in repaired or self._money_pending_none() else COULD_NOT_ANSWER[language]
            fallback = Reply(text, language, "answer" if self._money_pending_none() else "refusal", [], list(self._state.drafts))
            return self._finish(
                fallback, message_id, emit, turns, status="failed", code="invalid_output"
            )
        except _Stop as stop:
            return self._stopped(stop, language, message_id, emit, turns)
        except AgentDbError as exc:
            status, code, shown = self._classify(exc)
            return self._end(status, code, turns, shown)

    # ------------------------------------------------------------------ a chat turn with no tools (job EA)
    def run_chat(
        self,
        *,
        question: str,
        language: Language,
        history: list[dict[str, Any]],
        emit: Callable[[str, dict[str, Any]], None],
        message_id: uuid.UUID,
        assistant_name: str,
        business_name: str,
        small: bool,
        owner_notes: str = "",
    ) -> Outcome:
        """Small talk and general help: ONE model call (a second only to put a reply into the person's language), no tools, no sources. The model has no record of the business in front of it, so
        it cannot state one; the same cost reservation, hygiene and language checks as the tool path apply."""
        turns = 0
        try:
            run = self._db.read_run()
            if run.status != "running":
                return Outcome("failed", "tool_failed")
            if run.expires_at <= self._now():
                raise RunExpired
            notes: tuple[str, ...] = ()
            unusable = False   # the model gave nothing readable (or a blank answer) twice
            for turn in (1, 2):
                turns = turn
                self._guard()
                emit("step", {"type": "step", "step": "working"})
                request = prompts.build_chat_request(
                    delimiter=self._delimiter,
                    question=question,
                    language=language,
                    history=history,
                    today=self._now(),
                    assistant_name=assistant_name,
                    business_name=business_name,
                    small=small,
                    notes=notes,
                    owner_notes=owner_notes,
                    address_as=self.address_as,
                )
                response = self._complete(request, f"usage-{turn}", language)
                try:
                    final = prompts.ChatReply.model_validate(response.structured)
                except ValidationError:
                    if turn == 1:
                        notes = (prompts.NOTE_REPAIR_SHAPE,)
                        continue
                    unusable = True
                    break
                if leaked_names(final.answer):
                    logger.warning("assistant run %s: a chat answer named an internal name; replaced by the fixed sentence (%s)", self._ctx.run_id, language)
                    return self._finish(Reply(PLAIN_WORDS[language], language, "clarify"), message_id, emit, turns)
                if final.language != language or not reply_matches(final.answer, language):
                    if turn == 1:
                        notes = (prompts.NOTE_REPAIR_LANGUAGE,)
                        continue
                    break
                return self._finish(Reply(final.answer.strip(), language, final.kind), message_id, emit, turns)
            self._note_fallback(turns, set())
            return self._finish(Reply(COULD_NOT_ANSWER[language] if unusable else PLAIN_WORDS[language], language, "refusal" if unusable else "clarify"), message_id, emit, turns, status="failed", code="invalid_output")
        except _Stop as stop:
            return self._stopped(stop, language, message_id, emit, turns)
        except AgentDbError as exc:
            status, code, shown = self._classify(exc)
            return self._end(status, code, turns, shown)

    def _call_model(self, llm: LlmClient, request: LlmRequest) -> Any:
        """One model call. A provider that timed out, was unreachable or sent something unreadable is asked ONCE more, silently (owner, 1 Nov 2026); the second failure is the caller's."""
        try:
            return llm.complete(request)
        except LlmError as exc:
            if exc.code not in RETRYABLE:
                raise
            logger.warning("assistant run %s: model call failed (%s); asking once more", self._ctx.run_id, exc.code)
            return llm.complete(request)

    def _complete(self, request: LlmRequest, key: str, language: str) -> Any:
        """Reserve the worst-case cost, call the model, record the usage (the tool loop does the same inline)."""
        llm = self._pick(request)
        self._db.reserve_cost(key, model=llm.model_id, max_input_tokens=input_token_bound(request), max_output_tokens=request.max_output_tokens)
        try:
            called = time.perf_counter()
            response = self._call_model(llm, request)
            self._model_ms += (time.perf_counter() - called) * 1000.0
        except LlmError as exc:
            logger.warning("assistant run %s: model call failed (%s)", self._ctx.run_id, exc.code)
            if exc.code in NOT_BILLED:
                try:
                    self._db.release_cost(key, reason=exc.code)
                except AgentDbError:
                    pass
            raise _Stop("failed", "model_failed", "model_busy" if exc.code == "rate_limited" else None) from None
        self._db.record_usage(key, response.usage)
        return response

    def _web_tools(self) -> frozenset[str]:
        """The web tools the owner has switched on (job BP): a tool whose provider is not configured is never offered."""
        web = getattr(getattr(self._ctx, "runtime", None), "research_web", None)
        if web is None:
            return frozenset()
        on = web.enabled()
        return frozenset(
            name
            for name, key in (
                ("web_search", "web_search"),
                ("read_page", "read_page"),
                ("find_retailers", "find_retailers"),
                ("get_metal_prices", "metal_prices"),
            )
            if on[key] and name in WEB_TOOL_NAMES
        )

    def _note_router_miss(self, what: str, language: str) -> None:
        """The router did not offer a tool the model wanted (or the model declined while a hidden group could have helped). Logged with the tool name (or the group) and the language only, never
        the question, so the word lists in router.py can be improved from real misses."""
        logger.warning(
            "assistant router miss: tool=%s language=%s run=%s", what, language, self._ctx.run_id
        )

    def _note_fallback(self, turns: int, repaired: set[str]) -> None:
        """A run that ends in the fixed reply says WHY in the log: how many turns it used and which repairs were asked for (closed words only; no text of the answer)."""
        logger.warning(
            "assistant run %s: no acceptable reply after %d turn(s); repairs asked: %s",
            self._ctx.run_id,
            turns,
            ",".join(sorted(repaired)) or "-",
        )

    # ------------------------------------------------------------------ the tools
    def _execute(
        self, tool: Any, args: Any
    ) -> tuple[str, tuple[Item, ...], str, tuple[tuple[str, str], ...]]:
        try:
            out = tool.handler(self._ctx, args)
        except ApiError as exc:
            # a 5xx is the data layer failing, not saying no: leave a trace (the code only)
            if exc.status_code >= 500:
                logger.warning(
                    "assistant tool %s failed upstream: %s %s", tool.name, exc.status_code, exc.code
                )
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
        except AgentDbError as exc:
            logger.warning("assistant tool %s failed: the data layer (%s)", tool.name, exc.code)
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

    def _money_pending_none(self) -> bool:
        """The question is about the money held or pending and today's figures show none: that is the whole answer."""
        return self._state.money_held_none and is_money_held_question(self._question)

    def _nothing(self, language: Language) -> str:
        """What is said when there is nothing to show: for a question about the money held, the specific answer (owner, 1 Nov 2026), else the general sentence."""
        return NO_MONEY_PENDING[language] if self._money_pending_none() else self._empty[language]

    # ------------------------------------------------------------------ judging a final reply
    def _judge(
        self,
        structured: dict[str, Any] | None,
        language: Language,
        repaired: set[str],
        turn: int = MAX_TURNS,
        *,
        searched: bool = False,
    ) -> Reply | str | None:
        """A Reply that may be shown, a fixed repair note to send back (once per kind), or None when there is no reply yet."""
        if structured is None:
            return None
        try:
            final = prompts.FinalReply.model_validate(structured)
        except ValidationError:
            return self._once("shape", prompts.NOTE_REPAIR_SHAPE, repaired)
        # the owner is not a programmer: an answer that names a tool, a function or an internal field is replaced, whatever else is right or wrong with it
        leaks = leaked_names(final.answer)
        if leaks:
            logger.warning(
                "assistant run %s: an answer named %d internal name(s); replaced by the fixed sentence (%s, %s)",
                self._ctx.run_id,
                leaks,
                language,
                final.kind,
            )
            return Reply(PLAIN_WORDS[language], language, "clarify", [], list(self._state.drafts))
        if final.kind == "answer" and self._money_pending_none():
            return Reply(NO_MONEY_PENDING[language], language, "answer", [], list(self._state.drafts))   # the specific answer, whatever else the model wrote
        if final.language != language or not reply_matches(final.answer, language):
            return self._once("language", prompts.NOTE_REPAIR_LANGUAGE, repaired)
        known = [
            self._state.items[h] for h in dict.fromkeys(final.sources) if h in self._state.items
        ]
        if final.kind == "answer" and not known:
            if searched and not any(i.type != "notes" for i in self._state.items.values()):
                # the tools ran and found NOTHING: there is no record the model could cite, so asking again can only cost two more model calls and end in the same fixed sentence (a Telugu Ask took 37 s that way). Say it now.
                logger.info("assistant run %s: nothing found and an answer with no source at turn %d (%s)", self._ctx.run_id, turn, language)
                # the tools ran and found nothing: the model may say so in its own kind words, but only without a number, a link or an amount (nothing it states can then be a made-up fact)
                if not re.search(r"\d|https?://|www\.|₹", final.answer):
                    return Reply(friendly_names(final.answer), language, "answer", [], list(self._state.drafts))
                return Reply(self._nothing(language), language, "answer" if self._money_pending_none() else "refusal", [], list(self._state.drafts))
            return self._once("sources", prompts.NOTE_REPAIR_SOURCES, repaired)
        # an amount is stated only exactly as a tool returned it: not the owner's own number repeated back as if it were done, not a sum, not a guess
        if any(a not in self._state.allowed_paise for a in money_amounts(final.answer)):
            return self._once("money", prompts.NOTE_REPAIR_MONEY, repaired)
        text = friendly_names(hide_places(final.answer, self._state, language))
        if final.kind == "answer":
            line = web_sources_line(language, known)
            if line:
                text = f"{text}\n{line}"
        # an answer about today's list names EVERY item that waits for the owner (job AO): the model is asked once; if it still leaves one out, the code adds it from the tool's own list
        missing = self._left_out(final.kind, known)
        if missing:
            if "complete" not in repaired and turn < MAX_TURNS:
                return self._once("complete", prompts.NOTE_REPAIR_COMPLETE, repaired)
            logger.warning(
                "assistant run %s: an answer left out %d waiting item(s); added from the tool's list",
                self._ctx.run_id,
                len(missing),
            )
            text = f"{text}\n{WAITING_ALSO[language]} " + "; ".join(i.label for i in missing)
            known = [*known, *missing]
        return Reply(
            text,
            language,
            final.kind,
            [source_of(i) for i in known] if final.kind == "answer" else [],
            list(self._state.drafts),
        )

    def _left_out(self, kind: str, cited: list[Item]) -> list[Item]:
        """The waiting items of today's list that an answer about that list did not cite. An answer is 'about the list' when get_today ran in this run and the answer cites at least one of
        what it showed (a waiting item or a recent step); an answer to some other question that happens to call get_today too, and cites none of it, is left alone."""
        state = self._state
        if kind != "answer" or not state.waiting:
            return []
        handles = {i.handle for i in cited}
        if not handles & {*state.waiting, *state.today_recent}:
            return []
        return [state.items[h] for h in state.waiting if h not in handles]

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
        extra: tuple[tuple[str, dict[str, Any]], ...] = (),
    ) -> Outcome:
        """`extra`: events sent after the drafts (job EA: `confirm_action`, `clarify`). A reply that is not a plain answer has its type (and task) stored right after it."""
        self._guard()
        cleaned = address.clean(reply.text, (self.address_as,))   # no sir / madam in any reply, whatever the model wrote (unless the person chose that word)
        if cleaned != reply.text:
            reply = replace(reply, text=cleaned)
        if not reply.text.strip():   # never an empty bubble (owner, 1 Nov 2026): whatever emptied the text, the person is told to try again and the log says so
            logger.warning("assistant run %s: an empty reply was replaced by the could-not-answer sentence (%s)", self._ctx.run_id, reply.language)
            reply = replace(reply, text=COULD_NOT_ANSWER[reply.language], kind="refusal")
        self._db.save_reply(
            message_id=message_id,
            text=reply.text,
            language=reply.language,
            sources=[
                {"type": s.kind, "id": str(s.id)}
                for s in reply.sources
                if s.kind not in NOT_STORED_SOURCES
            ],
            drafts=[{"type": d.kind, "id": str(d.id)} for d in reply.drafts],
        )
        stored_kind = "confirm_action" if reply.task_id is not None and reply.kind == "confirm_action" else ("clarify" if reply.kind == "clarify" else "answer")
        if self._typed and stored_kind != "answer":
            try:
                self._db.mark_reply(message_id=message_id, kind=stored_kind, task_id=reply.task_id)
            except AgentDbError as exc:   # the type is a label for the history; the answer itself is stored, so a failure here is logged by code and the turn goes on
                logger.warning("assistant reply type could not be stored (%s)", exc.code)
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
        for name, data in extra:
            emit(name, {"type": name, **data})
        if self._on_reply is not None:
            try:
                self._on_reply(reply.text, reply.language)
            except Exception as exc:  # a hook must never break the run: only its class is kept
                logger.warning("assistant reply hook failed: %s", exc.__class__.__name__)
        try:
            self._db.finish(status, code)
        except AgentDbError as exc:
            logger.warning("assistant run could not be closed (%s)", exc.code)
        logger.info("assistant run finished: status=%s code=%s turns=%d ms=%d model_ms=%d language=%s", status, code or "-", turns, self._elapsed_ms(), self._model_ms, reply.language)
        return Outcome(status, code, reply, turns)

    def finish_with(
        self,
        reply: Reply,
        message_id: uuid.UUID,
        emit: Callable[[str, dict[str, Any]], None],
        extra: tuple[tuple[str, dict[str, Any]], ...] = (),
    ) -> Outcome:
        """Job EA: store and send a reply that code made (a plan, a question, a fixed sentence) and close the run."""
        try:
            return self._finish(reply, message_id, emit, 0, extra=extra)
        except _Stop as stop:
            return self._end(stop.status, stop.error_code, 0, stop.shown)
        except AgentDbError as exc:
            status, code, shown = self._classify(exc)
            return self._end(status, code, 0, shown)

    def fail_with(self, code: str | None, shown: str | None = None) -> Outcome:
        """Job EA: close the run as failed with a code the stream turns into its fixed error (`budget` and the like)."""
        return self._end("failed", code, 0, shown)

    def _elapsed_ms(self) -> int:
        return int((time.perf_counter() - self._started) * 1000)

    @staticmethod
    def _classify(exc: AgentDbError) -> tuple[str, str | None, str | None]:
        """(status, the code the run records, the code the client is shown when it differs)."""
        if isinstance(exc, RunDenied):
            return "denied", None, None
        if isinstance(exc, RunNotRunning):
            return "cancelled", "cancelled", None
        if isinstance(exc, RunExpired):
            return "expired", "expired", None
        if isinstance(exc, AgentsDisabled):
            return "killed", "killed", None
        if isinstance(
            exc, ModelNotConfigured
        ):  # before CostCapReached, which it extends: a missing price is not a spending limit
            return "failed", "model_failed", "model_not_configured"
        if isinstance(exc, BudgetExhausted | LimitReached | CostCapReached):
            return "failed", "budget", None
        return "failed", "tool_failed", None

    def _stopped(self, stop: _Stop, language: Language, message_id: uuid.UUID, emit: Callable[[str, dict[str, Any]], None], turns: int) -> Outcome:
        """A run that stopped. When the model itself failed (twice, see _call_model) the person gets the could-not-answer sentence in their language as a stored reply, never an empty bubble;
        every other stop (a limit, a pause, a cancel, the busy provider) keeps its own message."""
        if stop.error_code == "model_failed" and stop.shown is None:
            logger.warning("assistant run %s: the model failed; the could-not-answer sentence is the reply (%s)", self._ctx.run_id, language)
            try:
                return self._finish(Reply(COULD_NOT_ANSWER[language], language, "refusal"), message_id, emit, turns, status="failed", code="model_failed")
            except _Stop as again:
                return self._end(again.status, again.error_code, turns, again.shown)
            except AgentDbError as exc:
                status, code, shown = self._classify(exc)
                return self._end(status, code, turns, shown)
        return self._end(stop.status, stop.error_code, turns, stop.shown)

    def _end(self, status: str, code: str | None, turns: int, shown: str | None = None) -> Outcome:
        if status != "denied":
            try:
                self._db.finish(status, code)
            except AgentDbError as exc:
                logger.warning("assistant run could not be closed (%s)", exc.code)
        logger.info("assistant run ended: status=%s code=%s turns=%d ms=%d model_ms=%d", status, code or "-", turns, self._elapsed_ms(), self._model_ms)
        return Outcome(status, code, None, turns, shown)

    def _pick(self, request: LlmRequest) -> LlmClient:
        """The model for THIS call (see ModelRouter.choose)."""
        return self._router.choose(request.task_class, self._db.ai_mode)

    def _guard(self) -> None:
        run = self._db.read_run()
        if run.status != "running" or run.cancel_requested_at is not None:
            raise RunNotRunning
        if run.expires_at <= self._now():
            raise RunExpired
