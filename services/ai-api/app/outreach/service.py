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
from app.whatsapp import first_templates

T = TypeVar("T", bound=BaseModel)
ITEMS_PAGE = 50
TEMPLATE_LABELS = {"lead_ack": "Thanks for contacting us", "missed_call_followup": "Sorry we missed you"}
TEMPLATE_STATUS = {"approved": "approved", "submitted": "submitted"}   # anything else (a draft, a rejected or paused one) is "not ready": draft


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
        return self._rule(token, tenant_id, self._repo.rule_save(token, tenant_id, body.as_document()))

    def rules(self, token: str, tenant_id: uuid.UUID) -> list[m.RuleOut]:
        policy = self.policy(token, tenant_id)
        return [self._rule(token, tenant_id, r, policy) for r in self._repo.rules(token, tenant_id)]

    def rule_state(self, token: str, tenant_id: uuid.UUID, rule_id: uuid.UUID, action: str) -> m.RuleOut:
        return self._rule(token, tenant_id, self._repo.rule_state(token, tenant_id, rule_id, action))

    def rule_caps(self, token: str, tenant_id: uuid.UUID, rule_id: uuid.UUID, body: m.CapsIn) -> m.RuleOut:
        return self._rule(token, tenant_id, self._repo.caps(token, tenant_id, "rule", rule_id, body.max_calls_per_day, body.max_total_minutes))

    def _rule(self, token: str, tenant_id: uuid.UUID, raw: dict[str, Any], policy: m.PolicyOut | None = None) -> m.RuleOut:
        """The rule as the database holds it plus its plan: what happens to one lead, from the rule and the policy's retry steps (so a screen can write the whole summary from data)."""
        rule = _typed(m.RuleOut, raw)
        pol = policy or self.policy(token, tenant_id)
        steps: list[m.StepCall | m.StepRetryAfter | m.StepRetryMorning | m.StepWhatsapp] = [m.StepCall(kind="call", minutes=rule.within_minutes)]
        for step in pol.retry_steps:
            if "after_minutes" in step:
                steps.append(m.StepRetryAfter(kind="retry", after_minutes=step["after_minutes"]))
            elif "next_morning_minute" in step:
                steps.append(m.StepRetryMorning(kind="retry", next_morning=f"{step['next_morning_minute'] // 60:02d}:{step['next_morning_minute'] % 60:02d}"))
        if rule.channel in ("both", "whatsapp") and pol.then_whatsapp:
            steps.append(m.StepWhatsapp(kind="whatsapp", template=rule.wa_missed_template or m.RULE_TEMPLATES["missed"]))
        return rule.model_copy(update={"plan": m.RulePlan(steps=steps)})

    def rule_templates(self, token: str, tenant_id: uuid.UUID) -> m.RuleTemplatesOut:
        """The WhatsApp messages a rule may name (one per moment today) with the status for the business's main language and a preview with sample values (Ravi, the business name)."""
        raw = self._repo.rule_templates(token, tenant_id)
        main = raw.get("main_language") if isinstance(raw.get("main_language"), str) else "en"
        language = main if main in first_templates.LANGUAGES else "en"
        status = {(t.get("name"), t.get("language")): t.get("status") for t in raw.get("templates", []) if isinstance(t, dict)}
        out: list[m.RuleTemplateOut] = []
        for moment, name in m.RULE_TEMPLATES.items():
            known = status.get((name, language))
            # a template that has no row in the business language yet shows the English words (a Telugu preview of a message that does not exist reads oddly)
            draft = next((d for d in first_templates.drafts((language if known else "en",)) if d["name"] == name), None)
            if draft is None:
                continue
            preview = draft["body"]
            for index, value in enumerate(first_templates.SAMPLES, start=1):
                preview = preview.replace("{{" + str(index) + "}}", value)
            out.append(m.RuleTemplateOut(key=name, moment=moment, label=TEMPLATE_LABELS[name], language=language,  # type: ignore[arg-type]
                                         status=TEMPLATE_STATUS.get(str(known), "draft") if known else "missing",  # type: ignore[arg-type]
                                         preview=preview, variables=["first_name", "business_name"]))
        return m.RuleTemplatesOut(items=out)

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
