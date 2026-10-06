"""CRM endpoints under /v1/tenants/{tenant_id}/...

Authorization, in order, for every endpoint:
  1. a valid JWT (401);
  2. membership of the tenant in the PATH (a tenant the caller does not belong to is a 404, never a
     403, never data);
  3. a role that may perform the action in the caller's own tenant (403);
  4. the database: RLS, column grants and triggers decide again.
There is no DELETE endpoint: records are archived, never deleted.

NOTE: this module deliberately does not use `from __future__ import annotations`: the per-entity
request models are attached to the endpoint signatures at registration time.
"""

import uuid
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Response

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm import repository as crm_repo
from app.crm.models import (
    CompanyCreate,
    CompanyOut,
    CompanyUpdate,
    ConsentResultOut,
    ContactCreate,
    ContactOut,
    ContactUpdate,
    CursorError,
    LeadCreate,
    LeadOut,
    LeadUpdate,
    LiftSuppressionIn,
    OpportunityCreate,
    OpportunityOut,
    OpportunityUpdate,
    Page,
    ProductCreate,
    ProductOut,
    ProductUpdate,
    RecordConsentIn,
    SuppressIn,
    decode_cursor,
    parse_uuid,
)
from app.errors import ApiError, not_found
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}")

READERS: tuple[Role, ...] = ()  # any member
SALES_PLUS: tuple[Role, ...] = (Role.OWNER, Role.ADMIN, Role.SALES)
ADMIN_PLUS: tuple[Role, ...] = (Role.OWNER, Role.ADMIN)


@dataclass(frozen=True)
class EntityApi:
    entity: str  # also the URL segment
    out: type
    create: type
    update: type
    writers: tuple[Role, ...]
    searchable: bool = False


ENTITY_APIS = (
    EntityApi("companies", CompanyOut, CompanyCreate, CompanyUpdate, SALES_PLUS, searchable=True),
    EntityApi("contacts", ContactOut, ContactCreate, ContactUpdate, SALES_PLUS),
    EntityApi("products", ProductOut, ProductCreate, ProductUpdate, ADMIN_PLUS),
    EntityApi("leads", LeadOut, LeadCreate, LeadUpdate, SALES_PLUS),
    EntityApi("opportunities", OpportunityOut, OpportunityCreate, OpportunityUpdate, SALES_PLUS),
)

RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role(*READERS))]
AdminPlus = Annotated[TenantContext, Depends(require_tenant_role(*ADMIN_PLUS))]
SalesPlus = Annotated[TenantContext, Depends(require_tenant_role(*SALES_PLUS))]
# lifting a suppression is the Owner's, with a second factor (ADR 0020)
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]


def _row_id(raw: str) -> uuid.UUID:
    """A malformed id is simply a row that does not exist."""
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _archived() -> ApiError:
    return ApiError(409, "archived", "This record is archived; an admin must restore it first.")


def _require_changes(changes: dict[str, Any]) -> None:
    if not changes:
        raise ApiError(422, "validation_error", "Invalid input: send at least one field to change.")


