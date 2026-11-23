"""The follow-up due list's candidates (docs/plans/followups-due-candidates-plan.md), on the REAL stack: the proof that the lead that has waited longest is never missed.

One workspace of 600+ leads (module-scoped, built once):
  * 120 leads touched in the last hours ("not yet"), 340 older ones (2 to 38 days ago), 60 that replied, 40 at the policy's touch limit, 30 archived, 15 lost: made in bulk by the operator (straight SQL);
  * the lead that has waited LONGEST (its last message 40 days ago, the gap long over, nothing blocking it), made through the API so its contact is keyed and consented, its old touch planted by the operator
    (the API refuses a touch older than 7 days);
  * keyed leads made through the API: due ones, "not yet" ones, one opted out, one at the touch limit, one with a WON opportunity.

REGRESSION (written first, in C0, as an expected failure): the old due list read its candidates from the 120 NEWEST outbound touches and never showed the 40-day-old lead. It is green since C2.

THE ORACLE for the database level is the REAL pinned engine: for every lead of the workspace the database builds the engine's request (`app.followup_build`, pinned equal to the Python builder by the equivalence
gate) and the real `followup_cadence` decides; a lead is expected in the candidates when it has an outbound touch, is not archived, is not stopped by the database, and the engine does not call it terminal.
The function is not asked what it thinks of itself. All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import json
import math
from typing import Any

import httpx
import operator_sql
import pytest
from crm_support import World
from due_support import bulk_leads
from fastapi.testclient import TestClient
from followup_support import FollowWorld, Lead

from app.followups import cadence_port, service


class Workspace:
    def __init__(
        self, fw: FollowWorld, overdue: Lead, keyed_in: list[Lead], keyed_out: list[Lead]
    ) -> None:
        self.fw, self.overdue, self.keyed_in, self.keyed_out = fw, overdue, keyed_in, keyed_out


@pytest.fixture(scope="module")
def fw(client: TestClient, eval_world: World) -> FollowWorld:
    world = FollowWorld(client, eval_world, eval_world.a)
    world.policy()
    return world


@pytest.fixture(scope="module")
def ws(fw: FollowWorld) -> Workspace:
    t = fw.t.id
    bulk_leads(
        t, 120, "('out', 'email', now() - (n.i * interval '10 minutes'))"
    )  # 120 recent: their gap has not passed ("not yet")
    bulk_leads(
        t, 340, "('out', 'whatsapp', now() - ((2 + n.i % 37) * interval '1 day'))"
    )  # 340 older, due or about to be (2 to 38 days ago)
    bulk_leads(
        t,
        60,
        "('out', 'email', now() - interval '20 days'), ('in', 'email', now() - interval '10 days')",
    )  # replied: the engine stops for good
    bulk_leads(
        t,
        40,
        "('out', 'email', now() - interval '30 days'), ('out', 'email', now() - interval '25 days'), ('out', 'email', now() - interval '20 days')",
    )  # at the touch limit (3)
    bulk_leads(
        t, 30, "('out', 'email', now() - interval '25 days')", archived=True
    )  # archived: stopped by the database
    bulk_leads(
        t, 15, "('out', 'email', now() - interval '22 days')", status="disqualified"
    )  # lost: the engine stops for good
    overdue = fw.lead(
        "overdue", age_days=90
    )  # keyed and consented through the API, so its gate is open
    fw.plant_touch(
        overdue, "out", "now() - interval '40 days'"
    )  # the API refuses a touch older than 7 days: the operator plants it
    keyed_in = [
        fw.due_lead(f"k-due-{i}") for i in range(10)
    ]  # one outbound touch 5 days ago: due now
    for i in range(3):  # touched just now: "not yet"
        lead = fw.lead(f"k-notyet-{i}")
        assert fw.touch("sales", lead, days_ago=0).status_code == 201
        keyed_in.append(lead)
    keyed_out = []
    opted = fw.due_lead("k-optout")
    assert fw.suppress(opted).status_code == 200
    keyed_out.append(opted)
    keyed_out.append(fw.due_lead("k-limit", outs=3))  # at the limit of three
    won = fw.due_lead("k-won")
    operator_sql.sql(
        f"insert into public.opportunities (id, tenant_id, company_id, lead_id, title, status, closed_at) values (gen_random_uuid(), '{t}', '{fw.t.rows['companies']['id']}', '{won.id}', 'Synthetic won deal', 'won', now())"
    )
    keyed_out.append(won)
    return Workspace(fw, overdue, keyed_in, keyed_out)


def expected_by_the_engine(fw: FollowWorld) -> set[str]:
    """The leads the candidates must contain, decided by the REAL engine on the database's own request for each lead."""
    raw = operator_sql.sql(
        f"""select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'req', app.followup_build(l.id, to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), app.followup_active_policy_version(l.tenant_id, app.quote_today())))), '[]'::jsonb)
  from public.leads l where l.tenant_id = '{fw.t.id}' and l.archived_at is null and app.followup_stopped(l.id) is null
   and exists (select 1 from public.lead_touches x where x.lead_id = l.id and x.direction = 'out')"""
    )
    expected: set[str] = set()
    for row in json.loads(raw):
        result = cadence_port.run_decide(row["req"])
        if cadence_port.is_rejected(result) or not result["terminal"]:
            expected.add(row["id"])
    return expected


