"""The shared receivables ledger under /v1/tenants/{tenant_id}/ledger (job CP, ADR 0086; module `dues`). One engine for a construction customer's dues and an education fee: a party is a company or a contact,
and an entry is a charge, a payment (with its receipt number), an adjustment or a concession. Amounts come only from entries and imports a person made; no model computes money.

  GET    /ledger/summary?party=&as_of=&after=&limit     Owner, Admin, Sales: every party with something open, the largest first (a Viewer reads no money).
  GET    /ledger/statement?company_id=|contact_id=&as_of=  the statement of ONE party: invoiced, paid, owed, credit, the age buckets (since the entry and past the due date), what is overdue, the open claims.
  GET    /ledger/entries?company_id=|contact_id=&limit=    its entries, newest first (voided ones marked).
  PUT    /ledger/entries/{id}                              record a charge, a payment, an adjustment or a concession (the id is the caller's: a retry is safe). Adjustments and concessions are the
                                                           Owner's or Admin's, with a second factor: the database decides.
  POST   /ledger/entries/{id}/void                         Owner, Admin.
  POST   /ledger/charges/import                            up to 5,000 claims (a fee list, an accounting export), in parts of 500; a row that cannot be added is reported, never fatal.
  GET    /ledger/receipts/{entry_id}                       a payment as a receipt: number, date, amount, method, who paid, what it was set against, the balance after.

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

import uuid
from datetime import date
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.dues.models import (
    ChargesImportIn,
    ChargesImportOut,
    ChargeSkippedRowOut,
    EntriesOut,
    EntryIn,
    EntryRecordedOut,
    EntryVoidedOut,
    ReceiptOut,
    StatementOut,
    SummaryOut,
    SummaryRowOut,
)
from app.dues.repository import DuesRepository
from app.dues.routes import PART, decode_cursor, encode_cursor
from app.dues.routes import _statement as statement_row
from app.errors import ApiError, not_found
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/ledger", tags=["ledger"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Reader = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
Limit = Annotated[int, Query(ge=1, le=100)]


def _repo(runtime: Runtime) -> DuesRepository:
    if runtime.dues is None:
        raise ApiError(503, "dues_unavailable", "Dues are not available right now.")
    return runtime.dues


def _row_id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _party(company_id: str | None, contact_id: str | None) -> tuple[uuid.UUID | None, uuid.UUID | None]:
    """Exactly one of the two, as the database also requires."""
    if (company_id is None) == (contact_id is None):
        raise ApiError(422, "validation_error", "Name exactly one party: a company or a contact.", extra={"fields": ["company_id", "contact_id"]})
    return (_row_id(company_id) if company_id else None, _row_id(contact_id) if contact_id else None)


@router.get("/summary", response_model=SummaryOut)
def summary(
    ctx: Reader,
    runtime: RuntimeDep,
    party: Literal["company", "contact"] | None = None,
    as_of: date | None = None,
    after: str | None = None,
    limit: Limit = 50,
) -> SummaryOut:
    rows = _repo(runtime).party_summary(ctx.principal.token, ctx.tenant.id, as_of, limit, decode_cursor(after), party)
    items = [SummaryRowOut(**statement_row(r)) for r in rows]
    last = items[-1] if items else None
    cursor = encode_cursor(last.outstanding_paise, last.account_id) if last is not None and last.account_id is not None and len(items) >= limit else None
    return SummaryOut(items=items, next_cursor=cursor)


@router.get("/statement", response_model=StatementOut)
def statement(ctx: Reader, runtime: RuntimeDep, company_id: str | None = None, contact_id: str | None = None, as_of: date | None = None) -> StatementOut:
    company, contact = _party(company_id, contact_id)
    return StatementOut(**statement_row(_repo(runtime).party_statement(ctx.principal.token, ctx.tenant.id, company, contact, as_of)))


@router.get("/entries", response_model=EntriesOut)
def entries(ctx: Reader, runtime: RuntimeDep, company_id: str | None = None, contact_id: str | None = None, limit: Annotated[int, Query(ge=1, le=500)] = 100) -> EntriesOut:
    company, contact = _party(company_id, contact_id)
    return EntriesOut.model_validate(_repo(runtime).entries(ctx.principal.token, ctx.tenant.id, company, contact, limit))


@router.put("/entries/{entry_id}", response_model=EntryRecordedOut)
def put_entry(entry_id: str, body: EntryIn, ctx: Reader, runtime: RuntimeDep) -> EntryRecordedOut:
    eid = _row_id(entry_id)
    row = _repo(runtime).entry_record(
        ctx.principal.token,
        {
            "p_entry_id": str(eid),
            "p_tenant_id": str(ctx.tenant.id),
            "p_kind": body.kind,
            "p_company_id": str(body.company_id) if body.company_id else None,
            "p_contact_id": str(body.contact_id) if body.contact_id else None,
            "p_entry_date": body.entry_date.isoformat(),
            "p_amount_paise": body.amount_paise,
            "p_due_date": body.due_date.isoformat() if body.due_date else None,
            "p_direction": body.direction,
            "p_invoice_no": body.invoice_no,
            "p_reference": body.reference,
            "p_method": body.method,
            "p_reason_code": body.reason_code,
            "p_against_entry_id": str(body.against_entry_id) if body.against_entry_id else None,
            "p_order_id": str(body.order_id) if body.order_id else None,
        },
    )
    return EntryRecordedOut(id=eid, account_id=row["account_id"], receipt_no=row.get("receipt_no"), replayed=row.get("replayed") is True)


@router.post("/entries/{entry_id}/void", response_model=EntryVoidedOut)
def void_entry(entry_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> EntryVoidedOut:
    eid = _row_id(entry_id)
    row = _repo(runtime).entry_void(ctx.principal.token, ctx.tenant.id, eid)
    return EntryVoidedOut(entry_id=eid, kind=row["kind"], voided=True)


@router.post("/charges/import", response_model=ChargesImportOut)
def import_charges(body: ChargesImportIn, ctx: Reader, runtime: RuntimeDep) -> ChargesImportOut:
    """Up to 5,000 rows, run in parts of 500 (each part has an id derived from the batch id, so a retry of the whole file adds nothing). The row numbers in `skipped` are the file's (1 = the first row)."""
    repo = _repo(runtime)
    added = 0
    skipped: list[ChargeSkippedRowOut] = []
    rows = [r.model_dump(mode="json", exclude_none=True) for r in body.rows]
    for part, start in enumerate(range(0, len(rows), PART)):
        part_id = uuid.uuid5(body.batch_id, f"ledger-part-{part}")
        out = repo.charges_import(ctx.principal.token, ctx.tenant.id, part_id, rows[start : start + PART])
        added += int(out.get("added") or 0)
        for s in out.get("skipped") or []:
            skipped.append(ChargeSkippedRowOut(row=start + int(s["row"]), reason=s["reason"]))
    return ChargesImportOut(batch_id=body.batch_id, added=added, skipped=skipped)


@router.get("/receipts/{entry_id}", response_model=ReceiptOut)
def receipt(entry_id: str, ctx: Reader, runtime: RuntimeDep) -> ReceiptOut:
    return ReceiptOut.model_validate(_repo(runtime).receipt(ctx.principal.token, ctx.tenant.id, _row_id(entry_id)))
