"""config/icp/silk-wholesale.v1.json: the repository template of a silk-saree wholesaler's ICP.

It is a TEMPLATE (generic structure, owner placeholders, everything unverified). It must never hold
real customer data, prices, phone numbers or e-mail addresses: the family's real answers are
published later, as tenant data, through the API. These checks run without a database;
tests/integration/test_icp_template_in_db.py proves the database accepts it."""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest

from app.evidence.models import text_is_clean

PATH = Path(__file__).resolve().parents[3] / "config" / "icp" / "silk-wholesale.v1.json"
RAW = PATH.read_text(encoding="utf-8")
CFG: dict[str, Any] = json.loads(RAW)


def walk(node: Any) -> Iterator[Any]:
    yield node
    if isinstance(node, dict):
        for value in node.values():
            yield from walk(value)
    elif isinstance(node, list):
        for item in node:
            yield from walk(item)


def test_factors_and_weights_are_the_approved_six_and_sum_to_100() -> None:
    weights = {f["id"]: f["max_points"] for f in CFG["factors"]}
    assert weights == {
        "silk_saree_fit": 25,
        "buyer_type_fit": 20,
        "geography_fit": 20,
        "business_scale": 15,
        "reachability": 10,
        "evidence_quality": 10,
    }
    assert sum(weights.values()) == 100
    assert [f["id"] for f in CFG["factors"]] == list(weights), "order is part of the template"


def test_bands_are_unchanged_and_human_labels_override_the_score() -> None:
    assert [(b["min"], b["label"]) for b in CFG["bands"]] == [
        (80, "priority"),
        (65, "worth_reviewing"),
        (50, "maybe"),
        (0, "low_priority"),
    ]
    assert CFG["human_labels_override_score"] is True


def test_geography_tiers_and_unknown_is_never_silently_zero() -> None:
    tiers = {t["id"]: t for t in CFG["geography"]["tiers"]}
    assert [t["id"] for t in CFG["geography"]["tiers"]] == ["tier1", "tier2", "tier3"], (
        "first match wins in this order"
    )
    assert {k: v["points_percent"] for k, v in tiers.items()} == {
        "tier1": 100,
        "tier2": 60,
        "tier3": 40,
    }
    canon = {k: [p["canonical"] for p in v["places"]] for k, v in tiers.items()}
    assert canon == {
        "tier1": ["bengaluru"],
        "tier2": ["dharmavaram", "andhra pradesh"],
        "tier3": ["karnataka"],
    }
    rule = next(f["rule"] for f in CFG["factors"] if f["id"] == "geography_fit")
    assert rule["when_missing"] == "unknown" and rule["when_not_listed"] == "unknown"
    for factor in CFG["factors"]:
        for key in ("when_missing", "when_not_listed"):
            assert factor["rule"].get(key, "unknown") == "unknown", (
                f"{factor['id']}: a missing input is unknown, never 0"
            )


def test_buyer_types_primary_reduced_and_others_zero() -> None:
    values = {v["value"]: v["points_percent"] for v in CFG["attributes"]["buyer_type"]["values"]}
    assert values["saree_shop"] == 100 and values["wholesaler"] == 100
    assert 0 < values["boutique"] < 100
    assert all(
        p == 0 for k, p in values.items() if k not in ("saree_shop", "wholesaler", "boutique")
    )


def test_existing_customers_are_excluded() -> None:
    assert {"field": "company.type", "equals": "customer"}.items() <= CFG["exclusions"][0].items()


def test_native_script_aliases_exist_and_every_one_is_unverified() -> None:
    langs = {t["lang"] for t in CFG["vocabularies"]["silk_saree_strong"]["terms"]}
    assert {"en", "te", "kn", "hi"} <= langs
    place_langs = {
        a["lang"] for t in CFG["geography"]["tiers"] for p in t["places"] for a in p["aliases"]
    }
    assert {"en", "te", "kn", "hi"} <= place_langs
    terms = [n for n in walk(CFG) if isinstance(n, dict) and "term" in n]
    assert len(terms) > 60
    assert all(n["verification"] == "unverified" for n in terms), "every alias is marked unverified"


