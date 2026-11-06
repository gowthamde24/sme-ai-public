-- One timeline per customer (migration 20261231320000): a lead's calls, messages, follow-ups and outcomes, newest first, paged; read as the signed-in member, so another workspace sees nothing.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.kinds(p_user text, p_tenant text, p_lead uuid, p_before timestamptz default null, p_limit int default 50) returns text language plpgsql as $$
begin
  return tests.scalar_as(tests.uid(p_user), format($q$select coalesce(string_agg(x ->> 'kind', ',' order by ord), '') from jsonb_array_elements(public.customer_timeline(%L, %L, %L, %s)) with ordinality t(x, ord)$q$,
                         tests.tid(p_tenant), p_lead, p_before, p_limit));
exception when others then return 'ERR:' || sqlstate;
end $$;

insert into public.phone_calls (id, tenant_id, lead_id, contact_id, direction, provider, sandbox, purpose, language, ai_disclosed, state, end_reason, summary, answered_at, ended_at)
values (tests.rid('c1'), tests.tid('a'), tests.rid('a_lead'), tests.rid('a_contact'), 'inbound', 'exotel', true, 'inbound', 'te', true, 'completed', 'goodbye', 'Wants a red Kanchi silk, visiting Saturday',
        now() - interval '3 hours', now() - interval '3 hours' + interval '2 minutes');
insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at)
values (tests.rid('t1'), tests.tid('a'), tests.rid('a_lead'), tests.rid('a_contact'), 'out', 'whatsapp', now() - interval '1 hour');
insert into public.lead_arrivals (tenant_id, lead_id, contact_id, source_tag, kind, message, received_at)
values (tests.tid('a'), tests.rid('a_lead'), tests.rid('a_contact'), 'website_form', 'first', 'Do you have bridal sarees?', now() - interval '5 hours');

select is(pg_temp.kinds('a_owner', 'a', tests.rid('a_lead')), 'follow_up,call,arrival', 'A1 newest first: the follow-up, the call, how they arrived');
select is(tests.scalar_as(tests.uid('a_sales'), format($q$select public.customer_timeline(%L, %L) -> 1 ->> 'text'$q$, tests.tid('a'), tests.rid('a_lead'))), 'Wants a red Kanchi silk, visiting Saturday', 'A2 a call shows its short summary');
select is(tests.scalar_as(tests.uid('a_sales'), format($q$select public.customer_timeline(%L, %L) -> 1 -> 'target' ->> 'type'$q$, tests.tid('a'), tests.rid('a_lead'))), 'phone_call', 'A3 ... and where Open goes');
select is(pg_temp.kinds('a_owner', 'a', tests.rid('a_lead'), null, 1), 'follow_up', 'B1 a page of one');
select is(pg_temp.kinds('a_owner', 'a', tests.rid('a_lead'), now() - interval '2 hours'), 'call,arrival', 'B2 the next page: older than the last one seen');
select is(pg_temp.kinds('b_owner', 'a', tests.rid('a_lead')), '', 'C1 another workspace sees nothing (each table''s own rules)');
select is(pg_temp.kinds('a_owner', 'a', tests.rid('b_lead')), '', 'C2 nor another workspace''s customer');
select throws_ok(format($q$select tests.scalar_as(null, %L)$q$, format('select public.customer_timeline(%L, %L)::text', tests.tid('a'), tests.rid('a_lead'))), '42501', null, 'C3 nobody signed in: refused');

select * from finish();
rollback;