def rpc_page(
    fw: FollowWorld, after: dict[str, str] | None, limit: int = 30, scan: int = 300
) -> dict[str, Any]:
    r = httpx.post(
        f"{fw.w.stack.rest}/rpc/followup_due_candidates",
        headers=fw.w.stack.headers(fw.sales.token),
        json={
            "p_tenant_id": fw.t.id,
            "p_after_at": None if after is None else after["at"],
            "p_after_id": None if after is None else after["id"],
            "p_limit": limit,
            "p_scan_max": scan,
        },
        timeout=60,
    )
    assert r.status_code == 200, r.text
    return dict(r.json())


def walk_database(fw: FollowWorld, limit: int = 30, scan: int = 300) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    after: dict[str, str] | None = None
    for _ in range(200):
        page = rpc_page(fw, after, limit, scan)
        assert len(page["items"]) <= limit
        items += page["items"]
        after = page["next_cursor"]
        if after is None:
            return items
    pytest.fail("the walk does not end")


# ============================================================================ the regression, now green
def test_the_lead_that_has_waited_longest_is_on_the_first_page_of_the_due_list_in_a_600_lead_workspace(
    ws: Workspace,
) -> None:
    fw = ws.fw
    assert (
        int(
            operator_sql.sql(
                f"select count(distinct lead_id) from public.lead_touches where tenant_id = '{fw.t.id}' and direction = 'out'"
            )
        )
        >= 600
    )
    shown = fw.call("GET", "/followups/due", "sales")
    assert shown.status_code == 200, shown.text
    body = shown.json()
    assert ws.overdue.id in {row["lead_id"] for row in body["items"]}, (
        "the lead that has waited longest (40 days) is not in the first page of the due list"
    )
    assert body["items"][0]["lead_id"] == ws.overdue.id, (
        "and it is the first row: the longest wait comes first"
    )
    assert (
        body["items"][0]["action"] == "draft_followup"
        and body["items"][0]["reason_code"] == "eligible_now"
    )


# ============================================================================ the database level: the whole walk against the real engine
def test_the_walk_returns_exactly_the_leads_the_real_engine_does_not_stop_each_once_and_oldest_first(
    ws: Workspace,
) -> None:
    fw = ws.fw
    expected = expected_by_the_engine(fw)
    walked = walk_database(fw)
    ids = [row["lead_id"] for row in walked]
    assert len(ids) == len(set(ids)), "a lead was returned twice in one walk"
    assert set(ids) == expected, (
        f"missing {len(expected - set(ids))}, unexpected {len(set(ids) - expected)}; first missing {sorted(expected - set(ids))[:3]}, first unexpected {sorted(set(ids) - expected)[:3]}"
    )
    assert len(ids) >= 450, (
        "the workspace must hold hundreds of candidates for this proof to mean something"
    )
    assert ids[0] == ws.overdue.id, "the lead that has waited longest comes first"
    key = [(row["last_outbound_at"], row["lead_id"]) for row in walked]
    assert key == sorted(key), "not in 'last outbound touch, then lead id' order"


