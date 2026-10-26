"""In-memory doubles for job DR B1 (no database, no network): the assistant's database door with a few leads and contacts, a scripted model that can call tools, and a task repository that keeps the database's state machine (a plan hash, one approval, the cap, claim and result). The database's own rules are proved in supabase/tests/database/127_dr_tasks.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import json
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from app.agents.llm.interface import LlmRequest, LlmResponse, ToolCall, Usage
from app.errors import ApiError
from app.tasks.errors import NotForSchoolsError, PlanChangedError, TaskStateError

NOW = datetime(2026, 11, 2, 7, 0, tzinfo=UTC)


def uid(n: int) -> str:
    return str(uuid.UUID(int=n))


# name, phone, status, days old, whatsapp consent, flags
PEOPLE: list[dict[str, Any]] = [
    {"n": 1, "name": "Anu Reddy", "phone": "+91 98765 00001", "status": "new", "age": 2, "wa": "granted"},
    {"n": 2, "name": "Babu Rao", "phone": "+91 98765 00002", "status": "new", "age": 3, "wa": "unknown"},
    {"n": 3, "name": "Chitra Devi", "phone": "+91 98765 00003", "status": "qualified", "age": 60, "wa": "granted"},
    {"n": 4, "name": "Dinesh Kumar", "phone": "+91 98765 00004", "status": "in_review", "age": 45, "wa": "unknown"},
    {"n": 5, "name": "Eswar Stopped", "phone": "+91 98765 00005", "status": "new", "age": 1, "wa": "withdrawn", "suppressed": True},
    {"n": 6, "name": "Farida NoPhone", "phone": None, "status": "new", "age": 1, "wa": "unknown"},
    {"n": 7, "name": "Gopal Erased", "phone": "+91 98765 00007", "status": "new", "age": 1, "wa": "unknown", "erased": True},
]


def _iso(days: int) -> str:
    return str((NOW.replace(microsecond=0) - timedelta(days=days)).isoformat())


class FakeDb:
    """The parts of the assistant's database door that the planner and the resolver use."""

    def __init__(self, people: list[dict[str, Any]] | None = None) -> None:
        self.people = PEOPLE if people is None else people
        self.calls: list[tuple[str, Any]] = []
        self.closed = False

    # reads (the caller's own rows)
    def rest_rows(self, what: str, path: str, params: dict[str, str]) -> list[dict[str, Any]]:
        self.calls.append(("rest_rows", (path, dict(params))))
        if path == "/leads":
            rows = [p for p in self.people if p.get("lead", True)]
            if params.get("status", "").startswith("eq."):
                rows = [p for p in rows if p["status"] == params["status"][3:]]
            elif params.get("status") == "neq.disqualified":
                rows = [p for p in rows if p["status"] != "disqualified"]
            if "created_at" in params:
                op, _, stamp = params["created_at"].partition(".")
                cutoff = datetime.fromisoformat(stamp)
                rows = [p for p in rows if (NOW - timedelta(days=p["age"]) >= cutoff) == (op == "gte")]
            if params.get("contact_id", "").startswith("in."):
                ids = set(params["contact_id"][4:-1].split(","))
                rows = [p for p in rows if uid(p["n"]) in ids]
            return [{"id": uid(1000 + p["n"]), "contact_id": uid(p["n"]), "status": p["status"], "created_at": _iso(p["age"])} for p in rows][: int(params.get("limit", "500"))]
        if path == "/contacts":
            rows = list(self.people)
            if params.get("id", "").startswith("in."):
                ids = set(params["id"][4:-1].split(","))
                rows = [p for p in rows if uid(p["n"]) in ids]
            if params.get("full_name", "").startswith("ilike."):
                needle = params["full_name"][6:].strip("*").lower()
                rows = [p for p in rows if needle in p["name"].lower()]
            if "or" in params:
                tails = re.findall(r"phone\.ilike\.\*(\d+)\*", params["or"])
                rows = [p for p in rows if p["phone"] and any(re.sub(r"\D", "", p["phone"]).endswith(t) for t in tails)]
            if "select" in params and params["select"] == "id":
                return [{"id": uid(p["n"])} for p in rows]
            return [
                {"id": uid(p["n"]), "full_name": p["name"], "phone": p["phone"], "whatsapp_consent": p["wa"], "phone_consent": "unknown",
                 "suppressed_at": "2026-10-01T00:00:00Z" if p.get("suppressed") else None, "erased_at": "2026-10-01T00:00:00Z" if p.get("erased") else None, "archived_at": None}
                for p in rows
            ]
        return []

    def begin_message(self, **kw: Any) -> dict[str, Any]:
        self.calls.append(("begin_message", kw))
        return {"seq": 1}

    def ai_mode(self, light_model: str) -> str:
        return "normal"

    def reserve_cost(self, key: str, **kw: Any) -> None:
        self.calls.append(("reserve_cost", (key, kw)))

    def release_cost(self, key: str, *, reason: str) -> None:
        self.calls.append(("release_cost", (key, reason)))

    def record_usage(self, key: str, usage: Usage) -> None:
        self.calls.append(("record_usage", (key, usage)))

    def save_reply(self, **kw: Any) -> None:
        self.calls.append(("save_reply", kw))

    def finish(self, status: str, code: str | None) -> None:
        self.calls.append(("finish", (status, code)))

    def close(self) -> None:
        self.closed = True

    def names(self) -> list[str]:
        return [c[0] for c in self.calls]


