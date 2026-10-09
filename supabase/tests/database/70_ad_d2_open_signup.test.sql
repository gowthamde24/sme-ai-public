-- Job AD / D2: open sign-up. Terms recorded by a trigger, the account's "what is left to do", and complete_setup (one business, once).
begin;
select no_plan();
select tests.seed_two_tenants();

-- a sign-up, as GoTrue would insert it: p_confirmed says whether the e-mail was confirmed, the rest is the sign-up's metadata
create function pg_temp.mk(p_name text, p_confirmed boolean, p_meta jsonb) returns uuid language plpgsql as $$
begin
  insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_user_meta_data, created_at, updated_at)
  values (tests.uid(p_name), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_name || '@signup.test',
          case when p_confirmed then now() end, p_meta, now(), now());
  return tests.uid(p_name);
end $$;

select pg_temp.mk('ok1',        true,  '{"display_name":"Asha","business_name":"Sri Lakshmi Silks","terms_version":"draft-1"}');
select pg_temp.mk('ok2',        true,  '{"display_name":"Ravi","business_name":"Sri Lakshmi Silks","terms_version":"draft-1"}');
select pg_temp.mk('telugu',     true,  jsonb_build_object('business_name', 'శ్రీ లక్ష్మి', 'terms_version', 'draft-1'));
select pg_temp.mk('unconf',     false, '{"business_name":"Late Co","terms_version":"draft-1"}');
select pg_temp.mk('noterms',    true,  '{"business_name":"No Terms Co"}');
select pg_temp.mk('badterms',   true,  '{"business_name":"Bad Terms Co","terms_version":"DROP TABLE; --"}');
select pg_temp.mk('noname',     true,  '{"terms_version":"draft-1"}');
select pg_temp.mk('longname',   true,  jsonb_build_object('business_name', repeat('x', 121), 'terms_version', 'draft-1'));
select pg_temp.mk('owner_already', true, '{"business_name":"Second Try Co","terms_version":"draft-1"}');
select pg_temp.mk('invited',    true,  '{}');

-- ---- terms
select is((select terms_version from public.terms_acceptances where user_id = tests.uid('ok1')), 'draft-1', 'the sign-up recorded the terms version');
select ok((select accepted_at from public.terms_acceptances where user_id = tests.uid('ok1')) between now() - interval '1 minute' and now() + interval '1 minute',
  'and the time is the database''s');
select is((select count(*) from public.terms_acceptances where user_id in (tests.uid('noterms'), tests.uid('badterms'), tests.uid('invited'))), 0::bigint,
  'a sign-up without terms, or with a malformed version, records nothing (and was not blocked)');
select is((select count(*) from public.users where id in (tests.uid('noterms'), tests.uid('badterms'))), 2::bigint, 'the profile rows were made as before');
select is((select display_name from public.users where id = tests.uid('ok1')), 'Asha', 'the name typed at sign-up is the display name');

-- ---- both tables: RLS forced, user-owned (no tenant_id), a client reads only its own row and writes nothing
select is((select count(*) from pg_class where relname in ('terms_acceptances', 'account_setups') and relrowsecurity and relforcerowsecurity), 2::bigint, 'RLS is enabled and forced on both tables');
select is((select count(*) from information_schema.columns where table_schema = 'public' and table_name in ('terms_acceptances', 'account_setups') and column_name = 'tenant_id'),
  0::bigint, 'they are user-owned, not tenant-owned');
select is(tests.rows_as(tests.uid('ok1'), 'select 1 from public.terms_acceptances'), 1::bigint, 'a person reads only their own terms row');
select is(tests.rows_as(tests.uid('ok1'), format($$select 1 from public.terms_acceptances where user_id = %L$$, tests.uid('ok2'))), 0::bigint, 'and not someone else''s');
select is(tests.sqlstate_as(tests.uid('ok1'), format($$insert into public.terms_acceptances (user_id, terms_version) values (%L, 'draft-1')$$, tests.uid('invited'))), '42501', 'DENY: a client cannot write a terms row');
select is(tests.sqlstate_as(tests.uid('ok1'), $$update public.terms_acceptances set terms_version = 'draft-2'$$), '42501', 'DENY: a client cannot change the terms row');
select is(tests.sqlstate_as(tests.uid('ok1'), $$delete from public.terms_acceptances$$), '42501', 'DENY: a client cannot delete the terms row');
select is(tests.sqlstate_as(tests.uid('ok1'), format($$insert into public.account_setups (user_id, created_tenant_id, business_type, language) values (%L, %L, 'other', 'en')$$, tests.uid('ok1'), tests.tid('a'))),
  '42501', 'DENY: a client cannot write a setup row (the only way is complete_setup)');
