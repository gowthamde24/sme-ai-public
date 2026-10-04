"""Review rules shared by the queue view and the label snapshot (pure functions, no I/O).

The score stored with a label must be exactly what the reviewer saw in the queue: the same ICP
version, the same company / contact fields, the same claims and the same evidence. Both paths
therefore build their scoring inputs ONLY through the functions below, so the projection (which
fields, which order, which cap) cannot drift between them.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from pydantic import BaseModel

from app.leads.models import LeadLabelOut
from app.leads.scoring import ScoringResult, score_lead

# What the scoring engine reads. Anything else a row carries (ids, timestamps, notes) is dropped
# so that a field added to a table later cannot change a score unnoticed.
COMPANY_FIELDS = ("name", "city", "region", "country", "industry", "tags", "type", "website")
CONTACT_FIELDS = ("full_name", "email", "phone", "job_title")
CLAIM_FIELDS = ("predicate", "value", "confidence")
# Newest first, capped: a reviewer's view and a label can never disagree because one saw more rows.
MAX_EVIDENCE_INPUTS = 100
MAX_CLAIM_INPUTS = 200  # = CLAIMS_PER_COMPANY, the page size of the claims read


def _plain(row: Any) -> dict[str, Any]:
    if row is None:
        return {}
    if isinstance(row, BaseModel):
        return row.model_dump(mode="json")
    return dict(row)


def company_input(row: Any) -> dict[str, Any]:
    plain = _plain(row)
    return {key: plain.get(key) for key in COMPANY_FIELDS}


def contact_input(row: Any) -> dict[str, Any] | None:
    if row is None:
        return None
    plain = _plain(row)
    return {key: plain.get(key) for key in CONTACT_FIELDS}


def claim_inputs(rows: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Claims in the order given (newest first: the scoring engine takes the first match)."""
    return [{key: row.get(key) for key in CLAIM_FIELDS} for row in list(rows)[:MAX_CLAIM_INPUTS]]


def evidence_inputs(items: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for item in items:
        kind = item.get("kind")
        out.append({"kind": getattr(kind, "value", kind), "url": item.get("url")})
        if len(out) == MAX_EVIDENCE_INPUTS:
            break
    return out


def score_inputs(
    config: dict[str, Any],
    company: Any,
    contact: Any,
    claims: Iterable[Mapping[str, Any]],
    evidence: Iterable[Mapping[str, Any]],
) -> ScoringResult:
    """THE way a lead is scored for a human: queue view and label snapshot both call this."""
    return score_lead(
        config,
        company_input(company),
        contact=contact_input(contact),
        claims=claim_inputs(claims),
        evidence=evidence_inputs(evidence),
    )


def hide_scores(label: LeadLabelOut) -> LeadLabelOut:
    """A label as a blind reviewer may see it: the verdict stays, its stored score does not."""
    return label.model_copy(
        update={"score": None, "score_max_reachable": None, "snapshot": None}
    )
