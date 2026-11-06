-- My AI team v2, T1 (migration 20261231240000): the day view. A1: every mark is a real row; the ⚑ marks of today equal Today's "Needs you" count for the same person (cards.waiting, without the
-- top-up items, which belong to no helper), plus the Lead Finder businesses waiting for the Owner. Roles: Owner, Admin, Sales read; a Viewer and another workspace do not. A past day has no ⚑.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.cn_guards_off();

-- real rows of every kind the helpers record, through the registry's own inserts (tenant a)
do $$
declare
  r record;
begin
  for r in select * from tests.tenant_table_registry
            where table_name in ('quotes', 'followup_drafts', 'outbox_messages', 'call_requests', 'store_visits', 'campaigns', 'lead_arrivals', 'outreach_handoffs', 'phone_calls', 'prospects',
                                 'order_events', 'material_quotes', 'prospect_searches', 'outreach_batches', 'admission_events', 'marks_send_log', 'ledger_entries')
            order by table_name loop
    execute format(r.insert_sql, tests.tid('a'), gen_random_uuid(), tests.rid('a_company'), tests.rid('a_contact'), tests.pool_uid(1));
  end loop;
end $$;
-- make some of them wait for a person, as the app would
update public.phone_calls set end_reason = 'handover', handled_at = null, created_at = now() - interval '1 hour' where tenant_id = tests.tid('a');
update public.outbox_messages set status = 'needs_approval' where tenant_id = tests.tid('a');
update public.prospects set status = 'needs_owner', ask_after = null where tenant_id = tests.tid('a');

create function pg_temp.day(p_user text, p_date date default (now() at time zone 'Asia/Kolkata')::date) returns jsonb language plpgsql as $$
begin
  perform tests.as_aal('aal2');
  return tests.scalar_as(tests.uid(p_user), format($q$select public.ai_team_day(%L, %L)::text$q$, tests.tid('a'), p_date))::jsonb;
end $$;
create function pg_temp.err(p_user text, p_tenant text, p_date date) returns text language plpgsql as $$
begin
  perform tests.as_aal('aal2');
  perform tests.scalar_as(tests.uid(p_user), format($q$select public.ai_team_day(%L, %L)::text$q$, tests.tid(p_tenant), p_date));
  return 'ok';
exception when others then return sqlstate;
end $$;
create function pg_temp.needs_you(p_user text) returns integer language plpgsql as $$
declare
  ts jsonb;
begin
  perform tests.as_aal('aal2');
  ts := tests.scalar_as(tests.uid(p_user), format($q$select public.today_summary(%L)::text$q$, tests.tid('a')))::jsonb;
  return (ts -> 'cards' ->> 'waiting')::integer
       - (select count(*) from jsonb_array_elements(coalesce(ts -> 'items', '[]'::jsonb)) e where e ->> 'kind' in ('topup_low', 'topup_empty'))::integer
       + case when p_user like '%owner' or p_user like '%admin' or p_user like '%sales' then
           (select count(*) from public.prospects p where p.tenant_id = tests.tid('a') and p.status = 'needs_owner' and (p.ask_after is null or p.ask_after <= now()))::integer else 0 end;
end $$;
create function pg_temp.flags(d jsonb) returns integer language sql as $$ select count(*)::integer from jsonb_array_elements(d -> 'marks') m where (m ->> 'needs')::boolean $$;

select ok(jsonb_array_length(pg_temp.day('a_owner') -> 'marks') > 0, 'A1 the Owner''s day has marks');
select is(pg_temp.flags(pg_temp.day('a_owner')), pg_temp.needs_you('a_owner'), 'A2 the Owner''s ⚑ marks == Needs you (+ Lead Finder waiting)');
select is(pg_temp.flags(pg_temp.day('a_admin')), pg_temp.needs_you('a_admin'), 'A3 ... the Admin''s too');
select is(pg_temp.flags(pg_temp.day('a_sales')), pg_temp.needs_you('a_sales'), 'A4 ... and Sales'' (the role gates are Today''s)');
select ok(pg_temp.flags(pg_temp.day('a_owner')) >= 3, 'A5 the fixture really has waiting items (a call, a message, a business)');

-- every mark is a real row of its table
create function pg_temp.real(p_id text) returns boolean language plpgsql as $$
declare
  v_table text := case split_part(p_id, ':', 1)
    when 'lead_arrival' then 'lead_arrivals' when 'prospect_search' then 'prospect_searches' when 'prospect' then 'prospects' when 'phone_call' then 'phone_calls'
    when 'call_request' then 'call_requests' when 'outreach_batch' then 'outreach_batches' when 'store_visit' then 'store_visits' when 'outbox_message' then 'outbox_messages'
    when 'followup_draft' then 'followup_drafts' when 'outreach_handoff' then 'outreach_handoffs' when 'quote' then 'quotes' when 'quote_approved' then 'quotes'
    when 'material_quote' then 'material_quotes' when 'order_event' then 'order_events' when 'order' then 'orders' when 'admission_event' then 'admission_events'
    when 'ledger_entry' then 'ledger_entries' when 'marks_send' then 'marks_send_log' when 'campaign' then 'campaigns' end;
  v_ok boolean;
begin
  if split_part(p_id, ':', 1) = 'fees_overdue' then
    return true;
  end if;
  if v_table is null then
    return false;
  end if;
  execute format('select exists (select 1 from public.%I where tenant_id = %L and id = %L)', v_table, tests.tid('a'), split_part(p_id, ':', 2)) into v_ok;
  return v_ok;
end $$;
select is((select coalesce(string_agg(m ->> 'id', ', '), '') from jsonb_array_elements(pg_temp.day('a_owner') -> 'marks') m where not pg_temp.real(m ->> 'id')), '', 'B1 every mark is a real row');
select is((select count(*)::integer from jsonb_array_elements(pg_temp.day('a_owner') -> 'marks') m where m ->> 'helper' not in ('lead_catcher', 'lead_finder', 'caller', 'followups', 'quote_writer', 'order_desk', 'admissions', 'fee_reminders', 'notices')),
          0, 'B2 every mark belongs to a helper of the closed list');

-- roles and dates
select is(pg_temp.err('a_viewer', 'a', (now() at time zone 'Asia/Kolkata')::date), '42501', 'C1 a Viewer does not read the day');
select is(pg_temp.err('b_owner', 'a', (now() at time zone 'Asia/Kolkata')::date), '42501', 'C2 nor another workspace''s Owner');
select is(pg_temp.err('a_owner', 'a', (now() at time zone 'Asia/Kolkata')::date + 1), '22023', 'C3 not a future day');
select is(pg_temp.err('a_owner', 'a', (now() at time zone 'Asia/Kolkata')::date - 32), '22023', 'C4 at most 31 days back');
select is(pg_temp.flags(pg_temp.day('a_owner', (now() at time zone 'Asia/Kolkata')::date - 1)), 0, 'C5 a past day has no ⚑ (what waits is today''s)');
select is(pg_temp.day('a_sales') -> 'cost', 'null'::jsonb, 'C6 Sales sees no cost');
select ok(pg_temp.day('a_owner') -> 'cost' ? 'calls_paise', 'C7 the Owner sees the cost');
select is(jsonb_array_length(pg_temp.day('a_owner') -> 'flow' -> 'steps'), 5, 'C8 the flow strip: five steps for a business');

select * from finish();
rollback;
