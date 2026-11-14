"""Act, do not rehearse (owner, 14 Nov 2026): when the owner clearly tells the assistant to send a message to, or call, ONE person they named, THAT instruction is the approval. There is no card to say yes to:
the plan is approved at once and carried out, and the reply says exactly what happened ("Sent", "Calling now", or the one plain reason it could not go and the next step).

What counts as clear (all of it, in code): the owner NAMED one person (the plan's `consent.owner_named`, one contact), a message has the owner's own words in it (`message_text`) or it is a call, and nothing is
bigger than one person. Anything else stays a card. The same safeguards run as for a card: strict consent (the owner naming them is the consent), the outbox policy and its first-message rules, the
WhatsApp test fence (a number outside it is refused by the adapter, never sent), the sandbox list for a real call, the per-day limit. A message that the outbox holds for approval is approved here too: the
owner's words ARE the approval, and it is handed to the channel at once; the outcome is read back from the outbox, never assumed."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import threading
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from app.tasks import compose
from app.tasks.models import TaskOut

logger = logging.getLogger("app.turns.act")

SENT = {
    "en": "Sent to {name}: \"{text}\" ✓",
    "te": "{name} కి పంపాను: \"{text}\" ✓",
    "hi": "{name} को भेज दिया: \"{text}\" ✓",
    "kn": "{name} ಗೆ ಕಳುಹಿಸಿದೆ: \"{text}\" ✓",
}
ON_ITS_WAY = {
    "en": "On its way to {name}: \"{text}\". I will tell you when WhatsApp has taken it.",
    "te": "{name} కి వెళ్తోంది: \"{text}\". WhatsApp తీసుకున్నాక చెప్తాను.",
    "hi": "{name} को जा रहा है: \"{text}\"। WhatsApp के लेते ही बताऊँगी।",
    "kn": "{name} ಗೆ ಹೋಗುತ್ತಿದೆ: \"{text}\". WhatsApp ತೆಗೆದುಕೊಂಡ ಮೇಲೆ ಹೇಳುತ್ತೇನೆ.",
}
NOT_SENT = {
    "en": "I could not send it to {name}: WhatsApp can only reach the test numbers right now (until Meta's review is done). Shall I open it in your own WhatsApp instead?",
    "te": "{name} కి పంపలేకపోయాను: ఇప్పుడు WhatsApp టెస్ట్ నంబర్లకు మాత్రమే వెళ్తుంది (Meta రివ్యూ అయ్యే వరకు). బదులుగా మీ WhatsApp లో తెరవమంటారా?",
    "hi": "{name} को नहीं भेज पाई: अभी WhatsApp सिर्फ़ टेस्ट नंबरों तक पहुँचता है (Meta की समीक्षा पूरी होने तक)। क्या इसे आपके अपने WhatsApp में खोल दूँ?",
    "kn": "{name} ಗೆ ಕಳುಹಿಸಲಾಗಲಿಲ್ಲ: ಈಗ WhatsApp ಟೆಸ್ಟ್ ನಂಬರ್‌ಗಳಿಗೆ ಮಾತ್ರ ಹೋಗುತ್ತದೆ (Meta ರಿವ್ಯೂ ಆಗುವವರೆಗೆ). ಬದಲಿಗೆ ನಿಮ್ಮ WhatsApp ನಲ್ಲಿ ತೆರೆಯಲೇ?",
}
HELD = {
    "en": "I could not send it to {name} just now: the message is waiting in your Outbox ({why}). Say \"send it\" again after fixing that.",
    "te": "{name} కి ఇప్పుడు పంపలేకపోయాను: మెసేజ్ మీ Outbox లో ఉంది ({why}). అది సరిచేసాక మళ్ళీ \"పంపు\" అనండి.",
    "hi": "{name} को अभी नहीं भेज पाई: संदेश आपके Outbox में रुका है ({why})। ठीक करके फिर \"भेजो\" कहिए।",
    "kn": "{name} ಗೆ ಈಗ ಕಳುಹಿಸಲಾಗಲಿಲ್ಲ: ಸಂದೇಶ ನಿಮ್ಮ Outbox ನಲ್ಲಿದೆ ({why}). ಸರಿಪಡಿಸಿ ಮತ್ತೆ \"ಕಳುಹಿಸು\" ಎನ್ನಿ.",
}
CALLING = {
    "en": "Calling {name} now. I will tell you how it went.",
    "te": "{name} కి ఇప్పుడే కాల్ చేస్తున్నాను. ఎలా జరిగిందో చెప్తాను.",
    "hi": "{name} को अभी कॉल कर रही हूँ। कैसा रहा, बताऊँगी।",
    "kn": "{name} ಗೆ ಈಗಲೇ ಕಾಲ್ ಮಾಡುತ್ತಿದ್ದೇನೆ. ಹೇಗಾಯಿತು ಹೇಳುತ್ತೇನೆ.",
}


UNDO_SECONDS = 30
QUEUED = {
    "en": "Sending to {name} in {sec} seconds: \"{text}\". Tap Undo to stop it.",
    "te": "{name} కి {sec} సెకన్లలో పంపుతున్నాను: \"{text}\". ఆపాలంటే Undo నొక్కండి.",
    "hi": "{name} को {sec} सेकंड में भेज रही हूँ: \"{text}\"। रोकना हो तो Undo दबाइए।",
    "kn": "{name} ಗೆ {sec} ಸೆಕೆಂಡಿನಲ್ಲಿ ಕಳುಹಿಸುತ್ತಿದ್ದೇನೆ: \"{text}\". ನಿಲ್ಲಿಸಲು Undo ಒತ್ತಿ.",
}


@dataclass
class Acted:
    sentence: str
    status: str   # sent | queued | on_its_way | not_sent | held | calling | manual
    card: dict[str, Any] | None = None   # the work card `message` (docs/contracts/conversation.md)
    message_id: uuid.UUID | None = None


def eligible(task: TaskOut) -> bool:
    """One person the owner named, and either a call or a message with the owner's own words."""
    plan = task.plan
    if task.status != "planned" or plan is None or plan.contacts_total != 1 or plan.consent is None or not plan.consent.owner_named:
        return False
    if plan.audience is None or plan.audience.kind != "one" or plan.needs_second_confirm:
        return False
    if plan.channel == "call":
        return True
    return plan.channel == "whatsapp" and bool(plan.message_text)


