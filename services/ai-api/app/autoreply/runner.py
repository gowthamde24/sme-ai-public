"""The worker's automatic-reply step (job DY): take the messages that wait for an answer, ask the model for a reply, apply the standing rules (rules.py), hand the result to the OUTBOX through the database, which applies every
per-message rule again (consent, STOP, window, limits, switches, the content flags). Carried by the registered scheduler account's token. Counts only are logged: no name, no number, no word of a conversation."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from typing import Any

from app.autoreply.drafter import Drafter
from app.autoreply.repository import AutoReplyRepository
from app.autoreply.rules import must_hand_over
from app.tenancy.repository import RepositoryError, TokenRejected

logger = logging.getLogger("app.autoreply.runner")
LIMIT = 5
NOTE_LINES = 80   # at most this many lines of the owner's notes reach one reply


@dataclass
class Result:
    seen: int = 0
    answered: int = 0
    held: int = 0
    skipped: int = 0


class AutoReplyRunner:
    def __init__(self, repository: AutoReplyRepository, drafter: Drafter) -> None:
        self._repository, self._drafter = repository, drafter

    def run(self, token: str) -> Result:
        result = Result()
        for item in self._repository.pending(token, LIMIT):
            result.seen += 1
            enquiry = uuid.UUID(str(item["enquiry_id"]))
            try:
                self._one(token, enquiry, item, result)
            except TokenRejected:
                raise
            except RepositoryError as exc:
                logger.warning("autoreply: the data layer refused one message (%s)", exc.__class__.__name__)
                result.skipped += 1
        if result.seen:
            logger.info("autoreply: seen=%d answered=%d held_for_owner=%d skipped=%d", result.seen, result.answered, result.held, result.skipped)
        return result

    def _with_notes(self, token: str, item: dict[str, Any]) -> dict[str, Any]:
        """The owner's notes count as facts the assistant may state (job EB): one fact per line, as the owner wrote it. A read that fails leaves the approved facts as they were."""
        try:
            notes = self._repository.notes(token, uuid.UUID(str(item["tenant_id"])))
        except (KeyError, ValueError, RepositoryError):
            return item
        lines = [" ".join(line.split())[:300] for line in notes.splitlines() if line.strip()][:NOTE_LINES]
        if not lines:
            return item
        return {**item, "facts": [*(item.get("facts") or []), *({"kind": "notes", "text": line} for line in lines)]}

    def _one(self, token: str, enquiry: uuid.UUID, item: dict[str, Any], result: Result) -> None:
        item = self._with_notes(token, item)
        draft = self._drafter.draft(item)
        if draft is None:
            self._repository.skip(token, enquiry, "model unavailable or unusable")
            result.skipped += 1
            return
        reason = must_hand_over(str(item.get("text", "")), confidence=draft.confidence, model_wants_person=draft.wants_person)
        answer = self._repository.submit(token, enquiry, draft.text, draft.language, draft.gloss_en, reason is not None)
        message = answer.get("message") or {}
        if answer.get("outcome") != "submitted":
            result.skipped += 1
        elif reason is not None or message.get("status") == "needs_approval":
            result.held += 1
        else:
            result.answered += 1
