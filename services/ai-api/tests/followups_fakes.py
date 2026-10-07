"""An in-memory FollowupsRepository for the route and service tests. The real rules are the database's (pgTAP 62-64) and the real-stack tests (tests/integration/test_followup_*.py); this fake
holds the rows the service reads and records what the service writes (and with whose token), so the tests can check WHAT was sent to the database, WHERE the answers come from, and that no
request carried wording, a contact or a status. It decides nothing: a refusal is queued with `raise_next`."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from app.followups.builder import LeadSnapshot, PolicySnapshot, Touch
from app.followups.repository import OutboundLead

LEAD = uuid.UUID(int=0x1EAD)
CONTACT = uuid.UUID(int=0xC0A7)
DRAFT = uuid.UUID(int=0xD0F1)
QUESTION = uuid.UUID(int=0x0E57)
REQUIREMENT = uuid.UUID(int=0xE02)
POLICY = uuid.UUID(int=0x0B01)
NOW = datetime(2026, 10, 7, 6, 30, 0, tzinfo=UTC)  # Wednesday 12:00 in India
CREATED = datetime(2026, 10, 7, 6, 0, tzinfo=UTC)

__all__ = [
    "CONTACT",
    "DRAFT",
    "LEAD",
    "NOW",
    "POLICY",
    "QUESTION",
    "REQUIREMENT",
    "FakeFollowups",
    "draft_row",
    "policy_snapshot",
    "question_row",
    "snapshot",
    "touch_row",
]


def policy_snapshot(**over: Any) -> PolicySnapshot:
    base: dict[str, Any] = {
        "id": str(POLICY),
        "gap_days": (1, 2),
        "max_touches": 3,
        "quiet_start": "21:00",
        "quiet_end": "09:00",
        "allowed_weekdays": (0, 1, 2, 3, 4),
        "holidays": (),
        "min_gap_hours": 0,
        "recipient_utc_offset_minutes": 330,
    }
    base.update(over)
    return PolicySnapshot(**base)


def snapshot(*, outbound_days_ago: tuple[int, ...] = (5,), **over: Any) -> LeadSnapshot:
    base: dict[str, Any] = {
        "lead_id": str(LEAD),
        "status": "new",
        "contact_suppression_reason": None,
        "has_won_opportunity": False,
        "touches": tuple(
            Touch(
                id=str(uuid.UUID(int=0x7001 + i)),
                direction="out",
                channel="email",
                occurred_at=NOW - timedelta(days=d),
            )
            for i, d in enumerate(outbound_days_ago)
        ),
        "policy": policy_snapshot(),
    }
    base.update(over)
    return LeadSnapshot(**base)


def touch_row(channel: str = "email", direction: str = "out", **over: Any) -> dict[str, Any]:
    """A recorded touch as the repository returns it (newest first is the caller's order)."""
    row: dict[str, Any] = {
        "id": str(uuid.uuid4()),
        "lead_id": str(LEAD),
        "contact_id": str(CONTACT),
        "direction": direction,
        "channel": channel,
        "occurred_at": "2026-10-02T08:00:00Z",
        "draft_id": None,
        "recorded_by": None,
        "recorded_at": "2026-10-02T08:00:00Z",
    }
    row.update(over)
    return row


def draft_row(draft_id: uuid.UUID = DRAFT, **over: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": str(draft_id),
        "lead_id": str(LEAD),
        "contact_id": str(CONTACT),
        "touch_number": 2,
        "status": "draft",
        "channel": "email",
        "template_code": "followup_gentle",
        "body": "Hello, a closed template.",
        "policy_version_id": str(POLICY),
        "engine_version": "1.0.0",
        "state_hash": "a" * 64,
        "as_of": NOW.isoformat(),
        "created_by": str(uuid.UUID(int=0x1002)),
        "created_at": CREATED.isoformat(),
        "approved_by": None,
        "approved_at": None,
        "discarded_by": None,
        "discarded_at": None,
        "discard_code": None,
    }
    row.update(over)
    return row


def question_row(draft_id: uuid.UUID = QUESTION, **over: Any) -> dict[str, Any]:
    row: dict[str, Any] = {
        "id": str(draft_id),
        "requirement_id": str(REQUIREMENT),
        "line_no": 0,
        "question_code": "missing_quantity",
        "question_text": "How many pieces do you need?",
        "status": "draft",
        "created_by": str(uuid.UUID(int=0x1002)),
        "created_at": CREATED.isoformat(),
        "decided_by": None,
        "decided_at": None,
        "discard_code": None,
    }
    row.update(over)
    return row


class FakeFollowups:
    def __init__(self) -> None:
        self.snapshots: dict[uuid.UUID, LeadSnapshot] = {LEAD: snapshot()}
        self.drafts: dict[uuid.UUID, dict[str, Any]] = {DRAFT: draft_row()}
        self.questions: dict[uuid.UUID, dict[str, Any]] = {QUESTION: question_row()}
        self.touch_rows: list[dict[str, Any]] = []
        self.policies: list[dict[str, Any]] = []
        self.requirements: dict[uuid.UUID, uuid.UUID] = {REQUIREMENT: uuid.UUID(int=0xE01)}
        self.gate_result: dict[str, Any] = {
            "blocked": None,
            "stopped": None,
            "policy_in_force": True,
        }
        self.outbound_leads: list[uuid.UUID] = [LEAD]
        self.last_out_channel: dict[
            uuid.UUID, str | None
        ] = {}  # per candidate: the channel (email or whatsapp) of its latest outbound touch; none when absent
        self.stopped_leads: dict[
            uuid.UUID, str
        ] = {}  # per lead: the database's stop reason (an accepted order ...)
        self.blocked_leads: dict[
            tuple[uuid.UUID, str], str
        ] = {}  # per (lead, channel): the gate's block (contact, key, erased, consent, unkeyed; the database may also say erased_key)
        self.question_list_calls: list[bool] = []  # the `active_only` of every question list
        self.tokens: list[str] = []
        self.calls: list[tuple[str, dict[str, Any]]] = []
        self.raise_next: Exception | None = None
        self.replayed = False
        self.asked: list[
            object
        ] = []  # what a read was asked for (a malformed id must never get here)

    def _seen(self, token: str, name: str, args: dict[str, Any]) -> None:
        self.tokens.append(token)
        self.calls.append((name, args))
        if self.raise_next is not None:
            error, self.raise_next = self.raise_next, None
            raise error

    def sent(self, name: str) -> list[dict[str, Any]]:
        return [a for n, a in self.calls if n == name]

    # ------------------------------------------------------------------ writes
    def create_policy(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._seen(token, "create_policy", args)
        return {
            "version_id": args["p_version_id"],
            "version_no": 1,
            "effective_from": args["p_effective_from"],
            "content_sha256": "b" * 64,
            "replayed": self.replayed,
        }

    def record_touch(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._seen(token, "record_touch", args)
        return {
            "touch_id": args["p_touch_id"],
            "lead_id": args["p_lead_id"],
            "direction": args["p_direction"],
            "replayed": self.replayed,
        }

    def create_draft(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._seen(token, "create_draft", args)
        return {
            "draft_id": args["p_draft_id"],
            "lead_id": args["p_lead_id"],
            "touch_number": 2,
            "status": "draft",
            "replayed": self.replayed,
        }

    def approve_draft(self, token: str, draft_id: uuid.UUID, state_hash: str) -> dict[str, Any]:
        self._seen(
            token, "approve_draft", {"p_draft_id": str(draft_id), "p_state_hash": state_hash}
        )
        return {"draft_id": str(draft_id), "status": "approved", "replayed": self.replayed}

    def discard_draft(self, token: str, draft_id: uuid.UUID) -> dict[str, Any]:
        self._seen(token, "discard_draft", {"p_draft_id": str(draft_id)})
        return {"draft_id": str(draft_id), "status": "discarded", "replayed": self.replayed}

    def record_sent(
        self, token: str, draft_id: uuid.UUID, touch_id: uuid.UUID, occurred_at: str | None
    ) -> dict[str, Any]:
        self._seen(
            token,
            "record_sent",
            {
                "p_draft_id": str(draft_id),
                "p_touch_id": str(touch_id),
                "p_occurred_at": occurred_at,
            },
        )
        return {
            "draft_id": str(draft_id),
            "touch_id": str(touch_id),
            "status": "recorded_sent",
            "replayed": self.replayed,
        }

    def persist_questions(
        self, token: str, requirement_id: uuid.UUID, items: list[dict[str, Any]]
    ) -> dict[str, Any]:
        self._seen(
            token, "persist_questions", {"p_requirement_id": str(requirement_id), "p_items": items}
        )
        return {"requirement_id": str(requirement_id), "changed": len(items), "drafts": []}

    def decide_question(self, token: str, draft_id: uuid.UUID, decision: str) -> dict[str, Any]:
        self._seen(token, "decide_question", {"p_draft_id": str(draft_id), "p_decision": decision})
        return {
            "draft_id": str(draft_id),
            "status": "approved" if decision == "approve" else "discarded",
            "replayed": self.replayed,
        }

    # ------------------------------------------------------------------ reads
    def gate(self, token: str, lead_id: uuid.UUID, channel: str) -> dict[str, Any]:
        self._seen(token, "gate", {"p_lead_id": str(lead_id), "p_channel": channel})
        result = dict(self.gate_result)
        if lead_id in self.stopped_leads:
            result["stopped"] = self.stopped_leads[lead_id]
        if (lead_id, channel) in self.blocked_leads:
            result["blocked"] = self.blocked_leads[(lead_id, channel)]
        return result

    def lead_snapshot(
        self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID
    ) -> LeadSnapshot | None:
        self.tokens.append(token)
        self.asked.append(lead_id)
        return self.snapshots.get(lead_id)

    def list_policies(
        self, token: str, tenant_id: uuid.UUID, *, limit: int
    ) -> list[dict[str, Any]]:
        self.tokens.append(token)
        return self.policies[:limit]

    def list_touches(
        self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, *, limit: int
    ) -> list[dict[str, Any]]:
        self.tokens.append(token)
        return [t for t in self.touch_rows if t["lead_id"] == str(lead_id)][:limit]

    def get_draft(
        self, token: str, tenant_id: uuid.UUID, draft_id: uuid.UUID
    ) -> dict[str, Any] | None:
        self.tokens.append(token)
        self.asked.append(draft_id)
        return self.drafts.get(draft_id)

    def list_drafts(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        lead_id: uuid.UUID | None,
        status: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        self.tokens.append(token)
        self.calls.append(("list_drafts", {"lead_id": lead_id, "status": status, "limit": limit}))
        rows = list(self.drafts.values())
        if lead_id is not None:
            rows = [r for r in rows if r["lead_id"] == str(lead_id)]
        if status == "active":
            rows = [r for r in rows if r["status"] in ("draft", "approved")]
        elif status is not None:
            rows = [r for r in rows if r["status"] == status]
        return rows[:limit]

    def recent_outbound(
        self, token: str, tenant_id: uuid.UUID, *, limit: int
    ) -> list[OutboundLead]:
        self.tokens.append(token)
        self.calls.append(("recent_outbound", {"limit": limit}))
        return [
            OutboundLead(lead, self.last_out_channel.get(lead))
            for lead in self.outbound_leads[:limit]
        ]

    def requirement_enquiry(
        self, token: str, tenant_id: uuid.UUID, requirement_id: uuid.UUID
    ) -> uuid.UUID | None:
        self.tokens.append(token)
        self.asked.append(requirement_id)
        return self.requirements.get(requirement_id)

    def list_question_drafts(
        self, token: str, tenant_id: uuid.UUID, requirement_id: uuid.UUID, *, active_only: bool
    ) -> list[dict[str, Any]]:
        self.tokens.append(token)
        self.question_list_calls.append(active_only)
        rows = [q for q in self.questions.values() if q["requirement_id"] == str(requirement_id)]
        return [q for q in rows if q["status"] in ("draft", "approved")] if active_only else rows

    def get_question_draft(
        self, token: str, tenant_id: uuid.UUID, draft_id: uuid.UUID
    ) -> dict[str, Any] | None:
        self.tokens.append(token)
        self.asked.append(draft_id)
        return self.questions.get(draft_id)
