"""Job CK: the pack DATA is checked on every pull request (packages/packs, ADR 0084 part 1, blueprint section 13).

  * the three packs are valid against the JSON Schema and the semantic rules (modules, labels, units, custom fields, example data)
  * the default pack is TODAY's behaviour: every module that exists today, no extra fields, and its words ARE the web app's own dictionary words (the equivalence proof for labels)
  * the migration that syncs the packs is in step with the files (a synced version is never edited)
  * NO PACK ID IN CODE: no string literal equal to a pack id in the API or in non-test web code
  * the checker really catches a broken pack (negative tests on copies)
  * the closed unit list is the same in the API, the schema, the pack files and the database migration
"""

from __future__ import annotations

import importlib.util
import json
import re
import shutil
import sys
from pathlib import Path
from types import ModuleType

import pytest

from app.units import SALE_UNITS

ROOT = Path(__file__).resolve().parents[3]
SCRIPTS = ROOT / "scripts"


def _load(name: str) -> ModuleType:
    sys.path.insert(0, str(SCRIPTS))
    try:
        spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
        assert spec is not None and spec.loader is not None
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.remove(str(SCRIPTS))


pc = _load("packs_check")
pm = _load("pack_migration")
np = _load("new_pack")


def test_every_pack_is_valid() -> None:
    assert pc.check_all() == []


def test_there_are_exactly_the_three_business_types_of_the_blueprint() -> None:
    assert sorted(pc.load_packs()) == ["construction_materials", "education", "textiles"]


def test_exactly_one_pack_is_the_default_and_it_is_the_published_textile_pack() -> None:
    packs = pc.load_packs()
    defaults = [name for name, p in packs.items() if p.get("default_for_existing_workspaces")]
    assert defaults == ["textiles"]
    assert packs["textiles"]["status"] == "published" and packs["textiles"]["reviewed_by"]
    # the two new business types are not validated by a real owner yet: previews with no reviewer
    for name in ("construction_materials", "education"):
        assert packs[name]["status"] == "preview" and packs[name]["reviewed_by"] is None


def test_the_default_pack_keeps_every_module_that_exists_today_and_adds_nothing() -> None:
    modules = pc.module_codes()
    default = pc.load_packs()["textiles"]
    assert sorted(default["modules"]) == sorted(m for m, today in modules.items() if today)
    assert default["custom_fields"] == []
    assert default["units"] == ["piece", "set"]


def test_the_module_matrix_of_the_blueprint_section_4() -> None:
    packs = pc.load_packs()
    on = {name: set(p["modules"]) for name, p in packs.items()}
    t, c, e = on["textiles"], on["construction_materials"], on["education"]
    everyone = {"today", "inbox", "contacts", "enquiries", "followups", "visits", "call_list", "reports", "office", "integrations"}
    assert everyone <= t and everyone <= c and everyone <= e
    # companies, catalogue, quotes, orders: textiles and construction; research and the lead finder too; never education
    for m in ("companies", "catalogue", "quotes", "orders", "research", "lead_finder"):
        assert m in t and m in c and m not in e, m
    assert {"deliveries", "sites"} <= c and not {"deliveries", "sites"} & (t | e)
    assert {"programmes", "fees"} <= e and not {"programmes", "fees"} & (t | c)
    assert "dues" in c and "dues" in e and "dues" not in t
    assert "campaigns" in c and "campaigns" in e and "campaigns" not in t
    assert "voice_notes" in e and "voice_notes" not in (t | c)
    assert not {"ai_calls"} & (t | c | e)
    # UPI payment links: "later" for everyone in the blueprint, but the connector (ADR 0080) exists today, so the default pack keeps it (equivalence wins) and the others stay off
    assert "payment_links" in t and "payment_links" not in (c | e)


def test_the_default_packs_words_are_the_web_apps_own_dictionary() -> None:
    """The equivalence proof for labels: every nav.* and agent.* key of the textile pack equals what the web app shows today, in all four languages."""
    web = json.loads((ROOT / "apps" / "web" / "i18n" / "strings" / "app.json").read_text(encoding="utf-8"))
    labels = pc.load_packs()["textiles"]["labels"]
    checked = 0
    for lang in ("en", "te", "hi", "kn"):
        for key, word in labels[lang].items():
            if key.startswith(("nav.", "agent.")):
                assert web[key][lang] == word, f"{key} [{lang}] differs from the web dictionary"
                checked += 1
    assert checked >= 22 * 4


