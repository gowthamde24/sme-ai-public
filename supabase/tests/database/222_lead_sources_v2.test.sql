-- Migration 20261231890000 (Track D slice 1): test leads (is_test), the Test button's finish, a source that can be 'disconnected', the website address that can be forgotten, the cards' counts without test leads and with a
-- total, and the Leads badge that counts OPEN leads only.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;

select is((select is_test from public.leads where id = tests.rid('a_lead')), false, 'A1: a lead is not a test by default');

-- a test lead made a moment ago: its contact has a +00 test number
update public.contacts set phone = '+00 99999 12345' where id = (select contact_id from public.leads where id = tests.rid('a_lead'));
update public.leads set created_at = now() where id = tests.rid('a_lead');
select is(pg_temp.val('a_sales', format($q$select public.lead_source_test_finish(%L, '+00 99999 12345')::text$q$, tests.tid('a'))), 'ERR:42501', 'B1: Sales cannot finish a test');
select is(pg_temp.val('b_owner', format($q$select public.lead_source_test_finish(%L, '+00 99999 12345')::text$q$, tests.tid('a'))), 'ERR:42501', 'B2: nor another business');
select is(pg_temp.val('a_owner', format($q$select public.lead_source_test_finish(%L, '+91 98765 43210')::text$q$, tests.tid('a'))), 'ERR:22023', 'B3: only a +00 test number can be marked');
select is((pg_temp.val('a_owner', format($q$select public.lead_source_test_finish(%L, '+00 99999 12345')::text$q$, tests.tid('a')))::jsonb) ->> 'lead_id', tests.rid('a_lead')::text, 'B4: the owner marks the lead the test just made');
select is((select is_test from public.leads where id = tests.rid('a_lead')), true, 'B5: and it is a test lead');
select is((pg_temp.val('a_owner', format($q$select public.lead_source_test_finish(%L, '+00 99999 55555')::text$q$, tests.tid('a')))::jsonb) ->> 'lead_id', null, 'B6: a number nobody has used says no lead');

-- a source can be disconnected
insert into public.lead_sources (id, tenant_id, kind, tag, label, token_hash, token_hint, created_by) values
  (tests.rid('a_form'), tests.tid('a'), 'website_form', 'website_form', 'Website', repeat('b', 64), 'abcd', tests.uid('a_owner'));
select is((pg_temp.val('a_owner', format($q$select public.lead_source_set_status(%L, %L, 'disconnected')::text$q$, tests.tid('a'), tests.rid('a_form')))::jsonb) ->> 'status', 'disconnected', 'C1: the owner disconnects a source');
select is(pg_temp.val('a_owner', format($q$select public.lead_source_set_status(%L, %L, 'gone')::text$q$, tests.tid('a'), tests.rid('a_form'))), 'ERR:22023', 'C2: no other word');
select is(pg_temp.val('a_owner', format($q$select public.lead_website_form_set(%L, %L, 'abcdefghijklmnopqrstuvwx')::text$q$, tests.tid('a'), tests.rid('a_form'))) like '%abcdefghijklmnopqrstuvwx%', true, 'C3: an address was shown');
select is(pg_temp.val('a_sales', format($q$select public.lead_website_form_clear(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'C4: Sales cannot forget it');
select is((pg_temp.val('a_owner', format($q$select public.lead_website_form_clear(%L)::text$q$, tests.tid('a')))::jsonb) ->> 'cleared', 'true', 'C5: the owner forgets it');
select is((select count(*) from public.lead_website_forms where tenant_id = tests.tid('a')), 0::bigint, 'C6: and it is gone');

-- the cards' numbers leave a test lead out and carry a total
insert into public.lead_arrivals (tenant_id, lead_id, contact_id, source_tag, kind) select tenant_id, id, contact_id, 'website_form', 'first' from public.leads where id = tests.rid('a_lead');
select is((pg_temp.val('a_owner', format($q$select public.lead_source_cards_stats(%L)::text$q$, tests.tid('a')))::jsonb) #>> '{by_tag,website_form}', null, 'D1: the test lead is not counted on the cards');
update public.leads set is_test = false where id = tests.rid('a_lead');
select is((pg_temp.val('a_owner', format($q$select public.lead_source_cards_stats(%L)::text$q$, tests.tid('a')))::jsonb) #>> '{by_tag,website_form,total}', '1', 'D2: a real lead is counted, with a total');
select is((pg_temp.val('a_owner', format($q$select public.lead_source_cards_stats(%L)::text$q$, tests.tid('a')))::jsonb) #>> '{by_tag,website_form,received_7d}', '1', 'D3: and in the last seven days');

-- the Leads badge: open leads only
update public.leads set status = 'new', archived_at = null, created_at = now() where id = tests.rid('a_lead');
select is(pg_temp.val('a_owner', format($q$select (public.nav_counts(%L) ->> 'new_leads')$q$, tests.tid('a')))::int >= 1, true, 'E1: a new lead counts');
update public.leads set status = 'qualified' where id = tests.rid('a_lead');
select is(pg_temp.val('a_owner', format($q$select (select count(*) from public.leads l where l.tenant_id = %L and l.id = %L and l.status in ('new', 'in_review'))::text$q$, tests.tid('a'), tests.rid('a_lead'))), '0', 'E2: a qualified lead is not open');
select is(pg_temp.val('a_owner', format($q$select (public.nav_counts(%L) ->> 'new_leads')$q$, tests.tid('a')))::int, (select count(*)::int from public.leads l where l.tenant_id = tests.tid('a') and l.archived_at is null and not l.is_test and l.status in ('new', 'in_review') and l.created_at >= now() - interval '7 days'
   and not exists (select 1 from public.lead_profiles lp where lp.lead_id = l.id and (lp.junk_reason is not null or tests.uid('a_owner') = any (coalesce(lp.opened_by, '{}'::uuid[]))))), 'E3: the badge is the open leads that arrived this week and are not opened, not junk and not test');
select * from finish();
rollback;
