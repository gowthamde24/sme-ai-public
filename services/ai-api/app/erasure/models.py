"""API models for erasure requests (ADR 0014).

Requests forbid unknown keys: a client can never send a tenant, a status, a result or a requester.
The result carries counts and row ids only, never a value (the database writes it that way and
the model refuses anything else)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Literal

from pydantic import model_validator

from app.crm.models import ApiUuid, _Strict

Scope = Literal["contact", "company", "tenant"]
RequestStatus = Literal["pending", "executing", "executed", "cancelled"]


class ErasureRequestIn(_Strict):
    """Ask for one contact, one company or the whole workspace to be erased. The id is chosen by the
    caller (a retry with the same id and payload is a replay, never a second request)."""

    id: ApiUuid
    scope: Scope
    subject_id: ApiUuid | None = None

    @model_validator(mode="after")
    def _shape(self) -> ErasureRequestIn:
        if (self.scope == "tenant") != (self.subject_id is None):
            raise ValueError(
                "a contact or company request names its subject; a workspace one does not"
            )
        return self


class ExecuteIn(_Strict):
    """dry_run previews the counts and the review list and changes nothing."""

    dry_run: bool = False


class ReviewItem(_Strict):
    """A row whose free text merely CONTAINS the erased name: left untouched, listed for the
    Owner. Never a value."""

    table: str
    column: str
    id: uuid.UUID


class ErasureResultOut(_Strict):
    request_id: uuid.UUID
    scope: Scope
    status: Literal["executed", "dry_run"]
    dry_run: bool
    # rows changed per "table.column"
    counts: dict[str, int]
    review: list[ReviewItem]
    review_truncated: bool
    # exports already made in the workspace: those files are outside the system
    exports_logged: int
    # the limit of names, stated every time
    note: str
    replayed: bool = False


class DataPolicyOut(_Strict):
    """Whether this workspace accepts real contact details yet (the real-data gate, ADR 0015).
    Closed until the operator opens it."""

    real_data_allowed: bool


class ErasureRequestOut(_Strict):
    id: uuid.UUID
    scope: Scope
    subject_id: uuid.UUID | None
    status: RequestStatus
    requested_by: uuid.UUID
    created_at: datetime
    # a workspace-wide request cannot run before this moment (a 24-hour cancel window)
    execute_after: datetime
    executed_by: uuid.UUID | None
    executed_at: datetime | None
    cancelled_by: uuid.UUID | None
    cancelled_at: datetime | None
    result: ErasureResultOut | None
