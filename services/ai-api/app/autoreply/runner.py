"""The worker's automatic-reply step (job DY): take the messages that wait for an answer, ask the model for a reply, apply the standing rules (rules.py), hand the result to the OUTBOX through the database, which applies every
per-message rule again (consent, STOP, window, limits, switches, the content flags). Carried by the registered scheduler account's token. Counts only are logged: no name, no number, no word of a conversation."""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from typing import Any

from app.autoreply.booking import BookingFlow
from app.autoreply.drafter import Drafter
from app.autoreply.repository import AutoReplyRepository
from app.autoreply.rules import (
    is_about_price,
    must_hand_over,
    needed_by_of,
    product_of,
    promises_follow_up,
)
from app.opening.honesty import ensure_honest
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
    def __init__(self, repository: AutoReplyRepository, drafter: Drafter, booking: BookingFlow | None = None, today: Callable[[], date] | None = None, employees_on: bool = False) -> None:
        self._repository, self._drafter, self._employees_on = repository, drafter, employees_on
        self._today = today or (lambda: (datetime.now(UTC) + timedelta(hours=5, minutes=30)).date())   # India time
        # the Postgrest repository also speaks the booking calls (appointment booking); a repository without them (a test's) has no booking flow
        self._booking: BookingFlow | None = booking if booking is not None else (BookingFlow(repository) if hasattr(repository, "offer_slots") else None)  # type: ignore[arg-type]

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

    def _with_employee(self, token: str, item: dict[str, Any]) -> tuple[dict[str, Any], bool]:
        """EMPLOYEES (26 Nov 2026): (the item with the employee's words, whether somebody answers WhatsApp). WhatsApp is OPTIONAL: it is a responsibility an employee has when the owner ticks it. When no employee that is on has it, nothing is answered
        (False). The employee's words go into the prompt (never above the rules), its never-say words are checked on the reply. An unreadable employee leaves the item as it was (answered as before)."""
        if not self._employees_on or not hasattr(self._repository, "employee"):
            return item, True
        try:
            employee = self._repository.employee(token, uuid.UUID(str(item["tenant_id"])))
        except (KeyError, ValueError, RepositoryError):
            return item, True
        if not employee:
            return item, False
        from app.employees import apply as employees_apply

        name = str(employee.get("name") or "").strip()
        return {**item, "employee": employees_apply.block(employee, channel="whatsapp"), "never_say": [str(w) for w in employee.get("never_say") or []], **({"assistant_name": name} if name and not employees_apply.is_default(employee) else {})}, True

    def _one(self, token: str, enquiry: uuid.UUID, item: dict[str, Any], result: Result) -> None:
        item, answered_here = self._with_employee(token, item)
        if not answered_here:   # no AI employee replies on WhatsApp: the message is left for the owner, nothing is sent or drafted
            self._repository.skip(token, enquiry, "no AI employee replies on WhatsApp")
            result.skipped += 1
            return
        # a message about booking a visit is answered by code (free times, the number, reschedule, cancel): the database decides, the words are fixed
        booked = self._booking.handle(token, item) if self._booking is not None else None
        if booked is not None:
            answer = self._repository.submit(token, enquiry, booked.text, booked.language, booked.gloss_en, booked.hold)
            message = answer.get("message") or {}
            if answer.get("outcome") != "submitted":
                result.skipped += 1
            elif booked.hold or message.get("status") == "needs_approval":
                result.held += 1
            else:
                result.answered += 1
            return
        item = self._with_notes(token, item)
        draft = self._drafter.draft(item)
        if draft is None:
            self._repository.skip(token, enquiry, "model unavailable or unusable")
            result.skipped += 1
            return
        # "are you a person / a robot / an AI?" is answered truthfully by code (owner, 20 Nov 2026), in every language and whatever the greeting setting is: the model's planned words never decide it
        said, gloss = ensure_honest(str(item.get("text", "")), draft.text, draft.gloss_en, draft.language, str(item.get("business") or "the business"))
        draft = replace(draft, text=said, gloss_en=gloss)
        reason = must_hand_over(str(item.get("text", "")), confidence=draft.confidence, model_wants_person=draft.wants_person)
        if reason is None and item.get("never_say"):   # a reply with a word this employee never says is held for the owner, not sent
            from app.talk_training.guard import violates

            if violates(draft.text, list(item["never_say"])):
                reason = "never_say"
        answer = self._repository.submit(token, enquiry, draft.text, draft.language, draft.gloss_en, reason is not None)
        message = answer.get("message") or {}
        if answer.get("outcome") != "submitted":
            result.skipped += 1
        elif reason is not None or message.get("status") == "needs_approval":
            result.held += 1
            self._note(token, enquiry, item, draft)
        else:
            result.answered += 1
            self._note(token, enquiry, item, draft)

    def _note(self, token: str, enquiry: uuid.UUID, item: dict[str, Any], draft: Any) -> None:
        """A promise made in a chat is written down AT ONCE (owner, 16 Nov 2026): what the reply promised, by when the customer needs it, and the product they asked about. Never breaks the reply: a failure is a log line."""
        text = str(item.get("text", ""))
        promise = bool(draft.promises) or promises_follow_up(draft.text)
        product = draft.interested_in or product_of(text)
        needed_by = needed_by_of(text, self._today())
        if not promise and product is None and needed_by is None:
            return
        kind = "price" if is_about_price(text, draft.text) else "follow_up"
        what = product or "product not clear"   # never the customer's raw words as a title (owner, 16 Nov 2026); the screen shows the customer's name and an "Open chat" button
        try:
            self._repository.note(token, enquiry, promise, kind if promise else None, what if promise else None, needed_by.isoformat() if needed_by else None, product)
        except TokenRejected:
            raise
        except RepositoryError as exc:
            logger.warning("autoreply: a promise could not be written down (%s)", exc.__class__.__name__)