def test_everything_that_can_carry_a_verification_is_unverified() -> None:
    marked = [n for n in walk(CFG) if isinstance(n, dict) and "verification" in n]
    assert len(marked) > 80
    assert {n["verification"] for n in marked} == {"unverified"}
    for factor in CFG["factors"]:
        assert factor["verification"] == "unverified"
    for tier in CFG["geography"]["tiers"]:
        assert tier["verification"] == "unverified"
    for name, vocab in CFG["vocabularies"].items():
        assert vocab["verification"] == "unverified", name
    for name, attr in CFG["attributes"].items():
        assert attr["verification"] == "unverified", name
    assert CFG["template"]["verification"] == "unverified"
    assert "not yet confirmed" in CFG["template"]["source"]


def test_it_is_a_template_without_real_data_or_prices() -> None:
    assert CFG["template"]["contains_real_customer_data"] is False
    assert CFG["template"]["contains_prices"] is False
    assert CFG["examples"] == [], (
        "the family's good / bad customer archetypes arrive later as tenant data"
    )
    # the template's own description says "no prices", so the keyword scan covers everything else
    body = json.dumps({k: v for k, v in CFG.items() if k != "template"}, ensure_ascii=False)
    assert not re.search(r"\d{7,}", RAW), "no phone-number-like digit runs"
    assert "@" not in RAW and "http" not in RAW.lower(), "no e-mail addresses or URLs"
    assert not re.search(r"[₹$€£]", RAW), "no currency symbols"
    assert not re.search(
        r"\b(rs\.?|inr|usd|mrp|price|prices|rupees?|per piece)\b", body, re.IGNORECASE
    )
    money_keys = [
        k
        for n in walk({k: v for k, v in CFG.items() if k != "template"})
        if isinstance(n, dict)
        for k in n
        if re.search(r"price|cost|amount|rate", k, re.I)
    ]
    assert not money_keys, "no money keys"


def test_it_fits_what_the_database_requires_of_a_config() -> None:
    assert isinstance(CFG, dict)
    assert 1 <= len(CFG["factors"]) <= 20
    compact = json.dumps(CFG, ensure_ascii=False, separators=(",", ":"))
    assert len(compact.encode()) <= 32768
    assert text_is_clean(RAW), (
        "no hidden or control characters anywhere (ZWJ / ZWNJ would be legal)"
    )
    assert CFG["template"]["engine"] == "icp-rules" and CFG["template"]["schema_version"] == 1


def test_every_factor_names_a_rule_type_the_engine_can_be_given() -> None:
    types = {f["rule"]["type"] for f in CFG["factors"]}
    assert types == {
        "keyword_fit",
        "attribute_fraction",
        "place_tier",
        "attribute_max",
        "contact_quality",
        "evidence_count",
    }
    vocab_names = set(CFG["vocabularies"])
    for f in CFG["factors"]:
        for key in ("strong_vocabulary", "weak_vocabulary", "decision_maker_vocabulary"):
            if key in f["rule"]:
                assert f["rule"][key] in vocab_names
        for attribute in [f["rule"].get("attribute"), *f["rule"].get("attributes", [])]:
            if attribute:
                assert attribute in CFG["attributes"]
    contact = next(f["rule"] for f in CFG["factors"] if f["id"] == "reachability")
    assert (
        contact["email_points"] + contact["phone_points"] + contact["decision_maker_points"] == 10
    )
    evidence = next(f["rule"] for f in CFG["factors"] if f["id"] == "evidence_quality")
    assert (
        evidence["any_points"]
        + evidence["two_or_more_points"]
        + evidence["two_or_more_kinds_points"]
        == 10
    )


@pytest.mark.parametrize("term", ["సిల్క్ చీర", "ಸಿಲ್ಕ್ ಸೀರೆ", "रेशमी साड़ी"])
def test_the_template_alphabets_are_legal_text(term: str) -> None:
    assert text_is_clean(term)
