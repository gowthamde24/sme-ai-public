"""Custom fields under /v1/tenants/{tenant_id} (job CK, ADR 0084 part 2).

  GET   /custom-fields?entity=contact|catalogue_item                    every member: the definitions (active and inactive)
  POST  /custom-fields                                                  Owner or Admin, second factor: a new field (class `none`, source `owner`; 20 active per entity)
  PATCH /custom-fields/{field_id}                                       Owner or Admin, second factor: label, required, order, active; choices only GROW; code, kind and entity never change
  GET   /contacts/{contact_id}/custom, /catalogue/{item_id}/custom      every member (a Viewer does not see `personal` values): the values
  PUT   /contacts/{contact_id}/custom, /catalogue/{item_id}/custom      the roles that may edit the entity (contact: Owner, Admin, Sales; item: Owner, Admin): {values: {code: value}} all or nothing, null clears

The database proves every rule again (SM711 a value that does not fit, SM712 the limit, SM701 the module is off). A model never reads these values.

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.auth.deps import AnyMember, Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.customfields.models import (
    CustomFieldCreateIn,
    CustomFieldDefOut,
    CustomFieldListOut,
    CustomFieldPatchIn,
    CustomValuesIn,
    CustomValuesOut,
    Entity,
)
from app.customfields.repository import CustomFieldsRepository
from app.errors import ApiError, not_found
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["custom-fields"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdminStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, strong=True))]
SalesPlus = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
AdminPlus = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]


def _repo(runtime: Runtime) -> CustomFieldsRepository:
    if runtime.custom_fields is None:
        raise ApiError(503, "custom_fields_unavailable", "Custom fields are not available on this system.")
    return runtime.custom_fields


def _id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


@router.get("/custom-fields", response_model=CustomFieldListOut)
def list_fields(ctx: AnyMember, runtime: RuntimeDep, entity: Annotated[Entity | None, Query()] = None) -> CustomFieldListOut:
    rows = _repo(runtime).defs_list(ctx.principal.token, ctx.tenant.id, entity)
    return CustomFieldListOut(fields=[CustomFieldDefOut(**row) for row in rows])


@router.post("/custom-fields", response_model=CustomFieldDefOut, status_code=201)
def create_field(body: CustomFieldCreateIn, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> CustomFieldDefOut:
    row = _repo(runtime).def_create(ctx.principal.token, ctx.tenant.id, body.model_dump(mode="json"))
    return CustomFieldDefOut(**row)


@router.patch("/custom-fields/{field_id}", response_model=CustomFieldDefOut)
def patch_field(field_id: str, body: CustomFieldPatchIn, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> CustomFieldDefOut:
    row = _repo(runtime).def_update(ctx.principal.token, ctx.tenant.id, _id(field_id), body.model_dump(mode="json", exclude_unset=True))
    return CustomFieldDefOut(**row)


def _values(runtime: Runtime, ctx: TenantContext, entity: str, raw_id: str) -> CustomValuesOut:
    return CustomValuesOut(**_repo(runtime).values_get(ctx.principal.token, ctx.tenant.id, entity, _id(raw_id)))


def _put(runtime: Runtime, ctx: TenantContext, entity: str, raw_id: str, body: CustomValuesIn) -> CustomValuesOut:
    values: dict[str, Any] = dict(body.values)
    return CustomValuesOut(**_repo(runtime).values_set(ctx.principal.token, ctx.tenant.id, entity, _id(raw_id), values))


@router.get("/contacts/{contact_id}/custom", response_model=CustomValuesOut)
def get_contact_values(contact_id: str, ctx: AnyMember, runtime: RuntimeDep) -> CustomValuesOut:
    return _values(runtime, ctx, "contact", contact_id)


@router.put("/contacts/{contact_id}/custom", response_model=CustomValuesOut)
def put_contact_values(contact_id: str, body: CustomValuesIn, ctx: SalesPlus, runtime: RuntimeDep) -> CustomValuesOut:
    return _put(runtime, ctx, "contact", contact_id, body)


@router.get("/catalogue/{item_id}/custom", response_model=CustomValuesOut)
def get_item_values(item_id: str, ctx: AnyMember, runtime: RuntimeDep) -> CustomValuesOut:
    return _values(runtime, ctx, "catalogue_item", item_id)


@router.put("/catalogue/{item_id}/custom", response_model=CustomValuesOut)
def put_item_values(item_id: str, body: CustomValuesIn, ctx: AdminPlus, runtime: RuntimeDep) -> CustomValuesOut:
    return _put(runtime, ctx, "catalogue_item", item_id, body)


__all__ = ["router"]
