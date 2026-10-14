"""Building-materials quoting under /v1/tenants/{tenant_id}/materials (job CN, ADR 0085; module `materials`), and the public calculator.

  POST   /v1/calculate/materials                                no sign-in: the pure calculator. Area, product, the rules and the rates in; pieces, pallets, trips, GST and the total (with an estimate range) out.
                                                                No business data is read or stored; it is rate limited. The same function runs in the browser (packages/quote-engine/ts).
  GET    /materials/policy                                       Owner, Admin, Sales: the owner's quoting rules in force, and the versions.
  POST   /materials/policy                                       Owner with a second factor: a new version of the rules.
  GET    /materials/items, GET /materials/items/{id}             every member: material items with what a quote will read from them and what is still missing.
  PUT    /materials/items/{id}                                   Owner, Admin: create or change an item (the Owner alone, with a second factor, sets the exact price).
  POST   /materials/items/{id}/photos                            Owner, Admin: the photo is the raw body (the catalogue's rules: resized, stripped of location data, at most 8).
  POST   /materials/photos/{id}/remove, PUT /materials/items/{id}/photos/order
  POST   /materials/requirements/{requirement_id}/preview        Owner, Admin, Sales: the calculator's answer for a confirmed requirement and the picks, and the database's agreement. Nothing is stored.
  POST   /materials/requirements/{requirement_id}/quotes         Owner, Admin, Sales: make a draft (the id is the caller's). The figures are never sent: the database builds the request and refuses any other figure.
  GET    /materials/quotes, GET /materials/quotes/{id}, GET /materials/quotes/{id}/text?language=
  POST   /materials/quotes/{id}/approve                          Owner or Admin with a second factor (the Owner alone when the quote carries a flag).
  POST   /materials/quotes/{id}/reject                           Owner, Admin; Sales may withdraw their own draft.
  POST   /materials/quotes/{id}/order                            Owner or Admin with a second factor: the order (the existing /orders API takes it from there). Answers with the credit WARNING.

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.concurrency import run_in_threadpool

from app.auth.deps import AnyMember, Runtime, TenantContext, get_runtime, require_tenant_role
from app.catalogue import service as catalogue_service
from app.catalogue.images import MAX_UPLOAD_BYTES
from app.catalogue.models import ReorderIn
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.materials import service, text
from app.materials.models import (
    CalcIn,
    CalcOut,
    MaterialItemIn,
    MaterialItemListOut,
    MaterialItemOut,
    MaterialItemSavedOut,
    MaterialPhotoResultOut,
    MaterialQuoteDetailOut,
    MaterialQuoteListOut,
    MaterialQuoteOut,
    OrderCreatedOut,
    OrderFromQuoteIn,
    PolicyBody,
    PolicyIn,
    PolicyOut,
    PolicySavedOut,
    PolicyVersionOut,
    PolicyVersionRefOut,
    QuoteDraftIn,
    QuoteDraftOut,
    QuotePreviewIn,
    QuotePreviewOut,
    QuoteTextOut,
    RejectIn,
)
from app.materials.repository import MaterialsRepository
from app.tenancy.models import Role

public_router = APIRouter(prefix="/v1", tags=["materials"])
router = APIRouter(prefix="/v1/tenants/{tenant_id}/materials", tags=["materials"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Quoter = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerAdminStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, strong=True))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
Limit = Annotated[int, Query(ge=1, le=50)]


def _repo(runtime: Runtime) -> MaterialsRepository:
    if runtime.materials is None:
        raise ApiError(503, "materials_unavailable", "Material quotes are not available right now.")
    return runtime.materials


def _catalogue(runtime: Runtime) -> Any:
    if runtime.catalogue is None:
        raise ApiError(503, "catalogue_unavailable", "The catalogue is not available right now.")
    return runtime.catalogue


def _row_id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


# ---------------------------------------------------------------------------------------------- the public calculator
@public_router.post("/calculate/materials", response_model=CalcOut)
def calculate(body: CalcIn) -> CalcOut:
    return service.calculate(service.request_dict(body))


# ---------------------------------------------------------------------------------------------- the owner's rules
@router.get("/policy", response_model=PolicyOut)
def get_policy(ctx: Quoter, runtime: RuntimeDep) -> PolicyOut:
    row = _repo(runtime).policy_get(ctx.principal.token, ctx.tenant.id)
    current = row.get("current")
    return PolicyOut(
        current=None
        if not isinstance(current, dict)
        else PolicyVersionOut(
            version_id=current["version_id"], version_no=current["version_no"], effective_from=current["effective_from"], policy=PolicyBody.model_validate(current["policy"])
        ),
        versions=[PolicyVersionRefOut.model_validate(v) for v in row.get("versions") or []],
    )


@router.post("/policy", response_model=PolicySavedOut)
def post_policy(body: PolicyIn, ctx: OwnerStrong, runtime: RuntimeDep) -> PolicySavedOut:
    effective = body.effective_from or service.today_ist()
    row = _repo(runtime).policy_create(ctx.principal.token, ctx.tenant.id, body.version_id, effective, service.policy_dict(body.policy))
    return PolicySavedOut(version_id=row["version_id"], version_no=row["version_no"], effective_from=row["effective_from"], replayed=row.get("replayed") is True)


# ---------------------------------------------------------------------------------------------- items
def _item(runtime: Runtime, ctx: TenantContext, item_id: uuid.UUID) -> MaterialItemOut:
    row = _catalogue(runtime).get_item(ctx.principal.token, ctx.tenant.id, item_id)
    if row.get("item_kind") != "material":
        raise not_found()
    inputs = _repo(runtime).item_inputs(ctx.principal.token, ctx.tenant.id, item_id)
    urls = catalogue_service.sign_urls(runtime.catalogue_storage, ctx.principal.token, row.get("photos") or [])
    return service.item_out(row, inputs, urls)


@router.get("/items", response_model=MaterialItemListOut)
def list_items(ctx: AnyMember, runtime: RuntimeDep, in_stock: bool = False, include_inactive: bool = False, after: str | None = None, limit: Limit = 20) -> MaterialItemListOut:
    """In a fixed order: in stock, few left, made to order, then by name. `include_inactive` is honoured for the Owner and Admin only."""
    rows = _catalogue(runtime).search(
        ctx.principal.token,
        ctx.tenant.id,
        catalogue_service.search_args(
            fabric=None, colours=None, occasions=None, price_bands=None, in_stock_only=in_stock, include_inactive=include_inactive, limit=limit, after=catalogue_service.decode_cursor(after)
        ),
        kind="material",
    )
    covers = [r["photos"][0] for r in rows if r.get("photos")]
    urls = catalogue_service.sign_urls(runtime.catalogue_storage, ctx.principal.token, covers)
    return MaterialItemListOut(items=[service.item_summary(r, urls) for r in rows], next_cursor=catalogue_service.next_cursor(rows, limit))


@router.get("/items/{item_id}", response_model=MaterialItemOut)
def get_item(item_id: str, ctx: AnyMember, runtime: RuntimeDep) -> MaterialItemOut:
    return _item(runtime, ctx, _row_id(item_id))


@router.put("/items/{item_id}", response_model=MaterialItemSavedOut)
def put_item(item_id: str, body: MaterialItemIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> MaterialItemSavedOut:
    iid = _row_id(item_id)
    change_price = "price_paise" in body.model_fields_set
    saved = _repo(runtime).item_save(
        ctx.principal.token,
        {
            "p_item_id": str(iid),
            "p_tenant_id": str(ctx.tenant.id),
            "p_name": body.name,
            "p_sell_unit": body.sell_unit,
            "p_area_unit": body.area_unit,
            "p_stock_status": body.stock_status,
            "p_active": body.active,
            "p_price_paise": body.price_paise if change_price else None,
            "p_change_price": change_price,
        },
    )
    return MaterialItemSavedOut(item=_item(runtime, ctx, iid), created=saved.get("created") is True)


@router.post("/items/{item_id}/photos", response_model=MaterialPhotoResultOut)
async def upload_photo(item_id: str, request: Request, ctx: OwnerAdmin, runtime: RuntimeDep, photo_id: str | None = None) -> MaterialPhotoResultOut:
    """Add a photo to an item (up to 8). The BODY is the photo itself with its Content-Type; `photo_id` (a UUID of the caller's) makes a retry safe."""
    iid = _row_id(item_id)
    pid = _row_id(photo_id) if photo_id is not None else uuid.uuid4()
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
    result = await run_in_threadpool(
        catalogue_service.store_photo,
        _catalogue(runtime),
        runtime.catalogue_storage,
        ctx.principal.token,
        ctx.tenant.id,
        iid,
        pid,
        b"".join(chunks),
        request.headers.get("content-type") or "",
    )
    item = await run_in_threadpool(_item, runtime, ctx, iid)
    photo = next((p for p in item.photos if p.id == pid), None)
    if photo is None:
        raise ApiError(502, "upstream_error", "The data layer failed.")
    return MaterialPhotoResultOut(photo=photo, replayed=result.get("replayed") is True, item=item)


@router.post("/photos/{photo_id}/remove", response_model=MaterialItemOut)
def remove_photo(photo_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> MaterialItemOut:
    row = _catalogue(runtime).remove_photo(ctx.principal.token, ctx.tenant.id, _row_id(photo_id))
    item_id = row.get("item_id")
    if item_id is None:
        raise ApiError(502, "upstream_error", "The data layer failed.")
    return _item(runtime, ctx, uuid.UUID(str(item_id)))


@router.put("/items/{item_id}/photos/order", response_model=MaterialItemOut)
def reorder_photos(item_id: str, body: ReorderIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> MaterialItemOut:
    iid = _row_id(item_id)
    _catalogue(runtime).reorder(ctx.principal.token, ctx.tenant.id, iid, body.photo_ids)
    return _item(runtime, ctx, iid)


# ---------------------------------------------------------------------------------------------- quotes
def _picks(picks: list[Any]) -> list[dict[str, Any]]:
    return [{"line_no": p.line_no, "item_id": str(p.item_id)} for p in picks]


@router.post("/requirements/{requirement_id}/preview", response_model=QuotePreviewOut)
def preview(requirement_id: str, body: QuotePreviewIn, ctx: Quoter, runtime: RuntimeDep) -> QuotePreviewOut:
    return service.preview(_repo(runtime), ctx.principal.token, ctx.tenant.id, _row_id(requirement_id), _picks(body.picks), body.site_id)


@router.post("/requirements/{requirement_id}/quotes", response_model=QuoteDraftOut, status_code=201)
def create_draft(requirement_id: str, body: QuoteDraftIn, ctx: Quoter, runtime: RuntimeDep) -> QuoteDraftOut:
    repo = _repo(runtime)
    done = service.draft(repo, ctx.principal.token, ctx.tenant.id, _row_id(requirement_id), body.quote_id, _picks(body.picks), body.site_id)
    return QuoteDraftOut(quote=service.quote_out(repo.quote_get(ctx.principal.token, ctx.tenant.id, body.quote_id)), replayed=done.get("replayed") is True)


@router.get("/quotes", response_model=MaterialQuoteListOut)
def list_quotes(ctx: Quoter, runtime: RuntimeDep, requirement_id: str | None = None, limit: Limit = 20) -> MaterialQuoteListOut:
    rows = _repo(runtime).quotes_list(ctx.principal.token, ctx.tenant.id, _row_id(requirement_id) if requirement_id else None, limit)
    return MaterialQuoteListOut(items=[service.quote_out(r) for r in rows])


@router.get("/quotes/{quote_id}", response_model=MaterialQuoteDetailOut)
def get_quote(quote_id: str, ctx: Quoter, runtime: RuntimeDep) -> MaterialQuoteDetailOut:
    return service.quote_detail(_repo(runtime).quote_get(ctx.principal.token, ctx.tenant.id, _row_id(quote_id)))


@router.get("/quotes/{quote_id}/text", response_model=QuoteTextOut)
def get_quote_text(quote_id: str, ctx: Quoter, runtime: RuntimeDep, language: Annotated[str, Query(pattern="^(en|te|hi|kn|ta)$")] = "en") -> QuoteTextOut:
    row = _repo(runtime).quote_get(ctx.principal.token, ctx.tenant.id, _row_id(quote_id))
    return QuoteTextOut(language=language, language_review="reviewed" if language == "en" else "draft", text=text.render(row, language))  # type: ignore[arg-type]


@router.post("/quotes/{quote_id}/approve", response_model=MaterialQuoteOut)
def approve(quote_id: str, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> MaterialQuoteOut:
    repo = _repo(runtime)
    qid = _row_id(quote_id)
    stored = repo.quote_get(ctx.principal.token, ctx.tenant.id, qid)
    repo.quote_approve(ctx.principal.token, qid, service.recompute_hash(stored))
    return service.quote_out(repo.quote_get(ctx.principal.token, ctx.tenant.id, qid))


@router.post("/quotes/{quote_id}/reject", response_model=MaterialQuoteOut)
def reject(quote_id: str, body: RejectIn, ctx: Quoter, runtime: RuntimeDep) -> MaterialQuoteOut:
    repo = _repo(runtime)
    qid = _row_id(quote_id)
    repo.quote_reject(ctx.principal.token, qid, body.code)
    return service.quote_out(repo.quote_get(ctx.principal.token, ctx.tenant.id, qid))


@router.post("/quotes/{quote_id}/order", response_model=OrderCreatedOut, status_code=201)
def make_order(quote_id: str, body: OrderFromQuoteIn, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> OrderCreatedOut:
    return service.order_out(_repo(runtime).order_create(ctx.principal.token, body.order_id, _row_id(quote_id)))


__all__ = ["public_router", "router"]
