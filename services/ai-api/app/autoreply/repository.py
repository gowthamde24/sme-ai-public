"""The worker's three calls for the automatic WhatsApp reply (job DY): the registered scheduler account's token, the database decides everything it hands out and accepts."""

from __future__ import annotations

import uuid
from typing import Any, Protocol

from app.rpc_base import RpcClient


class AutoReplyRepository(Protocol):
    def pending(self, token: str, limit: int) -> list[dict[str, Any]]: ...
    def submit(self, token: str, enquiry_id: uuid.UUID, text: str, language: str, gloss_en: str | None, hold: bool) -> dict[str, Any]: ...
    def skip(self, token: str, enquiry_id: uuid.UUID, note: str) -> dict[str, Any]: ...
    def notes(self, token: str, tenant_id: uuid.UUID) -> str: ...
    def note(self, token: str, enquiry_id: uuid.UUID, promise: bool, kind: str | None, item: str | None, needed_by: str | None, product: str | None) -> dict[str, Any]: ...
    def employee(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None: ...


class PostgrestAutoReplyRepository:
    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key, {})

    def pending(self, token: str, limit: int) -> list[dict[str, Any]]:
        return self._rpc.array(token, "scheduler_auto_reply_pending", {"p_limit": limit})

    def submit(self, token: str, enquiry_id: uuid.UUID, text: str, language: str, gloss_en: str | None, hold: bool) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_auto_reply_submit", {"p_enquiry_id": str(enquiry_id), "p_text": text, "p_language": language, "p_gloss_en": gloss_en, "p_hold": hold})

    def skip(self, token: str, enquiry_id: uuid.UUID, note: str) -> dict[str, Any]:
        return self._rpc.object(token, "scheduler_auto_reply_skip", {"p_enquiry_id": str(enquiry_id), "p_note": note})

    def notes(self, token: str, tenant_id: uuid.UUID) -> str:
        """The owner's notes about the business (job EB), for the workspace this message belongs to; empty when there are none."""
        result = self._rpc.call(token, "scheduler_assistant_context", {"p_tenant_id": str(tenant_id)})
        return result if isinstance(result, str) else ""


    def employee(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        """The AI employee that answers this workspace's WhatsApp (an employee that is on and has the WhatsApp responsibility, the default one first); None when NOBODY does (WhatsApp is optional) or when it cannot be read."""
        out = self._rpc.call(token, "employee_for_channel", {"p_tenant_id": str(tenant_id), "p_channel": "whatsapp"})
        return out if isinstance(out, dict) else None

    def note(self, token: str, enquiry_id: uuid.UUID, promise: bool, kind: str | None, item: str | None, needed_by: str | None, product: str | None) -> dict[str, Any]:
        """After a reply (owner, 16 Nov 2026): the promise it made (Today's open items), the day the customer named, the product they asked about."""
        return self._rpc.object(token, "scheduler_auto_reply_note", {"p_enquiry_id": str(enquiry_id), "p_promise": promise, "p_kind": kind, "p_item": item, "p_needed_by": needed_by, "p_product": product})

    def offer_slots(self, token: str, tenant: uuid.UUID, lead: uuid.UUID, language: str, visit: uuid.UUID | None) -> dict[str, Any]:
        return self._rpc.object(token, "appointment_offer_slots", {"p_tenant_id": str(tenant), "p_lead_id": str(lead), "p_language": language, "p_visit_id": str(visit) if visit else None})

    def book_choice(self, token: str, tenant: uuid.UUID, lead: uuid.UUID, choice: int, visit_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "appointment_book_choice", {"p_tenant_id": str(tenant), "p_lead_id": str(lead), "p_choice": choice, "p_visit_id": str(visit_id)})

    def cancel(self, token: str, tenant: uuid.UUID, lead: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "appointment_cancel_for_customer", {"p_tenant_id": str(tenant), "p_lead_id": str(lead)})

    def next_visit(self, token: str, tenant: uuid.UUID, lead: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "appointment_next_for_customer", {"p_tenant_id": str(tenant), "p_lead_id": str(lead)})


class AutoReplySwitch(Protocol):
    """The Owner's switch (any member reads it): public.auto_reply_get / auto_reply_set."""

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def set(self, token: str, tenant_id: uuid.UUID, enabled: bool) -> dict[str, Any]: ...


class PostgrestAutoReplySwitch:
    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key, {})

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "auto_reply_get", {"p_tenant_id": str(tenant_id)})

    def set(self, token: str, tenant_id: uuid.UUID, enabled: bool) -> dict[str, Any]:
        return self._rpc.object(token, "auto_reply_set", {"p_tenant_id": str(tenant_id), "p_enabled": enabled})
