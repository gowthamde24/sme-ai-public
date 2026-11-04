"""Rebuild a test workspace (scripts/rebuild_owner_test.py, owner answer 1, 4 Nov 2026): the generation of the helper account, the plan a run makes, and its refusals. No network, no database: the
operator's SQL is a fake that answers like the staging project would. The database side (archive, read-only, hidden, the allowance) is pgTAP 152."""

# ruff: noqa: E501

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "scripts"))
import rebuild_owner_test as r  # noqa: E402
from seed_staging import SeedError  # noqa: E402

NAME = "Lakshmi Silks (test)"


def fake_sql(in_use: list[dict[str, Any]], archived: int) -> Any:
    seen: list[str] = []

    def sql(query: str) -> list[dict[str, Any]]:
        seen.append(query)
        if "count(*)" in query:
            return [{"n": archived}]
        return in_use

    sql.seen = seen  # type: ignore[attr-defined]
    return sql


def test_the_first_generation_is_the_original_helper_and_later_ones_have_their_own_address_and_secrets() -> None:
    assert r.generation_email("textiles", 1) == "owner-test-textiles@demo.example.test"
    assert r.generation_email("construction_materials", 2) == "owner-test-construction-materials-g2@demo.example.test"
    assert r.generation_key("textiles", 1) == "textiles" and r.generation_key("textiles", 3) == "textiles-g3"


def test_the_first_rebuild_archives_the_workspace_in_use_and_uses_generation_two() -> None:
    sql = fake_sql([{"id": "t1", "slug": "lakshmi-silks-test-a91e7fee", "gate_open": False, "demo": False}], archived=0)
    p = r.plan(sql, NAME)
    assert p["in_use"]["slug"] == "lakshmi-silks-test-a91e7fee" and p["generation"] == 2
    assert all(q.lstrip().lower().startswith("select") for q in sql.seen), "the plan only reads"
    assert "starts_with(t.name, 'Lakshmi Silks (test) (archived ')" in sql.seen[1]


def test_a_run_that_stopped_after_archiving_picks_up_the_same_generation() -> None:
    assert r.plan(fake_sql([], archived=1), NAME)["generation"] == 2
    assert r.plan(fake_sql([{"id": "t2", "slug": "s", "gate_open": False, "demo": False}], archived=1), NAME)["generation"] == 3


@pytest.mark.parametrize("row", [{"id": "t", "slug": "s", "gate_open": True, "demo": False}, {"id": "t", "slug": "s", "gate_open": False, "demo": True}])
def test_a_workspace_with_an_open_gate_or_a_demo_is_never_rebuilt_this_way(row: dict[str, Any]) -> None:
    with pytest.raises(SeedError):
        r.plan(fake_sql([row], archived=0), NAME)


def test_two_workspaces_in_use_with_the_name_are_refused() -> None:
    with pytest.raises(SeedError):
        r.plan(fake_sql([{"id": "a", "slug": "a", "gate_open": False, "demo": False}, {"id": "b", "slug": "b", "gate_open": False, "demo": False}], archived=0), NAME)


def test_the_name_is_quoted() -> None:
    assert r.q("O'Brien (test)") == "'O''Brien (test)'"
