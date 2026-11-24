"""What you sell, the four styles that are not products (25 Nov 2026; docs/contracts/what-you-sell.md). Behind JOBS (404 while it is off; the workspace door comes first, as for the other Jobs routes).

  GET  /v1/tenants/{t}/what-you-sell?style=&limit=&cursor=      every member: `{style, items, next_cursor}` (at most 50 items; an entry is `{id, name, ...the style's fields}`)
  PUT  /v1/tenants/{t}/what-you-sell/{style}/{id}                Owner, Admin (second factor when they turned the authenticator on): the whole entry; the SAME id again is a retry, never a second row; 422 `validation_error`
                                                                 with `fields`; only the Owner sets or changes an amount (403 for an Admin)
  POST /v1/tenants/{t}/what-you-sell/{style}/{id}/remove         Owner, Admin: soft remove (the API has no HTTP DELETE); removing twice is fine

`style=products` is never stored here: the catalogue has the products. There is no reading call. NOTE: no `from __future__ import annotations` (request models are attached to the endpoint signatures at registration time)."""

# ruff: noqa: E501

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Body, Depends, Query
from fastapi.responses import JSONResponse

from app.auth.deps import AnyMember, TenantContext, require_tenant_role
from app.errors import ApiError, not_found
from app.jobs.routes import jobs_on
from app.jobs.sell import STYLES, Style, check_entry
from app.jobs.wiring import JobsRuntime
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/what-you-sell", tags=["jobs"])
JobsDep = Annotated[JobsRuntime, Depends(jobs_on)]
OwnerAdminStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, strong=True))]


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
