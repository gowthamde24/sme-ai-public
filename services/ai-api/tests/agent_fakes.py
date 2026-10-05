"""An in-memory stand-in for the agent database module (app.agents.ports.AgentDbPort).

It models the rules of the SECURITY DEFINER functions the runtime relies on (tests/integration
and the pgTAP files prove the real ones): a step key is idempotent per run (same arguments =
replay, other arguments = conflict), budgets are enforced before anything is written, and a
run that is not running / expired / switched off refuses. It is a fake: the real-stack tests
are the proof, this makes the runtime's decisions testable without a database."""

from __future__ import annotations

import hashlib
import json
import uuid
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

from app.agents.errors import (
    AgentsDisabled,
    BudgetExhausted,
    CostCapReached,
    ReferenceRefused,
    RunDenied,
    RunExpired,
    RunNotRunning,
    StepConflict,
    ValueRefused,
)
from app.agents.llm.interface import Usage
from app.agents.ports import RunView

RUN_ID = uuid.UUID("11111111-1111-4111-8111-111111111111")
COMPANY_ID = uuid.UUID("22222222-2222-4222-8222-222222222222")
ENQUIRY_ID = uuid.UUID("33333333-3333-4333-8333-333333333333")
T0 = datetime(2026, 10, 4, 12, 0, tzinfo=UTC)


class Clock:
    def __init__(self, start: datetime = T0) -> None:
        self.t = start

    def __call__(self) -> datetime:
        return self.t

    def advance(self, seconds: float) -> None:
        self.t += timedelta(seconds=seconds)


def sha(obj: Any) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True).encode()).hexdigest()


