"""Deliveries behind an interface (Supabase PostgREST today). Every call carries the CALLER's token; every function is a SECURITY DEFINER function of migration 20261123090500 that proves the role first
(Owner, Admin and Sales plan, change and read trips; a Viewer reads none)."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any, Protocol

import httpx

from app.deliveries import errors as e
from app.packs.errors import ModuleOffError
from app.rpc_base import RpcClient

_ERRORS = {
    "SM701": ModuleOffError,
    "SM771": e.TripStateError,
    "SM772": e.OrderNotDispatchedError,
    "SM773": e.QuantityExceedsOrderError,
    "SM774": e.OrderNotDeliverableError,
    "SM775": e.NoSiteContactError,
    "SM776": e.ProofIncompleteError,
}


class DeliveriesRepository(Protocol):
    def plan(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def update(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def set_status(self, token: str, tenant_id: uuid.UUID, trip_id: uuid.UUID, status: str, problem_code: str | None) -> dict[str, Any]: ...
    def deliver(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def ensure_bucket(self, token: str, tenant_id: uuid.UUID) -> str: ...
    def get(self, token: str, tenant_id: uuid.UUID, trip_id: uuid.UUID) -> dict[str, Any]: ...
    def list(self, token: str, tenant_id: uuid.UUID, order_id: uuid.UUID | None, on: date | None, status: str | None, limit: int) -> list[dict[str, Any]]: ...
    def challan(self, token: str, tenant_id: uuid.UUID, trip_id: uuid.UUID) -> dict[str, Any]: ...
    def notify(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...


class PostgrestDeliveriesRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, _ERRORS, client=client)

    def close(self) -> None:
        self._rpc.close()

    def plan(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "trip_plan", args)

    def update(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "trip_update", args)

    def set_status(self, token: str, tenant_id: uuid.UUID, trip_id: uuid.UUID, status: str, problem_code: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "trip_set_status", {"p_tenant_id": str(tenant_id), "p_trip_id": str(trip_id), "p_status": status, "p_problem_code": problem_code})

    def deliver(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "trip_deliver", args)

    def ensure_bucket(self, token: str, tenant_id: uuid.UUID) -> str:
        result = self._rpc.call(token, "pod_ensure_bucket", {"p_tenant_id": str(tenant_id)})
        if not isinstance(result, str):
            from app.tenancy.repository import UpstreamError

            raise UpstreamError("unexpected function result")
        return result

    def get(self, token: str, tenant_id: uuid.UUID, trip_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "trip_get", {"p_tenant_id": str(tenant_id), "p_trip_id": str(trip_id)})

    def list(self, token: str, tenant_id: uuid.UUID, order_id: uuid.UUID | None, on: date | None, status: str | None, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(
            token,
            "trips_list",
            {"p_tenant_id": str(tenant_id), "p_order_id": str(order_id) if order_id else None, "p_date": on.isoformat() if on else None, "p_status": status, "p_limit": limit},
        )

    def challan(self, token: str, tenant_id: uuid.UUID, trip_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "delivery_challan_get", {"p_tenant_id": str(tenant_id), "p_trip_id": str(trip_id)})

    def notify(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "trip_update_submit", args)