def _register(api: EntityApi) -> None:
    entity, out = api.entity, api.out
    page_model: Any = Page[out]  # type: ignore[valid-type]
    writer_dep = Annotated[TenantContext, Depends(require_tenant_role(*api.writers))]
    base = f"/{entity}"

    # ----------------------------------------------------------------------- list
    def list_rows(
        ctx: AnyMember,
        runtime: RuntimeDep,
        limit: Annotated[int, Query(ge=1, le=100)] = 50,
        cursor: Annotated[str | None, Query(max_length=300)] = None,
        include_archived: bool = False,
        q: Annotated[str | None, Query(max_length=100)] = None,
    ) -> Any:
        decoded = None
        if cursor is not None:
            try:
                decoded = decode_cursor(cursor)
            except CursorError:
                raise ApiError(422, "validation_error", "Invalid input: cursor.") from None
        return runtime.crm.list_rows(
            ctx.principal.token,
            entity,
            ctx.tenant.id,
            limit=limit,
            cursor=decoded,
            q=q if api.searchable else None,
            include_archived=include_archived,
        )

    router.add_api_route(
        base, list_rows, methods=["GET"], response_model=page_model, name=f"list_{entity}"
    )

    # ----------------------------------------------------------------------- get
    def get_row(row_id: str, ctx: AnyMember, runtime: RuntimeDep) -> Any:
        row = runtime.crm.get_row(ctx.principal.token, entity, ctx.tenant.id, _row_id(row_id))
        if row is None:
            raise not_found()
        return row

    router.add_api_route(
        f"{base}/{{row_id}}", get_row, methods=["GET"], response_model=out, name=f"get_{entity}"
    )

    # ----------------------------------------------------------------------- create (idempotent)
    def create_row(ctx: writer_dep, runtime: RuntimeDep, response: Response, body: Any) -> Any:
        row, created = runtime.crm.create_row(
            ctx.principal.token, entity, ctx.tenant.id, body.model_dump(mode="json")
        )
        response.status_code = 201 if created else 200
        return row

    create_row.__annotations__["body"] = api.create
    router.add_api_route(
        base,
        create_row,
        methods=["POST"],
        response_model=out,
        status_code=201,
        name=f"create_{entity}",
    )

    # ----------------------------------------------------------------------- update
    def update_row(row_id: str, ctx: writer_dep, runtime: RuntimeDep, body: Any) -> Any:
        changes = body.model_dump(mode="json", exclude_unset=True)
        _require_changes(changes)
        rid = _row_id(row_id)
        current = runtime.crm.get_row(ctx.principal.token, entity, ctx.tenant.id, rid)
        if current is None:
            raise not_found()
        if current.archived_at is not None:
            raise _archived()
        return runtime.crm.update_row(ctx.principal.token, entity, ctx.tenant.id, rid, changes)

    update_row.__annotations__["body"] = api.update
    router.add_api_route(
        f"{base}/{{row_id}}",
        update_row,
        methods=["PATCH"],
        response_model=out,
        name=f"update_{entity}",
    )

    # ----------------------------------------------------------------------- archive / restore
    def archive_row(row_id: str, ctx: AdminPlus, runtime: RuntimeDep) -> Any:
        rid = _row_id(row_id)
        current = runtime.crm.get_row(ctx.principal.token, entity, ctx.tenant.id, rid)
        if current is None:
            raise not_found()
        if current.archived_at is not None:
            return current  # already archived: idempotent
        return runtime.crm.set_archived(ctx.principal.token, entity, ctx.tenant.id, rid, True)

    def restore_row(row_id: str, ctx: AdminPlus, runtime: RuntimeDep) -> Any:
        rid = _row_id(row_id)
        current = runtime.crm.get_row(ctx.principal.token, entity, ctx.tenant.id, rid)
        if current is None:
            raise not_found()
        if current.archived_at is None:
            return current
        return runtime.crm.set_archived(ctx.principal.token, entity, ctx.tenant.id, rid, False)

    router.add_api_route(
        f"{base}/{{row_id}}/archive",
        archive_row,
        methods=["POST"],
        response_model=out,
        name=f"archive_{entity}",
    )
    router.add_api_route(
        f"{base}/{{row_id}}/restore",
        restore_row,
        methods=["POST"],
        response_model=out,
        name=f"restore_{entity}",
    )


for _api in ENTITY_APIS:
    _register(_api)


# ----------------------------------------------------------------------------- consent (contacts)
def _consent_result(
    runtime: Runtime, ctx: TenantContext, contact_id: uuid.UUID, event_id: uuid.UUID | None
) -> ConsentResultOut:
    contact = runtime.crm.get_row(ctx.principal.token, "contacts", ctx.tenant.id, contact_id)
    if contact is None:
        raise not_found()
    return ConsentResultOut(event_id=event_id, contact=contact)


@router.post("/contacts/{row_id}/record-consent", response_model=ConsentResultOut)
def record_consent(
    row_id: str, body: RecordConsentIn, ctx: SalesPlus, runtime: RuntimeDep
) -> ConsentResultOut:
    cid = _row_id(row_id)
    args: dict[str, Any] = {
        "p_tenant_id": str(ctx.tenant.id),
        "p_contact_id": str(cid),
        "p_channel": body.channel.value,
        "p_status": body.status.value,
    }
    if body.basis is not None:
        args["p_basis"] = body.basis.value
    if body.evidence_type is not None and body.evidence_ref is not None:
        args["p_evidence_type"] = body.evidence_type.value
        args["p_evidence_ref"] = body.evidence_ref
    event_id = runtime.crm.consent_rpc(ctx.principal.token, "record_consent", args)
    return _consent_result(runtime, ctx, cid, event_id)


@router.post("/contacts/{row_id}/suppress", response_model=ConsentResultOut)
def suppress(
    row_id: str, body: SuppressIn, ctx: SalesPlus, runtime: RuntimeDep
) -> ConsentResultOut:
    cid = _row_id(row_id)
    args: dict[str, Any] = {
        "p_tenant_id": str(ctx.tenant.id),
        "p_contact_id": str(cid),
        "p_reason": body.reason.value,
    }
    if body.evidence_type is not None and body.evidence_ref is not None:
        args["p_evidence_type"] = body.evidence_type.value
        args["p_evidence_ref"] = body.evidence_ref
    event_id = runtime.crm.consent_rpc(ctx.principal.token, "suppress_contact", args)
    return _consent_result(runtime, ctx, cid, event_id)


@router.post("/contacts/{row_id}/lift-suppression", response_model=ConsentResultOut)
def lift_suppression(
    row_id: str, body: LiftSuppressionIn, ctx: OwnerStrong, runtime: RuntimeDep
) -> ConsentResultOut:
    """Owner with a second factor (ADR 0020); lifting also lifts the contact's keys."""
    cid = _row_id(row_id)
    event_id = runtime.crm.consent_rpc(
        ctx.principal.token,
        "lift_suppression",
        {
            "p_tenant_id": str(ctx.tenant.id),
            "p_contact_id": str(cid),
            "p_evidence_type": body.evidence_type.value,
            "p_evidence_ref": body.evidence_ref,
        },
    )
    return _consent_result(runtime, ctx, cid, event_id)


__all__ = ["router", "crm_repo"]
