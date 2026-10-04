"""Evidence endpoints under /v1/tenants/{tenant_id}/...

Authorization, in order, for every endpoint (as for the CRM):
  1. a valid JWT (401);
  2. membership of the tenant in the PATH (a tenant the caller does not belong to is a 404);
  3. a role that may perform the action (403);
  4. for target endpoints: the company / lead in the path must exist FOR THIS CALLER (404 otherwise:
     unknown, malformed and foreign ids look the same);
  5. the database: RLS, column grants and triggers decide again.
There is NO delete endpoint, no supersede, and no claims endpoint (ADR 0008). The API never fetches
a URL; it stores and returns text.

NOTE: no `from __future__ import annotations` here, for the same reason as app/crm/routes.py
(request models are attached to the endpoint signatures at registration time).
"""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import CursorError, Page, decode_cursor, parse_uuid
from app.errors import ApiError, not_found
from app.evidence.models import EvidenceCreate, EvidenceLinkOut, TargetKind
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}")

SALES_PLUS: tuple[Role, ...] = (Role.OWNER, Role.ADMIN, Role.SALES)
ADMIN_PLUS: tuple[Role, ...] = (Role.OWNER, Role.ADMIN)

RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
SalesPlus = Annotated[TenantContext, Depends(require_tenant_role(*SALES_PLUS))]
AdminPlus = Annotated[TenantContext, Depends(require_tenant_role(*ADMIN_PLUS))]

# URL segment -> (target kind, CRM entity)
TARGETS: dict[str, tuple[TargetKind, str]] = {
    "companies": ("company", "companies"),
    "leads": ("lead", "leads"),
}


def _row_id(raw: str) -> uuid.UUID:
    """A malformed id is simply a row that does not exist."""
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _require_target(runtime: Runtime, ctx: TenantContext, entity: str, target_id: uuid.UUID) -> Any:
    target = runtime.crm.get_row(ctx.principal.token, entity, ctx.tenant.id, target_id)
    if target is None:
        raise not_found()
    return target


def _register(segment: str, kind: TargetKind, entity: str) -> None:
    def list_evidence(
        target_id: str,
        ctx: AnyMember,
        runtime: RuntimeDep,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        cursor: Annotated[str | None, Query(max_length=300)] = None,
        include_archived: bool = False,
    ) -> Page[EvidenceLinkOut]:
        tid = _row_id(target_id)
        _require_target(runtime, ctx, entity, tid)
        decoded = None
        if cursor is not None:
            try:
                decoded = decode_cursor(cursor)
            except CursorError:
                raise ApiError(422, "validation_error", "Invalid input: cursor.") from None
        return runtime.evidence.list_for_target(
            ctx.principal.token,
            ctx.tenant.id,
            kind,
            tid,
            limit=limit,
            cursor=decoded,
            include_archived=include_archived,
        )

    def create_evidence(
        target_id: str,
        body: EvidenceCreate,
        ctx: SalesPlus,
        runtime: RuntimeDep,
        response: Response,
    ) -> EvidenceLinkOut:
        tid = _row_id(target_id)
        target = _require_target(runtime, ctx, entity, tid)
        if target.archived_at is not None:
            raise ApiError(
                409, "archived", "This record is archived; an admin must restore it first."
            )
        link, created = runtime.evidence.create_for_target(
            ctx.principal.token,
            ctx.tenant.id,
            kind,
            tid,
            body.model_dump(mode="json", exclude_unset=True),
        )
        response.status_code = 201 if created else 200
        return link

    router.add_api_route(
        f"/{segment}/{{target_id}}/evidence",
        list_evidence,
        methods=["GET"],
        response_model=Page[EvidenceLinkOut],
        name=f"list_{segment}_evidence",
    )
    router.add_api_route(
        f"/{segment}/{{target_id}}/evidence",
        create_evidence,
        methods=["POST"],
        response_model=EvidenceLinkOut,
        status_code=201,
        name=f"create_{segment}_evidence",
    )


for _segment, (_kind, _entity) in TARGETS.items():
    _register(_segment, _kind, _entity)


# ----------------------------------------------------------------------------- archive / restore
def _set_archived(
    link_id: str, ctx: TenantContext, runtime: Runtime, archived: bool
) -> EvidenceLinkOut:
    lid = _row_id(link_id)
    current = runtime.evidence.get_link(ctx.principal.token, ctx.tenant.id, lid)
    if current is None:
        raise not_found()
    if (current.archived_at is not None) == archived:
        return current  # already in the requested state: idempotent
    return runtime.evidence.set_link_archived(ctx.principal.token, ctx.tenant.id, lid, archived)


@router.post("/evidence-links/{link_id}/archive", response_model=EvidenceLinkOut)
def archive_link(link_id: str, ctx: AdminPlus, runtime: RuntimeDep) -> EvidenceLinkOut:
    return _set_archived(link_id, ctx, runtime, True)


@router.post("/evidence-links/{link_id}/restore", response_model=EvidenceLinkOut)
def restore_link(link_id: str, ctx: AdminPlus, runtime: RuntimeDep) -> EvidenceLinkOut:
    return _set_archived(link_id, ctx, runtime, False)
