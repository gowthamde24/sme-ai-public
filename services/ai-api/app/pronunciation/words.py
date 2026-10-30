"""The workspace's own pronunciation words as the speech path wants them."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from typing import Any

from app.pronunciation.lexicon import OwnerWord

logger = logging.getLogger("app.pronunciation")
LANGUAGES = ("en", "te", "hi", "kn", "ta", "ml")


def owner_words(runtime: Any, token: str, tenant_id: uuid.UUID) -> list[OwnerWord]:
    """The saved words of the workspace, or [] (none saved, or the store unreadable: the voice then speaks as it did before)."""
    repo = getattr(runtime, "workspace", None)
    lister = getattr(repo, "pronunciation_list", None)
    if lister is None:
        return []
    try:
        rows = lister(token, tenant_id)
    except Exception as exc:   # noqa: BLE001  a missing list never stops a sentence
        logger.warning("pronunciation words unreadable: %s", exc.__class__.__name__)
        return []
    out = []
    for row in rows:
        word, sound, language = row.get("word"), row.get("sounds_like"), row.get("language")
        if isinstance(word, str) and isinstance(sound, str) and (language is None or language in LANGUAGES):
            out.append(OwnerWord(word, sound, language))
    return out
