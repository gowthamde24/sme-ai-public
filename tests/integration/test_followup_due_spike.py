"""TIMING of the due list's candidates function (docs/plans/followups-due-candidates-plan.md, sections 4 and 12). It began as the C0 SPIKE (option B measured with a draft of the function applied by hand) and, since
C1, measures the function the MIGRATION made: nothing is created or dropped here.

OPT-IN: runs only with DUE_SPIKE=1 (it loads 20,000 leads and 100,000+ outbound touches and takes a few minutes), never in `make check`:

    cd services/ai-api && DUE_SPIKE=1 ../../scripts/with-local-supabase-env.sh .venv/bin/pytest -c pyproject.toml ../../tests/integration/test_followup_due_spike.py -q -s

The function is timed INSIDE the database (clock_timestamp around each call, so no docker or HTTP overhead). The numbers are printed, not asserted tightly (only a loose 10 s bound so the machine's speed cannot
make it flaky); the budget of section 4 is: first page under 300 ms (p95 over 20 runs) and a page that has to skip 300 terminal leads under 1.5 s. All data is synthetic."""

# ruff: noqa: E501, S608, T201

from __future__ import annotations

import json
import os
import time
from typing import Any

import operator_sql
import pytest
from crm_support import World
from due_support import bulk_leads
from fastapi.testclient import TestClient
from followup_support import FollowWorld

pytestmark = pytest.mark.skipif(
    os.environ.get("DUE_SPIKE") != "1", reason="opt-in spike: set DUE_SPIKE=1"
)

LEADS, CHUNK = 20_000, 5_000


@pytest.fixture(scope="module")
def fw(client: TestClient, eval_world: World) -> FollowWorld:
    world = FollowWorld(client, eval_world, eval_world.a)
    world.policy()
    return world


def load_big(fw: FollowWorld) -> None:
    """20,000 leads with 1 to 9 outbound touches each (about 100,000 in all), spread over a year, and 400 `replied` leads that are older than everything else (so a page from the start must skip them)."""
    t = fw.t.id
    started = time.perf_counter()
    for chunk in range(LEADS // CHUNK):
        offset = chunk * CHUNK
        operator_sql.sql(
            f"""set local session_replication_role = replica;
with l as (
  insert into public.leads (id, tenant_id, created_at) select gen_random_uuid(), '{t}', now() - interval '700 days' from generate_series(1, {CHUNK}) returning id
), n as (select id, row_number() over () + {offset} as i from l)
insert into public.lead_touches (id, tenant_id, lead_id, direction, channel, occurred_at, recorded_at)
select gen_random_uuid(), '{t}', n.id, 'out', (case when k % 2 = 0 then 'email' else 'whatsapp' end)::public.consent_channel,
       now() - (((n.i * 7919) % 360) + 1) * interval '1 day' - k * interval '1 hour', now()
  from n cross join lateral generate_series(0, (n.i % 9)::int) k"""
        )
    bulk_leads(
        t,
        400,
        "('out', 'email', now() - interval '500 days'), ('in', 'email', now() - interval '499 days')",
        replica=True,
    )
    print(f"\n[timing] loaded {LEADS} + 400 leads in {time.perf_counter() - started:.1f} s")
    print(
        "[timing] outbound touches:",
        operator_sql.sql(
            f"select count(*) from public.lead_touches where tenant_id = '{t}' and direction = 'out'"
        ),
    )
    operator_sql.sql("analyze public.lead_touches; analyze public.leads")


def timed(
    fw: FollowWorld, label: str, after: str | None, runs: int = 20, warmup: int = 3
) -> dict[str, float]:
    """The function called `runs` times INSIDE one session; per-call milliseconds from clock_timestamp()."""
    uid, tenant = fw.owner.id, fw.t.id
    after_args = (
        "null, null"
        if after is None
        else f"now() - interval '{after}', '00000000-0000-0000-0000-000000000000'::uuid"
    )
    out = operator_sql.sql(
        f"""create temp table m (ms numeric);
do $$ declare t0 timestamptz; i integer; begin
  perform set_config('request.jwt.claims', '{{"sub":"{uid}","role":"authenticated"}}', true);
  for i in 1..{runs + warmup} loop
    t0 := clock_timestamp();
    perform public.followup_due_candidates('{tenant}', {after_args}, 30, 300);
    if i > {warmup} then insert into m values (extract(epoch from clock_timestamp() - t0) * 1000); end if;
  end loop;
end $$;
select json_build_object('p50', round(percentile_cont(0.5) within group (order by ms)::numeric, 1), 'p95', round(percentile_cont(0.95) within group (order by ms)::numeric, 1), 'max', round(max(ms), 1)) from m"""
    )
    figures: dict[str, float] = {k: float(v) for k, v in json.loads(out).items()}
    print(f"[timing] {label}: {figures} ms")
    return figures


def one_call(fw: FollowWorld, after: str | None) -> dict[str, Any]:
    uid, tenant = fw.owner.id, fw.t.id
    after_args = (
        "null, null"
        if after is None
        else f"now() - interval '{after}', '00000000-0000-0000-0000-000000000000'::uuid"
    )
    out = operator_sql.sql(
        f"""select set_config('request.jwt.claims', '{{"sub":"{uid}","role":"authenticated"}}', true) is not null;
select public.followup_due_candidates('{tenant}', {after_args}, 30, 300)::text"""
    )
    return dict(json.loads(out.splitlines()[-1]))


def test_the_candidates_function_cost_at_20000_leads(fw: FollowWorld) -> None:
    load_big(fw)
    start = one_call(fw, None)
    assert start["policy_in_force"] is True
    print(
        f"[timing] from the start (400 terminal leads first): items={len(start['items'])}, next_cursor={'set' if start['next_cursor'] else None}"
    )
    skip = timed(fw, "skip 300 terminal leads (cap reached, a cursor returned)", None, runs=8)
    first = timed(fw, "first normal page", "480 days")
    deep = timed(fw, "a page deep in the set (180 days)", "180 days")
    plan = operator_sql.sql(
        f"explain (analyze, costs off, timing off) select t.lead_id, max(t.occurred_at) from public.lead_touches t where t.tenant_id = '{fw.t.id}' and t.direction = 'out' group by t.lead_id"
    )
    print("[timing] aggregate plan:\n" + "\n".join("    " + line for line in plan.splitlines()[:8]))
    print(
        f"[timing] BUDGET: first page p95 {first['p95']} ms (< 300), skip-300 p95 {skip['p95']} ms (< 1500)"
    )
    for figures in (skip, first, deep):
        assert figures["max"] < 10_000, (
            figures
        )  # the loose bound: only a broken plan fails the test
