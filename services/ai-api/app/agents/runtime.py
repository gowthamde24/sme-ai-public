"""The agent loop: explicit and app-owned (no agent framework), small enough to read in one
sitting.

For each turn: check the run is still running and inside its time (kill flags and the clock
are re-read between steps), build the prompt from the allowlisted input only, call the model,
record its usage, then handle what it asked for. The model can only ASK: a tool call is looked
up in the agent's allowlist by exact name, its arguments are parsed with a closed schema, and
what actually happens is a call to one of the database functions, which re-check everything.
Whatever a model, a company name or the database says is never logged or stored: the ledger
holds fixed tool names, ids and hashes; the logs hold run ids and codes.

Step keys are deterministic (usage-N, tN-cI), so a retry of an interrupted run replays what
was done instead of repeating it."""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pydantic import ValidationError

from app.agents import prompts, tools
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
from app.agents.inputs import (
    EnquiryInput,
    ModelInput,
    enquiry_input_from_row,
    enquiry_input_sha256,
    input_sha256,
    model_input_from_company,
)
from app.agents.llm.interface import LlmClient, LlmError, LlmRequest, LlmResponse, ToolCall
from app.agents.notes import (
    FIXED_NOTES,
    NOTE_EVIDENCE_REFUSED,
    NOTE_QUOTE_REFUSED,
    NOTE_REFUSED,
    NOTE_REPAIR,
    NOTE_VALUE_REFUSED,
)
from app.agents.ports import AgentDbPort
from app.agents.schemas import FinalResult
from app.agents.spec import AgentSpec
from app.agents.web import PageFetcher

logger = logging.getLogger("app.agents.runtime")

REFUSED_TOOL = "refused_call"  # the ledger name of every refused call: never the model's own text
FAILED_TOOL = "tool_error"


@dataclass(frozen=True)
class RunOutcome:
    status: str  # succeeded | failed | cancelled | expired | killed | denied | not_running
    error_code: str | None = None
    turns: int = 0
    refused_calls: int = 0


class _Stop(Exception):
    """Internal control flow: the run ends with this outcome."""

    def __init__(self, status: str, error_code: str | None = None, *, finish: bool = True) -> None:
        super().__init__(status)
        self.status, self.error_code, self.finish = status, error_code, finish


# A model call that failed with one of these provably never reached billing, so its reservation is
# released (settled at zero):
#   rate_limited    HTTP 429: the provider refused before processing
#   rejected        any other 4xx: the request itself was refused (bad key, bad request)
#   not_configured  nothing was sent at all
# Every OTHER failure leaves the reservation open at its worst case until its UTC day ends:
#   unavailable     a transport error or a 5xx: the request may have been processed
#   timeout         the provider may have finished the call after we stopped waiting
#   bad_response    the call completed and was billed, but its usage could not be read
# And a call that completed but could not be recorded (the run was cancelled or expired while it
# was in flight) also stays open: a terminal run settles nothing.
NOT_BILLED = frozenset({"rate_limited", "rejected", "not_configured"})

# What the provider adds around our text (message framing, the tool-use preamble, the tool
# definitions' own overhead) is not in the bytes we send. The bound below adds this on top.
INPUT_TOKEN_OVERHEAD = 2048


def input_token_bound(request: LlmRequest) -> int:
    """An UPPER bound on the input tokens of one model call, for the cost reservation.

    A token is at least one UTF-8 byte of what is sent, so the bytes of every block and of every
    tool definition bound the tokens of the text; INPUT_TOKEN_OVERHEAD covers the provider's own
    framing. Deliberately generous: the reservation is released down to the real cost when the
    call is settled, so a loose bound only costs headroom for a moment."""
    size = sum(len(block.text.encode("utf-8")) for block in request.blocks)
    for tool in (*request.tools, *([request.final_result] if request.final_result else [])):
        size += len(
            json.dumps([tool.name, tool.description, tool.input_schema], ensure_ascii=False).encode(
                "utf-8"
            )
        )
    return size + INPUT_TOKEN_OVERHEAD


def allowed_hosts_for(host: str) -> frozenset[str]:
    """THE host rule of the web agents: the company's website host and its `www.` twin, and nothing
    else (no other subdomain, no parent domain). The database applies the same rule again to every
    stored web URL (`agent_write_evidence`: `app.website_host` strips ONE leading `www.`); the same
    table of cases is tested on both sides (tests/test_research_agent.py and pgTAP 52)."""
    twin = host[4:] if host.startswith("www.") else f"www.{host}"
    return frozenset({host, twin})


def _canonical_sha(obj: Any) -> str:
    text = json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"), default=str)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


