-- "Talk to us" public form (migration 20261231991800): anyone may send, a repeat is recognised, nothing is read back but a reference, the worker marks, staff read, members do not.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');
create function pg_temp.at(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

select is(pg_temp.at('anon', $q$select (public.contact_submit('Ravi Kumar', '+91 98480 12345', null, 'Saree shop', 'after 6 pm', 'Silk sarees', '2026-11', '2026-11')) ->> 'status'$q$), 'received', 'A1: a stranger can send a message');
select is(pg_temp.at('anon', $q$select (public.contact_submit('Ravi Kumar', '+91 98480 12345', null, null, null, null, '2026-11', '2026-11')) ->> 'status'$q$), 'duplicate', 'A2: the same phone again within ten minutes is a duplicate');
select is(pg_temp.at('anon', $q$select (public.contact_submit('Other', null, 'Ravi@Example.com', null, null, null, '2026-11', '2026-11')) ->> 'status'$q$), 'received', 'A3: an e-mail alone is enough');
select is(pg_temp.at('anon', $q$select (public.contact_submit('Other', null, 'ravi@example.com', null, null, null, '2026-11', '2026-11')) ->> 'status'$q$), 'duplicate', 'A4: e-mail repeats are found in any case');
select is(pg_temp.at('anon', $q$select (public.contact_submit('No way', null, null, null, null, null, '2026-11', '2026-11'))::text$q$), 'ERR:22023', 'A5: a phone or an e-mail is needed');
select is(pg_temp.at('anon', $q$select (public.contact_submit('', '+919800000001', null, null, null, null, '2026-11', '2026-11'))::text$q$), 'ERR:22023', 'A6: a name is needed');
select is(pg_temp.at('anon', $q$select (public.contact_submit('Bad phone', 'abc', null, null, null, null, '2026-11', '2026-11'))::text$q$), 'ERR:23514', 'A7: a phone must look like one');
select is(pg_temp.at('anon', $q$select (public.contact_submit('X', '+919800000002', null, null, null, null, '2026-11', '2026-11')) ? 'name'$q$), 'false', 'A8: the answer never holds the person''s details');
select is((select count(*) from privacy.contact_requests), 3::bigint, 'A9: three messages stored');
select is((select reference ~ '^TQ-[0-9A-F]{8}$' from privacy.contact_requests limit 1), true, 'A10: a plain reference');

select is(pg_temp.at('a_owner', 'select public.scheduler_contact_due(10)::text'), 'ERR:42501', 'B1: a member cannot read the worker queue');
select is(pg_temp.at('anon', 'select public.scheduler_contact_due(10)::text'), 'ERR:42501', 'B2: nor a stranger');
select is((select jsonb_array_length(pg_temp.at('outsider', 'select public.scheduler_contact_due(10)::text')::jsonb)), 3, 'B3: the worker sees three waiting');
select is(pg_temp.at('outsider', 'select (public.scheduler_contact_due(10) -> 0) ? ''name''') , 'false', 'B4: the worker queue holds no personal detail');
select is(pg_temp.at('a_owner', format($q$select public.scheduler_contact_mark(%L)::text$q$, (select id from privacy.contact_requests limit 1))), 'ERR:42501', 'B5: a member cannot mark');
select pg_temp.at('outsider', format($q$select public.scheduler_contact_mark(%L)::text$q$, (select id from privacy.contact_requests order by created_at limit 1)));
select is((select count(*) from privacy.contact_requests where notified_at is not null), 1::bigint, 'B6: one marked');
select is((select jsonb_array_length(pg_temp.at('outsider', 'select public.scheduler_contact_due(10)::text')::jsonb)), 2, 'B7: and no longer offered');

select is(pg_temp.at('a_owner', 'select public.admin_contact_requests(10)::text') like 'ERR:%', true, 'C1: a workspace Owner is not staff and cannot read them');
select is(pg_temp.at('anon', 'select public.admin_contact_requests(10)::text') like 'ERR:%', true, 'C2: nor a stranger');
select is(has_table_privilege('authenticated', 'privacy.contact_requests', 'select') or has_table_privilege('anon', 'privacy.contact_requests', 'select'), false, 'C3: the table is closed');

update privacy.contact_requests set created_at = now() - interval '13 months' where reference = (select reference from privacy.contact_requests order by created_at limit 1);
select pg_temp.at('anon', $q$select (public.contact_submit('Later', '+919800000003', null, null, null, null, '2026-11', '2026-11'))::text$q$);
select is((select count(*) from privacy.contact_requests where created_at < now() - interval '12 months'), 0::bigint, 'D1: a message older than 12 months is removed');
select * from finish();
rollback;
