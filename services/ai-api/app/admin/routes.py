# ruff: noqa: E501
"""Admin console API, phase 1 (Stack19 staff only; off = 404 unless ADMIN_CONSOLE is on).
  GET  /v1/admin/me                                     who am I (role), proves the staff row, the second factor and the session
  GET  /v1/admin/businesses?q=&limit=&cursor=           the businesses: plan, rupee balance, status, signup date, last activity (no end-customer data, no reason needed)
  POST /v1/admin/access                                 ask to look at ONE business with a REASON (15 minutes); the shop owner sees it in their activity log
  GET  /v1/admin/businesses/{tenant_id}?access_id=      the support view (read-only, end-customer names and numbers masked)
  GET  /v1/admin/audit?tenant_id=&staff_id=&limit=&cursor=   the audit trail (owner only)
  GET/PUT /v1/tenants/{t}/support-access, POST .../approve   the SHOP OWNER's "Require my OK before support views my account" (default off)
Refusals: 403 not_staff / second_factor_required / forbidden, 401 session_ended (sign in again), 403 access_required, 409 owner_ok_required, 422 reason_required.
NOTE: no `from __future__ import annotations` here (request objects are attached at registration time)."""

import uuid
from collections.abc import Callable
from typing import Annotated, Any, Literal, TypeVar

from fastapi import APIRouter, Depends, Query

from app.admin.service import (
    AccessIn,
    AccessOut,
    AccessRequiredError,
    AdminService,
    AuditOut,
    BadCursorError,
    BusinessDetailOut,
    BusinessesOut,
    MeOut,
    NotStaffError,
    OverviewOut,
    OwnerOkRequiredError,
    ReasonRequiredError,
    SearchOut,
    SecondFactorRequiredError,
    SessionEndedError,
    SupportAccessIn,
    SupportAccessOut,
    TicketIn,
    TicketOut,
    TicketsOut,
)
from app.auth.deps import PrincipalDep, Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError, not_found
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/admin", tags=["admin"])
tenant_router = APIRouter(prefix="/v1/tenants/{tenant_id}/support-access", tags=["admin"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Owner = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
T = TypeVar("T")


def _service(runtime: Runtime) -> AdminService:
    if runtime.admin is None:
        raise not_found()   # the console does not exist unless ADMIN_CONSOLE is on
    return runtime.admin  # type: ignore[no-any-return]


def _guard(call: Callable[[], T]) -> T:
    """The database's coded refusals as the API's. Nothing about WHY a caller is not staff beyond the code."""
    try:
        return call()
    except NotStaffError:
        raise ApiError(403, "not_staff", "This is for Stack19 staff only.") from None
    except SecondFactorRequiredError:
        raise ApiError(403, "second_factor_required", "Staff sign in with a second factor every time.") from None
    except SessionEndedError:
        raise ApiError(401, "session_ended", "Your session ended after 30 minutes without activity. Sign in again.") from None
    except AccessRequiredError:
        raise ApiError(403, "access_required", "Open this business first, with a reason.") from None
    except OwnerOkRequiredError:
        raise ApiError(409, "owner_ok_required", "This business asked to be asked first. They have not said yes yet.") from None
    except ReasonRequiredError:
        raise ApiError(422, "reason_required", "Say why you need to look at this business.") from None
    except BadCursorError:
        raise ApiError(422, "bad_cursor", "That page marker is not valid.") from None


@router.get("/me", response_model=MeOut)
def me(principal: PrincipalDep, runtime: RuntimeDep) -> MeOut:
    return _guard(lambda: _service(runtime).me(principal.token))


@router.get("/businesses", response_model=BusinessesOut)
def businesses(principal: PrincipalDep, runtime: RuntimeDep, q: Annotated[str | None, Query(max_length=80)] = None,
               limit: Annotated[int, Query(ge=1, le=100)] = 30, cursor: Annotated[str | None, Query(max_length=400)] = None,
               sort: Annotated[Literal["name", "last_activity"], Query()] = "name") -> BusinessesOut:
    return _guard(lambda: _service(runtime).businesses(principal.token, q, limit, cursor, sort))


@router.get("/overview", response_model=OverviewOut)
def overview(principal: PrincipalDep, runtime: RuntimeDep) -> OverviewOut:
    """Everything the Overview screen draws, in ONE call: sidebar counts, the four KPIs, the support queue, health per component, the newest-active businesses, our costs per provider and the margin."""
    return _guard(lambda: _service(runtime).overview(principal.token))


@router.get("/search", response_model=SearchOut)
def search(principal: PrincipalDep, runtime: RuntimeDep, q: Annotated[str, Query(min_length=2, max_length=80)]) -> SearchOut:
    return _guard(lambda: _service(runtime).search(principal.token, q))


@router.get("/support/tickets", response_model=TicketsOut)
def tickets(principal: PrincipalDep, runtime: RuntimeDep, status: Annotated[Literal["open", "waiting", "closed", "active"], Query()] = "active",
            limit: Annotated[int, Query(ge=1, le=100)] = 30) -> TicketsOut:
    return _guard(lambda: _service(runtime).tickets(principal.token, status, limit))


@router.post("/support/tickets", response_model=TicketOut, status_code=201)
def create_ticket(body: TicketIn, principal: PrincipalDep, runtime: RuntimeDep) -> TicketOut:
    return _guard(lambda: _service(runtime).ticket_create(principal.token, body))


@router.post("/access", response_model=AccessOut, status_code=201)
def open_access(body: AccessIn, principal: PrincipalDep, runtime: RuntimeDep) -> AccessOut:
    return _guard(lambda: _service(runtime).open_access(principal.token, body))


@router.get("/businesses/{tenant_id}", response_model=BusinessDetailOut)
def business(tenant_id: uuid.UUID, access_id: Annotated[uuid.UUID, Query()], principal: PrincipalDep, runtime: RuntimeDep) -> BusinessDetailOut:
    return _guard(lambda: _service(runtime).business(principal.token, tenant_id, access_id))


@router.get("/audit", response_model=AuditOut)
def audit(principal: PrincipalDep, runtime: RuntimeDep, tenant_id: Annotated[uuid.UUID | None, Query()] = None, staff_id: Annotated[uuid.UUID | None, Query()] = None,
          limit: Annotated[int, Query(ge=1, le=100)] = 50, cursor: Annotated[str | None, Query(max_length=400)] = None) -> AuditOut:
    return _guard(lambda: _service(runtime).audit(principal.token, tenant_id, staff_id, limit, cursor))


# ------------------------------------------------------------------------------------------------ the shop owner's side
@tenant_router.get("", response_model=SupportAccessOut)
def support_get(ctx: Owner, runtime: RuntimeDep) -> SupportAccessOut:
    return _service(runtime).support_get(ctx.principal.token, ctx.tenant.id)


@tenant_router.put("", response_model=SupportAccessOut)
def support_set(body: SupportAccessIn, ctx: OwnerStrong, runtime: RuntimeDep) -> SupportAccessOut:
    return _service(runtime).support_set(ctx.principal.token, ctx.tenant.id, body.require_ok)


@tenant_router.post("/approve", response_model=SupportAccessOut)
def support_approve(ctx: OwnerStrong, runtime: RuntimeDep) -> SupportAccessOut:
    """Say yes to ONE support visit (valid 30 minutes). Needed only when 'Require my OK' is on."""
    return _service(runtime).support_approve(ctx.principal.token, ctx.tenant.id)


_ = Any
