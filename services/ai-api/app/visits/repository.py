"""Store-visit data access behind an interface (Supabase PostgREST today). Same discipline as the outbox adapter: every call carries the CALLER's JWT and the public anon key, so the database
decides who may do what (every member reads; Owner and Admin edit the hours; Owner, Admin and Sales book and move visits; the Owner offers a visit) and every write is a SECURITY DEFINER
function (visit_settings_set, visit_book, visit_change, visit_step, visit_complete, visit_send_message, call_request_offer_visit). Failures are classified by SQLSTATE only; data-layer text is
never returned or logged."""

from __future__ import annotations

import logging
import uuid
from typing import Any, Protocol

import httpx

from app.crm.repository import classify_error
from app.orders.errors import SM_ERRORS as ORDER_ERRORS
from app.tenancy.repository import MfaRequired, RepositoryError, UpstreamError
from app.visits.errors import (
    CustomerErasedError,
    NoQuoteError,
    PastDateError,
    ShopClosedError,
    SlotFullError,
    SlotInvalidError,
    VisitStateError,
)

logger = logging.getLogger("app.visits.repository")

_VISIT_ERRORS: dict[str, type[RepositoryError]] = {
    "SM501": VisitStateError,
    "SM502": CustomerErasedError,
    "SM511": ShopClosedError,
    "SM512": SlotInvalidError,
    "SM513": SlotFullError,
    "SM514": PastDateError,
    "SM515": NoQuoteError,
}


class VisitsRepository(Protocol):
    def settings_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def settings_set(
        self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]
    ) -> dict[str, Any]: ...
    def slots(self, token: str, tenant_id: uuid.UUID, day: str) -> dict[str, Any]: ...
    def book(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def change(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def step(
        self, token: str, tenant_id: uuid.UUID, visit_id: uuid.UUID, action: str, reason: str | None
    ) -> dict[str, Any]: ...
    def complete(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def send_message(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def offer_visit(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def list_visits(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        date_from: str | None,
        date_to: str | None,
        open_only: bool,
        status: str | None,
        lead_id: uuid.UUID | None,
        visit_id: uuid.UUID | None,
    ) -> dict[str, Any]: ...


class PostgrestVisitsRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(
            base_url=rest_url, timeout=httpx.Timeout(10.0, connect=5.0)
        )

    def close(self) -> None:
        self._client.close()

    def _rpc(self, token: str, function: str, args: dict[str, Any]) -> dict[str, Any]:
        headers = {
            "apikey": self._anon_key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }
        try:
            response = self._client.post(f"/rpc/{function}", json=args, headers=headers)
        except httpx.HTTPError as exc:
            logger.error("visits data layer unreachable: %s", exc.__class__.__name__)
            raise UpstreamError("data layer unreachable") from None
        if response.is_success:
            try:
                result = response.json()
            except ValueError:
                raise UpstreamError("data layer returned a non-JSON body") from None
            if not isinstance(result, dict):
                raise UpstreamError("unexpected function result")
            return result
        try:
            body = response.json()
        except ValueError:
            body = None
        raise self._classify(response.status_code, body)

    @staticmethod
    def _classify(status: int, body: Any) -> Exception:
        code = str(body.get("code", "")) if isinstance(body, dict) else ""
        if code in _VISIT_ERRORS:
            return _VISIT_ERRORS[code](code)
        if code in ORDER_ERRORS:  # SM230 .. SM239: the order flow a "bought" visit starts
            return ORDER_ERRORS[code](code)
        if code == "SM306":
            return MfaRequired(code)
        return classify_error(status, body)

    # ------------------------------------------------------------------ reads
    def settings_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc(token, "visit_settings_get", {"p_tenant_id": str(tenant_id)})

    def slots(self, token: str, tenant_id: uuid.UUID, day: str) -> dict[str, Any]:
        return self._rpc(token, "visit_slots", {"p_tenant_id": str(tenant_id), "p_date": day})

    def list_visits(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        date_from: str | None,
        date_to: str | None,
        open_only: bool,
        status: str | None,
        lead_id: uuid.UUID | None,
        visit_id: uuid.UUID | None,
    ) -> dict[str, Any]:
        return self._rpc(
            token,
            "visit_list",
            {
                "p_tenant_id": str(tenant_id),
                "p_from": date_from,
                "p_to": date_to,
                "p_open_only": open_only,
                "p_status": status,
                "p_lead_id": str(lead_id) if lead_id else None,
                "p_visit_id": str(visit_id) if visit_id else None,
            },
        )

    # ------------------------------------------------------------------ writes (definer functions only)
    def settings_set(
        self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]
    ) -> dict[str, Any]:
        return self._rpc(token, "visit_settings_set", {"p_tenant_id": str(tenant_id), **args})

    def book(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc(token, "visit_book", args)

    def change(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc(token, "visit_change", args)

    def step(
        self, token: str, tenant_id: uuid.UUID, visit_id: uuid.UUID, action: str, reason: str | None
    ) -> dict[str, Any]:
        return self._rpc(
            token,
            "visit_step",
            {
                "p_tenant_id": str(tenant_id),
                "p_visit_id": str(visit_id),
                "p_action": action,
                "p_reason": reason,
            },
        )

    def complete(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc(token, "visit_complete", args)

    def send_message(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc(token, "visit_send_message", args)

    def offer_visit(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc(token, "call_request_offer_visit", args)
