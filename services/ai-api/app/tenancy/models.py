"""API-facing models for tenancy. Mirrors packages/contracts/tenancy.schema.json."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any

from pydantic import BaseModel, ConfigDict, StringConstraints

SLUG_PATTERN = r"^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$"


class Role(StrEnum):
    OWNER = "owner"
    ADMIN = "admin"
    SALES = "sales"
    VIEWER = "viewer"


class _Out(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TenantOut(_Out):
    id: uuid.UUID
    name: str
    slug: str


class MembershipOut(_Out):
    tenant: TenantOut
    role: Role


class MeOut(_Out):
    user_id: uuid.UUID
    memberships: list[MembershipOut]


class TenantDetailOut(TenantOut):
    """A tenant plus the caller's own role in it."""

    role: Role


class MemberOut(_Out):
    user_id: uuid.UUID
    role: Role
    display_name: str | None


class MemberListOut(_Out):
    members: list[MemberOut]


class AuditEventOut(_Out):
    id: int
    actor_user_id: uuid.UUID | None
    actor_type: str
    action: str
    entity_type: str
    entity_id: uuid.UUID | None
    old_values: dict[str, Any] | None
    new_values: dict[str, Any] | None
    request_id: str | None
    created_at: datetime


class AuditEventListOut(_Out):
    events: list[AuditEventOut]
    # Pass as ?before_id= to fetch the next (older) page; null when there is no more.
    next_before_id: int | None


class CreateTenantIn(BaseModel):
    """Input validation mirrors the database rules; the database remains the authority."""

    model_config = ConfigDict(extra="forbid")

    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    slug: Annotated[str, StringConstraints(strip_whitespace=True, pattern=SLUG_PATTERN)]