select is(tests.sqlstate_as(null, 'select * from public.terms_acceptances'), '42501', 'DENY: anon has no access to the terms table');
select is(has_function_privilege('anon', 'public.complete_setup(text, text)', 'execute'), false, 'anon cannot execute complete_setup');
select is(has_function_privilege('anon', 'public.get_account_setup()', 'execute'), false, 'anon cannot execute get_account_setup');
select is(has_function_privilege('authenticated', 'app.record_terms_acceptance()', 'execute'), false, 'nobody can call the terms trigger function');

-- ---- what is left to do
select is(tests.scalar_as(tests.uid('ok1'), 'select public.get_account_setup()::text'), '{"state": "needed", "tenant_id": null, "business_name": "Sri Lakshmi Silks"}', 'needed: terms accepted, no setup yet, the business name typed at sign-up');
select is(tests.scalar_as(tests.uid('invited'), 'select (public.get_account_setup() ->> ''state'')'), 'none', 'none: an invited person has nothing to set up');
select is(tests.scalar_as(tests.uid('a_owner'), 'select (public.get_account_setup() ->> ''state'')'), 'none', 'none: a person from an operator-made workspace has nothing to set up');
select is(tests.sqlstate_as(null, 'select public.get_account_setup()'), '42501', 'DENY: no identity, no answer');

-- ---- complete_setup: the refusals first
select is(tests.sqlstate_as(null, $$select public.complete_setup('textiles', 'en')$$), '42501', 'DENY: no identity');
select is(tests.sqlstate_as(tests.uid('ok1'), $$select public.complete_setup('bakery', 'en')$$), '22023', 'DENY: a business type outside the list');
select is(tests.sqlstate_as(tests.uid('ok1'), $$select public.complete_setup('textiles', 'fr')$$), '22023', 'DENY: a language outside the list');
select is(tests.sqlstate_as(tests.uid('ok1'), $$select public.complete_setup(null, null)$$), '22023', 'DENY: nothing chosen');
select is(tests.sqlstate_as(tests.uid('unconf'), $$select public.complete_setup('textiles', 'en')$$), 'SM309', 'DENY: the e-mail is not confirmed');
select is(tests.sqlstate_as(tests.uid('noterms'), $$select public.complete_setup('textiles', 'en')$$), 'SM308', 'DENY: the terms were not accepted at sign-up');
select is(tests.sqlstate_as(tests.uid('badterms'), $$select public.complete_setup('textiles', 'en')$$), 'SM308', 'DENY: a malformed terms version counts as not accepted');
select is(tests.sqlstate_as(tests.uid('noname'), $$select public.complete_setup('textiles', 'en')$$), '22023', 'DENY: no business name from sign-up');
select is(tests.sqlstate_as(tests.uid('longname'), $$select public.complete_setup('textiles', 'en')$$), '22023', 'DENY: a business name over 120 characters');
select is((select count(*) from public.account_setups), 0::bigint, 'none of the refusals left a setup row');

