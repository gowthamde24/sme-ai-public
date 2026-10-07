"""The follow-up due list's candidates (docs/plans/followups-due-candidates-plan.md), on the REAL stack.

The REGRESSION, written first (C0) and committed as an expected failure; it turned green in C2, the commit that wires the function into the API, and the marker went with it. A workspace of 600+ leads in which the lead that has waited longest (its last message was 40 days ago, the
gap long over, nothing blocking it) is the one a person most needs to see. The due list reads its candidates from the 120 NEWEST outbound touches, so that lead is never shown. The test asserts
what must be true (the lead is on the first page of the due list). All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import pytest
from crm_support import World
from due_support import bulk_leads, count_leads_with_outbound
from fastapi.testclient import TestClient
from followup_support import FollowWorld


@pytest.fixture(scope="module")
def fw(client: TestClient, eval_world: World) -> FollowWorld:
    world = FollowWorld(client, eval_world, eval_world.a)
    world.policy()
    return world


def load_600(fw: FollowWorld) -> None:
    """600+ leads with one history each; none of them has a contact (the gate is not what this test is about)."""
    t = fw.t.id
    bulk_leads(
        t, 120, "('out', 'email', now() - (n.i * interval '10 minutes'))"
    )  # 120 recent: their gap has not passed ("Not yet")
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


def test_the_lead_that_has_waited_longest_is_on_the_first_page_of_the_due_list_in_a_600_lead_workspace(
    fw: FollowWorld,
) -> None:
    load_600(fw)
    overdue = fw.lead(
        "overdue", age_days=90
    )  # keyed and consented through the API, so its gate is open
    fw.plant_touch(
        overdue, "out", "now() - interval '40 days'"
    )  # the API refuses a touch older than 7 days: the operator plants it
    assert count_leads_with_outbound(fw.t.id) >= 600
    shown = fw.call("GET", "/followups/due", "sales")
    assert shown.status_code == 200, shown.text
    rows = shown.json()["items"]
    assert overdue.id in {row["lead_id"] for row in rows}, (
        "the lead that has waited longest (40 days) is not in the due list"
    )
