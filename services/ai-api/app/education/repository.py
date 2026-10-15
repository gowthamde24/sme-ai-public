"""The education pack behind an interface (Supabase PostgREST today; job CR, ADR 0087). Every call carries the CALLER's token; every function is a SECURITY DEFINER function of migrations 20261125090000 to
20261125090300 that proves the role first. A model never reads any of this: no agent tool, assistant tool or prompt builder imports this module (a test fails if one does), because a student is a child."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Protocol

import httpx

from app.education.errors import (
    AdmissionNumberUsedError,
    AdmissionStageError,
    FeePlanExistsError,
    FeePlanInUseError,
    StudentInactiveError,
)
from app.packs.errors import ModuleOffError
from app.rpc_base import RpcClient


class EducationRepository(Protocol):
    def profile_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def profile_set(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def programmes(self, token: str, tenant_id: uuid.UUID, include_inactive: bool) -> list[dict[str, Any]]: ...
    def programme_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def group_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def student_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def student_get(self, token: str, tenant_id: uuid.UUID, student_id: uuid.UUID) -> dict[str, Any]: ...
    def student_status(self, token: str, tenant_id: uuid.UUID, student_id: uuid.UUID, status: str, left_on: date | None) -> dict[str, Any]: ...
    def student_erase(self, token: str, tenant_id: uuid.UUID, student_id: uuid.UUID) -> dict[str, Any]: ...
    def students(self, token: str, tenant_id: uuid.UUID, filters: dict[str, Any], limit: int, after: tuple[datetime, uuid.UUID] | None) -> list[dict[str, Any]]: ...
    def students_import(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, rows: list[dict[str, Any]]) -> dict[str, Any]: ...
    def admission_create(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def admission_get(self, token: str, tenant_id: uuid.UUID, admission_id: uuid.UUID) -> dict[str, Any]: ...
    def admissions(self, token: str, tenant_id: uuid.UUID, filters: dict[str, Any], limit: int, after: tuple[datetime, uuid.UUID] | None) -> list[dict[str, Any]]: ...
    def admission_stage(self, token: str, tenant_id: uuid.UUID, admission_id: uuid.UUID, stage: str, lost_reason: str | None) -> dict[str, Any]: ...
    def admission_admit(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def fee_plan_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def fee_plan_get(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID) -> dict[str, Any]: ...
    def fee_plans(self, token: str, tenant_id: uuid.UUID, programme_id: uuid.UUID | None, include_inactive: bool) -> list[dict[str, Any]]: ...
    def fee_assign(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def fee_assignment_void(self, token: str, tenant_id: uuid.UUID, assignment_id: uuid.UUID) -> dict[str, Any]: ...
    def fee_payment(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def fee_concession(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def fee_adjustment(self, token: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def fee_statement(self, token: str, tenant_id: uuid.UUID, student_id: uuid.UUID, as_of: date | None) -> dict[str, Any]: ...
    def fee_entries(self, token: str, tenant_id: uuid.UUID, student_id: uuid.UUID, limit: int) -> dict[str, Any]: ...
    def fee_receipt(self, token: str, tenant_id: uuid.UUID, entry_id: uuid.UUID) -> dict[str, Any]: ...
    def fee_guardian(self, token: str, tenant_id: uuid.UUID, contact_id: uuid.UUID, as_of: date | None) -> dict[str, Any]: ...
    def late_fees_preview(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def late_fees_post(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def pending(self, token: str, tenant_id: uuid.UUID, filters: dict[str, Any], limit: int, after: tuple[int, uuid.UUID] | None) -> list[dict[str, Any]]: ...
    def audience(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, filter_: dict[str, Any]) -> dict[str, Any]: ...
    def report(self, token: str, tenant_id: uuid.UUID, code: str, date_from: date | None, date_to: date | None) -> dict[str, Any]: ...


class PostgrestEducationRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._rpc = RpcClient(
            rest_url,
            anon_key,
            {"SM701": ModuleOffError, "SM811": AdmissionNumberUsedError, "SM812": AdmissionStageError, "SM813": FeePlanInUseError, "SM814": FeePlanExistsError, "SM815": StudentInactiveError},
            client=client,
        )

    def close(self) -> None:
        self._rpc.close()

    @staticmethod
    def _t(tenant_id: uuid.UUID) -> dict[str, Any]:
        return {"p_tenant_id": str(tenant_id)}

    # ------------------------------------------------------------------ profile and structure
    def profile_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "institution_profile_get", self._t(tenant_id))

    def profile_set(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "institution_profile_set", args)

    def programmes(self, token: str, tenant_id: uuid.UUID, include_inactive: bool) -> list[dict[str, Any]]:
        return self._rpc.array(token, "programmes_list", {**self._t(tenant_id), "p_include_inactive": include_inactive})

    def programme_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "programme_save", args)

    def group_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "programme_group_save", args)

    # ------------------------------------------------------------------ students
    def student_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "student_save", args)

    def student_get(self, token: str, tenant_id: uuid.UUID, student_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "student_get", {**self._t(tenant_id), "p_student_id": str(student_id)})

    def student_status(self, token: str, tenant_id: uuid.UUID, student_id: uuid.UUID, status: str, left_on: date | None) -> dict[str, Any]:
        return self._rpc.object(token, "student_set_status", {**self._t(tenant_id), "p_student_id": str(student_id), "p_status": status, "p_left_on": left_on.isoformat() if left_on else None})

    def student_erase(self, token: str, tenant_id: uuid.UUID, student_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "student_erase", {**self._t(tenant_id), "p_student_id": str(student_id)})

    def students(self, token: str, tenant_id: uuid.UUID, filters: dict[str, Any], limit: int, after: tuple[datetime, uuid.UUID] | None) -> list[dict[str, Any]]:
        return self._rpc.array(
            token,
            "students_list",
            {
                **self._t(tenant_id),
                "p_programme_id": filters.get("programme_id"),
                "p_group_id": filters.get("group_id"),
                "p_status": filters.get("status"),
                "p_contact_id": filters.get("contact_id"),
                "p_limit": limit,
                "p_after_created": after[0].isoformat() if after else None,
                "p_after_id": str(after[1]) if after else None,
            },
        )

    def students_import(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, rows: list[dict[str, Any]]) -> dict[str, Any]:
        return self._rpc.object(token, "students_import", {**self._t(tenant_id), "p_batch_id": str(batch_id), "p_rows": rows})

    # ------------------------------------------------------------------ admissions
    def admission_create(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "admission_create", args)

    def admission_get(self, token: str, tenant_id: uuid.UUID, admission_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "admission_get", {**self._t(tenant_id), "p_admission_id": str(admission_id)})

    def admissions(self, token: str, tenant_id: uuid.UUID, filters: dict[str, Any], limit: int, after: tuple[datetime, uuid.UUID] | None) -> list[dict[str, Any]]:
        return self._rpc.array(
            token,
            "admissions_list",
            {
                **self._t(tenant_id),
                "p_stage": filters.get("stage"),
                "p_programme_id": filters.get("programme_id"),
                "p_source": filters.get("source"),
                "p_limit": limit,
                "p_after_created": after[0].isoformat() if after else None,
                "p_after_id": str(after[1]) if after else None,
            },
        )

    def admission_stage(self, token: str, tenant_id: uuid.UUID, admission_id: uuid.UUID, stage: str, lost_reason: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "admission_stage_set", {**self._t(tenant_id), "p_admission_id": str(admission_id), "p_stage": stage, "p_lost_reason": lost_reason})

    def admission_admit(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "admission_admit", args)

    # ------------------------------------------------------------------ fees
    def fee_plan_save(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "fee_plan_save", args)

    def fee_plan_get(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "fee_plan_get", {**self._t(tenant_id), "p_plan_id": str(plan_id)})

    def fee_plans(self, token: str, tenant_id: uuid.UUID, programme_id: uuid.UUID | None, include_inactive: bool) -> list[dict[str, Any]]:
        return self._rpc.array(token, "fee_plans_list", {**self._t(tenant_id), "p_programme_id": str(programme_id) if programme_id else None, "p_include_inactive": include_inactive})

    def fee_assign(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "fee_assign", args)

    def fee_assignment_void(self, token: str, tenant_id: uuid.UUID, assignment_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "fee_assignment_void", {**self._t(tenant_id), "p_assignment_id": str(assignment_id)})

    def fee_payment(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "fee_payment_record", args)

    def fee_concession(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "fee_concession_apply", args)

    def fee_adjustment(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "fee_adjustment_record", args)

    def fee_statement(self, token: str, tenant_id: uuid.UUID, student_id: uuid.UUID, as_of: date | None) -> dict[str, Any]:
        return self._rpc.object(token, "fee_statement", {**self._t(tenant_id), "p_student_id": str(student_id), "p_as_of": as_of.isoformat() if as_of else None})

    def fee_entries(self, token: str, tenant_id: uuid.UUID, student_id: uuid.UUID, limit: int) -> dict[str, Any]:
        return self._rpc.object(token, "fee_entries_list", {**self._t(tenant_id), "p_student_id": str(student_id), "p_limit": limit})

    def fee_receipt(self, token: str, tenant_id: uuid.UUID, entry_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "fee_receipt_get", {**self._t(tenant_id), "p_entry_id": str(entry_id)})

    def fee_guardian(self, token: str, tenant_id: uuid.UUID, contact_id: uuid.UUID, as_of: date | None) -> dict[str, Any]:
        return self._rpc.object(token, "fee_guardian_statement", {**self._t(tenant_id), "p_contact_id": str(contact_id), "p_as_of": as_of.isoformat() if as_of else None})

    def late_fees_preview(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "fee_late_fees_preview", self._t(tenant_id))

    def late_fees_post(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "fee_late_fees_post", self._t(tenant_id))

    def pending(self, token: str, tenant_id: uuid.UUID, filters: dict[str, Any], limit: int, after: tuple[int, uuid.UUID] | None) -> list[dict[str, Any]]:
        return self._rpc.array(
            token,
            "fee_pending_list",
            {
                **self._t(tenant_id),
                "p_as_of": filters.get("as_of"),
                "p_programme_id": filters.get("programme_id"),
                "p_group_id": filters.get("group_id"),
                "p_limit": limit,
                "p_after_paise": after[0] if after else None,
                "p_after_id": str(after[1]) if after else None,
            },
        )

    # ------------------------------------------------------------------ announcements and reports
    def audience(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, filter_: dict[str, Any]) -> dict[str, Any]:
        return self._rpc.object(token, "campaign_recipients_from_students", {**self._t(tenant_id), "p_campaign_id": str(campaign_id), "p_filter": filter_})

    def report(self, token: str, tenant_id: uuid.UUID, code: str, date_from: date | None, date_to: date | None) -> dict[str, Any]:
        return self._rpc.object(
            token, "education_report", {**self._t(tenant_id), "p_code": code, "p_from": date_from.isoformat() if date_from else None, "p_to": date_to.isoformat() if date_to else None}
        )
