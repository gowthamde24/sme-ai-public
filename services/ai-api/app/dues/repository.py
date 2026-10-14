"""Dues behind an interface (Supabase PostgREST today). Every call carries the CALLER's token; every function is a SECURITY DEFINER function of migration 20261123090300 that proves the role first
(Owner, Admin and Sales read and record; Owner and Admin void; the Owner with a second factor sets a credit limit; a Viewer reads no money)."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any, Protocol

import httpx

from app.dues.errors import AlreadyVoidedError, InvoiceNumberUsedError
from app.packs.errors import ModuleOffError
from app.rpc_base import RpcClient


class DuesRepository(Protocol):
    def invoice_record(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def invoices_import(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, rows: list[dict[str, Any]]) -> dict[str, Any]: ...
    def invoice_void(self, token: str, tenant_id: uuid.UUID, invoice_id: uuid.UUID) -> dict[str, Any]: ...
    def payment_record(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def payment_void(self, token: str, tenant_id: uuid.UUID, payment_id: uuid.UUID) -> dict[str, Any]: ...
    def credit_limit_set(self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID, limit_paise: int | None) -> dict[str, Any]: ...
    def statement(self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID, as_of: date | None) -> dict[str, Any]: ...
    def summary(self, token: str, tenant_id: uuid.UUID, as_of: date | None, limit: int, after: tuple[int, uuid.UUID] | None) -> list[dict[str, Any]]: ...
    def credit_check(self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID, amount_paise: int) -> dict[str, Any]: ...
    def ledger(self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID, limit: int) -> dict[str, Any]: ...

    # the shared ledger (job CP): a company OR a contact
    def entry_record(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def entry_void(self, token: str, tenant_id: uuid.UUID, entry_id: uuid.UUID) -> dict[str, Any]: ...
    def charges_import(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, rows: list[dict[str, Any]]) -> dict[str, Any]: ...
    def party_statement(self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID | None, contact_id: uuid.UUID | None, as_of: date | None) -> dict[str, Any]: ...
    def party_summary(self, token: str, tenant_id: uuid.UUID, as_of: date | None, limit: int, after: tuple[int, uuid.UUID] | None, party: str | None) -> list[dict[str, Any]]: ...
    def entries(self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID | None, contact_id: uuid.UUID | None, limit: int) -> dict[str, Any]: ...
    def receipt(self, token: str, tenant_id: uuid.UUID, entry_id: uuid.UUID) -> dict[str, Any]: ...


class PostgrestDuesRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(rest_url, anon_key, {"SM701": ModuleOffError, "SM781": InvoiceNumberUsedError, "SM782": AlreadyVoidedError}, client=client)

    def close(self) -> None:
        self._rpc.close()

    def invoice_record(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "invoice_record", args)

    def invoices_import(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, rows: list[dict[str, Any]]) -> dict[str, Any]:
        return self._rpc.object(token, "invoices_import", {"p_tenant_id": str(tenant_id), "p_batch_id": str(batch_id), "p_rows": rows})

    def invoice_void(self, token: str, tenant_id: uuid.UUID, invoice_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "invoice_void", {"p_tenant_id": str(tenant_id), "p_invoice_id": str(invoice_id)})

    def payment_record(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "payment_record", args)

    def payment_void(self, token: str, tenant_id: uuid.UUID, payment_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "payment_void", {"p_tenant_id": str(tenant_id), "p_payment_id": str(payment_id)})

    def credit_limit_set(self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID, limit_paise: int | None) -> dict[str, Any]:
        return self._rpc.object(token, "credit_limit_set", {"p_tenant_id": str(tenant_id), "p_company_id": str(company_id), "p_limit_paise": limit_paise})

    def statement(self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID, as_of: date | None) -> dict[str, Any]:
        return self._rpc.object(token, "dues_statement", {"p_tenant_id": str(tenant_id), "p_company_id": str(company_id), "p_as_of": as_of.isoformat() if as_of else None})

    def summary(self, token: str, tenant_id: uuid.UUID, as_of: date | None, limit: int, after: tuple[int, uuid.UUID] | None) -> list[dict[str, Any]]:
        return self._rpc.array(
            token,
            "dues_summary",
            {
                "p_tenant_id": str(tenant_id),
                "p_as_of": as_of.isoformat() if as_of else None,
                "p_limit": limit,
                "p_after_paise": after[0] if after else None,
                "p_after_id": str(after[1]) if after else None,
            },
        )

    def credit_check(self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID, amount_paise: int) -> dict[str, Any]:
        return self._rpc.object(token, "credit_check", {"p_tenant_id": str(tenant_id), "p_company_id": str(company_id), "p_new_amount_paise": amount_paise})

    def ledger(self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID, limit: int) -> dict[str, Any]:
        return self._rpc.object(token, "dues_ledger", {"p_tenant_id": str(tenant_id), "p_company_id": str(company_id), "p_limit": limit})

    # ------------------------------------------------------------------ the shared ledger (job CP)
    def entry_record(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "ledger_entry_record", args)

    def entry_void(self, token: str, tenant_id: uuid.UUID, entry_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "ledger_entry_void", {"p_tenant_id": str(tenant_id), "p_entry_id": str(entry_id)})

    def charges_import(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, rows: list[dict[str, Any]]) -> dict[str, Any]:
        return self._rpc.object(token, "ledger_charges_import", {"p_tenant_id": str(tenant_id), "p_batch_id": str(batch_id), "p_rows": rows})

    def party_statement(self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID | None, contact_id: uuid.UUID | None, as_of: date | None) -> dict[str, Any]:
        return self._rpc.object(
            token,
            "ledger_statement",
            {"p_tenant_id": str(tenant_id), "p_company_id": str(company_id) if company_id else None, "p_contact_id": str(contact_id) if contact_id else None, "p_as_of": as_of.isoformat() if as_of else None},
        )

    def party_summary(self, token: str, tenant_id: uuid.UUID, as_of: date | None, limit: int, after: tuple[int, uuid.UUID] | None, party: str | None) -> list[dict[str, Any]]:
        return self._rpc.array(
            token,
            "ledger_summary",
            {
                "p_tenant_id": str(tenant_id),
                "p_as_of": as_of.isoformat() if as_of else None,
                "p_limit": limit,
                "p_after_paise": after[0] if after else None,
                "p_after_id": str(after[1]) if after else None,
                "p_party": party,
            },
        )

    def entries(self, token: str, tenant_id: uuid.UUID, company_id: uuid.UUID | None, contact_id: uuid.UUID | None, limit: int) -> dict[str, Any]:
        return self._rpc.object(
            token,
            "ledger_entries_list",
            {"p_tenant_id": str(tenant_id), "p_company_id": str(company_id) if company_id else None, "p_contact_id": str(contact_id) if contact_id else None, "p_limit": limit},
        )

    def receipt(self, token: str, tenant_id: uuid.UUID, entry_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "ledger_receipt_get", {"p_tenant_id": str(tenant_id), "p_entry_id": str(entry_id)})
