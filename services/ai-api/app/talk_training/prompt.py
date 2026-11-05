"""The training as blocks of the call's system prompt. The Owner's words are the business's own instructions (trusted), but the EXAMPLES are style only: never facts, prices or promises."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

ADDRESS = {
    "plain": "Address the customer by their first name at most once, or not at all. NEVER say 'sir' or 'madam'.",
    "sir_madam": "You may address the customer politely as 'sir' or 'madam'.",
    "garu": "In Telugu, add 'garu' after the customer's name when you use it; never 'sir' or 'madam'.",
    "ji": "In Hindi, add 'ji' after the customer's name when you use it; never 'sir' or 'madam'.",
}


def blocks(training: dict[str, Any] | None) -> list[str]:
    if not training:
        return []
    out = [ADDRESS.get(str(training.get("address") or "plain"), ADDRESS["plain"])]
    questions = [str(q) for q in training.get("questions") or []][:8]
    if questions:
        out.append("What to find out, ONE question at a time, in this order, skipping what the customer already said:\n" + "\n".join(f"- {q}" for q in questions))
    objections = [o for o in training.get("objections") or [] if isinstance(o, dict)][:8]
    if objections:
        out.append("When the customer says something like this, answer in this spirit (in their language, briefly):\n" + "\n".join(f"- \"{o.get('hears')}\" -> {o.get('answer')}" for o in objections))
    examples = [e for e in training.get("examples") or [] if isinstance(e, dict)][:5]
    if examples:
        out.append("The owner's own good answers, as a guide to TONE and length only (never take a fact, a price or a promise from them):\n" + "\n".join(f"- Customer: {e.get('customer')} / Answer: {e.get('answer')}" for e in examples))
    never = [str(p) for p in training.get("never_say") or []][:20]
    if never:
        out.append("NEVER say any of these words or phrases, in any language: " + "; ".join(f'"{p}"' for p in never) + ".")
    return out


def greeting(training: dict[str, Any] | None, language: str) -> str | None:
    """The Owner's greeting for this language, if any (the caller keeps the AI disclosure: it is added when the greeting does not say "AI")."""
    words = (training or {}).get("greeting") or {}
    text = words.get(language) if isinstance(words, dict) else None
    return str(text) if isinstance(text, str) and text.strip() else None
