"""Quote endpoints under /v1/tenants/{tenant_id}/... (T009).

Authorization, in order, for every endpoint (as for the CRM and enquiry routes): a valid JWT (401); membership of the tenant in the PATH (404); a role that may perform
the action (403: a Viewer reads no price, no pick and no quote); an Owner or Admin approving or withdrawing also needs a second factor (403 mfa_required); the enquiry /
quote must exist FOR THIS CALLER (404 otherwise: unknown, malformed and foreign ids look the same); then the database decides again (RLS, the definer functions).

There is NO endpoint that sends anything and none that takes a price, a total, a tax figure, a tenant or an approver from a body. The figures are the engine's,
verified by the database; an approval is the database's, after its own rebuild; the customer text is rendered from the stored approved row.

NOTE: no `from __future__ import annotations` here, for the same reason as app/crm/routes.py (request models are attached to the endpoint signatures at registration time)."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Path, Query, Response

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.enquiries.models import EnquiryOut
from app.errors import ApiError, not_found
from app.quotes import service
from app.quotes.builder import today_ist
from app.quotes.errors import QuoteNotDraftError
from app.quotes.models import (
    ApproveOut,
    CreateManualQuoteIn,
    CreateQuoteIn,
    CreateQuotePolicyIn,
    DecisionOut,
    ItemTypeOut,
    ItemTypeSavedOut,
    PickIn,
    PickOut,
    QuoteOut,
    QuotePolicyResultOut,
    QuotePolicyVersionOut,
    QuoteSetupOut,
    QuoteSummaryOut,
    QuoteTextOut,
    RejectIn,
    SaveItemTypeIn,
    WithdrawIn,
)
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}")

SALES_PLUS: tuple[Role, ...] = (Role.OWNER, Role.ADMIN, Role.SALES)
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
SalesPlus = Annotated[TenantContext, Depends(require_tenant_role(*SALES_PLUS))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
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


@router.post("/enquiries/{enquiry_id}/manual-quotes", response_model=QuoteOut, status_code=201)
def create_manual_quote(
    enquiry_id: str,
    body: CreateManualQuoteIn,
    ctx: OwnerAdmin,
    runtime: RuntimeDep,
    response: Response,
) -> QuoteOut:
    """Make a DRAFT quote from typed prices (Owner or Admin). The prices are the person's own: this route sets none, defaults none and suggests none. It builds the engine
    request exactly as the database does, runs the pinned engine, and hands request, result and the typed lines to `public.create_manual_quote_draft` with the caller's own
    token; the database recomputes everything and decides. Nothing is sent and nothing is approved."""
    quotes, _ = _repos(runtime)
    token, tenant = ctx.principal.token, ctx.tenant.id
    enquiry = _enquiry(runtime, ctx, enquiry_id)
    quote_id, replayed = service.create_manual_draft(
        quotes,
        token,
        tenant,
        enquiry,
        body.id,
        body.customer_kind,
        body.delivery_state,
        body.lines,
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


# ----------------------------------------------------------------------------- the quote policy
@router.get("/quote-policy-versions", response_model=list[QuotePolicyVersionOut])
def list_quote_policies(ctx: OwnerAdmin, runtime: RuntimeDep) -> list[QuotePolicyVersionOut]:
    """Every published quote policy version, newest first, with the one in force today marked (Owner or Admin)."""
    if runtime.quotes is None:
        raise _unavailable()
    token, tenant = ctx.principal.token, ctx.tenant.id
    rows = runtime.quotes.list_policies(token, tenant, limit=50)
    active = runtime.quotes.active_policy(token, tenant, today_ist())
    in_force = str(active["id"]) if active is not None else None
    return [
        QuotePolicyVersionOut.model_validate(
            {
                **{k: r[k] for k in QuotePolicyVersionOut.model_fields if k != "in_force"},
                "in_force": str(r["id"]) == in_force,
            }
        )
        for r in rows
    ]


@router.post("/quote-policy-versions", response_model=QuotePolicyResultOut, status_code=201)
def create_quote_policy(
    body: CreateQuotePolicyIn, ctx: OwnerAdminStrong, runtime: RuntimeDep, response: Response
) -> QuotePolicyResultOut:
    """An Owner or Admin (with a second factor) publishes a quote policy version. A thin pass-through: the caller's own token, the fields as typed (none added, none defaulted), then
    `public.create_quote_policy_version` decides again (role, second factor, bounds, the effective date, a replay)."""
    if runtime.quotes is None:
        raise _unavailable()
    done = runtime.quotes.create_policy(
        ctx.principal.token,
        {
            "p_version_id": str(body.id),
            "p_tenant_id": str(ctx.tenant.id),
            "p_effective_from": body.effective_from.isoformat(),
            "p_policy": body.model_dump(
                mode="json", exclude={"id", "effective_from"}, exclude_none=True
            ),
        },
    )
    response.status_code = 200 if done.get("replayed") else 201
    return QuotePolicyResultOut.model_validate(
        {k: done[k] for k in ("version_id", "version_no", "effective_from", "replayed")}
    )


# ----------------------------------------------------------------------------- item types (the workspace's own list; an optional price range per type)
@router.get("/item-types", response_model=list[ItemTypeOut])
def list_item_types(ctx: SalesPlus, runtime: RuntimeDep) -> list[ItemTypeOut]:
    """The workspace's item types in display order, with their optional price range. Owner, Admin and Sales read it (a Viewer reads no price)."""
    if runtime.quotes is None:
        raise _unavailable()
    rows = runtime.quotes.list_item_types(ctx.principal.token, ctx.tenant.id)
    return [ItemTypeOut.model_validate({k: r[k] for k in ItemTypeOut.model_fields}) for r in rows]


@router.put("/item-types/{code}", response_model=ItemTypeSavedOut)
def save_item_type(
    code: Annotated[str, Path(pattern=r"^[0-9A-Za-z][0-9A-Za-z_-]{0,19}$")],
    body: SaveItemTypeIn,
    ctx: OwnerAdminStrong,
    runtime: RuntimeDep,
) -> ItemTypeSavedOut:
    """An Owner or Admin (with a second factor) creates or replaces one item type. A thin pass-through: the caller's own token, the tenant of the PATH, the fields as typed (a price bound left
    out is sent as null, meaning no bound), then `public.save_item_type` decides again (role, second factor, bounds, clean name). No price is set or suggested here."""
    if runtime.quotes is None:
        raise _unavailable()
    done = runtime.quotes.save_item_type(
        ctx.principal.token,
        {
            "p_tenant_id": str(ctx.tenant.id),
            "p_code": code,
            "p_name": body.name,
            "p_position": body.position,
            "p_active": body.active,
            "p_min_price_paise": body.min_price_paise,
            "p_max_price_paise": body.max_price_paise,
        },
    )
    return ItemTypeSavedOut.model_validate({k: done[k] for k in ("id", "code", "created")})
