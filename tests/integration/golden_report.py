"""The golden set of the Research Agent (T007 M3): 20 synthetic businesses with a known answer, and a report of what the agent proposed
and what a careful reviewer did with it, against that answer.

OFFLINE. The scripted research model, the fixture sites (tests/golden/research/sites), the real local stack. The scripted model is a
stand-in: it plays a careful reader with blunt keyword rules, so these numbers prove the PIPELINE (fetch scope, quotes, review, the
database rules) and give a baseline; the agent's real quality is measured only with a real model (M4).

The reviewer here is a SCRIPT that plays a careful person, with rules written independently of the model's:
  accept (at medium confidence) only when
    * the page opened at the business's own host names the business (a site that shows another name is the wrong site),
    * the quote contains no sign that it is about someone else or about the past (sister / partner / not / no longer / formerly ...),
    * the quote contains a phrase that a person would take as saying the claimed value (CUES),
    * and the business has no other suggestion for the same predicate with a DIFFERENT value (they disagree: reject all, a person must
      decide).
  otherwise reject. Accept and reject go through the real review function, so "accepted" is the real state in the database.

For every (business, predicate), against `expected` (a value, or null = the site does not say):
  proposed        agent claims written for it                   accepted_ok     accepted and equal to expected
  accepted_WRONG  accepted and not equal to expected  <- THE GATE: must be zero
  rejected        agent claims the reviewer rejected            missing         an answer was expected and no accepted claim has it
  abstained_ok    nothing expected and nothing proposed
"""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1] / "golden" / "research"
PREDICATES = ("buyer_type", "order_scale", "size_band", "operating_status")

OTHER_COMPANY_OR_PAST = re.compile(
    r"\b(sister|partner|affiliate|formerly|used to|no longer|not|never|closed our)\b", re.I
)
CUES: dict[tuple[str, str], re.Pattern[str]] = {
    ("buyer_type", "wholesaler"): re.compile(r"wholesale", re.I),
    ("buyer_type", "saree_shop"): re.compile(r"saree (?:shop|store|showroom)", re.I),
    ("buyer_type", "boutique"): re.compile(r"boutique", re.I),
    ("buyer_type", "consumer"): re.compile(
        r"walk-in customers|retail customers only|individual customers only", re.I
    ),
    ("buyer_type", "multi_brand_store"): re.compile(r"multi-?brand", re.I),
    ("buyer_type", "regional_chain"): re.compile(r"\d+ (?:stores|branches|outlets)|chain of", re.I),
    ("buyer_type", "other"): re.compile(r"uniforms|dress fabrics", re.I),
    ("order_scale", "five_or_more_per_order"): re.compile(
        r"minimum (?:of )?five pieces|five or more pieces|bulk", re.I
    ),
    ("order_scale", "fewer_than_five_per_order"): re.compile(
        r"single pieces?|no bulk|one piece at a time", re.I
    ),
    ("size_band", "large"): re.compile(
        r"(?:over|more than) \d{3,} (?:staff|employees)|large group", re.I
    ),
    ("size_band", "medium"): re.compile(r"mid-sized|medium-sized", re.I),
    ("size_band", "small"): re.compile(r"small (?:team|business)", re.I),
    ("size_band", "micro"): re.compile(r"two people|one-person|one person|home-based", re.I),
    ("operating_status", "active"): re.compile(
        r"open (?:daily|every day|six days|seven days)", re.I
    ),
    ("operating_status", "closed"): re.compile(
        r"closed permanently|permanently closed|shut down", re.I
    ),
    ("operating_status", "inactive"): re.compile(
        r"temporarily closed|not operating|on a break", re.I
    ),
}


def load_businesses() -> list[dict[str, Any]]:
    data = json.loads((ROOT / "businesses.json").read_text(encoding="utf-8"))
    businesses: list[dict[str, Any]] = data["businesses"]
    return businesses


@dataclass
class Claim:
    id: str
    predicate: str
    value: str
    quote: str
    host: str


def plausible(claim: Claim, *, company_name: str, home_text: str) -> bool:
    """Would a careful person find this quote convincing ON ITS OWN?"""
    first_word = company_name.split()[0].lower()
    if first_word not in home_text[:300].lower():
        return False  # the site does not show this business's name: the wrong site
    if OTHER_COMPANY_OR_PAST.search(claim.quote):
        return False  # about someone else, or about the past
    cue = CUES.get((claim.predicate, claim.value))
    return cue is not None and cue.search(claim.quote) is not None


