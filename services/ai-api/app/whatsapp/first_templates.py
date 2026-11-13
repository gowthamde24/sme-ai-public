"""The first message templates as DATA (13 Nov 2026): five templates in te / hi / kn / en, created as DRAFTS for a workspace and then submitted to Meta. Every body has ONE variable {{1}} with words around it (Meta's rule, the same
as the database CHECK), no price and no link: the same checks run in a test, so a data change that Meta or the database would refuse fails here first."""

from __future__ import annotations

import json
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Any

PATH = Path(__file__).parent / "data" / "first_templates.json"
LANGUAGES = ("en", "te", "hi", "kn")
NAMESPACE = uuid.UUID("0f6a3c1e-7d2b-4e58-9a14-5b8c2d3e6f70")


@lru_cache(maxsize=1)
def load() -> list[dict[str, Any]]:
    doc = json.loads(PATH.read_text(encoding="utf-8"))
    return list(doc["templates"])


def drafts(languages: tuple[str, ...] = LANGUAGES) -> list[dict[str, str]]:
    """Every (name, language) draft: {name, language, category, purpose, body}."""
    out: list[dict[str, str]] = []
    for t in load():
        for lang in languages:
            if lang in t["body"]:
                out.append({"name": t["name"], "language": lang, "category": t["category"], "purpose": t["purpose"], "body": t["body"][lang]})
    return out


def template_id(tenant_id: uuid.UUID, name: str, language: str) -> uuid.UUID:
    """The same draft of the same workspace always has the same id, so seeding twice changes nothing."""
    return uuid.uuid5(NAMESPACE, f"{tenant_id}|{name}|{language}")


# Meta's template status words -> ours
META_STATUS = {"APPROVED": "approved", "REJECTED": "rejected", "PAUSED": "paused", "DISABLED": "disabled", "PENDING": "submitted", "IN_APPEAL": "submitted", "PENDING_DELETION": "disabled"}
