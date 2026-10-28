"""(a) Inbound: the assistant answers the business number (timings, directions, FAQs from the approved knowledge facts, bookings) and a MISSED call gets an instant WhatsApp plus a callback plan. Pure."""

from __future__ import annotations

import re
from dataclasses import dataclass

# the knowledge-fact kinds of the Lead Desk (docs: contract-lead-desk): product_service, hours, location, policy, faq
INTENTS = {
    "hours": re.compile(r"\b(timing|timings|open|opens|close|closes|hours|when are you)\b|టైమింగ్|సమయం|समय|कब खुल|ਸਮਾਂ|ಸಮಯ", re.IGNORECASE),
    "location": re.compile(r"\b(where|address|location|direction|directions|map|reach)\b|ఎక్కడ|చిరునామా|कहाँ|पता|ಎಲ್ಲಿ|ವಿಳಾಸ", re.IGNORECASE),
    "booking": re.compile(r"\b(book|booking|appointment|visit|slot|schedule|demo)\b|బుక్|అపాయింట్|बुक|अपॉइंटमेंट|ಬುಕ್", re.IGNORECASE),
}


@dataclass(frozen=True)
class InboundAnswer:
    intent: str  # hours | location | booking | faq | handoff
    text: str | None
    needs_human: bool


def answer_inbound(question: str, facts: list[tuple[str, str]]) -> InboundAnswer:
    """`facts` are (kind, text) of the APPROVED facts only. No fact, no answer: it hands over instead of inventing one."""
    for intent in ("hours", "location"):
        if INTENTS[intent].search(question):
            hit = next((t for k, t in facts if k == intent), None)
            return InboundAnswer(intent, hit, hit is None)
    if INTENTS["booking"].search(question):
        return InboundAnswer("booking", None, False)  # the booking tool (parity.tools.book_slot) takes over
    words = {w for w in re.findall(r"\w{4,}", question.lower())}
    best = max(((len(words & set(re.findall(r"\w{4,}", t.lower()))), t) for k, t in facts if k in ("faq", "policy", "product_service")), default=(0, ""))
    if best[0] >= 2:
        return InboundAnswer("faq", best[1], False)
    return InboundAnswer("handoff", None, True)


@dataclass(frozen=True)
class MissedCallPlan:
    whatsapp: str
    callback_in_minutes: int


def missed_call_plan(business: str, assistant: str, *, in_calling_hours: bool) -> MissedCallPlan:
    """Instant WhatsApp, and a callback in 5 minutes inside calling hours or when the day starts (the existing hours rules decide the exact time)."""
    text = f"Hello, this is {assistant}, the AI assistant of {business}. Sorry we missed your call. I will call you back shortly; or tell me here what you need."
    return MissedCallPlan(text, 5 if in_calling_hours else 0)