class FakeAgentDb:
    def __init__(
        self,
        *,
        clock: Clock | None = None,
        facts: dict[str, Any] | None = None,
        input_sha256: str | None = None,
        max_writes: int = 6,
        max_tool_calls: int = 20,
        max_input_tokens: int = 20000,
        max_output_tokens: int = 4000,
        ttl_seconds: int = 900,
        agent_name: str = "selftest",
        enquiry: dict[str, Any] | None = None,
    ) -> None:
        self.agent_name = agent_name
        # the Requirement Agent's enquiry (channel, received_at, subject, body); None otherwise
        self.enquiry = enquiry
        self.fields: list[dict[str, Any]] = []
        self.refuse_fields: set[str] = set()
        self.clock = clock or Clock()
        self.facts = facts or {
            "name": "DEMO Silk House",
            "city": "Bengaluru",
            "region": "Karnataka",
            "website": "https://demo-silk.test/shop",
        }
        self.run_id = RUN_ID
        self.status = "running"
        self.error_code: str | None = None
        self.cancel_requested_at: datetime | None = None
        self.expires_at = self.clock() + timedelta(seconds=ttl_seconds)
        self.input_sha256 = input_sha256
        self.switches_on = True
        self.denied = False
        self.max = {
            "writes": max_writes,
            "tool_calls": max_tool_calls,
            "in": max_input_tokens,
            "out": max_output_tokens,
        }
        self.used = {"writes": 0, "tool_calls": 0, "in": 0, "out": 0}
        self.steps: dict[str, dict[str, Any]] = {}
        # the daily cost cap (the real rules are the database's; tests/integration prove them):
        # a price per model in micros per Mtok, the tenant's cap and what today already holds
        self.prices: dict[str, tuple[int, int]] = {"fake-selftest": (1_000_000, 1_000_000)}
        self.cap_micros: int = 2_000_000
        self.day_spend_micros: int = 0
        self.reservations: dict[str, int] = {}
        self.reserve_requests: list[tuple[str, str, int, int]] = []
        self.released: list[tuple[str, str]] = []
        self.evidence: list[dict[str, Any]] = []
        self.claims: list[dict[str, Any]] = []
        self.calls: list[str] = []
        self.finished: list[tuple[str, str | None]] = []
        # op name -> callable run before an op (to simulate a cancel or a switch mid-run)
        self.before: dict[str, Callable[[FakeAgentDb], None]] = {}
        # op name -> callable run after a successful write
        self.after: dict[str, Callable[[FakeAgentDb], None]] = {}

    # ------------------------------------------------------------------ the state the real
    # functions check first
    def _open(self, op: str) -> None:
        self.calls.append(op)
        hook = self.before.get(op)
        if hook is not None:
            hook(self)
        if self.denied:
            raise RunDenied
        if not self.switches_on:
            raise AgentsDisabled
        if self.status != "running" or self.cancel_requested_at is not None:
            raise RunNotRunning
        if self.expires_at <= self.clock():
            raise RunExpired

    def _replay(self, key: str, tool: str, args_sha: str) -> dict[str, Any] | None:
        found = self.steps.get(key)
        if found is None:
            return None
        if found["tool"] != tool or found["sha"] != args_sha:
            raise StepConflict
        return found

    # ------------------------------------------------------------------ the port
    def read_run(self) -> RunView:
        self.calls.append("read_run")
        if self.denied:
            raise RunDenied
        return RunView(
            id=self.run_id,
            agent_name=self.agent_name,
            status=self.status,
            expires_at=self.expires_at,
            cancel_requested_at=self.cancel_requested_at,
            input_sha256=self.input_sha256 or "",
            company_id=None if self.enquiry is not None else COMPANY_ID,
            lead_id=None,
            enquiry_id=ENQUIRY_ID if self.enquiry is not None else None,
        )

    def read_target(self, run: RunView) -> dict[str, Any]:
        self.calls.append("read_target")
        return dict(self.facts)

    def read_enquiry(self, run: RunView) -> dict[str, Any]:
        self.calls.append("read_enquiry")
        return dict(self.enquiry or {})

    def write_requirement_field(
        self,
        step_key: str,
        *,
        line: int | None,
        key: str,
        value_code: str | None,
        value_int: int | None,
        value_date: str | None,
        value_text: str | None,
        basis: str | None,
        certainty: str,
        quote: str,
        start: int,
        end: int,
        conflict: bool,
    ) -> uuid.UUID:
        """Models the database rules that matter to the runtime: the quote must be the span of the
        stored enquiry text, one field per (line, key), a write budget, an idempotent step key."""
        from app.requirements.quote import verify

        self._open("write_requirement_field")
        args = {
            "line": line,
            "key": key,
            "code": value_code,
            "int": value_int,
            "date": value_date,
            "text": value_text,
            "basis": basis,
            "certainty": certainty,
            "quote": quote,
            "start": start,
            "end": end,
            "conflict": conflict,
        }
        digest = sha(args)
        found = self._replay(step_key, "agent_write_requirement_field", digest)
        if found is not None:
            return uuid.UUID(found["result"]["field_id"])
        body = str((self.enquiry or {}).get("body") or "")
        if key in self.refuse_fields or not verify(body, start, end, quote):
            raise ValueRefused
        if any(f["line"] == line and f["key"] == key for f in self.fields):
            raise ValueRefused
        if self.used["writes"] >= self.max["writes"]:
            raise BudgetExhausted
        self.used["writes"] += 1
        new_id = uuid.uuid5(RUN_ID, f"field:{step_key}")
        self.fields.append(
            {"id": new_id, "run": self.run_id, "state": "proposed", "created_via": "agent", **args}
        )
        self.steps[step_key] = {
            "tool": "agent_write_requirement_field",
            "sha": digest,
            "result": {"field_id": str(new_id)},
        }
        return new_id

    def reserve_cost(
        self, step_key: str, *, model: str, max_input_tokens: int, max_output_tokens: int
    ) -> None:
        self._open("reserve_cost")
        price = self.prices.get(model)
        if price is None or price[0] <= 0 or price[1] <= 0:
            raise CostCapReached  # no usable price: fail closed
        worst = -(-(max_input_tokens * price[0] + max_output_tokens * price[1]) // 1_000_000)
        if self.day_spend_micros + worst > self.cap_micros:
            raise CostCapReached
        self.day_spend_micros += worst
        self.reservations[step_key] = worst
        self.reserve_requests.append((step_key, model, max_input_tokens, max_output_tokens))

    def release_cost(self, step_key: str, *, reason: str) -> None:
        self._open("release_cost")
        if reason not in ("rate_limited", "rejected", "not_configured"):
            raise ValueRefused
        released = self.reservations.pop(step_key, None)
        if released is None:
            raise ReferenceRefused
        self.day_spend_micros -= released
        self.released.append((step_key, reason))

    def record_usage(self, step_key: str, usage: Usage) -> None:
        self._open("record_usage")
        digest = sha([usage.input_tokens, usage.output_tokens, usage.cost_micros])
        if self._replay(step_key, "usage", digest) is not None:
            return
        if (
            self.used["in"] + usage.input_tokens > self.max["in"]
            or self.used["out"] + usage.output_tokens > self.max["out"]
        ):
            raise BudgetExhausted
        self.used["in"] += usage.input_tokens
        self.used["out"] += usage.output_tokens
        self.steps[step_key] = {"tool": "usage", "sha": digest, "result": {}}

    def record_step(
        self,
        step_key: str,
        tool_name: str,
        args_sha256: str,
        status: str,
        result_ref: dict[str, Any] | None,
    ) -> None:
        self._open("record_step")
        if tool_name == "usage" or tool_name.startswith("agent_write"):
            raise ValueRefused
        if self._replay(step_key, tool_name, args_sha256) is not None:
            return
        if self.used["tool_calls"] >= self.max["tool_calls"]:
            raise BudgetExhausted
        self.used["tool_calls"] += 1
        self.steps[step_key] = {
            "tool": tool_name,
            "sha": args_sha256,
            "status": status,
            "result": result_ref or {},
        }

    def write_evidence(self, step_key: str, *, text: str) -> uuid.UUID:
        self._open("write_evidence")
        digest = sha({"kind": "note", "snippet": text})
        found = self._replay(step_key, "agent_write_evidence", digest)
        if found is not None:
            return uuid.UUID(found["result"]["evidence_id"])
        if self.used["writes"] >= self.max["writes"]:
            raise BudgetExhausted
        self.used["writes"] += 1
        new_id = uuid.uuid5(RUN_ID, f"evidence:{step_key}")
        self.evidence.append({"id": new_id, "text": text, "run": self.run_id, "kind": "note"})
        self.steps[step_key] = {
            "tool": "agent_write_evidence",
            "sha": digest,
            "result": {"evidence_id": str(new_id)},
        }
        hook = self.after.get("write_evidence")
        if hook is not None:
            hook(self)
        return new_id

    def write_web_evidence(self, step_key: str, *, url: str, quote: str) -> uuid.UUID:
        """Models the database rule: a web_page row needs a quote of at most 300 characters and a
        URL on the run target's own website host, with no query string or fragment."""
        self._open("write_web_evidence")
        digest = sha({"kind": "web_page", "url": url, "snippet": quote})
        found = self._replay(step_key, "agent_write_evidence", digest)
        if found is not None:
            return uuid.UUID(found["result"]["evidence_id"])
        own = urlsplit(str(self.facts.get("website") or "")).hostname or ""
        host = urlsplit(url).hostname or ""

        def bare(name: str) -> str:
            return name[4:] if name.startswith("www.") else name

        if not own or bare(host) != bare(own) or "?" in url or "#" in url or len(quote) > 300:
            raise ValueRefused
        if self.used["writes"] >= self.max["writes"]:
            raise BudgetExhausted
        self.used["writes"] += 1
        new_id = uuid.uuid5(RUN_ID, f"evidence:{step_key}")
        self.evidence.append(
            {"id": new_id, "text": quote, "url": url, "run": self.run_id, "kind": "web_page"}
        )
        self.steps[step_key] = {
            "tool": "agent_write_evidence",
            "sha": digest,
            "result": {"evidence_id": str(new_id)},
        }
        return new_id

    def write_claim(
        self,
        step_key: str,
        *,
        value: str,
        stance: str,
        evidence_id: uuid.UUID,
        predicate: str | None = None,
    ) -> uuid.UUID:
        self._open("write_claim")
        digest = sha(
            {
                "value": value,
                "stance": stance,
                "evidence": [str(evidence_id)],
                **({"predicate": predicate} if predicate else {}),
            }
        )
        found = self._replay(step_key, "agent_write_claim", digest)
        if found is not None:
            return uuid.UUID(found["result"]["claim_id"])
        if not any(e["id"] == evidence_id for e in self.evidence):
            raise ValueRefused
        if self.used["writes"] >= self.max["writes"]:
            raise BudgetExhausted
        self.used["writes"] += 1
        new_id = uuid.uuid5(RUN_ID, f"claim:{step_key}")
        self.claims.append(
            {
                "id": new_id,
                "predicate": predicate,
                "value": value,
                "stance": stance,
                "evidence_id": evidence_id,
                "confidence": "unverified",
                "created_via": "agent",
                "run": self.run_id,
            }
        )
        self.steps[step_key] = {
            "tool": "agent_write_claim",
            "sha": digest,
            "result": {"claim_id": str(new_id)},
        }
        return new_id

    def finish(self, status: str, error_code: str | None) -> None:
        self.calls.append("finish")
        self.finished.append((status, error_code))
        if self.status == "running":
            self.status = status
            self.error_code = error_code

    # ------------------------------------------------------------------ test levers
    def cancel(self) -> None:
        self.cancel_requested_at = self.clock()
