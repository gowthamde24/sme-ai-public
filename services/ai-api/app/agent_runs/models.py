"""API models for agent runs, the tenant switch, claim suggestions and reviews.

Request models forbid unknown keys (a client can never send a tenant, an origin, a confidence
of its own, a run id of a claim or a provider). Responses are `extra="forbid"` too, so a
column added to the database cannot leak by accident."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import model_validator

from app.crm.models import ApiUuid, _Strict

RunStatus = Literal["running", "succeeded", "failed", "cancelled", "expired", "killed"]
ReviewState = Literal["not_applicable", "unreviewed", "accepted", "rejected"]
ErrorCode = Literal[
    "budget",
    "expired",
    "killed",
    "cancelled",
    "disabled",
    "tool_failed",
    "model_failed",
    "invalid_output",
]


class RunStart(_Strict):
    """Start one run of one agent on one company, lead or enquiry (the requirement agent works on
    an enquiry, the others on a company or a lead). The id is chosen by the caller (idempotent
    start)."""

    id: ApiUuid
    agent: Literal["selftest", "research", "requirement"]
    target_kind: Literal["company", "lead", "enquiry"]
    target_id: ApiUuid


class RunOut(_Strict):
    id: uuid.UUID
    agent_name: str
    agent_version: str
    status: RunStatus
    started_by: uuid.UUID
    company_id: uuid.UUID | None
    lead_id: uuid.UUID | None
    enquiry_id: uuid.UUID | None = None
    created_at: datetime
    expires_at: datetime
    finished_at: datetime | None
    error_code: ErrorCode | None
    cancel_requested: bool
    max_writes: int
    writes_used: int
    max_tool_calls: int
    tool_calls_used: int
    max_input_tokens: int
    input_tokens_used: int
    max_output_tokens: int
    output_tokens_used: int
    max_cost_micros: int
    cost_micros_used: int


class CancelOut(_Strict):
    status: RunStatus
    replayed: bool


class OpenReservationOut(_Strict):
    """A model call that was reserved and never settled: it keeps counting at its worst case until
    its (Asia/Kolkata) day ends. `run_status` says whether its run is still running."""

    run_id: uuid.UUID
    step_key: str
    reserved_micros: int
    run_status: RunStatus
    created_at: datetime


class AgentCostOut(_Strict):
    """Today's (Indian day) agent spending of a workspace, for its Owner / Admin.

    Amounts are millionths of the billing currency. `open_micros` is counted at the worst
    case, not at what was spent.
    """

    day: date
    cap_micros: int
    settled_micros: int
    open_micros: int
    open: list[OpenReservationOut]


class AgentSettingsOut(_Strict):
    enabled: bool


class AgentSettingsIn(_Strict):
    enabled: bool


class ClaimEvidenceOut(_Strict):
    """What a suggestion rests on, for a reviewer. Everything here is UNTRUSTED text (a model chose
    the quote from a page a stranger controls): clients render it as plain text. No link is
    offered: the source is a host and a path, shown as text.

    The runtime checked that the quote appears in the page it names; the DATABASE did not (it
    never sees the page): a client says so next to the quote."""

    kind: str
    stance: Literal["supports", "context", "contradicts"]
    provider: str
    host: str | None
    path: str | None
    quote: str | None


class ClaimSuggestionOut(_Strict):
    """A claim with its effective review state. An agent claim is a SUGGESTION until a human
    accepts it."""

    id: uuid.UUID
    company_id: uuid.UUID | None
    lead_id: uuid.UUID | None
    predicate: str
    value: str
    confidence: Literal["unverified", "low", "medium", "high"]
    claim_confidence: Literal["unverified", "low", "medium", "high"]
    created_via: Literal["manual", "import", "agent"]
    agent_run_id: uuid.UUID | None
    created_by: uuid.UUID | None
    created_at: datetime
    review_state: ReviewState
    review_confidence: Literal["low", "medium", "high"] | None
    reviewed_by: uuid.UUID | None
    reviewed_at: datetime | None
    # True when the workspace's active ICP profile reads this predicate
    # (an accepted suggestion can then change a score)
    counts_toward_score: bool = False
    # the company the claim is about (its home), for the reviewer's list
    company_name: str | None = None
    # the evidence this claim cites (live links only)
    evidence: list[ClaimEvidenceOut] = []


class ReviewIn(_Strict):
    """A human's decision on one agent claim. Mirrors the database rules; the database remains
    the authority."""

    id: ApiUuid
    decision: Literal["accepted", "rejected"]
    confidence: Literal["low", "medium", "high"] | None = None
    reason_code: (
        Literal["incorrect", "unsupported_by_evidence", "outdated", "duplicate", "not_relevant"]
        | None
    ) = None

    @model_validator(mode="after")
    def _shape(self) -> ReviewIn:
        if self.decision == "accepted" and (
            self.confidence is None or self.reason_code is not None
        ):
            raise ValueError("accepted needs a confidence and no reason")
        if self.decision == "rejected" and self.confidence is not None:
            raise ValueError("rejected carries no confidence (a reason is optional)")
        return self


class ReviewOut(_Strict):
    review_id: uuid.UUID
    replayed: bool
    self_review: bool
