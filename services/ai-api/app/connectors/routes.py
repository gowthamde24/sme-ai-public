"""The connectors' routes for PEOPLE, under /v1/tenants/{tenant_id} (job BZ, ADR 0080). Authorization, in order: a valid JWT (401); membership of the tenant in the PATH (404); a role (403); the workspace
the installation's credentials belong to (404 for any other); the connector switched on (503); then the database decides again.

  GET  /connectors/status                        what is switched on and waiting                                     Owner, Admin
  POST /connectors/indiamart/pull                pull the new IndiaMART leads in as leads with their enquiry         Owner, Admin
  POST /orders/{order_id}/payment-links          make a UPI payment link for (part of) what the order still lacks    Owner, Admin
  GET  /orders/{order_id}/payment-links          the links of an order                                               Owner, Admin, Sales
  POST /payment-links/{link_id}/send             queue the link as a WhatsApp message (an amount: a person approves) Owner, Admin, Sales
  POST /payment-links/{link_id}/record           record the payment the provider reported, on the order             Owner, Admin, Sales (the order rules decide)
  GET  /missed-calls                             the missed calls that wait                                         Owner, Admin, Sales
  POST /missed-calls/{call_id}/handle            "dealt with"                                                       Owner, Admin, Sales
  POST /call-requests/{request_id}/connect       place an APPROVED call request through the telephony provider      Owner, Admin

Money is never recorded by a webhook: the provider's message only marks the link paid; a person records it here, through the same order lifecycle as any payment.

NOTE: no `from __future__ import annotations` here, for the same reason as app/orders/routes.py (request models are attached to the endpoint signatures at registration time)."""

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Response
from pydantic import AwareDatetime, BaseModel, ConfigDict, StrictInt

from app.auth.deps import (
    OwnerOrAdmin,
    Runtime,
    TenantContext,
    get_runtime,
    require_tenant_role,
)
from app.connectors import phone as phones
from app.connectors import service
from app.connectors.errors import ConnectorRefused, ProviderError
from app.connectors.repository import tenant_args
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.orders.models import RecordEventIn
from app.orders.service import record_event as record_order_event
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["connectors"])

RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
SalesPlus = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
Language = Literal["en", "te", "hi", "kn"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _uuid(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _guard(call: Any) -> Any:
    try:
        return call()
    except ConnectorRefused as exc:
        raise exc.api() from None


# ------------------------------------------------------------------------------------------------ status
class StatusOut(_Strict):
    indiamart: dict[str, Any]
    payments: dict[str, Any]
    calls: dict[str, Any]


@router.get("/connectors/status", response_model=StatusOut)
def status(ctx: OwnerOrAdmin, runtime: RuntimeDep) -> StatusOut:
    c = runtime.connectors
    if c is None or c.tenant_id != ctx.tenant.id:
        raise not_found()
    row = _guard(lambda: c.repo.call(ctx.principal.token, "connectors_status", tenant_args(ctx.tenant.id)))
    return StatusOut(
        indiamart={"enabled": c.leads is not None, "last_pull_end": row.get("indiamart_last_end"), "last_pull_count": row.get("indiamart_last_count")},
        payments={"enabled": c.payments is not None, "provider": c.payments.name if c.payments else None, "open_links": row.get("open_links"), "paid_to_record": row.get("paid_to_record")},
        calls={"enabled": c.calls is not None, "provider": c.calls.name if c.calls else None, "missed_calls_waiting": row.get("missed_calls_waiting")},
    )


# ------------------------------------------------------------------------------------------------ IndiaMART
class PullOut(_Strict):
    fetched: int
    created: int
    existing: int
    rejected: int
    # leads NOT taken because the workspace's real-data gate is closed (real contact details are refused until the operator opens it); the window is asked for again later
    gated: int
    window_start: AwareDatetime
    window_end: AwareDatetime


@router.post("/connectors/indiamart/pull", response_model=PullOut)
def indiamart_pull(ctx: OwnerOrAdmin, runtime: RuntimeDep) -> PullOut:
    """Pull the leads that arrived since the last pull. IndiaMART allows one call in five minutes (a second one is a 429 here, before IndiaMART is asked); the window starts five minutes before the last
    good pull and the same lead is never made twice."""
    return PullOut.model_validate(_guard(lambda: service.pull_indiamart(runtime, ctx)))


# ------------------------------------------------------------------------------------------------ payment links
class CreateLinkIn(_Strict):
    id: uuid.UUID
    amount_paise: StrictInt
    valid_for_hours: StrictInt = 72


class LinkOut(_Strict):
    id: uuid.UUID
    order_id: uuid.UUID
    provider: str
    reference: str
    amount_paise: int
    status: Literal["pending", "created", "paid", "mismatch", "expired", "cancelled", "failed", "recorded"]
    url: str | None
    expires_at: AwareDatetime
    created_at: AwareDatetime
    paid_amount_paise: int | None
    paid_at: AwareDatetime | None
    recorded_at: AwareDatetime | None


@router.post("/orders/{order_id}/payment-links", response_model=LinkOut)
def create_link(order_id: str, body: CreateLinkIn, ctx: OwnerOrAdmin, runtime: RuntimeDep, response: Response) -> LinkOut:
    """Make a UPI payment link for an amount of this order (at most what it still lacks; one open link per order). Nothing is sent to the customer: use /send."""
    if not 100 <= body.amount_paise <= 1_000_000_000 or not 1 <= body.valid_for_hours <= 720:
        raise ApiError(422, "validation_error", "Invalid input.")
    link = _guard(lambda: service.create_payment_link(runtime, ctx, _uuid(order_id), body.id, body.amount_paise, body.valid_for_hours))
    return LinkOut.model_validate(link)


@router.get("/orders/{order_id}/payment-links", response_model=list[LinkOut])
def list_links(order_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> list[LinkOut]:
    c = service.connectors_for(runtime, ctx.tenant.id, "payments")
    rows = _guard(lambda: c.repo.call(ctx.principal.token, "payment_link_list", tenant_args(ctx.tenant.id, order_id=str(_uuid(order_id)))))
    return [LinkOut.model_validate(r) for r in rows]


class SendLinkIn(_Strict):
    message_id: uuid.UUID
    language: Language = "en"


class SendLinkOut(_Strict):
    message_id: uuid.UUID
    status: str
    replayed: bool


@router.post("/payment-links/{link_id}/send", response_model=SendLinkOut)
def send_link(link_id: str, body: SendLinkIn, ctx: SalesPlus, runtime: RuntimeDep) -> SendLinkOut:
    """Queue the payment request as a WhatsApp message to the customer. It carries an amount, so the outbox policy holds it for a person's approval; a stop, a quiet hour and the daily limit still apply."""
    c = service.connectors_for(runtime, ctx.tenant.id, "payments")
    token, tenant = ctx.principal.token, ctx.tenant.id
    link = _guard(lambda: c.repo.call(token, "payment_link_get", tenant_args(tenant, link_id=str(_uuid(link_id)))))
    if link["status"] != "created" or not link.get("url"):
        raise ApiError(409, "not_in_a_state_for_this", "This cannot be done in its present state.")
    assert runtime.orders is not None and runtime.outbox is not None  # noqa: S101
    order = runtime.orders.get_order(token, tenant, uuid.UUID(str(link["order_id"])))
    if order is None:
        raise not_found()
    text = service.payment_text(body.language, int(link["amount_paise"]), int(order["order_no"]), str(link["url"]))
    result = runtime.outbox.submit(
        token,
        {
            "p_message_id": str(body.message_id),
            "p_tenant_id": str(tenant),
            "p_lead_id": str(order["lead_id"]),
            "p_channel": "whatsapp",
            "p_body": text,
            "p_language": body.language,
            "p_category": "order_status",
            "p_source": "owner",
            "p_model_flagged": False,
            "p_uncertain": False,
            "p_media": [],
            "p_keep_record": True,
            "p_gloss_en": None,
        },
    )
    return SendLinkOut(message_id=body.message_id, status=str(result.get("status", "unknown")), replayed=result.get("replayed") is True)


class RecordedOut(_Strict):
    link: LinkOut
    order_state: str
    paid_total: int | None
    balance_due: int | None


@router.post("/payment-links/{link_id}/record", response_model=RecordedOut)
def record_link(link_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> RecordedOut:
    """Record, on the order, the payment the provider reported for this link (the amount and time are the provider's, checked against the link's own amount). The order lifecycle decides, as for any payment;
    the event and ledger ids are derived from the link, so a retry records nothing twice."""
    c = service.connectors_for(runtime, ctx.tenant.id, "payments")
    token, tenant = ctx.principal.token, ctx.tenant.id
    link = _guard(lambda: c.repo.call(token, "payment_link_get", tenant_args(tenant, link_id=str(_uuid(link_id)))))
    if link["status"] not in ("paid", "recorded") or link.get("paid_amount_paise") is None:
        raise ApiError(409, "not_in_a_state_for_this", "This cannot be done in its present state.")
    assert runtime.orders is not None  # noqa: S101
    lid = uuid.UUID(str(link["id"]))
    event_id = uuid.uuid5(lid, "record_payment-event")
    done = record_order_event(
        runtime.orders,
        token,
        tenant,
        ctx.role,
        uuid.UUID(str(link["order_id"])),
        RecordEventIn(id=event_id, type="record_payment", amount_paise=int(link["paid_amount_paise"]), ledger_id=uuid.uuid5(lid, "record_payment-ledger"), occurred_at=link["paid_at"]),
    )
    marked = _guard(lambda: c.repo.call(token, "payment_link_mark_recorded", tenant_args(tenant, link_id=str(lid), event_id=str(event_id))))
    return RecordedOut(link=LinkOut.model_validate(marked), order_state=str(done.state), paid_total=done.paid_total, balance_due=done.balance_due)


# ------------------------------------------------------------------------------------------------ missed calls and the bridge
class MissedCallOut(_Strict):
    id: uuid.UUID
    received_at: AwareDatetime
    outcome: Literal["replied", "needs_owner"]
    caller_last4: str
    phone: str | None
    contact_id: uuid.UUID | None
    lead_id: uuid.UUID | None
    contact_name: str | None


@router.get("/missed-calls", response_model=list[MissedCallOut])
def missed_calls(ctx: SalesPlus, runtime: RuntimeDep) -> list[MissedCallOut]:
    c = service.connectors_for(runtime, ctx.tenant.id, "calls")
    rows = _guard(lambda: c.repo.call(ctx.principal.token, "missed_call_list", tenant_args(ctx.tenant.id, limit=50)))
    return [MissedCallOut.model_validate({k: v for k, v in r.items() if k != "handled_at"}) for r in rows]


class HandledOut(_Strict):
    id: uuid.UUID
    handled: bool


@router.post("/missed-calls/{call_id}/handle", response_model=HandledOut)
def handle_missed_call(call_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> HandledOut:
    c = service.connectors_for(runtime, ctx.tenant.id, "calls")
    return HandledOut.model_validate(_guard(lambda: c.repo.call(ctx.principal.token, "missed_call_handle", tenant_args(ctx.tenant.id, id=str(_uuid(call_id))))))


class BridgeOut(_Strict):
    bridge_id: uuid.UUID
    status: str
    replayed: bool


@router.post("/call-requests/{request_id}/connect", response_model=BridgeOut)
def connect_call(request_id: str, ctx: OwnerOrAdmin, runtime: RuntimeDep) -> BridgeOut:
    """Place the call of an APPROVED call request: the shop's own phone rings first, and the customer's rings when the shop picks up. Only between 9 am and 9 pm India time, never for a customer who is
    stopped, and never twice for one request."""
    c = service.connectors_for(runtime, ctx.tenant.id, "calls")
    assert c.calls is not None and c.agent_number is not None  # noqa: S101
    token, tenant = ctx.principal.token, ctx.tenant.id
    rid = _uuid(request_id)
    prepared = _guard(lambda: c.repo.call(token, "call_bridge_prepare", tenant_args(tenant, call_request_id=str(rid), provider=c.calls.name if c.calls else "fake")))
    bridge = uuid.UUID(str(prepared["bridge_id"]))
    if prepared.get("replayed"):
        return BridgeOut(bridge_id=bridge, status=str(prepared["status"]), replayed=True)
    number = phones.normalise(prepared.get("to_number"))
    if number is None:  # the number on the contact is not one a telephone network can ring
        _guard(lambda: c.repo.call(token, "call_bridge_finish", tenant_args(tenant, bridge_id=str(bridge), provider_call_id=None, status="failed")))
        raise ApiError(422, "customer_phone_unusable", "The phone number on this contact cannot be called. Correct it first.")
    callback = f"{c.public_base_url}/v1/webhooks/exotel/{c.webhook_token}/call-status" if c.public_base_url and c.webhook_token else None
    try:
        sid, status = c.calls.connect(c.agent_number, number, str(bridge), callback)
    except ProviderError:
        _guard(lambda: c.repo.call(token, "call_bridge_finish", tenant_args(tenant, bridge_id=str(bridge), provider_call_id=None, status="failed")))
        raise ApiError(502, "call_provider_failed", "The call could not be placed.") from None
    done = _guard(lambda: c.repo.call(token, "call_bridge_finish", tenant_args(tenant, bridge_id=str(bridge), provider_call_id=sid, status=status)))
    return BridgeOut(bridge_id=bridge, status=str(done["status"]), replayed=False)


__all__ = ["router"]
