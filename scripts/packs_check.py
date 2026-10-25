"""Check the business-type packs (job CK, ADR 0084 part 1, blueprint section 13). Stdlib plus `jsonschema` (already a dev dependency of the API).

  python3 scripts/packs_check.py            checks packages/packs/*/pack.json and prints one line per problem; exit 1 when there is one
  make packs-check                          the same, through the API virtualenv

What it proves (also run as a unit test, services/ai-api/tests/test_ck_packs_data.py, so CI runs it on every pull request):
  * every pack.json is valid against packages/packs/pack.schema.json, sits in a folder named after its id, and uses only modules from modules.json and label keys from labels.json
  * English carries every label key; the other languages carry only known keys
  * exactly one pack is the default for existing workspaces and it is published and has every module that already exists in the product ("textiles must not change")
  * a pack with a catalogue offers units, one without offers none; the core tab is one of the pack's modules
  * custom fields: at most 20 per entity, unique codes, choices unique, catalogue-item fields only where the pack has a catalogue
  * example data: the keys resolve, a sample contact has no phone or e-mail, and nothing needs a module the pack does not have
  * a landing.json next to a pack.json (the public page of the business type, job CM) is valid against landing.schema.json and its own rules (slug, blocks, four languages, no price)
  * NO PACK ID IN CODE: no string literal equal to a pack id in the API's application code or in the web's non-test code (modules are the only extension point)
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PACKS = ROOT / "packages" / "packs"
MAX_FIELDS_PER_ENTITY = 20
LANGS = ("en", "te", "hi", "kn")


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_packs(packs_dir: Path = PACKS) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for child in sorted(packs_dir.iterdir()):
        manifest = child / "pack.json"
        if child.is_dir() and manifest.is_file():
            out[child.name] = load_json(manifest)
    return out


def module_codes(packs_dir: Path = PACKS) -> dict[str, bool]:
    """code -> exists_today"""
    return {m["code"]: bool(m["exists_today"]) for m in load_json(packs_dir / "modules.json")["modules"]}


def label_keys(packs_dir: Path = PACKS) -> list[str]:
    return [entry["key"] for entry in load_json(packs_dir / "labels.json")["labels"]]


def _schema_errors(pack: dict[str, Any], schema: dict[str, Any], name: str) -> list[str]:
    import jsonschema  # a dev dependency; the runtime never imports this module

    validator = jsonschema.Draft202012Validator(schema)
    return [f"{name}: schema: {'/'.join(str(p) for p in e.absolute_path) or '(root)'}: {e.message[:160]}" for e in sorted(validator.iter_errors(pack), key=lambda e: list(e.absolute_path))]


# Job DG: a pack that is not the textile one must not talk like it (DF found "saree type" on the construction enquiry page). Every STRING VALUE of such a pack (words, names, summaries, custom fields and their choices, the example data)
# is searched for these words; keys are not (a key may keep an old name, e.g. `nav.item.sarees`, whose value is "Products").
TEXTILE_WORDS = re.compile(r"saree|\bsari\b|textile|dupatta|blouse|kanjivaram|kanchipuram|dharmavaram|\bpattu\b|\bsilk\b|weaving|handloom", re.IGNORECASE)


def string_values(node: Any, path: str = "") -> list[tuple[str, str]]:
    if isinstance(node, dict):
        return [hit for key, value in node.items() for hit in string_values(value, f"{path}/{key}")]
    if isinstance(node, list):
        return [hit for i, value in enumerate(node) for hit in string_values(value, f"{path}[{i}]")]
    return [(path, node)] if isinstance(node, str) else []


def textile_words_in(pack: dict[str, Any]) -> list[str]:
    return [f"{path}: {text[:60]!r}" for path, text in string_values(pack) if TEXTILE_WORDS.search(text)]


def check_pack(name: str, pack: dict[str, Any], modules: dict[str, bool], keys: list[str]) -> list[str]:
    errs: list[str] = []
    if pack.get("id") != name:
        errs.append(f"{name}: the folder name must equal the id ({pack.get('id')!r})")
    mods = pack.get("modules", [])
    for m in mods:
        if m not in modules:
            errs.append(f"{name}: module {m!r} is not in modules.json")
    if pack.get("core_tab") not in mods:
        errs.append(f"{name}: core_tab {pack.get('core_tab')!r} must be one of the pack's modules")
    if name != "textiles":
        for hit in textile_words_in(pack):
            errs.append(f"{name}: textile wording in a pack that is not the textile one: {hit}")
    labels = pack.get("labels", {})
    missing = [k for k in keys if k not in labels.get("en", {})]
    if missing:
        errs.append(f"{name}: English is missing label keys {missing}")
    for lang, words in labels.items():
        unknown = sorted(set(words) - set(keys))
        if unknown:
            errs.append(f"{name}: labels.{lang} has keys outside labels.json: {unknown}")
    has_catalogue = "catalogue" in mods
    units = pack.get("units", [])
    if has_catalogue and not units:
        errs.append(f"{name}: a pack with the catalogue module must offer units")
    if not has_catalogue and units:
        errs.append(f"{name}: a pack without the catalogue module must not offer units")
    default_unit = pack.get("default_unit")
    if has_catalogue and default_unit not in units:
        errs.append(f"{name}: default_unit must be one of units")
    if not has_catalogue and default_unit is not None:
        errs.append(f"{name}: default_unit must be null without a catalogue")
    seen: set[tuple[str, str]] = set()
    per_entity: dict[str, int] = {}
    for f in pack.get("custom_fields", []):
        key = (f["entity"], f["code"])
        if key in seen:
            errs.append(f"{name}: custom field {key} appears twice")
        seen.add(key)
        per_entity[f["entity"]] = per_entity.get(f["entity"], 0) + 1
        if f["entity"] == "catalogue_item" and not has_catalogue:
            errs.append(f"{name}: custom field {key} is on catalogue items but the pack has no catalogue module")
        if f["entity"] == "contact" and "contacts" not in mods:
            errs.append(f"{name}: custom field {key} is on contacts but the pack has no contacts module")
        codes = [c["code"] for c in f.get("choices", [])]
        if len(codes) != len(set(codes)):
            errs.append(f"{name}: custom field {key} repeats a choice code")
        if f["mergeable"] and f["kind"] in ("yes_no", "multi_choice"):
            errs.append(f"{name}: custom field {key}: only choice, number, date and short text fields can be merge fields")
    for entity, n in per_entity.items():
        if n > MAX_FIELDS_PER_ENTITY:
            errs.append(f"{name}: {n} custom fields on {entity} (the limit is {MAX_FIELDS_PER_ENTITY})")
    ex = pack.get("example_data", {})
    need = {"companies": "companies", "contacts": "contacts", "leads": "enquiries", "products": "catalogue"}
    for kind, module in need.items():
        if ex.get(kind) and module not in mods:
            errs.append(f"{name}: example data has {kind} but the pack has no {module} module")
    company_keys = {c["key"] for c in ex.get("companies", [])}
    contact_keys = {c["key"] for c in ex.get("contacts", [])}
    for c in ex.get("contacts", []):
        if c["company"] is not None and c["company"] not in company_keys:
            errs.append(f"{name}: example contact {c['key']} names an unknown company")
        if "email" in c or "phone" in c:
            errs.append(f"{name}: an example contact must not carry an e-mail address or a phone number")
    for lead in ex.get("leads", []):
        if lead["company"] is not None and lead["company"] not in company_keys:
            errs.append(f"{name}: an example lead names an unknown company")
        if lead["contact"] is not None and lead["contact"] not in contact_keys:
            errs.append(f"{name}: an example lead names an unknown contact")
        if lead["company"] is None and lead["contact"] is None:
            errs.append(f"{name}: an example lead needs a company or a contact")
    for p in ex.get("products", []):
        if p["unit"] not in units:
            errs.append(f"{name}: example product {p['sku']} uses a unit the pack does not offer")
    return errs


# The first path segments the web app already owns (job CM): a business type's public address must not take one of them.
RESERVED_SLUGS = frozenset({"app", "api", "auth", "login", "signup", "setup", "landing", "privacy", "terms", "pricing", "how-it-works", "security", "contact", "help", "te", "hi", "kn", "en", "og", "owl", "icons", "offline", "sitemap", "robots", "manifest", "favicon", "_next"})
LANDING_LANGS = ("en", "te", "hi", "kn")


def _landing_texts(node: Any) -> list[dict[str, Any]]:
    """Every {en, te, hi, kn} text object inside a landing file."""
    if isinstance(node, dict):
        if "en" in node and isinstance(node["en"], str):
            return [node]
        return [t for v in node.values() for t in _landing_texts(v)]
    if isinstance(node, list):
        return [t for v in node for t in _landing_texts(v)]
    return []


def check_landing(packs: dict[str, dict[str, Any]], packs_dir: Path = PACKS) -> list[str]:
    """The public page of a business type (job CM): packages/packs/<id>/landing.json against landing.schema.json, plus the rules a schema cannot say. A pack without a landing.json has no public page (not an error)."""
    schema_file = packs_dir / "landing.schema.json"
    if not schema_file.is_file():
        return []
    import jsonschema  # a dev dependency; the runtime never imports this module

    schema = load_json(schema_file)
    errs: list[str] = []
    slugs: dict[str, str] = {}
    for name in packs:
        file = packs_dir / name / "landing.json"
        if not file.is_file():
            continue
        landing = load_json(file)
        validator = jsonschema.Draft202012Validator(schema)
        found = [f"{name}/landing.json: schema: {'/'.join(str(p) for p in e.absolute_path) or '(root)'}: {e.message[:160]}" for e in sorted(validator.iter_errors(landing), key=lambda e: list(e.absolute_path))]
        errs.extend(found)
        if found:
            continue
        if landing["pack"] != name:
            errs.append(f"{name}/landing.json: `pack` must equal the folder name ({landing['pack']!r})")
        slug = landing["slug"]
        if slug in RESERVED_SLUGS:
            errs.append(f"{name}/landing.json: the address /{slug} belongs to another page of the site")
        if slug in slugs:
            errs.append(f"{name}/landing.json: the address /{slug} is also used by {slugs[slug]}")
        slugs[slug] = name
        if "calculator" in landing and "quotes" not in packs[name].get("modules", []):
            errs.append(f"{name}/landing.json: the calculator block needs the pack to have the quotes module")
        if "fee_preview" in landing and "fees" not in packs[name].get("modules", []):
            errs.append(f"{name}/landing.json: the fee_preview block needs the pack to have the fees module")
        texts = _landing_texts({k: v for k, v in landing.items() if k not in ("$schema", "pack", "slug")})
        for t in texts:
            for lang in LANDING_LANGS:
                if lang not in t:
                    errs.append(f"{name}/landing.json: a text has no {lang}: {t['en'][:50]!r}")
            for placeholder in re.findall(r"\{(\w+)\}", t["en"]):
                if placeholder not in ("brand", "assistant"):
                    errs.append(f"{name}/landing.json: only {{brand}} and {{assistant}} may be a placeholder ({placeholder!r} in {t['en'][:40]!r})")
            if re.search(r"\d\s?%|₹\s?\d", t["en"]):
                errs.append(f"{name}/landing.json: a text states a price or a percentage ({t['en'][:50]!r})")
    return errs


def check_all(packs_dir: Path = PACKS) -> list[str]:
    errs: list[str] = []
    schema = load_json(packs_dir / "pack.schema.json")
    modules = module_codes(packs_dir)
    keys = label_keys(packs_dir)
    packs = load_packs(packs_dir)
    if not packs:
        return ["no packs found"]
    ids = [(p["id"], p["version"]) for p in packs.values() if "id" in p and "version" in p]
    if len(ids) != len(set(ids)):
        errs.append("a pack id and version appear twice")
    for name, pack in packs.items():
        schema_errs = _schema_errors(pack, schema, name)
        errs.extend(schema_errs)
        if not schema_errs:
            errs.extend(check_pack(name, pack, modules, keys))
    errs.extend(check_landing(packs, packs_dir))
    defaults = [n for n, p in packs.items() if p.get("default_for_existing_workspaces")]
    if len(defaults) != 1:
        errs.append(f"exactly one pack must be the default for existing workspaces, found {defaults}")
    else:
        default = packs[defaults[0]]
        absent = sorted(m for m, today in modules.items() if today and m not in default.get("modules", []))
        if absent:
            errs.append(f"{defaults[0]}: the default pack must keep every module that exists today on; missing {absent}")
        if default.get("custom_fields"):
            errs.append(f"{defaults[0]}: the default pack must add no custom fields (it is today's behaviour)")
    return errs


# ---------------------------------------------------------------------------------------------------------------------------------------- no pack id in code
API_APP = ROOT / "services" / "ai-api" / "app"
WEB = ROOT / "apps" / "web"
WEB_SKIP_PARTS = {"node_modules", ".next", "test", "__text__", "e2e"}


def _code_files() -> list[Path]:
    files = [p for p in API_APP.rglob("*.py") if "__pycache__" not in p.parts]
    # the web: walk it pruning the folders that hold no source of ours (node_modules alone has tens of thousands of files)
    for root, dirs, names in os.walk(WEB):
        dirs[:] = [d for d in dirs if d not in WEB_SKIP_PARTS and not d.startswith(".")]
        for name in names:
            if name.endswith((".ts", ".tsx")) and ".test." not in name and not name.endswith(".d.ts"):
                files.append(Path(root) / name)
    return files


def pack_ids(packs_dir: Path = PACKS) -> list[str]:
    return sorted(load_packs(packs_dir))


# Files that still hold a pack id and belong to another lane. Each line: a repository path, then why. Remove the line when the file is fixed (the web job CL rewrites the sign-up).
ALLOWLIST = ROOT / "scripts" / "pack_id_allowlist.txt"


def _allowed() -> set[str]:
    if not ALLOWLIST.is_file():
        return set()
    return {line.split(maxsplit=1)[0] for line in ALLOWLIST.read_text(encoding="utf-8").splitlines() if line.strip() and not line.startswith("#")}


def pack_ids_in_code(packs_dir: Path = PACKS) -> list[str]:
    ids = pack_ids(packs_dir)
    if not ids:
        return []
    alternatives = "|".join(re.escape(i) for i in ids)
    literal = re.compile(rf"""(["'`])({alternatives})\1""")
    hits: list[str] = []
    allowed = _allowed()
    for path in _code_files():
        if str(path.relative_to(ROOT)) in allowed:
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
            if "pack-id-ok" in line:
                continue
            if literal.search(line):
                hits.append(f"{path.relative_to(ROOT)}:{n}: a string literal equal to a pack id (code reads module flags, never a pack id): {line.strip()[:120]}")
    return hits


def main() -> int:
    problems = check_all() + pack_ids_in_code()
    for p in problems:
        print(p)
    if problems:
        print(f"{len(problems)} problem(s) in the packs")
        return 1
    print(f"packs ok: {', '.join(pack_ids())}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
