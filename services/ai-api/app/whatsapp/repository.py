"""WhatsApp data access behind an interface (Supabase PostgREST today). Two kinds of caller, each with its OWN token:

  * the CHANNEL PRINCIPAL (the account the API signs in as to hand a webhook to the database): `account_for`, `ingest_inbound`, `ingest_status`. It belongs to no workspace and reads no table.
  * a person (Owner, Admin, Sales): the account, the templates and the conversations.

Failures are classified by SQLSTATE only; data-layer text is never returned or logged."""

from __future__ import annotations

import logging
import uuid
from datetime import datetime
from typing import Any, Protocol

import httpx

from app.crm.repository import NotFoundError, classify_error
from app.tenancy.repository import MfaRequired, RepositoryError, UpstreamError

logger = logging.getLogger("app.whatsapp.repository")


class WhatsAppStateError(RepositoryError):
    """SM621: not in a state that allows this (for example editing a template that is under review)."""


class WhatsAppRepository(Protocol):
    # the channel principal
    def account_for(self, token: str, phone_number_id: str) -> dict[str, Any] | None: ...
    def ingest_inbound(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def ingest_status(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    # people
    def account_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def account_save(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]: ...
    def account_set_status(self, token: str, tenant_id: uuid.UUID, status: str) -> dict[str, Any]: ...
    def template_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def template_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def template_set_status(self, token: str, tenant_id: uuid.UUID, template_id: uuid.UUID, status: str) -> dict[str, Any]: ...
    def conversation_list(self, token: str, tenant_id: uuid.UUID, limit: int, before: datetime | None) -> list[dict[str, Any]]: ...
    def conversation_thread(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, limit: int, before: datetime | None) -> dict[str, Any]: ...
    def conversation_mark_read(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> None: ...


class PostgrestWhatsAppRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(base_url=rest_url, timeout=httpx.Timeout(20.0, connect=5.0))

    def close(self) -> None:
        self._client.close()

    @staticmethod
    def _classify(status: int, body: Any) -> Exception:
        code = str(body.get("code", "")) if isinstance(body, dict) else ""
        if code == "SM621":
            return WhatsAppStateError(code)
        if code == "SM306":
            return MfaRequired(code)
        if code == "23503":
            return NotFoundError(code)
        return classify_error(status, body)

    def _rpc(self, token: str, function: str, args: dict[str, Any]) -> Any:
        headers = {"apikey": self._anon_key, "Accept": "application/json", "Authorization": f"Bearer {token}"}
        try:
            response = self._client.post(f"/rpc/{function}", json=args, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("whatsapp data layer unreachable: %s", exc.__class__.__name__)
            raise UpstreamError("data layer unreachable") from None
        if response.is_success:
            if response.status_code == 204 or not response.content:
                return None
            try:
                return response.json()
            except ValueError:
                raise UpstreamError("data layer returned a non-JSON body") from None
        try:
            body = response.json()
        except ValueError:
            body = None
        raise self._classify(response.status_code, body)

    def _object(self, token: str, function: str, args: dict[str, Any]) -> dict[str, Any]:
        result = self._rpc(token, function, args)
        if not isinstance(result, dict):
            raise UpstreamError("unexpected function result")
        return result

    def _array(self, token: str, function: str, args: dict[str, Any]) -> list[dict[str, Any]]:
        result = self._rpc(token, function, args)
        if not isinstance(result, list):
            raise UpstreamError("unexpected function result")
        return [r for r in result if isinstance(r, dict)]

    # ------------------------------------------------------------------ the channel principal
    def account_for(self, token: str, phone_number_id: str) -> dict[str, Any] | None:
        result = self._rpc(token, "wa_account_for", {"p_phone_number_id": phone_number_id})
        return result if isinstance(result, dict) else None

    def ingest_inbound(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._object(token, "wa_ingest_inbound", args)

    def ingest_status(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._object(token, "wa_ingest_status", args)

    # ------------------------------------------------------------------ people
    def account_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._object(token, "whatsapp_account_get", {"p_tenant_id": str(tenant_id)})

    def account_save(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]:
        return self._object(token, "whatsapp_account_save", {"p_tenant_id": str(tenant_id), **args})

    def account_set_status(self, token: str, tenant_id: uuid.UUID, status: str) -> dict[str, Any]:
        return self._object(token, "whatsapp_account_set_status", {"p_tenant_id": str(tenant_id), "p_status": status})

    def template_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._array(token, "wa_template_list", {"p_tenant_id": str(tenant_id)})

    def template_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._object(token, "wa_template_save", args)

    def template_set_status(self, token: str, tenant_id: uuid.UUID, template_id: uuid.UUID, status: str) -> dict[str, Any]:
        return self._object(token, "wa_template_set_status", {"p_tenant_id": str(tenant_id), "p_id": str(template_id), "p_status": status})

    def conversation_list(self, token: str, tenant_id: uuid.UUID, limit: int, before: datetime | None) -> list[dict[str, Any]]:
        return self._array(token, "conversation_list", {"p_tenant_id": str(tenant_id), "p_limit": limit, "p_before": before.isoformat() if before else None})

    def conversation_thread(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, limit: int, before: datetime | None) -> dict[str, Any]:
        return self._object(token, "conversation_thread", {"p_tenant_id": str(tenant_id), "p_lead_id": str(lead_id), "p_limit": limit, "p_before": before.isoformat() if before else None})

    def conversation_mark_read(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> None:
        self._rpc(token, "conversation_mark_read", {"p_tenant_id": str(tenant_id), "p_lead_id": str(lead_id)})
