"""Store visits, the opening hours and the slots under /v1/tenants/{tenant_id}/... (job AS, ADR 0067).

Authorization, in order, for every endpoint: a valid JWT (401); membership of the tenant in the PATH (404); a role that may perform the action (403: every member reads visits, hours and slots;
Owner and Admin edit the hours; Owner, Admin and Sales book, move, confirm, receive, complete and message; only the Owner offers a visit on a call request); a second factor where the action
needs one (403 mfa_required: offering a visit declines a call; starting an order from a visit); then the database decides again (RLS, the slots, the capacity, the state machine, the order flow).

There is NO field that names a status, a contact, a source, a phone number or an approver. A message a visit makes leaves only through the outbox (job AT): its policy decides, and the only
channel adapter that exists is a local fake. Nothing here dials or sends by itself.

NOTE: no `from __future__ import annotations` here, for the same reason as app/orders/routes.py (request models are attached to the endpoint signatures at registration time)."""

import uuid
from datetime import date
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query

from app.auth.deps import AnyMember, Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.outbox import service as outbox_service
from app.outbox.models import CallRequestOut, DispatchOut, OutboxMessageOut
from app.tenancy.models import Role
from app.visits import service, texts
from app.visits.models import (
    BookVisitIn,
    CancelVisitIn,
    ChangeVisitIn,
    CompleteVisitIn,
    MessageResultOut,
    OfferVisitIn,
    OfferVisitOut,
    SendMessageIn,
    SlotsOut,
    StoreSettingsIn,
    StoreSettingsOut,
    TodayVisitsOut,
    VisitChangeOut,
    VisitCompleteOut,
    VisitListOut,
    VisitOut,
    VisitResultOut,
)

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["visits"])

RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
SalesPlus = Annotated[
    TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))
]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
VisitStatusFilter = Literal["booked", "confirmed", "arrived", "completed", "no_show", "cancelled"]


def _repo(runtime: Runtime) -> Any:
    if runtime.visits is None:
        raise ApiError(503, "visits_unavailable", "Visits are not available right now.")
    return runtime.visits


def _row_id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _visit(runtime: Runtime, ctx: TenantContext, visit_id: uuid.UUID) -> VisitOut:
    raw = _repo(runtime).list_visits(
        ctx.principal.token,
        ctx.tenant.id,
        date_from=None,
        date_to=None,
        open_only=False,
        status=None,
        lead_id=None,
        visit_id=visit_id,
    )
    return service.visit_out(service.require_visit(raw))


def _dispatch(runtime: Runtime, ctx: TenantContext) -> DispatchOut | None:
    """Owner and Admin hand due messages to the channel right after they act; anyone else leaves them for the next dispatch (the same rule as the outbox's own routes)."""
    if ctx.role not in (Role.OWNER, Role.ADMIN):
        return None
    if runtime.outbox is None or runtime.outbox_adapter is None:
        raise ApiError(503, "outbox_unavailable", "Messages are not available right now.")
    return outbox_service.dispatch_due(
        runtime.outbox, runtime.outbox_adapter, ctx.principal.token, ctx.tenant.id
    )


def _message(runtime: Runtime, ctx: TenantContext, message_id: uuid.UUID) -> OutboxMessageOut:
    if runtime.outbox is None:
        raise ApiError(503, "outbox_unavailable", "Messages are not available right now.")
    row = runtime.outbox.get_message(ctx.principal.token, ctx.tenant.id, message_id)
    if row is None:
        raise not_found()
    return outbox_service.message_out(row)


# ------------------------------------------------------------------------------------------------ hours and slots
@router.get("/visits/settings", response_model=StoreSettingsOut)
def get_settings(ctx: AnyMember, runtime: RuntimeDep) -> StoreSettingsOut:
    """The opening hours, closed dates, slot length and how many visits at once. Every member reads; a business that never saved its own has the defaults (`is_default`)."""
    return service.settings_out(_repo(runtime).settings_get(ctx.principal.token, ctx.tenant.id))


