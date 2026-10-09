"""In-memory TodayRepository for the route tests: per-tenant facts, like the database would return them for the calling person."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from app.tenancy.repository import RepositoryError


class FakeTodayRepository:
    def __init__(self) -> None:
        self.today: dict[uuid.UUID, Any] = {}
        self.agents: dict[uuid.UUID, Any] = {}
        self.cost: dict[uuid.UUID, Any] = {}
        self.percent: dict[uuid.UUID, Any] = {}
        self.paused: dict[uuid.UUID, Any] = {}
        self.calls: list[tuple[str, str, uuid.UUID]] = []
        self.raise_on_next: RepositoryError | None = None

    def _go(self, name: str, token: str, tenant_id: uuid.UUID, store: dict[uuid.UUID, Any]) -> Any:
        self.calls.append((name, token, tenant_id))
        if self.raise_on_next is not None:
            err, self.raise_on_next = self.raise_on_next, None
            raise err
        return store.get(tenant_id)

    def today_summary(self, token: str, tenant_id: uuid.UUID) -> Any:
        return self._go("today_summary", token, tenant_id, self.today)

    def agents_status(self, token: str, tenant_id: uuid.UUID) -> Any:
        return self._go("agents_status", token, tenant_id, self.agents)

    def ai_usage(self, token: str, tenant_id: uuid.UUID) -> Any:
        return self._go("ai_usage", token, tenant_id, self.cost)

    def ai_usage_percent(self, token: str, tenant_id: uuid.UUID) -> Any:
        return self._go("ai_usage_percent", token, tenant_id, self.percent)

    def paused_until(self, token: str, tenant_id: uuid.UUID) -> Any:
        return self._go("paused_until", token, tenant_id, self.paused)


def empty_today() -> dict[str, Any]:
    return {
        "cards": {"waiting": 0, "money_held_paise": 0, "orders_open": 0},
        "needs_you": [],
        "recent": [],
    }
