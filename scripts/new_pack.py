"""Start a new business type (job CK, blueprint section 13): `make new-pack ID=clinics` writes packages/packs/<id>/pack.json as a DRAFT that already passes `make packs-check`.

A pack is DATA. This script writes no code, no migration and no web file. What you do next is in docs/runbooks/add-a-business-type.md:
  1. edit packages/packs/<id>/pack.json (modules, words, units, custom fields, example data) and run `make packs-check`
  2. `make pack-migration` writes the migration that puts the pack in the database (a synced version is never edited; a change is a new version)
  3. a real owner of that kind of business reviews it; only then does status become `preview` (selectable, labelled "not validated") and later `published`
The starting point is the SMALLEST set of modules (the ones every pack has) and the default pack's English words as placeholders to replace."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import packs_check as pc  # noqa: E402

BASE_MODULES = ["today", "inbox", "contacts", "enquiries", "followups", "call_list", "reports", "office", "integrations"]


def template(pack_id: str, default: dict[str, Any]) -> dict[str, Any]:
    title = pack_id.replace("_", " ").capitalize()
    return {
        "$schema": "../pack.schema.json",
        "id": pack_id,
        "version": 1,
        "status": "draft",
        "default_for_existing_workspaces": False,
        "reviewed_by": None,
        "names": {"en": title},
        "summary": {"en": f"Businesses of kind {title} (write one line for the sign-up card)"},
        "accent": default["accent"],
        "owl_prop": default["owl_prop"],
        "core_tab": "enquiries",
        "modules": list(BASE_MODULES),
        "units": [],
        "default_unit": None,
        # the default pack's English words are the placeholders, except the two that name the textile business's goods (job DG: packs_check refuses textile words in any other pack)
        "labels": {"en": {**default["labels"]["en"], "word.item": "Item", "word.items": "Items"}},
        "language_review": {"te": "draft", "hi": "draft", "kn": "draft"},
        "custom_fields": [],
        "example_data": {},
    }


def create_pack(pack_id: str, packs_dir: Path = pc.PACKS) -> Path:
    if not re.fullmatch(r"[a-z][a-z0-9_]{1,30}", pack_id):
        raise SystemExit("ID must be lower case letters, digits and underscores, 2 to 31 characters, starting with a letter (for example: clinics)")
    target = packs_dir / pack_id
    if target.exists():
        raise SystemExit(f"{target} exists already")
    packs = pc.load_packs(packs_dir)
    default = next((p for p in packs.values() if p.get("default_for_existing_workspaces")), None)
    if default is None:
        raise SystemExit("there is no default pack to copy the English words from")
    target.mkdir()
    path = target / "pack.json"
    path.write_text(json.dumps(template(pack_id, default), indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python3 scripts/new_pack.py <id>      (or: make new-pack ID=<id>)")
        return 2
    path = create_pack(argv[1])
    problems = pc.check_all()
    print(f"wrote {path.relative_to(pc.ROOT)}")
    for p in problems:
        print(f"  problem: {p}")
    print("next: edit it, `make packs-check`, `make pack-migration`; see docs/runbooks/add-a-business-type.md")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
