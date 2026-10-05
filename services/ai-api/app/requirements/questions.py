"""Clarifying questions, derived at READ time from the flags through closed templates (owner decision 2, change E).

Nothing is stored and nothing is sent: the screen shows the text and a Copy button. A question is a pure function of
(flag, field, closed values): never model text, never the customer's own words, never a name, a link or an amount of money.
The only values echoed are closed-vocabulary labels, a whole number (pieces) and a date, so an enquiry cannot smuggle
words into a message that a person might send. Persisted drafts and an approval state belong to the T010 integration.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.requirements.normalise import Value
from app.requirements.policy import Assessment, FieldView, Flag

LABELS = {
    "kanjivaram": "Kanjivaram", "banarasi": "Banarasi", "mysore_silk": "Mysore silk", "paithani": "Paithani",
    "dharmavaram_pattu": "Dharmavaram pattu", "patola": "Patola", "chanderi": "Chanderi",
}  # fmt: skip
FIELD_NAMES = {
    "saree_type": "saree type", "fabric": "fabric", "colour": "colour", "quantity": "quantity", "budget": "budget",
    "deadline": "delivery date", "delivery_city": "delivery city", "payment_terms": "payment terms",
}  # fmt: skip
_MONTHS = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)


@dataclass(frozen=True)
class Question:
    code: str
    text: str
    key: str
    line: int | None


def _date_text(value: Value) -> str:
    d = value.date_value
    if d is None:
        return ""
    return f"{d.day} {_MONTHS[d.month - 1]} {d.year}"


def _item(line: int | None, multi: bool) -> str:
    return f" for item {line}" if multi and line is not None else ""


def _type_label(fields: list[FieldView], line: int | None) -> str | None:
    f = next((f for f in fields if f.live and f.key == "saree_type" and f.line == line), None)
    if f is None or f.value.code is None:
        return None
    return LABELS.get(f.value.code)


def _render(flag: Flag, fields: list[FieldView], multi: bool) -> Question:
    key, line = flag.key, flag.line
    item = _item(line, multi)
    field = next((f for f in fields if f.live and f.key == key and f.line == line), None)
    label = _type_label(fields, line) if key == "quantity" else None
    of_type = f" of {label}" if label else item
    code = f"{flag.kind}_{key}"
    if flag.kind == "conflicting":
        text = (
            f"Your message gives more than one {FIELD_NAMES[key]}{item}. Which one should we use?"
        )
    elif flag.kind == "missing":
        text = {
            "saree_type": f"Which type of saree would you like{item}? For example Kanjivaram, Banarasi, Mysore silk, Paithani or Dharmavaram pattu.",
            "quantity": f"How many pieces do you need{of_type}?",
            "delivery_city": "Which city should we deliver to?",
            "deadline": "By what date do you need the order delivered?",
            "payment_terms": "Which payment terms would you prefer: advance payment, credit days, or cash on delivery?",
        }[key]
    else:  # low_certainty: confirm, echoing closed values only
        v = field.value if field is not None else Value()
        certainty = field.certainty if field is not None else "ambiguous"
        if key == "saree_type" and v.code in LABELS:
            text = f"Just to confirm: is it {LABELS[v.code]}{item}?"
        elif key == "quantity" and v.int_value is not None and certainty == "implied":
            text = f"Just to confirm: do you need about {v.int_value} pieces{of_type}?"
        elif key == "quantity":
            text = f"Could you confirm the exact number of pieces{of_type}?"
        elif key == "deadline" and v.date_value is not None and certainty == "implied":
            text = f"Just to confirm: do you need the order by {_date_text(v)}?"
        elif key == "budget":
            text = (
                "Could you confirm your budget, and whether it is per piece or for the whole order?"
            )
        else:
            text = f"Could you confirm the {FIELD_NAMES[key]}{item}?"
        code = f"confirm_{key}"
    return Question(code=code, text=text, key=key, line=line)


def derive_questions(fields: list[FieldView], assessment: Assessment) -> list[Question]:
    multi = len(assessment.lines) > 1
    return [_render(flag, fields, multi) for flag in assessment.flags]
