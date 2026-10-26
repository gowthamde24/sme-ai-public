"""What the routes call (job DR A3): the database's answers as typed objects. Nothing here decides who may do what or whether a plan is current; the database does and re-checks."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, TypeVar

from pydantic import BaseModel, ValidationError

from app.outbox.service import decode_cursor, next_cursor
from app.outreach import models as m
from app.outreach.repository import OutreachRepository
from app.tenancy.repository import UpstreamError

T = TypeVar("T", bound=BaseModel)
ITEMS_PAGE = 50


def _typed(model: type[T], raw: object) -> T:
    try:
        return model.model_validate(raw)
    except ValidationError:
        raise UpstreamError("unexpected outreach row") from None


class OutreachService:
    def __init__(self, repository: OutreachRepository) -> None:
        self._repo = repository

    def policy(self, token: str, tenant_id: uuid.UUID) -> m.PolicyOut:
        return _typed(m.PolicyOut, self._repo.policy_get(token, tenant_id))

    def policy_save(self, token: str, tenant_id: uuid.UUID, body: m.PolicyIn) -> m.PolicyOut:
        self._repo.policy_set(token, tenant_id, body.as_settings())
        return self.policy(token, tenant_id)

    def plan(self, token: str, tenant_id: uuid.UUID, body: m.BatchIn) -> m.BatchAnswer:
        return _typed(m.BatchAnswer, self._repo.batch_plan(token, tenant_id, body.as_document()))

    def batches(self, token: str, tenant_id: uuid.UUID, status: str | None) -> list[m.BatchAnswer]:
        return [_typed(m.BatchAnswer, row) for row in self._repo.batches(token, tenant_id, status)]

    def batch(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID) -> m.BatchAnswer:
        return _typed(m.BatchAnswer, self._repo.batch(token, tenant_id, batch_id))

    def items(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, cursor: str | None) -> m.ItemsOut:
        after = decode_cursor(cursor)
        rows = self._repo.items(token, tenant_id, batch_id, ITEMS_PAGE, datetime.fromisoformat(after[0].replace("Z", "+00:00")) if after else None, after[1] if after else None)
        return m.ItemsOut(items=[_typed(m.ItemOut, r) for r in rows], next_cursor=next_cursor(rows, ITEMS_PAGE))

    def exclude(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, body: m.ExcludeIn) -> m.BatchAnswer:
        return _typed(m.BatchAnswer, self._repo.exclude(token, tenant_id, batch_id, body.contact_ids))

    def approve(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, body: m.ApproveIn) -> m.BatchAnswer:
        return _typed(m.BatchAnswer, self._repo.approve(token, tenant_id, batch_id, body.plan_sha256))

    def batch_state(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, action: str) -> m.BatchAnswer:
        return _typed(m.BatchAnswer, self._repo.batch_state(token, tenant_id, batch_id, action))

    def batch_caps(self, token: str, tenant_id: uuid.UUID, batch_id: uuid.UUID, body: m.CapsIn) -> m.BatchAnswer:
        return _typed(m.BatchAnswer, self._repo.caps(token, tenant_id, "batch", batch_id, body.max_calls_per_day, body.max_total_minutes))

    def rule_save(self, token: str, tenant_id: uuid.UUID, body: m.RuleIn) -> m.RuleOut:
        return _typed(m.RuleOut, self._repo.rule_save(token, tenant_id, body.as_document()))

    def rules(self, token: str, tenant_id: uuid.UUID) -> list[m.RuleOut]:
        return [_typed(m.RuleOut, r) for r in self._repo.rules(token, tenant_id)]

    def rule_state(self, token: str, tenant_id: uuid.UUID, rule_id: uuid.UUID, action: str) -> m.RuleOut:
        return _typed(m.RuleOut, self._repo.rule_state(token, tenant_id, rule_id, action))

    def rule_caps(self, token: str, tenant_id: uuid.UUID, rule_id: uuid.UUID, body: m.CapsIn) -> m.RuleOut:
        return _typed(m.RuleOut, self._repo.caps(token, tenant_id, "rule", rule_id, body.max_calls_per_day, body.max_total_minutes))

    def result(self, token: str, tenant_id: uuid.UUID, item_id: uuid.UUID, body: m.ResultIn) -> m.ResultOut:
        return _typed(m.ResultOut, self._repo.result(token, tenant_id, item_id, body.result, body.outcome_document(), body.minutes, body.stop))

    def handoffs(self, token: str, tenant_id: uuid.UUID, open_only: bool) -> list[m.HandoffOut]:
        return [_typed(m.HandoffOut, r) for r in self._repo.handoffs(token, tenant_id, open_only)]

    def handoff_acted(self, token: str, tenant_id: uuid.UUID, handoff_id: uuid.UUID) -> m.HandoffOut:
        return _typed(m.HandoffOut, self._repo.handoff_acted(token, tenant_id, handoff_id))

    def report(self, token: str, tenant_id: uuid.UUID, start: date | None, end: date | None) -> m.ReportOut:
        return _typed(m.ReportOut, self._repo.report(token, tenant_id, start, end))

    def source_costs(self, token: str, tenant_id: uuid.UUID) -> list[m.SourceCostOut]:
        return [_typed(m.SourceCostOut, r) for r in self._repo.source_costs(token, tenant_id)]

    def source_costs_save(self, token: str, tenant_id: uuid.UUID, body: m.SourceCostsIn) -> list[m.SourceCostOut]:
        rows: list[dict[str, Any]] = [c.model_dump() for c in body.costs]
        return [_typed(m.SourceCostOut, r) for r in self._repo.source_costs_set(token, tenant_id, rows)]
