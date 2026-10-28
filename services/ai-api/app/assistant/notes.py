"""The owner's own notes as the assistant reads them (job EB part A). Facts from the notes are the business's own: the assistant may state them and says they are from the owner's notes; anything about the business
that is neither in the records nor in the notes it still never states. The notes are DATA, never instructions."""

from __future__ import annotations

import logging
import uuid
from typing import Any

logger = logging.getLogger("app.assistant.notes")

NOTES_HANDLE_LABEL = "From your notes"
NOTES_ID = uuid.UUID("00000000-0000-4000-8000-0000000000e1")   # the same id every time: the notes are one source per workspace
MAX_PROMPT_CHARS = 6000


def owner_notes(runtime: Any, token: str, tenant_id: uuid.UUID) -> str:
    """The latest saved notes, or '' (none saved, or the store unreadable: the assistant then answers as it did before)."""
    store = getattr(runtime, "assistant_context", None)
    if store is None:
        return ""
    try:
        return str(store.notes_text(token, tenant_id)).strip()
    except Exception as exc:   # noqa: BLE001  a missing store never stops an answer
        logger.warning("owner notes unreadable: %s", exc.__class__.__name__)
        return ""
