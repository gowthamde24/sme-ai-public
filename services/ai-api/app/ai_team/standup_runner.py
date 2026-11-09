"""The worker's morning stand-up (owner, 9 Nov 2026): once a day per workspace, at its opening time, the stand-up is made from the real day numbers by code and stored (migration 20261231400000).

Every tick asks the database which workspaces are due (`scheduler_standup_due`: has an assistant, open today, opening time passed, none made yet), reads yesterday and today as the Owner would (`scheduler_ai_team_day`),
builds the text and saves it. A save is once a day (a second save keeps the first), so a restart or two workers never make two. One workspace failing never stops the others, and never fails the tick.
Logs: counts only (no workspace id, no text)."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from datetime import date, datetime, timedelta, timezone
from typing import Any

from app.ai_team import service
from app.ai_team.repository import PostgrestAiTeamRepository
from app.tenancy.repository import TokenRejected

logger = logging.getLogger("app.ai_team.standup")
IST = timezone(timedelta(hours=5, minutes=30))
BATCH = 50


class StandupRunner:
    def __init__(self, repository: PostgrestAiTeamRepository, *, clock: Callable[[], datetime] | None = None) -> None:
        self._repo = repository
        self._clock = clock or (lambda: datetime.now(IST))

    def run(self, token: str) -> int:
        """Make every stand-up that is due now. Returns how many were made."""
        try:
            due = self._repo.standups_due(token, BATCH)
        except TokenRejected:
            raise
        except Exception as exc:   # noqa: BLE001 - never fails the tick
            logger.error("stand-up: asking what is due failed: %s", exc.__class__.__name__)
            return 0
        made = failed = 0
        for item in due:
            try:
                tenant_id = uuid.UUID(str(item["tenant_id"]))
                on = date.fromisoformat(str(item["date"]))
                today: dict[str, Any] = dict(self._repo.day_as_scheduler(token, tenant_id, on))
                yesterday: dict[str, Any] = dict(self._repo.day_as_scheduler(token, tenant_id, on - timedelta(days=1)))
                built = service.make_standup(tenant_id, yesterday, today, str(item.get("language") or "en"), self._clock())
                self._repo.standup_save(token, tenant_id, on, built)
                made += 1
            except TokenRejected:
                raise
            except Exception as exc:   # noqa: BLE001 - one workspace never stops the rest
                failed += 1
                logger.error("stand-up: one workspace failed: %s", exc.__class__.__name__)
        if made or failed:
            logger.info("stand-ups made: %d, failed: %d", made, failed)   # (numbers only)
        return made
