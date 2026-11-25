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
    def import_undo(self, token: str, tenant_id: uuid.UUID, import_id: uuid.UUID) -> dict[str, Any]: ...
    def source_create(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]: ...
    def sources(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def source_rotate(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, token_hash: str, hint: str) -> dict[str, Any]: ...
    def source_status(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, status: str) -> dict[str, Any]: ...
    def consent_tick(self, token: str, tenant_id: uuid.UUID, kinds: list[str], text_version: str) -> dict[str, Any]: ...
    def unparsed(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def unparsed_discard(self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID) -> bool: ...
    def arrivals(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> dict[str, Any]: ...
    def sheet_link_create(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]: ...
    def sheet_links(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def sheet_link_action(self, token: str, tenant_id: uuid.UUID, link_id: uuid.UUID, action: str) -> dict[str, Any]: ...
    # the registered worker account
    def live(self, worker_token: str, token_hash: str, rows: list[dict[str, Any]]) -> dict[str, Any]: ...
    def form_info(self, worker_token: str, token_hash: str) -> dict[str, Any]: ...
    def activity_add(self, worker_token: str, token_hash: str, outcome: str, reason: str, test: bool) -> None: ...
    def activity(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, limit: int) -> dict[str, Any]: ...
    def job_link(self, token: str, tenant_id: uuid.UUID, job_id: str, source_id: uuid.UUID) -> dict[str, Any]: ...
    def job_address(self, token: str, tenant_id: uuid.UUID, job_id: str) -> dict[str, Any] | None: ...
    def test_logged(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, outcome: str, reason: str) -> None: ...
    def meta_consent(self, worker_token: str, token_hash: str, items: list[dict[str, Any]]) -> dict[str, Any]: ...
    def unparsed_add(self, worker_token: str, token_hash: str, subject: str | None, body: str) -> dict[str, Any]: ...
    def sheets_due(self, worker_token: str, limit: int) -> list[dict[str, Any]]: ...
    def sheet_apply(self, worker_token: str, link_id: uuid.UUID, rows: list[dict[str, Any]], header_sha: str) -> dict[str, Any]: ...
    def sheet_failed(self, worker_token: str, link_id: uuid.UUID, error: str) -> bool: ...
    def cards_stats(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def indiamart_status(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def inbound_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def inbound_set(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, address_token: str) -> dict[str, Any]: ...
    def website_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def website_set(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, form_token: str) -> dict[str, Any]: ...
    def website_clear(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def test_finish(self, token: str, tenant_id: uuid.UUID, phone: str) -> dict[str, Any]: ...
    def test_lead(self, token: str, tenant_id: uuid.UUID, kind: str, row: dict[str, Any]) -> dict[str, Any]: ...


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

    def import_undo(self, token: str, tenant_id: uuid.UUID, import_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "lead_import_undo", {"p_tenant_id": str(tenant_id), "p_import_id": str(import_id)})

    def source_create(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "lead_source_create", {"p_tenant_id": str(tenant_id), **args})

    def sources(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "lead_sources_list", {"p_tenant_id": str(tenant_id)})

    def source_rotate(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, token_hash: str, hint: str) -> dict[str, Any]:
        return self._rpc.object(token, "lead_source_rotate", {"p_tenant_id": str(tenant_id), "p_id": str(source_id), "p_token_hash": token_hash, "p_token_hint": hint})

    def source_status(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, status: str) -> dict[str, Any]:
        return self._rpc.object(token, "lead_source_set_status", {"p_tenant_id": str(tenant_id), "p_id": str(source_id), "p_status": status})

    def consent_tick(self, token: str, tenant_id: uuid.UUID, kinds: list[str], text_version: str) -> dict[str, Any]:
        """Who ticked "the people in this source agreed", when, and which wording (migration 20261231986900): Owner and Admin."""
        return self._rpc.object(token, "lead_source_consent_tick", {"p_tenant_id": str(tenant_id), "p_kinds": kinds, "p_text_version": text_version})

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

    def form_info(self, worker_token: str, token_hash: str) -> dict[str, Any]:
        return self._rpc.object(worker_token, "scheduler_lead_form_info", {"p_token_hash": token_hash})

    def activity_add(self, worker_token: str, token_hash: str, outcome: str, reason: str, test: bool) -> None:
        self._rpc.call(worker_token, "scheduler_lead_activity", {"p_token_hash": token_hash, "p_outcome": outcome, "p_reason": reason, "p_test": test})

    def activity(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, limit: int) -> dict[str, Any]:
        return self._rpc.object(token, "lead_source_activity_list", {"p_tenant_id": str(tenant_id), "p_source_id": str(source_id), "p_limit": limit})

    def job_link(self, token: str, tenant_id: uuid.UUID, job_id: str, source_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "job_lead_address_link", {"p_tenant_id": str(tenant_id), "p_job_id": job_id, "p_source_id": str(source_id)})

    def job_address(self, token: str, tenant_id: uuid.UUID, job_id: str) -> dict[str, Any] | None:
        out = self._rpc.call(token, "job_lead_address_get", {"p_tenant_id": str(tenant_id), "p_job_id": job_id})
        return out if isinstance(out, dict) else None

    def meta_consent(self, worker_token: str, token_hash: str, items: list[dict[str, Any]]) -> dict[str, Any]:
        return self._rpc.object(worker_token, "scheduler_lead_meta_consent", {"p_token_hash": token_hash, "p_items": items})

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

    def indiamart_status(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        """The scheduled pull's word on the workspace's own key (migration 20261231992400): `key_state` ok | expired | null, and the last pull."""
        return self._rpc.object(token, "indiamart_pull_status", {"p_tenant_id": str(tenant_id)})

    def inbound_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "lead_inbound_address_get", {"p_tenant_id": str(tenant_id)})

    def inbound_set(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, address_token: str) -> dict[str, Any]:
        return self._rpc.object(token, "lead_inbound_address_set", {"p_tenant_id": str(tenant_id), "p_source_id": str(source_id), "p_token": address_token})

    def website_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "lead_website_form_get", {"p_tenant_id": str(tenant_id)})

    def website_set(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, form_token: str) -> dict[str, Any]:
        return self._rpc.object(token, "lead_website_form_set", {"p_tenant_id": str(tenant_id), "p_source_id": str(source_id), "p_token": form_token})

    def website_clear(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "lead_website_form_clear", {"p_tenant_id": str(tenant_id)})

    def test_finish(self, token: str, tenant_id: uuid.UUID, phone: str) -> dict[str, Any]:
        """Marks the lead a Test button just made (migration 20261231890000) and returns its id."""
        return self._rpc.object(token, "lead_source_test_finish", {"p_tenant_id": str(tenant_id), "p_phone": phone})

    def test_lead(self, token: str, tenant_id: uuid.UUID, kind: str, row: dict[str, Any]) -> dict[str, Any]:
        """One test row through the intake of the workspace's source of this kind, marked as a test (migration 20261231900000); the lead's id, or none."""
        return self._rpc.object(token, "lead_source_test_lead", {"p_tenant_id": str(tenant_id), "p_kind": kind, "p_row": row})

    def test_logged(self, token: str, tenant_id: uuid.UUID, source_id: uuid.UUID, outcome: str, reason: str) -> None:
        self._rpc.call(token, "lead_source_test_logged", {"p_tenant_id": str(tenant_id), "p_source_id": str(source_id), "p_outcome": outcome, "p_reason": reason})
