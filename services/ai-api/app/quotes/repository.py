"""Quote data access behind an interface (Supabase PostgREST today). Same discipline as the CRM and enquiries adapters: every call carries the CALLER's JWT and the
public anon key, so RLS decides what is visible (Owner, Admin and Sales read prices, picks and quotes; a Viewer reads none); failures are classified by SQLSTATE only and
data-layer text is never returned, logged or chained into an exception.

Quotes, lines and picks have no client write grant: every write is a SECURITY DEFINER function (pick / create draft / approve / reject / withdraw)."""

from __future__ import annotations

import logging
import uuid
from datetime import date
from typing import Any, Protocol

import httpx

from app.crm.repository import classify_error
from app.quotes.errors import SM_ERRORS
from app.tenancy.repository import MfaRequired, UpstreamError

logger = logging.getLogger("app.quotes.repository")

# the request and result TEXTS are read only by the one method that needs them (the approval and the customer text), never by a listing
QUOTE_COLUMNS = (
    "id,quote_no,requirement_id,enquiry_id,lead_id,status,pricing_kind,price_list_version_id,policy_version_id,engine_version,canonical_hash,customer_kind,delivery_state,gst_supply,"
    "as_of,valid_until,due_date,merchandise_net_paise,item_tax_paise,shipping_net_paise,shipping_tax_paise,total_paise,advance_paise,balance_paise,engine_flags,review_flags,"
    "needs_owner_approval,created_by,created_at,approved_by,approved_at,rejected_by,rejected_at,reject_code,withdrawn_by,withdrawn_at,withdraw_code"
)
SUMMARY_COLUMNS = "id,quote_no,enquiry_id,status,pricing_kind,customer_kind,valid_until,total_paise,needs_owner_approval,created_at,withdrawn_at,lead:leads(company:companies(name,city))"
LINE_COLUMNS = "line_no,requirement_line_no,product_id,sku,name,sale_unit,qty,unit_price_applied_paise,price_break_min_qty,line_subtotal_paise,net_paise,tax_paise,gross_paise,tax_bps,price_source,item_type_code"
ITEM_COLUMNS = "product_id,sku,name,sale_unit,unit_price_paise,minimum_order_quantity,tax_bps,breaks:price_list_breaks(min_qty,unit_price_paise)"
POLICY_COLUMNS = (
    "id,version_no,effective_from,discount_ceiling_bps,shipping_flat_fee_paise,shipping_free_above_paise,shipping_tax_bps,validity_days,new_advance_bps,repeat_advance_bps,"
    "new_net_days,repeat_net_days,gst_rate_bps,gst_effective_from,tax_mode,rounding_mode,repeat_credit_limit_paise,seller_state,required_inputs"
)
ITEM_TYPE_COLUMNS = "id,code,name,position,active,min_price_paise,max_price_paise"
_STATES = {**SM_ERRORS}