@router.put("/visits/settings", response_model=StoreSettingsOut)
def put_settings(body: StoreSettingsIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> StoreSettingsOut:
    """Owner or Admin. The whole week at once. It changes no visit that is already booked."""
    return service.settings_out(
        _repo(runtime).settings_set(ctx.principal.token, ctx.tenant.id, service.settings_args(body))
    )


@router.get("/visits/slots", response_model=SlotsOut)
def get_slots(
    ctx: AnyMember, runtime: RuntimeDep, day: Annotated[date, Query(alias="date")]
) -> SlotsOut:
    """The slots of one India date and how many places are free in each. A date that has passed has none (`reason: past`); a closed day says why."""
    return service.slots_out(
        _repo(runtime).slots(ctx.principal.token, ctx.tenant.id, day.isoformat())
    )


# ------------------------------------------------------------------------------------------------ reading visits
@router.get("/visits/today", response_model=TodayVisitsOut)
def get_today(ctx: AnyMember, runtime: RuntimeDep) -> TodayVisitsOut:
    """The Today page's "At the store today": today's (India date) visits that are still to come or here now, in time order. Any member reads."""
    raw = _repo(runtime).list_visits(
        ctx.principal.token,
        ctx.tenant.id,
        date_from=None,
        date_to=None,
        open_only=True,
        status=None,
        lead_id=None,
        visit_id=None,
    )
    return service.today_out(raw)


@router.get("/visits", response_model=VisitListOut, response_model_by_alias=True)
def list_visits(
    ctx: AnyMember,
    runtime: RuntimeDep,
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
    status: VisitStatusFilter | None = None,
    lead_id: str | None = None,
    open_only: bool = False,
) -> VisitListOut:
    """Visits of a range of India dates (today when nothing is asked; at most 62 days, 300 visits), in time order. Filter by status or by lead."""
    lead = _row_id(lead_id) if lead_id is not None else None
    raw = _repo(runtime).list_visits(
        ctx.principal.token,
        ctx.tenant.id,
        date_from=date_from.isoformat() if date_from else None,
        date_to=date_to.isoformat() if date_to else None,
        open_only=open_only,
        status=status,
        lead_id=lead,
        visit_id=None,
    )
    return service.list_out(raw)


@router.get("/visits/{visit_id}", response_model=VisitOut)
def get_visit(visit_id: str, ctx: AnyMember, runtime: RuntimeDep) -> VisitOut:
    return _visit(runtime, ctx, _row_id(visit_id))


# ------------------------------------------------------------------------------------------------ booking and the steps
@router.post("/visits", response_model=VisitResultOut)
def book_visit(body: BookVisitIn, ctx: SalesPlus, runtime: RuntimeDep) -> VisitResultOut:
    """Book a visit in a slot of an India date. Retrying with the same visit_id replays. The visit starts `booked`; nothing is sent."""
    result = _repo(runtime).book(
        ctx.principal.token,
        {
            "p_visit_id": str(body.visit_id),
            "p_tenant_id": str(ctx.tenant.id),
            "p_lead_id": str(body.lead_id),
            "p_date": body.date.isoformat(),
            "p_slot_start": body.slot_start,
            "p_party_size": body.party_size,
            "p_purpose": body.purpose,
            "p_note": body.note,
            "p_advance_paise": body.advance_paise,
            "p_source": "staff",
        },
    )
    return VisitResultOut(
        visit=_visit(runtime, ctx, body.visit_id), replayed=result.get("replayed") is True
    )


@router.post("/visits/{visit_id}/change", response_model=VisitChangeOut)
def change_visit(
    visit_id: str, body: ChangeVisitIn, ctx: SalesPlus, runtime: RuntimeDep
) -> VisitChangeOut:
    """Move a visit that has not happened (booked or confirmed) and/or change its details. A visit that moves goes back to `booked`: the customer must confirm the new time."""
    row_id = _row_id(visit_id)
    _visit(runtime, ctx, row_id)  # 404 unless it is visible to this caller
    if (body.date is None) != (body.slot_start is None):
        raise ApiError(422, "validation_error", "Invalid input.")
    if body.clear_advance and body.advance_paise is not None:
        raise ApiError(422, "validation_error", "Invalid input.")
    result = _repo(runtime).change(
        ctx.principal.token,
        {
            "p_tenant_id": str(ctx.tenant.id),
            "p_visit_id": str(row_id),
            "p_date": body.date.isoformat() if body.date else None,
            "p_slot_start": body.slot_start,
            "p_party_size": body.party_size,
            "p_purpose": body.purpose,
            "p_note": body.note,
            "p_advance_paise": body.advance_paise,
            "p_clear_advance": body.clear_advance,
        },
    )
    return VisitChangeOut(visit=_visit(runtime, ctx, row_id), moved=result.get("moved") is True)


def _step(
    visit_id: str,
    action: str,
    reason: str | None,
    ctx: TenantContext,
    runtime: Runtime,
) -> VisitResultOut:
    row_id = _row_id(visit_id)
    _visit(runtime, ctx, row_id)  # 404 unless it is visible to this caller
    result = _repo(runtime).step(ctx.principal.token, ctx.tenant.id, row_id, action, reason)
    return VisitResultOut(
        visit=_visit(runtime, ctx, row_id), replayed=result.get("replayed") is True
    )


@router.post("/visits/{visit_id}/confirm", response_model=VisitResultOut)
def confirm_visit(visit_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> VisitResultOut:
    """booked -> confirmed (the customer agreed to the time). Sends nothing: use /messages for the confirmation."""
    return _step(visit_id, "confirm", None, ctx, runtime)


@router.post("/visits/{visit_id}/arrive", response_model=VisitResultOut)
def arrive_visit(visit_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> VisitResultOut:
    """The customer is at the shop (booked or confirmed -> arrived). Only on the day of the visit."""
    return _step(visit_id, "arrive", None, ctx, runtime)


@router.post("/visits/{visit_id}/no-show", response_model=VisitResultOut)
def no_show_visit(visit_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> VisitResultOut:
    """The customer did not come (booked or confirmed -> no_show). Only once the visit's time has come."""
    return _step(visit_id, "no_show", None, ctx, runtime)


@router.post("/visits/{visit_id}/cancel", response_model=VisitResultOut)
def cancel_visit(
    visit_id: str, ctx: SalesPlus, runtime: RuntimeDep, body: CancelVisitIn | None = None
) -> VisitResultOut:
    """booked or confirmed -> cancelled, with an optional reason. A cancelled visit stays on record."""
    return _step(visit_id, "cancel", body.reason if body else None, ctx, runtime)


@router.post("/visits/{visit_id}/complete", response_model=VisitCompleteOut)
def complete_visit(
    visit_id: str, body: CompleteVisitIn, ctx: SalesPlus, runtime: RuntimeDep
) -> VisitCompleteOut:
    """arrived -> completed with how it ended. `bought` may also start the order (`order_id`): that is the existing order flow, from an APPROVED quote of this customer, and needs an Owner or
    Admin with a second factor; if it cannot be made the visit stays arrived."""
    row_id = _row_id(visit_id)
    _visit(runtime, ctx, row_id)  # 404 unless it is visible to this caller
    if body.quote_id is not None and body.order_id is None:
        raise ApiError(422, "validation_error", "Invalid input.")
    if body.order_id is not None and body.outcome != "bought":
        raise ApiError(422, "validation_error", "Invalid input.")
    result = _repo(runtime).complete(
        ctx.principal.token,
        {
            "p_tenant_id": str(ctx.tenant.id),
            "p_visit_id": str(row_id),
            "p_outcome": body.outcome,
            "p_order_id": str(body.order_id) if body.order_id else None,
            "p_quote_id": str(body.quote_id) if body.quote_id else None,
        },
    )
    visit = _visit(runtime, ctx, row_id)
    return VisitCompleteOut(
        visit=visit, order_id=visit.order_id, replayed=result.get("replayed") is True
    )


# ------------------------------------------------------------------------------------------------ messages through the outbox
@router.post("/visits/{visit_id}/messages", response_model=MessageResultOut)
def send_visit_message(
    visit_id: str, body: SendMessageIn, ctx: SalesPlus, runtime: RuntimeDep
) -> MessageResultOut:
    """Make a confirmation (of a confirmed visit) or a reminder (of a confirmed visit that has not started) in the customer's language, from fixed templates. The message goes into the outbox:
    its policy decides (it goes by itself, waits for 9 am in quiet hours, or waits for a person if it mentions money or its words are not yet checked by a native reader). Retrying replays."""
    row_id = _row_id(visit_id)
    visit = _visit(runtime, ctx, row_id)  # 404 unless it is visible to this caller
    words = texts.render(body.kind, body.language, visit.starts_at, visit.advance_paise)
    message_id = service.message_id(
        row_id, body.kind, visit.starts_at, body.language, visit.advance_paise
    )
    result = _repo(runtime).send_message(
        ctx.principal.token,
        {
            "p_tenant_id": str(ctx.tenant.id),
            "p_visit_id": str(row_id),
            "p_kind": body.kind,
            "p_message_id": str(message_id),
            "p_body": words,
            "p_language": body.language,
            "p_uncertain": not texts.is_checked(body.language),
        },
    )
    replayed = result.get("replayed") is True
    dispatched = None if replayed else _dispatch(runtime, ctx)
    return MessageResultOut(
        visit=_visit(runtime, ctx, row_id),
        message=_message(runtime, ctx, message_id),
        replayed=replayed,
        dispatched=dispatched,
    )


@router.post("/call-requests/{request_id}/offer-visit", response_model=OfferVisitOut)
def offer_visit(
    request_id: str, ctx: OwnerStrong, runtime: RuntimeDep, body: OfferVisitIn | None = None
) -> OfferVisitOut:
    """ "Offer a store visit" on a call request. The Owner, with a second factor, declines the call (the fixed note `offer_store_visit`) AND the offer message is made in the outbox, in one step.
    The words are a fixed template. The policy decides what happens to the message (nothing about money is in it). Retrying replays."""
    row_id = _row_id(request_id)
    language = body.language if body else "en"
    if runtime.outbox is None:
        raise ApiError(503, "outbox_unavailable", "Messages are not available right now.")
    if runtime.outbox.get_call(ctx.principal.token, ctx.tenant.id, row_id) is None:
        raise not_found()
    message_id = service.offer_message_id(row_id, language)
    result = _repo(runtime).offer_visit(
        ctx.principal.token,
        {
            "p_tenant_id": str(ctx.tenant.id),
            "p_request_id": str(row_id),
            "p_message_id": str(message_id),
            "p_body": texts.render("offer", language),
            "p_language": language,
            "p_uncertain": not texts.is_checked(language),
        },
    )
    call = runtime.outbox.get_call(ctx.principal.token, ctx.tenant.id, row_id)
    if call is None:
        raise not_found()
    message = result.get("message")
    replayed = isinstance(message, dict) and message.get("replayed") is True
    return OfferVisitOut(
        request=_call(call),
        message=_message(runtime, ctx, message_id),
        replayed=replayed,
        dispatched=None if replayed else _dispatch(runtime, ctx),
    )


def _call(row: dict[str, Any]) -> CallRequestOut:
    return outbox_service.call_out(row)
