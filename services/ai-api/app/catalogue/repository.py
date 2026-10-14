"""Catalogue data access behind an interface (Supabase PostgREST today). Every call carries the CALLER's JWT and the public key, so the database decides who may do what (every member reads; Owner and Admin
edit; the exact price is the Owner's, with a second factor) and every write is a SECURITY DEFINER function. Failures are classified by SQLSTATE only; data-layer text is never returned or logged."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Protocol

import httpx

from app.catalogue.errors import NeedsPhotoError, PhotoFilesMissingError, TooManyPhotosError
from app.crm.repository import classify_error
from app.tenancy.repository import MfaRequired, RepositoryError, UpstreamError

logger = logging.getLogger("app.catalogue.repository")

_ERRORS: dict[str, type[RepositoryError]] = {
    "SM521": NeedsPhotoError,
    "SM522": TooManyPhotosError,
    "SM523": PhotoFilesMissingError,
}


class CatalogueRepository(Protocol):
    def ensure_bucket(self, token: str, tenant_id: uuid.UUID) -> str: ...
    def save_item(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def add_photo(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def remove_photo(
        self, token: str, tenant_id: uuid.UUID, photo_id: uuid.UUID
    ) -> dict[str, Any]: ...
    def reorder(
        self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID, photo_ids: list[uuid.UUID]
    ) -> dict[str, Any]: ...
    def get_item(self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID) -> dict[str, Any]: ...
    def search(
        self, token: str, tenant_id: uuid.UUID, args: dict[str, Any], kind: str = "saree"
    ) -> list[dict[str, Any]]: ...


class PostgrestCatalogueRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(
            base_url=rest_url, timeout=httpx.Timeout(10.0, connect=5.0)
        )

    def close(self) -> None:
        self._client.close()

    def _rpc(self, token: str, function: str, args: dict[str, Any]) -> Any:
        headers = {
            "apikey": self._anon_key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        try:
            response = self._client.post(f"/rpc/{function}", json=args, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("catalogue data layer unreachable: %s", exc.__class__.__name__)
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
        raise self._classify(response.status_code, body)

    @staticmethod
    def _classify(status: int, body: Any) -> Exception:
        code = str(body.get("code", "")) if isinstance(body, dict) else ""
        if code in _ERRORS:
            return _ERRORS[code](code)
        if code == "SM306":
            return MfaRequired(code)
        return classify_error(status, body)

    def _object(self, token: str, function: str, args: dict[str, Any]) -> dict[str, Any]:
        result = self._rpc(token, function, args)
        if not isinstance(result, dict):
            raise UpstreamError("unexpected function result")
        return result

    def ensure_bucket(self, token: str, tenant_id: uuid.UUID) -> str:
        result = self._rpc(token, "catalogue_ensure_bucket", {"p_tenant_id": str(tenant_id)})
        if not isinstance(result, str):
            raise UpstreamError("unexpected function result")
        return result

    def save_item(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._object(token, "catalogue_item_save", args)

    def add_photo(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._object(token, "catalogue_photo_add", args)

    def remove_photo(self, token: str, tenant_id: uuid.UUID, photo_id: uuid.UUID) -> dict[str, Any]:
        return self._object(
            token,
            "catalogue_photo_remove",
            {"p_tenant_id": str(tenant_id), "p_photo_id": str(photo_id)},
        )

    def reorder(
        self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID, photo_ids: list[uuid.UUID]
    ) -> dict[str, Any]:
        return self._object(
            token,
            "catalogue_photos_reorder",
            {
                "p_tenant_id": str(tenant_id),
                "p_item_id": str(item_id),
                "p_photo_ids": [str(p) for p in photo_ids],
            },
        )

    def get_item(self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID) -> dict[str, Any]:
        return self._object(
            token, "catalogue_get", {"p_tenant_id": str(tenant_id), "p_item_id": str(item_id)}
        )

    def search(
        self, token: str, tenant_id: uuid.UUID, args: dict[str, Any], kind: str = "saree"
    ) -> list[dict[str, Any]]:
        # job CN: the catalogue holds two kinds of item; the saree screens and the assistant's tool ask for sarees, the materials screens for materials
        result = self._rpc(
            token, "catalogue_search", {"p_tenant_id": str(tenant_id), "p_item_kind": kind, **args}
        )
        if not isinstance(result, list) or any(not isinstance(r, dict) for r in result):
            raise UpstreamError("unexpected search shape")
        return result
