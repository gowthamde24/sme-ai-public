"""Check the plans catalogue (job DI). Plans are DATA, like packs: packages/plans/plans.json, shaped by packages/plans/plans.schema.json. Stdlib plus `jsonschema` (a dev dependency of the API).

  python3 scripts/plans_check.py            prints one line per problem; exit 1 when there is one
  make plans-check                          the same, through the API virtualenv (also run by `make check-fast`, and as a unit test, tests/test_di_plans_data.py)

What it proves:
  * plans.json is valid against plans.schema.json; ids and sort numbers are unique
  * exactly one plan is the trial plan and `trial.plan` names it; pay as you go (call_minutes AND whatsapp_messages null: billed by use) exists only on a calls-only plan and carries its per-minute and per-message price fields
  * the main plans grow: each allowance and limit is at least the one of the plan before it (Starter <= Growth <= Business)
  * NO PLAN ID IN CODE: no line of the API's application code or the web's non-test code that talks about a plan holds a string literal equal to a plan id (the code reads the catalogue, never a name)
  * the catalogue version is in a migration (scripts/plans_migration.py --check)
"""

from __future__ import annotations

import json
import os
import re
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
PLANS = ROOT / "packages" / "plans"
API_APP = ROOT / "services" / "ai-api" / "app"
WEB = ROOT / "apps" / "web"
WEB_SKIP_PARTS = {"node_modules", ".next", "test", "__text__", "e2e"}
ALLOWLIST = ROOT / "scripts" / "plan_id_allowlist.txt"


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_catalogue(plans_dir: Path = PLANS) -> dict[str, Any]:
    data: dict[str, Any] = load_json(plans_dir / "plans.json")
    return data


def check_catalogue(cat: dict[str, Any], schema: dict[str, Any]) -> list[str]:
    import jsonschema  # a dev dependency; the runtime never imports this module

    validator = jsonschema.Draft202012Validator(schema)
    errs = [
        f"plans.json: schema: {'/'.join(str(p) for p in e.absolute_path) or '(root)'}: {e.message[:160]}"
        for e in sorted(validator.iter_errors(cat), key=lambda e: list(e.absolute_path))
    ]
    if errs:
        return errs
    plans = cat["plans"]
    ids = [p["id"] for p in plans]
    if len(ids) != len(set(ids)):
        errs.append("a plan id appears twice")
    sorts = [p["sort"] for p in plans]
    if len(sorts) != len(set(sorts)):
        errs.append("two plans have the same sort number")
    trials = [p for p in plans if p["kind"] == "trial"]
    if len(trials) != 1:
        errs.append(f"exactly one plan must be of kind trial, found {[p['id'] for p in trials]}")
    elif cat["trial"]["plan"] != trials[0]["id"]:
        errs.append(f"trial.plan is {cat['trial']['plan']} but the trial plan is {trials[0]['id']}")
    for p in plans:
        pay_as_you_go = p["allowances"]["call_minutes"] is None
        if pay_as_you_go and p["kind"] != "calls":
            errs.append(f"{p['id']}: only a calls-only plan may be pay as you go (call_minutes null)")
        if pay_as_you_go and ("price_paise_per_minute" not in p or "price_paise_per_message" not in p):
            errs.append(f"{p['id']}: pay as you go needs its price_paise_per_minute and price_paise_per_message (null until the owner sets them)")
        if ("price_paise_per_minute" in p or "price_paise_per_message" in p) and not pay_as_you_go:
            errs.append(f"{p['id']}: per-minute and per-message prices belong to a pay-as-you-go plan only")
        if pay_as_you_go != (p["allowances"]["whatsapp_messages"] is None):
            errs.append(f"{p['id']}: pay as you go is both minutes AND messages billed by use (both null), or neither")
        if p["kind"] != "calls" and p["allowances"]["call_minutes"] is None:
            errs.append(f"{p['id']}: call_minutes null is for a calls-only plan")
    mains = sorted((p for p in plans if p["kind"] == "main"), key=lambda p: p["sort"])
    for before, after in zip(mains, mains[1:], strict=False):
        for key in ("call_minutes", "whatsapp_messages"):
            a, b = after["allowances"][key], before["allowances"][key]
            if a is not None and b is not None and a < b:   # a null allowance is pay as you go, on a calls-only plan, never compared here
                errs.append(f"{after['id']} gives fewer {key} than {before['id']}")
        for key in ("users", "workspaces"):
            if after["limits"][key] < before["limits"][key]:
                errs.append(f"{after['id']} allows fewer {key} than {before['id']}")
    return errs


def check_all(plans_dir: Path = PLANS) -> list[str]:
    return check_catalogue(load_catalogue(plans_dir), load_json(plans_dir / "plans.schema.json"))


# ---------------------------------------------------------------------------------------------------------------------------------------- no plan id in code
def _code_files() -> list[Path]:
    files = [p for p in API_APP.rglob("*.py") if "__pycache__" not in p.parts]
    for root, dirs, names in os.walk(WEB):
        dirs[:] = [d for d in dirs if d not in WEB_SKIP_PARTS and not d.startswith(".")]
        for name in names:
            if name.endswith((".ts", ".tsx")) and ".test." not in name and not name.endswith(".d.ts"):
                files.append(Path(root) / name)
    return files


def _allowed() -> set[str]:
    if not ALLOWLIST.is_file():
        return set()
    return {line.split(maxsplit=1)[0] for line in ALLOWLIST.read_text(encoding="utf-8").splitlines() if line.strip() and not line.startswith("#")}


def plan_ids_in_code(plans_dir: Path = PLANS, files: list[Path] | None = None, root: Path = ROOT) -> list[str]:
    """A line that mentions a plan AND holds a string literal equal to a plan id. (Words such as "business" are everywhere; the word "plan" on the same line is what makes a literal a plan id.)"""
    ids = [p["id"] for p in load_catalogue(plans_dir)["plans"]]
    alternatives = "|".join(re.escape(i) for i in ids)
    literal = re.compile(rf"""(["'`])({alternatives})\1""")
    talks_of_plan = re.compile(r"plan", re.I)
    hits: list[str] = []
    allowed = _allowed()
    for path in files if files is not None else _code_files():
        rel = str(path.relative_to(root))
        if rel in allowed:
            continue
        for n, line in enumerate(path.read_text(encoding="utf-8", errors="replace").splitlines(), start=1):
            if "plan-id-ok" in line:
                continue
            if talks_of_plan.search(line) and literal.search(line):
                hits.append(f"{rel}:{n}: a string literal equal to a plan id (code reads the plans catalogue, never a plan name): {line.strip()[:120]}")
    return hits


def main() -> int:
    problems = check_all() + plan_ids_in_code()
    for p in problems:
        print(p)
    if problems:
        print(f"{len(problems)} problem(s) in the plans")
        return 1
    cat = load_catalogue()
    print(f"plans ok: version {cat['version']} ({cat['status']}), {', '.join(p['id'] for p in cat['plans'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
