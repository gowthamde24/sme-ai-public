"""Booking a visit by WhatsApp (appointment booking, 14 Nov 2026). Before the model drafts a reply, a customer's message that is about a booking is answered by CODE:

  "book" / "appointment" / "visit" ...  -> the next free times, numbered ("Reply with the number")
  "1", "2", "3" (only a number)         -> that time from the LAST offer is booked (the database holds the offer: nothing is guessed from words)
  RESCHEDULE / "change"                 -> new free times for their own next visit; the number moves it
  CANCEL                                -> their own next visit is cancelled

The database decides everything (hours, closed days, buffer, staff, capacity, Google busy time, one person cannot be in two places, the owner's switch "the assistant may book visits"): this module only reads
the customer's words, asks, and says the fixed templates (app.visits.booking_texts). When the business has not switched it on, or a message is not about booking, it returns None and the usual reply goes on.
Counts, never words or numbers, are logged. Languages: by the script of the message (Telugu, Hindi, Kannada) else English; a language no native reader has checked is held for a person."""

from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from app.assistant.language import detect_owner_language
from app.visits import booking_texts as bt

logger = logging.getLogger("app.autoreply.booking")

_CHOICE = re.compile(r"^\s*([1-9])\s*[.)]?\s*$")
_CANCEL = re.compile(r"(\bcancel\b|\bcancell?ation\b|రద్దు|रद्द|ರದ್ದು)", re.IGNORECASE)
_RESCHEDULE = re.compile(r"(\breschedule\b|\bre-schedule\b|\bpostpone\b|\bchange (the |my )?(time|date|slot|visit|appointment)|మార్చ|बदल|ಬದಲ)", re.IGNORECASE)
_BOOK = re.compile(r"(\bbook(ing)?\b|\bappointments?\b|\bslots?\b|\bvisit\b|\bwhen can i (come|visit)\b|అపాయింట్|బుక్|బుకింగ్|अपॉइंटमेंट|बुक|बुकिंग|ಅಪಾಯಿಂಟ್|ಬುಕ್|ಬುಕಿಂಗ್)", re.IGNORECASE)


class BookingRepository(Protocol):
    def offer_slots(self, token: str, tenant: uuid.UUID, lead: uuid.UUID, language: str, visit: uuid.UUID | None) -> dict[str, Any]: ...
    def book_choice(self, token: str, tenant: uuid.UUID, lead: uuid.UUID, choice: int, visit_id: uuid.UUID) -> dict[str, Any]: ...
    def cancel(self, token: str, tenant: uuid.UUID, lead: uuid.UUID) -> dict[str, Any]: ...
    def next_visit(self, token: str, tenant: uuid.UUID, lead: uuid.UUID) -> dict[str, Any]: ...


@dataclass(frozen=True)
class BookingReply:
    text: str
    language: str
    gloss_en: str | None
    hold: bool   # a language no native reader has checked waits for a person


def _parse(value: Any) -> datetime:
    return datetime.fromisoformat(str(value).replace("Z", "+00:00"))


class BookingFlow:
    def __init__(self, repository: BookingRepository) -> None:
        self._repo = repository

    def handle(self, token: str, item: dict[str, Any]) -> BookingReply | None:
        text = str(item.get("text") or "")
        if not text.strip() or item.get("lead_id") is None:
            return None
        tenant, lead = uuid.UUID(str(item["tenant_id"])), uuid.UUID(str(item["lead_id"]))
        enquiry = uuid.UUID(str(item["enquiry_id"]))
        language = detect_owner_language(text)
        language = language if language in bt.TEMPLATES else "en"   # a customer in a language without words here gets English
        choice = _CHOICE.match(text)
        if choice:
            return self._choose(token, tenant, lead, int(choice.group(1)), enquiry, language)
        if _CANCEL.search(text):
            return self._cancel(token, tenant, lead, language)
        if _RESCHEDULE.search(text):
            return self._offer(token, tenant, lead, language, moving=True)
        if _BOOK.search(text):
            return self._offer(token, tenant, lead, language, moving=False)
        return None

    # ------------------------------------------------------------------------------------------------------------------------------
    def _say(self, kind: bt.Kind, language: str, **kw: Any) -> BookingReply:
        text = bt.render(kind, language, **kw)
        gloss = bt.render(kind, "en", **kw) if language != "en" else None
        return BookingReply(text=text, language=language, gloss_en=gloss, hold=not bt.is_checked(language))

    def _offer(self, token: str, tenant: uuid.UUID, lead: uuid.UUID, language: str, *, moving: bool, kind: bt.Kind = "offer") -> BookingReply | None:
        visit: uuid.UUID | None = None
        have = self._repo.next_visit(token, tenant, lead)
        if have.get("visit_id") is not None:
            visit = uuid.UUID(str(have["visit_id"]))
            if not moving:
                return self._say("have_visit", language, starts_at=_parse(have["starts_at"]))
        elif moving:
            return self._say("no_visit", language)
        answer = self._repo.offer_slots(token, tenant, lead, language, visit)
        if answer.get("reason") == "off":
            return None   # the business has not let the assistant book: the usual reply goes on
        offered = [_parse(s["starts_at"]) for s in answer.get("offered") or []]
        if not offered:
            return self._say("no_visit" if answer.get("reason") == "no_visit" else "none", language)
        return self._say(kind, language, slots=offered)

    def _choose(self, token: str, tenant: uuid.UUID, lead: uuid.UUID, choice: int, enquiry: uuid.UUID, language: str) -> BookingReply | None:
        # one stable id per customer message: a retry of the same message books the same visit once
        visit_id = uuid.uuid5(uuid.NAMESPACE_URL, f"sme-ai-appointment:{tenant}:{lead}:{enquiry}")
        answer = self._repo.book_choice(token, tenant, lead, choice, visit_id)
        status = answer.get("status")
        if status == "booked":
            return self._say("moved" if answer.get("moved") else "booked", language, starts_at=_parse(answer["starts_at"]))
        if status == "taken":
            return self._offer(token, tenant, lead, language, moving=False, kind="taken") or self._say("none", language)
        return None   # no open offer, a number that was not offered, or the business switched it off: it is an ordinary message

    def _cancel(self, token: str, tenant: uuid.UUID, lead: uuid.UUID, language: str) -> BookingReply | None:
        answer = self._repo.cancel(token, tenant, lead)
        status = answer.get("status")
        if status == "cancelled":
            return self._say("cancelled", language)
        if status == "no_visit":
            return self._say("no_visit", language)
        return None
