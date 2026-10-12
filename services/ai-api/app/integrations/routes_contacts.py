"""GET /v1/tenants/{tenant_id}/contacts/by-phone?phone=... (job BO): who holds this number? For the duplicate warning of a manual entry, the outbox and the chat. Owner, Admin, Sales.

The number may be written any way (`98765 43210`, `+91 98765 43210`, `098765-43210`, digits in Telugu or Hindi): it is compared in its normalised form. Answer: `{found: false}` or `{found: true, contact_id,
full_name, company_id, company_name, lead_ids}`. 422 for something that is not a phone number."""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/contacts", tags=["contacts"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
SalesPlus = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]


@router.get("/by-phone")
def contact_by_phone(ctx: SalesPlus, runtime: RuntimeDep, phone: Annotated[str, Query(min_length=3, max_length=40)]) -> dict[str, Any]:
    if runtime.integrations is None:
        raise ApiError(503, "integrations_unavailable", "This is not available on this system.")
    return runtime.integrations.contact_by_phone(ctx.principal.token, ctx.tenant.id, phone)
