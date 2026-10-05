"""What is missing, what is doubtful, and when a requirement may be confirmed (owner decision 4, change B).

Computed from the stored fields at READ time, by rules; never by the model.

  confirmable      at least one order line whose saree type AND quantity a human has confirmed or corrected.
  ready_for_quote  confirmable, every line that exists has both, and a delivery city, a deadline and payment terms are
                   confirmed or corrected too. This is the flag the quote ticket will read; confirm does not wait for it.
  flags            missing        a slot the quote will need that has no live field (saree type and quantity of each line,
                                  delivery city, deadline, payment terms); optional fields (fabric, colour, budget) are never "missing"
                   low_certainty  a proposed field whose certainty is implied or ambiguous
                   conflicting    a proposed field the enquiry contradicts itself about

A rejected field is not live. A human's confirm or correct settles a field: it raises no flag any more.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.requirements.normalise import Value
from app.requirements.vocabulary import ORDER_KEYS

ACCEPTED = ("confirmed", "corrected")
NEEDED_ORDER_KEYS = ("delivery_city", "deadline", "payment_terms")
LINE_NEEDED = ("saree_type", "quantity")
# the order flags (and so the questions) are listed in: the line first, then where, when, how much, how paid
QUESTION_ORDER = (
    "saree_type",
    "quantity",
    "fabric",
    "colour",
    "delivery_city",
    "deadline",
    "budget",
    "payment_terms",
)


@dataclass(frozen=True)
class FieldView:
    line: int | None
    key: str
    value: Value
    certainty: str
    state: str
    conflict: bool = False
    id: str | None = None

    @property
    def accepted(self) -> bool:
        return self.state in ACCEPTED

    @property
    def live(self) -> bool:
        return self.state != "rejected"


@dataclass(frozen=True)
class Flag:
    kind: str  # missing | low_certainty | conflicting
    key: str
    line: int | None


@dataclass(frozen=True)
class Assessment:
    confirmable: bool
    ready_for_quote: bool
    flags: tuple[Flag, ...]
    lines: tuple[int, ...]


def _slot(fields: list[FieldView], key: str, line: int | None) -> FieldView | None:
    return next((f for f in fields if f.live and f.key == key and f.line == line), None)


def assess(fields: list[FieldView]) -> Assessment:
    live = [f for f in fields if f.live]
    lines = tuple(sorted({f.line for f in live if f.line is not None}))
    asked_lines = lines or (1,)
    flags: list[Flag] = []
    for line in asked_lines:
        for key in LINE_NEEDED:
            if _slot(live, key, line) is None:
                flags.append(Flag("missing", key, line))
    for key in NEEDED_ORDER_KEYS:
        if _slot(live, key, None) is None:
            flags.append(Flag("missing", key, None))
    for f in live:
        if f.accepted:
            continue
        if f.conflict:
            flags.append(Flag("conflicting", f.key, f.line))
        elif f.certainty in ("implied", "ambiguous"):
            flags.append(Flag("low_certainty", f.key, f.line))

    def accepted(key: str, line: int | None) -> bool:
        f = _slot(live, key, line)
        return f is not None and f.accepted

    confirmable = any(accepted("saree_type", n) and accepted("quantity", n) for n in lines)
    ready = (
        confirmable
        and all(accepted(k, n) for n in lines for k in LINE_NEEDED)
        and all(accepted(k, None) for k in NEEDED_ORDER_KEYS)
    )
    order = {k: i for i, k in enumerate(QUESTION_ORDER)}
    kind_order = {"conflicting": 0, "missing": 1, "low_certainty": 2}
    flags.sort(
        key=lambda f: (kind_order[f.kind], f.line if f.line is not None else 99, order[f.key])
    )
    return Assessment(confirmable, ready, tuple(flags), lines)


def order_level(key: str) -> bool:
    return key in ORDER_KEYS
