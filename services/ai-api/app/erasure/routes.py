"""Erasure endpoints under /v1/tenants/{tenant_id}/erasure-requests (ADR 0014).

Authorization, in order, for every endpoint:
  1. a valid JWT (401);
  2. membership of the tenant in the PATH (a tenant the caller does not belong to is a 404);
  3. a role that may perform the action (403): Owner or Admin may request, list and cancel,
     ONLY the Owner may execute;
  4. the request in the path must exist for this caller (404 otherwise: unknown, malformed and
     foreign ids look the same);
  5. the database decides again (the definer functions re-check the role in the request's
     tenant).
Nothing here takes a tenant, a status, a result or a requester from the body.

NOTE: no `from __future__ import annotations` here, for the same reason as app/crm/routes.py."""

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import CursorError, Page, decode_cursor, parse_uuid
from app.erasure.models import (
    DataPolicyOut,
    ErasureRequestIn,
    ErasureRequestOut,
    ErasureResultOut,
    ExecuteIn,
)
from app.erasure.repository import ErasureRepository
from app.errors import ApiError, not_found
from app.tenancy.models import Role

logger = logging.getLogger("app.erasure.routes")

router = APIRouter(prefix="/v1/tenants/{tenant_id}")

RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AdminPlus = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
# ADR 0016: asking, running and cancelling an erasure need a second factor (reading does not)
_BOTH = (Role.OWNER, Role.ADMIN)
AdminStrong = Annotated[TenantContext, Depends(require_tenant_role(*_BOTH, strong=True))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]


def _repo(runtime: Runtime) -> ErasureRepository:
    if runtime.erasure is None:
        raise ApiError(503, "erasure_unavailable", "Erasure is not available right now.")
    return runtime.erasure


def _row_id(raw: str) -> uuid.UUID:
    """A malformed id is simply a request that does not exist."""
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _visible(runtime: Runtime, ctx: TenantContext, raw_id: str) -> ErasureRequestOut:
    found = _repo(runtime).get(ctx.principal.token, ctx.tenant.id, _row_id(raw_id))
    if found is None:
        raise not_found()
    return found


AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]


@router.get("/data-policy", response_model=DataPolicyOut)
def get_data_policy(ctx: AnyMember, runtime: RuntimeDep) -> DataPolicyOut:
    """The real-data gate, read-only (the operator opens it; nothing here can). Any member may
    read it: the web shows "synthetic data only" while it is closed."""
    return _repo(runtime).data_policy(ctx.principal.token, ctx.tenant.id)


@router.post("/erasure-requests", response_model=ErasureRequestOut, status_code=201)
def request_erasure(
    body: ErasureRequestIn, ctx: AdminStrong, runtime: RuntimeDep, response: Response
) -> ErasureRequestOut:
    repo = _repo(runtime)
    replayed = repo.request(
        ctx.principal.token,
        ctx.tenant.id,
        request_id=body.id,
        scope=body.scope,
        subject_id=body.subject_id,
    )
    found = repo.get(ctx.principal.token, ctx.tenant.id, body.id)
    if found is None:
        raise ApiError(502, "upstream_error", "The data layer failed.")
    response.status_code = 200 if replayed else 201
    return found


@router.get("/erasure-requests", response_model=Page[ErasureRequestOut])
def list_requests(
    ctx: AdminPlus,
    runtime: RuntimeDep,
    limit: Annotated[int, Query(ge=1, le=50)] = 20,
    cursor: Annotated[str | None, Query(max_length=300)] = None,
) -> Page[ErasureRequestOut]:
    decoded = None
    if cursor is not None:
        try:
            decoded = decode_cursor(cursor)
        except CursorError:
            raise ApiError(422, "validation_error", "Invalid input: cursor.") from None
    return _repo(runtime).list(ctx.principal.token, ctx.tenant.id, limit=limit, cursor=decoded)


@router.get("/erasure-requests/{request_id}", response_model=ErasureRequestOut)
def get_request(request_id: str, ctx: AdminPlus, runtime: RuntimeDep) -> ErasureRequestOut:
    return _visible(runtime, ctx, request_id)


@router.post("/erasure-requests/{request_id}/execute", response_model=ErasureResultOut)
def execute_request(
    request_id: str, body: ExecuteIn, ctx: OwnerStrong, runtime: RuntimeDep
) -> ErasureResultOut:
    found = _visible(
        runtime, ctx, request_id
    )  # a request the caller cannot see does not exist for them
    return _repo(runtime).execute(ctx.principal.token, found.id, dry_run=body.dry_run)


@router.post("/erasure-requests/{request_id}/cancel", response_model=ErasureRequestOut)
def cancel_request(request_id: str, ctx: AdminStrong, runtime: RuntimeDep) -> ErasureRequestOut:
    found = _visible(runtime, ctx, request_id)
    _repo(runtime).cancel(ctx.principal.token, found.id)
    after = _repo(runtime).get(ctx.principal.token, ctx.tenant.id, found.id)
    if after is None:
        raise ApiError(502, "upstream_error", "The data layer failed.")
    return after
