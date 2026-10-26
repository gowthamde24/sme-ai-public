"""What the routes call (job DR B1): plan, answer, review, approve, run, report. The model is reached only by the Planner; the people only by the resolver; the sending only by the runner through the outbox; the numbers (estimate, cap, short answer) only by code."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import TYPE_CHECKING, Any

from app.errors import ApiError
from app.tasks import report as report_module
from app.tasks import templates
from app.tasks.dialer import Dialer, FakeDialer
from app.tasks.knowledge import KnowledgeBase, NoKnowledge
from app.tasks.models import (
    AnswerIn,
    Estimate,
    PlanIn,
    PlanOut,
    Progress,
    ReportOut,
    SampleContact,
    TaskContactOut,
    TaskContactsOut,
    TaskOut,
    TemplatesOut,
)
from app.tasks.repository import TasksRepository
from app.tasks.runner import TaskRunner

if TYPE_CHECKING:   # the runtime holds this service: the import is for types only
    from app.auth.deps import Runtime
    from app.tasks.planner import Planned

NOTES_TEXT = {
    "promotional_calls_off": "Promotional calls are off: WhatsApp only.",
    "unmatched_numbers": "Some numbers you gave are not among your contacts and will not be contacted.",
    "capped_at_500": "A task has at most 500 people; the first 500 are in.",
    "some_skipped": "Some people are skipped (stopped, erased, no phone or no consent).",
    "nobody_found": "Nobody in your contacts fits this yet, so there is no one to contact. Say who, or give a list of numbers.",
}


class TasksService:
    def __init__(self, repository: TasksRepository, dialer: Dialer | None = None, knowledge: KnowledgeBase | None = None) -> None:
        self._repo = repository
        self._dialer: Dialer = dialer or FakeDialer()
        self._knowledge: KnowledgeBase = knowledge or NoKnowledge()

    # ------------------------------------------------------------------------------------------------ shapes
    @staticmethod
    def _out(raw: dict[str, Any]) -> TaskOut:
        plan = raw.get("plan")
        plan_out = None
        if plan:
            plan_out = PlanOut(
                channel=plan["channel"], goal=plan["goal"], questions=plan.get("questions") or [], script_notes=plan.get("script_notes") or "", message_text=plan.get("message_text"),
                window=plan["window"], follow_up=plan["follow_up"], contacts_total=int(plan.get("contacts_total") or 0),
                contacts_sample=[SampleContact(contact_id=s["contact_id"], name=s.get("name")) for s in raw.get("contacts_sample") or []],
                unmatched=plan.get("unmatched") or [], notes=[NOTES_TEXT.get(n, n) for n in plan.get("notes") or []],
            )
        estimate = raw.get("estimate") or None
        return TaskOut(
            id=raw["id"], status=raw["status"], instruction=raw["instruction"], language=raw["language"], template=raw["template"], question=raw.get("question"), plan=plan_out,
            estimate=Estimate(**estimate) if estimate else None, cap_paise=raw.get("cap_paise"), spent_paise=int(raw.get("spent_paise") or 0), pause_reason=raw.get("pause_reason"),
            progress=Progress(**raw["progress"]), plan_sha256=raw.get("plan_sha256"), created_at=str(raw["created_at"]), approved_at=raw.get("approved_at"), finished_at=raw.get("finished_at"),
        )

    # ------------------------------------------------------------------------------------------------ plan
    def templates(self, school: bool) -> TemplatesOut:
        return TemplatesOut(templates=templates.listing(school=school))  # type: ignore[arg-type]

    def _school(self, runtime: Runtime, token: str, tenant_id: uuid.UUID) -> bool:
        try:
            return bool(self._repo.context(token, tenant_id).get("school"))   # the database knows (the API never reads a pack id)
        except Exception:   # an unreadable answer is treated as not a school by the API; the database decides again when the task is saved (SM951)
            return False

    def plan(self, runtime: Runtime, token: str, tenant_id: uuid.UUID, tenant_name: str, body: PlanIn, refusal: Any) -> TaskOut:
        task_id = uuid.UUID(str(body.task_id)) if body.task_id else uuid.uuid4()
        if body.task_id:
            try:
                existing = self._repo.get(token, tenant_id, task_id)
            except Exception:
                existing = None
            if existing is not None:   # the same id again is a replay: what is stored is the answer
                return self._out(existing)
        school = self._school(runtime, token, tenant_id)
        from app.tasks.planner import Planner

        planned = Planner(runtime, self._knowledge).plan(
            token=token, tenant_id=tenant_id, tenant_name=tenant_name, instruction=body.instruction, language=body.language, provided=body.contacts, answer=None, question=None, school=school, refusal=refusal,
        )
        return self._save(token, tenant_id, task_id, body.instruction, body.language, planned, answer=None)

    def answer(self, runtime: Runtime, token: str, tenant_id: uuid.UUID, tenant_name: str, task_id: uuid.UUID, body: AnswerIn, refusal: Any) -> TaskOut:
        current = self._repo.get(token, tenant_id, task_id)
        if current["status"] != "needs_answer":
            raise ApiError(409, "task_state", "That task is not waiting for an answer.")
        school = self._school(runtime, token, tenant_id)
        from app.tasks.planner import Planner

        planned = Planner(runtime, self._knowledge).plan(
            token=token, tenant_id=tenant_id, tenant_name=tenant_name, instruction=current["instruction"], language=current["language"], provided=None, answer=body.answer,
            question=current.get("question"), school=school, refusal=refusal,
        )
        return self._save(token, tenant_id, task_id, current["instruction"], current["language"], planned, answer=body.answer)

    def _save(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, instruction: str, language: str | None, planned: Planned, answer: str | None) -> TaskOut:
        from app.assistant.language import detect_language

        chosen = language or detect_language(instruction)
        contacts = None
        if planned.question is None:
            contacts = [{"contact_id": str(p.contact_id), "lead_id": str(p.lead_id), "skip_reason": planned.skips.get(p.contact_id)} for p in planned.people]
        args = {
            "p_tenant_id": str(tenant_id), "p_task_id": str(task_id), "p_instruction": instruction, "p_language": chosen,
            "p_status": "needs_answer" if planned.question else "planned", "p_template": planned.template, "p_question": planned.question, "p_answer": answer,
            "p_plan": planned.plan, "p_estimate": planned.estimate, "p_estimated_paise": int((planned.estimate or {}).get("cost_paise") or 0), "p_contacts": contacts,
        }
        self._repo.save(token, args)
        return self._out(self._repo.get(token, tenant_id, task_id))

    # ------------------------------------------------------------------------------------------------ read and review
    def get(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID) -> TaskOut:
        return self._out(self._repo.get(token, tenant_id, task_id))

    def list_tasks(self, token: str, tenant_id: uuid.UUID, status: str | None, limit: int, before: datetime | None) -> list[TaskOut]:
        return [self._out({**raw, "contacts_sample": []}) for raw in self._repo.list_tasks(token, tenant_id, status, limit, before)]

    def contacts(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, status: str | None, limit: int, after_seq: int | None) -> TaskContactsOut:
        rows = self._repo.contacts(token, tenant_id, task_id, status, limit + 1, after_seq)
        more = len(rows) > limit
        rows = rows[:limit]
        items = [TaskContactOut(**{k: v for k, v in r.items() if k in TaskContactOut.model_fields}) for r in rows]   # the database row also holds the message status and the cursor; the list shows neither
        return TaskContactsOut(contacts=items, next_cursor=str(rows[-1]["seq"]) if more and rows else None)

    def exclude(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, contact_ids: list[uuid.UUID], excluded: bool) -> TaskOut:
        self._repo.exclude(token, tenant_id, task_id, contact_ids, excluded)
        return self.get(token, tenant_id, task_id)

    def approve(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, plan_sha256: str, cap_paise: int | None) -> TaskOut:
        self._repo.approve(token, tenant_id, task_id, plan_sha256, cap_paise)
        return self.get(token, tenant_id, task_id)

    def set_cap(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, cap_paise: int) -> TaskOut:
        self._repo.set_cap(token, tenant_id, task_id, cap_paise)
        return self.get(token, tenant_id, task_id)

    def set_state(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, action: str) -> TaskOut:
        self._repo.set_state(token, tenant_id, task_id, action)
        return self.get(token, tenant_id, task_id)

    # ------------------------------------------------------------------------------------------------ run and report
    def run(self, runtime: Runtime, token: str, tenant_id: uuid.UUID, tenant_name: str, task_id: uuid.UUID) -> None:
        """Process what is waiting (called after the approval, in the background, and by POST /tasks/{id}/run)."""
        TaskRunner(self._repo, self._dialer, runtime.outbox).run(token, tenant_id, tenant_name, task_id)

    def report(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID) -> ReportOut:
        raw = self._repo.report(token, tenant_id, task_id)
        return ReportOut.model_validate(report_module.build(raw, raw["language"]))
