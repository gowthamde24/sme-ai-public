# ruff: noqa: E501
"""What a call takes from the AI employee that answers it (26 Nov 2026). Pure functions: the call path reads the employee once at its start (`employee_runtime`) and these turn it into the call's own values.

The ORDER of authority never changes: platform rules (money guard, consent, DND, calling window, the lawyer-opinion rules) > the workspace's Talk training and never-say words > this employee's words > the facts > the caller's words (data).
An employee can only ADD never-say words, only NARROW the hours, and its instructions are text the model is told are the owner's wishes for this employee, never rules that outrank the ones above.
The default employee is today's assistant: its persona stays in My assistant (name, voices, speed, tone), so only its identity block (role, jobs, instructions, never-say) is added; a call with the flag off reads no employee at all."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

ROLE_WORDS = {
    "receptionist": "the receptionist", "sales": "the sales assistant", "follow_up": "the follow-up assistant", "collections": "the payments assistant",
    "support": "the support assistant", "appointments": "the appointments assistant", "custom": "an assistant",
}
JOB_WORDS = {
    "enquiry_reply": "answer enquiries", "faq_answers": "answer common questions", "visit_booking": "book visits", "quote_chase": "follow up on quotes", "lead_qualify": "ask a new lead what they need",
    "follow_up": "follow up with customers", "review_request": "ask happy customers for a review", "payment_reminder": "remind customers about payments", "appointment_reminder": "remind customers of appointments",
}
ASK_WORDS = {
    "send_message": "send a message", "make_call": "call someone", "give_discount": "give a discount", "promise_date": "promise a date or a delivery time",
    "book_visit": "book a visit", "share_price": "state a price", "send_media": "send a photo or a file",
}


def is_default(emp: Mapping[str, Any] | None) -> bool:
    return emp is not None and emp.get("persona_in") == "my_assistant"


def block(emp: Mapping[str, Any] | None) -> str:
    """The employee's lines for the phone prompt: who it is, what it does, what it asks the owner first, and the owner's own words about it (as data). Empty when there is no employee."""
    if not emp:
        return ""
    name = str(emp.get("name") or "").strip()
    title = str(emp.get("role_title") or "").strip() or ROLE_WORDS.get(str(emp.get("role_code") or ""), "an assistant")
    jobs = [JOB_WORDS[j] for j in emp.get("responsibilities") or [] if j in JOB_WORDS]
    lines = [f"YOU ARE {name}, {title} of this business." if name else f"You are {title} of this business."]
    if jobs:
        lines.append("Your jobs: " + ", ".join(jobs) + ". Outside these jobs, say the team will get back to the customer.")
    ask = [ASK_WORDS[a] for a in emp.get("ask_first") or [] if a in ASK_WORDS]
    if not is_default(emp) and ask:
        lines.append("You never do these on your own: " + ", ".join(ask) + ". Say the team will do it after the owner agrees.")
    raw_autonomy = emp.get("autonomy")
    autonomy: Mapping[str, Any] = raw_autonomy if isinstance(raw_autonomy, Mapping) else {}
    if not is_default(emp):
        if autonomy.get("may_answer_prices") is False:
            lines.append("Do not state any price: say the team will share it.")
        if autonomy.get("may_book_visits") is False:
            lines.append("Do not book visits: say the team will arrange it.")
        if autonomy.get("may_talk_dues") is False:
            lines.append("Do not talk about money the customer owes.")
        discount = autonomy.get("max_discount_percent")
        if isinstance(discount, int) and not isinstance(discount, bool):
            lines.append(f"You may never offer a discount above {discount} percent." if discount > 0 else "You may never offer a discount.")
    extra = str(emp.get("extra_instructions") or "").strip()
    if extra:
        lines.append("The owner's own words about how you work (these never override the rules above): " + " ".join(extra.split()))
    return "\n".join(lines)


def apply(emp: Mapping[str, Any] | None, sound_row: dict[str, Any] | None, training: dict[str, Any] | None, assistant: str | None) -> tuple[dict[str, Any] | None, dict[str, Any] | None, str | None]:
    """(sound_row, training, assistant name) for this call. A non-default employee brings its own voices, speed, style, name and opening; every employee ADDS its never-say words to the workspace's."""
    if not emp:
        return sound_row, training, assistant
    train = dict(training) if isinstance(training, dict) else {}
    extra_never = [str(w) for w in emp.get("never_say") or [] if str(w).strip()]
    if extra_never:
        seen = {str(w).casefold() for w in train.get("never_say") or []}
        train["never_say"] = [*(train.get("never_say") or []), *[w for w in extra_never if w.casefold() not in seen]]
    if is_default(emp):
        return sound_row, (train or training), assistant
    row = dict(sound_row) if isinstance(sound_row, dict) else {}
    voices = emp.get("voices")
    row["choices"] = {str(k): str(v) for k, v in voices.items()} if isinstance(voices, Mapping) else {}   # a language this employee has no voice for gets the catalogue's default, never the workspace's choice
    if isinstance(emp.get("speed"), int | float) and not isinstance(emp.get("speed"), bool):
        row["speed"] = float(emp["speed"])
    if isinstance(emp.get("style"), str):
        row["style"] = emp["style"]
    opening = emp.get("opening_line")
    if isinstance(opening, Mapping) and opening:
        earlier = train.get("greeting")
        base: Mapping[str, Any] = earlier if isinstance(earlier, Mapping) else {}
        train["greeting"] = {**base, **{str(k): str(v) for k, v in opening.items()}}   # (the AI disclosure is still added when it is missing)
    name = str(emp.get("name") or "").strip() or assistant
    return row, train, name


def within_hours(emp: Mapping[str, Any] | None, weekday: int, minute_of_day: int) -> bool:   # weekday 1 = Monday ... 7 = Sunday
    """Whether `now` (India time) is inside the employee's own narrower hours. No hours = no further limit (the workspace's window still applies elsewhere)."""
    hours = emp.get("hours") if emp else None
    if not isinstance(hours, Mapping):
        return True
    days = [int(d) for d in hours.get("days") or []]
    return weekday in days and int(hours.get("from_minute", 0)) <= minute_of_day < int(hours.get("to_minute", 1440))