def reviewer_accepts(
    claim: Claim, *, company_name: str, home_text: str, claims: list[Claim]
) -> bool:
    if not plausible(claim, company_name=company_name, home_text=home_text):
        return False
    # the plausible suggestions for this predicate must AGREE: if they say different things a person must decide, none is accepted here
    values = {
        c.value
        for c in claims
        if c.predicate == claim.predicate
        and plausible(c, company_name=company_name, home_text=home_text)
    }
    return len(values) == 1


@dataclass
class Tally:
    expected: int = 0
    proposed: int = 0
    accepted_ok: int = 0
    accepted_wrong: int = 0
    rejected: int = 0
    missing: int = 0
    abstained_ok: int = 0
    wrong_proposed: int = 0


@dataclass
class Report:
    by_predicate: dict[str, Tally] = field(default_factory=lambda: {p: Tally() for p in PREDICATES})
    lines: list[str] = field(default_factory=list)
    wrong_accepted: list[str] = field(default_factory=list)

    def add(self, business: dict[str, Any], claims: list[tuple[Claim, bool]]) -> None:
        """claims: every agent claim of the run with whether the reviewer ACCEPTED it."""
        parts: list[str] = []
        for predicate in PREDICATES:
            want = business["expected"][predicate]
            mine = [(c, ok) for c, ok in claims if c.predicate == predicate]
            t = self.by_predicate[predicate]
            t.proposed += len(mine)
            t.expected += want is not None
            t.rejected += sum(1 for _, ok in mine if not ok)
            t.wrong_proposed += sum(1 for c, _ in mine if c.value != want)
            accepted = [c for c, ok in mine if ok]
            t.accepted_ok += sum(1 for c in accepted if c.value == want)
            wrong = [c for c in accepted if c.value != want]
            t.accepted_wrong += len(wrong)
            for c in wrong:
                self.wrong_accepted.append(
                    f"{business['id']} {predicate}: accepted {c.value!r}, expected {want!r}"
                )
            if want is not None and not any(c.value == want for c in accepted):
                t.missing += 1
            if want is None and not mine:
                t.abstained_ok += 1
            if mine or want is not None:
                shown = ",".join(f"{c.value}{'+' if ok else '-'}" for c, ok in mine) or "none"
                parts.append(f"{predicate}={shown} (expected {want})")
        if not parts:
            parts.append("abstained: nothing expected, nothing proposed")
        self.lines.append(f"{business['id']} {business['name']:<20} " + "; ".join(parts))

    def render(self) -> str:
        head = f"{'predicate':<17}{'expected':>9}{'proposed':>9}{'accepted ok':>12}{'ACCEPTED WRONG':>15}{'rejected':>9}{'missing':>8}{'abstained ok':>13}"
        rows = [head, "-" * len(head)]
        total = Tally()
        for predicate in PREDICATES:
            t = self.by_predicate[predicate]
            rows.append(
                f"{predicate:<17}{t.expected:>9}{t.proposed:>9}{t.accepted_ok:>12}{t.accepted_wrong:>15}{t.rejected:>9}{t.missing:>8}{t.abstained_ok:>13}"
            )
            for name in vars(total):
                setattr(total, name, getattr(total, name) + getattr(t, name))
        rows.append("-" * len(head))
        rows.append(
            f"{'all':<17}{total.expected:>9}{total.proposed:>9}{total.accepted_ok:>12}{total.accepted_wrong:>15}{total.rejected:>9}{total.missing:>8}{total.abstained_ok:>13}"
        )
        accepted = total.accepted_ok + total.accepted_wrong
        precision = f"{total.accepted_ok}/{accepted}" if accepted else "n/a"
        recall = f"{total.accepted_ok}/{total.expected}"
        agent_precision = f"{total.proposed - total.wrong_proposed}/{total.proposed}"
        return "\n".join(
            [
                "Research Agent golden set: 20 synthetic businesses, scripted model, scripted careful reviewer (offline)",
                "",
                *rows,
                "",
                f"precision of ACCEPTED claims: {precision}   recall of expected answers: {recall}   agent claims equal to the expected answer: {agent_precision}",
                "(accepted = accepted by the scripted reviewer through the real review function; missing = an answer was expected and no accepted claim has it)",
                "",
                "per business (+ accepted, - rejected):",
                *self.lines,
                "",
            ]
        )


def group_values(claims: list[Claim]) -> dict[str, set[str]]:
    out: dict[str, set[str]] = defaultdict(set)
    for c in claims:
        out[c.predicate].add(c.value)
    return out
