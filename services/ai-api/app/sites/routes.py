"""Customer sites under /v1/tenants/{tenant_id}/sites (job CN, ADR 0085; module `sites`).

  GET    /sites?company_id=&include_inactive=&after=&limit=     every member: the sites of a business or of one customer, newest first.
  GET    /sites/{id}                                             every member.
  PUT    /sites/{id}                                             Owner, Admin, Sales: create or change a site (the id is the caller's, so a retry is safe).

A site is never deleted: it is made inactive (`active: false`). The module check is in the database (SM701 -> 403 `module_off`).

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

import base64
import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.auth.deps import AnyMember, Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.sites.models import SiteIn, SiteListOut, SiteOut, SiteSaveOut
from app.sites.repository import SitesRepository
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/sites", tags=["sites"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Writer = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
Limit = Annotated[int, Query(ge=1, le=100)]


def _repo(runtime: Runtime) -> SitesRepository:
    if runtime.sites is None:
        raise ApiError(503, "sites_unavailable", "Sites are not available right now.")
    return runtime.sites


def _row_id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def encode_cursor(created_at: datetime, site_id: uuid.UUID) -> str:
    return base64.urlsafe_b64encode(f"{created_at.isoformat()}|{site_id}".encode()).decode().rstrip("=")


def decode_cursor(raw: str | None) -> tuple[datetime, uuid.UUID] | None:
    if raw is None:
        return None
    try:
        text = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode()
        created, site_id = text.split("|", 1)
        return datetime.fromisoformat(created), uuid.UUID(site_id)
    except (ValueError, UnicodeDecodeError):
        raise ApiError(422, "validation_error", "Invalid input.") from None


def site_out(row: dict[str, Any]) -> SiteOut:
    return SiteOut.model_validate(row)


@router.get("", response_model=SiteListOut)
def list_sites(
    ctx: AnyMember,
    runtime: RuntimeDep,
    company_id: str | None = None,
    include_inactive: bool = False,
    after: str | None = None,
    limit: Limit = 50,
) -> SiteListOut:
    company = _row_id(company_id) if company_id is not None else None
    rows = _repo(runtime).list(ctx.principal.token, ctx.tenant.id, company, include_inactive, limit, decode_cursor(after))
    items = [site_out(r) for r in rows]
    cursor = encode_cursor(items[-1].created_at, items[-1].id) if len(items) >= limit else None
    return SiteListOut(items=items, next_cursor=cursor)


@router.get("/{site_id}", response_model=SiteOut)
def get_site(site_id: str, ctx: AnyMember, runtime: RuntimeDep) -> SiteOut:
    return site_out(_repo(runtime).get(ctx.principal.token, ctx.tenant.id, _row_id(site_id)))


@router.put("/{site_id}", response_model=SiteSaveOut)
def put_site(site_id: str, body: SiteIn, ctx: Writer, runtime: RuntimeDep) -> SiteSaveOut:
    row = _repo(runtime).save(
        ctx.principal.token,
        {
            "p_site_id": str(_row_id(site_id)),
            "p_tenant_id": str(ctx.tenant.id),
            "p_company_id": str(body.company_id),
            "p_name": body.name,
            "p_address_line": body.address_line,
            "p_city": body.city,
            "p_pin": body.pin,
            "p_map_lat": body.map_lat,
            "p_map_lng": body.map_lng,
            "p_distance_km": body.distance_km,
            "p_lane_width_ft": body.lane_width_ft,
            "p_night_delivery": body.night_delivery,
            "p_unloading_help": body.unloading_help,
            "p_access_notes": body.access_notes,
            "p_site_contact_id": str(body.site_contact_id) if body.site_contact_id else None,
            "p_active": body.active,
        },
    )
    return SiteSaveOut(site=site_out({k: v for k, v in row.items() if k != "created"}), created=row.get("created") is True)
