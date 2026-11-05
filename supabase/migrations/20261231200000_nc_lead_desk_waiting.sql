-- nav-counts: Lead Desk's own waiting rows (C2, 5 Nov 2026: the sidebar's Today badge said 52 while Today showed 53). Today's screen adds Lead Desk rows that cards.waiting does not count; nav_counts
-- now counts them as `lead_desk_waiting`, with the SAME rules as the screen (apps/web lead-desk-today.ts):
--   a calling plan (outreach_batches 'planned') or an "ask the assistant" task ('planned') waiting for the Owner's approval      -> the Owner
--   callbacks due (a batch with an item waiting for a call after a connected attempt, whose time has come; one row per batch)   -> the Owner and Admins
--   a standing rule or a task paused at its limit (Today counts only paused BATCHES)                                             -> the Owner and Admins
--   a hot lead whose reminder has not gone yet (Today counts a hot lead once its reminder went)                                  -> the Owner, Admins, and Sales for their own
-- The badge = needs_you + lead_desk_waiting + prospects_needing_owner. Everything else in nav_counts is unchanged.
do $do$
declare
  v_def text := pg_get_functiondef('public.nav_counts(uuid)'::regprocedure);
  v_anchor text := '    ''plan'', (select t.plan from public.tenants t where t.id = p_tenant_id),';
begin
  if position(v_anchor in v_def) = 0 or position('lead_desk_waiting' in v_def) > 0 then
    raise exception 'nc_lead_desk_waiting: nav_counts is not the one this migration expects';
  end if;
  execute replace(v_def, v_anchor, '    ''lead_desk_waiting'',
        (case when v_owner then (select count(*) from public.outreach_batches b where b.tenant_id = p_tenant_id and b.status = ''planned'')
                              + (select count(*) from public.tasks k where k.tenant_id = p_tenant_id and k.status = ''planned'') else 0 end)
      + (case when v_admin then (select count(distinct i.batch_id) from public.outreach_items i where i.tenant_id = p_tenant_id and i.batch_id is not null and i.status = ''waiting''
                                   and i.next_action = ''call'' and i.attempts >= 1 and i.last_result = ''connected'' and i.next_at <= now())
                              + (select count(*) from public.outreach_rules r where r.tenant_id = p_tenant_id and not r.active and r.paused_reason in (''cap_calls'', ''cap_minutes''))
                              + (select count(*) from public.tasks k where k.tenant_id = p_tenant_id and k.status = ''paused'' and k.pause_reason = ''cap'') else 0 end)
      + (case when v_writer then (select count(*) from public.outreach_handoffs h where h.tenant_id = p_tenant_id and h.acted_at is null and h.reminder_sent_at is null
                                   and (v_admin or h.assigned_to = auth.uid())) else 0 end),
' || v_anchor);
end
$do$;
