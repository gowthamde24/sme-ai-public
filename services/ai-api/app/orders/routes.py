"""Order endpoints under /v1/tenants/{tenant_id}/... (ADR 0021; order conversion commit 5).

Authorization, in order, for every endpoint (as for the quote routes): a valid JWT (401); membership of the tenant in the PATH (404); a role that may perform the action (403: a Viewer
reads no amount, so no order); a second factor where the action needs one (403 mfa_required: creating an order and a policy; payments, cancellations and refunds are checked by the
database); the order / quote must exist FOR THIS CALLER (404 otherwise); then the database decides again (RLS, the definer functions).

There is NO endpoint that sends anything and none that takes a total, a state, an approver or an `owner_override` from a body: the figures are the approved quote's, copied by the
database; the state is the ledger's; the approver and the override are derived from the role the token proved. An event carries only the person's inputs.

NOTE: no `from __future__ import annotations` here, for the same reason as app/quotes/routes.py (request models are attached to the endpoint signatures at registration time)."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import CursorError, Page, decode_cursor, encode_cursor, parse_uuid
from app.errors import ApiError, not_found
from app.orders import service
from app.orders.models import (
    CreateOrderIn,
    CreatePolicyIn,
    EventResultOut,
    OrderDetailOut,
    OrderOut,
    PolicyOut,
    RecordEventIn,
)
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}")

SALES_PLUS: tuple[Role, ...] = (Role.OWNER, Role.ADMIN, Role.SALES)
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
SalesPlus = Annotated[TenantContext, Depends(require_tenant_role(*SALES_PLUS))]
OwnerAdminStrong = Annotated[
    TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, strong=True))
]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]


def _repo(runtime: Runtime) -> Any:
    if runtime.orders is None:
        raise ApiError(503, "orders_unavailable", "Orders are not available right now.")
    return runtime.orders


def _row_id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _order(runtime: Runtime, ctx: TenantContext, raw_id: str) -> OrderDetailOut:
    found = service.order_detail(
        _repo(runtime), ctx.principal.token, ctx.tenant.id, _row_id(raw_id)
    )
    if found is None:
        raise not_found()
    return service.with_guidance(
        _repo(runtime), ctx.principal.token, ctx.tenant.id, ctx.role, found
    )


# ----------------------------------------------------------------------------- reading
@router.get("/orders", response_model=Page[OrderOut])
def list_orders(
    ctx: SalesPlus,
    runtime: RuntimeDep,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(max_length=300)] = None,
) -> Page[OrderOut]:
    decoded = None
    if cursor is not None:
        try:
            decoded = decode_cursor(cursor)
        except CursorError:
            raise ApiError(422, "validation_error", "Invalid input: cursor.") from None
    rows = _repo(runtime).list_orders(
        ctx.principal.token, ctx.tenant.id, limit=limit, cursor=decoded
    )
    items = [service.order_out(r) for r in rows[:limit]]
    next_cursor = None
    if len(rows) > limit:
        last = items[-1]
        next_cursor = encode_cursor(last.created_at, last.id)
    return Page[OrderOut](items=items, next_cursor=next_cursor)


@router.get("/orders/{order_id}", response_model=OrderDetailOut)
def get_order(order_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> OrderDetailOut:
    return _order(runtime, ctx, order_id)


# ----------------------------------------------------------------------------- writes
@router.post("/orders", response_model=OrderDetailOut, status_code=201)
def create_order(
    body: CreateOrderIn, ctx: OwnerAdminStrong, runtime: RuntimeDep, response: Response
) -> OrderDetailOut:
    """Start tracking an APPROVED quote as an order (Owner or Admin with a second factor). The figures are the quote's, copied by the database. Nothing is sent."""
    done = _repo(runtime).create_order(ctx.principal.token, body.id, body.quote_id)
    response.status_code = 200 if done.get("replayed") else 201
    return _order(runtime, ctx, str(done["order_id"]))


@router.post("/orders/{order_id}/events", response_model=EventResultOut)
def record_event(
    order_id: str, body: RecordEventIn, ctx: SalesPlus, runtime: RuntimeDep
) -> EventResultOut:
    """A person records ONE event ("I sent the quote", "the customer accepted", "we received Rs 40,000"). The API builds the lifecycle request from the order's recorded state, runs the
    pinned lifecycle and hands the database the result; the database rebuilds and decides. Who may record which event, and which need a second factor, is the database's rule."""
    oid = _row_id(order_id)
    repo = _repo(runtime)
    if repo.get_order(ctx.principal.token, ctx.tenant.id, oid) is None:
        raise not_found()
    return service.record_event(repo, ctx.principal.token, ctx.tenant.id, ctx.role, oid, body)


@router.post("/order-policy-versions", response_model=PolicyOut, status_code=201)
def create_policy(
    body: CreatePolicyIn, ctx: OwnerStrong, runtime: RuntimeDep, response: Response
) -> PolicyOut:
    """The Owner (with a second factor) publishes an order policy version: advance required, dispatch needs the advance, the cancel window, zero-value orders."""
    done = _repo(runtime).create_policy(
        ctx.principal.token,
        {
            "p_version_id": str(body.id),
            "p_tenant_id": str(ctx.tenant.id),
            "p_effective_from": body.effective_from.isoformat(),
            "p_policy": {
                "advance_required": body.advance_required,
                "dispatch_requires_advance": body.dispatch_requires_advance,
                "cancel_allowed_until_state": body.cancel_allowed_until_state,
                "allow_zero_value_orders": body.allow_zero_value_orders,
            },
        },
    )
    response.status_code = 200 if done.get("replayed") else 201
    return PolicyOut.model_validate(
        {k: done[k] for k in ("version_id", "version_no", "effective_from", "replayed")}
    )
