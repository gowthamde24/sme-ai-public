"""An in-memory fake of the education repository (job CR) for the route tests (no database). It records every call and answers with the shapes the database functions return; the database's own rules are proved in
supabase/tests/database/104..107 and tests/integration/test_cr_education.py."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from app.crm.repository import NotFoundError

NOW = "2026-10-14T09:00:00+00:00"
U = uuid.UUID
STUDENT = str(U(int=0x57))
PROG = str(U(int=0x60))
GROUP = str(U(int=0x61))
CONTACT = str(U(int=0x200))
LEAD = str(U(int=0x1EAD))


def student_row(student_id: str = STUDENT, **over: Any) -> dict[str, Any]:
    return {
        "id": student_id, "contact_id": CONTACT, "is_adult": False, "display_name": "Asha", "contact_name": "Rao Parent", "guardian_contact_id": None, "programme_id": PROG, "group_id": GROUP,
        "programme_name": "Class 5", "group_label": "A", "admission_no": "ADM-1", "status": "active", "joined_on": None, "left_on": None, "erased": False, "created_at": NOW, "updated_at": NOW, **over,
    }  # fmt: skip


def admission_row(admission_id: str, **over: Any) -> dict[str, Any]:
    return {
        "id": admission_id, "lead_id": LEAD, "contact_id": CONTACT, "contact_name": "Rao Parent", "programme_id": PROG, "programme_name": "Class 5", "source": "walk_in", "stage": "enquiry",
        "lost_reason": None, "student_id": None, "stage_at": NOW, "created_at": NOW, "visits": 0, "next_visit": None, **over,
    }  # fmt: skip


def plan_row(plan_id: str, **over: Any) -> dict[str, Any]:
    return {
        "id": plan_id, "name": "Class 5 fees", "programme_id": PROG, "group_id": None, "academic_year": "2026-27", "late_fee_kind": "none", "late_fee_paise": None, "late_fee_grace_days": 0,
        "late_fee_cap_paise": None, "active": True, "created_at": NOW, "total_paise": 3500000, "assigned": 0, **over,
    }  # fmt: skip


STATEMENT: dict[str, Any] = {
    "student_id": STUDENT, "account_id": str(U(int=0xAC)), "company_id": None, "contact_id": None, "as_of": "2026-10-14", "invoiced_paise": 3500000, "paid_paise": 1200000, "payments_paise": 1200000,
    "concessions_paise": 0, "adjustments_paise": 0, "outstanding_paise": 2300000, "credit_paise": 0, "overdue_paise": 1300000,
    "ageing": {"d0_30": 0, "d31_60": 0, "d61_90": 0, "d90_plus": 2300000},
    "overdue_ageing": {"not_due": 1000000, "d1_30": 1000000, "d31_60": 0, "d61_90": 0, "d90_plus": 300000}, "open_invoices": [],
}  # fmt: skip


class FakeEducation:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.error: Exception | None = None
        self.students_rows: list[dict[str, Any]] = [student_row()]
        self.admissions_rows: list[dict[str, Any]] = []

    def _go(self, name: str, *args: Any) -> None:
        self.calls.append((name, args))
        if self.error is not None:
            raise self.error

    def names(self) -> list[str]:
        return [c[0] for c in self.calls]

    # ------------------------------------------------------------------ profile and structure
    def profile_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._go("profile_get", token)
        return {"configured": False}

    def profile_set(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("profile_set", token, args)
        return {"configured": True, "institution_type": args["p_institution_type"], "year_start_month": args["p_year_start_month"], "terms": args["p_terms"], "parent_languages": args["p_parent_languages"],
                "student_retention_months": args["p_student_retention_months"], "updated_at": NOW}  # fmt: skip

    def programmes(self, token: str, tenant_id: uuid.UUID, include_inactive: bool) -> list[dict[str, Any]]:
        self._go("programmes", token, include_inactive)
        return [
            {"id": PROG, "name": "Class 5", "kind": "class", "group_kind": "section", "active": True, "students": 1,
             "groups": [{"id": GROUP, "label": "A", "timing": None, "active": True, "students": 1}, {"id": str(U(int=0x62)), "label": "B", "timing": None, "active": True, "students": 0}]},
            {"id": str(U(int=0x63)), "name": "Class 6", "kind": "class", "group_kind": "none", "active": True, "students": 0, "groups": []},
        ]  # fmt: skip

    def programme_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("programme_save", token, args)
        return {"id": args["p_programme_id"], "name": args["p_name"], "kind": args["p_kind"], "group_kind": args["p_group_kind"], "active": args["p_active"], "created": True}

    def group_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("group_save", token, args)
        return {"id": args["p_group_id"], "programme_id": args["p_programme_id"], "label": args["p_label"], "timing": args["p_timing"], "active": args["p_active"], "created": True}

    # ------------------------------------------------------------------ students
    def student_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("student_save", token, args)
        return {**student_row(args["p_student_id"], contact_id=args["p_contact_id"], is_adult=args["p_is_adult"], display_name=args["p_child_label"], admission_no=args["p_admission_no"]), "created": True}

    def student_get(self, token: str, tenant_id: uuid.UUID, student_id: uuid.UUID) -> dict[str, Any]:
        self._go("student_get", token, student_id)
        if str(student_id) != STUDENT:
            raise NotFoundError("23503")
        return student_row()

    def student_status(self, token: str, tenant_id: uuid.UUID, student_id: uuid.UUID, status: str, left_on: date | None) -> dict[str, Any]:
        self._go("student_status", token, student_id, status, left_on)
        return student_row(str(student_id), status=status, left_on=left_on.isoformat() if left_on else None)

    def student_erase(self, token: str, tenant_id: uuid.UUID, student_id: uuid.UUID) -> dict[str, Any]:
        self._go("student_erase", token, student_id)
        return {"student_id": str(student_id), "erased": True, "replayed": False}

    def students(self, token: str, tenant_id: uuid.UUID, filters: dict[str, Any], limit: int, after: tuple[datetime, uuid.UUID] | None) -> list[dict[str, Any]]:
        self._go("students", token, filters, limit, after)
        return self.students_rows[:limit]

    def students_import(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, rows: list[dict[str, Any]]) -> dict[str, Any]:
        self._go("students_import", token, batch_id, rows)
        out = [{"row": i + 1, "outcome": "created", "student_id": str(U(int=0x5000 + i)), "contact_id": str(U(int=0x6000 + i)), "contact_created": True} for i in range(len(rows))]
        return {"batch_id": str(batch_id), "rows": out, "counts": {"created": len(rows), "skipped_duplicate": 0, "rejected": 0}}

    # ------------------------------------------------------------------ admissions
    def admission_create(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("admission_create", token, args)
        return {**admission_row(args["p_admission_id"], contact_id=args["p_contact_id"], source=args["p_source"]), "created": True}

    def admission_get(self, token: str, tenant_id: uuid.UUID, admission_id: uuid.UUID) -> dict[str, Any]:
        self._go("admission_get", token, admission_id)
        return {**admission_row(str(admission_id)), "events": [{"stage": "enquiry", "lost_reason": None, "at": NOW}]}

    def admissions(self, token: str, tenant_id: uuid.UUID, filters: dict[str, Any], limit: int, after: tuple[datetime, uuid.UUID] | None) -> list[dict[str, Any]]:
        self._go("admissions", token, filters, limit, after)
        return self.admissions_rows[:limit]

    def admission_stage(self, token: str, tenant_id: uuid.UUID, admission_id: uuid.UUID, stage: str, lost_reason: str | None) -> dict[str, Any]:
        self._go("admission_stage", token, admission_id, stage, lost_reason)
        return {**admission_row(str(admission_id), stage=stage, lost_reason=lost_reason), "replayed": False}

    def admission_admit(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("admission_admit", token, args)
        return {**admission_row(args["p_admission_id"], stage="admitted", student_id=args["p_student_id"]), "replayed": False, "student_created": True,
                "fee_assignment": {"assignment_id": args["p_assignment_id"]} if args["p_plan_id"] else None}  # fmt: skip

    # ------------------------------------------------------------------ fees
    def fee_plan_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("fee_plan_save", token, args)
        return {**plan_row(args["p_plan_id"], name=args["p_name"], academic_year=args["p_academic_year"]), "lines": [{"head": ln["head"], "instalment_no": ln["instalment_no"], "due_date": ln["due_date"], "amount_paise": ln["amount_paise"]} for ln in args["p_lines"]]}

    def fee_plan_get(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID) -> dict[str, Any]:
        self._go("fee_plan_get", token, plan_id)
        return {**plan_row(str(plan_id)), "lines": [{"head": "tuition", "instalment_no": 1, "due_date": "2026-06-10", "amount_paise": 1000000}]}

    def fee_plans(self, token: str, tenant_id: uuid.UUID, programme_id: uuid.UUID | None, include_inactive: bool) -> list[dict[str, Any]]:
        self._go("fee_plans", token, programme_id, include_inactive)
        return [plan_row(str(U(int=0x70)))]

    def fee_assign(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("fee_assign", token, args)
        return {"assignment_id": args["p_assignment_id"], "student_id": args["p_student_id"], "plan_id": args["p_plan_id"], "charges": 5, "total_paise": 3500000, "replayed": False}

    def fee_assignment_void(self, token: str, tenant_id: uuid.UUID, assignment_id: uuid.UUID) -> dict[str, Any]:
        self._go("fee_assignment_void", token, assignment_id)
        return {"assignment_id": str(assignment_id), "voided": True, "charges_voided": 5}

    def fee_payment(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("fee_payment", token, args)
        return {"entry_id": args["p_entry_id"], "receipt_no": "R/2026-27/000001", "replayed": False}

    def fee_concession(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("fee_concession", token, args)
        return {"entry_id": args["p_entry_id"], "amount_paise": 350000 if args["p_mode"] == "percent" else args["p_value"], "replayed": False}

    def fee_adjustment(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._go("fee_adjustment", token, args)
        return {"entry_id": args["p_entry_id"], "replayed": False}

    def fee_statement(self, token: str, tenant_id: uuid.UUID, student_id: uuid.UUID, as_of: date | None) -> dict[str, Any]:
        self._go("fee_statement", token, student_id, as_of)
        return {"student": student_row(str(student_id)), "assignment": {"id": str(U(int=0xA5)), "plan_id": str(U(int=0x70)), "academic_year": "2026-27", "assigned_on": "2026-06-01", "plan_name": "Class 5 fees"}, "statement": STATEMENT}

    def fee_entries(self, token: str, tenant_id: uuid.UUID, student_id: uuid.UUID, limit: int) -> dict[str, Any]:
        self._go("fee_entries", token, student_id, limit)
        return {"account_id": str(U(int=0xAC)), "entries": [{"id": str(U(int=0xE1)), "kind": "payment", "direction": "credit", "amount_paise": 1200000, "entry_date": "2026-06-05", "due_date": None,
                                                                 "reference": None, "method": "cash", "reason_code": None, "receipt_no": "R/2026-27/000001", "against_entry_id": None, "source": "manual", "voided": False}]}  # fmt: skip

    def fee_receipt(self, token: str, tenant_id: uuid.UUID, entry_id: uuid.UUID) -> dict[str, Any]:
        self._go("fee_receipt", token, entry_id)
        return {"receipt_no": "R/2026-27/000001", "received_on": "2026-06-05", "amount_paise": 1200000, "method": "cash", "voided": False, "business_name": "Tenant A", "paid_by": "Rao Parent",
                "student": student_row(), "against": None, "balance_after_paise": 2300000, "recorded_at": NOW}  # fmt: skip

    def fee_guardian(self, token: str, tenant_id: uuid.UUID, contact_id: uuid.UUID, as_of: date | None) -> dict[str, Any]:
        self._go("fee_guardian", token, contact_id, as_of)
        return {"contact_id": str(contact_id), "as_of": "2026-10-14", "students": [{"student_id": STUDENT, "display_name": "Asha", "outstanding_paise": 2300000, "overdue_paise": 1300000}], "outstanding_paise": 2300000, "overdue_paise": 1300000}

    def late_fees_preview(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._go("late_fees_preview", token)
        return {"as_of": "2026-10-14", "count": 1, "total_paise": 50000, "rows": [{"student_id": STUDENT, "charge_id": str(U(int=0xC1)), "amount_paise": 50000, "days_late": 100}]}

    def late_fees_post(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._go("late_fees_post", token)
        return {"as_of": "2026-10-14", "posted": 1, "total_paise": 50000}

    def pending(self, token: str, tenant_id: uuid.UUID, filters: dict[str, Any], limit: int, after: tuple[int, uuid.UUID] | None) -> list[dict[str, Any]]:
        self._go("pending", token, filters, limit, after)
        return [{"student_id": STUDENT, "display_name": "Asha", "programme_name": "Class 5", "group_label": "A", "contact_id": CONTACT, "contact_name": "Rao Parent", "pending_paise": 750000, "due_paise": 2000000, "overdue_days": 126}][:limit]

    # ------------------------------------------------------------------ announcements and reports
    def audience(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, filter_: dict[str, Any]) -> dict[str, Any]:
        self._go("audience", token, campaign_id, filter_)
        return {"added": 2, "skipped": [{"row": 3, "reason": "no_contact"}], "recipients": 2}

    def report(self, token: str, tenant_id: uuid.UUID, code: str, date_from: date | None, date_to: date | None) -> dict[str, Any]:
        self._go("report", token, code, date_from, date_to)
        return {"report": code, "as_of": "2026-10-14", "from": "2026-04-01", "to": "2026-10-14", "kpis": [{"key": "collection_pct", "value": 53.8, "unit": "percent"}],
                "tables": [{"key": "by_programme", "columns": [{"key": "programme", "type": "text"}, {"key": "pending_paise", "type": "paise"}], "rows": [["Class 5", 2500000]]}],
                "series": [{"key": "collection_by_day", "points": [{"day": "2026-06-05", "value": 1000000}]}]}  # fmt: skip
