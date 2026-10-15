"""The education pack under /v1/tenants/{tenant_id}/institution (job CR, ADR 0087; modules `programmes`, `fees`, `enquiries`, `reports`). Children's data is the minimum of ADR 0084 part 5: see models.py.

  GET/PUT /profile                                         the institution: type, year start, terms, parent languages, the student retention rule (Owner, with a second factor, sets it).
  GET /programmes, PUT /programmes/{id}, PUT /programmes/{id}/groups/{gid}   classes and sections, courses with year, semester or batch.
  GET /students, GET|PUT /students/{id}, POST /students/{id}/status, POST /students/{id}/erase   the MINIMAL student record (Owner, Admin write; Sales read; a Viewer sees no child).
  GET|POST /admissions, GET /admissions/{id}, POST /admissions/{id}/stage|admit   enquiry -> campus visit -> application -> admitted | lost; works without the companies module.
  GET /fee-plans, GET|PUT /fee-plans/{id}                   heads, instalments with due dates, an optional late-fee rule.
  PUT /fee-assignments/{id}, POST /fee-assignments/{id}/void   a plan for a student: the instalments become charges on the student's own ledger.
  GET /students/{id}/fees, GET /students/{id}/fees/entries, PUT /students/{id}/payments|concessions|adjustments/{entry_id}, GET /receipts/{entry_id}, GET /guardians/{contact_id}/fees
  GET /late-fees, POST /late-fees/post                      the late fees the plan's rule gives today, and posting them (Owner or Admin, second factor).
  GET /fees/pending                                         the pending list (the word is "pending").
  PUT /announcements/{campaign_id}/audience                 the guardians of a class, a programme or everyone, for an event, exam or holiday campaign (approval and results: /campaigns/...).
  GET /reports/{code}?from=&to=                             education.collection | education.today | education.pending | education.funnel, in the shape every pack's reports use.

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

import base64
import uuid
from datetime import date, datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import ContactCreate, parse_uuid
from app.education.models import (
    AdjustmentIn,
    AdjustmentRecordedOut,
    AdmissionCreatedOut,
    AdmissionDetailOut,
    AdmissionIn,
    AdmissionOut,
    AdmissionsOut,
    AdmitIn,
    AdmittedOut,
    AssignedOut,
    AssignIn,
    AssignmentVoidedOut,
    AudienceAddedOut,
    AudienceIn,
    ConcessionIn,
    ConcessionRecordedOut,
    ErasedOut,
    FeeEntriesOut,
    FeePlanDetailOut,
    FeePlanIn,
    FeePlanOut,
    FeePlansOut,
    FeeReceiptOut,
    FeeStatementOut,
    GroupIn,
    GroupSavedOut,
    GuardianFeesOut,
    LateFeesPostedOut,
    LateFeesPreviewOut,
    PaymentIn,
    PaymentRecordedOut,
    PendingListOut,
    PendingRowOut,
    ProfileIn,
    ProfileOut,
    ProgrammeIn,
    ProgrammeOut,
    ProgrammeSavedOut,
    ProgrammesOut,
    ReportCode,
    StageChangedOut,
    StageIn,
    StatusIn,
    StudentIn,
    StudentOut,
    StudentSavedOut,
    StudentsOut,
)
from app.education.repository import EducationRepository
from app.errors import ApiError, not_found
from app.reports.models import ReportOut
from app.suppression import service as suppression
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/institution", tags=["school"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Member = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES, Role.VIEWER))]
Reader = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, Role.SALES))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, strong=True))]
Limit = Annotated[int, Query(ge=1, le=100)]


def _repo(runtime: Runtime) -> EducationRepository:
    if runtime.education is None:
        raise ApiError(503, "education_unavailable", "Education is not available right now.")
    return runtime.education


def _row_id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


def _opt_id(raw: str | None) -> str | None:
    return None if raw is None else str(_row_id(raw))


def encode_cursor(at: datetime, row_id: uuid.UUID) -> str:
    return base64.urlsafe_b64encode(f"{at.isoformat()}|{row_id}".encode()).decode().rstrip("=")


def decode_cursor(raw: str | None) -> tuple[datetime, uuid.UUID] | None:
    if raw is None:
        return None
    try:
        text = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode()
        at, row_id = text.split("|", 1)
        return datetime.fromisoformat(at), uuid.UUID(row_id)
    except (ValueError, UnicodeDecodeError):
        raise ApiError(422, "validation_error", "Invalid input.") from None


def encode_pending_cursor(paise: int, row_id: uuid.UUID) -> str:
    return base64.urlsafe_b64encode(f"{paise}|{row_id}".encode()).decode().rstrip("=")


def decode_pending_cursor(raw: str | None) -> tuple[int, uuid.UUID] | None:
    if raw is None:
        return None
    try:
        text = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode()
        paise, row_id = text.split("|", 1)
        return int(paise), uuid.UUID(row_id)
    except (ValueError, UnicodeDecodeError):
        raise ApiError(422, "validation_error", "Invalid input.") from None


# ------------------------------------------------------------------------------------------------------------------------------------------------------ profile
@router.get("/profile", response_model=ProfileOut)
def get_profile(ctx: Member, runtime: RuntimeDep) -> ProfileOut:
    return ProfileOut.model_validate(_repo(runtime).profile_get(ctx.principal.token, ctx.tenant.id))


@router.put("/profile", response_model=ProfileOut)
def put_profile(body: ProfileIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> ProfileOut:
    row = _repo(runtime).profile_set(
        ctx.principal.token,
        {
            "p_tenant_id": str(ctx.tenant.id),
            "p_institution_type": body.institution_type,
            "p_year_start_month": body.year_start_month,
            "p_terms": [t.model_dump() for t in body.terms],
            "p_parent_languages": body.parent_languages,
            "p_student_retention_months": body.student_retention_months,
        },
    )
    return ProfileOut.model_validate(row)


# ------------------------------------------------------------------------------------------------------------------------------------------------------ programmes
@router.get("/programmes", response_model=ProgrammesOut)
def list_programmes(ctx: Member, runtime: RuntimeDep, include_inactive: bool = False) -> ProgrammesOut:
    return ProgrammesOut(items=[ProgrammeOut.model_validate(r) for r in _repo(runtime).programmes(ctx.principal.token, ctx.tenant.id, include_inactive)])


@router.put("/programmes/{programme_id}", response_model=ProgrammeSavedOut)
def put_programme(programme_id: str, body: ProgrammeIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> ProgrammeSavedOut:
    row = _repo(runtime).programme_save(
        ctx.principal.token,
        {"p_programme_id": str(_row_id(programme_id)), "p_tenant_id": str(ctx.tenant.id), "p_name": body.name, "p_kind": body.kind, "p_group_kind": body.group_kind, "p_active": body.active},
    )
    return ProgrammeSavedOut.model_validate(row)


@router.put("/programmes/{programme_id}/groups/{group_id}", response_model=GroupSavedOut)
def put_group(programme_id: str, group_id: str, body: GroupIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> GroupSavedOut:
    row = _repo(runtime).group_save(
        ctx.principal.token,
        {
            "p_group_id": str(_row_id(group_id)),
            "p_tenant_id": str(ctx.tenant.id),
            "p_programme_id": str(_row_id(programme_id)),
            "p_label": body.label,
            "p_timing": body.timing,
            "p_active": body.active,
        },
    )
    return GroupSavedOut.model_validate(row)


# ------------------------------------------------------------------------------------------------------------------------------------------------------ students
@router.get("/students", response_model=StudentsOut)
def list_students(
    ctx: Reader,
    runtime: RuntimeDep,
    programme_id: str | None = None,
    group_id: str | None = None,
    status: Literal["active", "left"] | None = None,
    contact_id: str | None = None,
    after: str | None = None,
    limit: Limit = 50,
) -> StudentsOut:
    rows = _repo(runtime).students(
        ctx.principal.token, ctx.tenant.id, {"programme_id": _opt_id(programme_id), "group_id": _opt_id(group_id), "status": status, "contact_id": _opt_id(contact_id)}, limit, decode_cursor(after)
    )
    items = [StudentOut.model_validate(r) for r in rows]
    return StudentsOut(items=items, next_cursor=encode_cursor(items[-1].created_at, items[-1].id) if len(items) >= limit else None)


@router.get("/students/{student_id}", response_model=StudentOut)
def get_student(student_id: str, ctx: Reader, runtime: RuntimeDep) -> StudentOut:
    return StudentOut.model_validate(_repo(runtime).student_get(ctx.principal.token, ctx.tenant.id, _row_id(student_id)))


@router.put("/students/{student_id}", response_model=StudentSavedOut)
def put_student(student_id: str, body: StudentIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> StudentSavedOut:
    row = _repo(runtime).student_save(
        ctx.principal.token,
        {
            "p_student_id": str(_row_id(student_id)),
            "p_tenant_id": str(ctx.tenant.id),
            "p_contact_id": str(body.contact_id),
            "p_is_adult": body.is_adult,
            "p_child_label": body.child_label,
            "p_programme_id": str(body.programme_id),
            "p_group_id": str(body.group_id) if body.group_id else None,
            "p_admission_no": body.admission_no,
            "p_guardian_contact_id": str(body.guardian_contact_id) if body.guardian_contact_id else None,
            "p_joined_on": body.joined_on.isoformat() if body.joined_on else None,
        },
    )
    return StudentSavedOut.model_validate(row)


@router.post("/students/{student_id}/status", response_model=StudentOut)
def set_status(student_id: str, body: StatusIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> StudentOut:
    return StudentOut.model_validate(_repo(runtime).student_status(ctx.principal.token, ctx.tenant.id, _row_id(student_id), body.status, body.left_on))


@router.post("/students/{student_id}/erase", response_model=ErasedOut)
def erase_student(student_id: str, ctx: OwnerStrong, runtime: RuntimeDep) -> ErasedOut:
    """A guardian asks for their child alone to be erased: the label and the admission number go; the money records stay. The Owner, with a second factor."""
    return ErasedOut.model_validate(_repo(runtime).student_erase(ctx.principal.token, ctx.tenant.id, _row_id(student_id)))


# ------------------------------------------------------------------------------------------------------------------------------------------------------ admissions
def _admission(row: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in row.items() if k not in ("created", "replayed", "events", "student_created", "fee_assignment")}


@router.get("/admissions", response_model=AdmissionsOut)
def list_admissions(
    ctx: Reader,
    runtime: RuntimeDep,
    stage: Literal["enquiry", "campus_visit", "application", "admitted", "lost"] | None = None,
    programme_id: str | None = None,
    source: Literal["whatsapp", "walk_in", "website", "ad", "referral", "other"] | None = None,
    after: str | None = None,
    limit: Limit = 50,
) -> AdmissionsOut:
    rows = _repo(runtime).admissions(ctx.principal.token, ctx.tenant.id, {"stage": stage, "programme_id": _opt_id(programme_id), "source": source}, limit, decode_cursor(after))
    items = [AdmissionOut.model_validate(_admission(r)) for r in rows]
    return AdmissionsOut(items=items, next_cursor=encode_cursor(items[-1].created_at, items[-1].id) if len(items) >= limit else None)


@router.put("/admissions/{admission_id}", response_model=AdmissionCreatedOut)
def put_admission(admission_id: str, body: AdmissionIn, ctx: Reader, runtime: RuntimeDep) -> AdmissionCreatedOut:
    """Start an enquiry (the id is the caller's, so a retry is safe). A new guardian is made here with their name and phone number and gets their suppression keys, as for every contact."""
    aid = _row_id(admission_id)
    contact_id = body.contact_id
    if contact_id is None:
        made_id = uuid.uuid5(aid, "guardian")
        payload = ContactCreate(id=made_id, full_name=body.guardian_name or "", phone=body.guardian_phone).model_dump(mode="json", exclude_none=True)
        row, _ = runtime.crm.create_row(ctx.principal.token, "contacts", ctx.tenant.id, payload)
        contact_id = row.id
        suppression.record_for_contact(runtime.suppression, runtime.key_ring, ctx.principal.token, row.id, row.email, row.phone)
    out = _repo(runtime).admission_create(
        ctx.principal.token,
        {"p_admission_id": str(aid), "p_tenant_id": str(ctx.tenant.id), "p_contact_id": str(contact_id), "p_programme_id": str(body.programme_id) if body.programme_id else None, "p_source": body.source},
    )
    return AdmissionCreatedOut.model_validate({**_admission(out), "created": out.get("created") is True})


@router.get("/admissions/{admission_id}", response_model=AdmissionDetailOut)
def get_admission(admission_id: str, ctx: Reader, runtime: RuntimeDep) -> AdmissionDetailOut:
    return AdmissionDetailOut.model_validate(_repo(runtime).admission_get(ctx.principal.token, ctx.tenant.id, _row_id(admission_id)))


@router.post("/admissions/{admission_id}/stage", response_model=StageChangedOut)
def set_stage(admission_id: str, body: StageIn, ctx: Reader, runtime: RuntimeDep) -> StageChangedOut:
    out = _repo(runtime).admission_stage(ctx.principal.token, ctx.tenant.id, _row_id(admission_id), body.stage, body.lost_reason)
    return StageChangedOut.model_validate({**_admission(out), "replayed": out.get("replayed") is True})


@router.post("/admissions/{admission_id}/admit", response_model=AdmittedOut)
def admit(admission_id: str, body: AdmitIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> AdmittedOut:
    out = _repo(runtime).admission_admit(
        ctx.principal.token,
        {
            "p_tenant_id": str(ctx.tenant.id),
            "p_admission_id": str(_row_id(admission_id)),
            "p_student_id": str(body.student_id),
            "p_is_adult": body.is_adult,
            "p_child_label": body.child_label,
            "p_programme_id": str(body.programme_id),
            "p_group_id": str(body.group_id) if body.group_id else None,
            "p_admission_no": body.admission_no,
            "p_plan_id": str(body.plan_id) if body.plan_id else None,
            "p_assignment_id": str(body.assignment_id) if body.assignment_id else None,
            "p_joined_on": body.joined_on.isoformat() if body.joined_on else None,
        },
    )
    return AdmittedOut.model_validate({**_admission(out), "replayed": out.get("replayed") is True, "student_created": out.get("student_created"), "fee_assignment": out.get("fee_assignment")})


# ------------------------------------------------------------------------------------------------------------------------------------------------------ fee plans
@router.get("/fee-plans", response_model=FeePlansOut)
def list_fee_plans(ctx: Reader, runtime: RuntimeDep, programme_id: str | None = None, include_inactive: bool = False) -> FeePlansOut:
    rows = _repo(runtime).fee_plans(ctx.principal.token, ctx.tenant.id, _row_id(programme_id) if programme_id else None, include_inactive)
    return FeePlansOut(items=[FeePlanOut.model_validate(r) for r in rows])


@router.get("/fee-plans/{plan_id}", response_model=FeePlanDetailOut)
def get_fee_plan(plan_id: str, ctx: Reader, runtime: RuntimeDep) -> FeePlanDetailOut:
    return FeePlanDetailOut.model_validate(_repo(runtime).fee_plan_get(ctx.principal.token, ctx.tenant.id, _row_id(plan_id)))


@router.put("/fee-plans/{plan_id}", response_model=FeePlanDetailOut)
def put_fee_plan(plan_id: str, body: FeePlanIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> FeePlanDetailOut:
    row = _repo(runtime).fee_plan_save(
        ctx.principal.token,
        {
            "p_plan_id": str(_row_id(plan_id)),
            "p_tenant_id": str(ctx.tenant.id),
            "p_name": body.name,
            "p_programme_id": str(body.programme_id),
            "p_group_id": str(body.group_id) if body.group_id else None,
            "p_academic_year": body.academic_year,
            "p_late_fee_kind": body.late_fee_kind,
            "p_late_fee_paise": body.late_fee_paise,
            "p_late_fee_grace_days": body.late_fee_grace_days,
            "p_late_fee_cap_paise": body.late_fee_cap_paise,
            "p_active": body.active,
            "p_lines": [ln.model_dump(mode="json") for ln in body.lines],
        },
    )
    return FeePlanDetailOut.model_validate(row)


# ------------------------------------------------------------------------------------------------------------------------------------------------------ assignments
@router.put("/fee-assignments/{assignment_id}", response_model=AssignedOut)
def put_assignment(assignment_id: str, body: AssignIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> AssignedOut:
    row = _repo(runtime).fee_assign(
        ctx.principal.token,
        {
            "p_assignment_id": str(_row_id(assignment_id)),
            "p_tenant_id": str(ctx.tenant.id),
            "p_student_id": str(body.student_id),
            "p_plan_id": str(body.plan_id),
            "p_assigned_on": body.assigned_on.isoformat() if body.assigned_on else None,
        },
    )
    return AssignedOut.model_validate(row)


@router.post("/fee-assignments/{assignment_id}/void", response_model=AssignmentVoidedOut)
def void_assignment(assignment_id: str, ctx: OwnerAdmin, runtime: RuntimeDep) -> AssignmentVoidedOut:
    return AssignmentVoidedOut.model_validate(_repo(runtime).fee_assignment_void(ctx.principal.token, ctx.tenant.id, _row_id(assignment_id)))


# ------------------------------------------------------------------------------------------------------------------------------------------------------ a student's ledger
@router.get("/students/{student_id}/fees", response_model=FeeStatementOut)
def student_fees(student_id: str, ctx: Reader, runtime: RuntimeDep, as_of: date | None = None) -> FeeStatementOut:
    return FeeStatementOut.model_validate(_repo(runtime).fee_statement(ctx.principal.token, ctx.tenant.id, _row_id(student_id), as_of))


@router.get("/students/{student_id}/fees/entries", response_model=FeeEntriesOut)
def student_entries(student_id: str, ctx: Reader, runtime: RuntimeDep, limit: Annotated[int, Query(ge=1, le=500)] = 100) -> FeeEntriesOut:
    return FeeEntriesOut.model_validate(_repo(runtime).fee_entries(ctx.principal.token, ctx.tenant.id, _row_id(student_id), limit))


@router.put("/students/{student_id}/payments/{entry_id}", response_model=PaymentRecordedOut)
def put_payment(student_id: str, entry_id: str, body: PaymentIn, ctx: Reader, runtime: RuntimeDep) -> PaymentRecordedOut:
    row = _repo(runtime).fee_payment(
        ctx.principal.token,
        {
            "p_entry_id": str(_row_id(entry_id)),
            "p_tenant_id": str(ctx.tenant.id),
            "p_student_id": str(_row_id(student_id)),
            "p_received_on": body.received_on.isoformat(),
            "p_amount_paise": body.amount_paise,
            "p_method": body.method,
            "p_against_entry_id": str(body.against_entry_id) if body.against_entry_id else None,
        },
    )
    return PaymentRecordedOut(entry_id=row["entry_id"], receipt_no=row.get("receipt_no"), replayed=row.get("replayed") is True)


@router.put("/students/{student_id}/concessions/{entry_id}", response_model=ConcessionRecordedOut)
def put_concession(student_id: str, entry_id: str, body: ConcessionIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> ConcessionRecordedOut:
    row = _repo(runtime).fee_concession(
        ctx.principal.token,
        {
            "p_entry_id": str(_row_id(entry_id)),
            "p_tenant_id": str(ctx.tenant.id),
            "p_student_id": str(_row_id(student_id)),
            "p_mode": body.mode,
            "p_value": body.value,
            "p_reason_code": body.reason_code,
            "p_reference": body.reference,
        },
    )
    return ConcessionRecordedOut(entry_id=row["entry_id"], amount_paise=int(row["amount_paise"]), replayed=row.get("replayed") is True)


@router.put("/students/{student_id}/adjustments/{entry_id}", response_model=AdjustmentRecordedOut)
def put_adjustment(student_id: str, entry_id: str, body: AdjustmentIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> AdjustmentRecordedOut:
    row = _repo(runtime).fee_adjustment(
        ctx.principal.token,
        {
            "p_entry_id": str(_row_id(entry_id)),
            "p_tenant_id": str(ctx.tenant.id),
            "p_student_id": str(_row_id(student_id)),
            "p_direction": body.direction,
            "p_amount_paise": body.amount_paise,
            "p_reason_code": body.reason_code,
            "p_due_date": body.due_date.isoformat() if body.due_date else None,
            "p_reference": body.reference,
        },
    )
    return AdjustmentRecordedOut(entry_id=row["entry_id"], replayed=row.get("replayed") is True)


@router.get("/receipts/{entry_id}", response_model=FeeReceiptOut)
def receipt(entry_id: str, ctx: Reader, runtime: RuntimeDep) -> FeeReceiptOut:
    return FeeReceiptOut.model_validate(_repo(runtime).fee_receipt(ctx.principal.token, ctx.tenant.id, _row_id(entry_id)))


@router.get("/guardians/{contact_id}/fees", response_model=GuardianFeesOut)
def guardian_fees(contact_id: str, ctx: Reader, runtime: RuntimeDep, as_of: date | None = None) -> GuardianFeesOut:
    return GuardianFeesOut.model_validate(_repo(runtime).fee_guardian(ctx.principal.token, ctx.tenant.id, _row_id(contact_id), as_of))


# ------------------------------------------------------------------------------------------------------------------------------------------------------ late fees and the pending list
@router.get("/late-fees", response_model=LateFeesPreviewOut)
def late_fees(ctx: Reader, runtime: RuntimeDep) -> LateFeesPreviewOut:
    """The late fees the plans' rules give today, computed by the database from the instalments still open. Nothing is added to anyone's account by looking."""
    return LateFeesPreviewOut.model_validate(_repo(runtime).late_fees_preview(ctx.principal.token, ctx.tenant.id))


@router.post("/late-fees/post", response_model=LateFeesPostedOut)
def post_late_fees(ctx: OwnerAdmin, runtime: RuntimeDep) -> LateFeesPostedOut:
    """Post them (Owner or Admin, with a second factor): each is a debit adjustment against its instalment, due today. Posting twice adds nothing twice."""
    return LateFeesPostedOut.model_validate(_repo(runtime).late_fees_post(ctx.principal.token, ctx.tenant.id))


@router.get("/fees/pending", response_model=PendingListOut)
def pending(
    ctx: Reader, runtime: RuntimeDep, as_of: date | None = None, programme_id: str | None = None, group_id: str | None = None, after: str | None = None, limit: Limit = 50
) -> PendingListOut:
    rows = _repo(runtime).pending(
        ctx.principal.token, ctx.tenant.id, {"as_of": as_of.isoformat() if as_of else None, "programme_id": _opt_id(programme_id), "group_id": _opt_id(group_id)}, limit, decode_pending_cursor(after)
    )
    items = [PendingRowOut.model_validate(r) for r in rows]
    return PendingListOut(items=items, next_cursor=encode_pending_cursor(items[-1].pending_paise, items[-1].student_id) if len(items) >= limit else None)


# ------------------------------------------------------------------------------------------------------------------------------------------------------ announcements and reports
@router.put("/announcements/{campaign_id}/audience", response_model=AudienceAddedOut)
def announcement_audience(campaign_id: str, body: AudienceIn, ctx: Reader, runtime: RuntimeDep) -> AudienceAddedOut:
    """Fill the list of an event, exam or holiday campaign (made with PUT /campaigns/{id}) with the guardians of the chosen students; it REPLACES nothing: it adds, and sends an approved campaign back to draft."""
    out = _repo(runtime).audience(
        ctx.principal.token,
        ctx.tenant.id,
        _row_id(campaign_id),
        {"scope": body.scope, "programme_id": str(body.programme_id) if body.programme_id else None, "group_id": str(body.group_id) if body.group_id else None, "date": body.date.isoformat()},
    )
    return AudienceAddedOut.model_validate(out)


@router.get("/reports/{code}", response_model=ReportOut, response_model_by_alias=True)
def report(code: ReportCode, ctx: Reader, runtime: RuntimeDep, from_: Annotated[date | None, Query(alias="from")] = None, to: date | None = None) -> ReportOut:
    return ReportOut.model_validate(_repo(runtime).report(ctx.principal.token, ctx.tenant.id, code, from_, to))
