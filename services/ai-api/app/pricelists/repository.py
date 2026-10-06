"""Price-list data access behind an interface (Supabase PostgREST today). Every call carries the CALLER's JWT and the public anon key, so RLS decides what is visible; failures are classified by
SQLSTATE only and data-layer text is never returned, logged or chained into an exception. The one write is the existing SECURITY DEFINER function `create_price_list_version` (Owner or Admin,
second factor): the database re-validates every field, and the products it refers to must be the workspace's own, active and not archived."""

from __future__ import annotations

import logging
import re
import uuid
from typing import Any, Protocol

import httpx

from app.crm.repository import classify_error
from app.tenancy.repository import MfaRequired, UpstreamError

logger = logging.getLogger("app.pricelists.repository")

_SKU = re.compile(r"[A-Za-z0-9._][A-Za-z0-9._-]{0,39}\Z", re.ASCII)
CHUNK = 100


class Product:
    __slots__ = ("id", "name", "sku", "unit")

    def __init__(self, id: uuid.UUID, sku: str, name: str, unit: str) -> None:
        self.id, self.sku, self.name, self.unit = id, sku, name, unit


class PriceListRepository(Protocol):
    def products_by_sku(
        self, token: str, tenant_id: uuid.UUID, skus: list[str]
    ) -> dict[str, Product]:
        """The workspace's ACTIVE, not archived products with these skus, by sku."""
        ...

    def create_version(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...


class PostgrestPriceListRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(
            base_url=rest_url, timeout=httpx.Timeout(10.0, connect=5.0)
        )

    def close(self) -> None:
        self._client.close()

    def _send(
        self,
        method: str,
        path: str,
        token: str,
        *,
        params: dict[str, str] | None = None,
        json: Any = None,
    ) -> Any:
        headers = {
            "apikey": self._anon_key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        try:
            response = self._client.request(method, path, params=params, json=json, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("price list data layer unreachable: %s", exc.__class__.__name__)
            raise UpstreamError("data layer unreachable") from None
        if response.is_success:
            try:
                return response.json()
            except ValueError:
                raise UpstreamError("data layer returned a non-JSON body") from None
        try:
            body = response.json()
        except ValueError:
            body = None
        code = str(body.get("code", "")) if isinstance(body, dict) else ""
        if code == "SM306":
            raise MfaRequired(code)
        raise classify_error(response.status_code, body)

    def products_by_sku(
        self, token: str, tenant_id: uuid.UUID, skus: list[str]
    ) -> dict[str, Product]:
        found: dict[str, Product] = {}
        wanted = sorted(
            {s for s in skus if _SKU.fullmatch(s)}
        )  # a sku that is not shaped like one cannot be a catalog sku (the parser refuses it anyway)
        for i in range(0, len(wanted), CHUNK):
            part = wanted[i : i + CHUNK]
            rows = self._send(
                "GET",
                "/products",
                token,
                params={
                    "select": "id,sku,name,unit",
                    "tenant_id": f"eq.{tenant_id}",
                    "active": "eq.true",
                    "archived_at": "is.null",
                    "sku": "in.(" + ",".join(part) + ")",
                    "limit": str(CHUNK),
                },
            )
            if not isinstance(rows, list):
                raise UpstreamError("unexpected list shape")
            for r in rows:
                if (
                    not isinstance(r, dict)
                    or not all(isinstance(r.get(k), str) for k in ("id", "sku", "name"))
                    or not (r.get("unit") is None or isinstance(r.get("unit"), str))
                ):
                    raise UpstreamError("unexpected product row")
                # a product without a unit is sold by the piece (the database function's own default)
                found[r["sku"]] = Product(
                    uuid.UUID(r["id"]), r["sku"], r["name"], r.get("unit") or "piece"
                )
        return found

    def create_version(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        result = self._send("POST", "/rpc/create_price_list_version", token, json=args)
        if not isinstance(result, dict):
            raise UpstreamError("unexpected function result")
        return result
