"""In-memory stand-ins for job BY's repositories: they record every call with its token and keep the small state the routes need. The database rules are pgTAP 87 to 89."""

from __future__ import annotations

import uuid
from datetime import date
from typing import Any

from app.team import errors as e
from app.tenancy.repository import RepositoryError


class FakeTeam:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.tokens: list[str] = []
        self.fail: RepositoryError | None = None
        self.accept_answer: dict[str, Any] = {"status": "joined", "tenant_id": "t1", "tenant_name": "Tenant A", "role": "sales"}
        self.invitations: dict[str, dict[str, Any]] = {}

    def _note(self, name: str, token: str, args: Any = None) -> None:
        self.calls.append((name, args))
        self.tokens.append(token)
        if self.fail is not None:
            raise self.fail

    def team(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._note("team", token)
        return {"members": [{"user_id": "u1", "display_name": "Owner A", "role": "owner", "joined_at": "2026-10-01T00:00:00+00:00", "is_you": True}], "pending_invitations": 1}

    def create_invitation(self, token: str, tenant_id: uuid.UUID, invitation_id: uuid.UUID, role: str, days: int, label: str | None) -> dict[str, Any]:
        self._note("create_invitation", token, (str(invitation_id), role, days, label))
        old = self.invitations.get(str(invitation_id))
        if old is not None:
            return {**old, "code": None, "replayed": True}
        row = {"id": str(invitation_id), "role": role, "label": label, "status": "pending", "created_at": "2026-10-05T10:00:00+00:00", "expires_at": "2026-10-12T10:00:00+00:00", "accepted_at": None, "revoked_at": None}
        self.invitations[str(invitation_id)] = row
        return {**row, "code": "7QX2K-M9R4D-0A1B2-C3D4E", "replayed": False}

    def list_invitations(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        self._note("list_invitations", token)
        return list(self.invitations.values())

    def revoke_invitation(self, token: str, tenant_id: uuid.UUID, invitation_id: uuid.UUID) -> dict[str, Any]:
        self._note("revoke_invitation", token)
        row = self.invitations.get(str(invitation_id))
        if row is None:
            raise e.NoSuchMemberError("SM243")
        row["status"] = "revoked"
        return dict(row)

    def accept_invitation(self, token: str, code: str) -> dict[str, Any]:
        self._note("accept_invitation", token, code)
        return dict(self.accept_answer)

    def change_role(self, token: str, tenant_id: uuid.UUID, user_id: uuid.UUID, role: str, reason: str) -> dict[str, Any]:
        self._note("change_role", token, (str(user_id), role, reason))
        return {"user_id": str(user_id), "role": role, "changed": True}

    def remove_member(self, token: str, tenant_id: uuid.UUID, user_id: uuid.UUID, reason: str) -> dict[str, Any]:
        self._note("remove_member", token, (str(user_id), reason))
        return {"user_id": str(user_id), "removed": True, "leads_unassigned": 2, "opportunities_unassigned": 1, "runs_cancelled": 0, "invitations_revoked": 0}


class FakeWorkspace:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.profile_row: dict[str, Any] = {"name": "Tenant A", "town": None, "languages": [], "setup_complete": False, "missing": ["town", "languages"], "updated_at": None}

    def profile(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self.calls.append(("profile", None))
        return dict(self.profile_row)

    def save_profile(self, token: str, tenant_id: uuid.UUID, name: str | None, town: str | None, languages: list[str] | None) -> dict[str, Any]:
        self.calls.append(("save_profile", (name, town, languages)))
        if name:
            self.profile_row["name"] = name
        if town:
            self.profile_row["town"] = town
        if languages:
            self.profile_row["languages"] = sorted(set(languages))
        self.profile_row["missing"] = [k for k, v in (("town", self.profile_row["town"]), ("languages", self.profile_row["languages"])) if not v]
        self.profile_row["setup_complete"] = not self.profile_row["missing"]
        return dict(self.profile_row)

    def weekly_report(self, token: str, tenant_id: uuid.UUID, week_start: date | None) -> dict[str, Any]:
        self.calls.append(("weekly_report", week_start))
        return {"week_start": (week_start or date(2026, 10, 5)).isoformat(), "current": week_start is None}


class FakeNotifications:
    def __init__(self) -> None:
        self.calls: list[tuple[str, Any]] = []
        self.tokens: list[str] = []
        self.enabled = False
        self.subscriptions = 0
        self.pending_rows: list[dict[str, Any]] = []
        self.marked: list[tuple[str, str, list[dict[str, Any]]]] = []
        self.reports: list[tuple[str, str]] = []
        self.fail_step: str | None = None

    def _note(self, name: str, token: str, args: Any = None) -> None:
        self.calls.append((name, args))
        self.tokens.append(token)

    def feed(self, token: str, tenant_id: uuid.UUID, limit: int) -> dict[str, Any]:
        self._note("feed", token, limit)
        item = {"kind": "outbox_approval", "id": "11111111-1111-4111-8111-111111111111", "customer": "Ravi Silks", "city": "Guntur", "agent": "followup_desk", "ref": "reply_to_inbound", "amount_paise": None,
                "at": "2026-10-05T10:00:00+00:00", "target": {"type": "outbox_message", "id": "11111111-1111-4111-8111-111111111111"}, "unread": True}  # fmt: skip
        return {"total": 1, "unread_count": 1, "last_seen_at": None, "items": [item]}

    def mark_seen(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._note("mark_seen", token)
        return {"last_seen_at": "2026-10-05T10:05:00+00:00"}

    def subscribe(self, token: str, endpoint: str, p256dh: str, auth: str) -> dict[str, Any]:
        self._note("subscribe", token, (endpoint, p256dh, auth))
        self.subscriptions += 1
        return {"id": "22222222-2222-4222-8222-222222222222", "created_at": "2026-10-05T10:00:00+00:00"}

    def unsubscribe(self, token: str, endpoint: str) -> dict[str, Any]:
        self._note("unsubscribe", token, endpoint)
        return {"removed": 1}

    def prefs(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._note("prefs", token)
        return {"enabled": self.enabled, "subscriptions": self.subscriptions}

    def set_prefs(self, token: str, tenant_id: uuid.UUID, enabled: bool) -> dict[str, Any]:
        self._note("set_prefs", token, enabled)
        self.enabled = enabled
        return {"enabled": enabled}

    def pending(self, token: str, limit: int) -> list[dict[str, Any]]:
        self._note("pending", token, limit)
        if self.fail_step == "pending":
            raise RepositoryError("boom")
        return list(self.pending_rows)

    def mark(self, token: str, tenant_id: uuid.UUID, user_id: uuid.UUID, items: list[dict[str, Any]]) -> int:
        self._note("mark", token)
        self.marked.append((str(tenant_id), str(user_id), items))
        return len(items)

    def report(self, token: str, subscription_id: uuid.UUID, outcome: str) -> None:
        self._note("report", token)
        self.reports.append((str(subscription_id), outcome))
