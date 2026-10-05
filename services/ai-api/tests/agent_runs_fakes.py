"""In-memory stand-ins for the HTTP side of agent runs (the real database rules are proved in
pgTAP and tests/integration)."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

from app.agent_runs.executor import ExecutorBusy, RunTask
from app.agent_runs.models import (
    AgentSettingsOut,
    CancelOut,
    ClaimSuggestionOut,
    ReviewOut,
    RunOut,
)
from app.agent_runs.repository import (
    AgentsDisabledError,
    CostCapError,
    RunLimitError,
    StartResult,
)
from app.crm.models import Page
from app.crm.repository import ConflictError, NotFoundError
from app.tenancy.repository import Forbidden

NOW = dt.datetime(2026, 10, 4, 12, 0, tzinfo=dt.UTC)


def run_row(run_id: uuid.UUID, **over: Any) -> RunOut:
    base: dict[str, Any] = {
        "id": run_id,
        "agent_name": "selftest",
        "agent_version": "selftest-1",
        "status": "running",
        "started_by": uuid.UUID(int=0x1002),
        "company_id": uuid.UUID(int=0xC1),
        "lead_id": None,
        "created_at": NOW,
        "expires_at": NOW + dt.timedelta(minutes=15),
        "finished_at": None,
        "error_code": None,
        "cancel_requested": False,
        "max_writes": 6,
        "writes_used": 0,
        "max_tool_calls": 20,
        "tool_calls_used": 0,
        "max_input_tokens": 20000,
        "input_tokens_used": 0,
        "max_output_tokens": 4000,
        "output_tokens_used": 0,
        "max_cost_micros": 250000,
        "cost_micros_used": 0,
    }
    return RunOut.model_validate({**base, **over})


class FakeExecutor:
    def __init__(self) -> None:
        self.tasks: list[RunTask] = []
        self.busy = False

    def has_capacity(self) -> bool:
        return not self.busy

    def submit(self, task: RunTask) -> None:
        if self.busy:
            raise ExecutorBusy
        self.tasks.append(task)

    def shutdown(self) -> None:
        pass


class FakeAgentRunsRepository:
    def __init__(self) -> None:
        self.tokens_seen: list[str] = []
        self.calls: list[str] = []
        self.runs: dict[uuid.UUID, tuple[uuid.UUID, dict[str, Any], RunOut]] = {}
        self.enabled: dict[uuid.UUID, bool] = {}
        self.claims: dict[uuid.UUID, tuple[uuid.UUID, ClaimSuggestionOut]] = {}
        self.reviews: dict[uuid.UUID, dict[str, Any]] = {}
        self.start_error: Exception | None = None
        self.cancel_error: Exception | None = None
        self.review_error: Exception | None = None
        self.settings_error: Exception | None = None

    def _seen(self, token: str, call: str) -> None:
        self.tokens_seen.append(token)
        self.calls.append(call)

    # ---- runs
    def start_run(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        run_id: uuid.UUID,
        agent_name: str,
        agent_version: str,
        target_kind: str,
        target_id: uuid.UUID,
        input_sha256: str,
        input_refs: dict[str, Any],
    ) -> StartResult:
        self._seen(token, "start")
        if self.start_error is not None:
            raise self.start_error
        if not self.enabled.get(tenant_id, False):
            raise AgentsDisabledError("SM204")
        key = {
            "agent": agent_name,
            "kind": target_kind,
            "target": target_id,
            "sha": input_sha256,
            "refs": input_refs,
        }
        if run_id in self.runs:
            owner, stored, run = self.runs[run_id]
            if owner == tenant_id and stored == key:
                return StartResult(run_id, "running", run.expires_at, True)
            raise ConflictError("23505")
        run = run_row(
            run_id,
            company_id=target_id if target_kind == "company" else None,
            lead_id=target_id if target_kind == "lead" else None,
        )
        self.runs[run_id] = (tenant_id, key, run)
        return StartResult(run_id, "running", run.expires_at, False)

    def list_runs(
        self, token: str, tenant_id: uuid.UUID, *, limit: int, cursor: tuple[str, uuid.UUID] | None
    ) -> Page[RunOut]:
        self._seen(token, "list_runs")
        items = [r for (t, _, r) in self.runs.values() if t == tenant_id]
        return Page[RunOut](items=items[:limit], next_cursor=None)

    def get_run(self, token: str, tenant_id: uuid.UUID, run_id: uuid.UUID) -> RunOut | None:
        self._seen(token, "get_run")
        found = self.runs.get(run_id)
        return found[2] if found and found[0] == tenant_id else None

    def cancel_run(self, token: str, run_id: uuid.UUID) -> CancelOut:
        self._seen(token, "cancel")
        if self.cancel_error is not None:
            raise self.cancel_error
        tenant, key, run = self.runs[run_id]
        if run.status != "running":
            return CancelOut(status=run.status, replayed=True)
        self.runs[run_id] = (tenant, key, run.model_copy(update={"status": "cancelled"}))
        return CancelOut(status="cancelled", replayed=False)

    # ---- settings
    def get_enabled(self, token: str, tenant_id: uuid.UUID) -> AgentSettingsOut:
        self._seen(token, "get_settings")
        return AgentSettingsOut(enabled=self.enabled.get(tenant_id, False))

    def set_enabled(self, token: str, tenant_id: uuid.UUID, enabled: bool) -> AgentSettingsOut:
        self._seen(token, "set_settings")
        if self.settings_error is not None:
            raise self.settings_error
        self.enabled[tenant_id] = enabled
        return AgentSettingsOut(enabled=enabled)

    # ---- claims
    def list_claims(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        target_kind: str,
        target_id: uuid.UUID,
        limit: int,
    ) -> list[ClaimSuggestionOut]:
        self._seen(token, "list_claims")
        column = "company_id" if target_kind == "company" else "lead_id"
        return [
            c
            for (t, c) in self.claims.values()
            if t == tenant_id and getattr(c, column) == target_id
        ][:limit]

    def get_claim(
        self, token: str, tenant_id: uuid.UUID, claim_id: uuid.UUID
    ) -> ClaimSuggestionOut | None:
        self._seen(token, "get_claim")
        found = self.claims.get(claim_id)
        return found[1] if found and found[0] == tenant_id else None

    def review_claim(
        self,
        token: str,
        *,
        review_id: uuid.UUID,
        claim_id: uuid.UUID,
        decision: str,
        confidence: str | None,
        reason_code: str | None,
    ) -> ReviewOut:
        self._seen(token, "review")
        if self.review_error is not None:
            raise self.review_error
        if claim_id not in self.claims:
            raise NotFoundError("42501")
        payload = {"claim": claim_id, "decision": decision, "c": confidence, "r": reason_code}
        if review_id in self.reviews:
            if self.reviews[review_id] == payload:
                return ReviewOut(review_id=review_id, replayed=True, self_review=False)
            raise ConflictError("23505")
        self.reviews[review_id] = payload
        return ReviewOut(review_id=review_id, replayed=False, self_review=False)

    def seed_claim(self, tenant_id: uuid.UUID, claim: ClaimSuggestionOut) -> None:
        self.claims[claim.id] = (tenant_id, claim)


def claim_row(claim_id: uuid.UUID, company_id: uuid.UUID, **over: Any) -> ClaimSuggestionOut:
    base: dict[str, Any] = {
        "id": claim_id,
        "company_id": company_id,
        "lead_id": None,
        "predicate": "selftest.observation",
        "value": "DEMO observation",
        "confidence": "unverified",
        "claim_confidence": "unverified",
        "created_via": "agent",
        "agent_run_id": uuid.UUID(int=0xAA),
        "created_by": uuid.UUID(int=0x1002),
        "created_at": NOW,
        "review_state": "unreviewed",
        "review_confidence": None,
        "reviewed_by": None,
        "reviewed_at": None,
    }
    return ClaimSuggestionOut.model_validate({**base, **over})


__all__ = [
    "CostCapError",
    "FakeAgentRunsRepository",
    "FakeExecutor",
    "Forbidden",
    "RunLimitError",
    "claim_row",
    "run_row",
]
