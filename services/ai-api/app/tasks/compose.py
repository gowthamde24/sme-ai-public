"""The words the engine writes itself (job DR B1): the WhatsApp text when the plan has none, and the follow-up summary. Fixed sentences per language (drafts for native review, everyday spoken style, English nouns in English). They hold no figure, no promise and no name but the business's; the outbox adds the AI line to a person's first message and applies its own rules (opt-in, STOP, quiet hours, daily limit, content flags)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid

NAMESPACE = uuid.UUID("5d0f3f0e-7a0c-4f27-9a41-0b7a1f6d4a10")

ASK: dict[str, str] = {
    "en": "Hello, this is the AI assistant of {business}. Can we ask you a quick question? Just reply here.",
    "te": "నమస్కారం అండీ, నేను {business} నుంచి AI assistant ని. ఒక చిన్న question అడగొచ్చా? ఇక్కడే reply ఇవ్వండి.",
    "hi": "नमस्ते जी, मैं {business} की AI assistant हूँ। एक छोटा question पूछ सकती हूँ? यहीं reply कर दीजिए।",
    "kn": "ನಮಸ್ಕಾರ ರೀ, ನಾನು {business} ನಿಂದ AI assistant. ಒಂದು ಚಿಕ್ಕ question ಕೇಳ್ಬಹುದಾ? ಇಲ್ಲೇ reply ಮಾಡಿ.",
    "ta": "வணக்கம்ங்க, நான் {business} ல இருந்து AI assistant. ஒரு சின்ன question கேக்கலாமா? இங்கேயே reply பண்ணுங்க.",
    "ml": "നമസ്കാരം, ഞാൻ {business} ൽ നിന്ന് AI assistant ആണ്. ഒരു ചെറിയ question ചോദിക്കട്ടെ? ഇവിടെ തന്നെ reply ചെയ്യൂ.",
}
SUMMARY: dict[str, str] = {
    "en": "Thank you for speaking with the AI assistant of {business}. We have noted what you told us.",
    "te": "మాట్లాడినందుకు Thank you అండీ. మీరు చెప్పింది note చేసుకున్నాం. - {business} AI assistant",
    "hi": "बात करने के लिए Thank you जी। आपने जो बताया वो note कर लिया है। - {business} की AI assistant",
    "kn": "ಮಾತಾಡಿದ್ದಕ್ಕೆ Thank you ರೀ. ನೀವು ಹೇಳಿದ್ದನ್ನ note ಮಾಡ್ಕೊಂಡಿದ್ದೀವಿ. - {business} AI assistant",
    "ta": "பேசினதுக்கு Thank you ங்க. நீங்க சொன்னத note பண்ணிக்கிட்டோம். - {business} AI assistant",
    "ml": "സംസാരിച്ചതിന് Thank you. നിങ്ങൾ പറഞ്ഞത് note ചെയ്തിട്ടുണ്ട്. - {business} AI assistant",
}


# the ask for consent (owner, 14 Nov 2026: unknown consent = "ask first"): one short WhatsApp message, spoken style; the answer "OK" is read by the owner in Chats (a reply is not recorded as consent by itself yet)
CONSENT_ASK: dict[str, str] = {
    "en": "Hello, this is the AI assistant of {business}. May we call you and send you messages on WhatsApp? Reply OK if yes. Reply STOP any time to stop.",
    "te": "నమస్కారం అండీ, {business} నుంచి AI assistant ని. మీకు కాల్స్ చేయొచ్చా, WhatsApp మెసేజ్ లు పంపొచ్చా? సరే అయితే OK అని reply ఇవ్వండి. వద్దంటే STOP అని పంపండి.",
    "hi": "नमस्ते जी, मैं {business} की AI assistant हूँ। क्या हम आपको कॉल कर सकते हैं और WhatsApp मैसेज भेज सकते हैं? हाँ तो OK लिख दीजिए। बंद करना हो तो STOP लिखिए।",
    "kn": "ನಮಸ್ಕಾರ ರೀ, ನಾನು {business} ನಿಂದ AI assistant. ನಿಮಗೆ ಕಾಲ್ ಮಾಡಬಹುದಾ, WhatsApp ಮೆಸೇಜ್ ಕಳಿಸಬಹುದಾ? ಸರಿ ಅಂದ್ರೆ OK ಅಂತ reply ಮಾಡಿ. ಬೇಡ ಅಂದ್ರೆ STOP ಅಂತ ಕಳಿಸಿ.",
}


def consent_ask_text(language: str, business: str) -> str:
    return CONSENT_ASK.get(language, CONSENT_ASK["en"]).format(business=business)


def message_id(task_id: uuid.UUID, contact_id: uuid.UUID, kind: str = "task") -> uuid.UUID:
    """The same id for the same person of the same task: a retry or a second runner cannot send twice (the outbox replays an id)."""
    return uuid.uuid5(NAMESPACE, f"{task_id}|{contact_id}|{kind}")


def ask_text(language: str, business: str) -> str:
    return ASK.get(language, ASK["en"]).format(business=business)   # job M1: a language with no words here yet (Marathi) gets the English ones


def summary_text(language: str, business: str) -> str:
    return SUMMARY.get(language, SUMMARY["en"]).format(business=business)
