"""What you sell, the four styles that are not products (25 Nov 2026; docs/contracts/what-you-sell.md). Behind JOBS (404 while it is off; the workspace door comes first, as for the other Jobs routes).

  GET  /v1/tenants/{t}/what-you-sell?style=&limit=&cursor=      every member: `{style, items, next_cursor}` (at most 50 items; an entry is `{id, name, ...the style's fields}`)
  PUT  /v1/tenants/{t}/what-you-sell/{style}/{id}                Owner, Admin (second factor when they turned the authenticator on): the whole entry; the SAME id again is a retry, never a second row; 422 `validation_error`
                                                                 with `fields`; only the Owner sets or changes an amount (403 for an Admin)
  POST /v1/tenants/{t}/what-you-sell/{style}/{id}/remove         Owner, Admin: soft remove (the API has no HTTP DELETE); removing twice is fine

`style=products` is never stored here: the catalogue has the products.
  POST /v1/tenants/{t}/what-you-sell/{style}/read                Owner, Admin: {kind: sheet|photo|talk, file_id?, text?, language} -> {style, drafts[], unclear, notes[]} (the reading call, 28 Nov 2026: at most 20 drafts, NOTHING saved) NOTE: no `from __future__ import annotations` (request models are attached to the endpoint signatures at registration time)."""

# ruff: noqa: E501

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Body, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, StringConstraints

from app.auth.deps import AnyMember, Runtime, TenantContext, get_runtime, require_tenant_role
from app.errors import ApiError, not_found
from app.jobs.routes import jobs_on
from app.jobs.sell import STYLES, Style, check_entry
from app.jobs.wiring import JobsRuntime
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/what-you-sell", tags=["jobs"])
JobsDep = Annotated[JobsRuntime, Depends(jobs_on)]
OwnerAdminStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, strong=True))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]


class ReadIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal["photo", "sheet", "talk"]
    file_id: uuid.UUID | None = None
    text: Annotated[str, StringConstraints(max_length=2000)] | None = None
    language: Literal["en", "te", "hi", "kn", "ta", "ml", "mr"] = "en"


def _store(jobs: JobsRuntime) -> Any:
    store = getattr(jobs, "sell", None)
    if store is None:
        raise not_found()
    return store


def _entry_id(raw: str) -> uuid.UUID:
    try:
        return uuid.UUID(raw)
    except ValueError:
        raise not_found() from None


def _style(raw: str) -> str:
    if raw not in STYLES:
        raise not_found()   # products are not stored here; any other word is no style
    return raw


@router.get("")
def list_entries(ctx: AnyMember, jobs: JobsDep, style: Style, limit: Annotated[int, Query(ge=1, le=50)] = 50, cursor: Annotated[str | None, Query(max_length=120)] = None) -> JSONResponse:
    out = _store(jobs).list(ctx.principal.token, ctx.tenant.id, style, limit, cursor)
    return JSONResponse(out, headers={"Cache-Control": "private, no-cache"})


@router.put("/{style}/{entry_id}")
def put_entry(style: str, entry_id: str, ctx: OwnerAdminStrong, jobs: JobsDep, body: Annotated[Any, Body()]) -> JSONResponse:
    store, kind, eid = _store(jobs), _style(style), _entry_id(entry_id)
    checked = check_entry(kind, body)
    if isinstance(checked, list):
        raise ApiError(422, "validation_error", "The request was not valid.", extra={"fields": checked})
    name, data = checked
    out = store.put(ctx.principal.token, ctx.tenant.id, kind, eid, name, data)
    return JSONResponse(out["item"], status_code=201 if out.get("created") else 200, headers={"Cache-Control": "no-store"})


@router.post("/{style}/{entry_id}/remove")
def remove_entry(style: str, entry_id: str, ctx: OwnerAdminStrong, jobs: JobsDep) -> JSONResponse:
    _store(jobs).remove(ctx.principal.token, ctx.tenant.id, _style(style), _entry_id(entry_id))
    return JSONResponse({"removed": True}, headers={"Cache-Control": "no-store"})


READ_WORDS = {
    "gone": "That file is no longer there. Please add it again.",
    "unreadable": "That file could not be read.",
    "doc_format": "Please save that document as .docx and try again.",
    "heic": "Please send the picture as a JPG.",
    "scanned_school": "Pictures are not read for this kind of workspace.",
    "no_reader": "Reading pictures is not available right now.",
    "too_big": "That file is too big.",
    "run_limit_reached": "The assistant has done its reading for this hour. Please try again later.",
}


class ProductsReadIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    file_id: uuid.UUID


@router.post("/products/read")
def read_products_entries(body: ProductsReadIn, ctx: OwnerAdmin, _jobs: JobsDep, runtime: RuntimeDep) -> JSONResponse:
    """A photo (a notebook, a printed list, a scan) or a PDF of a PRODUCTS price list becomes draft rows `{name, price_paise|null, unit|null, notes|null, confidence}` (nothing is saved, the file is dropped after a good
    reading): the owner checks each and saves it as a catalogue item or a row of a list with the usual routes. The file is the one dropped with `POST /assistant/files`. Same rules as the other readings (docs/contracts/what-you-sell.md)."""
    from app.jobs import products_read

    return JSONResponse(products_read.read_products(runtime, ctx, body.file_id), headers={"Cache-Control": "no-store"})


@router.post("/{style}/read")
def read_entries(style: str, body: ReadIn, ctx: OwnerAdmin, jobs: JobsDep, runtime: RuntimeDep) -> JSONResponse:
    """A sheet, a picture or the owner's own words become draft entries (nothing is saved): the owner checks each and saves it with the usual PUT."""
    from app.jobs import sell_read

    kind = _style(style)
    if body.kind == "talk":
        if not body.text or not body.text.strip():
            raise ApiError(422, "validation_error", "Say what you sell and the price.", extra={"fields": ["text"]})
        reading = sell_read.drafts_from_table(kind, sell_read.table_from_text(body.text))
    else:
        if body.file_id is None:
            raise ApiError(422, "validation_error", "Add the file first.", extra={"fields": ["file_id"]})
        reading = sell_read.read_file(runtime, ctx, kind, body.file_id)
    out = {"style": kind, "drafts": reading.drafts, "unclear": reading.unclear, "notes": reading.notes}
    return JSONResponse(out, headers={"Cache-Control": "no-store"})
