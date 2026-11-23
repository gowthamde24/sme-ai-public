"""The golden set of the Requirement Agent (T008): 20 synthetic enquiries with a known answer, and a report of what the agent proposed and what
a careful reviewer did with it, against that answer.

OFFLINE. The scripted requirement model, the real local stack, the real database functions. The scripted model is a stand-in: it plays a careful
reader with blunt rules, so these numbers prove the PIPELINE (quotes, caps, flags, the database rules, the decisions) and give a baseline; the
agent's real quality is measured only with a real model, after the owner's approval.

For every (enquiry, slot), against `expected` (a typed value, or nothing = the enquiry does not say):
  matched          proposed and equal to expected            (matched_flagged: right, but marked implied / ambiguous: a person checks it)
  wrong_STATED     proposed with certainty `stated` and not equal to expected   <- THE GATE: must be zero
  extra_STATED     proposed with certainty `stated` where nothing is expected   <- THE GATE: must be zero
  wrong_flagged / extra_flagged   the same, marked implied / ambiguous / conflicting: a person is warned
  missed           expected, and not proposed: a question is derived for it
The careful reviewer is a SCRIPT: it approves what equals the answer, corrects what is wrong where the answer exists, rejects what is extra,
and leaves what is missing alone. Every decision goes through the real decide function.
"""

# ruff: noqa: E501

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date
from typing import Any

import requirement_eval as rq

KEYS = (
    "saree_type",
    "fabric",
    "colour",
    "quantity",
    "budget",
    "deadline",
    "delivery_city",
    "payment_terms",
)


def load_enquiries() -> list[dict[str, Any]]:
    data = json.loads((rq.GOLDEN / "enquiries.json").read_text(encoding="utf-8"))
    enquiries: list[dict[str, Any]] = data["enquiries"]
    return enquiries


def slot_of(item: dict[str, Any]) -> tuple[int, str]:
    return (
        int(item.get("line") or item.get("line_no") or 0),
        str(item.get("key") or item.get("field_key")),
    )


def expected_typed(e: dict[str, Any]) -> dict[str, Any]:
    return {
        "code": e.get("code"),
        "int": e.get("int"),
        "date": e.get("date"),
        "text": e.get("text"),
        "basis": e.get("basis"),
    }


def row_typed(r: dict[str, Any]) -> dict[str, Any]:
    return {
        "code": r["value_code"],
        "int": r["value_int"],
        "date": r["value_date"],
        "text": r["value_text"],
        "basis": r["basis"],
    }


def same(a: dict[str, Any], b: dict[str, Any]) -> bool:

    def text(v: Any) -> str | None:
        return None if v is None else " ".join(str(v).split()).casefold()

    return (a["code"], a["int"], a["date"], a["basis"]) == (
        b["code"],
        b["int"],
        b["date"],
        b["basis"],
    ) and text(a["text"]) == text(b["text"])


@dataclass
class Counts:
    expected: int = 0
    proposed: int = 0
    matched: int = 0
    matched_flagged: int = 0
    wrong_stated: int = 0
    wrong_flagged: int = 0
    extra_stated: int = 0
    extra_flagged: int = 0
    missed: int = 0

    def add(self, other: Counts) -> None:
        for name in self.__dataclass_fields__:
            setattr(self, name, getattr(self, name) + getattr(other, name))


@dataclass
class Review:
    """What happened to one enquiry."""

    id: str
    title: str
    by_key: dict[str, Counts] = field(default_factory=lambda: defaultdict(Counts))
    notes: list[str] = field(default_factory=list)
    confirmed: int = 0
    corrected: int = 0
    rejected: int = 0
    confirmable: bool = False
    ready: bool = False
    questions: list[str] = field(default_factory=list)
    actions: list[tuple[str, str, dict[str, Any]]] = field(
        default_factory=list
    )  # (field row id, decision, typed value for a correction)


def classify(enquiry: dict[str, Any], proposed: list[dict[str, Any]]) -> Review:
    """Compare proposals with the answer and plan what the careful reviewer does."""
    review = Review(enquiry["id"], enquiry["title"])
    expected = {slot_of(e): e for e in enquiry["expected"]}
    rows = {slot_of(r): r for r in proposed}
    for slot in sorted(set(expected) | set(rows)):
        key = slot[1]
        c = review.by_key[key]
        e, p = expected.get(slot), rows.get(slot)
        label = f"{slot[0] or '-'}:{key}"
        c.expected += 1 if e else 0
        c.proposed += 1 if p else 0
        flagged = p is not None and (p["certainty"] != "stated" or p["conflict"])
        if e and p and same(expected_typed(e), row_typed(p)):
            c.matched += 1
            c.matched_flagged += 1 if flagged else 0
            review.actions.append((p["id"], "confirm", {}))
            review.notes.append(f"{label}: matched{' (flagged)' if flagged else ''}")
        elif e and p:
            c.wrong_flagged += 1 if flagged else 0
            c.wrong_stated += 0 if flagged else 1
            review.actions.append((p["id"], "correct", expected_typed(e)))
            review.notes.append(
                f"{label}: WRONG{' (flagged)' if flagged else ' (STATED)'}: proposed {row_typed(p)}, expected {expected_typed(e)}"
            )
        elif e:
            c.missed += 1
            review.notes.append(f"{label}: missed")
        elif p:
            c.extra_flagged += 1 if flagged else 0
            c.extra_stated += 0 if flagged else 1
            review.actions.append((p["id"], "reject", {}))
            review.notes.append(
                f"{label}: extra{' (flagged)' if flagged else ' (STATED)'}: proposed {row_typed(p)}"
            )
    return review


def render(reviews: list[Review]) -> str:
    total = Counts()
    totals: dict[str, Counts] = {k: Counts() for k in KEYS}
    for r in reviews:
        for key, c in r.by_key.items():
            totals[key].add(c)
            total.add(c)
    head = [
        "field",
        "expected",
        "proposed",
        "matched",
        "matched_flagged",
        "wrong_STATED",
        "wrong_flagged",
        "extra_STATED",
        "extra_flagged",
        "missed",
    ]
    lines = [
        "T008 requirement golden report (scripted model, 20 synthetic enquiries; the real database functions)",
        "A stand-in model: these numbers prove the pipeline and give a baseline. Real quality is measured only with a real model.",
        "THE GATE: wrong_STATED and extra_STATED are zero.",
        "",
        " | ".join(f"{h:>15}" if i else f"{h:<15}" for i, h in enumerate(head)),
    ]
    for key in (*KEYS, "TOTAL"):
        c = total if key == "TOTAL" else totals[key]
        cells = [
            c.expected,
            c.proposed,
            c.matched,
            c.matched_flagged,
            c.wrong_stated,
            c.wrong_flagged,
            c.extra_stated,
            c.extra_flagged,
            c.missed,
        ]
        lines.append(" | ".join([f"{key:<15}", *[f"{n:>15}" for n in cells]]))
    lines += [
        "",
        f"reviewer: approved {sum(r.confirmed for r in reviews)}, corrected {sum(r.corrected for r in reviews)}, rejected {sum(r.rejected for r in reviews)}",
        "",
    ]
    for r in reviews:
        lines.append(f"{r.id} {r.title}")
        lines += [f"    {n}" for n in r.notes] or ["    (nothing expected, nothing proposed)"]
        lines.append(
            f"    after review: can approve={'yes' if r.confirmable else 'no'}, ready for quote={'yes' if r.ready else 'no'}; questions: {', '.join(r.questions) or '-'}"
        )
    return "\n".join(lines) + "\n"


def parse_date(value: str | None) -> date | None:
    return date.fromisoformat(value) if value else None
