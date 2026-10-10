"""Outbox data access behind an interface (Supabase PostgREST today). Same discipline as the follow-up adapter: every call carries the CALLER's JWT and the public anon key, so RLS decides what is
visible (Owner, Admin and Sales read the outbox and call requests; a Viewer reads none) and every write is a SECURITY DEFINER function (outbox_submit, outbox_edit, outbox_decide,
outbox_claim_due, outbox_mark, outbox_set_settings, call_request_create, call_request_decide). Failures are classified by SQLSTATE only; data-layer text is never returned or logged.

The one place a phone number crosses this module is the answer of `outbox_claim_due` (the adapter needs it); it is handed on in memory and never logged."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Protocol

import httpx

from app.crm.repository import classify_error
from app.outbox.errors import CustomerStoppedError, OutboxStateError
from app.tenancy.repository import MfaRequired, UpstreamError

logger = logging.getLogger("app.outbox.repository")

MESSAGE_COLUMNS = (
    "id,lead_id,contact_id,channel,body,language,category,source,status,reason,flags,model_flagged,uncertain,disclosure_added,"
    "scheduled_for,created_at,edited_at,decided_at,sent_at,failure_code,lead:leads(company:companies(name,city))"
)
CALL_COLUMNS = "id,lead_id,contact_id,reason,script_draft,language,status,created_at,decided_at,decision_note,lead:leads(company:companies(name,city))"


class OutboxRepository(Protocol):
    # writes (definer functions only)
    def submit(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def edit(
        self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID, text: str
    ) -> dict[str, Any]: ...
    def decide(
        self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID, decision: str
    ) -> dict[str, Any]: ...
    def claim_due(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]: ...
    def mark(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def set_settings(
        self, token: str, tenant_id: uuid.UUID, auto_send_enabled: bool, limit: int
    ) -> dict[str, Any]: ...
    def create_call(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def decide_call(
        self,
        token: str,
        tenant_id: uuid.UUID,
        request_id: uuid.UUID,
        decision: str,
        note: str | None,
    ) -> dict[str, Any]: ...

    # reads
    def get_settings(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def list_messages(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        status: str | None,
        lead_id: uuid.UUID | None,
        after: tuple[str, uuid.UUID] | None,
        limit: int,
    ) -> list[dict[str, Any]]: ...
    def get_message(
        self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID
    ) -> dict[str, Any] | None: ...
    def list_calls(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        status: str | None,
        after: tuple[str, uuid.UUID] | None,
        limit: int,
    ) -> list[dict[str, Any]]: ...
    def get_call(
        self, token: str, tenant_id: uuid.UUID, request_id: uuid.UUID
    ) -> dict[str, Any] | None: ...


class PostgrestOutboxRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(
            base_url=rest_url, timeout=httpx.Timeout(10.0, connect=5.0)
        )

    def close(self) -> None:
        self._client.close()

    def _send(
        self,
        method: str,
        path: str,
        token: str,
        *,
        params: dict[str, str] | None = None,
        json: Any = None,
    ) -> Any:
        headers = {
            "apikey": self._anon_key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        try:
            response = self._client.request(method, path, params=params, json=json, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("outbox data layer unreachable: %s", exc.__class__.__name__)
            raise UpstreamError("data layer unreachable") from None
        if response.is_success:
            try:
                return response.json()
            except ValueError:
                raise UpstreamError("data layer returned a non-JSON body") from None
        try:
            body = response.json()
        except ValueError:
            body = None
        raise self._classify(response.status_code, body)

    @staticmethod
    def _classify(status: int, body: Any) -> Exception:
        code = str(body.get("code", "")) if isinstance(body, dict) else ""
        if code == "SM501":
            return OutboxStateError(code)
        if code == "SM502":
            return CustomerStoppedError(code)
        if code == "SM306":
            return MfaRequired(code)
        return classify_error(status, body)

    def _rows(self, path: str, token: str, params: dict[str, str]) -> list[dict[str, Any]]:
        rows = self._send("GET", path, token, params=params)
        if not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows):
            raise UpstreamError("unexpected list shape")
        return rows

    def _rpc(self, token: str, function: str, args: dict[str, Any]) -> Any:
        return self._send("POST", f"/rpc/{function}", token, json=args)

    def _rpc_object(self, token: str, function: str, args: dict[str, Any]) -> dict[str, Any]:
        result = self._rpc(token, function, args)
        if not isinstance(result, dict):
            raise UpstreamError("unexpected function result")
        return result

    # ------------------------------------------------------------------ writes
    def submit(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc_object(token, "outbox_submit", args)

    def edit(
        self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID, text: str
    ) -> dict[str, Any]:
        return self._rpc_object(
            token,
            "outbox_edit",
            {"p_tenant_id": str(tenant_id), "p_message_id": str(message_id), "p_body": text},
        )

    def decide(
        self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID, decision: str
    ) -> dict[str, Any]:
        return self._rpc_object(
            token,
            "outbox_decide",
            {
                "p_tenant_id": str(tenant_id),
                "p_message_id": str(message_id),
                "p_decision": decision,
            },
        )

    def claim_due(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        result = self._rpc(
            token, "outbox_claim_due", {"p_tenant_id": str(tenant_id), "p_limit": limit}
        )
        if not isinstance(result, list) or any(not isinstance(r, dict) for r in result):
            raise UpstreamError("unexpected claim shape")
        return result

    def mark(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc_object(token, "outbox_mark", args)

    def set_settings(
        self, token: str, tenant_id: uuid.UUID, auto_send_enabled: bool, limit: int
    ) -> dict[str, Any]:
        return self._rpc_object(
            token,
            "outbox_set_settings",
            {
                "p_tenant_id": str(tenant_id),
                "p_auto_send_enabled": auto_send_enabled,
                "p_per_customer_daily_limit": limit,
            },
        )

    def create_call(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc_object(token, "call_request_create", args)

    def decide_call(
        self,
        token: str,
        tenant_id: uuid.UUID,
        request_id: uuid.UUID,
        decision: str,
        note: str | None,
    ) -> dict[str, Any]:
        return self._rpc_object(
            token,
            "call_request_decide",
            {
                "p_tenant_id": str(tenant_id),
                "p_request_id": str(request_id),
                "p_decision": decision,
                "p_note": note,
            },
        )

    # ------------------------------------------------------------------ reads
    def get_settings(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc_object(token, "outbox_settings_get", {"p_tenant_id": str(tenant_id)})

    @staticmethod
    def _keyset(params: dict[str, str], after: tuple[str, uuid.UUID] | None) -> None:
        if after is not None:
            stamp, row_id = after
            params["or"] = f"(created_at.lt.{stamp},and(created_at.eq.{stamp},id.lt.{row_id}))"

    def list_messages(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        status: str | None,
        lead_id: uuid.UUID | None,
        after: tuple[str, uuid.UUID] | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        params = {
            "select": MESSAGE_COLUMNS,
            "tenant_id": f"eq.{tenant_id}",
            "order": "created_at.desc,id.desc",
            "limit": str(limit),
        }
        if status is not None:
            params["status"] = f"eq.{status}"
        if lead_id is not None:
            params["lead_id"] = f"eq.{lead_id}"
        self._keyset(params, after)
        return self._rows("/outbox_messages", token, params)

    def get_message(
        self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID
    ) -> dict[str, Any] | None:
        rows = self._rows(
            "/outbox_messages",
            token,
            {
                "select": MESSAGE_COLUMNS,
                "tenant_id": f"eq.{tenant_id}",
                "id": f"eq.{message_id}",
                "limit": "1",
            },
        )
        return rows[0] if rows else None

    def list_calls(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        status: str | None,
        after: tuple[str, uuid.UUID] | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        params = {
            "select": CALL_COLUMNS,
            "tenant_id": f"eq.{tenant_id}",
            "order": "created_at.desc,id.desc",
            "limit": str(limit),
        }
        if status is not None:
            params["status"] = f"eq.{status}"
        self._keyset(params, after)
        return self._rows("/call_requests", token, params)

    def get_call(
        self, token: str, tenant_id: uuid.UUID, request_id: uuid.UUID
    ) -> dict[str, Any] | None:
        rows = self._rows(
            "/call_requests",
            token,
            {
                "select": CALL_COLUMNS,
                "tenant_id": f"eq.{tenant_id}",
                "id": f"eq.{request_id}",
                "limit": "1",
            },
        )
        return rows[0] if rows else None
