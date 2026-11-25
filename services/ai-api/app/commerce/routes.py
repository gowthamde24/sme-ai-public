"""Shopify and WooCommerce over HTTP (docs/contracts/commerce-notify.md section B). Off unless COMMERCE=on: every route answers 404.

  GET  /v1/tenants/{t}/commerce/connections                        any member: the connected stores, each with its state, choices and counts (never a key)
  POST /v1/tenants/{t}/commerce/connections/shopify                Owner/Admin: {id, shop, client_secret, access_token | client_id} -> 201 the card
  POST /v1/tenants/{t}/commerce/connections/woocommerce            Owner/Admin: {id, site, key, secret} -> 201 the card
  PUT  /v1/tenants/{t}/commerce/connections/{id}/settings          Owner/Admin: {confirm_orders?, abandoned?, abandoned_after_min?, checkout_consent?, share_status?, cod_words?} -> the card
  POST /v1/tenants/{t}/commerce/connections/{id}/test              Owner/Admin: check the keys, put the webhooks in place -> the card
  POST /v1/tenants/{t}/commerce/connections/{id}/disconnect        Owner/Admin: {disconnected: true}
  POST /v1/tenants/{t}/commerce/connections/{id}/catalogue/preview Owner/Admin: {list_id} -> {rows, notes, products_read} (nothing saved)
  POST /v1/tenants/{t}/commerce/connections/{id}/catalogue/save    Owner/Admin: {list_id, rows} -> {created, updated} (the lists' own import: only the Owner sets a price)
  POST /v1/webhooks/commerce/{kind}/{token}                        the store's webhook (no sign-in: the store's signature over the raw body is the check)
NOTE: no `from __future__ import annotations` (request models are attached to the endpoint signatures at registration time)."""

# ruff: noqa: E501

import logging
import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.auth.deps import AnyMember, Runtime, TenantContext, get_runtime, require_tenant_role
from app.commerce.service import MAX_WEBHOOK_BYTES, Commerce
from app.crm.repository import InvalidValueError
from app.errors import ApiError, not_found
from app.sell_lists.repository import ListRefused
from app.tenancy.models import Role

logger = logging.getLogger("app.commerce")
router = APIRouter(prefix="/v1/tenants/{tenant_id}/commerce", tags=["commerce"])
public_router = APIRouter(prefix="/v1/webhooks/commerce", tags=["commerce"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Manager = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
Text = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ShopifyIn(_Strict):
    id: uuid.UUID
    shop: Text
    client_secret: Annotated[str, StringConstraints(strip_whitespace=True, min_length=8, max_length=200)]
    access_token: Annotated[str, StringConstraints(strip_whitespace=True, min_length=8, max_length=200)] | None = None
    client_id: Annotated[str, StringConstraints(strip_whitespace=True, min_length=4, max_length=200)] | None = None


class WooIn(_Strict):
    id: uuid.UUID
    site: Text
    key: Annotated[str, StringConstraints(strip_whitespace=True, min_length=8, max_length=200)]
    secret: Annotated[str, StringConstraints(strip_whitespace=True, min_length=8, max_length=200)]


class SettingsIn(_Strict):
    confirm_orders: Literal["cod", "all", "off"] | None = None
    abandoned: bool | None = None
    abandoned_after_min: Annotated[int, Field(ge=15, le=1440)] | None = None
    checkout_consent: bool | None = None
    share_status: bool | None = None
    cod_words: Annotated[list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=30, pattern=r"^[A-Za-z0-9][A-Za-z0-9 ]{1,28}[A-Za-z0-9]$")]], Field(max_length=5)] | None = None


class CatalogueIn(_Strict):
    list_id: uuid.UUID


class RowIn(_Strict):
    name: Annotated[str, StringConstraints(min_length=1, max_length=120)]
    cells: dict[Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,29}$")], Any] = {}


class SaveIn(_Strict):
    list_id: uuid.UUID
    rows: Annotated[list[RowIn], Field(min_length=1, max_length=1000)]


def _service(runtime: Runtime) -> Commerce:
    service = getattr(runtime, "commerce", None)
    if service is None:   # COMMERCE=off: as if it were not there
        raise not_found()
    return service  # type: ignore[no-any-return]


def _json(body: Any, status: int = 200) -> JSONResponse:
    return JSONResponse(body, status_code=status, headers={"Cache-Control": "no-store"})


def _invalid() -> ApiError:
    return ApiError(422, "invalid_value", "That is not valid. Please check it.")


@router.get("/connections")
def connections(ctx: AnyMember, runtime: RuntimeDep) -> JSONResponse:
    return _json({"items": _service(runtime).connections(ctx.principal.token, ctx.tenant.id), "settings_words": SETTINGS_WORDS})


