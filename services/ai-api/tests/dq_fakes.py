"""In-memory double of the DPDP repository for job DQ part 4 (no database). The database's own rules (the caps, the ledger, the lapse erasure) are proved in supabase/tests/database/125_dq_dpdp.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from app.privacy.errors import PrivacyRateError
from app.tenancy.repository import TokenRejected


class FakeDpdpRepository:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[Any, ...]]] = []
        self.marketing: str = "not_given"
        self.history: list[dict[str, Any]] = []
        self.display_name = "Asha"
        self.grievances: dict[str, dict[str, Any]] = {}
        self.waitlist: dict[str, dict[str, Any]] = {}
        self.due_intake: dict[str, Any] = {"grievances": [], "waitlist": []}
        self.due_lapse: dict[str, Any] = {"warn": [], "erase": []}
        self.marks: list[tuple[str, str, str]] = []
        self.warned: list[uuid.UUID] = []
        self.erased: list[uuid.UUID] = []
        self.purges = 0
        self.rate_limited = False
        self.fail: Exception | None = None
        self.warning_sent_at: str | None = None
        self.demo = False
        self.exempt = False

    def _note(self, name: str, *args: Any) -> None:
        self.calls.append((name, args))
        if self.fail is not None:
            raise self.fail

    # the person
    def consents(self, token: str) -> dict[str, Any]:
        self._note("consents", token)
        return {
            "consents": [
                {"purpose": "service", "state": "given", "since": "2026-10-01T00:00:00+00:00", "notice_version": "2026-10-25", "via": "signup"},
                {"purpose": "marketing", "state": self.marketing, "since": None, "notice_version": None, "via": None},
            ],
            "history": list(self.history),
        }

    def set_marketing(self, token: str, given: bool, via: str, notice_version: str) -> dict[str, Any]:
        self._note("set_marketing", token, given, via, notice_version)
        state = "given" if given else "withdrawn"
        if self.marketing != state and not (self.marketing == "not_given" and not given):
            self.marketing = state
            self.history.insert(0, {"purpose": "marketing", "action": state, "at": "2026-10-27T00:00:00+00:00", "notice_version": notice_version, "via": via})
        return self.consents(token)

    def profile_get(self, token: str) -> dict[str, Any]:
        self._note("profile_get", token)
        return {"display_name": self.display_name, "email": "asha@example.test", "created_at": "2026-10-01T00:00:00+00:00"}

    def profile_set(self, token: str, display_name: str) -> dict[str, Any]:
        self._note("profile_set", token, display_name)
        self.display_name = display_name
        return self.profile_get(token)

    def lapse_status(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._note("lapse_status", token, tenant_id)
        return {"erasure_warning_sent_at": self.warning_sent_at, "demo": self.demo, "exempt": self.exempt}

    # the public doors
    def grievance_submit(self, args: dict[str, Any]) -> dict[str, Any]:
        self._note("grievance_submit", args)
        if self.rate_limited:
            raise PrivacyRateError("SM614")
        existing = self.grievances.get(args["p_id"])
        number = len(self.grievances) + 1
        row = existing or {"reference": f"GR-2026-{number:06d}", "contact": args["p_contact"]}
        self.grievances.setdefault(args["p_id"], row)
        return {"reference": row["reference"], "status": "received", "received_at": "2026-10-27T10:00:00+00:00", "answer_due_on": "2026-11-26", "answer_within_days": 30, "replayed": existing is not None}

    def waitlist_join(self, args: dict[str, Any]) -> dict[str, Any]:
        self._note("waitlist_join", args)
        if self.rate_limited:
            raise PrivacyRateError("SM614")
        key = (args["p_email"] or args["p_phone"] or "").lower()
        status = "already_joined" if key in self.waitlist else "joined"
        self.waitlist[key] = args
        return {"status": status, "marketing_opt_in": args["p_marketing_opt_in"]}

    # the worker
    def intake_due(self, token: str, limit: int) -> dict[str, Any]:
        self._note("intake_due", token, limit)
        return self.due_intake

    def intake_mark(self, token: str, kind: str, item_id: uuid.UUID, what: str) -> None:
        self._note("intake_mark", token, kind, item_id, what)
        self.marks.append((kind, str(item_id), what))

    def lapse_due(self, token: str, limit: int) -> dict[str, Any]:
        self._note("lapse_due", token, limit)
        return self.due_lapse

    def lapse_warned(self, token: str, tenant_id: uuid.UUID) -> None:
        self._note("lapse_warned", token, tenant_id)
        self.warned.append(tenant_id)

    def lapse_erase(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._note("lapse_erase", token, tenant_id)
        self.erased.append(tenant_id)
        return {"tenant_id": str(tenant_id), "request_id": str(uuid.uuid4())}

    def purge_logs(self, token: str) -> dict[str, Any]:
        self._note("purge_logs", token)
        self.purges += 1
        return {"audit_events": 0, "public_grievances": 0, "waitlist": 0}


__all__ = ["FakeDpdpRepository", "TokenRejected"]
