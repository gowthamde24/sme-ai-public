-- Today's "Needs you" for a construction business and a school (C2's requests on the owner's list, 4 Nov 2026). Three more kinds, added to the function as it stands (re-created from its own definition, the
-- way job DR's migration added two):
--   material_quote_approval   a DRAFT building-materials quote (public.material_quotes) waits for the Owner's or an Admin's OK: the customer, the quote number, the total (like quote_approval)
--   campaign_approval         a DRAFT message campaign (a school's fee reminder, a payment reminder, an event) waits for the OK: its name and kind
--   fees_overdue              ONE row for a school (the `fees` module): how many students have fees fallen due and unpaid, and how much in all. Counts and a total only: never a child's name (the
--                             child-data rule); the fee screen shows who
-- Owner and Admin only (like every approval). Nothing else in the function changes. today_summary runs as the CALLER: the two quotes and the campaigns are read under row-level security; the school's
-- dues come from the definer helper below, which answers only the caller's own workspace, only for its Owner and Admin, only with the `fees` module, and only a count and a total.

create function app.today_fees_overdue(p_tenant uuid) returns table (students integer, pending_paise bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer, coalesce(sum(d.pending_paise), 0)::bigint
    from app.edu_student_dues(p_tenant, (now() at time zone 'Asia/Kolkata')::date) d
   where app.has_tenant_role(p_tenant, array['owner', 'admin']::public.app_role[]) and app.module_enabled(p_tenant, 'fees') and d.pending_paise > 0
$$;
revoke all on function app.today_fees_overdue(uuid) from public;
grant execute on function app.today_fees_overdue(uuid) to authenticated;   -- today_summary runs as the caller; this answers the caller's own workspace and only for its Owner and Admin (counts, no names)

do $$
declare
  v_def text := pg_get_functiondef('public.today_summary(uuid)'::regprocedure);
  v_new text;
  v_marker constant text := E'      from jsonb_to_recordset(app.today_usage_items(p_tenant_id)) as u(kind text, id uuid, ref text, at timestamptz)\n     where v_decider\n  ), top as (';
begin
  if position(v_marker in v_def) = 0 then
    raise exception 'needs-you: the Today function is not the one this migration expects';
  end if;
  v_new := replace(v_def, v_marker, E'      from jsonb_to_recordset(app.today_usage_items(p_tenant_id)) as u(kind text, id uuid, ref text, at timestamptz)\n     where v_decider\n'
    || E'    union all\n'
    || E'    select ''material_quote_approval'', mq.id, c.name, c.city, ''quote_writer'', mq.quote_no::text, mq.total_paise, mq.created_at, ''material_quote'', mq.id\n'
    || E'      from public.material_quotes mq\n'
    || E'      left join public.leads l on l.tenant_id = mq.tenant_id and l.id = mq.lead_id\n'
    || E'      left join public.companies c on c.tenant_id = l.tenant_id and c.id = l.company_id\n'
    || E'     where v_decider and mq.tenant_id = p_tenant_id and mq.status = ''draft''\n'
    || E'    union all\n'
    || E'    select ''campaign_approval'', cp.id, cp.name, null::text, ''followup_desk'', cp.kind, null::bigint, cp.updated_at, ''campaign'', cp.id\n'
    || E'      from public.campaigns cp\n'
    || E'     where v_decider and cp.tenant_id = p_tenant_id and cp.status = ''draft''\n'
    || E'    union all\n'
    || E'    select ''fees_overdue'', p_tenant_id, null::text, null::text, ''followup_desk'', f.students::text, f.pending_paise, now(), ''fees'', p_tenant_id\n'
    || E'      from app.today_fees_overdue(p_tenant_id) f\n'
    || E'     where v_decider and f.students > 0\n'
    || E'  ), top as (');
  execute v_new;
end;
$$;
