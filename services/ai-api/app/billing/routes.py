"""Plans and billing (job DI, ADR 0092). The contract is packages/contracts/billing.* and docs/contracts/plans-billing.md.

  GET  /v1/plans                                  the plans catalogue (any signed-in user). Prices are null until the owner of the product sets them.
  GET  /v1/tenants/{tenant_id}/billing            the plan in force, the subscription, the period, both meters, the notices (Owner, Admin)
  GET  /v1/tenants/{tenant_id}/billing/access     whether the workspace is full or READ-ONLY (the trial ended unpaid), with the dates (any member)
  GET  /v1/tenants/{tenant_id}/billing/usage      the period, the meters and the notices only (Owner, Admin)
  POST /v1/tenants/{tenant_id}/billing/trial      start the 30-day trial with a payment method on file; nothing is charged (Owner, second factor)
  POST /v1/tenants/{tenant_id}/billing/resume     pay again after the trial ended unpaid or the plan was cancelled: a paid plan starts at once, no new trial (Owner, second factor)
  POST /v1/tenants/{tenant_id}/billing/cancel     cancel: during the trial no charge ever; an active plan ends at the end of the paid period (Owner, second factor)

Running out before the month ends (night 4, job DS part E2, docs/contracts/topups.md):
  GET  /v1/tenants/{tenant_id}/billing/topups            packs (data), the unused balance by lot, the settings, the last purchases (Owner, Admin)
  POST /v1/tenants/{tenant_id}/billing/topups            buy a pack with a (fake) payment; the purchase id makes a retry harmless (Owner, second factor)
  PUT  /v1/tenants/{tenant_id}/billing/topups/settings   automatic top-up and overage, both OFF by default, each with a monthly cap (Owner, second factor)
  GET  /v1/tenants/{tenant_id}/billing/invoices[/{id}]   fake invoices with GST (Owner, Admin)
  GET  /v1/tenants/{tenant_id}/billing/upgrade-preview   the pro-rata of a mid-month upgrade (Owner, Admin)
  POST /v1/tenants/{tenant_id}/billing/upgrade           upgrade now: the new allowance applies at once (Owner, second factor)

A meter shows counts and percentages only: never the AI's rupees or tokens (AI is included under fair use).

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import (
    AnyMember,
    PrincipalDep,
    Runtime,
    TenantContext,
    get_runtime,
    require_tenant_role,
)
from app.billing.models import (
    AccessOut,
    BillingOut,
    InvoiceOut,
    InvoicesOut,
    PlansOut,
    ResumeIn,
    TopupBuyIn,
    TopupBuyOut,
    TopupSettingsIn,
    TopupSettingsOut,
    TopupsOut,
    TrialStartIn,
    UpgradeIn,
    UpgradeOut,
    UpgradePreviewOut,
    UsageViewOut,
)
from app.billing.service import BillingService
from app.errors import ApiError
from app.outbox.service import decode_cursor, encode_cursor
from app.tenancy.models import Role

plans_router = APIRouter(prefix="/v1/plans", tags=["billing"])
router = APIRouter(prefix="/v1/tenants/{tenant_id}/billing", tags=["billing"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]


def _service(runtime: Runtime) -> BillingService:
    if runtime.billing is None:
        raise ApiError(503, "billing_unavailable", "Plans and billing are not available right now.")
    return runtime.billing


@plans_router.get("", response_model=PlansOut)
def list_plans(principal: PrincipalDep, runtime: RuntimeDep) -> PlansOut:
    return PlansOut.model_validate(_service(runtime).plans(principal.token))


@router.get("", response_model=BillingOut)
def get_billing(ctx: OwnerAdmin, runtime: RuntimeDep) -> BillingOut:
    return BillingOut.model_validate(_service(runtime).billing(ctx.principal.token, ctx.tenant.id))


@router.get("/access", response_model=AccessOut)
def get_access(ctx: AnyMember, runtime: RuntimeDep) -> AccessOut:
    access = _service(runtime).access(ctx.principal.token, ctx.tenant.id)
    if runtime.dpdp is not None:
        status = runtime.dpdp.repository.lapse_status(ctx.principal.token, ctx.tenant.id)
        access = {
            **access,
            "erasure_warning_sent_at": status.get("erasure_warning_sent_at") if access.get("access") == "read_only" else None,
            "demo": bool(status.get("demo")),
            "exempt": bool(status.get("exempt")),
        }
    return AccessOut.model_validate(access)


@router.get("/usage", response_model=UsageViewOut)
def get_usage(ctx: OwnerAdmin, runtime: RuntimeDep) -> UsageViewOut:
    return UsageViewOut.model_validate(_service(runtime).usage(ctx.principal.token, ctx.tenant.id))


@router.post("/trial", response_model=BillingOut)
def start_trial(body: TrialStartIn, ctx: OwnerStrong, runtime: RuntimeDep) -> BillingOut:
    return BillingOut.model_validate(_service(runtime).start_trial(ctx.principal.token, ctx.tenant.id, body.plan_id, body.checkout_ref))


@router.post("/resume", response_model=BillingOut)
def resume(body: ResumeIn, ctx: OwnerStrong, runtime: RuntimeDep) -> BillingOut:
    return BillingOut.model_validate(_service(runtime).resume(ctx.principal.token, ctx.tenant.id, body.plan_id, body.checkout_ref))


@router.post("/cancel", response_model=BillingOut)
def cancel(ctx: OwnerStrong, runtime: RuntimeDep) -> BillingOut:
    return BillingOut.model_validate(_service(runtime).cancel(ctx.principal.token, ctx.tenant.id))


# ------------------------------------------------------------------------------------------------------------------ night 4, job DS part E2
@router.get("/topups", response_model=TopupsOut)
def get_topups(ctx: OwnerAdmin, runtime: RuntimeDep) -> TopupsOut:
    return TopupsOut.model_validate(_service(runtime).topups(ctx.principal.token, ctx.tenant.id))


@router.post("/topups", response_model=TopupBuyOut, status_code=201)
def buy_topup(body: TopupBuyIn, ctx: OwnerStrong, runtime: RuntimeDep, response: Response) -> TopupBuyOut:
    answer = dict(_service(runtime).buy_topup(ctx.principal.token, ctx.tenant.id, body.purchase_id, body.pack_code, body.checkout_ref))
    if not answer.pop("created", True):
        response.status_code = 200   # the same purchase id with the same pack: the same answer, nothing charged twice
    return TopupBuyOut.model_validate(answer)


@router.put("/topups/settings", response_model=TopupSettingsOut)
def put_topup_settings(body: TopupSettingsIn, ctx: OwnerStrong, runtime: RuntimeDep) -> TopupSettingsOut:
    return TopupSettingsOut.model_validate(_service(runtime).topup_settings(ctx.principal.token, ctx.tenant.id, body.model_dump()))


@router.get("/invoices", response_model=InvoicesOut)
def list_invoices(ctx: OwnerAdmin, runtime: RuntimeDep, cursor: Annotated[str | None, Query(max_length=200)] = None) -> InvoicesOut:
    after = decode_cursor(cursor)
    limit = 50
    rows = _service(runtime).invoices(ctx.principal.token, ctx.tenant.id, limit, datetime.fromisoformat(after[0].replace("Z", "+00:00")) if after else None, after[1] if after else None)
    items = [InvoiceOut.model_validate(r) for r in rows]
    return InvoicesOut(items=items, next_cursor=encode_cursor(str(rows[-1]["issued_at"]), items[-1].id) if len(rows) == limit else None)


@router.get("/invoices/{invoice_id}", response_model=InvoiceOut)
def get_invoice(invoice_id: uuid.UUID, ctx: OwnerAdmin, runtime: RuntimeDep) -> InvoiceOut:
    return InvoiceOut.model_validate(_service(runtime).invoice(ctx.principal.token, ctx.tenant.id, invoice_id))


@router.get("/upgrade-preview", response_model=UpgradePreviewOut)
def upgrade_preview(plan_id: Annotated[str, Query(pattern=r"^[a-z][a-z0-9_]{1,30}$")], ctx: OwnerAdmin, runtime: RuntimeDep) -> UpgradePreviewOut:
    return UpgradePreviewOut.model_validate(_service(runtime).upgrade_preview(ctx.principal.token, ctx.tenant.id, plan_id))


@router.post("/upgrade", response_model=UpgradeOut)
def upgrade(body: UpgradeIn, ctx: OwnerStrong, runtime: RuntimeDep) -> UpgradeOut:
    return UpgradeOut.model_validate(_service(runtime).upgrade(ctx.principal.token, ctx.tenant.id, body.plan_id, body.checkout_ref))
