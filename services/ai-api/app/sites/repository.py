"""Customer sites behind an interface (Supabase PostgREST today). Every call carries the CALLER's token; every function is a SECURITY DEFINER function of migration 20261123090100 that proves the role first."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Protocol

import httpx

from app.packs.errors import ModuleOffError
from app.rpc_base import RpcClient
from app.sites.errors import SiteContactError


class SitesRepository(Protocol):
    def save(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def get(self, token: str, tenant_id: uuid.UUID, site_id: uuid.UUID) -> dict[str, Any]: ...
    def list(
        self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID | None, include_inactive: bool, limit: int, after: tuple[datetime, uuid.UUID] | None
    ) -> list[dict[str, Any]]: ...


class PostgrestSitesRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM701": ModuleOffError, "SM751": SiteContactError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def save(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "site_save", args)

    def get(self, token: str, tenant_id: uuid.UUID, site_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "site_get", {"p_tenant_id": str(tenant_id), "p_site_id": str(site_id)})

    def list(
        self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID | None, include_inactive: bool, limit: int, after: tuple[datetime, uuid.UUID] | None
    ) -> list[dict[str, Any]]:
        return self._rpc.array(
            token,
            "sites_list",
            {
                "p_tenant_id": str(tenant_id),
                "p_company_id": str(company_id) if company_id else None,
                "p_include_inactive": include_inactive,
                "p_limit": limit,
                "p_after_created": after[0].isoformat() if after else None,
                "p_after_id": str(after[1]) if after else None,
            },
        )
