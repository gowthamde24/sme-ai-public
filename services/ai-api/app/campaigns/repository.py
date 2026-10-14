"""Campaigns and the call list behind an interface (Supabase PostgREST today; job CP, ADR 0086). Every call carries the CALLER's token; every function is a SECURITY DEFINER function of migrations
20261124090100 and 20261124090200 that proves the role first (Owner, Admin and Sales build and read; only the Owner approves, with a second factor; Owner and Admin pause, resume and cancel). A model never reads
these tables."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Protocol

import httpx

from app.campaigns.errors import CampaignNotReadyError, CampaignStaleError, CampaignStateError
from app.packs.errors import ModuleOffError
from app.rpc_base import RpcClient


class CampaignsRepository(Protocol):
    def save(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def get(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> dict[str, Any]: ...
    def list_campaigns(self, token: str, tenant_id: uuid.UUID, status: str | None, limit: int, after: tuple[datetime, uuid.UUID] | None) -> list[dict[str, Any]]: ...
    def recipients_add(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, rows: list[dict[str, Any]]) -> dict[str, Any]: ...
    def recipients_from_ledger(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, filter_: dict[str, Any]) -> dict[str, Any]: ...
    def recipient_remove(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, recipient_id: uuid.UUID | None) -> dict[str, Any]: ...
    def list_recipients(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, limit: int, after_seq: int | None) -> list[dict[str, Any]]: ...
    def preview(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> dict[str, Any]: ...
    def approve(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, samples_sha256: str) -> dict[str, Any]: ...
    def set_state(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, action: str) -> dict[str, Any]: ...
    def results(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> dict[str, Any]: ...
    def call_list(self, token: str, tenant_id: uuid.UUID, status: str, limit: int, after: tuple[datetime, uuid.UUID] | None) -> list[dict[str, Any]]: ...
    def call_outcome(self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID, outcome: str, promised_on: date | None, call_after: datetime | None) -> dict[str, Any]: ...


class PostgrestCampaignsRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(
            rest_url,
            anon_key,
            {"SM701": ModuleOffError, "SM801": CampaignStateError, "SM802": CampaignStaleError, "SM803": CampaignNotReadyError},
            client=client,
        )

    def close(self) -> None:
        self._rpc.close()

    @staticmethod
    def _ids(tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> dict[str, Any]:
        return {"p_tenant_id": str(tenant_id), "p_campaign_id": str(campaign_id)}

    def save(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "campaign_save", args)

    def get(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "campaign_get", self._ids(tenant_id, campaign_id))

    def list_campaigns(self, token: str, tenant_id: uuid.UUID, status: str | None, limit: int, after: tuple[datetime, uuid.UUID] | None) -> list[dict[str, Any]]:
        return self._rpc.array(
            token,
            "campaigns_list",
            {
                "p_tenant_id": str(tenant_id),
                "p_status": status,
                "p_limit": limit,
                "p_after_at": after[0].isoformat() if after else None,
                "p_after_id": str(after[1]) if after else None,
            },
        )

    def recipients_add(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, rows: list[dict[str, Any]]) -> dict[str, Any]:
        return self._rpc.object(token, "campaign_recipients_add", {**self._ids(tenant_id, campaign_id), "p_rows": rows})

    def recipients_from_ledger(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, filter_: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "campaign_recipients_from_ledger", {**self._ids(tenant_id, campaign_id), "p_filter": filter_})

    def recipient_remove(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, recipient_id: uuid.UUID | None) -> dict[str, Any]:
        return self._rpc.object(token, "campaign_recipient_remove", {**self._ids(tenant_id, campaign_id), "p_recipient_id": str(recipient_id) if recipient_id else None})

    def list_recipients(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, limit: int, after_seq: int | None) -> list[dict[str, Any]]:
        return self._rpc.array(token, "campaign_recipients_list", {**self._ids(tenant_id, campaign_id), "p_limit": limit, "p_after_seq": after_seq})

    def preview(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "campaign_preview", self._ids(tenant_id, campaign_id))

    def approve(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, samples_sha256: str) -> dict[str, Any]:
        return self._rpc.object(token, "campaign_approve", {**self._ids(tenant_id, campaign_id), "p_samples_sha256": samples_sha256})

    def set_state(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, action: str) -> dict[str, Any]:
        return self._rpc.object(token, "campaign_set_state", {**self._ids(tenant_id, campaign_id), "p_action": action})

    def results(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "campaign_results", self._ids(tenant_id, campaign_id))

    def call_list(self, token: str, tenant_id: uuid.UUID, status: str, limit: int, after: tuple[datetime, uuid.UUID] | None) -> list[dict[str, Any]]:
        return self._rpc.array(
            token,
            "call_list",
            {
                "p_tenant_id": str(tenant_id),
                "p_status": status,
                "p_limit": limit,
                "p_after_at": after[0].isoformat() if after else None,
                "p_after_id": str(after[1]) if after else None,
            },
        )

    def call_outcome(self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID, outcome: str, promised_on: date | None, call_after: datetime | None) -> dict[str, Any]:
        return self._rpc.object(
            token,
            "call_list_outcome",
            {
                "p_tenant_id": str(tenant_id),
                "p_item_id": str(item_id),
                "p_outcome": outcome,
                "p_promised_on": promised_on.isoformat() if promised_on else None,
                "p_call_after": call_after.isoformat() if call_after else None,
            },
        )
