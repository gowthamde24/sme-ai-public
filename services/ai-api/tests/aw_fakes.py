"""An in-memory WorkStore (app/assistant_work/store.py) with the database's own rules as far as these tests need them (supabase/tests/database/155_aw_files_plans.test.sql proves the real ones):
only the person who dropped a file reads it back; a plan moves by compare-and-set; an Owner's-only plan is the Owner's; a plan expires after 30 minutes."""

# ruff: noqa: E501

from __future__ import annotations

import base64
import hashlib
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from app.assistant_work.store import PlanExpiredError, PlanStateError
from app.crm.repository import NotFoundError
from app.tenancy.repository import Forbidden
from tests.fakes import USERS

MOVES = {("proposed", "running"), ("proposed", "cancelled"), ("running", "done"), ("running", "partly_done"), ("running", "failed"), ("done", "undone"), ("partly_done", "undone"), ("proposed", "expired")}


def _uid(token: str) -> str:
    """The test user's name from the token's `sub` (the test tokens are real JWTs signed with the test key; the signature was checked by the API already)."""
    import json

    part = token.split(".")[1]
    sub = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))["sub"]
    return next((name for name, u in USERS.items() if str(u) == sub), sub)


class FakeWorkStore:
    def __init__(self) -> None:
        self.files: dict[str, dict[str, Any]] = {}
        self.plans: dict[str, dict[str, Any]] = {}
        self.actions: list[dict[str, Any]] = []
        self.calls: list[str] = []
        self.owners_and_admins = {"a_owner", "a_admin"}

    def file_put(self, token: str, tenant_id: uuid.UUID, name: str, content_type: str, kind: str, data_base64: str) -> dict[str, Any]:
        self.calls.append("file_put")
        data = base64.b64decode(data_base64)
        fid = str(uuid.uuid4())
        self.files[fid] = {"file_id": fid, "tenant": str(tenant_id), "by": _uid(token), "name": name, "content_type": content_type, "kind": kind, "size_bytes": len(data),
                           "sha256": hashlib.sha256(data).hexdigest(), "data": data, "expires_at": (datetime.now(UTC) + timedelta(hours=24)).isoformat()}
        f = self.files[fid]
        return {k: f[k] for k in ("file_id", "name", "size_bytes", "kind", "content_type", "expires_at")}

    def file_get(self, token: str, tenant_id: uuid.UUID, file_id: uuid.UUID, *, with_data: bool = True) -> dict[str, Any]:
        f = self.files.get(str(file_id))
        if f is None or f["tenant"] != str(tenant_id) or f["by"] != _uid(token):
            raise NotFoundError("23503")
        out = {k: f[k] for k in ("file_id", "name", "size_bytes", "kind", "content_type", "expires_at")}
        out["data_base64"] = base64.b64encode(f["data"]).decode() if with_data else None
        return out

    def file_drop(self, token: str, tenant_id: uuid.UUID, file_id: uuid.UUID) -> bool:
        self.calls.append("file_drop")
        return self.files.pop(str(file_id), None) is not None

    def _json(self, p: dict[str, Any]) -> dict[str, Any]:
        out = {k: v for k, v in p.items() if k not in ("tenant",)}
        if out["status"] == "proposed" and datetime.fromisoformat(out["expires_at"]) <= datetime.now(UTC):
            out["status"] = "expired"
        return out

    def plan_put(self, token: str, tenant_id: uuid.UUID, plan: dict[str, Any]) -> dict[str, Any]:
        self.calls.append("plan_put")
        pid = str(plan["plan_id"])
        if pid not in self.plans:
            self.plans[pid] = {"plan_id": pid, "tenant": str(tenant_id), "message_id": str(plan["message_id"]), "conversation_id": plan.get("conversation_id"), "requested_by": _uid(token),
                               "file_id": plan.get("file_id"), "title": plan["title"], "file_name": plan.get("file_name"), "status": "proposed", "sensitive": plan.get("sensitive"),
                               "owner_only": bool(plan.get("owner_only")), "needs_second_factor": bool(plan.get("needs_second_factor")), "card": plan.get("card") or {}, "steps": plan["steps"],
                               "expires_at": (datetime.now(UTC) + timedelta(minutes=30)).isoformat(), "decided_by": None}
        return self._json(self.plans[pid])

    def plan_get(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID) -> dict[str, Any]:
        p = self.plans.get(str(plan_id))
        if p is None or p["tenant"] != str(tenant_id):
            raise NotFoundError("23503")
        return self._json(p)

    def plans_for(self, token: str, tenant_id: uuid.UUID, message_ids: list[uuid.UUID]) -> list[dict[str, Any]]:
        wanted = {str(m) for m in message_ids}
        return [self._json(p) for p in self.plans.values() if p["message_id"] in wanted and p["tenant"] == str(tenant_id)]

    def plan_move(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID, expect: str, status: str, steps: list[dict[str, Any]] | None = None, *, file_gone: bool = False) -> dict[str, Any]:
        self.calls.append(f"move:{expect}->{status}")
        p = self.plans.get(str(plan_id))
        if p is None:
            raise NotFoundError("23503")
        if (expect, status) not in MOVES:
            raise ValueError("invalid move")
        if p["status"] != expect:
            raise PlanStateError("SM981")
        if expect == "proposed" and status != "expired" and datetime.fromisoformat(p["expires_at"]) <= datetime.now(UTC):
            p["status"] = "expired"
            raise PlanExpiredError("SM982")
        who = _uid(token)
        if expect == "proposed" and status == "running" and p["owner_only"] and who != "a_owner":
            raise Forbidden("42501")
        if expect == "running" and p["decided_by"] != who:
            raise Forbidden("42501")
        if status == "undone" and who not in ("a_owner", p["decided_by"]):
            raise Forbidden("42501")
        p["status"] = status
        if steps is not None:
            p["steps"] = steps
        if file_gone:
            p["file_id"] = None
        if expect == "proposed":
            p["decided_by"] = who
        return self._json(p)

    def action_record(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID, step_no: int, tool: str, summary: str, status: str, error: str | None, changed: dict[str, Any], undo: dict[str, Any] | None) -> dict[str, Any]:
        p = self.plans[str(plan_id)]
        if p["status"] != "running" or p["decided_by"] != _uid(token):
            raise PlanStateError("SM981")
        row = {"action_id": str(uuid.uuid4()), "plan_id": str(plan_id), "step_no": step_no, "tool": tool, "summary": summary, "status": status, "error": error, "changed": changed, "undo": undo,
               "requested_by": p["requested_by"], "decided_by": _uid(token), "message_id": p["message_id"], "at": datetime.now(UTC).isoformat(),
               "undo_until": (datetime.now(UTC) + timedelta(days=7)).isoformat() if undo else None}
        self.actions.append(row)
        return {"action_id": row["action_id"]}

    def action_undone(self, token: str, tenant_id: uuid.UUID, plan_id: uuid.UUID, step_no: int) -> bool:
        for a in self.actions:
            if a["plan_id"] == str(plan_id) and a["step_no"] == step_no and a["status"] == "done":
                a["status"] = "undone"
                return True
        return False

    def actions_list(self, token: str, tenant_id: uuid.UUID, since: str | None, before: str | None, limit: int, action_id: uuid.UUID | None = None, plan_id: uuid.UUID | None = None) -> list[dict[str, Any]]:
        """Like the database (Owner and Admin only; never the stored undo, only its state)."""
        if _uid(token) not in self.owners_and_admins:
            from app.tenancy.repository import Forbidden

            raise Forbidden("42501")
        out = []
        for a in sorted(self.actions, key=lambda x: x["at"], reverse=True):
            if (since and a["at"] < since) or (before and a["at"] >= before) or (action_id and a["action_id"] != str(action_id)) or (plan_id and a["plan_id"] != str(plan_id)):
                continue
            state = "done" if a["status"] == "undone" else "none" if not a["undo"] or a["status"] != "done" else "expired" if a["undo_until"] and a["undo_until"] < datetime.now(UTC).isoformat() else "available"
            out.append({k: v for k, v in a.items() if k not in ("undo", "undo_until")} | {"undo": state, "undone_at": None})
        return out[:limit]