def test_no_terminal_lead_is_returned_and_no_lead_the_engine_could_still_make_due_is_missing(
    ws: Workspace,
) -> None:
    fw = ws.fw
    ids = {row["lead_id"] for row in walk_database(fw)}
    keyed_out = {lead.id for lead in ws.keyed_out}
    assert not ids & keyed_out, "an opted-out, a won and an at-limit lead must not be candidates"
    assert {lead.id for lead in ws.keyed_in} <= ids, (
        "every keyed lead that is due or not yet must be a candidate"
    )
    replied = {
        r.strip()
        for r in operator_sql.sql(
            f"select distinct lead_id from public.lead_touches where tenant_id = '{fw.t.id}' and direction = 'in'"
        ).splitlines()
    }
    assert replied and not ids & replied, "a lead that replied must not be a candidate"
    archived = {
        r.strip()
        for r in operator_sql.sql(
            f"select id from public.leads where tenant_id = '{fw.t.id}' and archived_at is not null"
        ).splitlines()
    }
    assert archived and not ids & archived


def test_a_walk_with_a_tiny_scan_cap_returns_the_same_leads_only_more_slowly(ws: Workspace) -> None:
    fw = ws.fw
    whole = [row["lead_id"] for row in walk_database(fw, 30, 300)]
    slow = [row["lead_id"] for row in walk_database(fw, 7, 9)]
    assert slow == whole, (
        "the page size and the scan cap change how a walk is cut, never what it contains"
    )


# ============================================================================ the API level: pages, gate reads, left out
def test_the_api_walk_shows_every_keyed_candidate_once_counts_what_it_left_out_and_starts_with_the_overdue_lead(
    ws: Workspace,
) -> None:
    fw = ws.fw
    candidates = len(walk_database(fw))
    seen: list[str] = []
    left_out = pages = 0
    after: str | None = None
    while True:
        r = fw.call("GET", "/followups/due" + ("" if after is None else f"?after={after}"), "sales")
        assert r.status_code == 200, r.text
        body = r.json()
        pages += 1
        assert len(body["items"]) + body["left_out"] <= service.DUE_LIST_MAX_LEADS, (
            "a request processes at most one page of candidates"
        )
        if pages == 1:
            assert body["items"][0]["lead_id"] == ws.overdue.id
        seen += [i["lead_id"] for i in body["items"]]
        left_out += body["left_out"]
        after = body["next_cursor"]
        if after is None:
            break
        assert pages < 100
    wanted = {ws.overdue.id} | {lead.id for lead in ws.keyed_in}
    assert len(seen) == len(set(seen)), "a lead was shown twice"
    assert set(seen) == wanted, f"shown {len(seen)}, wanted {len(wanted)}"
    assert len(seen) + left_out == candidates, (
        "every candidate is either shown or counted as left out"
    )
    assert left_out >= 400, (
        "the contactless bulk leads cannot be contacted on any channel: they are left out, and counted"
    )
    assert pages == math.ceil(candidates / service.DUE_LIST_MAX_LEADS), (
        "pages are cut at 30 candidates (no dead leads were ever examined past the cap here)"
    )


def test_the_page_size_cannot_be_raised_through_the_api_and_a_bad_cursor_is_a_422(
    ws: Workspace,
) -> None:
    fw = ws.fw
    assert fw.call("GET", "/followups/due?after=garbage", "sales").status_code == 422
    assert fw.call("GET", "/followups/due?after=" + "x" * 201, "sales").status_code == 422
    first = fw.call("GET", "/followups/due", "sales").json()
    assert (
        len(first["items"]) + first["left_out"] == service.DUE_LIST_MAX_LEADS
        and first["next_cursor"]
    )
