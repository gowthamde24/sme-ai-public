"""API-facing models of the education pack (job CR, ADR 0087; modules `programmes`, `fees`, `enquiries`, `reports`). Requests are closed: an unknown field is a 422.

CHILDREN'S DATA (ADR 0084 part 5). A student is the minimum: a first name or initials (`child_label`, at most 30 characters, no digits), the placement (programme and class/section/year/batch), an optional
admission number and the adult we write to. Never stored: date of birth, photograph, address, Aadhaar or any identity number, health, religion, caste, income, marks, attendance, behaviour; and there is NO free-text
note. A child is never a contact (no phone number, e-mail address or handle). The response models below are the only places a child's label leaves the system, to a signed-in Owner, Admin or Sales member; no
agent, assistant, log, metric, error message, search index or default export reads it. Money is integer paise and comes only from a fee plan or an entry a person made."""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictInt,
    StringConstraints,
    field_validator,
    model_validator,
)

from app.dues.models import AgeingOut, OpenInvoiceOut, OverdueAgeingOut

InstitutionType = Literal["school", "junior_college", "degree_college", "university", "coaching", "training"]
Language = Literal["en", "te", "hi", "kn", "ta"]
ProgrammeKind = Literal["class", "course"]
GroupKind = Literal["section", "year", "semester", "batch", "none"]
StudentStatus = Literal["active", "left"]
Stage = Literal["enquiry", "campus_visit", "application", "admitted", "lost"]
SettableStage = Literal["enquiry", "campus_visit", "application", "lost"]
Source = Literal["whatsapp", "walk_in", "website", "ad", "referral", "other"]
LostReason = Literal["fees", "distance", "other_school", "not_interested", "no_response", "other"]
Head = Literal["tuition", "admission", "transport", "hostel", "exam", "books", "other"]
LateFeeKind = Literal["none", "fixed", "per_day"]
Method = Literal["cash", "upi", "bank_transfer", "cheque", "card", "other"]
ConcessionReason = Literal["scholarship", "sibling", "staff_ward", "hardship", "merit", "other"]
AdjustmentReason = Literal["correction", "waiver", "rounding", "other"]
ReportCode = Literal["education.collection", "education.today", "education.pending", "education.funnel"]
Paise = Annotated[StrictInt, Field(ge=1, le=10_000_000_000)]
LinePaise = Annotated[StrictInt, Field(ge=1, le=100_000_000)]
Year = Annotated[str, StringConstraints(pattern=r"^20[0-9]{2}-[0-9]{2}$")]
Reference = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9][A-Za-z0-9/._ -]{0,39}$")]
Words = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Label30 = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=30)]
AdmissionNo = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^[A-Za-z0-9][A-Za-z0-9/._-]{0,29}$")]
MAX_ROWS = 5000
PART = 500
_NOT_A_NAME = re.compile(r"[0-9@]")


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# ------------------------------------------------------------------------------------------------------------------------------------------------------ profile
class TermIn(_Strict):
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
    start_month: Annotated[StrictInt, Field(ge=1, le=12)]
    end_month: Annotated[StrictInt, Field(ge=1, le=12)]


class ProfileIn(_Strict):
    """The institution: its type, the month its academic year starts, up to six terms, the languages parents use, and (optional, the Owner's, with a second factor) how many months after a student leaves their record
    is erased automatically (null = never automatically; the lawyer sets the number)."""

    institution_type: InstitutionType
    year_start_month: Annotated[StrictInt, Field(ge=1, le=12)]
    terms: Annotated[list[TermIn], Field(max_length=6)] = []
    parent_languages: Annotated[list[Language], Field(min_length=1, max_length=5)]
    student_retention_months: Annotated[StrictInt, Field(ge=1, le=120)] | None = None

    @field_validator("parent_languages")
    @classmethod
    def _unique(cls, v: list[str]) -> list[str]:
        if len(set(v)) != len(v):
            raise ValueError("each language once")
        return v


class TermOut(_Strict):
    label: str
    start_month: int
    end_month: int


