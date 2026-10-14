"""API-facing models of dues, the receivables groundwork (job CN, ADR 0085, module `dues`). Invoices stay in the owner's accounting system: here they are ENTERED or IMPORTED per customer, payments are
recorded, and the statement says what each customer owes, how old it is and whether a new order passes the credit limit. Money is integer paise. Requests are closed."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StringConstraints

Paise = Annotated[StrictInt, Field(ge=1, le=100_000_000_000)]
InvoiceNo = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9][A-Za-z0-9/._ -]{0,39}$")]
Method = Literal["cash", "upi", "bank_transfer", "cheque", "card", "other"]
MAX_IMPORT_ROWS = 5000


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InvoiceIn(_Strict):
    company_id: uuid.UUID
    invoice_no: InvoiceNo
    invoice_date: date
    due_date: date
    amount_paise: Paise
    order_id: uuid.UUID | None = None


class InvoiceRowIn(_Strict):
    company_id: uuid.UUID
    invoice_no: InvoiceNo
    invoice_date: date
    due_date: date
    amount_paise: Paise


class InvoicesImportIn(_Strict):
    """An export from the owner's accounting system, already read into rows (at most 5,000). `batch_id` is the caller's: the same file sent again adds nothing."""

    batch_id: uuid.UUID
    rows: Annotated[list[InvoiceRowIn], Field(min_length=1, max_length=MAX_IMPORT_ROWS)]


class SkippedRowOut(_Strict):
    row: int
    reason: Literal["customer_not_found", "invoice_number_used", "invalid_row"]


class InvoicesImportOut(_Strict):
    batch_id: uuid.UUID
    added: int
    skipped: list[SkippedRowOut]


class RecordedOut(_Strict):
    id: uuid.UUID
    replayed: bool


class VoidedOut(_Strict):
    id: uuid.UUID
    voided: bool


class PaymentIn(_Strict):
    company_id: uuid.UUID
    received_on: date
    amount_paise: Paise
    method: Method
    invoice_id: uuid.UUID | None = None


class AgeingOut(_Strict):
    """What is still open, by how old the invoice is (days since the invoice date)."""

    d0_30: int
    d31_60: int
    d61_90: int
    d90_plus: int


class OpenInvoiceOut(_Strict):
    invoice_id: uuid.UUID
    invoice_no: str
    invoice_date: date
    due_date: date
    amount_paise: int
    open_paise: int
    age_days: int
    overdue_days: int


class StatementOut(_Strict):
    company_id: uuid.UUID
    as_of: date
    invoiced_paise: int
    paid_paise: int
    # never negative; payments go to the OLDEST invoice first
    outstanding_paise: int
    # what the customer has paid beyond what was invoiced (an advance)
    credit_paise: int
    overdue_paise: int
    ageing: AgeingOut
    open_invoices: list[OpenInvoiceOut]
    credit_limit_paise: int | None
    over_limit: bool


class SummaryRowOut(StatementOut):
    company_name: str


class SummaryOut(_Strict):
    items: list[SummaryRowOut]
    next_cursor: str | None


class CreditLimitIn(_Strict):
    """The customer's credit limit in paise, or `null` to remove it. The Owner's, with a second factor."""

    limit_paise: Annotated[StrictInt, Field(ge=0, le=100_000_000_000)] | None


class CreditLimitOut(_Strict):
    company_id: uuid.UUID
    limit_paise: int | None


class CreditCheckIn(_Strict):
    amount_paise: Annotated[StrictInt, Field(ge=0, le=100_000_000_000)]


class CreditCheckOut(_Strict):
    """A WARNING before a new order, never a block."""

    company_id: uuid.UUID
    credit_limit_paise: int | None
    outstanding_paise: int
    new_amount_paise: int
    would_be_paise: int
    has_limit: bool
    exceeded: bool


class LedgerInvoiceOut(_Strict):
    id: uuid.UUID
    invoice_no: str
    invoice_date: date
    due_date: date
    amount_paise: int
    order_id: uuid.UUID | None
    source: Literal["manual", "import"]
    voided: bool


class LedgerPaymentOut(_Strict):
    id: uuid.UUID
    received_on: date
    amount_paise: int
    method: Method
    invoice_id: uuid.UUID | None
    voided: bool


class LedgerOut(_Strict):
    invoices: list[LedgerInvoiceOut]
    payments: list[LedgerPaymentOut]
