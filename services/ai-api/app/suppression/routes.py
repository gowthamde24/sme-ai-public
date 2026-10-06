"""Suppression endpoints under /v1/tenants/{tenant_id}/suppression (T010, ADR 0020).

Authorization, in order: a valid JWT (401); membership of the tenant in the PATH (404); a role that may perform the action (403); for the backfill a second factor (403 mfa_required, after
the role); then the database decides again. Nothing here takes a tenant, a contact, a key or an identifier from a body: the keys are computed on the server from what the caller
may already read, and no response carries a key, an identifier or an HMAC (only counts).

NOTE: no `from __future__ import annotations` here, for the same reason as app/crm/routes.py."""

from typing import Annotated

from fastapi import APIRouter, Depends

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError
from app.suppression import service
from app.suppression.models import BackfillOut, SuppressionStatusOut
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}")

RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AdminPlus = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]


def _unavailable() -> ApiError:
    return ApiError(503, "suppression_unavailable", "Suppression keys are not available right now.")


@router.get("/suppression/status", response_model=SuppressionStatusOut)
def suppression_status(ctx: AdminPlus, runtime: RuntimeDep) -> SuppressionStatusOut:
    """Is the key configured, and how many contacts still hold an identifier with no key (they cannot receive a follow-up draft until the Owner runs the backfill)."""
    if runtime.suppression is None:
        raise _unavailable()
    count = runtime.suppression.unkeyed_count(ctx.principal.token, ctx.tenant.id)
    ring = runtime.key_ring
    return SuppressionStatusOut(
        key_configured=ring is not None,
        key_version=ring.current.version if ring is not None else None,
        unkeyed_contacts=count,
    )


@router.post("/suppression/backfill", response_model=BackfillOut)
def backfill_keys(ctx: OwnerStrong, runtime: RuntimeDep) -> BackfillOut:
    """Key the existing contacts that have no key (Owner, second factor; idempotent; batched: call again while `remaining` is above zero)."""
    if runtime.suppression is None or runtime.key_ring is None:
        raise ApiError(503, "suppression_key_not_configured", "The suppression key is not configured, so contacts cannot be keyed.")
    done = service.backfill(runtime.suppression, runtime.key_ring, ctx.principal.token, ctx.tenant.id)
    return BackfillOut(**done)
