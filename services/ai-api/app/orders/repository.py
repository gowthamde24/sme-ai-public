"""Order data access behind an interface (Supabase PostgREST today). Same discipline as the quotes adapter: every call carries the CALLER's JWT and the public anon key, so RLS
decides what is visible (Owner, Admin and Sales read orders and their ledger; a Viewer reads none); failures are classified by SQLSTATE only and data-layer text is never returned,
logged or chained into an exception (SM232's DETAIL is read only to pick a closed reason).

Orders, events and policy versions have no client write grant: every write is a SECURITY DEFINER function (create_order_from_quote, record_order_event,
create_order_policy_version)."""

from __future__ import annotations

import logging
import uuid
from datetime import date
from typing import Any, Protocol

import httpx

from app.crm.repository import classify_error
from app.orders.builder import OrderState
from app.orders.errors import REASONS, SM_ERRORS, OrderRefusedError
from app.tenancy.repository import MfaRequired, UpstreamError

logger = logging.getLogger("app.orders.repository")

ORDER_COLUMNS = "id,order_no,quote_id,enquiry_id,requirement_id,lead_id,state,order_total_paise,advance_paise,valid_until,policy_version_id,created_at,closed_at"
LEDGER_COLUMNS = (
    "order_id,paid_paise,refunded_paise,net_paise,balance_paise,event_count,lost_reason"
)
EVENT_COLUMNS = "id,seq,type,prior_state,new_state,amount_paise,ledger_id,occurred_at,reason_code,owner_approved_by,recorded_by,recorded_at,engine_version,canonical_hash"