-- ---- complete_setup: the first call
select is(tests.scalar_as(tests.uid('ok1'), $$select (public.complete_setup('textiles', 'te') ->> 'created')$$), 'true', 'ALLOW: the first call makes the business');
select is((select count(*) from public.account_setups where user_id = tests.uid('ok1')), 1::bigint, 'one setup row');
select is((select business_type || ':' || language from public.account_setups where user_id = tests.uid('ok1')), 'textiles:te', 'with the chosen business type and language');
select is((select t.name from public.tenants t join public.account_setups s on s.created_tenant_id = t.id where s.user_id = tests.uid('ok1')), 'Sri Lakshmi Silks', 'the business carries the name typed at sign-up');
select matches((select t.slug from public.tenants t join public.account_setups s on s.created_tenant_id = t.id where s.user_id = tests.uid('ok1')), '^sri-lakshmi-silks-[0-9a-f]{8}$', 'and a readable web address');
select is((select m.role::text from public.memberships m join public.account_setups s on s.created_tenant_id = m.tenant_id where s.user_id = tests.uid('ok1') and m.user_id = tests.uid('ok1')), 'owner', 'the person is its Owner');
select is((select count(*) from public.memberships m join public.account_setups s on s.created_tenant_id = m.tenant_id where s.user_id = tests.uid('ok1')), 1::bigint, 'and its only member');
select is((select plan || ':' || workspace_limit from public.tenants t join public.account_setups s on s.created_tenant_id = t.id where s.user_id = tests.uid('ok1')), 'free_trial:1', 'on the free trial');
select is((select count(*) from public.audit_events a join public.account_setups s on s.created_tenant_id = a.tenant_id
            where s.user_id = tests.uid('ok1') and a.action = 'tenant.create' and a.actor_user_id = tests.uid('ok1')), 1::bigint, 'the creation is audited with the person as the actor');
select is(tests.scalar_as(tests.uid('ok1'), 'select (public.get_account_setup() ->> ''state'')'), 'done', 'now the account is done');
select is(tests.scalar_as(tests.uid('ok1'), 'select (public.get_account_setup() ->> ''tenant_id'')'), (select created_tenant_id::text from public.account_setups where user_id = tests.uid('ok1')), 'and says which business');
select is(tests.rows_as(tests.uid('ok1'), 'select 1 from public.account_setups'), 1::bigint, 'a person reads their own setup row');
select is(tests.rows_as(tests.uid('ok2'), 'select 1 from public.account_setups'), 0::bigint, 'and another person cannot');

-- ---- complete_setup: a repeat (double click, second tab, retry) changes nothing
select is(tests.scalar_as(tests.uid('ok1'), $$select (public.complete_setup('textiles', 'te') ->> 'created')$$), 'false', 'a repeat says nothing new was made');
select is(tests.scalar_as(tests.uid('ok1'), $$select (public.complete_setup('construction', 'hi') ->> 'tenant_id')$$), (select created_tenant_id::text from public.account_setups where user_id = tests.uid('ok1')),
  'a repeat with other choices returns the same business');
select is((select business_type || ':' || language from public.account_setups where user_id = tests.uid('ok1')), 'textiles:te', 'and the first choices stand');
select is((select count(*) from public.tenants where name = 'Sri Lakshmi Silks'), 1::bigint, 'still one business');
select is((select count(*) from public.memberships where user_id = tests.uid('ok1') and role = 'owner'), 1::bigint, 'still one owner row');

-- ---- two people with the same business name get two businesses with different addresses
select is(tests.scalar_as(tests.uid('ok2'), $$select (public.complete_setup('other', 'en') ->> 'created')$$), 'true', 'a second person with the same business name is set up');
select is((select count(distinct t.slug) from public.tenants t where t.name = 'Sri Lakshmi Silks'), 2::bigint, 'with a different web address');

-- ---- a name with no latin letters still gets a valid address
select is(tests.scalar_as(tests.uid('telugu'), $$select (public.complete_setup('other', 'te') ->> 'created')$$), 'true', 'a business named in Telugu is set up');
select matches((select t.slug from public.tenants t join public.account_setups s on s.created_tenant_id = t.id where s.user_id = tests.uid('telugu')), '^business-[0-9a-f]{8}$', 'its address falls back to "business"');

-- ---- one business per account: an account that already owns a workspace is refused, and nothing is left behind
select is(tests.sqlstate_as(tests.uid('owner_already'), $$select public.create_tenant('Already Mine', 'already-mine')$$), 'ok', 'set-up: this account already owns a workspace');
select is(tests.sqlstate_as(tests.uid('owner_already'), $$select public.complete_setup('other', 'en')$$), 'SM307', 'DENY: an account that already owns a workspace cannot also be set up');
select is((select count(*) from public.tenants where name = 'Second Try Co'), 0::bigint, 'no business was left behind');
select is((select count(*) from public.account_setups where user_id = tests.uid('owner_already')), 0::bigint, 'and no setup row');

select * from finish();
rollback;
