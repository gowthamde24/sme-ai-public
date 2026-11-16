-- Migration 20261231979700: the name Meta knows a template by (`meta_name`), when Meta already holds the template's own name in that language.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin('2026-11-12T14:00:00+05:30');
create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
select app.operator_register_channel_agent('x6@test.local');
select pg_temp.sc('a_owner', format($q$select public.whatsapp_account_save(%L, '200000000000001', '100000000000001', '+91 98765 43210', true, 'shop_a')$q$, tests.tid('a')));
select pg_temp.sc('a_owner', format($q$select public.whatsapp_account_set_status(%L, 'active')$q$, tests.tid('a')));
create temp table mn as select (pg_temp.sc('x6', format($q$select public.wa_ingest_inbound('100000000000001', 'wamid.N1', '0091234567841', 'Kavitha Gowda', 'text', 'Hello', '2026-11-12T14:00:00+05:30', %L, 1, false)::text$q$, pg_temp.h('0091234567841')))::jsonb) as r;
update public.platform_flags set enabled = true where key = 'outbox_enabled';
create function pg_temp.save(p_id text, p_name text, p_lang text, p_meta text) returns text language sql as $$
  select pg_temp.sc('a_owner', format($q$select public.wa_template_save(%L, %L, %L, %L, 'utility', 'info', 'Hello {{1}}, this is {{2}} with a short note for you.', null, %L)::text$q$, tests.rid(p_id), tests.tid('a'), p_name, p_lang, p_meta)) $$;

select is(pg_temp.j(pg_temp.save('t1', 'missed_call_followup', 'en', 'missed_call_followup_v2'), 'meta_name'), 'missed_call_followup_v2', 'A1 a template can be known to Meta under another name');
select is(pg_temp.j(pg_temp.save('t2', 'plain_note', 'en', null), 'meta_name'), null, 'A2 without one, Meta knows it by its own name');
select is(pg_temp.save('t3', 'other_note', 'en', 'Bad Name'), 'ERR:22023', 'A3 the name is lower-case letters, digits and underscores');
select is(pg_temp.save('t4', 'third_note', 'en', 'missed_call_followup_v2'), 'ERR:23505', 'A4 two templates of one business cannot share a Meta name in one language');
select is(pg_temp.j(pg_temp.save('t5', 'third_note', 'te', 'missed_call_followup_v2'), 'language'), 'te', 'A5 ... but another language can');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'wa_template_save'), 1::bigint, 'A6 one wa_template_save');

-- the sender names the template as Meta knows it
select pg_temp.sc('a_owner', format($q$select public.wa_template_set_status(%L, %L, 'submitted')$q$, tests.tid('a'), tests.rid('t1')));
select pg_temp.sc('a_owner', format($q$select public.wa_template_set_status(%L, %L, 'approved')$q$, tests.tid('a'), tests.rid('t1')));
select pg_temp.sc('a_owner', format($q$select public.outbox_submit(%L, %L, %L, 'whatsapp', 'We tried to call you.', 'en', 'info', 'system')::text$q$, tests.rid('m1'), tests.tid('a'), (select r ->> 'lead_id' from mn)::uuid));
select is(app.wa_send_context((select m from public.outbox_messages m where m.id = tests.rid('m1')), '2026-11-15T14:00:00+05:30') -> 'template' ->> 'name', 'missed_call_followup_v2', 'B1 the send call names the template by its Meta name');
select pg_temp.sc('a_owner', format($q$select public.wa_template_set_status(%L, %L, 'disabled')$q$, tests.tid('a'), tests.rid('t1')));
select pg_temp.sc('a_owner', format($q$select public.wa_template_set_status(%L, %L, 'submitted')$q$, tests.tid('a'), tests.rid('t2')));
select pg_temp.sc('a_owner', format($q$select public.wa_template_set_status(%L, %L, 'approved')$q$, tests.tid('a'), tests.rid('t2')));
select is(app.wa_send_context((select m from public.outbox_messages m where m.id = tests.rid('m1')), '2026-11-15T14:00:00+05:30') -> 'template' ->> 'name', 'plain_note', 'B2 a template without a Meta name is named as before');

select * from finish();
rollback;
