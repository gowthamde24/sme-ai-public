"""Shared helpers for the due-candidates tests (docs/plans/followups-due-candidates-plan.md): synthetic leads in BULK, written the way only the operator can (straight SQL on the local stack),
so a test can have hundreds of leads with a history without hundreds of API calls. The leads have no contact and no company (the follow-up rules read none for these tests); the keyed leads whose
gate matters are made through the API by `followup_support.FollowWorld`. All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import operator_sql


def bulk_leads(tenant_id: str, count: int, touches: str, *, status: str = "new", archived: bool = False, replica: bool = False) -> None:
    """`count` leads (created 600 days ago) in `tenant_id`, each with the touches in `touches`: the body of a SQL VALUES list of (direction, channel, occurred_at) where `n.i` is the lead's number 1..count.
    `replica` switches triggers and foreign keys off for the statement (only for the big timing data set: the rows are still consistent)."""
    prefix = "set local session_replication_role = replica;\n" if replica else ""
    archived_sql = "now()" if archived else "null::timestamptz"
    operator_sql.sql(
        f"""{prefix}
with l as (
  insert into public.leads (id, tenant_id, status, created_at, archived_at)
  select gen_random_uuid(), '{tenant_id}', '{status}', now() - interval '600 days', {archived_sql} from generate_series(1, {count}) returning id
), n as (select id, row_number() over () as i from l)
insert into public.lead_touches (id, tenant_id, lead_id, direction, channel, occurred_at, recorded_at)
select gen_random_uuid(), '{tenant_id}', n.id, d.direction::public.touch_direction, d.channel::public.consent_channel, d.at, now()
  from n cross join lateral (values {touches}) as d(direction, channel, at)"""
    )


def count_leads_with_outbound(tenant_id: str) -> int:
    return int(operator_sql.sql(f"select count(distinct lead_id) from public.lead_touches where tenant_id = '{tenant_id}' and direction = 'out'").strip())
