# ruff: noqa: E501
"""The lists of what a business sells (28 Nov 2026; contract: reports/what-you-sell-lists-design.md, docs/contracts/sell-lists.md). Behind WHAT_YOU_SELL_LISTS (404 while off).
  GET  /v1/tenants/{t}/lists                          any member: {lists: [{id, name, kind, is_main, row_count, columns: [...]}]}
  POST /v1/tenants/{t}/lists                          Owner/Admin: {id, name, kind} -> 201 the list with the kind's default columns (the same id again is a retry)
  GET  /v1/tenants/{t}/lists/{id}                     any member
  PUT  /v1/tenants/{t}/lists/{id}                     Owner/Admin: {name, make_main}
  POST /v1/tenants/{t}/lists/{id}/remove              Owner/Admin
  PUT  /v1/tenants/{t}/lists/{id}/columns             Owner/Admin: {columns: [...], confirm} the whole ordered set in one call
  GET  /v1/tenants/{t}/lists/{id}/rows?limit&cursor&q any member
  PUT  /v1/tenants/{t}/lists/{id}/rows/{row_id}       Owner/Admin: {name, cells, active}; only the Owner sets or changes a rupee amount
  POST /v1/tenants/{t}/lists/{id}/rows/{row_id}/remove  Owner/Admin
  GET  /v1/tenants/{t}/lists/{id}/import/mappings     any member: the remembered heading -> column mappings
  POST /v1/tenants/{t}/lists/{id}/import/preview      Owner/Admin: {file_id, mapping?} -> {mapping, rows, notes, unclear} (nothing saved)
  POST /v1/tenants/{t}/lists/{id}/import/commit       Owner/Admin: {rows, save_label?, mapping?} -> {created, updated} (all or nothing; a known name updates that item)
NOTE: no `from __future__ import annotations` (request models are attached to the endpoint signatures at registration time)."""

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.auth.deps import AnyMember, Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError, not_found
from app.sell_lists import importer
from app.sell_lists.repository import ListRefused
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/lists", tags=["lists"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdminStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, strong=True))]
Kind = Literal["products", "digital", "services", "bookings", "courses", "subscriptions", "rentals", "food", "events", "other"]
ColumnType = Literal["text", "number", "rupees", "yes_no", "choice", "photo", "link", "date", "datetime", "duration"]
Role_ = Literal["price", "availability", "quantity", "how_to_buy", "description", "category"]
Period = Literal["one_time", "per_month", "per_year", "per_hour", "per_day", "per_unit", "from"]

WORDS = {
    "list_limit": ("You have the most lists your plan allows.", 409),
    "column_limit": ("A list can have at most 12 columns.", 409),
    "row_limit": ("A list can have at most 1,000 items.", 409),
    "name_taken": ("That name is already used here. Please pick another.", 409),
    "one_default_price": ("Pick exactly one price as the one to quote by default.", 409),
    "role_taken": ("Another column already does that job in this list.", 409),
    "column_has_data": ("That column has information in it. Confirm to hide it (the information is kept).", 409),
    "value_not_allowed": ("That value does not fit the column.", 422),
    "not_a_price": ("A price must be a whole amount in rupees.", 422),
    "invalid": ("That is not valid. Please check it.", 422),
}


class ListIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: uuid.UUID
    name: Annotated[str, StringConstraints(min_length=1, max_length=60)]
    kind: Kind


class ListUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Annotated[str, StringConstraints(min_length=1, max_length=60)]
    make_main: bool = False


class ColumnIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,29}$")] | None = None
    label: Annotated[str, StringConstraints(min_length=1, max_length=40)]
    type: ColumnType
    choices: Annotated[list[Annotated[str, StringConstraints(min_length=1, max_length=40)]], Field(max_length=20)] = []
    role: Role_ | None = None
    billing_period: Period | None = None
    quote_default: bool = False


class ColumnsIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    columns: Annotated[list[ColumnIn], Field(max_length=12)]
    confirm: bool = False


class RowIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    cells: dict[Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,29}$")], Any] = {}
    active: bool = True


def _repo(runtime: Runtime) -> Any:
    repo = getattr(runtime, "sell_lists", None)
    if repo is None:
        raise not_found()
    return repo


def _refused(exc: ListRefused) -> ApiError:
    text, status = WORDS.get(exc.reason, WORDS["invalid"])
    return ApiError(status, exc.reason, text, extra={"reason": exc.reason, "fields": [exc.reason]})


def _run(fn: Any, *args: Any) -> Any:
    try:
        return fn(*args)
    except ListRefused as exc:
        raise _refused(exc) from None


def _json(body: Any, status: int = 200) -> JSONResponse:
    return JSONResponse(body, status_code=status, headers={"Cache-Control": "no-store"})


@router.get("")
def my_lists(ctx: AnyMember, runtime: RuntimeDep) -> JSONResponse:
    return _json(_run(_repo(runtime).lists, ctx.principal.token, ctx.tenant.id))


