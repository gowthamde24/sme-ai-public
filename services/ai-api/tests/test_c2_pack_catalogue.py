"""The business-type catalogue (owner, 29 Nov 2026; reports/business-type-catalogue.md): 54 types, each in exactly one group, each with its starter questions (questions only, never answers), its search words, and no
words of another kind of business. Data only: nothing here reads a pack id from code."""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import jsonschema
import pytest

PACKS = Path(__file__).resolve().parents[3] / "packages" / "packs"
IDS = sorted(p.parent.name for p in PACKS.glob("*/pack.json"))


def load(name: str) -> Any:
    return json.loads((PACKS / name).read_text(encoding="utf-8"))


def test_the_catalogue_has_54_types() -> None:
    assert len(IDS) == 54


def test_every_type_is_in_exactly_one_group_and_every_group_is_used() -> None:
    cats = load("categories.json")
    jsonschema.validate(cats, load("categories.schema.json"))
    ids = {c["id"] for c in cats["categories"]}
    assert set(cats["packs"]) == set(IDS), "every pack has a group, no group names a pack that does not exist"
    assert set(cats["packs"].values()) <= ids and set(cats["packs"].values()) == ids
    for c in cats["categories"]:
        assert {"en", "te", "hi", "kn"} <= set(c["name"])


def test_every_type_has_search_words_that_name_it() -> None:
    cats = load("categories.json")
    assert set(cats["keywords"]) == set(IDS)


@pytest.mark.parametrize("pack_id", IDS)
def test_every_type_has_its_starter_questions_and_no_answers(pack_id: str) -> None:
    faq = load(f"{pack_id}/faq.json")
    jsonschema.validate(faq, load("faq.schema.json"))
    assert faq["pack"] == pack_id and 8 <= len(faq["questions"]) <= 12
    for q in faq["questions"]:
        assert q["ask"]["en"].rstrip().endswith("?"), f"{pack_id}: {q['code']} is a question"
    assert len({q["ask"]["en"] for q in faq["questions"]}) == len(faq["questions"])


# the items of one family of businesses never appear in another's pack data
FAMILIES = {
    "textile": (re.compile(r"\b(saree|sarees|blouse|kanchi|banarasi|zari|dupatta|dress material)\b", re.I), {"textiles", "fashion_tailor", "wholesale_b2b"}),
    "construction": (re.compile(r"\b(cement|tmt|bricks?|paver|river sand|aggregate)\b", re.I), {"construction_materials", "hardware_paint", "wholesale_b2b"}),
    "medical": (re.compile(r"\b(prescription|diagnosis|medicines?|dosage)\b", re.I), {"clinic", "dental", "physio_rehab", "vet_pet", "diagnostics_lab", "pharmacy"}),
}


def strings_of(value: Any) -> list[str]:
    """Every text VALUE of a json document (keys are names of things in the code, like a label key, not words a person reads)."""
    if isinstance(value, str):
        return [value]
    if isinstance(value, dict):
        return [t for v in value.values() for t in strings_of(v)]
    if isinstance(value, list):
        return [t for v in value for t in strings_of(v)]
    return []


@pytest.mark.parametrize("pack_id", IDS)
def test_no_pack_mentions_another_kind_of_businesss_items(pack_id: str) -> None:
    text = " ".join(t for p in (PACKS / pack_id).glob("*.json") if p.name != "lead_finder.json" for t in strings_of(json.loads(p.read_text(encoding="utf-8"))))
    for family, (pattern, owners) in FAMILIES.items():
        if pack_id in owners:
            continue
        found = sorted(set(m.group(0).lower() for m in pattern.finditer(text)))
        assert found == [], f"{pack_id} mentions {family} items: {found}"


@pytest.mark.parametrize("pack_id", IDS)
def test_every_pack_has_every_file(pack_id: str) -> None:
    deep = {"textiles", "construction_materials", "education"}  # the three deep packs have their own landing and no lead template
    for name in ("pack.json", "identity.json", "jobs.json", "lead_finder.json", "faq.json", *(() if pack_id in deep else ("leads.json",))):
        assert (PACKS / pack_id / name).is_file(), f"{pack_id}/{name}"
