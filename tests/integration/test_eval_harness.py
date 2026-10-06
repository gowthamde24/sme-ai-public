"""The eval HARNESS itself (no database): evals never share the session-wide tenant, and a `failed/budget` outcome says which budget tripped.

CI run 14 (2026-10-06): the whole tests/integration directory runs in ONE pytest session, the session-wide `crm_world` tenants had by then
written 500 agent steps (`max_writes_per_day`), and the research golden set ended `failed/budget` on the businesses that write, while `make check`
(which runs the evals in a session of their own) passed. These tests keep that from coming back."""

# ruff: noqa: E501

from __future__ import annotations

import re
from pathlib import Path

import agent_eval as ev
import pytest

HERE = Path(__file__).resolve().parent
EVAL_MODULES = sorted([*HERE.glob("test_*evals.py"), *HERE.glob("test_*golden.py")])


def test_the_eval_modules_are_found() -> None:
    names = {p.name for p in EVAL_MODULES}
    assert {
        "test_agent_evals.py",
        "test_research_evals.py",
        "test_research_golden.py",
        "test_requirement_evals.py",
        "test_requirement_golden.py",
    } <= names


@pytest.mark.parametrize("path", EVAL_MODULES, ids=lambda p: p.name)
def test_an_eval_never_uses_the_session_shared_tenants(path: Path) -> None:
    source = path.read_text()
    assert "crm_world" not in source, (
        f"{path.name} uses the session-wide crm_world: its per-tenant limits (writes per day, daily cost) are shared with every earlier test; use eval_world"
    )
    # a module that builds its own world takes the fresh one; the golden modules take `ctx` from the evals module that does
    if re.search(r"(?m)^def (ctx|world)\(", source):
        assert "eval_world" in source, f"{path.name} defines its own world without eval_world"
    else:
        assert "import (" in source or "from test_" in source, (
            f"{path.name} neither defines nor imports a world"
        )


def _row(**over: int) -> dict[str, int]:
    base = {
        "writes_used": 0, "max_writes": 7, "tool_calls_used": 2, "max_tool_calls": 14, "input_tokens_used": 500, "max_input_tokens": 120000,
        "output_tokens_used": 170, "max_output_tokens": 4000, "cost_micros_used": 670, "max_cost_micros": 150000,
        "tenant_writes_24h": 10, "writes_per_day_limit": 500, "day_spend_micros": 1000, "daily_cap_micros": 2000000,
    }  # fmt: skip
    return {**base, **over}


def test_a_tenant_at_its_daily_write_limit_is_named() -> None:
    text = ev.explain_budget(_row(tenant_writes_24h=500))
    assert text.startswith(
        "tenant_writes_per_day (500 write steps by this tenant in the last 24 hours, limit 500"
    )
    assert (
        "writes 0/7" in text and "tenant writes 24h 500/500" in text
    )  # the exact CI picture: the run's own budgets untouched


def test_a_run_budget_at_its_limit_is_named_before_the_tenant_limits() -> None:
    assert ev.explain_budget(_row(writes_used=7)).startswith("run_budget (writes 7/7)")
    assert ev.explain_budget(_row(tool_calls_used=14, cost_micros_used=150000)).startswith(
        "run_budget (tool_calls 14/14, cost_micros 150000/150000)"
    )
    assert ev.explain_budget(_row(input_tokens_used=120000, tenant_writes_24h=500)).startswith(
        "run_budget (input_tokens 120000/120000)"
    )
    assert ev.explain_budget(_row(output_tokens_used=4000)).startswith(
        "run_budget (output_tokens 4000/4000)"
    )


def test_the_daily_cost_cap_is_named() -> None:
    text = ev.explain_budget(_row(day_spend_micros=2000000))
    assert text.startswith("daily_cost_cap (spent 2000000 of 2000000 micros today, UTC")


def test_nothing_at_a_limit_says_so_instead_of_guessing() -> None:
    text = ev.explain_budget(_row())
    assert text.startswith("not_attributed") and "run counters:" in text


def test_only_a_budget_outcome_is_expanded(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(ev, "budget_detail", lambda run_id: f"detail for {run_id}")
    assert ev.outcome_text("failed", "budget", "r1") == "failed/budget: detail for r1"
    assert ev.outcome_text("succeeded", None, "r1") == "succeeded/None"
    assert ev.outcome_text("failed", "invalid_output", "r1") == "failed/invalid_output"