def test_every_pack_gives_every_label_key_in_english() -> None:
    keys = set(pc.label_keys())
    assert len(keys) == 40
    for name, pack in pc.load_packs().items():
        assert set(pack["labels"]["en"]) == keys, name


def test_the_new_packs_mark_their_other_languages_as_waiting_for_a_native_reader() -> None:
    packs = pc.load_packs()
    for name in ("construction_materials", "education"):
        assert set(packs[name]["language_review"].values()) == {"draft"}, name
    assert set(packs["textiles"]["language_review"].values()) == {"web_dictionary"}


def test_the_construction_pack_has_the_blueprint_product_fields() -> None:
    fields = {(f["entity"], f["code"]) for f in pc.load_packs()["construction_materials"]["custom_fields"]}
    for code in ("product_type", "size", "thickness_mm", "grade", "pieces_per_area", "pieces_per_pallet", "hsn_code", "gst_rate_percent"):
        assert ("catalogue_item", code) in fields, code
    assert pc.load_packs()["construction_materials"]["units"] == ["sq_ft", "sq_m", "piece", "box", "bag", "tonne", "cft", "truckload"]


def test_no_pack_field_can_hold_a_childs_data_or_a_government_id() -> None:
    forbidden = re.compile(r"(dob|birth|aadhaar|aadhar|photo|religion|caste|income|marks|grade_obtained|attendance|health|address)", re.I)
    for name, pack in pc.load_packs().items():
        for f in pack["custom_fields"]:
            assert not forbidden.search(f["code"] + " " + f["label"]["en"]), (name, f["code"])
            assert f["pii_class"] == "none", (name, f["code"])
        for contact in pack["example_data"].get("contacts", []):
            assert set(contact) == {"key", "company", "full_name"}, "a sample contact has no phone and no e-mail"


def test_the_database_migration_is_in_step_with_the_pack_files() -> None:
    mods, packs, problems = pm.pending()
    assert problems == [] and mods == [] and packs == [], "run `make pack-migration` (a synced pack version is never edited: raise its version)"


def test_the_synced_hash_is_the_hash_of_the_file() -> None:
    _, synced = pm.synced()
    for name, pack in pc.load_packs().items():
        sha, is_default = synced[(pack["id"], pack["version"])]
        assert sha == pm.manifest_sha256(pm.manifest_of(pack)), name
        assert is_default == bool(pack.get("default_for_existing_workspaces")), name


def test_editing_a_synced_pack_is_refused_and_a_new_version_is_a_new_migration(tmp_path: Path) -> None:
    fake = tmp_path / "packs"
    shutil.copytree(pc.PACKS, fake)
    edited = json.loads((fake / "education" / "pack.json").read_text(encoding="utf-8"))
    edited["summary"]["en"] = "Edited after it was synced"
    (fake / "education" / "pack.json").write_text(json.dumps(edited), encoding="utf-8")
    _, _, problems = pm.pending(fake, pm.MIGRATIONS)
    assert len(problems) == 1 and "never edited" in problems[0]
    edited["version"] = 2
    (fake / "education" / "pack.json").write_text(json.dumps(edited), encoding="utf-8")
    _, todo, problems = pm.pending(fake, pm.MIGRATIONS)
    assert problems == [] and [(p["id"], p["version"]) for p in todo] == [("education", 2)]
    rendered = pm.render([], todo)
    assert "-- pack-sync: education 2 " in rendered and "$pack_json$" in rendered and "update packs.pack_versions set is_default" not in rendered


def test_the_closed_unit_list_is_the_same_everywhere() -> None:
    schema = json.loads((pc.PACKS / "pack.schema.json").read_text(encoding="utf-8"))
    assert set(schema["$defs"]["example_data"]["properties"]["products"]["items"]["properties"]["unit"]["enum"]) == set(SALE_UNITS)
    assert set(schema["properties"]["units"]["items"]["enum"]) == set(SALE_UNITS)
    migration = (ROOT / "supabase" / "migrations" / "20261122090000_ck_packs_structure.sql").read_text(encoding="utf-8")
    block = migration.split("insert into packs.units (code, position, label) values", 1)[1].split(";", 1)[0]
    assert re.findall(r"\('([a-z_]+)', \d+, ", block) == list(SALE_UNITS)
    for pack in pc.load_packs().values():
        assert set(pack["units"]) <= set(SALE_UNITS)


