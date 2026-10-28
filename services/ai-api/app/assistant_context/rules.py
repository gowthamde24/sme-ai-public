"""The plain rules of the owner's notes (job EB part A): the size, the gentle headings, what a school's notes may not say, how a change is described, and what looks like a list of people. Pure functions."""

from __future__ import annotations

import re

MAX_NOTES = 20_000
USED_BY = ("chats", "calls", "ask", "drafts", "replies")

# the gentle headings the screen offers; the owner fills or ignores them
PROMPTS: tuple[tuple[str, str, str], ...] = (
    ("about", "What we sell", "In a few lines: what the business sells and who buys it."),
    ("prices", "Prices and ranges", "Prices or ranges you are happy for the assistant to know. It still asks you before it quotes one to a customer."),
    ("delivery", "Delivery areas and charges", "Where you deliver, how long it takes, what it costs."),
    ("timings", "Timings", "Opening hours, holidays, the best time to call."),
    ("payment", "Payment terms", "Advance, credit days, UPI, cheque, GST."),
    ("always_say", "What to always say", "Lines the assistant should always include."),
    ("never_say", "What never to say or promise", "Things it must not say, promise or discuss."),
    ("discounts", "Discounts", "When a discount is possible and who decides."),
    ("handover", "When to hand over to me", "Situations where you want to talk to the customer yourself."),
    ("tone", "Tone", "Formal or friendly, how to address people, language mix."),
    ("faq", "Questions customers ask", "A question and your answer, one after another."),
)

# what a school's notes may not make the assistant discuss (the child-data rule): fees, marks and results, dues, and children's details. Words in English, Telugu, Hindi and Kannada.
_SCHOOL = {
    "fees": re.compile(r"\bfees?\b|ఫీజు|फीस|शुल्क|ಶುಲ್ಕ", re.IGNORECASE),
    "marks": re.compile(r"\bmarks?\b|\bgrades?\b|\bresults?\b|\brank(?:s|ing)?\b|\breport cards?\b|మార్కు|ఫలిత|अंक|नतीजे|परिणाम|ಅಂಕ|ಫಲಿತಾಂಶ", re.IGNORECASE),
    "dues": re.compile(r"\bdues?\b|\boutstanding\b|\bpending amount\b|బకాయి|बकाया|ಬಾಕಿ", re.IGNORECASE),
    "children": re.compile(r"\bchild(?:ren)?(?:'s)?\b|\bpupils?\b|\bkids?\b|\bwards?\b|పిల్ల|बच्च|ಮಕ್ಕಳ", re.IGNORECASE),
}
SCHOOL_MESSAGE = "In a school's notes the assistant cannot be told to talk about fees, marks, dues or children's details. Take that part out; the school's own screens keep those."
_PHONE = re.compile(r"(?<!\d)(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)")
_EMAIL = re.compile(r"[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,4}")   # (bounded: no backtracking blow-up on a long line)
_NUMBER = re.compile(r"\d[\d,]*(?:\.\d+)?")


def school_problem(text: str) -> str | None:
    """`fees` | `marks` | `dues` | `children` when a school's notes name such a thing, else None."""
    for reason, pattern in _SCHOOL.items():
        if pattern.search(text):
            return reason
    return None


def looks_like_personal_data(text: str) -> bool:
    """Five or more phone numbers or e-mail addresses: a list of people, which is not context (it belongs in the lead import)."""
    return len(_PHONE.findall(text)) + len(_EMAIL.findall(text)) >= 5


def change_label(old: str, new: str, restored_from: int | None = None) -> str:
    """A short, machine-made description of a change (never a summary of the words): 'added 3 lines', 'removed 1 line', 'edited', 'restored version 2'."""
    if restored_from is not None:
        return f"restored version {restored_from}"
    a = [line for line in old.splitlines() if line.strip()]
    b = [line for line in new.splitlines() if line.strip()]
    if not old.strip():
        return f"added {len(b)} line{'s' if len(b) != 1 else ''}"
    if not new.strip():
        return "cleared"
    if len(b) > len(a) and b[: len(a)] == a:
        n = len(b) - len(a)
        return f"added {n} line{'s' if n != 1 else ''}"
    if len(b) < len(a) and a[: len(b)] == b:
        n = len(a) - len(b)
        return f"removed {n} line{'s' if n != 1 else ''}"
    return "edited"


def numbers_in(text: str) -> set[str]:
    """Every number written in a text, without thousands separators ('1,200' -> '1200')."""
    return {n.replace(",", "") for n in _NUMBER.findall(text)}