class ProfileOut(_Strict):
    configured: bool
    institution_type: InstitutionType | None = None
    year_start_month: int | None = None
    terms: list[TermOut] = []
    parent_languages: list[Language] = []
    student_retention_months: int | None = None
    updated_at: datetime | None = None


# ------------------------------------------------------------------------------------------------------------------------------------------------------ programmes
class ProgrammeIn(_Strict):
    """A class set (Class 1 to 12) or a course (B.Com). `group_kind` says what it is divided into: sections (A, B), years, semesters, batches (with a timing) or `none`. The kind never changes."""

    name: Words
    kind: ProgrammeKind
    group_kind: GroupKind
    active: bool = True


class GroupIn(_Strict):
    label: Label30
    timing: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)] | None = None
    active: bool = True


class GroupOut(_Strict):
    id: uuid.UUID
    label: str
    timing: str | None
    active: bool
    students: int


class ProgrammeOut(_Strict):
    id: uuid.UUID
    name: str
    kind: ProgrammeKind
    group_kind: GroupKind
    active: bool
    students: int
    groups: list[GroupOut]


class ProgrammesOut(_Strict):
    items: list[ProgrammeOut]


class ProgrammeSavedOut(_Strict):
    id: uuid.UUID
    name: str
    kind: ProgrammeKind
    group_kind: GroupKind
    active: bool
    created: bool


class GroupSavedOut(_Strict):
    id: uuid.UUID
    programme_id: uuid.UUID
    label: str
    timing: str | None
    active: bool
    created: bool


# ------------------------------------------------------------------------------------------------------------------------------------------------------ students
class StudentIn(_Strict):
    """A student. `contact_id` is the ADULT we write to: the guardian of a child, or the adult student themself (`is_adult` true, no label). A child needs a `child_label` (a first name or initials; no digits). The
    contact, the kind and the id never change."""

    contact_id: uuid.UUID
    is_adult: bool = False
    child_label: Label30 | None = None
    programme_id: uuid.UUID
    group_id: uuid.UUID | None = None
    admission_no: AdmissionNo | None = None
    guardian_contact_id: uuid.UUID | None = None
    joined_on: date | None = None

    @model_validator(mode="after")
    def _shape(self) -> StudentIn:
        if self.is_adult and self.child_label is not None:
            raise ValueError("an adult student is the contact and has no label")
        if not self.is_adult and self.child_label is None:
            raise ValueError("a child needs a first name or initials")
        if self.child_label is not None and _NOT_A_NAME.search(self.child_label):
            raise ValueError("a first name or initials only: no digits, no e-mail address")
        if self.guardian_contact_id is not None and not self.is_adult:
            raise ValueError("only an adult student has a separate guardian")
        return self


class StudentOut(_Strict):
    id: uuid.UUID
    contact_id: uuid.UUID
    is_adult: bool
    display_name: str | None
    contact_name: str | None
    guardian_contact_id: uuid.UUID | None
    programme_id: uuid.UUID
    group_id: uuid.UUID | None
    programme_name: str | None
    group_label: str | None
    admission_no: str | None
    status: StudentStatus
    joined_on: date | None
    left_on: date | None
    erased: bool
    created_at: datetime
    updated_at: datetime


class StudentSavedOut(StudentOut):
    created: bool


class StudentsOut(_Strict):
    items: list[StudentOut]
    next_cursor: str | None


class StatusIn(_Strict):
    status: StudentStatus
    left_on: date | None = None

    @model_validator(mode="after")
    def _both(self) -> StatusIn:
        if (self.status == "left") != (self.left_on is not None):
            raise ValueError("a student who left has the day they left; one who is active has none")
        return self


class ErasedOut(_Strict):
    student_id: uuid.UUID
    erased: bool
    replayed: bool


class ImportRowOut(_Strict):
    row: int
    outcome: Literal["created", "skipped_duplicate", "rejected"]
    reason: str | None = None
    student_id: uuid.UUID | None = None


