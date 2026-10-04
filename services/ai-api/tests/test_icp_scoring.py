"""Unit tests for the pure deterministic ICP scoring engine (app/leads/scoring.py)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.leads.scoring import (
    InvalidIcpConfigError,
    score_lead,
    validate_icp_config,
)

PATH = Path(__file__).resolve().parents[3] / "config" / "icp" / "silk-wholesale.v1.json"
TEMPLATE = json.loads(PATH.read_text(encoding="utf-8"))


def test_template_validates_successfully() -> None:
    validate_icp_config(TEMPLATE)


def test_validator_enforces_sum_to_100() -> None:
    bad = {**TEMPLATE, "factors": [{**TEMPLATE["factors"][0], "max_points": 50}]}
    with pytest.raises(InvalidIcpConfigError, match="must sum to 100"):
        validate_icp_config(bad)


def test_validator_rejects_unknown_rule_type() -> None:
    bad_factors = list(TEMPLATE["factors"])
    bad_factors[0] = {**bad_factors[0], "rule": {"type": "llm_evaluation"}}
    bad = {**TEMPLATE, "factors": bad_factors}
    with pytest.raises(InvalidIcpConfigError, match="unrecognised rule type"):
        validate_icp_config(bad)


def test_validator_rejects_missing_vocab() -> None:
    bad_factors = list(TEMPLATE["factors"])
    bad_factors[0] = {
        **bad_factors[0],
        "rule": {**bad_factors[0]["rule"], "strong_vocabulary": "nonexistent_vocab"},
    }
    bad = {**TEMPLATE, "factors": bad_factors}
    with pytest.raises(InvalidIcpConfigError, match="unknown vocabulary"):
        validate_icp_config(bad)


def test_score_lead_perfect_fit() -> None:
    company = {
        "name": "Kanchipuram Silks Wholesale",
        "industry": "Silk Saree Wholesaler",
        "tags": ["saree", "pattu"],
        "city": "Bengaluru",
        "type": "prospect",
    }
    contact = {
        "full_name": "Ramesh Gupta",
        "email": "ramesh@example.test",
        "phone": "+0012345678",
        "job_title": "Proprietor and Owner",
    }
    claims = [
        {"predicate": "buyer_type", "value": "wholesaler"},
        {"predicate": "order_scale", "value": "five_or_more_per_order"},
    ]
    evidence = [
        {"kind": "website", "url": "https://example.test"},
        {"kind": "directory", "url": "https://directory.test"},
    ]

    res = score_lead(TEMPLATE, company, contact=contact, claims=claims, evidence=evidence)
    assert res.score == 100
    assert res.score_max_reachable == 100
    assert res.band == "priority"
    assert "no_saree_evidence" not in res.flags
    assert "no_evidence" not in res.flags
    assert res.exclusions == []

    snap = res.to_snapshot()
    assert snap["score"] == 100
    assert snap["score_max_reachable"] == 100
    assert snap["band"] == "priority"


def test_score_lead_with_unknown_factors() -> None:
    # Company with only keyword match, no location, no claims, no contact, no evidence
    company: dict[str, Any] = {
        "name": "Sri Lakshmi Sarees",
        "industry": "Retail",
        "tags": [],
        "city": None,
        "type": "prospect",
    }
    res = score_lead(TEMPLATE, company)
    # silk_saree_fit: strong in name -> 70% of 25 = 18 points
    # buyer_type_fit: unknown (20 max points)
    # geography_fit: unknown (20 max points)
    # business_scale: unknown (15 max points)
    # reachability: 0 (10 max points, known)
    # evidence_quality: 0 (10 max points, known)
    assert res.score == 18
    # reachable: 100 - (20 + 20 + 15) = 45
    assert res.score_max_reachable == 45
    assert res.band == "low_priority"

    unknown_fids = {f.id for f in res.factors if f.unknown}
    assert unknown_fids == {"buyer_type_fit", "geography_fit", "business_scale"}


def test_score_lead_tier2_geography_and_boutique() -> None:
    company = {
        "name": "Dharmavaram Saree Center",
        "industry": "Silk Sarees",
        "tags": [],
        "city": "Dharmavaram",
        "type": "prospect",
    }
    claims = [
        {"predicate": "buyer_type", "value": "boutique"},  # 50% of 20 = 10
    ]
    res = score_lead(TEMPLATE, company, claims=claims)
    # silk_saree_fit: strong in industry -> 25
    # buyer_type_fit: boutique -> 10
    # geography_fit: dharmavaram -> 60% of 20 = 12
    # business_scale: unknown (15)
    # reachability: 0 (10)
    # evidence_quality: 0 (10)
    # total = 25 + 10 + 12 = 47
    assert res.score == 47
    assert res.score_max_reachable == 85


def test_exclusion_rule_flags_existing_customer() -> None:
    company = {
        "name": "Bangalore Silks",
        "type": "customer",
    }
    res = score_lead(TEMPLATE, company)
    assert "already_customer" in res.exclusions
