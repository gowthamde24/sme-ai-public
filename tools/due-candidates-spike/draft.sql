-- DRAFT of public.followup_due_candidates (docs/plans/followups-due-candidates-plan.md, slice C0).
-- Applied BY HAND to the LOCAL database by the opt-in spike test (tests/integration/test_followup_due_spike.py, DUE_SPIKE=1) to measure its cost, and dropped again. NOT a migration.
-- The C1 migration starts from this text. Option B: facts + app.followup_stopped + the database's own blocker, dropping only its four TERMINAL answers.
create or replace function public.followup_due_candidates(p_tenant_id uuid, p_after_at timestamptz, p_after_id uuid, p_limit integer, p_scan_max integer) returns jsonb
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