class OrdersRepository(Protocol):
    def create_order(
        self, token: str, order_id: uuid.UUID, quote_id: uuid.UUID
    ) -> dict[str, Any]: ...
    def record_event(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def create_policy(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def get_order(
        self, token: str, tenant_id: uuid.UUID, order_id: uuid.UUID
    ) -> dict[str, Any] | None:
        """The order row merged with its ledger totals, or None."""
        ...

    def list_orders(
        self, token: str, tenant_id: uuid.UUID, *, limit: int, cursor: tuple[str, uuid.UUID] | None
    ) -> list[dict[str, Any]]:
        """Up to `limit + 1` rows (the caller trims), newest first, each merged with its ledger totals."""
        ...

    def events(
        self, token: str, tenant_id: uuid.UUID, order_id: uuid.UUID
    ) -> list[dict[str, Any]]: ...
    def snapshot(self, token: str, tenant_id: uuid.UUID, order_id: uuid.UUID) -> OrderState | None:
        """What the database recorded for the order: the input of the request builder."""
        ...


class PostgrestOrdersRepository:
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
            logger.error("orders data layer unreachable: %s", exc.__class__.__name__)
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
        if code == "SM232":
            detail = str(body.get("details") or "") if isinstance(body, dict) else ""
            reason = detail if detail in REASONS else "OTHER"
            logger.info("orders data layer refused: sqlstate=SM232 reason=%s", reason)
            return OrderRefusedError(code, reason)
        if code in SM_ERRORS:
            logger.info("orders data layer refused: sqlstate=%s", code)
            return SM_ERRORS[code](code)
        if code == "SM306":
            return MfaRequired(code)
        return classify_error(status, body)

    def _rows(self, path: str, token: str, params: dict[str, str]) -> list[dict[str, Any]]:
        rows = self._send("GET", path, token, params=params)
        if not isinstance(rows, list) or any(not isinstance(r, dict) for r in rows):
            raise UpstreamError("unexpected list shape")
        return rows

    def _one(self, path: str, token: str, params: dict[str, str]) -> dict[str, Any] | None:
        rows = self._rows(path, token, {**params, "limit": "1"})
        return rows[0] if rows else None

    def _rpc(self, token: str, function: str, args: dict[str, Any]) -> dict[str, Any]:
        result = self._send("POST", f"/rpc/{function}", token, json=args)
        if not isinstance(result, dict):
            raise UpstreamError("unexpected function result")
        return result

    # ------------------------------------------------------------------ writes (definer functions only)
    def create_order(self, token: str, order_id: uuid.UUID, quote_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc(
            token,
            "create_order_from_quote",
            {"p_order_id": str(order_id), "p_quote_id": str(quote_id)},
        )

    def record_event(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc(token, "record_order_event", args)

    def create_policy(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc(token, "create_order_policy_version", args)

    # ------------------------------------------------------------------ reads
    def _ledgers(
        self, token: str, tenant_id: uuid.UUID, ids: list[str]
    ) -> dict[str, dict[str, Any]]:
        if not ids:
            return {}
        rows = self._rows(
            "/order_ledger",
            token,
            {
                "select": LEDGER_COLUMNS,
                "tenant_id": f"eq.{tenant_id}",
                "order_id": f"in.({','.join(ids)})",
            },
        )
        return {str(r["order_id"]): r for r in rows}

    @staticmethod
    def _merge(order: dict[str, Any], ledger: dict[str, Any] | None) -> dict[str, Any]:
        base = ledger or {}
        return {
            **order,
            "paid_paise": base.get("paid_paise", 0),
            "refunded_paise": base.get("refunded_paise", 0),
            "net_paise": base.get("net_paise", 0),
            "balance_paise": base.get("balance_paise", order["order_total_paise"]),
            "event_count": base.get("event_count", 0),
            "lost_reason": base.get("lost_reason"),
        }

    def get_order(
        self, token: str, tenant_id: uuid.UUID, order_id: uuid.UUID
    ) -> dict[str, Any] | None:
        order = self._one(
            "/orders",
            token,
            {"select": ORDER_COLUMNS, "tenant_id": f"eq.{tenant_id}", "id": f"eq.{order_id}"},
        )
        if order is None:
            return None
        return self._merge(
            order, self._ledgers(token, tenant_id, [str(order["id"])]).get(str(order["id"]))
        )

    def list_orders(
        self, token: str, tenant_id: uuid.UUID, *, limit: int, cursor: tuple[str, uuid.UUID] | None
    ) -> list[dict[str, Any]]:
        params = {
            "select": ORDER_COLUMNS,
            "tenant_id": f"eq.{tenant_id}",
            "order": "created_at.desc,id.desc",
            "limit": str(limit + 1),
        }
        if cursor is not None:
            created_at, row_id = cursor  # validated by decode_cursor
            params["or"] = (
                f"(created_at.lt.{created_at},and(created_at.eq.{created_at},id.lt.{row_id}))"
            )
        rows = self._rows("/orders", token, params)
        ledgers = self._ledgers(token, tenant_id, [str(r["id"]) for r in rows[:limit]])
        return [self._merge(r, ledgers.get(str(r["id"]))) for r in rows]

    def events(self, token: str, tenant_id: uuid.UUID, order_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rows(
            "/order_events",
            token,
            {
                "select": EVENT_COLUMNS,
                "tenant_id": f"eq.{tenant_id}",
                "order_id": f"eq.{order_id}",
                "order": "seq.asc",
                "limit": "1100",
            },
        )

    def snapshot(self, token: str, tenant_id: uuid.UUID, order_id: uuid.UUID) -> OrderState | None:
        order = self._one(
            "/orders",
            token,
            {
                "select": "state,order_total_paise,advance_paise,valid_until,policy_version_id",
                "tenant_id": f"eq.{tenant_id}",
                "id": f"eq.{order_id}",
            },
        )
        if order is None:
            return None
        policy = self._one(
            "/order_policy_versions", token,
            {"select": "advance_required,dispatch_requires_advance,cancel_allowed_until_state", "tenant_id": f"eq.{tenant_id}", "id": f"eq.{order['policy_version_id']}"},
        )  # fmt: skip
        if policy is None:
            raise UpstreamError("the order's policy is not readable")
        events = self._rows(
            "/order_events",
            token,
            {
                "select": "type,seq,amount_paise,ledger_id",
                "tenant_id": f"eq.{tenant_id}",
                "order_id": f"eq.{order_id}",
                "order": "seq.asc",
                "limit": "1100",
            },
        )
        return OrderState(
            state=str(order["state"]),
            order_total_paise=order["order_total_paise"],
            advance_paise=order["advance_paise"],
            valid_until=date.fromisoformat(str(order["valid_until"])),
            advance_required=policy["advance_required"],
            dispatch_requires_advance=policy["dispatch_requires_advance"],
            cancel_allowed_until_state=str(policy["cancel_allowed_until_state"]),
            payments=tuple(
                (str(e["ledger_id"]), e["amount_paise"])
                for e in events
                if e["type"] == "record_payment"
            ),
            refunds=tuple(
                (str(e["ledger_id"]), e["amount_paise"])
                for e in events
                if e["type"] == "record_refund"
            ),
        )
