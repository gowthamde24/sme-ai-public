"""Enquiry and requirement endpoints under /v1/tenants/{tenant_id}/... (T008).

Authorization, in order, for every endpoint (as for the CRM and agent routes): a valid JWT (401); membership of the tenant in the PATH (404);
a role that may perform the action (403); the lead / enquiry / field / requirement must exist FOR THIS CALLER (404 otherwise: unknown,
malformed and foreign ids look the same); then the database decides again (RLS, column grants, the definer functions).

There is NO endpoint that sends anything, none that writes a question, none that takes a tenant, an origin or a confidence from a body.
Questions are derived at read time. A requirement is confirmed, a field decided or added only by a person.

NOTE: no `from __future__ import annotations` here, for the same reason as app/crm/routes.py (request models are attached to the
endpoint signatures at registration time)."""

import uuid
from datetime import UTC, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.enquiries.models import (
    AddFieldIn,
    CaptureIn,
    CaptureOut,
    DecisionIn,
    EnquiryOut,
    FieldAddedOut,
    FieldDecisionOut,
    RequirementActionOut,
    RequirementViewOut,
)
from app.enquiries.service import build_view
from app.errors import ApiError, not_found
from app.requirements.capture_text import prepare_body, prepare_subject
from app.requirements.normalise import Refused, Value, normalise
from app.requirements.quote import find_quote
from app.requirements.vocabulary import LINE_KEYS
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}")

SALES_PLUS: tuple[Role, ...] = (Role.OWNER, Role.ADMIN, Role.SALES)
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
SalesPlus = Annotated[TenantContext, Depends(require_tenant_role(*SALES_PLUS))]

# fixed messages: nothing the customer wrote, no value, nothing from the data layer
_REFUSED = {
    "over_cap": "That value is larger than the limit this application accepts.",
    "under_floor": "That value is smaller than the limit this application accepts.",
    "festival": "A festival or a season is not a date. Give a date, or leave it out.",
    "not_a_city": "A delivery city is letters only (at most 60 characters).",
    "unparsed": "That value could not be read. Write it the way the enquiry does, for example '20', 'next Friday', 'Rs 5k each'.",
    "unknown_field": "That field is not one this application knows.",
}


def _agents_off() -> ApiError:
    return ApiError(503, "enquiries_unavailable", "Enquiries are not available right now.")


def _repo(runtime: Runtime) -> Any:
    if runtime.enquiries is None:
        raise _agents_off()
    return runtime.enquiries


def _row_id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _visible_enquiry(runtime: Runtime, ctx: TenantContext, raw_id: str) -> EnquiryOut:
    enquiry = _repo(runtime).get(ctx.principal.token, ctx.tenant.id, _row_id(raw_id))
    if enquiry is None:
        raise not_found()
    result: EnquiryOut = enquiry
    return result


def _typed(field: str, raw: str, received_at: datetime) -> dict[str, Any]:
    """The value the person wrote, read by the SAME normalisers as the agent's, as the database function's arguments."""
    try:
        got = normalise(field, raw, received_at)
    except Refused as refused:
        message = _REFUSED.get(refused.reason, _REFUSED["unparsed"])
        raise ApiError(422, "value_not_accepted", message) from None
    value: Value = got.value
    return {
        "value_code": value.code,
        "value_int": value.int_value,
        "value_date": value.date_value.isoformat() if value.date_value else None,
        "value_text": value.text,
        "basis": value.basis,
    }


# ----------------------------------------------------------------------------- capture
@router.post("/leads/{lead_id}/enquiries", response_model=CaptureOut, status_code=201)
def capture_enquiry(
    lead_id: str, body: CaptureIn, ctx: SalesPlus, runtime: RuntimeDep, response: Response
) -> CaptureOut:
    lid = _row_id(lead_id)
    token, tenant = ctx.principal.token, ctx.tenant.id
    lead = runtime.crm.get_row(token, "leads", tenant, lid)  # a lead the CALLER can see
    if lead is None:
        raise not_found()
    if lead.archived_at is not None:
        raise ApiError(409, "archived", "This record is archived; an admin must restore it first.")
    if body.received_at > datetime.now(UTC) + timedelta(minutes=5):
        raise ApiError(422, "received_in_future", "An enquiry cannot be received in the future.")
    # invisible characters are STRIPPED and contact details REMOVED before anything is stored; the original is kept nowhere
    prepared = prepare_body(body.text)
    if not prepared.text:
        raise ApiError(422, "empty_enquiry", "There is no text left to store after cleaning it.")
    subject = prepare_subject(body.subject) if body.subject else None
    payload = {
        "id": str(body.id),
        "lead_id": str(lid),
        "channel": body.channel,
        "received_at": body.received_at.astimezone(UTC).isoformat(),
        "subject": subject,
        "body": prepared.text,
        "truncated_from": prepared.truncated_from,
    }
    enquiry, replayed = _repo(runtime).create(token, tenant, payload)
    response.status_code = 200 if replayed else 201
    return CaptureOut(
        enquiry=enquiry,
        text_changed=prepared.text != body.text.strip(" \t\r\n"),
        truncated=prepared.truncated_from is not None,
    )


