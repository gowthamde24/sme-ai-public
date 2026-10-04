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

from app.agents.errors import (
    AgentsDisabled,
    BudgetExhausted,
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
    ) -> None:
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
            agent_name="selftest",
            status=self.status,
            expires_at=self.expires_at,
            cancel_requested_at=self.cancel_requested_at,
            input_sha256=self.input_sha256 or "",
            company_id=COMPANY_ID,
            lead_id=None,
        )

    def read_target(self, run: RunView) -> dict[str, Any]:
        self.calls.append("read_target")
        return dict(self.facts)

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

    def write_claim(
        self, step_key: str, *, value: str, stance: str, evidence_id: uuid.UUID
    ) -> uuid.UUID:
        self._open("write_claim")
        digest = sha({"value": value, "stance": stance, "evidence": [str(evidence_id)]})
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
