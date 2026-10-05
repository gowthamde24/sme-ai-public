"""The contact scrubber for a captured enquiry (T008, owner change A).

An enquiry is stored AFTER its contact details are removed; the original text is kept nowhere.
The scrubber is deliberately CONSERVATIVE: it removes e-mail addresses and Indian mobile numbers
and nothing else, so a quantity, a price, a date, a GSTIN, a pincode or a PO number is never
altered.

  * an e-mail address -> [contact removed]
  * a phone: a +91 / 91 / 0 prefix and 10 digits, or 10 digits starting 6-9; a single space or
    hyphen is allowed after the prefix and between the two groups of five digits.

  Never a phone: a number glued to a letter, digit, rupee sign, # or / ; a comma- or dot-grouped
  number; a number that follows Rs / INR / PO / ref / invoice / order / no / amount / total ...
  (with a separator); two round numbers ("60000 70000").

The SAME two patterns are installed in the database (`app.text_has_contact`, migration
20261015090000), which refuses any subject or body that still matches.
`tests/test_requirements_scrub.py` fails when the two drift apart, and the integration test
`test_enquiries_guard.py` proves, through the real stack, that the guard flags exactly what
`has_contact` flags and that `scrub(x)` always passes it. The patterns use only syntax that
Python `re` and PostgreSQL's regular expressions share (case-insensitive flag, fixed-width
lookbehind, lookahead).
"""

from __future__ import annotations

import re

CONTACT_MARKER = "[contact removed]"

# starts only at the START of a run of address characters (a position inside a long run fails at once: no quadratic scan)
EMAIL_PATTERN = r"(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+"

# words that make a following number an amount, a reference or an identifier, never a phone
_CONTEXT_WORDS = (
    "rs", "inr", "rupees", "rupee", "po", "ref", "inv", "invoice", "order", "no", "gst", "gstin",
    "pin", "amt", "amount", "total", "qty", "₹",
)  # fmt: skip
_CONTEXT_SEPARATORS = (" ", ".", ". ", ":", ": ", "-", "- ", "#", "# ")


def _lookbehinds() -> str:
    # each (word, separator) is its own fixed-width lookbehind, so the same text works in Python
    # and in PostgreSQL
    # the cheap test first: only a digit or a plus can start a phone, so every other position fails at once
    parts = [r"(?=[+0-9])", r"(?<![A-Za-z0-9₹#/])", r"(?<![0-9][,.])"]
    for word in _CONTEXT_WORDS:
        for sep in _CONTEXT_SEPARATORS:
            parts.append("(?<!" + re.escape(word) + re.escape(sep) + ")")
    return "".join(parts)


_PREFIXED = r"(?:\+91|91|0)[ -]?[6-9][0-9]{4}[ -]?[0-9]{5}"
_BARE = r"[6-9][0-9]{9}"
# 5 + 5 with one separator: not when both groups end in 00 (two round amounts such as "60000 70000")
_SPLIT = r"(?![6-9][0-9]{2}00[ -][0-9]{3}00(?![0-9]))[6-9][0-9]{4}[ -][0-9]{5}"
_AFTER = r"(?![A-Za-z0-9]|[,.][0-9]{1,3}(?![0-9]))"

PHONE_PATTERN = _lookbehinds() + "(?:" + _PREFIXED + "|" + _BARE + "|" + _SPLIT + ")" + _AFTER

_EMAIL = re.compile(EMAIL_PATTERN, re.IGNORECASE)
_PHONE = re.compile(PHONE_PATTERN, re.IGNORECASE)


def has_contact(text: str) -> bool:
    return bool(_EMAIL.search(text) or _PHONE.search(text))


def scrub(text: str) -> str:
    """Remove e-mail addresses and Indian mobile numbers; change nothing else.

    Repeated until nothing matches: removing one number can unblock the next one
    ("9876543210,9123456789": the second is only a phone once the first is gone). Each pass
    removes at least one match and adds none, so the loop ends; the result never matches the
    patterns, which is what the database guard checks.
    """
    out = text
    while has_contact(out):
        out = _PHONE.sub(CONTACT_MARKER, _EMAIL.sub(CONTACT_MARKER, out))
    return out
