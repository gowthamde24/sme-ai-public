-- Job EK (migration 20261221090000): the website form. The form token that can be shown again (who may read and set it, only for the workspace's own website source, unique everywhere) and the
-- numbers on the cards (arrivals of the last 7 days by source tag, the WhatsApp connection), owner and admin only.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.get(p_user text, p_tenant text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.lead_website_form_get(%L)::text$q$, tests.tid(p_tenant))) $$;
create function pg_temp.set(p_user text, p_tenant text, p_source text, p_token text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select (public.lead_website_form_set(%L, %L, %L) ->> 'token')$q$, tests.tid(p_tenant), tests.rid(p_source), p_token)) $$;

insert into public.lead_sources (id, tenant_id, kind, tag, label, token_hash, token_hint, created_by) values
  (tests.rid('a_site'), tests.tid('a'), 'website_form', 'website_form', 'Website form', repeat('a', 64), 'wxyz', tests.uid('a_owner')),
  (tests.rid('a_other'), tests.tid('a'), 'email_forward', 'webhook', 'Mail', repeat('b', 64), 'abcd', tests.uid('a_owner')),
  (tests.rid('b_site'), tests.tid('b'), 'website_form', 'website_form', 'Website form', repeat('c', 64), 'efgh', tests.uid('b_owner'));

-- ---- the form token
select is((pg_temp.get('a_owner', 'a')::jsonb) ->> 'token', null, 'before any form: no token');
select is(pg_temp.get('a_sales', 'a'), 'ERR:42501', 'DENY: Sales cannot read the address');
select is(pg_temp.get('a_viewer', 'a'), 'ERR:42501', 'DENY: a Viewer');
select is(pg_temp.get('b_owner', 'a'), 'ERR:42501', 'DENY: another business');
select is(pg_temp.set('a_owner', 'a', 'a_site', 'abcdefghijklmnopqrstuvwx'), 'abcdefghijklmnopqrstuvwx', 'ALLOW: the owner records the token of the website source');
select is((pg_temp.get('a_admin', 'a')::jsonb) ->> 'token', 'abcdefghijklmnopqrstuvwx', '...an Admin reads it back');
select is(pg_temp.set('a_owner', 'a', 'a_site', '0123456789abcdefghijklmn'), '0123456789abcdefghijklmn', 'a rotation replaces it');
select is((pg_temp.get('a_owner', 'a')::jsonb) ->> 'token', '0123456789abcdefghijklmn', '...and only the new one is kept');
select isnt((pg_temp.get('a_owner', 'a')::jsonb) ->> 'rotated_at', null, '...with the time it was rotated');
select is((select count(*) from public.lead_website_forms where tenant_id = tests.tid('a')), 1::bigint, 'one address per workspace');
select is(pg_temp.set('a_owner', 'a', 'a_other', 'zzzzzzzzzzzzzzzzzzzzzzzz'), 'ERR:22023', 'DENY: a source that is not the website source');
select is(pg_temp.set('a_owner', 'a', 'b_site', 'yyyyyyyyyyyyyyyyyyyyyyyy'), 'ERR:22023', 'DENY: another business''s source');
select is(pg_temp.set('a_owner', 'a', 'a_site', 'SHORT'), 'ERR:22023', 'DENY: a token of the wrong shape');
select is(pg_temp.set('a_owner', 'a', 'a_site', 'ABCDEFGHIJKLMNOPQRSTUVWX'), 'ERR:22023', 'DENY: capital letters (mail systems may change case)');
select is(pg_temp.set('a_sales', 'a', 'a_site', 'xxxxxxxxxxxxxxxxxxxxxxxx'), 'ERR:42501', 'DENY: Sales cannot set it');
select is(pg_temp.set('anon', 'a', 'a_site', 'xxxxxxxxxxxxxxxxxxxxxxxx'), 'ERR:42501', 'DENY: no identity');
select is(pg_temp.set('b_owner', 'b', 'b_site', '0123456789abcdefghijklmn'), 'ERR:23505', 'a token already in use anywhere is refused (unique)');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$insert into public.lead_website_forms (tenant_id, source_id, token) values (%L, %L, 'qqqqqqqqqqqqqqqqqqqqqqqq')$$, tests.tid('b'), tests.rid('b_site'))), '42501', 'DENY: no client writes the table directly');
select is(tests.rows_as(tests.uid('a_owner'), 'select 1 from public.lead_website_forms'), 1::bigint, 'the owner reads their own row');
select is(tests.rows_as(tests.uid('a_sales'), 'select 1 from public.lead_website_forms'), 0::bigint, '...Sales reads none');
select is(tests.rows_as(tests.uid('b_owner'), 'select 1 from public.lead_website_forms'), 0::bigint, '...and another business none');

select * from finish();
rollback;
