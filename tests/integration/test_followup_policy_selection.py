"""T010 part 2, commit 2b, on the REAL stack: the Python repository picks the SAME policy version as the database (`app.followup_active_policy_version`), including when a tenant has an older
policy, one effective today, one in the future and two versions on the same date. The request builder embeds the policy it was given, so a different pick would be a different request (SM226) or,
worse, a draft made under the wrong policy: this pins the selection rule on both sides, at several dates. All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import uuid
from datetime import date, timedelta

import pytest
from crm_support import World
from evidence_support import uid
from fastapi.testclient import TestClient
from followup_support import FollowWorld

from app.followups.repository import PostgrestFollowupsRepository


@pytest.fixture(scope="module")
def fw(client: TestClient, eval_world: World) -> FollowWorld:
    return FollowWorld(client, eval_world, eval_world.a)


def db_today() -> date:
    return date.fromisoformat(FollowWorld.sql("select app.quote_today()"))


def db_pick(tenant: str, on: date) -> str:
    return FollowWorld.sql(
        f"select coalesce(app.followup_active_policy_version('{tenant}', date '{on.isoformat()}')::text, '-')"
    )


def test_the_python_pick_equals_the_databases_with_an_older_a_current_a_future_and_two_on_one_date(
    fw: FollowWorld,
) -> None:
    repo = PostgrestFollowupsRepository(fw.w.stack.rest, fw.w.stack.anon_key)
    try:
        today = db_today()

        def python_pick(on: date) -> str:
            row = repo.active_policy(fw.owner.token, uuid.UUID(fw.t.id), on)
            return "-" if row is None else str(row["id"])

        # nothing yet: neither side finds a policy
        assert python_pick(today) == "-" == db_pick(fw.t.id, today)
        # (1) an OLDER policy: the functions refuse a past date, so it is planted the way only the operator can
        older = uid()
        fw.sql(
            f"insert into public.followup_policy_versions (id, tenant_id, version_no, effective_from, gap_days, max_touches, quiet_start, quiet_end, allowed_weekdays, holidays, min_gap_hours, recipient_utc_offset_minutes, content_sha256) "
            f"values ('{older}', '{fw.t.id}', 1, date '{(today - timedelta(days=10)).isoformat()}', '{{1,2}}', 3, '03:00', '04:00', '{{0,1,2,3,4,5,6}}', '{{}}', 0, 330, repeat('7', 64))"
        )
        # (2) one effective TODAY, (3) one in the FUTURE, (4) a second version on the SAME future date (the higher version number wins the tie)
        current = fw.policy(effective_from=today.isoformat(), gap_days=[1, 1])
        future = fw.policy(effective_from=(today + timedelta(days=5)).isoformat(), gap_days=[2, 2])
        tied = fw.policy(effective_from=(today + timedelta(days=5)).isoformat(), gap_days=[3, 3])
        assert len({older, current, future, tied}) == 4
        expected = {
            today - timedelta(days=30): "-",  # before the first
            today - timedelta(days=10): older,  # exactly the older one's date
            today - timedelta(days=1): older,
            today: current,
            today + timedelta(days=4): current,  # the day before the future version
            today + timedelta(days=5): tied,  # the tie: the later version
            today + timedelta(days=40): tied,
        }
        for on, want in expected.items():
            assert db_pick(fw.t.id, on) == want, f"the database at {on}"
            assert python_pick(on) == want, f"the Python repository at {on}"
        # and a lead snapshot, which uses the date in force NOW (India), embeds the policy the database says is in force today
        lead = fw.due_lead("pick")
        snap = repo.lead_snapshot(fw.owner.token, uuid.UUID(fw.t.id), uuid.UUID(lead.id))
        assert (
            snap is not None
            and snap.policy is not None
            and snap.policy.id == db_pick(fw.t.id, today) == current
        )
    finally:
        repo.close()
