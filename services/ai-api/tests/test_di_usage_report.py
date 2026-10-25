"""Job DI: the usage-test harness (scripts/usage_report.py) on a fixture: no network, no database."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
import usage_report  # noqa: E402

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "usage_rows.json").read_text())
ASSUMPTIONS = json.loads((ROOT / "scripts" / "usage_assumptions.json").read_text())
CATALOGUE = json.loads((ROOT / "packages" / "plans" / "plans.json").read_text())


def report(data: dict[str, Any] | None = None) -> str:
    return usage_report.build_report(data or FIXTURE, CATALOGUE, ASSUMPTIONS, days=14, source="fixture")


def test_every_plan_has_a_row_and_the_levels_grow() -> None:
    ai = usage_report.measured_ai(FIXTURE["ai"], ASSUMPTIONS)
    costs = usage_report.plan_costs(CATALOGUE, FIXTURE["allowances"], ai, ASSUMPTIONS)
    assert [c["id"] for c in costs] == list(usage_report.PLAN_ORDER)
    for c in costs:
        totals = [c["levels"][k]["total"] for k in usage_report.LEVELS]
        assert totals == sorted(totals), c["id"]


def test_the_measured_ai_cost_is_used_when_there_is_enough_and_the_fallback_when_not() -> None:
    measured = usage_report.measured_ai(FIXTURE["ai"], ASSUMPTIONS)
    assert measured["basis"].startswith("measured") and measured["low"] <= measured["typical"] <= measured["heavy"]
    thin = usage_report.measured_ai(FIXTURE["ai"][:3], ASSUMPTIONS)
    assert thin["basis"].startswith("FALLBACK") and thin["typical"] == ASSUMPTIONS["ai_rupees_per_active_day_fallback"]["typical"]


def test_the_ai_cost_never_exceeds_the_plans_monthly_fair_use_allowance() -> None:
    costs = usage_report.plan_costs(CATALOGUE, FIXTURE["allowances"], {"low": 50.0, "typical": 90.0, "heavy": 400.0}, ASSUMPTIONS)
    ceilings = {a["plan"]: a["monthly_paise"] / 100 for a in FIXTURE["allowances"]}
    for c in costs:
        assert c["levels"]["heavy"]["ai"] <= ceilings[c["id"]] + 1e-9, c["id"]


def test_pay_as_you_go_uses_assumed_minutes_and_the_price_covers_the_margin() -> None:
    ai = {"low": 1.0, "typical": 1.0, "heavy": 1.0}
    costs = {c["id"]: c for c in usage_report.plan_costs(CATALOGUE, FIXTURE["allowances"], ai, ASSUMPTIONS)}
    assert [costs["calls_payg"]["levels"][k]["minutes"] for k in usage_report.LEVELS] == [30, 100, 300]
    heavy = costs["calls_300"]["levels"]["heavy"]
    assert heavy["minutes"] == 300 and heavy["calls"] == round(300 * usage_report.call_rupees_per_minute(ASSUMPTIONS), 2)
    margin = ASSUMPTIONS["target_gross_margin_percent"] / 100 + ASSUMPTIONS["payment_fee_percent"] / 100
    assert abs(heavy["price_for_margin"] * (1 - margin) - heavy["total"]) < 0.02


def test_the_report_names_workspaces_by_hash_flags_assumptions_and_says_why_there_are_no_minutes() -> None:
    text = report()
    assert "| plan |" in text and "calls_payg" in text and "ASSUMPTION" in text
    assert "ws-" in text
    for row in FIXTURE["ai"]:
        assert row["tenant"] not in text, "a workspace id must never be printed"
    assert "billing tables are not on this database yet" in text


def test_an_empty_window_still_makes_a_report() -> None:
    text = report({"ai": [], "messages": [], "minutes": [], "allowances": FIXTURE["allowances"], "have_minutes": True})
    assert "Nothing was recorded" in text and "FALLBACK" in text


def test_staging_is_read_only_and_refuses_without_its_flags() -> None:
    for name, query in usage_report.QUERIES.items():
        assert query.lstrip().lower().startswith("select"), name
        assert not any(w in query.lower() for w in ("insert ", "update ", "delete ", "drop ", "alter ", "truncate ")), name
    done = subprocess.run([sys.executable, "-I", str(ROOT / "scripts" / "usage_report.py"), "--source", "staging"], capture_output=True, text=True, check=False)  # noqa: S603
    assert done.returncode == 2 and "Refusing" in done.stderr