class Scripted:
    """A model that answers from a script: each answer is a structured plan, a list of tool calls, or an error."""

    model_id = "fake-selftest"

    def __init__(self, *answers: Any) -> None:
        self.answers = list(answers)
        self.requests: list[LlmRequest] = []

    def complete(self, request: LlmRequest) -> LlmResponse:
        self.requests.append(request)
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        if isinstance(answer, list):
            return LlmResponse(tool_calls=tuple(ToolCall(name, args) for name, args in answer), structured=None, usage=Usage(100, 40, 0))
        return LlmResponse(tool_calls=(), structured=answer, usage=Usage(200, 120, 0))


def plan_answer(**changes: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "template": "call_new_leads", "channel": "call", "goal": "Find out what each new lead needs",
        "questions": [{"key": "need", "text": "What do you need?", "type": "text"}],
        "script_notes": "Be brief.", "message_text": None,
        "window": {"date": "today", "from_minute": 600, "to_minute": 1140}, "follow_up": {"kind": "none", "after_hours": 24},
        "selectors": [{"segment": "new_leads"}], "clarifying_question": None,
    }
    base.update(changes)
    return base


class FakeTasksRepository:
    """The database's task functions, in memory (same states, same refusals as migration 20261207090000)."""

    def __init__(self, school: bool = False) -> None:
        self.tasks: dict[uuid.UUID, dict[str, Any]] = {}
        self.rows: dict[uuid.UUID, list[dict[str, Any]]] = {}
        self.school = school
        self.calls: list[str] = []
        self.stuck_token_error: Exception | None = None

    # -- helpers
    def _sha(self, task_id: uuid.UUID) -> str:
        t = self.tasks[task_id]
        waiting = sorted(str(r["contact_id"]) for r in self.rows[task_id] if r["status"] == "waiting")
        return hashlib.sha256("|".join([t["template"], json.dumps(t["plan"], sort_keys=True), str(t["estimated_paise"]), ",".join(waiting)]).encode()).hexdigest()

    def _json(self, task_id: uuid.UUID) -> dict[str, Any]:
        t = self.tasks[task_id]
        rows = self.rows[task_id]
        counts = {s: sum(1 for r in rows if r["status"] == s) for s in ("excluded", "waiting", "in_progress", "done", "failed", "skipped")}
        progress = {"total": len(rows), **counts, "reached": sum(1 for r in rows if r["status"] == "done" and r.get("outcome") in ("positive", "negative", "unclear")),
                    "positive": sum(1 for r in rows if r["status"] == "done" and r.get("outcome") == "positive")}
        sample = [{"contact_id": str(r["contact_id"]), "name": r["name"]} for r in rows if r["status"] != "excluded"][:5]
        return {**t, "progress": progress, "contacts_sample": sample}

    # -- the interface
    def save(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self.calls.append("save")
        task_id = uuid.UUID(args["p_task_id"])
        text = " ".join([args["p_instruction"], json.dumps(args["p_plan"] or {})])
        if self.school and (args["p_template"] == "payment_reminder" or re.search(r"\b(fees?|dues?|marks)\b", text, re.I)):
            raise NotForSchoolsError("SM951")
        existing = self.tasks.get(task_id)
        if existing is not None and existing["status"] not in ("needs_answer", "planned"):
            raise TaskStateError("SM953")
        self.tasks[task_id] = {
            "id": str(task_id), "status": args["p_status"], "instruction": args["p_instruction"], "language": args["p_language"], "template": args["p_template"], "question": args["p_question"],
            "plan": args["p_plan"], "estimate": args["p_estimate"] or {}, "estimated_paise": args["p_estimated_paise"], "cap_paise": None, "spent_paise": 0, "pause_reason": None,
            "plan_sha256": None, "approved_at": None, "finished_at": None, "created_at": NOW.isoformat(), "updated_at": NOW.isoformat(),
        }
        if args["p_contacts"] is not None:
            self.rows[task_id] = [
                {"id": str(uuid.uuid4()), "contact_id": c["contact_id"], "lead_id": c["lead_id"], "name": f"Person {c['contact_id'][-2:]}", "status": "skipped" if c.get("skip_reason") else "waiting",
                 "skip_reason": c.get("skip_reason"), "outcome": None, "category": None, "captured": None, "transcript": None, "simulated": True, "message_status": None, "cost_paise": 0}
                for c in args["p_contacts"]
            ]
        self.rows.setdefault(task_id, [])
        self.tasks[task_id]["plan_sha256"] = self._sha(task_id)
        return self._json(task_id)

    def get(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID) -> dict[str, Any]:
        if task_id not in self.tasks:
            from app.crm.repository import NotFoundError

            raise NotFoundError("23503")
        return self._json(task_id)

    def list_tasks(self, token: str, tenant_id: uuid.UUID, status: str | None, limit: int, before: Any) -> list[dict[str, Any]]:
        return [self._json(t) for t in self.tasks if status is None or self.tasks[t]["status"] == status][:limit]

    def contacts(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, status: str | None, limit: int, after_seq: int | None) -> list[dict[str, Any]]:
        out = []
        for seq, r in enumerate(self.rows[task_id], start=1):
            if (status is None or r["status"] == status) and (after_seq is None or seq > after_seq):
                out.append({"id": r["id"], "contact_id": r["contact_id"], "name": r["name"], "phone_last4": "0001", "status": r["status"], "skip_reason": r["skip_reason"], "outcome": r["outcome"],
                            "outcome_category": r["category"], "captured": r["captured"], "simulated": True, "seq": seq, "message_status": r["message_status"]})   # like the database row
        return out[:limit]

    def context(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return {"school": self.school}

    def report(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID) -> dict[str, Any]:
        base = self._json(task_id)
        base["rows"] = [
            {"contact_id": r["contact_id"], "name": r["name"], "phone_last4": "0001", "status": r["status"], "skip_reason": r["skip_reason"], "outcome": r["outcome"], "outcome_category": r["category"],
             "captured": r["captured"], "transcript": r["transcript"], "message_status": r["message_status"], "simulated": True}
            for r in self.rows[task_id] if r["status"] != "excluded"
        ]
        return base

    def exclude(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, contact_ids: list[uuid.UUID], excluded: bool) -> dict[str, Any]:
        if self.tasks[task_id]["status"] != "planned":
            raise TaskStateError("SM953")
        for r in self.rows[task_id]:
            if uuid.UUID(str(r["contact_id"])) in contact_ids:
                if excluded and r["status"] == "waiting":
                    r["status"] = "excluded"
                elif not excluded and r["status"] == "excluded":
                    r["status"] = "waiting"
        self.tasks[task_id]["plan_sha256"] = self._sha(task_id)
        return self._json(task_id)

    def approve(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, plan_sha256: str, cap_paise: int | None) -> dict[str, Any]:
        t = self.tasks[task_id]
        if t["status"] != "planned":
            raise TaskStateError("SM953")
        if plan_sha256 != t["plan_sha256"]:
            raise PlanChangedError("SM952")
        t.update(status="approved", approved_at=NOW.isoformat(), cap_paise=cap_paise if cap_paise is not None else (t["estimated_paise"] * 12 + 9) // 10)
        return self._json(task_id)

    def set_cap(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, cap_paise: int) -> dict[str, Any]:
        self.tasks[task_id]["cap_paise"] = cap_paise
        return self._json(task_id)

    def set_state(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, action: str) -> dict[str, Any]:
        t = self.tasks[task_id]
        if action == "pause" and t["status"] in ("approved", "running"):
            t.update(status="paused", pause_reason="owner")
        elif action == "resume" and t["status"] == "paused" and not (t["pause_reason"] == "cap" and t["spent_paise"] >= (t["cap_paise"] or 0)):
            t.update(status="running", pause_reason=None)
        elif action == "cancel" and t["status"] not in ("done", "cancelled"):
            t.update(status="cancelled", pause_reason=None)
            for r in self.rows[task_id]:
                if r["status"] == "waiting":
                    r.update(status="skipped", skip_reason="cancelled")
        else:
            raise TaskStateError("SM953")
        return self._json(task_id)

    def claim(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, limit: int) -> dict[str, Any]:
        if self.stuck_token_error is not None:
            raise self.stuck_token_error
        t = self.tasks[task_id]
        if t["status"] not in ("approved", "running"):
            return {"task": self._json(task_id), "claimed": []}
        if t["cap_paise"] is not None and t["spent_paise"] >= t["cap_paise"]:
            t.update(status="paused", pause_reason="cap")
            return {"task": self._json(task_id), "claimed": []}
        t["status"] = "running"
        picked = [r for r in self.rows[task_id] if r["status"] == "waiting"][:limit]
        for r in picked:
            r["status"] = "in_progress"
        return {"task": self._json(task_id), "claimed": [
            {"id": r["id"], "contact_id": r["contact_id"], "lead_id": r["lead_id"], "name": r["name"], "phone": "+91 98765 00001" if not r.get("no_phone") else None,
             "whatsapp_consent": "granted", "phone_consent": "unknown", "suppressed": bool(r.get("suppressed")), "erased": bool(r.get("erased")), "archived": bool(r.get("archived"))}
            for r in picked]}

    def result(self, token: str, tenant_id: uuid.UUID, task_id: uuid.UUID, row_id: uuid.UUID, result: dict[str, Any]) -> dict[str, Any]:
        t = self.tasks[task_id]
        row = next(r for r in self.rows[task_id] if r["id"] == str(row_id))
        if row["status"] != "in_progress":
            raise TaskStateError("SM953")
        row.update(status=result["status"], skip_reason=result.get("skip_reason"), outcome=result.get("outcome"), category=result.get("category"), captured=result.get("captured"),
                   transcript=result.get("transcript"), message_status=result.get("message_status"), cost_paise=result.get("cost_paise", 0))
        t["spent_paise"] += int(result.get("cost_paise", 0))
        if not any(r["status"] in ("waiting", "in_progress") for r in self.rows[task_id]) and t["status"] in ("running", "paused"):
            t.update(status="done", pause_reason=None, finished_at=NOW.isoformat())
        elif t["status"] == "running" and t["cap_paise"] is not None and t["spent_paise"] >= t["cap_paise"]:
            t.update(status="paused", pause_reason="cap")
        return self._json(task_id)


class FakeOutbox:
    def __init__(self, status: str = "queued", fail: Exception | None = None) -> None:
        self.sent: list[dict[str, Any]] = []
        self.status, self.fail = status, fail

    def submit(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        if self.fail is not None:
            raise self.fail
        self.sent.append(args)
        return {"id": args["p_message_id"], "status": self.status, "reason": None, "replayed": False}


__all__ = ["ApiError"]