def _line(table: dict[str, str], language: str, **kw: Any) -> str:
    return table.get(language, table["en"]).format(**kw)


def _first_name(task: TaskOut) -> str:
    sample = task.plan.contacts_sample if task.plan is not None else []
    return (sample[0].name or "").strip() if sample and sample[0].name else "them"


def _card(message_id: uuid.UUID | None, name: str, text: str, state: str, *, undo_until: datetime | None = None, manual_reason: str | None = None) -> dict[str, Any]:
    """The `message` work card: who it is for (a name, never a number), the words, where it stands, how long Undo lasts. The number lives only in the web's own redirect."""
    return {"kind": "message", "id": str(message_id or uuid.uuid4()), "message_id": str(message_id) if message_id else None, "recipient": {"name": name}, "text": text, "state": state,
            "undo": {"until": undo_until.isoformat().replace("+00:00", "Z")} if undo_until else None, "manual_reason": manual_reason, "delivery": None}


def carry_out(runtime: Any, ctx: Any, task: TaskOut, language: str, approve: Any) -> Acted:
    """Approve the plan (`approve(task_id, schedule)` is the turn's own yes: the same code as the card's button) and carry it out. A message is run here and read back; a call runs in the background."""
    plan = task.plan
    assert plan is not None   # noqa: S101
    name = _first_name(task)
    token, tenant = ctx.principal.token, ctx.tenant.id
    if plan.channel == "call":
        approve(task.id, lambda fn, *a: threading.Thread(target=fn, args=a, daemon=True).start())
        return Acted(_line(CALLING, language, name=name), "calling")
    text = (plan.message_text or "")[:300]
    people = runtime.tasks.contacts(token, tenant, task.id, None, 5, None).contacts
    contact = people[0] if people else None
    if contact is None:
        return Acted(_line(HELD, language, name=name, why="nobody to send to"), "held", _card(None, name, text, "failed"))
    adapter = getattr(runtime, "outbox_adapter", None)
    reach = getattr(adapter, "may_reach_last4", None)
    if reach is not None and contact.phone_last4 and not reach(contact.phone_last4):   # the test fence: nothing would leave, so say so now and offer the owner's own WhatsApp
        return Acted(_line(NOT_SENT, language, name=name), "manual", _card(None, name, text, "manual", manual_reason="test_recipient_only"))
    approve(task.id, lambda fn, *a: fn(*a))   # a message is a quick submit to the outbox: run it now
    message_id = compose.message_id(task.id, contact.contact_id, "task")
    status, until = _settle(runtime, token, tenant, message_id)
    if status == "sent":
        return Acted(_line(SENT, language, name=name, text=text), "sent", _card(message_id, name, text, "sent"), message_id)
    if status == "queued":
        sentence = _line(QUEUED, language, name=name, text=text, sec=UNDO_SECONDS) if until else _line(ON_ITS_WAY, language, name=name, text=text)
        return Acted(sentence, "queued", _card(message_id, name, text, "queued", undo_until=until), message_id)
    if status in ("failed", "rejected"):
        return Acted(_line(NOT_SENT, language, name=name), "not_sent", _card(message_id, name, text, "manual", manual_reason="test_recipient_only"), message_id)
    return Acted(_line(HELD, language, name=name, why=status or "not accepted"), "held", _card(message_id, name, text, "failed"), message_id)


def _settle(runtime: Any, token: str, tenant: uuid.UUID, message_id: uuid.UUID) -> tuple[str, datetime | None]:
    """The message's state in the outbox after the owner's words approved it: a message the policy held for approval is approved by those words (no second factor; migration 20261231840000), queued for the
    short grace window of Undo, and sent by the worker when it ends. The answer is what the outbox says, never an assumption. Returns (status, when Undo ends or None)."""
    outbox = getattr(runtime, "outbox", None)
    if outbox is None:
        return "", None
    try:
        row = outbox.get_message(token, tenant, message_id) or {}
        status = str(row.get("status") or "")
        if status == "needs_approval":
            done = outbox.approve_said(token, tenant, message_id, UNDO_SECONDS)
            return str(done.get("status") or "queued"), datetime.now(UTC) + timedelta(seconds=UNDO_SECONDS)
        return status, None
    except Exception as exc:   # the class only: the person hears the plain reason, the log holds the class
        logger.warning("act: the message could not be settled: %s", exc.__class__.__name__)
        return "held", None