def test_the_closed_module_list_in_the_files_is_the_one_in_the_database() -> None:
    synced, _ = pm.synced()
    assert synced == set(pc.module_codes())


# ------------------------------------------------------------------------------------------------------ no pack id in code
def test_no_string_literal_equal_to_a_pack_id_in_the_api_or_the_web() -> None:
    assert pc.pack_ids_in_code() == []


def test_the_pack_id_lint_really_sees_a_literal(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    fake_app = tmp_path / "services" / "ai-api" / "app"
    fake_app.mkdir(parents=True)
    (fake_app / "bad.py").write_text('def f(t):\n    return t == "education"\n', encoding="utf-8")
    (fake_app / "fine.py").write_text('name = "Closed Textiles"  # a business name, not a pack id\nurl = "/education"\n', encoding="utf-8")
    monkeypatch.setattr(pc, "ROOT", tmp_path)
    monkeypatch.setattr(pc, "API_APP", fake_app)
    monkeypatch.setattr(pc, "WEB", tmp_path / "apps" / "web")
    monkeypatch.setattr(pc, "ALLOWLIST", tmp_path / "none.txt")
    hits = pc.pack_ids_in_code()
    assert len(hits) == 1 and "bad.py:2" in hits[0]


def test_the_allow_list_holds_only_files_that_still_need_it() -> None:
    for line in pc.ALLOWLIST.read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.startswith("#"):
            path = ROOT / line.split(maxsplit=1)[0]
            assert path.is_file(), f"{path} is gone: remove its line from the allow-list"
            assert re.search(r"""["'](textiles|construction_materials|education)["']""", path.read_text(encoding="utf-8")), f"{path} no longer names a pack id: remove its line"


# ------------------------------------------------------------------------------------------------------ negative tests on copies
def _broken(tmp_path: Path, mutate) -> list[str]:  # type: ignore[no-untyped-def]
    fake = tmp_path / "packs"
    shutil.copytree(pc.PACKS, fake)
    target = fake / "construction_materials" / "pack.json"
    pack = json.loads(target.read_text(encoding="utf-8"))
    mutate(pack)
    target.write_text(json.dumps(pack), encoding="utf-8")
    errors: list[str] = pc.check_all(fake)
    return errors


def test_the_checker_catches_an_unknown_module(tmp_path: Path) -> None:
    assert any("not in modules.json" in e for e in _broken(tmp_path, lambda p: p["modules"].append("teleport")))


def test_the_checker_catches_a_missing_english_label(tmp_path: Path) -> None:
    assert any("English is missing" in e for e in _broken(tmp_path, lambda p: p["labels"]["en"].pop("word.visit")))


def test_the_checker_catches_a_label_key_outside_the_closed_list(tmp_path: Path) -> None:
    assert any("outside labels.json" in e for e in _broken(tmp_path, lambda p: p["labels"]["te"].update({"word.dragon": "x"})))


def test_the_checker_catches_a_core_tab_the_pack_does_not_have(tmp_path: Path) -> None:
    assert any("core_tab" in e for e in _broken(tmp_path, lambda p: p.update(core_tab="fees")))


def test_the_checker_catches_too_many_fields_for_one_entity(tmp_path: Path) -> None:
    def many(p: dict) -> None:  # type: ignore[type-arg]
        p["custom_fields"] = [
            {"entity": "contact", "code": f"f{i:02d}", "kind": "text", "label": {"en": "F"}, "required": False, "pii_class": "none", "mergeable": False} for i in range(21)
        ]

    assert any("custom fields on contact" in e for e in _broken(tmp_path, many))


def test_the_checker_catches_a_sample_contact_with_a_phone_number(tmp_path: Path) -> None:
    def phone(p: dict) -> None:  # type: ignore[type-arg]
        p["example_data"]["contacts"][0]["phone"] = "+91 90000 00001"

    assert _broken(tmp_path, phone) != []


def test_the_checker_catches_a_sample_that_needs_a_module_the_pack_lacks(tmp_path: Path) -> None:
    assert any("no companies module" in e for e in _broken(tmp_path, lambda p: p["modules"].remove("companies")))


def test_the_checker_catches_a_published_pack_with_no_reviewer(tmp_path: Path) -> None:
    assert _broken(tmp_path, lambda p: p.update(status="published", reviewed_by=None)) != []


def test_the_checker_catches_a_second_default_pack(tmp_path: Path) -> None:
    assert _broken(tmp_path, lambda p: p.update(default_for_existing_workspaces=True)) != []


def test_the_checker_catches_a_default_pack_that_lost_a_module_that_exists_today(tmp_path: Path) -> None:
    fake = tmp_path / "packs"
    shutil.copytree(pc.PACKS, fake)
    target = fake / "textiles" / "pack.json"
    pack = json.loads(target.read_text(encoding="utf-8"))
    pack["modules"].remove("quotes")
    target.write_text(json.dumps(pack), encoding="utf-8")
    assert any("must keep every module that exists today" in e for e in pc.check_all(fake))


def test_the_checker_catches_an_unknown_property(tmp_path: Path) -> None:
    assert any("schema" in e for e in _broken(tmp_path, lambda p: p.update(per_tenant_code="if x: do()")))


def test_the_folder_must_be_named_after_the_id(tmp_path: Path) -> None:
    fake = tmp_path / "packs"
    shutil.copytree(pc.PACKS, fake)
    shutil.copytree(fake / "education", fake / "school")
    assert any("folder name must equal the id" in e for e in pc.check_all(fake))


# ------------------------------------------------------------------------------------------------------ `make new-pack ID=<id>`
def test_a_new_pack_starts_as_a_valid_draft_with_the_smallest_set_of_modules(tmp_path: Path) -> None:
    fake = tmp_path / "packs"
    shutil.copytree(pc.PACKS, fake)
    path = np.create_pack("clinics", fake)
    assert path == fake / "clinics" / "pack.json"
    pack = json.loads(path.read_text(encoding="utf-8"))
    assert pack["status"] == "draft" and pack["version"] == 1 and pack["default_for_existing_workspaces"] is False and pack["reviewed_by"] is None
    assert pack["modules"] == np.BASE_MODULES and pack["units"] == [] and pack["custom_fields"] == [] and pack["example_data"] == {}
    assert set(pack["labels"]["en"]) == set(pc.label_keys())
    assert pc.check_all(fake) == [], "a freshly made pack already passes the checks"
    _, todo, problems = pm.pending(fake, pm.MIGRATIONS)
    assert problems == [] and [(p["id"], p["version"]) for p in todo] == [("clinics", 1)]


def test_the_smallest_set_of_modules_is_what_every_real_pack_has() -> None:
    for name, pack in pc.load_packs().items():
        assert set(np.BASE_MODULES) <= set(pack["modules"]), name


def test_new_pack_refuses_a_bad_or_a_taken_id(tmp_path: Path) -> None:
    fake = tmp_path / "packs"
    shutil.copytree(pc.PACKS, fake)
    for bad in ("Clinics", "1clinics", "a", "has space", "x" * 40, "../escape"):
        with pytest.raises(SystemExit):
            np.create_pack(bad, fake)
    with pytest.raises(SystemExit):
        np.create_pack("education", fake)
    assert sorted(p.name for p in fake.iterdir() if p.is_dir()) == ["construction_materials", "education", "textiles"]


def test_a_draft_pack_is_never_offered_at_sign_up(tmp_path: Path) -> None:
    from app.packs.registry import PackRegistry

    fake = tmp_path / "packs"
    shutil.copytree(pc.PACKS, fake)
    np.create_pack("clinics", fake)
    assert "clinics" not in [p.pack_id for p in PackRegistry(fake).selectable().packs]


def test_the_makefile_runs_the_pack_checks_in_check_fast() -> None:
    make = (ROOT / "Makefile").read_text(encoding="utf-8")
    assert re.search(r"^check-fast:.*\bpacks-check\b", make, re.M)
    for target in ("packs-check:", "pack-migration:", "new-pack:"):
        assert target in make
