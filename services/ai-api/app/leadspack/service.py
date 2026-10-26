"""The lead playbook of a workspace (job DR / A1): the template of its business type, the Owner's edited version, and the checks an edit must pass (the fields exist in the pack, no price or promise, sensible follow-ups)."""

from __future__ import annotations

import uuid
from typing import Any

from pydantic import ValidationError

from app.leadspack.models import PlaybookBody, PlaybookOut
from app.leadspack.repository import PlaybookRepository
from app.leadspack.templates import Templates

REASONS = ("price_or_promise", "bad_followup", "duplicate_field", "too_many_questions", "unknown_field", "invalid")


class PlaybookInvalid(Exception):
    """A closed `reason` word; the API answers 422 playbook_invalid with it."""

    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason if reason in REASONS else "invalid"


class NoTemplate(Exception):
    """The workspace's business type has no lead template (a deep pack)."""


def reason_of(error: ValidationError) -> str:
    """The first closed reason found in a pydantic error (the validators raise the words of REASONS)."""
    for item in error.errors():
        message = str(item.get("msg", ""))
        for word in REASONS:
            if word in message:
                return word
        if item.get("type") == "too_long" and tuple(item.get("loc", ()))[:1] == ("questions",):
            return "too_many_questions"
    return "invalid"


class LeadPlaybookService:
    def __init__(self, repository: PlaybookRepository, templates: Templates) -> None:
        self._repo, self._templates = repository, templates

    def _out(self, raw: dict[str, Any]) -> PlaybookOut:
        pack = raw.get("pack_code")
        defaults = self._templates.defaults_playbook(str(pack)) if pack else None
        if defaults is None:
            return PlaybookOut(template_pack=None, saved=False, playbook=None, defaults=None, safety=[], updated_at=None)
        saved = bool(raw.get("saved"))
        return PlaybookOut(
            template_pack=str(pack), saved=saved, playbook=raw["playbook"] if saved and raw.get("playbook") else defaults, defaults=defaults,
            safety=self._templates.safety(str(pack)), updated_at=raw.get("updated_at") if saved else None,
        )  # fmt: skip

    def get(self, token: str, tenant_id: uuid.UUID) -> PlaybookOut:
        return self._out(self._repo.get(token, tenant_id))

    def save(self, token: str, tenant_id: uuid.UUID, body: PlaybookBody) -> PlaybookOut:
        raw = self._repo.get(token, tenant_id)
        pack = raw.get("pack_code")
        if not pack or not self._templates.contact_fields(str(pack)):
            raise NoTemplate
        allowed = self._templates.contact_fields(str(pack))
        if any(q.field not in allowed for q in body.questions):
            raise PlaybookInvalid("unknown_field")
        return self._out(self._repo.save(token, tenant_id, body.model_dump(mode="json")))

    def reset(self, token: str, tenant_id: uuid.UUID) -> PlaybookOut:
        raw = self._repo.get(token, tenant_id)
        if not raw.get("pack_code") or not self._templates.contact_fields(str(raw["pack_code"])):
            raise NoTemplate
        return self._out(self._repo.reset(token, tenant_id))
