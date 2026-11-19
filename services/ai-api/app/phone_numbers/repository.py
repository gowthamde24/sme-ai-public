"""The database side of a business's phone number: the caller's own token; the database decides who (the Owner with a second factor writes)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from app.rpc_base import RpcClient


class PostgrestNumbersRepository:
    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key, {})

    def line(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        out = self._rpc.call(token, "phone_line_for_tenant", {"p_tenant_id": str(tenant_id), "p_provider": "plivo"})
        return out if isinstance(out, dict) else None

    def kyc(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "phone_kyc_get", {"p_tenant_id": str(tenant_id)})

    def attach(self, token: str, tenant_id: uuid.UUID, number: str, account_ref: str | None, external_ref: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "phone_number_attach", {"p_tenant_id": str(tenant_id), "p_number": number, "p_account_ref": account_ref, "p_external_ref": external_ref})

    def detach(self, token: str, tenant_id: uuid.UUID, number: str) -> dict[str, Any]:
        return self._rpc.object(token, "phone_number_detach", {"p_tenant_id": str(tenant_id), "p_number": number})

    def closed_lines(self, token: str, limit: int) -> list[dict[str, Any]]:
        out = self._rpc.call(token, "scheduler_phone_lines_closed", {"p_limit": limit})
        return [x for x in out if isinstance(x, dict)] if isinstance(out, list) else []

    def removed(self, token: str, number: str) -> bool:
        return self._rpc.call(token, "scheduler_phone_line_removed", {"p_number": number}) is True