@router.post("/starters")
def make_starters(ctx: OwnerAdminStrong, runtime: RuntimeDep) -> JSONResponse:
    """The starter lists of the workspace's industry (textiles: Sarees, Dress materials, Blouses, Dupattas, Fabric by the metre, Stitching and alterations): only the missing ones, by name, as many as the list cap allows. A retry makes nothing twice."""
    return _json(_run(_repo(runtime).starters, ctx.principal.token, ctx.tenant.id))


@router.post("")
def create_list(body: ListIn, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> JSONResponse:
    return _json(_run(_repo(runtime).create, ctx.principal.token, ctx.tenant.id, body.id, body.name, body.kind), 201)


@router.get("/{list_id}")
def one_list(list_id: uuid.UUID, ctx: AnyMember, runtime: RuntimeDep) -> JSONResponse:
    return _json(_run(_repo(runtime).get, ctx.principal.token, ctx.tenant.id, list_id))


@router.put("/{list_id}")
def update_list(list_id: uuid.UUID, body: ListUpdateIn, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> JSONResponse:
    return _json(_run(_repo(runtime).update, ctx.principal.token, ctx.tenant.id, list_id, body.name, body.make_main))


@router.post("/{list_id}/remove")
def remove_list(list_id: uuid.UUID, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> JSONResponse:
    return _json(_run(_repo(runtime).remove, ctx.principal.token, ctx.tenant.id, list_id))


@router.put("/{list_id}/columns")
def put_columns(list_id: uuid.UUID, body: ColumnsIn, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> JSONResponse:
    columns = [c.model_dump(exclude_none=True) for c in body.columns]
    return _json(_run(_repo(runtime).columns_put, ctx.principal.token, ctx.tenant.id, list_id, columns, body.confirm))


@router.get("/{list_id}/rows")
def list_rows(list_id: uuid.UUID, ctx: AnyMember, runtime: RuntimeDep, limit: Annotated[int, Query(ge=1, le=50)] = 50, cursor: Annotated[str | None, Query(max_length=120)] = None, q: Annotated[str | None, Query(max_length=60)] = None) -> JSONResponse:
    return _json(_run(_repo(runtime).rows, ctx.principal.token, ctx.tenant.id, list_id, limit, cursor, q))


@router.put("/{list_id}/rows/{row_id}")
def put_row(list_id: uuid.UUID, row_id: uuid.UUID, body: RowIn, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> JSONResponse:
    out = _run(_repo(runtime).row_put, ctx.principal.token, ctx.tenant.id, list_id, row_id, body.name, body.cells, body.active)
    return _json(out["item"], 201 if out.get("created") else 200)


@router.post("/{list_id}/rows/{row_id}/remove")
def remove_row(list_id: uuid.UUID, row_id: uuid.UUID, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> JSONResponse:
    return _json(_run(_repo(runtime).row_remove, ctx.principal.token, ctx.tenant.id, list_id, row_id))


class PreviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_id: uuid.UUID
    mapping: dict[Annotated[str, StringConstraints(min_length=1, max_length=80)], Annotated[str, StringConstraints(max_length=40)] | None] | None = None


class ImportRowIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    cells: dict[Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,29}$")], Any] = {}


class CommitIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rows: Annotated[list[ImportRowIn], Field(max_length=1000)]
    save_label: Annotated[str, StringConstraints(min_length=1, max_length=80)] | None = None
    mapping: dict[Annotated[str, StringConstraints(min_length=1, max_length=80)], Annotated[str, StringConstraints(max_length=40)] | None] | None = None


@router.get("/{list_id}/import/mappings")
def import_mappings(list_id: uuid.UUID, ctx: AnyMember, runtime: RuntimeDep) -> JSONResponse:
    return _json(_run(_repo(runtime).mappings, ctx.principal.token, ctx.tenant.id, list_id))


@router.post("/{list_id}/import/preview")
def import_preview(list_id: uuid.UUID, body: PreviewIn, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> JSONResponse:
    """The file's table matched to this list's columns: nothing is saved. The owner corrects it on the screen and sends the rows to /import/commit."""
    from app.jobs import sell_read

    repo = _repo(runtime)
    token, tenant = ctx.principal.token, ctx.tenant.id
    the_list = _run(repo.get, token, tenant, list_id)
    saved = _run(repo.mappings, token, tenant, list_id).get("mappings", [])
    table, _ = sell_read.load_table(runtime, ctx, body.file_id)
    got = importer.propose(the_list, table, mapping=body.mapping, saved=saved)
    return _json({"mapping": got.mapping, "rows": got.rows, "notes": got.notes, "unclear": got.unclear})


@router.post("/{list_id}/import/commit")
def import_commit(list_id: uuid.UUID, body: CommitIn, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> JSONResponse:
    rows = [r.model_dump() for r in body.rows]
    return _json(_run(_repo(runtime).rows_import, ctx.principal.token, ctx.tenant.id, list_id, rows, body.save_label, body.mapping), 201)
