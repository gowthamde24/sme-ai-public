"""The defaults of "How I talk to customers" per business type (drafts for the Owner to edit; English, the assistant speaks them in the customer's language)."""

# ruff: noqa: E501

from __future__ import annotations

from app.talk_training.models import TalkTraining

QUESTIONS: dict[str, list[str]] = {
    "textiles": ["What is the saree for: a wedding, a function or daily wear?", "Which colours or fabric do you like?", "Roughly what budget do you have in mind?", "When do you need it?"],
    "construction_materials": ["Which material do you need?", "Roughly how much quantity?", "Where is the site?", "When do you need the delivery?"],
    "education": ["Which class is the admission for?", "Which area do you live in?", "When would you like to visit the campus?"],
}
GENERIC = ["What are you looking for?", "When do you need it?", "What is the best time to call you back?"]
NEVER_SAY: list[str] = ["guaranteed", "100% sure", "best price in the market"]

# the platform's own rules: always on, never editable (shown so the Owner knows)
RULES = [
    "Says it is an AI at the start and whenever asked.",
    "Never states a price, discount, total or date it was not given; never promises stock, delivery, a visit time or a refund.",
    "Never asks for an OTP, card, bank detail, password or ID.",
    "Stops calling when asked, and hands over to a person when asked or when the customer is upset.",
    "WhatsApp only when the customer asks for it or agrees on the call.",
]


def defaults_for(pack: str | None, playbook_questions: list[str] | None = None) -> TalkTraining:
    questions = playbook_questions or QUESTIONS.get(pack or "", GENERIC)
    return TalkTraining(address="plain", questions=questions[:8], never_say=list(NEVER_SAY))
