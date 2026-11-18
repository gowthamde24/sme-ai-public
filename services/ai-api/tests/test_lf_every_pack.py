"""The Lead Finder is visible to every business (owner, 18 Nov 2026): EVERY pack carries its own Lead Finder data (who it looks for, the default search words, the invented demo prospects), and a school still finds
organisations only. A new pack without a lead_finder.json fails here."""

# ruff: noqa: E501

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.lead_finder import packdata

PACKS = Path(__file__).resolve().parents[3] / "packages" / "packs"
IDS = sorted(p.parent.name for p in PACKS.glob("*/pack.json"))
HINTS = {"retailer", "boutique", "contractor", "builder", "dealer", "other"}


def test_there_is_a_pack_to_test() -> None:
    assert len(IDS) >= 13 and "wholesale_b2b" in IDS and "textiles" in IDS


@pytest.mark.parametrize("pack_id", IDS)
def test_every_pack_has_lead_finder_data_that_reads_whole(pack_id: str) -> None:
    path = PACKS / pack_id / "lead_finder.json"
    assert path.is_file(), f"{pack_id} has no lead_finder.json: the Lead Finder would be hidden for it"
    data = packdata.for_pack(pack_id, PACKS)
    assert data is not None, f"{pack_id}: lead_finder.json does not parse"
    assert data.category_hint in HINTS and set(data.default_query) >= {"en", "te"} and all(data.default_query.values())
    assert len(data.buyer_types) >= 2 and all(t.words and t.label and t.weight > 0 for t in data.buyer_types)
    assert {"en", "te"} <= set(data.purpose) and set(data.questions) >= {"sells", "price", "quantity", "supplier", "timing", "decision"}
    kinds = [f.kind for f in data.fixture]
    assert kinds.count("buyer") >= 5, "the demo needs buyers"
    if pack_id not in ("textiles", "construction_materials", "education"):
        assert {"competitor", "no_phone", "very_large"} <= set(kinds), "the new files also carry the cases the filters drop"
    raw = json.loads(path.read_text(encoding="utf-8"))
    assert "Who it looks for" in raw["$comment"] or pack_id in ("textiles", "construction_materials", "education"), "a new file says who it looks for"
    for t in data.fixture:
        assert "+" not in t.name and "@" not in t.name, "a demo prospect has no contact details in its name"


def test_a_school_finds_organisations_only_and_the_other_new_packs_say_which() -> None:
    assert packdata.for_pack("education", PACKS).audience == "organisations"  # type: ignore[union-attr]
    organisations = {p for p in IDS if packdata.for_pack(p, PACKS).audience == "organisations"}  # type: ignore[union-attr]
    assert organisations == {"education", "clinic", "coaching", "gym", "interiors_solar", "travel"}
