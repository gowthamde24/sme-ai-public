# ruff: noqa: E501
"""CI test lanes (owner, 12 Nov 2026: only what a change can affect, everything on main): runs the REAL decision script of .github/workflows/ci.yml in a throw-away git repository for each kind of change."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[3]
WORKFLOW = yaml.safe_load((ROOT / ".github" / "workflows" / "ci.yml").read_text(encoding="utf-8"))
DECIDE = next(s["run"] for s in WORKFLOW["jobs"]["changes"]["steps"] if s.get("id") == "decide")


def lanes(tmp_path: Path, changed: list[str], event: str = "pull_request") -> dict[str, str]:
    def git(*args: str) -> str:
        env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@example.test", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@example.test"}
        return subprocess.run(["git", *args], cwd=tmp_path, env=env, capture_output=True, text=True, check=True).stdout.strip()  # noqa: S603, S607

    git("init", "-q", "-b", "main")
    (tmp_path / "README.md").write_text("x")
    git("add", "-A")
    git("commit", "-q", "-m", "base")
    base = git("rev-parse", "HEAD")
    for rel in changed:
        path = tmp_path / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("changed")
    git("add", "-A")
    git("commit", "-q", "-m", "change")
    head = git("rev-parse", "HEAD")
    out = tmp_path / "github_output"
    summary = tmp_path / "summary"
    env = {**os.environ, "EVENT": event, "BASE_SHA": base, "HEAD_SHA": head, "GITHUB_OUTPUT": str(out), "GITHUB_STEP_SUMMARY": str(summary)}
    subprocess.run(["bash", "-c", DECIDE], cwd=tmp_path, env=env, capture_output=True, text=True, check=True)  # noqa: S603, S607
    return dict(line.split("=", 1) for line in out.read_text().splitlines() if "=" in line)


@pytest.mark.parametrize(
    ("changed", "unit", "integration", "pgtap"),
    [
        (["docs/plans/x.md"], "true", "false", "false"),               # docs: some unit tests read them; never the database lanes
        (["README.md"], "false", "false", "false"),                    # a markdown file nothing reads
        (["apps/web/lib/x.ts"], "false", "false", "false"),            # the web has its own lanes
        (["e2e/staging-x.mjs"], "false", "false", "false"),
        (["deploy/staging.sh"], "true", "false", "false"),             # unit tests read the deploy scripts; no database
        (["services/ai-api/app/today/routes.py"], "true", "true", "false"),
        (["supabase/migrations/20261231510000_x.sql"], "true", "true", "true"),
        (["tests/integration/test_x.py"], "false", "true", "false"),
        (["docs/runbooks/agents-kill-switch.md"], "true", "true", "false"),   # an integration test runs its SQL blocks (and docs run the unit lane)
        ([".github/workflows/ci.yml"], "true", "true", "true"),        # a change to the CI itself runs everything
        (["scripts/ci/shard_tests.py"], "true", "true", "true"),
        (["something/nobody/listed.py"], "true", "true", "true"),      # fail closed
        (["docs/a.md", "services/ai-api/app/x.py"], "true", "true", "false"),   # the union of the lanes
    ],
)
def test_each_kind_of_change_runs_exactly_its_lanes(tmp_path: Path, changed: list[str], unit: str, integration: str, pgtap: str) -> None:
    got = lanes(tmp_path, changed)
    assert (got["unit"], got["integration"], got["pgtap"]) == (unit, integration, pgtap), got


def test_a_push_to_main_and_the_merge_queue_always_run_every_lane(tmp_path: Path) -> None:
    got = lanes(tmp_path, ["README.md"], event="push")
    assert (got["unit"], got["integration"], got["pgtap"], got["web"], got["webtests"]) == ("true",) * 5


def test_every_database_and_unit_job_is_tied_to_its_lane_and_the_aggregators_know_them() -> None:
    jobs = WORKFLOW["jobs"]
    assert "outputs.unit" in jobs["api-tests"]["if"]
    assert "outputs.pgtap" in jobs["db-pgtap"]["if"]
    integration = [k for k in jobs if k.startswith("db-integration")]
    assert integration and all("outputs.integration" in jobs[k]["if"] for k in integration)
    assert set(jobs["db"]["needs"]) == {"changes", "db-pgtap", *integration}, "the required `db` check must wait for every db job"
    expected = int(jobs["db"]["steps"][0]["env"]["EXPECTED_GROUPS"])
    assert expected == len([k for k in jobs["db"]["needs"] if k.startswith("db-")]), "EXPECTED_GROUPS counts the db jobs the aggregator needs"