# ------------------------------------------------------------------------------------------------------------------------------------------------------ admissions
class AdmissionIn(_Strict):
    """Start an enquiry for a parent or guardian: an existing contact (`contact_id`), or a new one (`guardian_name` and `guardian_phone`; the number is the parent's, never a child's). No child is stored until admitted."""

    source: Source
    programme_id: uuid.UUID | None = None
    contact_id: uuid.UUID | None = None
    guardian_name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)] | None = None
    guardian_phone: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=32, pattern=r"^[0-9+ ()-]+$")] | None = None

    @model_validator(mode="after")
    def _one(self) -> AdmissionIn:
        has_new = self.guardian_name is not None or self.guardian_phone is not None
        if (self.contact_id is None) == (not has_new):
            raise ValueError("name an existing contact, or give a guardian's name and phone, not both")
        if has_new and (self.guardian_name is None or self.guardian_phone is None):
            raise ValueError("a new guardian needs a name and a phone number")
        return self


class AdmissionOut(_Strict):
    id: uuid.UUID
    lead_id: uuid.UUID
    contact_id: uuid.UUID
    contact_name: str | None
    programme_id: uuid.UUID | None
    programme_name: str | None
    source: Source
    stage: Stage
    lost_reason: LostReason | None
    student_id: uuid.UUID | None
    stage_at: datetime
    created_at: datetime
    visits: int
    next_visit: datetime | None


class AdmissionCreatedOut(AdmissionOut):
    created: bool


class AdmissionEventOut(_Strict):
    stage: Stage
    lost_reason: LostReason | None
    at: datetime


class AdmissionDetailOut(AdmissionOut):
    events: list[AdmissionEventOut]


class AdmissionsOut(_Strict):
    items: list[AdmissionOut]
    next_cursor: str | None


class StageIn(_Strict):
    stage: SettableStage
    lost_reason: LostReason | None = None

    @model_validator(mode="after")
    def _both(self) -> StageIn:
        if (self.stage == "lost") != (self.lost_reason is not None):
            raise ValueError("a lost enquiry has a reason; the others have none")
        return self


class StageChangedOut(AdmissionOut):
    replayed: bool


class AdmitIn(_Strict):
    """Admitted: the enquiry becomes a student (the guardian is the enquiry's contact; an adult student IS that contact) and, with `plan_id`, the fee plan is assigned. Both ids are the caller's, so a retry is safe."""

    student_id: uuid.UUID
    is_adult: bool = False
    child_label: Label30 | None = None
    programme_id: uuid.UUID
    group_id: uuid.UUID | None = None
    admission_no: AdmissionNo | None = None
    plan_id: uuid.UUID | None = None
    assignment_id: uuid.UUID | None = None
    joined_on: date | None = None

    @model_validator(mode="after")
    def _shape(self) -> AdmitIn:
        if self.is_adult and self.child_label is not None:
            raise ValueError("an adult student is the contact and has no label")
        if not self.is_adult and self.child_label is None:
            raise ValueError("a child needs a first name or initials")
        if self.child_label is not None and _NOT_A_NAME.search(self.child_label):
            raise ValueError("a first name or initials only: no digits, no e-mail address")
        if (self.plan_id is None) != (self.assignment_id is None):
            raise ValueError("give the plan and the assignment id together, or neither")
        return self


class AdmittedOut(AdmissionOut):
    replayed: bool
    student_created: bool | None = None
    fee_assignment: dict[str, Any] | None = None


# ------------------------------------------------------------------------------------------------------------------------------------------------------ fee plans
class FeeLineIn(_Strict):
    head: Head
    instalment_no: Annotated[StrictInt, Field(ge=1, le=24)]
    due_date: date
    amount_paise: LinePaise


