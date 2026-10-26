"""Running an approved task (job DR B1): for each person, one at a time, through the pipelines that exist, all of them fake today.

  * a CALL goes to the Dialer (the FAKE dialer: a simulated, deterministic conversation; nothing is dialled),
  * a WHATSAPP message is submitted to the OUTBOX like any other message (the approver's own token; a deterministic message id per task and person, so a retry never sends twice), and the outbox applies its own rules: opt-in, STOP, quiet hours, the daily limit, the content flags, the kill switches. What it holds for a person stays held.

The cost is counted here from the fake rates and added by the database; when the cap is reached the database pauses the task (a Needs-you item). A refused token stops the run; what was claimed and not finished is taken back after five minutes (POST /tasks/{id}/run continues).
Skipped with a closed reason, never contacted: a suppressed, erased or archived person, a person with no phone, a person who withdrew call consent (for a call)."""

from __future__ import annotations

import logging
import uuid
from typing import Any

from app.outbox.repository import OutboxRepository
from app.tasks import compose, cost
from app.tasks.dialer import Dialer, has_ai_disclosure
from app.tasks.repository import TasksRepository
from app.tenancy.repository import RepositoryError, TokenRejected

logger = logging.getLogger("app.tasks.runner")
MAX_STEPS = 600   # a task has at most 500 people; the bound keeps a bug from looping


class TaskRunner:
    def __init__(self, repository: TasksRepository, dialer: Dialer, outbox: OutboxRepository | None = None) -> None:
        self._repo, self._dialer, self._outbox = repository, dialer, outbox

    def run(self, token: str, tenant_id: uuid.UUID, tenant_name: str, task_id: uuid.UUID) -> dict[str, Any]:
        """Process until nothing is left to do, the task pauses (cap, owner) or ends. Returns the last state of the task."""
        task: dict[str, Any] = {}
        for _ in range(MAX_STEPS):
            claimed = self._repo.claim(token, tenant_id, task_id, 1)
            task = claimed["task"]
            rows = claimed.get("claimed") or []
            if not rows:
                break
            result = self._one(token, tenant_id, tenant_name, task, rows[0])
            task = self._repo.result(token, tenant_id, task_id, uuid.UUID(str(rows[0]["id"])), result)
            if task["status"] not in ("running", "approved"):
                break
        return task

    def _one(self, token: str, tenant_id: uuid.UUID, tenant_name: str, task: dict[str, Any], row: dict[str, Any]) -> dict[str, Any]:
        plan = task.get("plan") or {}
        channel = plan.get("channel", "call")
        language = task.get("language", "en")
        if row.get("erased"):
            return {"status": "skipped", "skip_reason": "erased"}
        if row.get("archived"):
            return {"status": "skipped", "skip_reason": "archived"}
        if row.get("suppressed"):
            return {"status": "skipped", "skip_reason": "suppressed"}
        if not row.get("phone"):
            return {"status": "skipped", "skip_reason": "no_phone"}
        if channel == "call" and row.get("phone_consent") == "withdrawn":
            return {"status": "skipped", "skip_reason": "opted_out"}
        result: dict[str, Any] = {"status": "done", "simulated": True, "cost_paise": 0}
        spent = 0
        called = None
        if channel in ("call", "both"):
            called = self._dialer.call(
                business=tenant_name, language=language, questions=plan.get("questions") or [], template=task.get("template", "custom"), seed=f"{task['id']}|{row['contact_id']}",
            )
            if called.transcript and not has_ai_disclosure(called.transcript[0]["text"]):
                return {"status": "failed", "simulated": True, "cost_paise": called.minutes * cost.CALL_PAISE_PER_MINUTE, "outcome": "failed", "transcript": called.transcript}
            spent += called.minutes * cost.CALL_PAISE_PER_MINUTE
            result.update({"outcome": called.outcome, "category": called.category, "captured": called.captured, "transcript": called.transcript or None, "recording_ref": called.recording_ref})
        wants_message = channel in ("whatsapp", "both") or (called is not None and plan.get("follow_up", {}).get("kind") == "whatsapp_summary" and called.outcome in ("positive", "unclear"))
        if wants_message:
            status = self._message(token, tenant_id, tenant_name, task, row, language, summary=called is not None)
            spent += cost.MESSAGE_PAISE if status != "failed" else 0
            result["message_status"] = status
            result["message_id"] = str(compose.message_id(uuid.UUID(str(task["id"])), uuid.UUID(str(row["contact_id"])), "summary" if called is not None else "task"))
            if called is None:
                result["outcome"] = "unclear"
                if status == "failed":
                    result["status"] = "failed"
                    result["outcome"] = "failed"
        result["cost_paise"] = spent
        return result

    def _message(self, token: str, tenant_id: uuid.UUID, tenant_name: str, task: dict[str, Any], row: dict[str, Any], language: str, *, summary: bool) -> str:
        if self._outbox is None:
            return "failed"
        plan = task.get("plan") or {}
        body = compose.summary_text(language, tenant_name) if summary else (plan.get("message_text") or compose.ask_text(language, tenant_name))
        args = {
            "p_message_id": str(compose.message_id(uuid.UUID(str(task["id"])), uuid.UUID(str(row["contact_id"])), "summary" if summary else "task")),
            "p_tenant_id": str(tenant_id), "p_lead_id": str(row["lead_id"]), "p_channel": "whatsapp", "p_body": body, "p_language": language,
            "p_category": "followup", "p_source": "assistant", "p_model_flagged": False, "p_uncertain": False,
        }
        try:
            answer = self._outbox.submit(token, args)
        except TokenRejected:
            raise
        except RepositoryError:
            logger.warning("task message was refused by the outbox")
            return "failed"
        status = str(answer.get("status") or "")
        return status if status in ("queued", "needs_approval", "sent", "blocked") else "failed"
