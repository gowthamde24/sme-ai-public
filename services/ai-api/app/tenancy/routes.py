from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query

from app.auth.deps import AnyMember, OwnerOrAdmin, PrincipalDep, RuntimeDep
from app.tenancy.models import (
    AuditEventListOut,
    CreateTenantIn,
    MemberListOut,
    MeOut,
    Role,
    TenantDetailOut,
    TenantWithPlanOut,
)

router = APIRouter(prefix="/v1", tags=["tenancy"])


@router.get("/me", response_model=MeOut)
def get_me(principal: PrincipalDep, runtime: RuntimeDep) -> MeOut:
    return runtime.repository.get_me(principal.token, principal.user_id)


@router.post("/tenants", response_model=TenantDetailOut)
def create_tenant(
    body: CreateTenantIn, principal: PrincipalDep, runtime: RuntimeDep
) -> TenantDetailOut:
    """Create a tenant and become its Owner. Idempotent: the Owner retrying the same slug gets the
    same tenant back (HTTP 200), with no duplicate tenant, membership or audit event."""
    tenant = runtime.repository.create_tenant(principal.token, body.name, body.slug)
    return TenantDetailOut(id=tenant.id, name=tenant.name, slug=tenant.slug, role=Role.OWNER)


@router.get("/tenants/{tenant_id}", response_model=TenantWithPlanOut)
def get_tenant(ctx: AnyMember, runtime: RuntimeDep) -> TenantWithPlanOut:
    plan = runtime.repository.get_plan(ctx.principal.token, ctx.tenant.id)
    return TenantWithPlanOut(
        id=ctx.tenant.id,
        name=ctx.tenant.name,
        slug=ctx.tenant.slug,
        role=ctx.role,
        plan=plan.plan,
        workspace_limit=plan.workspace_limit,
        trial_started_at=plan.trial_started_at,
    )


@router.get("/tenants/{tenant_id}/members", response_model=MemberListOut)
def list_members(ctx: AnyMember, runtime: RuntimeDep) -> MemberListOut:
    return runtime.repository.list_members(ctx.principal.token, ctx.tenant.id)


@router.get("/tenants/{tenant_id}/audit-events", response_model=AuditEventListOut)
def list_audit_events(
    ctx: OwnerOrAdmin,
    runtime: RuntimeDep,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    before_id: Annotated[int | None, Query(ge=1)] = None,
) -> AuditEventListOut:
    return runtime.repository.list_audit_events(
        ctx.principal.token, ctx.tenant.id, limit=limit, before_id=before_id
    )
