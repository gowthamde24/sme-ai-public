"""Job CM: the public page of a business type.

The files are packages/packs/<id>/landing.json (schema landing.schema.json, checked by
scripts/packs_check.py check_landing). The three business types each have one; the checker
catches the faults a schema cannot say: a slug another page owns, a price in a text, a block the
pack has no module for, a missing language.
"""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from tests.test_ck_packs_data import ROOT, _load

pc = _load("packs_check")
PACKS = ROOT / "packages" / "packs"


def _copy(tmp_path: Path) -> Path:
    dest = tmp_path / "packs"
    shutil.copytree(PACKS, dest)
    return dest


def _edit(path: Path, change) -> None:  # type: ignore[no-untyped-def]
    data = json.loads(path.read_text(encoding="utf-8"))
    change(data)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def test_every_business_type_has_a_valid_public_page() -> None:
    packs = pc.load_packs()
    assert pc.check_landing(packs) == []
    # job DR: the leads packs have no public page yet
    slugs = sorted(
        json.loads((PACKS / n / "landing.json").read_text(encoding="utf-8"))["slug"]
        for n in packs
        if (PACKS / n / "landing.json").is_file()
    )
    assert slugs == ["construction", "education", "textiles"]


def test_the_blocks_are_only_where_the_pack_has_the_module(tmp_path: Path) -> None:
    dest = _copy(tmp_path)
    _edit(
        dest / "education" / "landing.json",
        lambda d: d.update(
            calculator=json.loads(
                (PACKS / "construction_materials" / "landing.json").read_text(encoding="utf-8")
            )["calculator"]
        ),
    )
    assert any(
        "calculator block needs the pack to have the quotes module" in e
        for e in pc.check_landing(pc.load_packs(dest), dest)
    )


def test_the_checker_catches_a_slug_another_page_owns(tmp_path: Path) -> None:
    dest = _copy(tmp_path)
    _edit(dest / "textiles" / "landing.json", lambda d: d.update(slug="pricing"))
    assert any("belongs to another page" in e for e in pc.check_landing(pc.load_packs(dest), dest))


def test_the_checker_catches_two_pages_at_one_address(tmp_path: Path) -> None:
    dest = _copy(tmp_path)
    _edit(dest / "textiles" / "landing.json", lambda d: d.update(slug="construction"))
    assert any("is also used by" in e for e in pc.check_landing(pc.load_packs(dest), dest))


def test_the_checker_catches_a_price_and_a_percentage_in_a_text(tmp_path: Path) -> None:
    dest = _copy(tmp_path)
    _edit(
        dest / "textiles" / "landing.json",
        lambda d: d["hero"]["sub"].update(en="From ₹499 a month, and 30% off."),
    )
    assert any(
        "states a price or a percentage" in e for e in pc.check_landing(pc.load_packs(dest), dest)
    )


def test_the_checker_catches_a_missing_language_and_a_foreign_placeholder(tmp_path: Path) -> None:
    dest = _copy(tmp_path)
    _edit(
        dest / "textiles" / "landing.json",
        lambda d: (d["hero"]["h1"].pop("kn"), d["hero"]["sub"].update(en="Hello {name}")),
    )
    errs = pc.check_landing(pc.load_packs(dest), dest)
    assert any("has no kn" in e for e in errs)
    assert any("only {brand} and {assistant} may be a placeholder" in e for e in errs)


def test_the_assistants_name_is_an_allowed_placeholder(tmp_path: Path) -> None:
    # job DN: the day steps say {assistant}, the name each workspace gave its assistant
    dest = _copy(tmp_path)
    _edit(
        dest / "textiles" / "landing.json",
        lambda d: d["hero"]["sub"].update(en="Ask {assistant}"),
    )
    errs = pc.check_landing(pc.load_packs(dest), dest)
    assert not any("placeholder" in e for e in errs)


def test_the_checker_catches_an_unknown_key_and_a_wrong_pack_name(tmp_path: Path) -> None:
    dest = _copy(tmp_path)
    _edit(dest / "textiles" / "landing.json", lambda d: d.update(colour="red"))
    assert any("colour" in e for e in pc.check_landing(pc.load_packs(dest), dest))
    dest2 = _copy(tmp_path / "again")
    _edit(dest2 / "textiles" / "landing.json", lambda d: d.update(pack="education"))
    assert any(
        "must equal the folder name" in e for e in pc.check_landing(pc.load_packs(dest2), dest2)
    )


@pytest.mark.parametrize("name", ["textiles", "construction_materials", "education"])
def test_a_pack_without_a_landing_file_simply_has_no_public_page(tmp_path: Path, name: str) -> None:
    dest = _copy(tmp_path)
    (dest / name / "landing.json").unlink()
    assert pc.check_landing(pc.load_packs(dest), dest) == []
