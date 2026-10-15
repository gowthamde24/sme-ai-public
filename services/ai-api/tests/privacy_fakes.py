"""An in-memory PrivacyRepository for the tests of job BN: it keeps what the database would (exports with their states, deletion requests, retention, grievances), enforces the same small rules (one open
export, the replay, the confirmation, the sole Owner) and records every call with the token it was made with. The database rules themselves are pgTAP 85."""

from __future__ import annotations

import uuid
from typing import Any

import jwt

from app.crm.repository import NotFoundError
from app.privacy.errors import ConfirmationError, PrivacyStateError, SoleOwnerError
from app.tenancy.repository import RepositoryError


def who(token: str) -> str:
    return str(jwt.decode(token, options={"verify_signature": False})["sub"])


class FakePrivacy:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.tokens: list[str] = []
        self.exports: dict[str, dict[str, Any]] = {}
        self.person: dict[str, Any] = {
            "account": {"id": "u1", "email": "a_owner@test.local", "display_name": "Owner A"},
            "memberships": [{"workspace": "Tenant A", "role": "owner"}],
            "terms_at_sign_up": {"terms_version": "2026-10-01"},
            "policy_acceptances": [{"kind": "terms", "version": "2026-10-01"}],
            "calendar_feeds": [],
            "my_actions": [{"action": "export.create"}],
            "my_assistant_chat": [{"role": "user", "text": "hello"}],
            "my_exports": [],
            "my_deletion_requests": [],
        }
        self.tables: dict[str, list[dict[str, Any]]] = {}
        self.unreadable: set[str] = set()
        self.deletions: dict[str, dict[str, Any]] = {}
        self.sole_owner = False
        self.retention: dict[str, Any] = {"chats_days": None, "voice_days": None, "enquiries_days": None, "scheduler_days": None, "audit_days": None, "updated_at": None, "last_run_at": None}
        self.grievances: dict[str, dict[str, Any]] = {}
        self.tenant_of_grievance: str | None = None
        self.fail: RepositoryError | None = None
        self.expired: list[dict[str, Any]] = []
        self.cleaned: list[str] = []
        self.worker_answers: dict[str, Any] = {"deletions": {"executed": 0, "blocked": 0}, "retention": {"workspaces": 0}}
        self.fail_step: str | None = None

    def _note(self, name: str, token: str, args: Any = None) -> None:
        self.calls.append((name, args))
        self.tokens.append(token)
        if self.fail is not None:
            raise self.fail

    # ---- exports
    def export_request(self, token: str, export_id: uuid.UUID, scope: str, tenant_id: uuid.UUID | None) -> dict[str, Any]:
        self._note("export_request", token, (str(export_id), scope, str(tenant_id) if tenant_id else None))
        old = self.exports.get(str(export_id))
        if old is not None:
            return dict(old)
        if any(e["status"] in ("queued", "running") for e in self.exports.values()):
            raise PrivacyStateError("SM613")
        row = {"id": str(export_id), "scope": scope, "tenant_id": str(tenant_id) if tenant_id else None, "status": "queued", "requested_at": "2026-10-05T10:00:00+00:00", "ready_at": None,
               "expires_at": None, "size_bytes": None, "sha256": None, "error_code": None, "downloads": 0}  # fmt: skip
        self.exports[str(export_id)] = row
        return dict(row)

    def export_get(self, token: str, export_id: uuid.UUID) -> dict[str, Any]:
        self._note("export_get", token)
        if str(export_id) not in self.exports:
            raise NotFoundError("23503")
        return dict(self.exports[str(export_id)])

    def export_list(self, token: str) -> list[dict[str, Any]]:
        self._note("export_list", token)
        return [dict(e) for e in self.exports.values()]

    def export_begin(self, token: str, export_id: uuid.UUID) -> dict[str, Any]:
        self._note("export_begin", token)
        row = self.exports[str(export_id)]
        row["status"] = "running"
        return dict(row)

    def export_finish(self, token: str, export_id: uuid.UUID, ok: bool, size: int | None, sha256: str | None, error: str | None) -> dict[str, Any]:
        self._note("export_finish", token, (ok, size, sha256, error))
        row = self.exports[str(export_id)]
        if ok:
            row.update(status="ready", size_bytes=size, sha256=sha256, expires_at="2026-10-06T10:00:00+00:00", ready_at="2026-10-05T10:01:00+00:00")
        else:
            row.update(status="failed", error_code=error)
        return dict(row)

    def export_link(self, token: str, export_id: uuid.UUID) -> dict[str, Any]:
        self._note("export_link", token)
        row = self.exports.get(str(export_id))
        if row is None:
            raise NotFoundError("23503")
        if row["status"] != "ready":
            raise PrivacyStateError("SM613")
        row["downloads"] += 1
        return {"bucket": f"exp-{who(token)}", "path": f"{export_id}.zip", "expires_at": row["expires_at"], "size_bytes": row["size_bytes"], "sha256": row["sha256"]}

    def export_bucket(self, token: str) -> str:
        self._note("export_bucket", token)
        return f"exp-{who(token)}"

    def person_data(self, token: str) -> dict[str, Any]:
        self._note("person_data", token)
        return self.person

    def read_table_page(self, token: str, table: str, tenant_id: uuid.UUID, order: str, offset: int, limit: int) -> list[dict[str, Any]]:
        self._note("read_table_page", token, (table, order, offset, limit))
        if table in self.unreadable:
            raise NotFoundError("42501")
        return self.tables.get(table, [])[offset : offset + limit]

    # ---- deletion
    def deletion_request(self, token: str, request_id: uuid.UUID, kind: str, tenant_id: uuid.UUID | None, confirm: str) -> dict[str, Any]:
        self._note("deletion_request", token, (str(request_id), kind, str(tenant_id) if tenant_id else None, confirm))
        if str(request_id) in self.deletions:
            return dict(self.deletions[str(request_id)])
        if confirm != ("Tenant A" if kind == "workspace" else "a_owner@test.local"):
            raise ConfirmationError("SM615")
        if kind == "account" and self.sole_owner:
            raise SoleOwnerError("SM611")
        row = {"id": str(request_id), "kind": kind, "tenant_id": str(tenant_id) if tenant_id else None, "status": "scheduled", "requested_at": "2026-10-05T10:00:00+00:00", "execute_after": "2026-10-19T10:00:00+00:00",
               "cancelled_at": None, "executed_at": None, "blocked_reason": None}  # fmt: skip
        self.deletions[str(request_id)] = row
        return dict(row)

    def deletion_cancel(self, token: str, request_id: uuid.UUID) -> dict[str, Any]:
        self._note("deletion_cancel", token)
        row = self.deletions.get(str(request_id))
        if row is None:
            raise NotFoundError("23503")
        row["status"] = "cancelled"
        return dict(row)

    def deletion_list(self, token: str, tenant_id: uuid.UUID | None) -> list[dict[str, Any]]:
        self._note("deletion_list", token, str(tenant_id) if tenant_id else None)
        return [dict(d) for d in self.deletions.values()]

    def deletion_execute_workspace(self, token: str, request_id: uuid.UUID) -> dict[str, Any]:
        self._note("deletion_execute_workspace", token)
        row = self.deletions[str(request_id)]
        row["status"] = "executed"
        return {"deletion": dict(row), "erasure": {"status": "executed"}}

    # ---- retention
    def retention_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._note("retention_get", token)
        return dict(self.retention)

    def retention_set(self, token: str, tenant_id: uuid.UUID, settings: dict[str, int | None]) -> dict[str, Any]:
        self._note("retention_set", token, settings)
        self.retention = {**self.retention, **settings, "updated_at": "2026-10-05T10:00:00+00:00"}
        return dict(self.retention)

    def retention_preview(self, token: str, tenant_id: uuid.UUID, settings: dict[str, int | None] | None) -> dict[str, Any]:
        self._note("retention_preview", token, settings)
        return {"chat_messages": 2, "voice_transcripts": 1, "enquiries": 0, "reply_drafts": 0, "scheduler_runs": 0, "visit_reminders": 0, "audit_events": 0}

    # ---- grievances
    def grievance_submit(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._note("grievance_submit", token, args)
        old = self.grievances.get(args["p_id"])
        if old is not None:
            return dict(old)
        row = {"id": args["p_id"], "tenant_id": args["p_tenant_id"], "kind": args["p_kind"], "subject": args["p_subject"], "details": args["p_details"], "on_behalf": args["p_on_behalf"],
               "status": "received", "received_at": "2026-10-05T10:00:00+00:00", "due_at": "2026-11-04T10:00:00+00:00", "overdue": False, "events": [{"status": "received"}]}  # fmt: skip
        self.grievances[args["p_id"]] = row
        return dict(row)

    def grievance_list(self, token: str, tenant_id: uuid.UUID, status: str | None) -> list[dict[str, Any]]:
        self._note("grievance_list", token, status)
        return [dict(g) for g in self.grievances.values() if status is None or g["status"] == status]

    def grievance_get(self, token: str, grievance_id: uuid.UUID) -> dict[str, Any]:
        self._note("grievance_get", token)
        row = self.grievances.get(str(grievance_id))
        if row is None:
            raise NotFoundError("23503")
        return dict(row)

    def grievance_update(self, token: str, grievance_id: uuid.UUID, status: str, note: str | None) -> dict[str, Any]:
        self._note("grievance_update", token, (status, note))
        row = self.grievances[str(grievance_id)]
        row["status"] = status
        return dict(row)

    # ---- the worker
    def execute_account_deletions(self, token: str, limit: int) -> dict[str, Any]:
        self._note("execute_account_deletions", token, limit)
        if self.fail_step == "accounts":
            raise RepositoryError("boom")
        return dict(self.worker_answers["deletions"])

    def expired_exports(self, token: str, limit: int) -> list[dict[str, Any]]:
        self._note("expired_exports", token, limit)
        return [dict(e) for e in self.expired]

    def export_cleaned(self, token: str, export_id: uuid.UUID) -> None:
        self._note("export_cleaned", token, str(export_id))
        self.cleaned.append(str(export_id))

    def run_students_retention(self, token: str, limit: int) -> dict[str, Any]:
        self._note("run_students_retention", token, limit)
        return {"businesses": 0, "erased": 0}

    def run_retention(self, token: str, limit: int) -> dict[str, Any]:
        self._note("run_retention", token, limit)
        return dict(self.worker_answers["retention"])
