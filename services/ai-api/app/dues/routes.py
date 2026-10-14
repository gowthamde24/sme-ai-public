"""Dues (receivables) under /v1/tenants/{tenant_id}/dues (job CN, ADR 0085; module `dues`). Invoices stay in the owner's accounting system; here they are entered or imported, payments are recorded, and the
statement says what is owed, how old it is, what is overdue and whether a new order passes the credit limit.

  GET    /dues?as_of=&after=&limit                             Owner, Admin, Sales: every customer with something open, the largest first (a Viewer reads no money).
  GET    /dues/customers/{company_id}?as_of=                   the statement of one customer: invoiced, paid, owed, credit, the age buckets (0-30, 31-60, 61-90, 90+ days), what is overdue.
  GET    /dues/customers/{company_id}/ledger                   its invoices and payments, newest first (voided ones marked).
  PUT    /dues/invoices/{id}                                   Owner, Admin, Sales: enter an invoice (the id is the caller's: a retry is safe; 409 `invoice_number_used`).
  POST   /dues/invoices/import                                 Owner, Admin, Sales: up to 5,000 invoice rows from an accounting export, run in parts of 500; a row that cannot be added is reported, never fatal.
  POST   /dues/invoices/{id}/void                              Owner, Admin.
  PUT    /dues/payments/{id}                                   Owner, Admin, Sales: record a payment (an advance is allowed).
  POST   /dues/payments/{id}/void                              Owner, Admin.
  PUT    /dues/customers/{company_id}/credit-limit             Owner with a second factor: set the limit, or `null` to remove it.
  POST   /dues/customers/{company_id}/credit-check             a WARNING before a new order: would this amount take the customer over the limit.

Payments go to the OLDEST invoice first; a customer who has paid more than was invoiced shows a credit and owes nothing.

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

import base64
import uuid
from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.dues.models import (
    AgeingOut,
    CreditCheckIn,
    CreditCheckOut,
    CreditLimitIn,
    CreditLimitOut,
    InvoiceIn,
    InvoicesImportIn,
    InvoicesImportOut,
    LedgerOut,
    OpenInvoiceOut,
    PaymentIn,
    RecordedOut,
    SkippedRowOut,
    StatementOut,
    SummaryOut,
    SummaryRowOut,
    VoidedOut,
)
from app.dues.repository import DuesRepository
from app.errors import ApiError, not_found
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/dues", tags=["dues"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Reader = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
Limit = Annotated[int, Query(ge=1, le=100)]
PART = 500


def _repo(runtime: Runtime) -> DuesRepository:
    if runtime.dues is None:
        raise ApiError(503, "dues_unavailable", "Dues are not available right now.")
    return runtime.dues


def _row_id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _statement(row: dict[str, Any]) -> dict[str, Any]:
    return {**row, "ageing": AgeingOut.model_validate(row["ageing"]), "open_invoices": [OpenInvoiceOut.model_validate(x) for x in row.get("open_invoices") or []]}


def encode_cursor(paise: int, company_id: uuid.UUID) -> str:
    return base64.urlsafe_b64encode(f"{paise}|{company_id}".encode()).decode().rstrip("=")


def decode_cursor(raw: str | None) -> tuple[int, uuid.UUID] | None:
    if raw is None:
        return None
    try:
        text = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode()
        paise, company = text.split("|", 1)
        return int(paise), uuid.UUID(company)
    except (ValueError, UnicodeDecodeError):
        raise ApiError(422, "validation_error", "Invalid input.") from None


@router.get("", response_model=SummaryOut)
def summary(ctx: Reader, runtime: RuntimeDep, as_of: date | None = None, after: str | None = None, limit: Limit = 50) -> SummaryOut:
    rows = _repo(runtime).summary(ctx.principal.token, ctx.tenant.id, as_of, limit, decode_cursor(after))
    items = [SummaryRowOut(**_statement(r)) for r in rows]
    cursor = encode_cursor(items[-1].outstanding_paise, items[-1].company_id) if len(items) >= limit else None
    return SummaryOut(items=items, next_cursor=cursor)


@router.get("/customers/{company_id}", response_model=StatementOut)
def statement(company_id: str, ctx: Reader, runtime: RuntimeDep, as_of: date | None = None) -> StatementOut:
    return StatementOut(**_statement(_repo(runtime).statement(ctx.principal.token, ctx.tenant.id, _row_id(company_id), as_of)))


@router.get("/customers/{company_id}/ledger", response_model=LedgerOut)
def ledger(company_id: str, ctx: Reader, runtime: RuntimeDep, limit: Annotated[int, Query(ge=1, le=500)] = 100) -> LedgerOut:
    return LedgerOut.model_validate(_repo(runtime).ledger(ctx.principal.token, ctx.tenant.id, _row_id(company_id), limit))


@router.put("/invoices/{invoice_id}", response_model=RecordedOut)
def put_invoice(invoice_id: str, body: InvoiceIn, ctx: Reader, runtime: RuntimeDep) -> RecordedOut:
    iid = _row_id(invoice_id)
    row = _repo(runtime).invoice_record(
        ctx.principal.token,
        {
            "p_invoice_id": str(iid),
            "p_tenant_id": str(ctx.tenant.id),
            "p_company_id": str(body.company_id),
            "p_invoice_no": body.invoice_no,
            "p_invoice_date": body.invoice_date.isoformat(),
            "p_due_date": body.due_date.isoformat(),
            "p_amount_paise": body.amount_paise,
            "p_order_id": str(body.order_id) if body.order_id else None,
            "p_source": "manual",
        },
    )
    return RecordedOut(id=iid, replayed=row.get("replayed") is True)


@router.post("/invoices/import", response_model=InvoicesImportOut)
def import_invoices(body: InvoicesImportIn, ctx: Reader, runtime: RuntimeDep) -> InvoicesImportOut:
    """Up to 5,000 rows, run in parts of 500 (each part has an id derived from the batch id, so a retry of the whole file adds nothing). The row numbers in `skipped` are the file's (1 = the first row)."""
    repo = _repo(runtime)
    added = 0
    skipped: list[SkippedRowOut] = []
    rows = [r.model_dump(mode="json") for r in body.rows]
    for part, start in enumerate(range(0, len(rows), PART)):
        part_id = uuid.uuid5(body.batch_id, f"part-{part}")
        out = repo.invoices_import(ctx.principal.token, ctx.tenant.id, part_id, rows[start : start + PART])
        added += int(out.get("added") or 0)
        for s in out.get("skipped") or []:
            skipped.append(SkippedRowOut(row=start + int(s["row"]), reason=s["reason"]))
    return InvoicesImportOut(batch_id=body.batch_id, added=added, skipped=skipped)


