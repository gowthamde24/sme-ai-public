"""The words the engine writes itself (job DR B1): the WhatsApp text when the plan has none, and the follow-up summary. Fixed sentences per language (drafts for native review, everyday spoken style, English nouns in English). They hold no figure, no promise and no name but the business's; the outbox adds the AI line to a person's first message and applies its own rules (opt-in, STOP, quiet hours, daily limit, content flags)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid

NAMESPACE = uuid.UUID("5d0f3f0e-7a0c-4f27-9a41-0b7a1f6d4a10")

ASK: dict[str, str] = {
    "en": "Hello, this is Vijaya, {business}'s AI assistant. Can we ask you a quick question? Just reply here.",
    "te": "నమస్కారం అండీ, నేను విజయ, {business} నుంచి AI assistant ని. ఒక చిన్న question అడగొచ్చా? ఇక్కడే reply ఇవ్వండి.",
    "hi": "नमस्ते जी, मैं विजया, {business} से AI assistant हूँ। एक छोटा question पूछ सकती हूँ? यहीं reply कर दीजिए।",
    "kn": "ನಮಸ್ಕಾರ ರೀ, ನಾನು ವಿಜಯ, {business} ನಿಂದ AI assistant. ಒಂದು ಚಿಕ್ಕ question ಕೇಳ್ಬಹುದಾ? ಇಲ್ಲೇ reply ಮಾಡಿ.",
    "ta": "வணக்கம்ங்க, நான் விஜயா, {business} ல இருந்து AI assistant. ஒரு சின்ன question கேக்கலாமா? இங்கேயே reply பண்ணுங்க.",
    "ml": "നമസ്കാരം, ഞാൻ വിജയ, {business} ൽ നിന്ന് AI assistant ആണ്. ഒരു ചെറിയ question ചോദിക്കട്ടെ? ഇവിടെ തന്നെ reply ചെയ്യൂ.",
}
SUMMARY: dict[str, str] = {
    "en": "Thank you for speaking with Vijaya, {business}'s AI assistant. We have noted what you told us.",
    "te": "మాట్లాడినందుకు Thank you అండీ. మీరు చెప్పింది note చేసుకున్నాం. - {business} AI assistant విజయ",
    "hi": "बात करने के लिए Thank you जी। आपने जो बताया वो note कर लिया है। - {business} की AI assistant विजया",
    "kn": "ಮಾತಾಡಿದ್ದಕ್ಕೆ Thank you ರೀ. ನೀವು ಹೇಳಿದ್ದನ್ನ note ಮಾಡ್ಕೊಂಡಿದ್ದೀವಿ. - {business} AI assistant ವಿಜಯ",
    "ta": "பேசினதுக்கு Thank you ங்க. நீங்க சொன்னத note பண்ணிக்கிட்டோம். - {business} AI assistant விஜயா",
    "ml": "സംസാരിച്ചതിന് Thank you. നിങ്ങൾ പറഞ്ഞത് note ചെയ്തിട്ടുണ്ട്. - {business} AI assistant വിജയ",
}


def message_id(task_id: uuid.UUID, contact_id: uuid.UUID, kind: str = "task") -> uuid.UUID:
    """The same id for the same person of the same task: a retry or a second runner cannot send twice (the outbox replays an id)."""
    return uuid.uuid5(NAMESPACE, f"{task_id}|{contact_id}|{kind}")


def ask_text(language: str, business: str) -> str:
    return ASK[language].format(business=business)


def summary_text(language: str, business: str) -> str:
    return SUMMARY[language].format(business=business)
