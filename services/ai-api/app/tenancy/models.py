"""API-facing models for tenancy. Mirrors packages/contracts/tenancy.schema.json."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints

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


class TenantPlanOut(_Out):
    """The plan of a business (job AD / D1). Read-only for clients: only the operator changes it."""

    plan: Literal["free_trial"]
    workspace_limit: int
    trial_started_at: datetime


class TenantWithPlanOut(TenantDetailOut, TenantPlanOut):
    """GET /v1/tenants/{id}: the tenant, the caller's role in it, and the plan.

    `assistant_name` is the name the Owner gave the AI assistant (null before the first save),
    for every member.
    """

    assistant_name: str | None = None


class AccountSetupOut(_Out):
    """What this account still has to do after sign-up (job AD / D2).

    `needed`: confirmed, terms accepted (or a Google / Facebook account), no business yet.
    `done`: the setup was done (tenant_id says which business). `none`: nothing to do (an
    invited person).
    """

    state: Literal["none", "needed", "done"]
    tenant_id: uuid.UUID | None
    business_name: str | None


class AccountSetupIn(BaseModel):
    """The two choices of the first-login setup: the business type (a pack code from
    GET /v1/packs; the database refuses one that is not selectable, SM702) and the language.
    The business type is the ONLY thing sign-up asks (job CK); a business name typed at an
    e-mail sign-up is used if present, otherwise the business is called "My business" until
    the activation checklist asks."""

    model_config = ConfigDict(extra="forbid")

    business_type: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{1,30}$")]
    language: Literal["en", "te", "hi", "kn"]
    # job DT: what an "Other" business is, in the Owner's own words (2 to 60 characters; required
    # for "other", refused for any other type)
    business_label: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=60)] | None
    ) = None
    # job BI: the terms and privacy-notice versions the person accepted on the sign-up page (the
    # current ones: GET /v1/policies/current). Recorded before the business is made.
    accepted_terms_version: str | None = Field(
        default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$"
    )
    accepted_privacy_version: str | None = Field(
        default=None, pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$"
    )


class AccountSetupResultOut(_Out):
    tenant_id: uuid.UUID
    # false for a repeat (a double click or a second tab): the same business, nothing new
    created: bool


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