class QuotesRepository(Protocol):
    def active_price_version(
        self, token: str, tenant_id: uuid.UUID, on: date
    ) -> dict[str, Any] | None: ...
    def price_items(
        self, token: str, tenant_id: uuid.UUID, version_id: uuid.UUID
    ) -> list[dict[str, Any]]: ...
    def active_policy(
        self, token: str, tenant_id: uuid.UUID, on: date
    ) -> dict[str, Any] | None: ...
    def policy(
        self, token: str, tenant_id: uuid.UUID, version_id: uuid.UUID
    ) -> dict[str, Any] | None: ...
    def list_policies(
        self, token: str, tenant_id: uuid.UUID, limit: int
    ) -> list[dict[str, Any]]: ...
    def create_policy(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def list_item_types(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def save_item_type(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def active_mapper_config(
        self, token: str, tenant_id: uuid.UUID, on: date
    ) -> dict[str, Any] | None: ...
    def products(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def picks(
        self, token: str, tenant_id: uuid.UUID, requirement_id: uuid.UUID
    ) -> list[dict[str, Any]]: ...
    def company_name(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> str | None: ...
    def list_quotes(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        enquiry_id: uuid.UUID | None,
        limit: int,
    ) -> list[dict[str, Any]]: ...
    def get_quote(
        self, token: str, tenant_id: uuid.UUID, quote_id: uuid.UUID
    ) -> tuple[dict[str, Any], list[dict[str, Any]]] | None: ...
    def get_quote_texts(
        self, token: str, tenant_id: uuid.UUID, quote_id: uuid.UUID
    ) -> dict[str, Any] | None:
        """The stored row's request_text, result_text, canonical_hash, status, approved_hash: what an approval and the customer text are recomputed from."""
        ...

    def pick(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def create_draft(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def create_manual_draft(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def approve(self, token: str, quote_id: uuid.UUID, recomputed_hash: str) -> dict[str, Any]: ...
    def reject(self, token: str, quote_id: uuid.UUID, code: str) -> dict[str, Any]: ...
    def withdraw(self, token: str, quote_id: uuid.UUID, code: str) -> dict[str, Any]: ...


class PostgrestQuotesRepository:
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
            logger.error("quotes data layer unreachable: %s", exc.__class__.__name__)
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
        if code in _STATES:
            logger.info("quotes data layer refused: sqlstate=%s", code)
            return _STATES[code](code)
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

    # ------------------------------------------------------------------ reference data (the versions active on a date)
    def active_price_version(
        self, token: str, tenant_id: uuid.UUID, on: date
    ) -> dict[str, Any] | None:
        return self._one(
            "/price_list_versions",
            token,
            {
                "select": "id,version_no,effective_from",
                "tenant_id": f"eq.{tenant_id}",
                "effective_from": f"lte.{on.isoformat()}",
                "order": "effective_from.desc,version_no.desc",
            },
        )

    def price_items(
        self, token: str, tenant_id: uuid.UUID, version_id: uuid.UUID
    ) -> list[dict[str, Any]]:
        return self._rows(
            "/price_list_items",
            token,
            {
                "select": ITEM_COLUMNS,
                "tenant_id": f"eq.{tenant_id}",
                "version_id": f"eq.{version_id}",
                "order": "sku.asc",
                "limit": "1000",
            },
        )

    def active_policy(self, token: str, tenant_id: uuid.UUID, on: date) -> dict[str, Any] | None:
        return self._one(
            "/quote_policy_versions",
            token,
            {
                "select": POLICY_COLUMNS,
                "tenant_id": f"eq.{tenant_id}",
                "effective_from": f"lte.{on.isoformat()}",
                "order": "effective_from.desc,version_no.desc",
            },
        )

    def policy(
        self, token: str, tenant_id: uuid.UUID, version_id: uuid.UUID
    ) -> dict[str, Any] | None:
        return self._one(
            "/quote_policy_versions",
            token,
            {"select": POLICY_COLUMNS, "tenant_id": f"eq.{tenant_id}", "id": f"eq.{version_id}"},
        )

    def list_policies(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        """Every published version, newest first (the order of the rule that picks the one in force)."""
        return self._rows(
            "/quote_policy_versions",
            token,
            {
                "select": POLICY_COLUMNS + ",created_at",
                "tenant_id": f"eq.{tenant_id}",
                "order": "effective_from.desc,version_no.desc",
                "limit": str(limit),
            },
        )

    def create_policy(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc(token, "create_quote_policy_version", args)

    def list_item_types(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        """The workspace's item types in display order (the table is small: one page)."""
        return self._rows(
            "/item_types",
            token,
            {
                "select": ITEM_TYPE_COLUMNS,
                "tenant_id": f"eq.{tenant_id}",
                "order": "position.asc,code.asc",
                "limit": "500",
            },
        )

    def save_item_type(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc(token, "save_item_type", args)

    def active_mapper_config(
        self, token: str, tenant_id: uuid.UUID, on: date
    ) -> dict[str, Any] | None:
        return self._one(
            "/mapper_config_versions",
            token,
            {
                "select": "id,default_sale_unit,config",
                "tenant_id": f"eq.{tenant_id}",
                "effective_from": f"lte.{on.isoformat()}",
                "order": "effective_from.desc,version_no.desc",
            },
        )

    def products(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rows(
            "/products",
            token,
            {
                "select": "id,sku,category,attributes,active",
                "tenant_id": f"eq.{tenant_id}",
                "archived_at": "is.null",
                "order": "sku.asc",
                "limit": "1000",
            },
        )

    def picks(
        self, token: str, tenant_id: uuid.UUID, requirement_id: uuid.UUID
    ) -> list[dict[str, Any]]:
        return self._rows(
            "/requirement_line_picks",
            token,
            {
                "select": "line_no,product_id,qty,sale_unit,source",
                "tenant_id": f"eq.{tenant_id}",
                "requirement_id": f"eq.{requirement_id}",
                "order": "line_no.asc",
                "limit": "5",
            },
        )

    def company_name(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> str | None:
        lead = self._one(
            "/leads",
            token,
            {"select": "company_id", "tenant_id": f"eq.{tenant_id}", "id": f"eq.{lead_id}"},
        )
        if lead is None or lead.get("company_id") is None:
            return None
        company = self._one(
            "/companies",
            token,
            {"select": "name", "tenant_id": f"eq.{tenant_id}", "id": f"eq.{lead['company_id']}"},
        )
        return str(company["name"]) if company and company.get("name") else None

    # ------------------------------------------------------------------ quotes
    def list_quotes(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        enquiry_id: uuid.UUID | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        params = {
            "select": SUMMARY_COLUMNS,
            "tenant_id": f"eq.{tenant_id}",
            "order": "created_at.desc,id.desc",
            "limit": str(limit),
        }
        if enquiry_id is not None:
            params["enquiry_id"] = f"eq.{enquiry_id}"
        return self._rows("/quotes", token, params)

    def get_quote(
        self, token: str, tenant_id: uuid.UUID, quote_id: uuid.UUID
    ) -> tuple[dict[str, Any], list[dict[str, Any]]] | None:
        row = self._one(
            "/quotes",
            token,
            {"select": QUOTE_COLUMNS, "tenant_id": f"eq.{tenant_id}", "id": f"eq.{quote_id}"},
        )
        if row is None:
            return None
        lines = self._rows(
            "/quote_lines",
            token,
            {
                "select": LINE_COLUMNS,
                "tenant_id": f"eq.{tenant_id}",
                "quote_id": f"eq.{quote_id}",
                "order": "line_no.asc",
                "limit": "5",
            },
        )
        return row, lines

    def get_quote_texts(
        self, token: str, tenant_id: uuid.UUID, quote_id: uuid.UUID
    ) -> dict[str, Any] | None:
        return self._one(
            "/quotes",
            token,
            {
                "select": "id,status,canonical_hash,approved_hash,request_text,result_text,engine_version",
                "tenant_id": f"eq.{tenant_id}",
                "id": f"eq.{quote_id}",
            },
        )

    # ------------------------------------------------------------------ writes: the definer functions only
    def pick(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc(token, "pick_requirement_line_product", args)

    def create_draft(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc(token, "create_quote_draft", args)

    def create_manual_draft(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc(token, "create_manual_quote_draft", args)

    def approve(self, token: str, quote_id: uuid.UUID, recomputed_hash: str) -> dict[str, Any]:
        return self._rpc(
            token,
            "approve_quote",
            {"p_quote_id": str(quote_id), "p_recomputed_hash": recomputed_hash},
        )

    def reject(self, token: str, quote_id: uuid.UUID, code: str) -> dict[str, Any]:
        return self._rpc(token, "reject_quote", {"p_quote_id": str(quote_id), "p_code": code})

    def withdraw(self, token: str, quote_id: uuid.UUID, code: str) -> dict[str, Any]:
        return self._rpc(
            token, "withdraw_approved_quote", {"p_quote_id": str(quote_id), "p_code": code}
        )
