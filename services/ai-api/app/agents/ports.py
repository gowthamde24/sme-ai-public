"""What the runtime needs from the database, as one small interface (implemented by app.agents.db
over PostgREST, and by an in-memory fake in tests). Every method acts for ONE run and with
that run's starter's rights; none takes a tenant, a table name or a token."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from app.agents.llm.interface import Usage


@dataclass(frozen=True)
class RunView:
    id: uuid.UUID
    agent_name: str
    status: str
    expires_at: datetime
    cancel_requested_at: datetime | None
    input_sha256: str
    company_id: uuid.UUID | None
    lead_id: uuid.UUID | None


class AgentDbPort(Protocol):
    def read_run(self) -> RunView: ...

    def read_target(self, run: RunView) -> dict[str, Any]:
        """The target company's name, city, region and website: exactly those four columns, never a
        contact field."""
        ...

    def reserve_cost(
        self, step_key: str, *, model: str, max_input_tokens: int, max_output_tokens: int
    ) -> None:
        """Reserve the worst-case cost of ONE model call, before it is made. Raises CostCapReached
        when the tenant's daily cost cap has no room for it (or the model has no price)."""
        ...

    def record_usage(self, step_key: str, usage: Usage) -> None: ...

    def record_step(
        self,
        step_key: str,
        tool_name: str,
        args_sha256: str,
        status: str,
        result_ref: dict[str, Any] | None,
    ) -> None: ...

    def write_evidence(self, step_key: str, *, text: str) -> uuid.UUID: ...

    def write_web_evidence(self, step_key: str, *, url: str, quote: str) -> uuid.UUID:
        """Evidence of kind web_page: the URL of a page this run fetched and a verified quote. The
        database refuses a URL that is not on the run target's own website."""
        ...

    def write_claim(
        self,
        step_key: str,
        *,
        value: str,
        stance: str,
        evidence_id: uuid.UUID,
        predicate: str | None = None,
    ) -> uuid.UUID:
        """`predicate=None` uses the agent's own single predicate (the selftest agent)."""
        ...

    def finish(self, status: str, error_code: str | None) -> None: ...
