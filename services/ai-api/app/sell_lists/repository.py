"""The database's door for "What you sell" lists (migration 20261231990000). The caller's token goes with every call; the database decides who may and every rule; its refusals come back as SQLSTATE words mapped here."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from app.rpc_base import RpcClient
from app.tenancy.repository import RepositoryError


class ListRefused(RepositoryError):
    """`reason` is a closed word (list_limit, column_limit, row_limit, name_taken, one_default_price, role_taken, column_has_data, value_not_allowed, not_a_price)."""

    reason = "invalid"

    def __init__(self, code: str = "") -> None:
        super().__init__(code)
        self.reason = REASONS.get(code, "invalid")


REASONS = {"SM841": "list_limit", "SM842": "column_limit", "SM843": "row_limit", "SM844": "name_taken", "SM845": "one_default_price", "SM846": "role_taken", "SM847": "column_has_data", "SM848": "value_not_allowed", "SM849": "not_a_price"}


class ListRepository:
    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key, {code: ListRefused for code in REASONS})

    def lists(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "sell_lists_list", {"p_tenant_id": str(tenant_id)})

    def get(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "sell_list_get", {"p_tenant_id": str(tenant_id), "p_id": str(list_id)})

    def create(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID, name: str, kind: str) -> dict[str, Any]:
        return self._rpc.object(token, "sell_list_create", {"p_tenant_id": str(tenant_id), "p_id": str(list_id), "p_name": name, "p_kind": kind})

    def update(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID, name: str, make_main: bool) -> dict[str, Any]:
        return self._rpc.object(token, "sell_list_update", {"p_tenant_id": str(tenant_id), "p_id": str(list_id), "p_name": name, "p_make_main": make_main})

    def remove(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "sell_list_remove", {"p_tenant_id": str(tenant_id), "p_id": str(list_id)})

    def columns_put(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID, columns: list[dict[str, Any]], confirm: bool) -> dict[str, Any]:
        return self._rpc.object(token, "sell_list_columns_put", {"p_tenant_id": str(tenant_id), "p_list_id": str(list_id), "p_columns": columns, "p_confirm": confirm})

    def rows(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID, limit: int, cursor: str | None, q: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "sell_row_list", {"p_tenant_id": str(tenant_id), "p_list_id": str(list_id), "p_limit": limit, "p_after": cursor, "p_q": q})

    def row_put(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID, row_id: uuid.UUID, name: str, cells: dict[str, Any], active: bool) -> dict[str, Any]:
        return self._rpc.object(token, "sell_row_put", {"p_tenant_id": str(tenant_id), "p_list_id": str(list_id), "p_id": str(row_id), "p_name": name, "p_cells": cells, "p_active": active})

    def row_remove(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID, row_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "sell_row_remove", {"p_tenant_id": str(tenant_id), "p_list_id": str(list_id), "p_id": str(row_id)})

    def mappings(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "sell_list_mappings", {"p_tenant_id": str(tenant_id), "p_list_id": str(list_id)})

    def rows_import(self, token: str, tenant_id: uuid.UUID, list_id: uuid.UUID, rows: list[dict[str, Any]], label: str | None, mapping: dict[str, Any] | None) -> dict[str, Any]:
        return self._rpc.object(token, "sell_rows_import", {"p_tenant_id": str(tenant_id), "p_list_id": str(list_id), "p_rows": rows, "p_label": label, "p_mapping": mapping})
