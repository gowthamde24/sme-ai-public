-- The sidebar's counts in ONE read (docs/contracts/nav-counts.md; owner, 5 Nov 2026: "one cheap endpoint ... cached ~30 s, RLS as usual"). READ ONLY: no table, no column, nothing written.
-- SECURITY DEFINER because several sources are definer-only helpers (app.module_enabled, app.entitled, app.billing_*, the AI month); every count is therefore filtered HERE by the caller's role and the
-- workspace, exactly as the screen that shows it would: a field the caller may not see, or a part the workspace does not have, is NULL ("draw no badge"); 0 means "known, none".

create function public.nav_counts(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_owner  boolean;
  v_admin  boolean;   -- Owner or Admin
  v_writer boolean;   -- Owner, Admin or Sales
  v_today  date := app.quote_today();   -- the India date
  v_needs  integer;
  v_out    jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_owner  := app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]);
  v_admin  := app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]);
  v_writer := app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);

  -- Today's own number (its role rules inside); the Lead Finder's prospects are NOT in it (the web adds them)
  v_needs := ((public.today_summary(p_tenant_id) -> 'cards' ->> 'waiting'))::integer;

  v_out := jsonb_build_object(
    'needs_you', v_needs,

    'prospects_needing_owner', case when v_writer and app.module_enabled(p_tenant_id, 'lead_finder') and app.entitled(p_tenant_id, 'lead_finder') then
        (select count(*) from public.prospects p where p.tenant_id = p_tenant_id and p.status = 'needs_owner' and (p.ask_after is null or p.ask_after <= now()))::integer end,

    -- arrived in the last 7 days, not archived, not junk, and THIS person has not opened it (lead_profiles.opened_by: POST /leads/{id}/seen)
    'new_leads', case when v_writer then
        (select count(*) from public.leads l
           left join public.lead_profiles lp on lp.tenant_id = l.tenant_id and lp.lead_id = l.id
          where l.tenant_id = p_tenant_id and l.archived_at is null and l.created_at >= now() - interval '7 days'
            and (lp.id is null or (lp.junk_reason is null and not (auth.uid() = any (coalesce(lp.opened_by, '{}'::uuid[])))))
        )::integer end,

    'live_calls', case when v_writer then
        (select count(*) from public.phone_calls c where c.tenant_id = p_tenant_id and c.state in ('queued', 'ringing', 'in_progress') and c.ended_at is null
            and c.created_at >= now() - interval '1 day')::integer end,

    -- a WhatsApp conversation whose last inbound message is newer than the workspace's read mark (the rule of conversation_list)
    'unread_chats', case when v_writer then
        (select count(*) from (
            select e.lead_id, max(e.received_at) as last_in from public.enquiries e
             where e.tenant_id = p_tenant_id and e.channel = 'whatsapp' and e.lead_id is not null group by e.lead_id) x
           join public.leads l on l.tenant_id = p_tenant_id and l.id = x.lead_id and l.archived_at is null
           join public.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id and c.erased_at is null
           left join integrations.wa_conversation_state s on s.tenant_id = p_tenant_id and s.lead_id = x.lead_id
          where x.last_in > coalesce(s.last_read_at, '-infinity'::timestamptz))::integer end,

    -- follow-up drafts waiting for a decision (the honest database count: the due list itself runs the cadence engine in the API); capped at 99, the web shows "99+"
    'followups_due', case when v_writer then
        least(99, (select count(*) from public.followup_drafts d where d.tenant_id = p_tenant_id and d.status = 'draft'))::integer end,

    'visits_today', case when app.module_enabled(p_tenant_id, 'visits') then
        (select count(*) from public.store_visits v where v.tenant_id = p_tenant_id and v.visit_date = v_today and v.status in ('booked', 'confirmed', 'arrived'))::integer end,

    'quotes_waiting', case when v_admin and (app.module_enabled(p_tenant_id, 'quotes') or app.module_enabled(p_tenant_id, 'materials')) then
        ((case when app.module_enabled(p_tenant_id, 'quotes') then (select count(*) from public.quotes q where q.tenant_id = p_tenant_id and q.status = 'draft') else 0 end)
         + (case when app.module_enabled(p_tenant_id, 'materials') then (select count(*) from public.material_quotes m where m.tenant_id = p_tenant_id and m.status = 'draft') else 0 end))::integer end,

    -- helpers busy right now: agent runs (the Owner and an Admin see everyone's, others their own, as RLS), tasks and calling plans running, Lead Finder searches under way
    'ai_team_working',
        ((select count(*) from public.agent_runs r where r.tenant_id = p_tenant_id and r.status = 'running' and r.expires_at > now() and (v_admin or r.started_by = auth.uid()))
         + (select count(*) from public.tasks t where t.tenant_id = p_tenant_id and t.status = 'running')
         + (case when v_admin then (select count(*) from public.outreach_batches b where b.tenant_id = p_tenant_id and b.status = 'running') else 0 end)
         + (case when v_writer then (select count(*) from public.prospect_searches ps where ps.tenant_id = p_tenant_id and ps.state = 'approved') else 0 end))::integer,

    -- this billing period's call minutes (top-ups included; total null = no ceiling, pay as you go)
    'call_minutes', case when v_admin then
        jsonb_build_object('used', round(coalesce(app.billing_used(p_tenant_id, 'call_minutes'), 0) / 60.0)::integer,
                           'total', (select (a / 60)::integer from (select app.billing_allowance(p_tenant_id, 'call_minutes') as a) z)) end,

    -- this month's AI spend and allowance in paise (owner, 5 Nov 2026: shown in the sidebar's meter; Owner and Admin only)
    'ai_usage', case when v_admin then
        jsonb_build_object('used_paise', round(coalesce(app.agent_month_spend(p_tenant_id), 0) / 10000.0)::bigint,
                           'allowance_paise', (select (a / 10000)::bigint from (select app.ai_monthly_allowance(p_tenant_id) as a) z),
                           'period', 'month') end,

    'plan', (select t.plan from public.tenants t where t.id = p_tenant_id),
    'as_of', now()
  );
  return v_out;
end;
$$;
revoke all on function public.nav_counts(uuid) from public, anon;
grant execute on function public.nav_counts(uuid) to authenticated;
comment on function public.nav_counts(uuid) is 'The sidebar''s counts in one read (docs/contracts/nav-counts.md): each field filtered by the caller''s role and the workspace''s parts; NULL = not known or not for you.';
