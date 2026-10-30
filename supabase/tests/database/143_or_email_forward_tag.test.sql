-- Job OR (migration 20261224120000): the forwarding address has a source tag of its own, `email_forward`, so its leads read "Forwarded e-mail" and not "Webhook (Zapier, n8n)".
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.open_gate('a');
select app.operator_register_scheduler('Outsider@test.local');

create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.w(p_sql text) returns text language sql as $$ select pg_temp.val('outsider', p_sql) $$;
create function pg_temp.tid(p text) returns text language sql as $$ select quote_literal(tests.tid(p)) $$;
create function pg_temp.rid(p text) returns text language sql as $$ select quote_literal(tests.rid(p)) $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;

select ok(app.lead_tag_ok('email_forward'), 'A1: email_forward is a source tag');
select ok(app.lead_tag_ok('webhook') and app.lead_tag_ok('justdial') and app.lead_tag_ok('vcard'), 'A2: the older tags still are');
select ok(not app.lead_tag_ok('email') and not app.lead_tag_ok('') and not app.lead_tag_ok('unknown_tag'), 'A3: a word outside the list is not');

select is(pg_temp.val('a_owner', format($q$select (public.lead_source_create(%s, %s, 'email_forward', 'email_forward', 'Forwarded lead e-mails', %L, 'abcd', null, null, null) ->> 'created')$q$,
  pg_temp.tid('a'), pg_temp.rid('s1'), pg_temp.h('mail-token'))), 'true', 'B1: a forwarding address is created with its own tag');
select is((select tag from public.lead_sources where id = tests.rid('s1')), 'email_forward', 'B2: and the source keeps it');
select is(pg_temp.w(format($q$select public.scheduler_lead_intake_live(%L, '[{"name": "Test Buyer One", "phone": "+919822222222", "message": "40 sarees"}]'::jsonb)::text$q$, pg_temp.h('mail-token')))::jsonb ->> 'status', 'received', 'B3: a forwarded mail is received');
select is((select string_agg(distinct l.source, ',') from public.leads l join public.contacts c on c.id = l.contact_id and c.tenant_id = l.tenant_id where l.tenant_id = tests.tid('a') and c.full_name = 'Test Buyer One'), 'email_forward', 'B4: the lead is marked as coming from the forwarding address');
select is((select string_agg(distinct source_tag, ',') from public.lead_arrivals where tenant_id = tests.tid('a')), 'email_forward', 'B5: and so is its arrival');
select * from finish();
rollback;