@router.post("/invoices/{invoice_id}/void", response_model=VoidedOut)
def void_invoice(invoice_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> VoidedOut:
    iid = _row_id(invoice_id)
    _repo(runtime).invoice_void(ctx.principal.token, ctx.tenant.id, iid)
    return VoidedOut(id=iid, voided=True)


@router.put("/payments/{payment_id}", response_model=RecordedOut)
def put_payment(payment_id: str, body: PaymentIn, ctx: Reader, runtime: RuntimeDep) -> RecordedOut:
    pid = _row_id(payment_id)
    row = _repo(runtime).payment_record(
        ctx.principal.token,
        {
            "p_payment_id": str(pid),
            "p_tenant_id": str(ctx.tenant.id),
            "p_company_id": str(body.company_id),
            "p_received_on": body.received_on.isoformat(),
            "p_amount_paise": body.amount_paise,
            "p_method": body.method,
            "p_invoice_id": str(body.invoice_id) if body.invoice_id else None,
        },
    )
    return RecordedOut(id=pid, replayed=row.get("replayed") is True)


@router.post("/payments/{payment_id}/void", response_model=VoidedOut)
def void_payment(payment_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> VoidedOut:
    pid = _row_id(payment_id)
    _repo(runtime).payment_void(ctx.principal.token, ctx.tenant.id, pid)
    return VoidedOut(id=pid, voided=True)


@router.put("/customers/{company_id}/credit-limit", response_model=CreditLimitOut)
def put_credit_limit(company_id: str, body: CreditLimitIn, ctx: OwnerStrong, runtime: RuntimeDep) -> CreditLimitOut:
    cid = _row_id(company_id)
    row = _repo(runtime).credit_limit_set(ctx.principal.token, ctx.tenant.id, cid, body.limit_paise)
    return CreditLimitOut(company_id=cid, limit_paise=row.get("limit_paise"))


@router.post("/customers/{company_id}/credit-check", response_model=CreditCheckOut)
def credit_check(company_id: str, body: CreditCheckIn, ctx: Reader, runtime: RuntimeDep) -> CreditCheckOut:
    return CreditCheckOut.model_validate(_repo(runtime).credit_check(ctx.principal.token, ctx.tenant.id, _row_id(company_id), body.amount_paise))
