"""The system prompt of a customer-facing call or voice note (job DT, ADR 0116): the part every such prompt shares. The honesty rule is ALWAYS in it, whatever the opening line says and whatever the
"mention that I'm an AI assistant" switch is: the switch changes only what the assistant volunteers in its greeting. The telephony pipeline is not live (calls are fake until it is), so this is the one place a
dialer, a voice-note writer and the web call widget take their prompt from."""

from __future__ import annotations

from app.agents.register import register_block
from app.conversation.style import conversation_style_block
from app.opening.honesty import HONESTY_RULE


def call_system_prompt(*, business: str, assistant: str, language: str, opening_line: str, goal: str, facts: list[str], caller_memory: str | None = None, mention_ai: bool = False, speaking_style: str | None = None) -> str:
    """`mention_ai` is the owner's switch (ADR 0116); `speaking_style` (everyday_mixed / everyday_pure / formal) adds the register block with the owner's own example lines, and the call-only rules of app/conversation/style.py come with it (job natural-voice)."""
    parts = [
        f"You are {assistant}, the AI assistant of {business}, on a phone call or voice note. Speak in everyday spoken {language}, in short sentences.",
        HONESTY_RULE,
        f"Your opening line was: {opening_line}",
        f"Your goal: {goal}",
        "Use only these approved facts; if something is not here, say you will check with the team and never invent prices, dates or promises:",
        *[f"- {fact}" for fact in facts],
    ]
    if speaking_style is not None:
        parts += [register_block(language, speaking_style), conversation_style_block(language, disclosure_on=mention_ai)]
    if caller_memory:
        parts += ["What the business already knows about this person (use it, do not read it out):", caller_memory]
    return "\n".join(parts)
