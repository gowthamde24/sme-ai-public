"""A first draft of the Talk training from one sentence (C15, first-run builder). The Owner says what the business is and how they like to talk ("we sell silk sarees in Hyderabad, friendly, we call
customers garu"); the model writes a DRAFT; the screen shows it for review; NOTHING is saved here. The model's answer is only DATA: it is read as JSON and every piece is checked by the same rules as a saved
training (a greeting with an unknown placeholder, a price, an amount or a promise, a too-long line, a duplicate is DROPPED, never repaired), then laid over the pack's defaults, so the draft is always a
valid TalkTraining and never empty. Without a model, or when it fails, the draft IS the pack's defaults (source `template`)."""

# ruff: noqa: E501

from __future__ import annotations

import json
from typing import Any

from pydantic import TypeAdapter, ValidationError

from app.talk_training.models import Ask, Example, Objection, SayLike, Short, TalkTraining

MAX_QUESTIONS, MAX_NEVER, MAX_SAY_LIKE, MAX_OBJECTIONS, MAX_EXAMPLES = 8, 20, 20, 8, 5
LANGUAGE_NAMES = {"en": "English", "te": "Telugu", "hi": "Hindi", "kn": "Kannada", "ta": "Tamil", "ml": "Malayalam", "mr": "Marathi"}

SCHEMA = """Reply with ONE JSON object and nothing else, with these keys (all optional; leave a key out when unsure):
  "greeting": the first sentence the assistant says when a call starts, 2 to 200 characters, in {language}; it may use {{business}}; it must say it is an AI assistant
  "tone": "respectful" or "friendly"
  "questions": up to 8 short questions to find out, in order (each up to 160 characters)
  "never_say": up to 20 words or phrases the assistant must never use (each up to 80 characters)
  "say_like": up to 20 of {{"say": "...", "instead_of": "..."}} (the business's own words; instead_of is optional)
  "objections": up to 8 of {{"hears": "what the customer says", "answer": "a short honest answer"}}
  "examples": up to 5 of {{"customer": "...", "answer": "..."}}
Rules: never state a price, an amount, a percentage, a discount or a promise or guarantee; never invent facts about the business; never claim to be a person; write the customer-facing lines in {language}."""


def system_prompt(business: str, language: str) -> str:
    return (
        f"You help the owner of the business \"{business}\" set up how their AI phone assistant talks to customers. The owner describes the business and their way of speaking in one sentence. "
        "Write a DRAFT that the owner will read and change before anything is saved. Use only what the owner said; do not add facts.\n" + SCHEMA.format(language=LANGUAGE_NAMES.get(language, "English"))
    )


def _items(raw: Any, adapter: TypeAdapter[Any], limit: int) -> tuple[list[Any], int]:
    """The valid items of a list, in order, up to `limit`; how many were dropped (invalid, a repeat, or over the limit)."""
    kept: list[Any] = []
    dropped = 0
    for item in raw if isinstance(raw, list) else []:
        try:
            kept.append(adapter.validate_python(item))
        except ValidationError:
            dropped += 1
    if len(kept) > limit:
        dropped += len(kept) - limit
        kept = kept[:limit]
    return kept, dropped


def _json(reply: str) -> dict[str, Any] | None:
    start, end = reply.find("{"), reply.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        doc = json.loads(reply[start : end + 1])
    except ValueError:
        return None
    return doc if isinstance(doc, dict) else None


def assemble(reply: str, base: TalkTraining, language: str) -> tuple[TalkTraining, int] | None:
    """The model's reply laid over `base` (the pack's defaults); None when the reply is not usable at all. Returns (the draft, how many pieces were dropped)."""
    doc = _json(reply)
    if doc is None:
        return None
    dropped = 0
    data = base.model_dump(mode="json")
    greeting = doc.get("greeting")
    if isinstance(greeting, str) and greeting.strip():
        try:
            probe = TalkTraining.model_validate({"greeting": {language: greeting}})
            data["greeting"] = {**data["greeting"], language: next(iter(probe.greeting.values()))}
        except ValidationError:
            dropped += 1
    tone = doc.get("tone")
    if tone in ("respectful", "friendly"):
        data["tone"] = tone
    for key, adapter, limit in (
        ("questions", TypeAdapter(Ask), MAX_QUESTIONS),
        ("never_say", TypeAdapter(Short), MAX_NEVER),
        ("say_like", TypeAdapter(SayLike), MAX_SAY_LIKE),
        ("objections", TypeAdapter(Objection), MAX_OBJECTIONS),
        ("examples", TypeAdapter(Example), MAX_EXAMPLES),
    ):
        if key not in doc:
            continue
        items, lost = _items(doc[key], adapter, limit)
        dropped += lost
        if items:
            data[key] = [i.model_dump(mode="json") if hasattr(i, "model_dump") else i for i in items]
    for key, name in (("never_say", None), ("say_like", "say")):
        seen: set[str] = set()
        unique: list[Any] = []
        for item in data[key]:
            marker = str(item[name] if name else item).casefold()
            if marker in seen:
                dropped += 1
                continue
            seen.add(marker)
            unique.append(item)
        data[key] = unique
    try:
        return TalkTraining.model_validate(data), dropped
    except ValidationError:
        return None

