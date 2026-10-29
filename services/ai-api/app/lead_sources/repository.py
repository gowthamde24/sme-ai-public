"""The lead sources behind an interface (Supabase PostgREST today; job DR / A2). A person's calls carry THEIR token; the public doors and the sheet sync carry the registered worker account's
(they may call only the scheduler_* functions). The functions are those of migration 20261205090000."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Protocol

import httpx

from app.knowledge.errors import KnowledgeLimitError
from app.rpc_base import RpcClient


class LeadSourcesRepository(Protocol):
    def consent_confirm(self, token: str, tenant_id: uuid.UUID, consent_id: uuid.UUID, consent: dict[str, Any]) -> dict[str, Any]: ...
    def intake_apply(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]: ...
    def intakes(self, token: str, tenant_id: uuid.UUID, limit: int, before: datetime | None) -> list[dict[str, Any]]: ...
    def source_create(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]: ...
    def sources(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def source_rotate(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, token_hash: str, hint: str) -> dict[str, Any]: ...
    def source_status(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, status: str) -> dict[str, Any]: ...
    def unparsed(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def unparsed_discard(self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID) -> bool: ...
    def arrivals(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> dict[str, Any]: ...
    def sheet_link_create(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]: ...
    def sheet_links(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def sheet_link_action(self, token: str, tenant_id: uuid.UUID, link_id: uuid.UUID, action: str) -> dict[str, Any]: ...
    # the registered worker account
    def live(self, worker_token: str, token_hash: str, rows: list[dict[str, Any]]) -> dict[str, Any]: ...
    def unparsed_add(self, worker_token: str, token_hash: str, subject: str | None, body: str) -> dict[str, Any]: ...
    def sheets_due(self, worker_token: str, limit: int) -> list[dict[str, Any]]: ...
    def sheet_apply(self, worker_token: str, link_id: uuid.UUID, rows: list[dict[str, Any]], header_sha: str) -> dict[str, Any]: ...
    def sheet_failed(self, worker_token: str, link_id: uuid.UUID, error: str) -> bool: ...
    def cards_stats(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def inbound_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def inbound_set(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, address_token: str) -> dict[str, Any]: ...
    def website_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def website_set(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, form_token: str) -> dict[str, Any]: ...


class PostgrestLeadSourcesRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"53400": KnowledgeLimitError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def consent_confirm(self, token: str, tenant_id: uuid.UUID, consent_id: uuid.UUID, consent: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "lead_consent_confirm", {"p_tenant_id": str(tenant_id), "p_id": str(consent_id), "p_list_name": consent["list_name"], "p_purpose": consent["purpose"], "p_basis": consent["basis"], "p_how_collected": consent["how_collected"]})

    def intake_apply(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "lead_intake_apply", {"p_tenant_id": str(tenant_id), **args})

    def intakes(self, token: str, tenant_id: uuid.UUID, limit: int, before: datetime | None) -> list[dict[str, Any]]:
        return self._rpc.array(token, "lead_intakes_list", {"p_tenant_id": str(tenant_id), "p_limit": limit, "p_before": before.isoformat() if before else None})

    def source_create(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "lead_source_create", {"p_tenant_id": str(tenant_id), **args})

    def sources(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "lead_sources_list", {"p_tenant_id": str(tenant_id)})

    def source_rotate(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, token_hash: str, hint: str) -> dict[str, Any]:
        return self._rpc.object(token, "lead_source_rotate", {"p_tenant_id": str(tenant_id), "p_id": str(source_id), "p_token_hash": token_hash, "p_token_hint": hint})

    def source_status(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, status: str) -> dict[str, Any]:
        return self._rpc.object(token, "lead_source_set_status", {"p_tenant_id": str(tenant_id), "p_id": str(source_id), "p_status": status})

    def unparsed(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "lead_unparsed_list", {"p_tenant_id": str(tenant_id)})

    def unparsed_discard(self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID) -> bool:
        return bool(self._rpc.call(token, "lead_unparsed_discard", {"p_tenant_id": str(tenant_id), "p_id": str(item_id)}))

    def arrivals(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "lead_arrivals_list", {"p_tenant_id": str(tenant_id), "p_lead_id": str(lead_id)})

    def sheet_link_create(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "lead_sheet_link_create", {"p_tenant_id": str(tenant_id), **args})

    def sheet_links(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "lead_sheet_links_list", {"p_tenant_id": str(tenant_id)})

    def sheet_link_action(self, token: str, tenant_id: uuid.UUID, link_id: uuid.UUID, action: str) -> dict[str, Any]:
        return self._rpc.object(token, "lead_sheet_link_action", {"p_tenant_id": str(tenant_id), "p_id": str(link_id), "p_action": action})

    def live(self, worker_token: str, token_hash: str, rows: list[dict[str, Any]]) -> dict[str, Any]:
        return self._rpc.object(worker_token, "scheduler_lead_intake_live", {"p_token_hash": token_hash, "p_rows": rows})

    def unparsed_add(self, worker_token: str, token_hash: str, subject: str | None, body: str) -> dict[str, Any]:
        return self._rpc.object(worker_token, "scheduler_lead_unparsed_add", {"p_token_hash": token_hash, "p_subject": subject, "p_body": body})

    def sheets_due(self, worker_token: str, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(worker_token, "scheduler_sheet_links_due", {"p_limit": limit})

    def sheet_apply(self, worker_token: str, link_id: uuid.UUID, rows: list[dict[str, Any]], header_sha: str) -> dict[str, Any]:
        return self._rpc.object(worker_token, "scheduler_lead_sheet_apply", {"p_link_id": str(link_id), "p_rows": rows, "p_header_sha": header_sha})

    def sheet_failed(self, worker_token: str, link_id: uuid.UUID, error: str) -> bool:
        return bool(self._rpc.call(worker_token, "scheduler_lead_sheet_failed", {"p_link_id": str(link_id), "p_error": error}))

    def cards_stats(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "lead_source_cards_stats", {"p_tenant_id": str(tenant_id)})

    def inbound_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "lead_inbound_address_get", {"p_tenant_id": str(tenant_id)})

    def inbound_set(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, address_token: str) -> dict[str, Any]:
        return self._rpc.object(token, "lead_inbound_address_set", {"p_tenant_id": str(tenant_id), "p_source_id": str(source_id), "p_token": address_token})

    def website_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "lead_website_form_get", {"p_tenant_id": str(tenant_id)})

    def website_set(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, form_token: str) -> dict[str, Any]:
        return self._rpc.object(token, "lead_website_form_set", {"p_tenant_id": str(tenant_id), "p_source_id": str(source_id), "p_token": form_token})
