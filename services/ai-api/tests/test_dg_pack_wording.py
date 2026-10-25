"""Job DG: a pack that is not the textile one must not talk like it.

DF found "saree type" on the construction enquiry page. The screens now use the building-materials
sentences (module `materials`), and the pack checker (scripts/packs_check.py, also
`make packs-check` and CI) refuses textile words in the text of every other pack.
"""

from __future__ import annotations

import copy
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
import packs_check  # noqa: E402

PACKS = ROOT / "packages" / "packs"


def load(name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((PACKS / name / "pack.json").read_text(encoding="utf-8"))
    return data


def test_construction_and_education_packs_have_no_textile_word_in_their_text() -> None:
    for name in ("construction_materials", "education"):
        assert packs_check.textile_words_in(load(name)) == [], name


def test_the_textile_pack_is_the_one_that_may_use_them() -> None:
    # the detector sees the textile words (so the test above can fail)
    assert packs_check.textile_words_in(load("textiles"))


def test_the_checker_refuses_a_saree_in_a_construction_pack() -> None:
    pack = copy.deepcopy(load("construction_materials"))
    pack["summary"]["en"] = "Paver blocks, kerbs and sarees"
    modules_file = json.loads((PACKS / "modules.json").read_text(encoding="utf-8"))
    modules = {m["code"]: True for m in modules_file["modules"]}
    labels_file = json.loads((PACKS / "labels.json").read_text(encoding="utf-8"))
    keys = [e["key"] for e in labels_file["labels"]]
    errors = packs_check.check_pack("construction_materials", pack, modules, keys)
    assert any("textile wording" in e and "sarees" in e for e in errors), errors


def test_a_key_may_keep_an_old_name_when_its_words_are_clean() -> None:
    # `nav.item.sarees` is a closed key whose construction value is "Products": values are searched
    assert "nav.item.sarees" in load("construction_materials")["labels"]["en"]
    clean = {"labels": {"en": {"nav.item.sarees": "Products"}}}
    assert packs_check.textile_words_in(clean) == []