class FeePlanIn(_Strict):
    """A plan for a programme (and optionally one group) in an academic year: the heads, the instalments with their due dates, and an optional late-fee rule. `fixed` = one amount per late instalment; `per_day` =
    that amount for each day late, never above `late_fee_cap_paise`. A plan that a student has been assigned cannot change (make a new plan)."""

    name: Words
    programme_id: uuid.UUID
    group_id: uuid.UUID | None = None
    academic_year: Year
    late_fee_kind: LateFeeKind = "none"
    late_fee_paise: LinePaise | None = None
    late_fee_grace_days: Annotated[StrictInt, Field(ge=0, le=60)] = 0
    late_fee_cap_paise: Annotated[StrictInt, Field(ge=1, le=1_000_000_000)] | None = None
    active: bool = True
    lines: Annotated[list[FeeLineIn], Field(min_length=1, max_length=100)]

    @model_validator(mode="after")
    def _shape(self) -> FeePlanIn:
        if (self.late_fee_kind == "none") != (self.late_fee_paise is None):
            raise ValueError("a late fee has an amount; no late fee has none")
        if self.late_fee_cap_paise is not None and self.late_fee_kind != "per_day":
            raise ValueError("only a per-day late fee has a cap")
        keys = [(ln.head, ln.instalment_no) for ln in self.lines]
        if len(set(keys)) != len(keys):
            raise ValueError("each head and instalment number once")
        return self


class FeeLineOut(_Strict):
    head: Head
    instalment_no: int
    due_date: date
    amount_paise: int


class FeePlanOut(_Strict):
    id: uuid.UUID
    name: str
    programme_id: uuid.UUID
    group_id: uuid.UUID | None
    academic_year: str
    late_fee_kind: LateFeeKind
    late_fee_paise: int | None
    late_fee_grace_days: int
    late_fee_cap_paise: int | None
    active: bool
    created_at: datetime
    total_paise: int
    assigned: int


class FeePlanDetailOut(FeePlanOut):
    lines: list[FeeLineOut]


class FeePlansOut(_Strict):
    items: list[FeePlanOut]


# ------------------------------------------------------------------------------------------------------------------------------------------------------ assignments, payments, concessions
class AssignIn(_Strict):
    student_id: uuid.UUID
    plan_id: uuid.UUID
    assigned_on: date | None = None


class AssignedOut(_Strict):
    assignment_id: uuid.UUID
    student_id: uuid.UUID
    plan_id: uuid.UUID
    charges: int | None = None
    total_paise: int | None = None
    voided: bool | None = None
    replayed: bool


class AssignmentVoidedOut(_Strict):
    assignment_id: uuid.UUID
    voided: bool
    charges_voided: int


class PaymentIn(_Strict):
    received_on: date
    amount_paise: Paise
    method: Method
    against_entry_id: uuid.UUID | None = None


class PaymentRecordedOut(_Strict):
    entry_id: uuid.UUID
    receipt_no: str | None
    replayed: bool


class ConcessionIn(_Strict):
    """An amount, or a percentage (1 to 100) of what was charged to the student; a reason code. The Owner or an Admin, with a second factor."""

    mode: Literal["amount", "percent"]
    value: Annotated[StrictInt, Field(ge=1, le=10_000_000_000)]
    reason_code: ConcessionReason
    reference: Reference | None = None

    @model_validator(mode="after")
    def _percent(self) -> ConcessionIn:
        if self.mode == "percent" and self.value > 100:
            raise ValueError("a percentage is 1 to 100")
        return self


class ConcessionRecordedOut(_Strict):
    entry_id: uuid.UUID
    amount_paise: int
    replayed: bool


class AdjustmentIn(_Strict):
    direction: Literal["debit", "credit"]
    amount_paise: Paise
    reason_code: AdjustmentReason
    due_date: date | None = None
    reference: Reference | None = None

    @model_validator(mode="after")
    def _due(self) -> AdjustmentIn:
        if (self.direction == "debit") != (self.due_date is not None):
            raise ValueError("a correction up has a due date; a correction down has none")
        return self


class AdjustmentRecordedOut(_Strict):
    entry_id: uuid.UUID
    replayed: bool


class AssignmentOut(_Strict):
    id: uuid.UUID
    plan_id: uuid.UUID
    academic_year: str
    assigned_on: date
    plan_name: str


