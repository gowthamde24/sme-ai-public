"""Building-materials quoting behind an interface (Supabase PostgREST today). Every call carries the CALLER's token; every function is a SECURITY DEFINER function of migrations 20261123090100 to 20261123090400 that
proves the role first. Failures are classified by SQLSTATE only; data-layer text is never returned or logged."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any, Protocol

import httpx

from app.materials import errors as e
from app.orders.errors import SM_ERRORS as ORDER_ERRORS
from app.packs.errors import ModuleOffError
from app.quotes.errors import RequirementNotConfirmedError
from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError

_ERRORS: dict[str, type[RepositoryError]] = {
    "SM701": ModuleOffError,
    "SM761": e.MaterialQuoteMismatchError,
    "SM762": e.MaterialInputMissingError,
    "SM763": e.MaterialQuoteNotDraftError,
    "SM764": e.MaterialQuoteStaleError,
    "SM765": e.MaterialOwnerApprovalError,
    "SM766": e.MaterialNotComputableError,
    "SM767": RequirementNotConfirmedError,
    **ORDER_ERRORS,
}


class MaterialsRepository(Protocol):
    def policy_create(self, token: str, tenant_id: uuid.UUID, version_id: uuid.UUID, effective_from: date, policy: dict[str, Any]) -> dict[str, Any]: ...
    def policy_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def item_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def item_inputs(self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID) -> dict[str, Any]: ...
    def quote_build(self, token: str, tenant_id: uuid.UUID, requirement_id: uuid.UUID, picks: list[dict[str, Any]], site_id: uuid.UUID | None) -> dict[str, Any]: ...
    def quote_draft(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def quote_approve(self, token: str, quote_id: uuid.UUID, recomputed_hash: str) -> dict[str, Any]: ...
    def quote_reject(self, token: str, quote_id: uuid.UUID, code: str) -> dict[str, Any]: ...
    def quote_get(self, token: str, tenant_id: uuid.UUID, quote_id: uuid.UUID) -> dict[str, Any]: ...
    def quotes_list(self, token: str, tenant_id: uuid.UUID, requirement_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]: ...
    def order_create(self, token: str, order_id: uuid.UUID, quote_id: uuid.UUID) -> dict[str, Any]: ...


class PostgrestMaterialsRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, _ERRORS, client=client)

    def close(self) -> None:
        self._rpc.close()

    def policy_create(self, token: str, tenant_id: uuid.UUID, version_id: uuid.UUID, effective_from: date, policy: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(
            token, "material_policy_create", {"p_version_id": str(version_id), "p_tenant_id": str(tenant_id), "p_effective_from": effective_from.isoformat(), "p_policy": policy}
        )

    def policy_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "material_policy_get", {"p_tenant_id": str(tenant_id)})

    def item_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "catalogue_material_save", args)

    def item_inputs(self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "material_item_inputs", {"p_tenant_id": str(tenant_id), "p_item_id": str(item_id)})

    def quote_build(self, token: str, tenant_id: uuid.UUID, requirement_id: uuid.UUID, picks: list[dict[str, Any]], site_id: uuid.UUID | None) -> dict[str, Any]:
        return self._rpc.object(
            token,
            "material_quote_build",
            {"p_tenant_id": str(tenant_id), "p_requirement_id": str(requirement_id), "p_picks": picks, "p_site_id": str(site_id) if site_id else None},
        )

    def quote_draft(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "material_quote_draft", args)

    def quote_approve(self, token: str, quote_id: uuid.UUID, recomputed_hash: str) -> dict[str, Any]:
        return self._rpc.object(token, "material_quote_approve", {"p_quote_id": str(quote_id), "p_recomputed_hash": recomputed_hash})

    def quote_reject(self, token: str, quote_id: uuid.UUID, code: str) -> dict[str, Any]:
        return self._rpc.object(token, "material_quote_reject", {"p_quote_id": str(quote_id), "p_code": code})

    def quote_get(self, token: str, tenant_id: uuid.UUID, quote_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "material_quote_get", {"p_tenant_id": str(tenant_id), "p_quote_id": str(quote_id)})

    def quotes_list(self, token: str, tenant_id: uuid.UUID, requirement_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(
            token, "material_quotes_list", {"p_tenant_id": str(tenant_id), "p_requirement_id": str(requirement_id) if requirement_id else None, "p_limit": limit}
        )

    def order_create(self, token: str, order_id: uuid.UUID, quote_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "create_order_from_material_quote", {"p_order_id": str(order_id), "p_quote_id": str(quote_id)})