@router.get("/leads/{lead_id}/enquiries", response_model=list[EnquiryOut])
def list_enquiries(
    lead_id: str,
    ctx: AnyMember,
    runtime: RuntimeDep,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[EnquiryOut]:
    lid = _row_id(lead_id)
    if runtime.crm.get_row(ctx.principal.token, "leads", ctx.tenant.id, lid) is None:
        raise not_found()
    items: list[EnquiryOut] = _repo(runtime).list_for_lead(
        ctx.principal.token, ctx.tenant.id, lid, limit=limit
    )
    return items


@router.get("/enquiries/{enquiry_id}", response_model=EnquiryOut)
def get_enquiry(enquiry_id: str, ctx: AnyMember, runtime: RuntimeDep) -> EnquiryOut:
    return _visible_enquiry(runtime, ctx, enquiry_id)


# ----------------------------------------------------------------------------- the requirement
@router.get("/enquiries/{enquiry_id}/requirement", response_model=RequirementViewOut)
def get_requirement(enquiry_id: str, ctx: AnyMember, runtime: RuntimeDep) -> RequirementViewOut:
    enquiry = _visible_enquiry(runtime, ctx, enquiry_id)
    requirement, rows = _repo(runtime).get_requirement(
        ctx.principal.token, ctx.tenant.id, enquiry.id
    )
    return build_view(requirement, rows)


@router.post("/enquiries/{enquiry_id}/requirement-fields", response_model=FieldAddedOut)
def add_field(
    enquiry_id: str, body: AddFieldIn, ctx: SalesPlus, runtime: RuntimeDep
) -> FieldAddedOut:
    """A person adds a field the extraction missed."""
    enquiry = _visible_enquiry(runtime, ctx, enquiry_id)
    if (body.field in LINE_KEYS) != (body.line is not None):
        raise ApiError(
            422, "invalid_line", "Line fields need a line (1 to 5); order fields have none."
        )
    args: dict[str, Any] = {
        "p_enquiry_id": str(enquiry.id),
        "p_line": body.line,
        "p_key": body.field,
        **{f"p_{k}": v for k, v in _typed(body.field, body.value, enquiry.received_at).items()},
        "p_quote": None,
        "p_start": None,
        "p_end": None,
    }
    if body.quote is not None:
        span = find_quote(enquiry.body, body.quote)
        if span is None:
            raise ApiError(
                422, "quote_not_found", "That quote is not in the enquiry text, word for word."
            )
        args.update(p_quote=body.quote, p_start=span[0], p_end=span[1])
    return FieldAddedOut.model_validate(_repo(runtime).add_field(ctx.principal.token, args))


@router.post("/requirement-fields/{field_id}/decision", response_model=FieldDecisionOut)
def decide_field(
    field_id: str, body: DecisionIn, ctx: SalesPlus, runtime: RuntimeDep
) -> FieldDecisionOut:
    fid = _row_id(field_id)
    repo = _repo(runtime)
    field = repo.get_field(ctx.principal.token, ctx.tenant.id, fid)
    if field is None:
        raise not_found()
    if (body.decision == "correct") != (body.value is not None):
        raise ApiError(
            422,
            "invalid_decision",
            "A correction carries the corrected value; a confirm or a reject carries none.",
        )
    value: dict[str, Any] = {}
    if body.value is not None:
        enquiry = repo.get(
            ctx.principal.token, ctx.tenant.id, uuid.UUID(str(field["requirement"]["enquiry_id"]))
        )
        if enquiry is None:
            raise not_found()
        value = _typed(field["field_key"], body.value, enquiry.received_at)
    return FieldDecisionOut.model_validate(
        repo.decide(ctx.principal.token, fid, body.decision, value)
    )


def _act(
    ctx: TenantContext, runtime: Runtime, requirement_id: str, action: str
) -> RequirementActionOut:
    rid = _row_id(requirement_id)
    repo = _repo(runtime)
    if not repo.requirement_exists(ctx.principal.token, ctx.tenant.id, rid):
        raise not_found()
    result = (
        repo.confirm(ctx.principal.token, rid)
        if action == "confirm"
        else repo.discard(ctx.principal.token, rid)
    )
    return RequirementActionOut.model_validate(result)


@router.post("/requirements/{requirement_id}/confirm", response_model=RequirementActionOut)
def confirm_requirement(
    requirement_id: str, ctx: SalesPlus, runtime: RuntimeDep
) -> RequirementActionOut:
    return _act(ctx, runtime, requirement_id, "confirm")


@router.post("/requirements/{requirement_id}/discard", response_model=RequirementActionOut)
def discard_requirement(
    requirement_id: str, ctx: SalesPlus, runtime: RuntimeDep
) -> RequirementActionOut:
    return _act(ctx, runtime, requirement_id, "discard")
