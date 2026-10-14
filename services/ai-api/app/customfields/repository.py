"""Custom fields behind an interface (Supabase PostgREST today). Every call carries the CALLER's token; every function is a SECURITY DEFINER function of migration 20261122090200 that proves the role (and,
for a definition, the second factor) first. Failures are classified by SQLSTATE only; data-layer text is never returned or logged."""

from __future__ import annotations

import uuid
from typing import Any, Protocol

import httpx

from app.customfields.errors import CustomFieldLimitError, CustomValueInvalidError
from app.packs.errors import ModuleOffError
from app.rpc_base import RpcClient


class CustomFieldsRepository(Protocol):
    def defs_list(self, token: str, tenant_id: uuid.UUID, entity: str | None) -> list[dict[str, Any]]: ...
    def def_create(self, token: str, tenant_id: uuid.UUID, body: dict[str, Any]) -> dict[str, Any]: ...
    def def_update(self, token: str, tenant_id: uuid.UUID, field_id: uuid.UUID, body: dict[str, Any]) -> dict[str, Any]: ...
    def values_get(self, token: str, tenant_id: uuid.UUID, entity: str, entity_id: uuid.UUID) -> dict[str, Any]: ...
    def values_set(self, token: str, tenant_id: uuid.UUID, entity: str, entity_id: uuid.UUID, values: dict[str, Any]) -> dict[str, Any]: ...
    def values_set_many(self, token: str, tenant_id: uuid.UUID, items: list[dict[str, Any]]) -> dict[str, Any]: ...


class PostgrestCustomFieldsRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM701": ModuleOffError, "SM711": CustomValueInvalidError, "SM712": CustomFieldLimitError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def defs_list(self, token: str, tenant_id: uuid.UUID, entity: str | None) -> list[dict[str, Any]]:
        return self._rpc.array(token, "custom_field_defs_list", {"p_tenant_id": str(tenant_id), "p_entity": entity})

    def def_create(self, token: str, tenant_id: uuid.UUID, body: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(
            token, "custom_field_def_create",
            {"p_tenant_id": str(tenant_id), "p_entity": body["entity"], "p_code": body["code"], "p_label": body["label"], "p_kind": body["kind"], "p_choices": body.get("choices"), "p_required": body.get("required", False)},
        )  # fmt: skip

    def def_update(self, token: str, tenant_id: uuid.UUID, field_id: uuid.UUID, body: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(
            token, "custom_field_def_update",
            {"p_tenant_id": str(tenant_id), "p_id": str(field_id), "p_label": body.get("label"), "p_required": body.get("required"), "p_active": body.get("active"), "p_position": body.get("position"), "p_add_choices": body.get("add_choices")},
        )  # fmt: skip

    def values_get(self, token: str, tenant_id: uuid.UUID, entity: str, entity_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "custom_values_get", {"p_tenant_id": str(tenant_id), "p_entity": entity, "p_entity_id": str(entity_id)})

    def values_set(self, token: str, tenant_id: uuid.UUID, entity: str, entity_id: uuid.UUID, values: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "custom_values_set", {"p_tenant_id": str(tenant_id), "p_entity": entity, "p_entity_id": str(entity_id), "p_values": values})

    def values_set_many(self, token: str, tenant_id: uuid.UUID, items: list[dict[str, Any]]) -> dict[str, Any]:
        return self._rpc.object(token, "custom_values_set_many", {"p_tenant_id": str(tenant_id), "p_items": items})
