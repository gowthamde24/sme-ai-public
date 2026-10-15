"""An in-memory SchedulerRepository for the tick, worker and route tests (job AW). It records every call with the token it was given and answers from what the test planted; it decides NOTHING (the
switches, the windows, the leases and the idempotency are the database's, tested in pgTAP 79 and tests/integration/test_scheduler_api.py)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

TENANT_1 = uuid.UUID("11111111-1111-4111-8111-111111111111")
TENANT_2 = uuid.UUID("22222222-2222-4222-8222-222222222222")
VISIT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"
PHONE = "+00 912345"  # synthetic; a test asserts that it never reaches a log


def claim_item(
    n: int = 1, body: str = "A synthetic message body for the customer."
) -> dict[str, Any]:
    return {
        "id": str(uuid.UUID(int=n)),
        "lead_id": str(uuid.UUID(int=1000 + n)),
        "contact_id": str(uuid.UUID(int=2000 + n)),
        "phone": PHONE,
        "body": body,
        "language": "en",
    }


def due_item(
    kind: str = "evening_before",
    language: str = "en",
    visit: str = VISIT,
    starts_at: str = "2026-10-06T05:30:00+00:00",
) -> dict[str, Any]:
    return {"visit_id": visit, "kind": kind, "starts_at": starts_at, "language": language}


class FakeScheduler:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, dict[str, Any]]] = []  # (function, token, args)
        self.listed: list[uuid.UUID] = []
        self.claims: dict[
            uuid.UUID, list[list[dict[str, Any]]]
        ] = {}  # tenant -> the answer of each successive claim
        self.due: dict[uuid.UUID, list[dict[str, Any]]] = {}
        self.queue_answer: dict[str, Any] = {"status": "queued", "replayed": False}
        self.voice_plans: dict[uuid.UUID, dict[str, Any]] = {}  # message id -> what scheduler_voice_plan answers (job CV)
        self.no_shows: dict[uuid.UUID, int] = {}
        self.campaign: dict[uuid.UUID, dict[str, int]] = {}  # tenant -> the counts of the campaign run
        self.fail: dict[str, Exception] = {}  # function -> raise this (once, unless sticky)
        self.fail_for: dict[tuple[str, uuid.UUID], Exception] = {}
        self.on_call: Callable[[str], None] | None = None
        self.settings: dict[str, Any] = {
            "reminder_evening_enabled": True,
            "reminder_evening_hour": 18,
            "reminder_heads_up_enabled": True,
            "reminder_heads_up_minutes": 120,
            "no_show_enabled": False,
            "no_show_after_minutes": 30,
            "is_default": True,
        }
        self.status: dict[str, Any] = {
            "platform_switch_on": True,
            "auto_send_enabled": True,
            "active": True,
            "releases_approved": True,
            "worker_running": True,
            "last_run_at": "2026-10-05T08:30:00+00:00",
            "next_run_at": "2026-10-05T08:31:00+00:00",
            "interval_seconds": 60,
            "last_activity_at": "2026-10-05T08:00:00+00:00",
            "today": {"sent": 2, "failed": 0, "reminders": 1, "no_shows": 0, "errors": 0},
        }

    def _log(
        self, name: str, token: str, args: dict[str, Any], tenant: uuid.UUID | None = None
    ) -> None:
        self.calls.append((name, token, args))
        if self.on_call is not None:
            self.on_call(name)
        if name in self.fail:
            raise self.fail.pop(name)
        if tenant is not None and (name, tenant) in self.fail_for:
            raise self.fail_for.pop((name, tenant))

    def names(self) -> list[str]:
        return [c[0] for c in self.calls]

    def args(self, name: str) -> list[dict[str, Any]]:
        return [c[2] for c in self.calls if c[0] == name]

    # worker
    def tenants(self, token: str) -> list[uuid.UUID]:
        self._log("scheduler_tenants", token, {})
        return list(self.listed)

    def heartbeat(self, token: str, interval_seconds: int, errors: int) -> None:
        self._log("scheduler_heartbeat", token, {"interval": interval_seconds, "errors": errors})

    def claim_due(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        self._log(
            "scheduler_claim_due", token, {"tenant": str(tenant_id), "limit": limit}, tenant_id
        )
        queue = self.claims.get(tenant_id, [])
        return queue.pop(0) if queue else []

    def mark(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._log("scheduler_mark", token, args)
        return {"id": args["p_message_id"], "status": args["p_outcome"], "replayed": False}

    def due_reminders(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        self._log("scheduler_due_reminders", token, {"tenant": str(tenant_id)}, tenant_id)
        return list(self.due.get(tenant_id, []))

    def queue_reminder(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._log("scheduler_queue_reminder", token, args)
        return dict(self.queue_answer)

    # job CV: the voice note of a claimed message
    def voice_plan(self, token: str, tenant_id: uuid.UUID, message_id: uuid.UUID) -> dict[str, Any]:
        self._log("scheduler_voice_plan", token, {"tenant": str(tenant_id), "message": str(message_id)}, tenant_id)
        return dict(self.voice_plans.get(message_id, {"voice": False, "reason": "voice_off"}))

    def voice_record(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self._log("scheduler_voice_record", token, args)
        return {"state": "ok"}

    def mark_no_shows(self, token: str, tenant_id: uuid.UUID) -> int:
        self._log("scheduler_mark_no_shows", token, {"tenant": str(tenant_id)}, tenant_id)
        return self.no_shows.get(tenant_id, 0)

    def campaign_run(self, token: str, tenant_id: uuid.UUID) -> dict[str, int]:
        self._log("scheduler_campaign_run", token, {"tenant": str(tenant_id)}, tenant_id)
        return {
            "queued": 0, "held": 0, "blocked": 0, "skipped": 0, "errors": 0, "calls": 0, "done": 0,
            **self.campaign.get(tenant_id, {}),
        }  # fmt: skip

    def record(self, token: str, tenant_id: uuid.UUID, counts: dict[str, int]) -> None:
        self._log("scheduler_record", token, {"tenant": str(tenant_id), **counts}, tenant_id)

    # owner
    def get_settings(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._log("scheduler_settings_get", token, {"tenant": str(tenant_id)})
        return dict(self.settings)

    def set_settings(
        self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]
    ) -> dict[str, Any]:
        self._log("scheduler_settings_set", token, args)
        self.settings = {
            "reminder_evening_enabled": args["p_evening_enabled"],
            "reminder_evening_hour": args["p_evening_hour"],
            "reminder_heads_up_enabled": args["p_heads_up_enabled"],
            "reminder_heads_up_minutes": args["p_heads_up_minutes"],
            "no_show_enabled": args["p_no_show_enabled"],
            "no_show_after_minutes": args["p_no_show_after_minutes"],
            "is_default": False,
        }
        return dict(self.settings)

    def get_status(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._log("scheduler_status", token, {"tenant": str(tenant_id)})
        return dict(self.status)
