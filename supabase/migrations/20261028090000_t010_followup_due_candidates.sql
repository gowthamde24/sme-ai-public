-- The follow-up due list's CANDIDATES (docs/plans/followups-due-candidates-plan.md, slice C1). ONE new function, no table, no index, no change to any existing function.
--
-- WHAT IT IS. A read-only list of the leads a person might have to follow up, OLDEST last outbound touch first, with a keyset cursor. It is a SAFE SUPERSET: it may return more leads than the pinned cadence engine
-- (followup_cadence 1.0.0) would call due, never fewer. The API still gates every candidate per channel (stop > block > engine), still runs the pinned engine, and the database still decides again when a draft is
-- asked for. The function returns no action, no reason and no time of eligibility.
--
-- WHAT "COULD BE DUE" MEANS (none of it is a cadence rule):
--   L0  the caller is an Owner, Admin or Sales member of the tenant (anyone else, or no caller: the generic 42501, the same answer for everyone, as public.followup_gate);
--   L1  the lead has at least one OUTBOUND touch (without one the engine can only say initial_outreach_required: the first message is a person's);
--   L2  the lead is not archived (a cheap pre-filter; app.followup_stopped stays the authority for every stop) and app.followup_stopped(lead) is null (an accepted, declined or cancelled order; a withdrawn quote);
--   L3  the database's OWN mirror of the engine's due rule (app.followup_build + app.followup_blocker, pinned equal to the real engine by tests/integration/test_followup_equivalence.py) does not answer one of
--       the four TERMINAL answers: suppressed, replied, closed, max_touches. Every other answer (not_yet, future_history, initial_outreach, invalid, null = due) stays in. The four are exactly the answers whose
--       engine counterparts carry terminal = true, and the equivalence gate pins that; a lead the blocker calls terminal could not receive a draft anyway (create_followup_draft refuses it with the same function);
--   L4  a follow-up policy is in force; with none, the answer is an empty list and policy_in_force = false.
-- NOT here, on purpose: the gate (consent, key, unkeyed, erased, per channel) stays in the API after this function, and no timing rule (gap, quiet hours, weekdays, holidays, minimum gap) is read or copied.
--
-- ORDER AND PAGING. Order: the lead's last outbound touch (the maximum occurred_at of its outbound touches) ascending, then the lead id. A keyset cursor (p_after_at, p_after_id), both null for the first page, both given
-- otherwise. At most p_limit candidates (1 to 50) are returned and at most p_scan_max leads (1 to 1000) are EXAMINED per call, so a long stretch of terminal leads cannot make one call slow; next_cursor is the last
-- EXAMINED lead when more leads follow, and null at the end. Invalid parameters are 22023. No new SQLSTATE.
--
-- PER CANDIDATE: lead_id, last_outbound_at, last_outbound_channel (email or whatsapp, the latest such touch; null when every outbound touch is a phone call), open_draft_id and open_draft_channel (the one waiting or
-- approved draft, newest first; null when none).
--
-- SECURITY DEFINER with an empty search_path: the role is proven first (the caller needs the member role, not table grants); nothing is written, no lock is taken, nothing is audited (a read, like followup_gate).
create function public.followup_due_candidates(p_tenant_id uuid, p_after_at timestamptz, p_after_id uuid, p_limit integer, p_scan_max integer) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c_terminal constant text[] := array['suppressed', 'replied', 'closed', 'max_touches'];
  v_pver    uuid;
  v_as      text;
  r         record;
  v_reason  text;
  v_items   jsonb := '[]'::jsonb;
  v_n       integer := 0;
  v_seen    integer := 0;
  v_more    boolean := false;
  v_last_at timestamptz;
  v_last_id uuid;
  v_ch      text;
  v_draft   record;
begin
  if auth.uid() is null or p_tenant_id is null
     or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.followup_deny();
  end if;
  if p_limit is null or p_limit not between 1 and 50 or p_scan_max is null or p_scan_max not between 1 and 1000
     or (p_after_at is null) is distinct from (p_after_id is null) then
    perform app.followup_error('invalid');
  end if;
  v_pver := app.followup_active_policy_version(p_tenant_id, app.quote_today());
  if v_pver is null then
    return jsonb_build_object('policy_in_force', false, 'items', '[]'::jsonb, 'next_cursor', null);
  end if;
  v_as := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  -- one row more than the scan cap is read: it is never examined, it only tells whether more leads follow
  for r in
    select o.lead_id, o.last_at
      from (select t.lead_id, max(t.occurred_at) as last_at
              from public.lead_touches t
             where t.tenant_id = p_tenant_id and t.direction = 'out'
             group by t.lead_id) o
      join public.leads l on l.tenant_id = p_tenant_id and l.id = o.lead_id
     where l.archived_at is null
       and (p_after_at is null or (o.last_at, o.lead_id) > (p_after_at, p_after_id))
     order by o.last_at, o.lead_id
     limit p_scan_max + 1
  loop
    if v_seen >= p_scan_max or v_n >= p_limit then
      v_more := true;
      exit;
    end if;
    v_seen := v_seen + 1;
    v_last_at := r.last_at;
    v_last_id := r.lead_id;
    if app.followup_stopped(r.lead_id) is not null then
      continue;
    end if;
    v_reason := app.followup_blocker(app.followup_build(r.lead_id, v_as, v_pver));
    if v_reason = any (c_terminal) then
      continue;
    end if;
    select t.channel::text into v_ch
      from public.lead_touches t
     where t.tenant_id = p_tenant_id and t.lead_id = r.lead_id and t.direction = 'out' and t.channel in ('email', 'whatsapp')
     order by t.occurred_at desc, t.id desc
     limit 1;
    select d.id, d.channel::text as channel into v_draft
      from public.followup_drafts d
     where d.tenant_id = p_tenant_id and d.lead_id = r.lead_id and d.status in ('draft', 'approved')
     order by d.created_at desc, d.id desc
     limit 1;
    v_items := v_items || jsonb_build_object('lead_id', r.lead_id, 'last_outbound_at', r.last_at, 'last_outbound_channel', v_ch,
                                             'open_draft_id', v_draft.id, 'open_draft_channel', v_draft.channel);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('policy_in_force', true, 'items', v_items,
                            'next_cursor', case when v_more then jsonb_build_object('at', v_last_at, 'id', v_last_id) else null end);
end;
$$;
revoke all on function public.followup_due_candidates(uuid, timestamptz, uuid, integer, integer) from public, anon;
grant execute on function public.followup_due_candidates(uuid, timestamptz, uuid, integer, integer) to authenticated;