@router.post("/connections/shopify")
def connect_shopify(body: ShopifyIn, ctx: Manager, runtime: RuntimeDep) -> JSONResponse:
    service = _service(runtime)
    if runtime.lead_sources is None:
        raise ApiError(503, "commerce_unavailable", "Connecting a store is not available right now. Try again in a minute.", retry_after=30)
    try:
        card = service.connect_shopify(ctx.principal.token, ctx.tenant.id, runtime.lead_sources, connection_id=body.id, shop=body.shop, client_secret=body.client_secret, access_token=body.access_token, client_id=body.client_id)
    except InvalidValueError:
        raise _invalid() from None
    return _json(card, 201)


@router.post("/connections/woocommerce")
def connect_woo(body: WooIn, ctx: Manager, runtime: RuntimeDep) -> JSONResponse:
    service = _service(runtime)
    if runtime.lead_sources is None:
        raise ApiError(503, "commerce_unavailable", "Connecting a store is not available right now. Try again in a minute.", retry_after=30)
    try:
        card = service.connect_woo(ctx.principal.token, ctx.tenant.id, runtime.lead_sources, connection_id=body.id, site=body.site, key=body.key, secret=body.secret)
    except InvalidValueError:
        raise _invalid() from None
    return _json(card, 201)


@router.put("/connections/{connection_id}/settings")
def settings(connection_id: uuid.UUID, body: SettingsIn, ctx: Manager, runtime: RuntimeDep) -> JSONResponse:
    changes = body.model_dump(exclude_none=True)
    if not changes:
        raise _invalid()
    try:
        return _json(_service(runtime).set_settings(ctx.principal.token, ctx.tenant.id, connection_id, changes))
    except InvalidValueError:
        raise _invalid() from None


@router.post("/connections/{connection_id}/test")
def test(connection_id: uuid.UUID, ctx: Manager, runtime: RuntimeDep) -> JSONResponse:
    return _json(_service(runtime).test(ctx.principal.token, ctx.tenant.id, connection_id))


@router.post("/connections/{connection_id}/disconnect")
def disconnect(connection_id: uuid.UUID, ctx: Manager, runtime: RuntimeDep) -> JSONResponse:
    if not _service(runtime).disconnect(ctx.principal.token, ctx.tenant.id, connection_id):
        raise not_found()
    return _json({"disconnected": True})


def _lists(runtime: Runtime) -> Any:
    repo = getattr(runtime, "sell_lists", None)
    if repo is None:   # WHAT_YOU_SELL_LISTS is off: there is no list to fill
        raise not_found()
    return repo


@router.post("/connections/{connection_id}/catalogue/preview")
def catalogue_preview(connection_id: uuid.UUID, body: CatalogueIn, ctx: Manager, runtime: RuntimeDep) -> JSONResponse:
    service, lists = _service(runtime), _lists(runtime)
    try:
        the_list = lists.get(ctx.principal.token, ctx.tenant.id, body.list_id)
    except ListRefused:
        raise not_found() from None
    if the_list.get("kind") != "products":
        raise ApiError(409, "list_not_products", "Pick a list of products to fill from a store.")
    return _json(service.catalogue_preview(ctx.principal.token, ctx.tenant.id, connection_id, the_list))


@router.post("/connections/{connection_id}/catalogue/save")
def catalogue_save(connection_id: uuid.UUID, body: SaveIn, ctx: Manager, runtime: RuntimeDep) -> JSONResponse:
    _service(runtime)._connection(ctx.principal.token, ctx.tenant.id, connection_id)   # the store must be this workspace's
    lists = _lists(runtime)
    try:
        out = lists.rows_import(ctx.principal.token, ctx.tenant.id, body.list_id, [r.model_dump() for r in body.rows], None, None)
    except ListRefused as exc:
        raise ApiError(422 if exc.reason in ("value_not_allowed", "not_a_price", "invalid") else 409, exc.reason, "The list did not take these rows. Please check them.", extra={"reason": exc.reason}) from None
    return _json(out, 201)


@public_router.post("/{kind}/{token}")
async def receive(kind: str, token: str, request: Request) -> JSONResponse:
    runtime = getattr(request.app.state, "runtime", None)
    service = getattr(runtime, "commerce", None)
    if service is None:
        raise not_found()
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > MAX_WEBHOOK_BYTES:
        raise ApiError(413, "too_large", "Too large.")
    raw = await request.body()
    if len(raw) > MAX_WEBHOOK_BYTES:
        raise ApiError(413, "too_large", "Too large.")
    import asyncio

    headers = {k.lower(): v for k, v in request.headers.items()}
    await asyncio.to_thread(service.receive, getattr(runtime, "lead_sources", None), kind, token, headers, raw)
    return JSONResponse({"ok": True})


SETTINGS_WORDS = {
    "confirm_orders": {"cod": "Confirm cash-on-delivery orders", "all": "Confirm every order", "off": "Do not confirm orders"},
    "abandoned": "Call back shoppers who leave a cart (Shopify)",
    "abandoned_after_min": "Wait this many minutes before a cart counts as left",
    "checkout_consent": "My checkout asks customers to agree that I may call or message them about their order",
    "share_status": "Let the phone assistant answer where an order is, for the caller's own orders",
    "cod_words": "Other names my store uses for cash on delivery",
}
