"""API-facing models of dues, the receivables ledger (job CN, ADR 0085; generalised by job CP, ADR 0086; module `dues`). Invoices stay in the owner's accounting system: here they are ENTERED or IMPORTED per
customer, payments are recorded (each with a RECEIPT NUMBER), and the statement says what each party owes, how old it is and whether a new order passes the credit limit. The same ledger holds a construction
customer's dues and, for education (job CR), a guardian's fees: a party is a company or a contact, and an entry is a charge, a payment, an adjustment or a concession. Money is integer paise and comes only from
entries and imports a person made. Requests are closed."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StrictInt, StringConstraints, model_validator

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
    # a payment has the business's next receipt number (R/2026-27/000001); an invoice has none
    receipt_no: str | None = None


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


class OverdueAgeingOut(_Strict):
    """What is still open, by how many days it is past its DUE date (`not_due` is not yet due)."""

    not_due: int
    d1_30: int
    d31_60: int
    d61_90: int
    d90_plus: int


class OpenInvoiceOut(_Strict):
    invoice_id: uuid.UUID
    entry_id: uuid.UUID | None = None
    kind: Literal["charge", "adjustment"] | None = None
    invoice_no: str | None = None
    reference: str | None = None
    invoice_date: date
    due_date: date
    amount_paise: int
    open_paise: int
    age_days: int
    overdue_days: int


class StatementOut(_Strict):
    # the party: a company or a contact (a party that has no entry yet has no account)
    account_id: uuid.UUID | None = None
    company_id: uuid.UUID | None = None
    contact_id: uuid.UUID | None = None
    as_of: date
    # every claim (charges and debit adjustments) and every credit (payments, concessions, credit adjustments)
    invoiced_paise: int
    paid_paise: int
    payments_paise: int = 0
    concessions_paise: int = 0
    adjustments_paise: int = 0
    # never negative; payments go to the OLDEST invoice first
    outstanding_paise: int
    # what the customer has paid beyond what was invoiced (an advance)
    credit_paise: int
    overdue_paise: int
    ageing: AgeingOut
    overdue_ageing: OverdueAgeingOut | None = None
    open_invoices: list[OpenInvoiceOut]
    credit_limit_paise: int | None
    over_limit: bool


class SummaryRowOut(StatementOut):
    company_name: str | None = None
    party_kind: Literal["company", "contact"] | None = None
    party_name: str | None = None


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
    invoice_no: str | None
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
    receipt_no: str | None = None
    voided: bool


class LedgerOut(_Strict):
    invoices: list[LedgerInvoiceOut]
    payments: list[LedgerPaymentOut]


# ----------------------------------------------------------------------------------------------------------------------------------------------------------------
# the shared ledger (job CP): charge, payment, adjustment, concession for a company OR a contact
# ----------------------------------------------------------------------------------------------------------------------------------------------------------------
Reference = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9][A-Za-z0-9/._ -]{0,39}$")]
ReasonCode = Literal["correction", "late_fee", "waiver", "rounding", "scholarship", "sibling", "staff_ward", "hardship", "merit", "other"]
EntryKind = Literal["charge", "payment", "adjustment", "concession"]


def _one_party(company_id: uuid.UUID | None, contact_id: uuid.UUID | None) -> None:
    if (company_id is None) == (contact_id is None):
        raise ValueError("name exactly one party: a company or a contact")


class EntryIn(_Strict):
    """One entry. A CHARGE has a due date (and may carry the owner's invoice number or a short label such as a fee head); a PAYMENT names its method; an ADJUSTMENT says debit or credit and why; a CONCESSION says
    why. Adjustments and concessions are the Owner's or Admin's, with a second factor (the database decides). The amount is a number someone entered."""

    kind: EntryKind
    company_id: uuid.UUID | None = None
    contact_id: uuid.UUID | None = None
    entry_date: date
    amount_paise: Paise
    due_date: date | None = None
    direction: Literal["debit", "credit"] | None = None
    invoice_no: InvoiceNo | None = None
    reference: Reference | None = None
    method: Method | None = None
    reason_code: ReasonCode | None = None
    against_entry_id: uuid.UUID | None = None
    order_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _shape(self) -> EntryIn:
        _one_party(self.company_id, self.contact_id)
        if self.kind == "charge" and self.due_date is None:
            raise ValueError("a charge needs a due date")
        if self.kind == "payment" and (self.method is None or self.due_date is not None):
            raise ValueError("a payment names its method and has no due date")
        if self.kind == "adjustment" and (self.direction is None or self.reason_code is None):
            raise ValueError("an adjustment says debit or credit, and why")
        if self.kind == "adjustment" and (self.direction == "debit") != (self.due_date is not None):
            raise ValueError("a debit adjustment has a due date; a credit one has none")
        if self.kind == "concession" and (self.reason_code is None or self.due_date is not None):
            raise ValueError("a concession says why and has no due date")
        if self.invoice_no is not None and self.kind != "charge":
            raise ValueError("only a charge has an invoice number")
        return self


class EntryRecordedOut(_Strict):
    id: uuid.UUID
    account_id: uuid.UUID
    receipt_no: str | None
    replayed: bool


class ChargeRowIn(_Strict):
    company_id: uuid.UUID | None = None
    contact_id: uuid.UUID | None = None
    entry_date: date
    due_date: date
    amount_paise: Paise
    invoice_no: InvoiceNo | None = None
    reference: Reference | None = None

    @model_validator(mode="after")
    def _shape(self) -> ChargeRowIn:
        _one_party(self.company_id, self.contact_id)
        return self


class ChargesImportIn(_Strict):
    """A fee list or an accounting export, already read into rows (at most 5,000). `batch_id` is the caller's: the same file sent again adds nothing."""

    batch_id: uuid.UUID
    rows: Annotated[list[ChargeRowIn], Field(min_length=1, max_length=MAX_IMPORT_ROWS)]


class ChargeSkippedRowOut(_Strict):
    row: int
    reason: Literal["invoice_number_used", "party_not_found", "invalid_row"]


class ChargesImportOut(_Strict):
    batch_id: uuid.UUID
    added: int
    skipped: list[ChargeSkippedRowOut]


class EntryOut(_Strict):
    id: uuid.UUID
    kind: EntryKind
    direction: Literal["debit", "credit"]
    amount_paise: int
    entry_date: date
    due_date: date | None
    invoice_no: str | None
    reference: str | None
    method: Method | None
    reason_code: ReasonCode | None
    receipt_no: str | None
    against_entry_id: uuid.UUID | None
    order_id: uuid.UUID | None
    source: Literal["manual", "import"]
    voided: bool


class EntriesOut(_Strict):
    account_id: uuid.UUID | None
    entries: list[EntryOut]


class EntryVoidedOut(_Strict):
    entry_id: uuid.UUID
    kind: EntryKind
    voided: bool


class ReceiptOut(_Strict):
    """A receipt, ready to print or to send: the number, the date, the amount, the method, who paid, what it was set against and the balance after it."""

    receipt_no: str
    received_on: date
    amount_paise: int
    method: Method
    voided: bool
    business_name: str
    party_name: str | None
    party_kind: Literal["company", "contact"]
    against: str | None
    balance_after_paise: int
    recorded_at: datetime
