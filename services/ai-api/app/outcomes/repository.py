"""Outcomes behind an interface (Supabase PostgREST today; job DM). Every call carries the CALLER's token; the functions are SECURITY DEFINER functions of migration 20261129090000 that prove the role first
(and, for the AI's own recording, that the caller is the registered channel account)."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Protocol

import httpx

from app.rpc_base import RpcClient


class OutcomesRepository(Protocol):
    def record(self, token: str, tenant_id: uuid.UUID, body: dict[str, Any]) -> dict[str, Any]: ...
    def correct(self, token: str, tenant_id: uuid.UUID, outcome_id: uuid.UUID, outcome: str, category: str | None, reason: str | None) -> dict[str, Any]: ...
    def list_outcomes(self, token: str, tenant_id: uuid.UUID, contact_id: uuid.UUID | None, day: date | None, limit: int, before: tuple[datetime, uuid.UUID] | None) -> dict[str, Any]: ...
    def totals(self, token: str, tenant_id: uuid.UUID, from_day: date | None, to_day: date | None) -> dict[str, Any]: ...
    def for_lead(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, limit: int) -> list[dict[str, Any]]: ...


class PostgrestOutcomesRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def record(self, token: str, tenant_id: uuid.UUID, body: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(
            token,
            "outcome_record",
            {
                "p_tenant_id": str(tenant_id),
                "p_contact_id": str(body["contact_id"]),
                "p_lead_id": str(body["lead_id"]) if body.get("lead_id") else None,
                "p_kind": body["kind"],
                "p_source_id": str(body["source_id"]),
                "p_outcome": body["outcome"],
                "p_category": body.get("category"),
                "p_reason": body.get("reason"),
                "p_occurred_at": body["occurred_at"].isoformat() if isinstance(body["occurred_at"], datetime) else body["occurred_at"],
            },
        )

    def correct(self, token: str, tenant_id: uuid.UUID, outcome_id: uuid.UUID, outcome: str, category: str | None, reason: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "outcome_correct", {"p_tenant_id": str(tenant_id), "p_id": str(outcome_id), "p_outcome": outcome, "p_category": category, "p_reason": reason})

    def list_outcomes(self, token: str, tenant_id: uuid.UUID, contact_id: uuid.UUID | None, day: date | None, limit: int, before: tuple[datetime, uuid.UUID] | None) -> dict[str, Any]:
        return self._rpc.object(
            token,
            "outcomes_list",
            {
                "p_tenant_id": str(tenant_id),
                "p_contact_id": str(contact_id) if contact_id else None,
                "p_day": day.isoformat() if day else None,
                "p_limit": limit,
                "p_before_at": before[0].isoformat() if before else None,
                "p_before_id": str(before[1]) if before else None,
            },
        )

    def totals(self, token: str, tenant_id: uuid.UUID, from_day: date | None, to_day: date | None) -> dict[str, Any]:
        return self._rpc.object(
            token,
            "outcomes_totals",
            {"p_tenant_id": str(tenant_id), "p_from": from_day.isoformat() if from_day else None, "p_to": to_day.isoformat() if to_day else None},
        )

    def for_lead(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(token, "outcomes_for_lead", {"p_tenant_id": str(tenant_id), "p_lead_id": str(lead_id), "p_limit": limit})