class AgentRunner:
    def __init__(
        self,
        *,
        db: AgentDbPort,
        llm: LlmClient,
        spec: AgentSpec,
        now: Callable[[], datetime] | None = None,
        delimiter: str | None = None,
        max_output_tokens: int = 1000,
        fetcher: PageFetcher | None = None,
    ) -> None:
        self._db, self._llm, self._spec = db, llm, spec
        self._fetcher = fetcher
        self._host: str | None = None
        self._allowed_hosts: frozenset[str] = frozenset()
        self._now = now or (lambda: datetime.now(UTC))
        self._delimiter = delimiter or secrets.token_hex(8)
        self._max_output_tokens = max_output_tokens
        self._refused = 0

    # ---- public
    def run(self) -> RunOutcome:
        turns = 0
        try:
            run = self._db.read_run()
            if run.status != "running" or run.agent_name != self._spec.name:
                return RunOutcome("not_running")
            self._check_clock(run.expires_at)
            state = tools.RunState()
            model_input: ModelInput | EnquiryInput
            if self._spec.target_kind == "enquiry":
                # the Requirement Agent reads ONE enquiry: the four allowlisted columns, nothing
                # about the lead, the contact or the company. A run that is not about an enquiry
                # ends before any model call.
                enquiry = (
                    enquiry_input_from_row(self._db.read_enquiry(run))
                    if run.enquiry_id is not None
                    else None
                )
                if enquiry is None or enquiry_input_sha256(enquiry) != run.input_sha256:
                    raise _Stop("failed", "tool_failed")
                state.enquiry = model_input = enquiry
            else:
                target = self._db.read_target(run)
                if not target:
                    # no company to read (a lead without one): nothing to research, no model call
                    raise _Stop("failed", "tool_failed")
                model_input = model_input_from_company(target)
            if self._spec.uses_web and isinstance(model_input, ModelInput):
                # the host scope is decided HERE, from the run's company, never by the model; a run
                # that cannot read the web (no fetcher, no website) ends before any model call
                host = model_input.website_host
                if self._fetcher is None or not host:
                    raise _Stop("failed", "tool_failed")
                self._host, self._allowed_hosts = host, allowed_hosts_for(host)
            if (
                isinstance(model_input, ModelInput)
                and input_sha256(model_input) != run.input_sha256
            ):
                raise _Stop(
                    "failed", "tool_failed"
                )  # what the model would see is not what the run recorded
            notes: tuple[str, ...] = ()
            repaired = False
            for turn in range(1, self._spec.max_turns + 1):
                turns = turn
                self._guard()
                request = prompts.build_request(
                    self._spec,
                    model_input,
                    turn=turn,
                    delimiter=self._delimiter,
                    notes=notes,
                    max_output_tokens=self._max_output_tokens,
                    pages=tuple(state.pages.values()),
                )
                # the worst case of THIS call is reserved under the tenant's daily cost cap BEFORE
                # the model is called (CostCapReached ends the run: nothing was spent)
                self._db.reserve_cost(
                    f"usage-{turn}",
                    model=self._llm.model_id,
                    max_input_tokens=input_token_bound(request),
                    max_output_tokens=request.max_output_tokens,
                )
                try:
                    response = self._llm.complete(request)
                except LlmError as exc:
                    logger.warning("run %s: model call failed (%s)", run.id, exc.code)
                    self._release_if_not_billed(f"usage-{turn}", exc.code)
                    raise _Stop("failed", "model_failed") from None
                self._db.record_usage(f"usage-{turn}", response.usage)
                notes = self._handle_calls(response, turn, state)
                if self._final_is_valid(response):
                    self._finalize(state)
                    self._db.finish("succeeded", None)
                    return RunOutcome("succeeded", None, turns, self._refused)
                if response.structured is not None or not response.tool_calls:
                    # a malformed or missing result: one repair attempt, then the run fails
                    if repaired:
                        raise _Stop("failed", "invalid_output")
                    repaired = True
                    notes = (*notes, NOTE_REPAIR)
            raise _Stop("failed", "invalid_output")
        except _Stop as stop:
            return self._end(stop.status, stop.error_code, turns, stop.finish)
        except AgentDbError as exc:
            status, code, finish = self._classify(exc)
            return self._end(status, code, turns, finish)

    def _finalize(self, state: tools.RunState) -> None:
        """After a valid final result: the agent's own end-of-run write (the Requirement Agent
        writes its proposals here)."""
        if self._spec.finalize is not None:
            self._refused += self._spec.finalize(tools.ToolContext(self._db, state, "flush"))

    def _release_if_not_billed(self, step_key: str, code: str) -> None:
        """Settle the call's reservation at ZERO when the failure proves the provider never billed
        it. Every other failure leaves the reservation OPEN: it keeps counting at its worst case
        until its UTC day ends (ADR 0013, "Open reservations"). See NOT_BILLED."""
        if code not in NOT_BILLED:
            return
        try:
            self._db.release_cost(step_key, reason=code)
        except AgentDbError as exc:  # best effort: an unreleased reservation only costs headroom
            logger.warning("reservation could not be released (%s)", exc.code)

    # ---- the guard, between every step
    def _check_clock(self, expires_at: datetime) -> None:
        if expires_at <= self._now():
            raise RunExpired

    def _guard(self) -> None:
        run = self._db.read_run()
        if run.status != "running" or run.cancel_requested_at is not None:
            raise RunNotRunning
        self._check_clock(run.expires_at)

    # ---- tool calls
    def _handle_calls(
        self, response: LlmResponse, turn: int, state: tools.RunState
    ) -> tuple[str, ...]:
        notes: list[str] = []
        for index, requested in enumerate(response.tool_calls):
            if index >= self._spec.max_calls_per_turn:
                self._refused += 1  # beyond the per-turn cap: ignored, not even recorded
                notes.append(NOTE_REFUSED)
                continue
            notes.append(self._one_call(requested, turn, index, state))
        return tuple(dict.fromkeys(notes))

    def _one_call(self, requested: ToolCall, turn: int, index: int, state: tools.RunState) -> str:
        key = f"t{turn}-c{index}"
        digest = _canonical_sha({"name": requested.name, "args": requested.arguments})
        tool = tools.find(self._spec.tools, requested.name)
        args: Any = None
        if tool is not None:
            try:
                args = tool.args_model.model_validate(requested.arguments)
            except ValidationError:
                # invalid arguments are refused like an unknown tool (an error text would
                # quote the model)
                tool = None
        if tool is None:
            self._guard()
            self._db.record_step(key, REFUSED_TOOL, digest, "refused", None)
            self._refused += 1
            return NOTE_REFUSED
        self._guard()
        try:
            context = tools.ToolContext(
                self._db,
                state,
                key,
                fetcher=self._fetcher,
                host=self._host,
                allowed_hosts=self._allowed_hosts,
            )
            note = tool.handler(context, args)
        except (ValueRefused, ReferenceRefused):
            self._db.record_step(key, FAILED_TOOL, digest, "failed", None)
            self._refused += 1
            return NOTE_REFUSED
        if note in (NOTE_REFUSED, NOTE_EVIDENCE_REFUSED, NOTE_QUOTE_REFUSED, NOTE_VALUE_REFUSED):
            self._db.record_step(key, REFUSED_TOOL, digest, "refused", None)
            self._refused += 1
        return note if note in FIXED_NOTES else NOTE_REFUSED

    # ---- the final result
    @staticmethod
    def _final_is_valid(response: LlmResponse) -> bool:
        if response.structured is None:
            return False
        try:
            FinalResult.model_validate(response.structured)
        except ValidationError:
            return False
        return True

    # ---- ending
    @staticmethod
    def _classify(exc: AgentDbError) -> tuple[str, str | None, bool]:
        """(status, error code, whether to try to close the run)."""
        if isinstance(exc, RunDenied):
            return "denied", None, False  # not even ours any more: nothing may be closed
        if isinstance(exc, RunNotRunning):
            return "cancelled", "cancelled", True  # re-checked in _end
        if isinstance(exc, RunExpired):
            return "expired", "expired", True
        if isinstance(exc, AgentsDisabled):
            return "killed", "killed", True
        if isinstance(exc, BudgetExhausted | LimitReached | CostCapReached):
            return "failed", "budget", True
        return "failed", "tool_failed", True

    def _end(self, status: str, error_code: str | None, turns: int, finish: bool) -> RunOutcome:
        if status == "cancelled":
            # SM201 means "not running": a cancel request (or an already closed run) is the
            # only thing it can be here
            try:
                run = self._db.read_run()
                if run.status not in ("running", "cancelled") and run.cancel_requested_at is None:
                    return RunOutcome("not_running", None, turns, self._refused)
            except AgentDbError:
                pass
        if finish:
            try:
                self._db.finish(status, error_code)
            except AgentDbError as exc:
                logger.warning("run could not be closed (%s)", exc.code)
        logger.info("agent run ended: status=%s code=%s turns=%d", status, error_code or "-", turns)
        return RunOutcome(status, error_code, turns, self._refused)
