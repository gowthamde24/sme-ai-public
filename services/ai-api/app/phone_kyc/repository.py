"""The database side of the in-app KYC (migration 20261231740000): the caller's own token; the database decides who (the Owner with a second factor writes; any member reads)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from app.rpc_base import RpcClient


class PostgrestKycRepository:
    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key, {})

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "phone_kyc_get", {"p_tenant_id": str(tenant_id)})

    def save(self, token: str, tenant_id: uuid.UUID, kyc_id: uuid.UUID, doc_kind: str, subaccount: str | None, compliance_id: str | None, status: str, reason: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "phone_kyc_save", {"p_tenant_id": str(tenant_id), "p_id": str(kyc_id), "p_doc_kind": doc_kind, "p_subaccount": subaccount, "p_compliance_id": compliance_id, "p_status": status, "p_reason": reason})
