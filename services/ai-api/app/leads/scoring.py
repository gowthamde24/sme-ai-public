"""Pure deterministic ICP scoring engine (ADR 0010, milestone 2).

No I/O, no database, no LLM. Evaluates a lead against an ICP configuration dictionary and produces
a reproducible scoring snapshot with factor points, unknown markers, flags, and bands.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.leads.keys import match_key

ALLOWED_RULE_TYPES = {
    "keyword_fit",
    "attribute_fraction",
    "place_tier",
    "attribute_max",
    "contact_quality",
    "evidence_count",
}


class InvalidIcpConfigError(ValueError):
    """Raised when an ICP configuration violates structural or semantic rules."""


@dataclass(frozen=True)
class FactorResult:
    id: str
    label: str
    points: int
    max_points: int
    unknown: bool
    detail: str | None = None


@dataclass(frozen=True)
class ScoringResult:
    score: int
    score_max_reachable: int
    band: str
    factors: list[FactorResult]
    flags: list[str]
    exclusions: list[str]

    def to_snapshot(self) -> dict[str, Any]:
        return {
            "score": self.score,
            "score_max_reachable": self.score_max_reachable,
            "band": self.band,
            "factors": [
                {
                    "id": f.id,
                    "points": f.points,
                    "max_points": f.max_points,
                    "unknown": f.unknown,
                }
                for f in self.factors
            ],
            "flags": self.flags,
            "exclusions": self.exclusions,
        }


def validate_icp_config(config: dict[str, Any]) -> None:
    """Validate that an ICP configuration conforms to the closed rule-type set and sum-to-100
    constraint.
    """
    if not isinstance(config, dict):
        raise InvalidIcpConfigError("Configuration must be a JSON object")

    factors = config.get("factors")
    if not isinstance(factors, list) or not (1 <= len(factors) <= 20):
        raise InvalidIcpConfigError("Configuration must contain between 1 and 20 factors")

    total_weight = 0
    vocab_names = set(config.get("vocabularies", {}))
    attr_names = set(config.get("attributes", {}))

    for f in factors:
        if not isinstance(f, dict):
            raise InvalidIcpConfigError("Factor must be an object")
        fid = f.get("id")
        if not fid or not isinstance(fid, str) or not re.match(r"^[a-z][a-z0-9_]{0,39}$", fid):
            raise InvalidIcpConfigError(f"Invalid factor ID: {fid}")

        max_pts = f.get("max_points")
        if not isinstance(max_pts, int) or max_pts < 0 or max_pts > 100:
            raise InvalidIcpConfigError(
                f"Factor {fid} max_points must be an integer between 0 and 100"
            )
        total_weight += max_pts

        rule = f.get("rule")
        if not isinstance(rule, dict):
            raise InvalidIcpConfigError(f"Factor {fid} must contain a rule object")

        rtype = rule.get("type")
        if rtype not in ALLOWED_RULE_TYPES:
            raise InvalidIcpConfigError(f"Factor {fid} has unrecognised rule type: {rtype}")

        # Check references
        for vkey in ("strong_vocabulary", "weak_vocabulary", "decision_maker_vocabulary"):
            vname = rule.get(vkey)
            if vname and vname not in vocab_names:
                raise InvalidIcpConfigError(f"Factor {fid} references unknown vocabulary: {vname}")

        for attr in [rule.get("attribute"), *rule.get("attributes", [])]:
            if attr and attr not in attr_names:
                raise InvalidIcpConfigError(f"Factor {fid} references unknown attribute: {attr}")

        # Check explicit unknown handling
        for key in ("when_missing", "when_not_listed"):
            if key in rule and rule[key] != "unknown":
                raise InvalidIcpConfigError(f"Factor {fid} {key} must be 'unknown'")

    if total_weight != 100:
        raise InvalidIcpConfigError(f"Factor weights must sum to 100 (got {total_weight})")

    bands = config.get("bands")
    if not isinstance(bands, list) or len(bands) == 0:
        raise InvalidIcpConfigError("Configuration must specify score bands")


def _term_in_text(term: str, text: str) -> bool:
    """Check if term appears in text with word boundaries."""
    t_clean = match_key(term)
    if not t_clean:
        return False
    padded = f" {match_key(text)} "
    return f" {t_clean} " in padded


def _evaluate_keyword_fit(
    rule: dict[str, Any], max_points: int, company: dict[str, Any], config: dict[str, Any]
) -> FactorResult:
    strong_vocab = (
        config.get("vocabularies", {}).get(rule.get("strong_vocabulary", ""), {}).get("terms", [])
    )
    weak_vocab = (
        config.get("vocabularies", {}).get(rule.get("weak_vocabulary", ""), {}).get("terms", [])
    )

    strong_terms = [t["term"] for t in strong_vocab if isinstance(t, dict) and "term" in t]
    weak_terms = [t["term"] for t in weak_vocab if isinstance(t, dict) and "term" in t]

    industry = str(company.get("industry") or "")
    tags_list = company.get("tags") or []
    tags = " ".join(tags_list) if isinstance(tags_list, list) else str(tags_list)
    name = str(company.get("name") or "")

    ind_and_tags = f"{industry} {tags}".strip()

    strong_in_ind = any(_term_in_text(t, ind_and_tags) for t in strong_terms)
    strong_in_name = any(_term_in_text(t, name) for t in strong_terms)
    weak_in_any = any(_term_in_text(t, f"{ind_and_tags} {name}") for t in weak_terms)

    pct_map = rule.get("points_percent", {})
    if strong_in_ind:
        pct = pct_map.get("strong_in_industry_or_tags", 100)
    elif strong_in_name:
        pct = pct_map.get("strong_in_name_only", 70)
    elif weak_in_any:
        pct = pct_map.get("weak_only", 35)
    else:
        pct = pct_map.get("none", 0)

    pts = round(max_points * pct / 100)
    return FactorResult(
        id="silk_saree_fit",
        label="Silk / saree product fit",
        points=pts,
        max_points=max_points,
        unknown=False,
    )


def _evaluate_attribute_fraction(
    fid: str,
    label: str,
    rule: dict[str, Any],
    max_points: int,
    claims: list[dict[str, Any]],
    config: dict[str, Any],
) -> FactorResult:
    attr_name = rule.get("attribute", "")
    claim_val = next(
        (
            c["value"]
            for c in claims
            if c.get("predicate") == attr_name and not c.get("archived_at")
        ),
        None,
    )

    if not claim_val:
        return FactorResult(id=fid, label=label, points=0, max_points=max_points, unknown=True)

    attr_cfg = config.get("attributes", {}).get(attr_name, {}).get("values", [])
    val_entry = next((v for v in attr_cfg if v.get("value") == claim_val), None)
    if val_entry is None:
        pct = 0
    else:
        pct = val_entry.get("points_percent", 0)

    pts = round(max_points * pct / 100)
    return FactorResult(id=fid, label=label, points=pts, max_points=max_points, unknown=False)


def _evaluate_place_tier(
    fid: str,
    label: str,
    rule: dict[str, Any],
    max_points: int,
    company: dict[str, Any],
    config: dict[str, Any],
) -> FactorResult:
    city = company.get("city")
    region = company.get("region") or company.get("country")

    if not city and not region:
        return FactorResult(id=fid, label=label, points=0, max_points=max_points, unknown=True)

    city_clean = match_key(str(city)) if city else ""
    region_clean = match_key(str(region)) if region else ""

    tiers = config.get("geography", {}).get("tiers", [])
    for tier in tiers:
        pct = tier.get("points_percent", 0)
        places = tier.get("places", [])
        for place in places:
            kind = place.get("kind")
            aliases = [place.get("canonical")] + [
                a.get("term") for a in place.get("aliases", []) if a.get("term")
            ]
            alias_keys = {match_key(a) for a in aliases if a}

            if kind == "city":
                if city_clean and (
                    city_clean in alias_keys or any(a in city_clean for a in alias_keys)
                ):
                    pts = round(max_points * pct / 100)
                    return FactorResult(
                        id=fid, label=label, points=pts, max_points=max_points, unknown=False
                    )
            elif kind == "region":
                target = region_clean or city_clean
                if target and (target in alias_keys or any(a in target for a in alias_keys)):
                    pts = round(max_points * pct / 100)
                    return FactorResult(
                        id=fid, label=label, points=pts, max_points=max_points, unknown=False
                    )

    return FactorResult(id=fid, label=label, points=0, max_points=max_points, unknown=True)


def _evaluate_attribute_max(
    fid: str,
    label: str,
    rule: dict[str, Any],
    max_points: int,
    claims: list[dict[str, Any]],
    config: dict[str, Any],
) -> FactorResult:
    attrs = rule.get("attributes", [])
    found_points: list[int] = []

    for attr in attrs:
        claim_val = next(
            (c["value"] for c in claims if c.get("predicate") == attr and not c.get("archived_at")),
            None,
        )
        if claim_val:
            val_cfg = config.get("attributes", {}).get(attr, {}).get("values", [])
            val_entry = next((v for v in val_cfg if v.get("value") == claim_val), None)
            pct = val_entry.get("points_percent", 0) if val_entry else 0
            found_points.append(round(max_points * pct / 100))

    if not found_points:
        return FactorResult(id=fid, label=label, points=0, max_points=max_points, unknown=True)

    return FactorResult(
        id=fid, label=label, points=max(found_points), max_points=max_points, unknown=False
    )


def _evaluate_contact_quality(
    fid: str,
    label: str,
    rule: dict[str, Any],
    max_points: int,
    contact: dict[str, Any] | None,
    config: dict[str, Any],
) -> FactorResult:
    if not contact:
        return FactorResult(id=fid, label=label, points=0, max_points=max_points, unknown=False)

    email = contact.get("email")
    phone = contact.get("phone")
    title = contact.get("job_title")

    pts = 0
    if email:
        pts += rule.get("email_points", 0)
    if phone:
        pts += rule.get("phone_points", 0)

    if title:
        dm_vocab_name = rule.get("decision_maker_vocabulary", "")
        dm_vocab = config.get("vocabularies", {}).get(dm_vocab_name, {}).get("terms", [])
        dm_terms: list[str] = [
            str(t["term"]) for t in dm_vocab if isinstance(t, dict) and t.get("term")
        ]
        if any(_term_in_text(t, title) for t in dm_terms):
            pts += rule.get("decision_maker_points", 0)

    pts = min(max_points, pts)
    return FactorResult(id=fid, label=label, points=pts, max_points=max_points, unknown=False)


def _evaluate_evidence_count(
    fid: str, label: str, rule: dict[str, Any], max_points: int, evidence: list[dict[str, Any]]
) -> FactorResult:
    ev_count = len(evidence)
    kinds = {e.get("kind") for e in evidence if e.get("kind")}

    pts = 0
    if ev_count >= 1:
        pts += rule.get("any_points", 0)
    if ev_count >= 2:
        pts += rule.get("two_or_more_points", 0)
    if len(kinds) >= 2:
        pts += rule.get("two_or_more_kinds_points", 0)

    pts = min(max_points, pts)
    return FactorResult(id=fid, label=label, points=pts, max_points=max_points, unknown=False)


def score_lead(
    config: dict[str, Any],
    company: dict[str, Any],
    contact: dict[str, Any] | None = None,
    claims: list[dict[str, Any]] | None = None,
    evidence: list[dict[str, Any]] | None = None,
) -> ScoringResult:
    """Score a lead deterministically against an ICP configuration."""
    claims_list = claims or []
    evidence_list = evidence or []

    factor_results: list[FactorResult] = []

    for f in config.get("factors", []):
        fid = f["id"]
        label = f.get("label", fid)
        max_points = f.get("max_points", 0)
        rule = f.get("rule", {})
        rtype = rule.get("type")

        if rtype == "keyword_fit":
            res = _evaluate_keyword_fit(rule, max_points, company, config)
        elif rtype == "attribute_fraction":
            res = _evaluate_attribute_fraction(fid, label, rule, max_points, claims_list, config)
        elif rtype == "place_tier":
            res = _evaluate_place_tier(fid, label, rule, max_points, company, config)
        elif rtype == "attribute_max":
            res = _evaluate_attribute_max(fid, label, rule, max_points, claims_list, config)
        elif rtype == "contact_quality":
            res = _evaluate_contact_quality(fid, label, rule, max_points, contact, config)
        elif rtype == "evidence_count":
            res = _evaluate_evidence_count(fid, label, rule, max_points, evidence_list)
        else:
            res = FactorResult(id=fid, label=label, points=0, max_points=max_points, unknown=True)

        factor_results.append(res)

    total_score = sum(f.points for f in factor_results if not f.unknown)
    reachable = 100 - sum(f.max_points for f in factor_results if f.unknown)

    # Determine band from bands list
    bands = sorted(config.get("bands", []), key=lambda b: b.get("min", 0), reverse=True)
    band_label = "low_priority"
    for b in bands:
        if total_score >= b.get("min", 0):
            band_label = b.get("label", "low_priority")
            break

    # Determine flags
    flags: list[str] = []
    # no_saree_evidence: when silk_saree_fit is 0
    saree_fit = next((f for f in factor_results if f.id == "silk_saree_fit"), None)
    if saree_fit and saree_fit.points == 0:
        flags.append("no_saree_evidence")

    # no_evidence: when evidence_count is 0
    if len(evidence_list) == 0:
        flags.append("no_evidence")

    # consumer flag
    buyer_type_claim = next(
        (
            c.get("value")
            for c in claims_list
            if c.get("predicate") == "buyer_type" and not c.get("archived_at")
        ),
        None,
    )
    if buyer_type_claim == "consumer":
        flags.append("consumer")

    # closed_or_inactive flag
    op_status_claim = next(
        (
            c.get("value")
            for c in claims_list
            if c.get("predicate") == "operating_status" and not c.get("archived_at")
        ),
        None,
    )
    if op_status_claim in ("inactive", "closed"):
        flags.append("closed_or_inactive")

    # unrelated_apparel_only
    unrelated_vocab = config.get("vocabularies", {}).get("unrelated_apparel", {}).get("terms", [])
    unrelated_terms = [
        str(t["term"]) for t in unrelated_vocab if isinstance(t, dict) and t.get("term")
    ]
    tags_str = " ".join(company.get("tags") or [])
    comp_text = f"{company.get('name', '')} {company.get('industry', '')} {tags_str}"
    if (
        any(_term_in_text(t, comp_text) for t in unrelated_terms)
        and saree_fit
        and saree_fit.points == 0
    ):
        flags.append("unrelated_apparel_only")

    # Exclusions
    exclusions: list[str] = []
    for excl in config.get("exclusions", []):
        field = excl.get("field")
        eq = excl.get("equals")
        reason = excl.get("reason", "excluded")
        if field == "company.type" and company.get("type") == eq:
            exclusions.append(reason)

    return ScoringResult(
        score=total_score,
        score_max_reachable=reachable,
        band=band_label,
        factors=factor_results,
        flags=flags,
        exclusions=exclusions,
    )


def scored_attributes(config: dict[str, Any]) -> frozenset[str]:
    """The claim predicates a tenant's ICP profile actually reads: every `attribute` / `attributes`
    entry its rules and exclusions name.
    A suggestion with any other predicate cannot change a score, whatever its review state."""
    found: set[str] = set()

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            attribute = node.get("attribute")
            if isinstance(attribute, str):
                found.add(attribute)
            names = node.get("attributes")
            # a rule that reads several predicates (the config's own `attributes` MAP is a dict)
            if isinstance(names, list):
                found.update(n for n in names if isinstance(n, str))
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for item in node:
                walk(item)

    walk(config)
    return frozenset(found)
