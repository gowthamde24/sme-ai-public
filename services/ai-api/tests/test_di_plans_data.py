"""Job DI: the plans catalogue is data (packages/plans/plans.json) and the checker holds it to its rules."""

from __future__ import annotations

import copy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
import plans_check  # noqa: E402
import plans_migration  # noqa: E402

SCHEMA = plans_check.load_json(plans_check.PLANS / "plans.schema.json")


def catalogue() -> dict:  # type: ignore[type-arg]
    return copy.deepcopy(plans_check.load_catalogue())


def errors(cat: dict) -> list[str]:  # type: ignore[type-arg]
    return plans_check.check_catalogue(cat, SCHEMA)


def test_the_catalogue_in_the_repository_is_valid() -> None:
    assert plans_check.check_all() == []


def test_the_owner_decisions_are_in_the_data() -> None:
    cat = catalogue()
    by_id = {p["id"]: p for p in cat["plans"]}
    assert cat["trial"]["days"] == 30 and cat["trial"]["payment_method_at_start"] is True
    minutes = {i: p["allowances"]["call_minutes"] for i, p in by_id.items()}
    messages = {i: p["allowances"]["whatsapp_messages"] for i, p in by_id.items()}
    assert minutes == {"free_trial": 30, "starter": 0, "growth": 100, "business": 300, "calls_payg": None, "calls_300": 300, "calls_1000": 1000}
    assert [messages[i] for i in ("free_trial", "starter", "growth", "business")] == [100, 300, 1000, 3000]
    assert [by_id[i]["limits"]["users"] for i in ("free_trial", "starter", "growth", "business")] == [1, 1, 3, 10]
    assert [by_id[i]["limits"]["workspaces"] for i in ("free_trial", "starter", "growth", "business")] == [1, 1, 1, 3]


def test_every_price_is_null_until_the_owner_sets_it() -> None:
    for p in catalogue()["plans"]:
        assert p["price_paise_monthly"] is None, p["id"]
        assert p.get("price_paise_per_minute") is None, p["id"]


def test_no_plan_id_is_a_string_literal_in_code() -> None:
    assert plans_check.plan_ids_in_code() == []


def test_the_catalogue_is_in_a_migration_and_matches_it_byte_for_byte() -> None:
    cat, problems = plans_migration.pending()
    assert problems == [] and cat is None, "run `make plans-migration`"
    sha = plans_migration.manifest_sha256(plans_migration.manifest_of(catalogue()))
    assert plans_migration.synced()[catalogue()["version"]] == sha


def test_a_synced_version_cannot_be_edited() -> None:
    cat = catalogue()
    cat["plans"][1]["allowances"]["whatsapp_messages"] = 301
    sha = plans_migration.manifest_sha256(plans_migration.manifest_of(cat))
    assert sha != plans_migration.synced()[cat["version"]]


def test_the_checker_refuses_a_duplicate_id_a_second_trial_and_a_smaller_bigger_plan() -> None:
    cat = catalogue()
    cat["plans"][2]["id"] = "starter"
    assert any("appears twice" in e for e in errors(cat))
    cat = catalogue()
    cat["plans"][1]["kind"] = "trial"
    assert any("exactly one plan" in e for e in errors(cat))
    cat = catalogue()
    next(p for p in cat["plans"] if p["id"] == "business")["allowances"]["whatsapp_messages"] = 10
    assert any("fewer whatsapp_messages" in e for e in errors(cat))


def test_pay_as_you_go_is_for_a_calls_only_plan_and_needs_its_rate_field() -> None:
    cat = catalogue()
    next(p for p in cat["plans"] if p["id"] == "growth")["allowances"]["call_minutes"] = None
    assert any("only a calls-only plan may be pay as you go" in e for e in errors(cat))
    cat = catalogue()
    del next(p for p in cat["plans"] if p["id"] == "calls_payg")["price_paise_per_minute"]
    assert any("needs its price_paise_per_minute" in e for e in errors(cat))


def test_the_checker_refuses_unknown_keys_and_a_price_that_is_not_a_number() -> None:
    cat = catalogue()
    cat["plans"][1]["ai_rupees"] = 5
    assert any("schema" in e for e in errors(cat))
    cat = catalogue()
    cat["plans"][1]["price_paise_monthly"] = "free"
    assert any("schema" in e for e in errors(cat))


def test_a_plan_id_literal_on_a_line_about_a_plan_is_found_and_other_words_are_left_alone(tmp_path: Path) -> None:
    src = tmp_path / "x.py"
    src.write_text('if tenant.plan == "growth":\n    pass\nkind = "business"\nlabel = "growth"  # plan-id-ok\n', encoding="utf-8")
    hits = plans_check.plan_ids_in_code(files=[src], root=tmp_path)
    assert len(hits) == 1 and hits[0].startswith("x.py:1:")
