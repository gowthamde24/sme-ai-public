"""The nine "Leads & calls" templates (packages/packs/<id>/leads.json next to pack.json), read once from the packs folder. Pure: no database, no network. A pack without a leads.json (the three deep packs) has no template."""

from __future__ import annotations

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.leadspack.models import TemplateOut, TemplatesOut, TemplateSummaryOut
from app.packs.registry import default_directory

logger = logging.getLogger("app.leadspack")


class Templates:
    def __init__(self, directory: Path | None) -> None:
        self._directory = directory
        self._cache: dict[str, tuple[dict[str, Any], dict[str, Any]]] | None = None

    def _load(self) -> dict[str, tuple[dict[str, Any], dict[str, Any]]]:
        if self._cache is not None:
            return self._cache
        found: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
        if self._directory is not None and self._directory.is_dir():
            for leads_file in sorted(self._directory.glob("*/leads.json")):
                try:
                    leads = json.loads(leads_file.read_text(encoding="utf-8"))
                    pack = json.loads((leads_file.parent / "pack.json").read_text(encoding="utf-8"))
                except (OSError, ValueError):
                    logger.error("a leads template could not be read: %s", leads_file.parent.name)
                    continue
                if pack.get("status") == "draft" or leads.get("pack") != leads_file.parent.name:
                    continue
                found[leads_file.parent.name] = (pack, leads)
        else:
            logger.error("the packs directory was not found: lead templates cannot be served")
        self._cache = found
        return found

    def ids(self) -> list[str]:
        return sorted(self._load())

    def contact_fields(self, pack_id: str) -> dict[str, dict[str, Any]]:
        """code -> the custom field definition (kind, label, choices) of the pack's contact fields."""
        entry = self._load().get(pack_id)
        if entry is None:
            return {}
        return {f["code"]: f for f in entry[0].get("custom_fields", []) if f.get("entity") == "contact"}

    def safety(self, pack_id: str) -> list[str]:
        entry = self._load().get(pack_id)
        return list(entry[1]["safety"]) if entry else []

    def summaries(self) -> TemplatesOut:
        items = []
        for pack_id, (pack, leads) in self._load().items():
            items.append(
                TemplateSummaryOut(
                    pack_id=pack_id, version=pack["version"], names=pack["names"], summary=pack["summary"],
                    goal={"code": leads["goal"]["code"], "label": leads["goal"]["label"]},  # type: ignore[arg-type]
                    question_count=len(leads["questions"]), accent=pack["accent"], owl_prop=pack["owl_prop"], validated=pack["status"] == "published",
                )
            )  # fmt: skip
        return TemplatesOut(templates=items)

    def get(self, pack_id: str) -> TemplateOut | None:
        entry = self._load().get(pack_id)
        if entry is None:
            return None
        pack, leads = entry
        fields = self.contact_fields(pack_id)
        questions = []
        for q in leads["questions"]:
            f = fields[q["field"]]
            questions.append(
                {
                    "code": q["code"], "field": q["field"], "ask": q["ask"], "required": q["required"],
                    "field_definition": {"kind": f["kind"], "label": f["label"], "choices": f.get("choices")},
                }
            )  # fmt: skip
        return TemplateOut.model_validate(
            {
                "pack_id": pack_id, "version": pack["version"], "names": pack["names"], "goal": leads["goal"], "questions": questions,
                "objections": leads["objections"], "followups": leads["followups"], "outcome_reasons": leads["outcome_reasons"], "safety": leads["safety"],
            }
        )  # fmt: skip

    def defaults_playbook(self, pack_id: str) -> dict[str, Any] | None:
        """The template as the shape the Owner edits (`PlaybookBody`)."""
        template = self.get(pack_id)
        if template is None:
            return None
        return {
            "goal_ask": template.goal.ask.model_dump(),
            "questions": [{"field": q.field, "ask": q.ask.model_dump(), "required": q.required} for q in template.questions],
            "objections": [o.model_dump() for o in template.objections],
            "followups": [f.model_dump() for f in template.followups],
            "outcome_reasons": template.outcome_reasons.model_dump(),
        }


@lru_cache(maxsize=1)
def default_templates() -> Templates:
    return Templates(default_directory())
