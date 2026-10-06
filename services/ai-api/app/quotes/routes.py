"""Quote endpoints under /v1/tenants/{tenant_id}/... (T009).

Authorization, in order, for every endpoint (as for the CRM and enquiry routes): a valid JWT (401); membership of the tenant in the PATH (404); a role that may perform
the action (403: a Viewer reads no price, no pick and no quote); an Owner or Admin approving or withdrawing also needs a second factor (403 mfa_required); the enquiry /
quote must exist FOR THIS CALLER (404 otherwise: unknown, malformed and foreign ids look the same); then the database decides again (RLS, the definer functions).

There is NO endpoint that sends anything and none that takes a price, a total, a tax figure, a tenant or an approver from a body. The figures are the engine's,
verified by the database; an approval is the database's, after its own rebuild; the customer text is rendered from the stored approved row.

NOTE: no `from __future__ import annotations` here, for the same reason as app/crm/routes.py (request models are attached to the endpoint signatures at registration time)."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.enquiries.models import EnquiryOut
from app.errors import ApiError, not_found
from app.quotes import service
from app.quotes.builder import today_ist
from app.quotes.errors import QuoteNotDraftError
from app.quotes.models import (
    ApproveOut,
    CreateQuoteIn,
    DecisionOut,
    PickIn,
    PickOut,
    QuoteOut,
    QuoteSetupOut,
    QuoteSummaryOut,
    QuoteTextOut,
    RejectIn,
    WithdrawIn,
)
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}")

SALES_PLUS: tuple[Role, ...] = (Role.OWNER, Role.ADMIN, Role.SALES)
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
SalesPlus = Annotated[TenantContext, Depends(require_tenant_role(*SALES_PLUS))]
OwnerAdminStrong = Annotated[
    TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, strong=True))
]


def _unavailable() -> ApiError:
    return ApiError(503, "quotes_unavailable", "Quotes are not available right now.")


def _repos(runtime: Runtime) -> tuple[Any, Any]:
    if runtime.quotes is None or runtime.enquiries is None:
        raise _unavailable()
    return runtime.quotes, runtime.enquiries


def _row_id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _enquiry(runtime: Runtime, ctx: TenantContext, raw_id: str) -> EnquiryOut:
    enquiry = (
        runtime.enquiries.get(ctx.principal.token, ctx.tenant.id, _row_id(raw_id))
        if runtime.enquiries
        else None
    )
    if enquiry is None:
        raise not_found()
    result: EnquiryOut = enquiry
    return result


def _quote(runtime: Runtime, ctx: TenantContext, raw_id: str) -> QuoteOut:
    quotes, enquiries = _repos(runtime)
    quote = service.load_quote(
        quotes, enquiries, ctx.principal.token, ctx.tenant.id, _row_id(raw_id)
    )
    if quote is None:
        raise not_found()
    return quote


# ----------------------------------------------------------------------------- reading
@router.get("/enquiries/{enquiry_id}/quote-setup", response_model=QuoteSetupOut)
def quote_setup(enquiry_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> QuoteSetupOut:
    """The confirmed requirement's lines with the mapper's suggestions and the picks made so far, and what is missing."""
    quotes, enquiries = _repos(runtime)
    enquiry = _enquiry(runtime, ctx, enquiry_id)
    return service.setup(quotes, enquiries, ctx.principal.token, ctx.tenant.id, enquiry)


@router.get("/enquiries/{enquiry_id}/quotes", response_model=list[QuoteSummaryOut])
def list_enquiry_quotes(
    enquiry_id: str,
    ctx: SalesPlus,
    runtime: RuntimeDep,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
) -> list[QuoteSummaryOut]:
    quotes, _ = _repos(runtime)
    enquiry = _enquiry(runtime, ctx, enquiry_id)
    rows = quotes.list_quotes(
        ctx.principal.token, ctx.tenant.id, enquiry_id=enquiry.id, limit=limit
    )
    return [service.summary_out(r) for r in rows]


@router.get("/quotes", response_model=list[QuoteSummaryOut])
def list_quotes(
    ctx: SalesPlus, runtime: RuntimeDep, limit: Annotated[int, Query(ge=1, le=50)] = 20
) -> list[QuoteSummaryOut]:
    quotes, _ = _repos(runtime)
    rows = quotes.list_quotes(ctx.principal.token, ctx.tenant.id, enquiry_id=None, limit=limit)
    return [service.summary_out(r) for r in rows]


@router.get("/quotes/{quote_id}", response_model=QuoteOut)
def get_quote(quote_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> QuoteOut:
    return _quote(runtime, ctx, quote_id)


@router.get("/quotes/{quote_id}/text", response_model=QuoteTextOut)
def get_quote_text(quote_id: str, ctx: SalesPlus, runtime: RuntimeDep) -> QuoteTextOut:
    """The plain customer-facing text of an APPROVED quote, to copy. 409 for any other quote. The system sends nothing."""
    quotes, _ = _repos(runtime)
    quote = _quote(runtime, ctx, quote_id)
    rendered = service.render_text(
        quotes, ctx.principal.token, ctx.tenant.id, ctx.tenant.name, quote
    )
    return QuoteTextOut.model_validate(rendered)


# ----------------------------------------------------------------------------- the person's choices
@router.post("/enquiries/{enquiry_id}/picks", response_model=PickOut)
def pick_product(enquiry_id: str, body: PickIn, ctx: SalesPlus, runtime: RuntimeDep) -> PickOut:
    """A person says which catalog product a requirement line means (replacing an earlier pick)."""
    quotes, enquiries = _repos(runtime)
    token, tenant = ctx.principal.token, ctx.tenant.id
    enquiry = _enquiry(runtime, ctx, enquiry_id)
    requirement, rows = service.requirement_of(enquiries, token, tenant, enquiry)
    args: dict[str, Any] = {
        "p_requirement_id": str(requirement["id"]),
        "p_line": body.line,
        "p_product_id": str(body.product_id),
        "p_qty": body.qty,
        "p_sale_unit": body.sale_unit,
        "p_source": "manual",
        "p_suggestion_sha256": None,
    }
    if body.from_suggestion:
        args["p_source"] = "mapper_suggestion"
        args["p_suggestion_sha256"] = service.pick_source(
            quotes, token, tenant, rows, body.line, body.product_id, today_ist()
        )
    done = quotes.pick(token, args)
    return PickOut(
        pick_id=done["pick_id"],
        line=done["line"],
        product_id=done["product_id"],
        qty=done["qty"],
        sale_unit=done["sale_unit"],
        source=args["p_source"],
        replayed=bool(done.get("replayed")),
    )


@router.post("/enquiries/{enquiry_id}/quotes", response_model=QuoteOut, status_code=201)
def create_quote(
    enquiry_id: str, body: CreateQuoteIn, ctx: SalesPlus, runtime: RuntimeDep, response: Response
) -> QuoteOut:
    """Make a DRAFT quote from the confirmed requirement and the picks. Nothing is sent and nothing is approved."""
    quotes, enquiries = _repos(runtime)
    token, tenant = ctx.principal.token, ctx.tenant.id
    enquiry = _enquiry(runtime, ctx, enquiry_id)
    quote_id, replayed = service.create_draft(
        quotes, enquiries, token, tenant, enquiry, body.id, body.customer_kind, body.delivery_state
    )
    response.status_code = 200 if replayed else 201
    return _quote(runtime, ctx, str(quote_id))


# ----------------------------------------------------------------------------- the decisions
@router.post("/quotes/{quote_id}/approve", response_model=ApproveOut)
def approve_quote(quote_id: str, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> ApproveOut:
    """Approve a draft (Owner or Admin with a second factor; a flagged quote only the Owner). The approver's recomputation is made here from the quote's recorded sources;
    the database compares it and rebuilds everything itself. Then the customer text is rendered from the STORED approved row. Nothing is sent."""
    quotes, enquiries = _repos(runtime)
    token, tenant = ctx.principal.token, ctx.tenant.id
    quote = _quote(runtime, ctx, quote_id)
    digest = service.recomputed_hash(quotes, enquiries, token, tenant, quote)
    done = quotes.approve(token, quote.id, digest)
    out = ApproveOut(
        quote_id=quote.id,
        status="approved",
        replayed=bool(done.get("replayed")),
        approved_by=done.get("approved_by"),
    )
    try:
        approved = _quote(runtime, ctx, quote_id)
        out.text = QuoteTextOut.model_validate(
            service.render_text(quotes, token, tenant, ctx.tenant.name, approved)
        )
    except ApiError as exc:  # the approval stands; the text can be asked for again
        out.text_error = exc.code
    return out


@router.post("/quotes/{quote_id}/reject", response_model=DecisionOut)
def reject_quote(quote_id: str, body: RejectIn, ctx: SalesPlus, runtime: RuntimeDep) -> DecisionOut:
    """Reject a draft. Owner and Admin reject any draft; Sales may only withdraw their own (the database decides)."""
    quotes, _ = _repos(runtime)
    quote = _quote(runtime, ctx, quote_id)
    done = quotes.reject(ctx.principal.token, quote.id, body.code)
    return DecisionOut(quote_id=quote.id, status="rejected", replayed=bool(done.get("replayed")))


@router.post("/quotes/{quote_id}/withdraw", response_model=DecisionOut)
def withdraw_quote(
    quote_id: str, body: WithdrawIn, ctx: OwnerAdminStrong, runtime: RuntimeDep
) -> DecisionOut:
    """Withdraw an APPROVED quote (Owner or Admin with a second factor): it is kept, marked withdrawn, and can never be approved again."""
    quotes, _ = _repos(runtime)
    quote = _quote(runtime, ctx, quote_id)
    try:
        done = quotes.withdraw(ctx.principal.token, quote.id, body.code)
    except QuoteNotDraftError:
        raise ApiError(
            409, "quote_not_approved", "Only an approved quote can be withdrawn."
        ) from None
    return DecisionOut(quote_id=quote.id, status="superseded", replayed=bool(done.get("replayed")))
