"""FastAPI dependencies: who is calling (Principal) and may they act on this tenant."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, Request

from app.agent_runs.wiring import AgentsRuntime
from app.auth.jwt import AuthError, Principal, TokenVerifier
from app.crm.repository import CrmRepository
from app.erasure.repository import ErasureRepository
from app.errors import ApiError, forbidden, mfa_required, not_found, unauthorized
from app.evidence.repository import EvidenceRepository
from app.leads.repository import LeadsRepository
from app.tenancy.models import Role, TenantOut
from app.tenancy.repository import TenantRepository

logger = logging.getLogger("app.auth")


@dataclass(frozen=True)
class Runtime:
    """Wired-up collaborators. Absent when auth is not configured (development only)."""

    verifier: TokenVerifier
    repository: TenantRepository
    crm: CrmRepository
    evidence: EvidenceRepository
    leads: LeadsRepository
    agents: AgentsRuntime | None = None
    erasure: ErasureRepository | None = None


@dataclass(frozen=True)
class TenantContext:
    principal: Principal
    tenant: TenantOut
    role: Role


def get_runtime(request: Request) -> Runtime:
    runtime: Runtime | None = getattr(request.app.state, "runtime", None)
    if runtime is None:
        # Fail closed: never serve tenant data without a configured verifier.
        raise ApiError(503, "auth_not_configured", "Authentication is not configured.")
    return runtime


RuntimeDep = Annotated[Runtime, Depends(get_runtime)]


def get_principal(request: Request, runtime: RuntimeDep) -> Principal:
    header = request.headers.get("authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise unauthorized()
    try:
        return runtime.verifier.verify(token.strip())
    except AuthError as exc:
        logger.warning("token rejected: %s", exc)  # reason only, never the token
        raise unauthorized() from exc


def require_tenant_role(*allowed: Role, strong: bool = False) -> Callable[..., TenantContext]:
    """Dependency factory. No roles given = any member of the tenant.

    `strong=True` (ADR 0016): an Owner or Admin must also hold an aal2 session (a second factor was
    entered). It is checked AFTER the role, so a caller who may not do the action at all gets the
    plain 403 and nothing about their session level. Sales and Viewers are never asked.

    Unknown, malformed and foreign tenant ids all give the same 404, so a caller cannot probe for
    existence. A member whose role is too low gets 403: they already know the tenant exists.
    """

    def dependency(
        tenant_id: str,
        principal: Annotated[Principal, Depends(get_principal)],
        runtime: RuntimeDep,
    ) -> TenantContext:
        try:
            parsed = uuid.UUID(tenant_id)
        except ValueError:
            raise not_found() from None
        membership = runtime.repository.get_membership(principal.token, principal.user_id, parsed)
        if membership is None:
            raise not_found()
        if allowed and membership.role not in allowed:
            raise forbidden()
        if strong and membership.role in (Role.OWNER, Role.ADMIN) and principal.aal != "aal2":
            raise mfa_required()
        return TenantContext(principal=principal, tenant=membership.tenant, role=membership.role)

    return dependency


PrincipalDep = Annotated[Principal, Depends(get_principal)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
OwnerOrAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