class FeeStatementBody(_Strict):
    student_id: uuid.UUID | None = None
    account_id: uuid.UUID | None = None
    company_id: uuid.UUID | None = None
    contact_id: uuid.UUID | None = None
    as_of: date
    invoiced_paise: int
    paid_paise: int
    payments_paise: int = 0
    concessions_paise: int = 0
    adjustments_paise: int = 0
    outstanding_paise: int
    credit_paise: int
    overdue_paise: int
    ageing: AgeingOut
    overdue_ageing: OverdueAgeingOut | None = None
    open_invoices: list[OpenInvoiceOut] = []
    # (the shared statement carries a credit limit for a construction customer; a student never has one)
    credit_limit_paise: int | None = None
    over_limit: bool = False


class FeeStatementOut(_Strict):
    student: StudentOut
    assignment: AssignmentOut | None
    statement: FeeStatementBody


class FeeEntryOut(_Strict):
    id: uuid.UUID
    kind: Literal["charge", "payment", "adjustment", "concession"]
    direction: Literal["debit", "credit"]
    amount_paise: int
    entry_date: date
    due_date: date | None
    reference: str | None
    method: Method | None
    reason_code: str | None
    receipt_no: str | None
    against_entry_id: uuid.UUID | None
    source: Literal["manual", "import"]
    voided: bool


class FeeEntriesOut(_Strict):
    account_id: uuid.UUID | None
    entries: list[FeeEntryOut]


class FeeReceiptOut(_Strict):
    """A fee receipt, ready to print or to send: the number, the date, the amount, the method, who paid (the guardian), for whom (the student), what it was set against and the balance after it."""

    receipt_no: str
    received_on: date
    amount_paise: int
    method: Method
    voided: bool
    business_name: str
    paid_by: str | None
    student: StudentOut
    against: str | None
    balance_after_paise: int
    recorded_at: datetime


class GuardianStudentFeesOut(_Strict):
    student_id: uuid.UUID
    display_name: str | None
    outstanding_paise: int
    overdue_paise: int


class GuardianFeesOut(_Strict):
    contact_id: uuid.UUID
    as_of: date
    students: list[GuardianStudentFeesOut]
    outstanding_paise: int
    overdue_paise: int


class LateFeeRowOut(_Strict):
    student_id: uuid.UUID
    charge_id: uuid.UUID
    amount_paise: int
    days_late: int


class LateFeesPreviewOut(_Strict):
    as_of: date
    count: int
    total_paise: int
    rows: list[LateFeeRowOut]


class LateFeesPostedOut(_Strict):
    as_of: date
    posted: int
    total_paise: int


class PendingRowOut(_Strict):
    student_id: uuid.UUID
    display_name: str | None
    programme_name: str | None
    group_label: str | None
    contact_id: uuid.UUID
    contact_name: str | None
    pending_paise: int
    due_paise: int
    overdue_days: int


class PendingListOut(_Strict):
    items: list[PendingRowOut]
    next_cursor: str | None


# ------------------------------------------------------------------------------------------------------------------------------------------------------ announcements, reports
class AudienceIn(_Strict):
    """Who an announcement goes to: every guardian of the students in a section/batch (`group`), a programme, or the whole institution (`all`), with the date of the event, exam or holiday. One message per guardian."""

    scope: Literal["all", "programme", "group"]
    programme_id: uuid.UUID | None = None
    group_id: uuid.UUID | None = None
    date: date

    @model_validator(mode="after")
    def _scope(self) -> AudienceIn:
        ok = {"all": (None, None), "programme": (self.programme_id, None), "group": (None, self.group_id)}[self.scope]
        if (self.programme_id, self.group_id) != ok or (self.scope == "programme" and self.programme_id is None) or (self.scope == "group" and self.group_id is None):
            raise ValueError("a programme scope names the programme, a group scope names the group, and `all` names neither")
        return self


class AudienceAddedOut(_Strict):
    added: int
    skipped: list[dict[str, Any]]
    recipients: int


