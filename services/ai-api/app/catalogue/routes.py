"""The catalogue under /v1/tenants/{tenant_id}/catalogue/... (job AY, ADR 0069).

Authorization, in order, for every endpoint: a valid JWT (401); membership of the tenant in the PATH (404); a role (403: every member reads; Owner and Admin write; only the Owner sets or clears an EXACT
price, with a second factor: 403 mfa_required); then the database decides again (row-level security, the storage rules, the photo limit). Nothing here names a storage path or a bucket: the database derives them.

A photo is uploaded as the RAW BODY of a POST with the photo's own Content-Type (image/jpeg, image/png or image/webp; at most 5 MB): the server decodes it, applies the camera's orientation, drops every piece of
metadata (EXIF, GPS), resizes it to at most 1280 px and makes a 320 px thumbnail, and stores both in the business's private bucket. Photos are shown by signed URLs that expire.

NOTE: no `from __future__ import annotations` here, for the same reason as app/orders/routes.py (request models are attached to the endpoint signatures at registration time)."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.concurrency import run_in_threadpool

from app.auth.deps import AnyMember, Runtime, TenantContext, get_runtime, require_tenant_role
from app.catalogue import service
from app.catalogue.images import MAX_UPLOAD_BYTES
from app.catalogue.models import (
    CatalogueItemIn,
    CatalogueItemOut,
    CatalogueListOut,
    PhotoResultOut,
    ReorderIn,
    SaveResultOut,
)
from app.catalogue.vocab import COLOURS, FABRICS, OCCASIONS, PRICE_BANDS
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/catalogue", tags=["catalogue"])

RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
Limit = Annotated[int, Query(ge=1, le=50)]


def _repo(runtime: Runtime) -> Any:
    if runtime.catalogue is None:
        raise ApiError(503, "catalogue_unavailable", "The catalogue is not available right now.")
    return runtime.catalogue


def _row_id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _item(runtime: Runtime, ctx: TenantContext, item_id: uuid.UUID) -> CatalogueItemOut:
    row = _repo(runtime).get_item(ctx.principal.token, ctx.tenant.id, item_id)
    urls = service.sign_urls(
        runtime.catalogue_storage, ctx.principal.token, row.get("photos") or []
    )
    return service.item_out(row, urls)


def _csv(raw: str | None, allowed: tuple[str, ...]) -> list[str] | None:
    if raw is None or raw == "":
        return None
    values = [v.strip() for v in raw.split(",") if v.strip()]
    if any(v not in allowed for v in values):
        raise ApiError(422, "validation_error", "Invalid input.")
    return values


@router.get("/items", response_model=CatalogueListOut)
def list_items(
    ctx: AnyMember,
    runtime: RuntimeDep,
    fabric: str | None = None,
    colour: str | None = None,
    occasion: str | None = None,
    price_band: str | None = None,
    in_stock: bool = False,
    include_inactive: bool = False,
    after: str | None = None,
    limit: Limit = 20,
) -> CatalogueListOut:
    """The catalogue, in a fixed order: in stock, few left, made to order, then by name. `colour`, `occasion` and `price_band` take one or several words separated by commas (any of them matches). Every member
    reads; `include_inactive` is honoured for the Owner and Admin only. Only items with a photo are ever active."""
    if fabric is not None and fabric not in FABRICS:
        raise ApiError(422, "validation_error", "Invalid input.")
    rows = _repo(runtime).search(
        ctx.principal.token,
        ctx.tenant.id,
        service.search_args(
            fabric=fabric,
            colours=_csv(colour, COLOURS),
            occasions=_csv(occasion, OCCASIONS),
            price_bands=_csv(price_band, PRICE_BANDS),
            in_stock_only=in_stock,
            include_inactive=include_inactive,
            limit=limit,
            after=service.decode_cursor(after),
        ),
    )
    covers = [r["photos"][0] for r in rows if r.get("photos")]
    urls = service.sign_urls(runtime.catalogue_storage, ctx.principal.token, covers)
    return CatalogueListOut(
        items=[service.summary_out(r, urls) for r in rows],
        next_cursor=service.next_cursor(rows, limit),
    )


@router.get("/items/{item_id}", response_model=CatalogueItemOut)
def get_item(item_id: str, ctx: AnyMember, runtime: RuntimeDep) -> CatalogueItemOut:
    return _item(runtime, ctx, _row_id(item_id))


@router.put("/items/{item_id}", response_model=SaveResultOut)
def put_item(
    item_id: str, body: CatalogueItemIn, ctx: OwnerAdmin, runtime: RuntimeDep
) -> SaveResultOut:
    """Create or change an item (the id is the caller's, so a retry is safe). Owner and Admin. `price_paise` sets or clears the EXACT price (Owner, second factor); leave it out to keep it."""
    iid = _row_id(item_id)
    change_price = "price_paise" in body.model_fields_set
    saved = _repo(runtime).save_item(
        ctx.principal.token,
        {
            "p_item_id": str(iid),
            "p_tenant_id": str(ctx.tenant.id),
            "p_name": body.name,
            "p_fabric": body.fabric,
            "p_colours": body.colours,
            "p_zari": body.zari,
            "p_border": body.border,
            "p_occasions": body.occasions,
            "p_price_band": body.price_band,
            "p_stock_status": body.stock_status,
            "p_active": body.active,
            "p_price_paise": body.price_paise if change_price else None,
            "p_change_price": change_price,
        },
    )
    return SaveResultOut(item=_item(runtime, ctx, iid), created=saved.get("created") is True)


@router.post("/items/{item_id}/photos", response_model=PhotoResultOut)
async def upload_photo(
    item_id: str,
    request: Request,
    ctx: OwnerAdmin,
    runtime: RuntimeDep,
    photo_id: str | None = None,
) -> PhotoResultOut:
    """Add a photo to an item (up to 8). The BODY is the photo itself with its Content-Type; `photo_id` (a UUID of the caller's) makes a retry safe. Owner and Admin."""
    iid = _row_id(item_id)
    pid = _row_id(photo_id) if photo_id is not None else uuid.uuid4()
    repository = _repo(runtime)
    if runtime.catalogue_storage is None:
        raise ApiError(503, "catalogue_unavailable", "The catalogue is not available right now.")
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES + 65536:
        raise ApiError(413, "photo_too_large", "That photo is bigger than 5 MB.")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_UPLOAD_BYTES + 65536:
            raise ApiError(413, "photo_too_large", "That photo is bigger than 5 MB.")
        chunks.append(chunk)
    data = b"".join(chunks)
    storage = runtime.catalogue_storage
    result = await run_in_threadpool(
        service.store_photo,
        repository,
        storage,
        ctx.principal.token,
        ctx.tenant.id,
        iid,
        pid,
        data,
        (request.headers.get("content-type") or ""),
    )
    item = await run_in_threadpool(_item, runtime, ctx, iid)
    photo = next((p for p in item.photos if p.id == pid), None)
    if (
        photo is None
    ):  # registered but not readable back: not possible unless the item changed under us
        raise ApiError(502, "upstream_error", "The data layer failed.")
    return PhotoResultOut(photo=photo, replayed=result.get("replayed") is True, item=item)


@router.post("/photos/{photo_id}/remove", response_model=CatalogueItemOut)
def remove_photo(photo_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> CatalogueItemOut:
    """Take a photo off its item (Owner, Admin). The record stays (a message already sent may refer to it). An ACTIVE item keeps at least one photo: make it inactive first."""
    pid = _row_id(photo_id)
    repository = _repo(runtime)
    # the item is found from the photo through the database's own reads: the photo's item id comes back from the removal's own item read
    row = repository.remove_photo(ctx.principal.token, ctx.tenant.id, pid)
    item_id = row.get("item_id")
    if item_id is None:
        raise ApiError(502, "upstream_error", "The data layer failed.")
    return _item(runtime, ctx, uuid.UUID(str(item_id)))


@router.put("/items/{item_id}/photos/order", response_model=CatalogueItemOut)
def reorder_photos(
    item_id: str, body: ReorderIn, ctx: OwnerAdmin, runtime: RuntimeDep
) -> CatalogueItemOut:
    """Put the item's live photos in this order (every live photo exactly once); the first is the cover."""
    iid = _row_id(item_id)
    _repo(runtime).reorder(ctx.principal.token, ctx.tenant.id, iid, body.photo_ids)
    return _item(runtime, ctx, iid)
