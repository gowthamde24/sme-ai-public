"""Jobs, slice S1: the trust pieces (jobs contract 1.0 sections 3, 6, 15.6, 16). Both routers answer 404 while JOBS is off (before anything else, sign-in included).

  GET  /do-not-call?q&cursor&limit&include=lifted     every member: the list (a number is shown by its last four digits; `count` is the active entries, `lifted_count` only with include=lifted)
  POST /do-not-call {phone}                           Owner, Admin: add (idempotent); a number that is not a contact is stored as its key only
  POST /do-not-call/{id}/remove                       Owner, with the second factor: only an entry the owner added; 409 stopped_by_customer for a number the customer asked us to stop, 409 not_removable for the rest
  GET|POST /jobs/{job}/faqs, PATCH|POST .../faqs/{faq}[/remove]   FAQs of a job (Owner, Admin write; every member reads): 300 + 300 characters; 422 faq_not_allowed for an answer with a price, a discount or a promise

The database decides every rule; the routes carry the caller's token and give each refusal its closed word. NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

# ruff: noqa: E501

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.auth.deps import (
    AnyMember,
    OwnerOrAdmin,
    Runtime,
    TenantContext,
    get_runtime,
    require_tenant_role,
)
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.jobs.routes import jobs_on
from app.jobs.trust import REFUSALS, JobsRefused
from app.jobs.wiring import JobsRuntime
from app.suppression import keys as suppression_keys
from app.tenancy.models import Role

dnc_router = APIRouter(prefix="/v1/tenants/{tenant_id}/do-not-call", tags=["jobs"], dependencies=[Depends(jobs_on)])
faq_router = APIRouter(prefix="/v1/tenants/{tenant_id}/jobs/{job_id}/faqs", tags=["jobs"], dependencies=[Depends(jobs_on)])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
JobsDep = Annotated[JobsRuntime, Depends(jobs_on)]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]

Reason = Literal["stop_whatsapp", "asked_on_call", "added_by_owner", "other"]
Text300 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]


class _Out(BaseModel):
    model_config = ConfigDict(extra="forbid")


class HistoryLine(_Out):
    at: datetime
    how: Literal["customer_message", "owner_recorded_yes", "form_tick"]
    by: Literal["customer", "owner_recorded"]


class DoNotCallEntry(_Out):
    id: uuid.UUID
    state: Literal["active", "lifted", "removed"]
    reason: Reason
    phone_masked: str
    last4: str
    added_by: str | None
    added_at: datetime
    lifted_at: datetime | None
    history: list[HistoryLine]


class DoNotCallList(_Out):
    items: list[DoNotCallEntry]
    count: int
    next_cursor: str | None
    lifted_count: int | None = None


class DoNotCallAdd(BaseModel):
    model_config = ConfigDict(extra="forbid")

    phone: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=40)]


class FaqIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: uuid.UUID | None = None   # the web's own id: the same id again is the same FAQ (a retry)
    question: Text300
    answer: Text300


class FaqPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    question: Text300 | None = None
    answer: Text300 | None = None

    @model_validator(mode="after")
    def _one(self) -> "FaqPatch":
        if self.question is None and self.answer is None:
            raise ValueError("nothing to change")
        return self


class FaqOut(_Out):
    id: uuid.UUID
    job_id: uuid.UUID
    question: str
    answer: str
    created_at: datetime
    updated_at: datetime


class FaqList(_Out):
    items: list[FaqOut]


class FaqRemoved(_Out):
    id: uuid.UUID
    removed: bool = Field(default=True)


def _store(jobs: JobsRuntime) -> Any:
    if jobs.trust is None:
        raise ApiError(503, "jobs_unavailable", "Jobs are not available on this system.")
    return jobs.trust


def _run(call: Any) -> Any:
    """One trust call; a closed refusal of the database becomes its fixed sentence (nothing from the data layer)."""
    try:
        return call()
    except JobsRefused as refused:
        status, code, message = REFUSALS[refused.code]
        raise ApiError(status, code, message) from None


def _uuid(value: str) -> uuid.UUID:
    parsed = parse_uuid(value)
    if parsed is None:
        raise not_found()
    return parsed


# ------------------------------------------------------------------------------------------------------------------ the do-not-call list
@dnc_router.get("", response_model=DoNotCallList)
def list_do_not_call(
    ctx: AnyMember,
    jobs: JobsDep,
    q: Annotated[str | None, Query(max_length=80)] = None,
    cursor: Annotated[str | None, Query(max_length=80)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    include: Annotated[Literal["lifted"] | None, Query()] = None,
) -> dict[str, Any]:
    """The do-not-call list: every number we must not call or message, by its last four digits, with the reason (`stop_whatsapp`, `asked_on_call`, `added_by_owner`, `other`). `include=lifted` adds the numbers whose customer asked to be contacted again."""
    out: dict[str, Any] = _run(lambda: _store(jobs).dnc_list(ctx.principal.token, ctx.tenant.id, q=q, cursor=cursor, limit=limit, include_lifted=include == "lifted"))
    return out


@dnc_router.post("", response_model=DoNotCallEntry)
def add_do_not_call(body: DoNotCallAdd, ctx: OwnerOrAdmin, runtime: RuntimeDep, jobs: JobsDep) -> dict[str, Any]:
    """Add a number (idempotent: the same number is the same entry). A number that is a contact suppresses the contact; one that is not is stored as its key only (its last four digits are kept to show it)."""
    ring = runtime.key_ring
    if ring is None:
        raise ApiError(503, "suppression_key_not_configured", "The suppression key is not configured, so numbers cannot be added.")
    phone = suppression_keys.normalise_phone(body.phone)
    key = ring.key_for(suppression_keys.PHONE, body.phone)
    if phone is None or key is None:
        raise ApiError(422, "phone_invalid", "That is not a phone number we can use. Check the digits.")
    out: dict[str, Any] = _run(lambda: _store(jobs).dnc_add(ctx.principal.token, ctx.tenant.id, body.phone, {"version": ring.current.version, "phone": key}))
    return out


@dnc_router.post("/{entry_id}/remove", response_model=DoNotCallEntry)
def remove_do_not_call(entry_id: str, ctx: OwnerStrong, jobs: JobsDep) -> dict[str, Any]:
    """Take a number the owner added off the list (the Owner only, with the second factor). A number the customer asked us to stop (on WhatsApp or on a call) can never be removed: 409 `stopped_by_customer`; the rest answer 409 `not_removable`."""
    out: dict[str, Any] = _run(lambda: _store(jobs).dnc_remove(ctx.principal.token, ctx.tenant.id, _uuid(entry_id)))
    return out


# ------------------------------------------------------------------------------------------------------------------ the FAQs of a job
@faq_router.get("", response_model=FaqList)
def list_faqs(job_id: str, ctx: AnyMember, jobs: JobsDep) -> dict[str, Any]:
    return {"items": _run(lambda: _store(jobs).faq_list(ctx.principal.token, ctx.tenant.id, _uuid(job_id)))}


@faq_router.post("", response_model=FaqOut)
def add_faq(job_id: str, body: FaqIn, ctx: OwnerOrAdmin, jobs: JobsDep) -> dict[str, Any]:
    """A question and its answer (300 characters each) the helper may use. An answer that states a price, a discount or a promise is refused (422 `faq_not_allowed`)."""
    out: dict[str, Any] = _run(lambda: _store(jobs).faq_add(ctx.principal.token, ctx.tenant.id, _uuid(job_id), body.id or uuid.uuid4(), body.question, body.answer))
    return out


@faq_router.patch("/{faq_id}", response_model=FaqOut)
def change_faq(job_id: str, faq_id: str, body: FaqPatch, ctx: OwnerOrAdmin, jobs: JobsDep) -> dict[str, Any]:
    out: dict[str, Any] = _run(lambda: _store(jobs).faq_update(ctx.principal.token, ctx.tenant.id, _uuid(job_id), _uuid(faq_id), body.question, body.answer))
    return out


@faq_router.post("/{faq_id}/remove", response_model=FaqRemoved)
def remove_faq(job_id: str, faq_id: str, ctx: OwnerOrAdmin, jobs: JobsDep) -> dict[str, Any]:
    out: dict[str, Any] = _run(lambda: _store(jobs).faq_remove(ctx.principal.token, ctx.tenant.id, _uuid(job_id), _uuid(faq_id)))
    return out


__all__ = ["dnc_router", "faq_router"]
