-- Job AD / D1: the plan columns on tenants and the workspace limit (trigger app.enforce_workspace_limit, SQLSTATE SM307).
begin;
select no_plan();
select tests.seed_two_tenants();

-- ---- the columns and their defaults
select is((select plan from public.tenants where id = tests.tid('a')), 'free_trial', 'a tenant starts on the free trial');
select is((select workspace_limit from public.tenants where id = tests.tid('a')), 1, 'the free trial allows one workspace');
select ok((select trial_started_at from public.tenants where id = tests.tid('a')) between now() - interval '1 minute' and now() + interval '1 minute',
  'trial_started_at is set when the workspace is made');
select throws_ok(
  format($$update public.tenants set plan = 'nope' where id = %L$$, tests.tid('a')), '23514', null, 'a plan outside the list is refused');
select throws_ok(
  format($$update public.tenants set workspace_limit = 0 where id = %L$$, tests.tid('a')), '23514', null, 'a limit below 1 is refused by the check');
select throws_ok(
  format($$update public.tenants set workspace_limit = 101 where id = %L$$, tests.tid('a')), '23514', null, 'a limit above 100 is refused by the check');

-- ---- a client can read the three columns and write none of them
select is(tests.scalar_as(tests.uid('a_viewer'), format($$select plan || ':' || workspace_limit from public.tenants where id = %L$$, tests.tid('a'))),
  'free_trial:1', 'a member reads the plan and the limit');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$update public.tenants set plan = 'free_trial' where id = %L$$, tests.tid('a'))), '42501',
  'DENY: even the Owner cannot write the plan');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$update public.tenants set workspace_limit = 50 where id = %L$$, tests.tid('a'))), '42501',
  'DENY: even the Owner cannot raise the workspace limit');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$update public.tenants set trial_started_at = now() where id = %L$$, tests.tid('a'))), '42501',
  'DENY: even the Owner cannot move the trial start');
select is((select workspace_limit from public.tenants where id = tests.tid('a')), 1, 'the limit is unchanged after those attempts');

-- ---- the limit, through public.create_tenant
select is(tests.sqlstate_as(tests.uid('outsider'), $$select public.create_tenant('First Co', 'first-co')$$), 'ok',
  'a person with no workspace can make their first');
select is(tests.sqlstate_as(tests.uid('outsider'), $$select public.create_tenant('First Co', 'first-co')$$), 'ok',
  'the same call again is the idempotent retry, not a second workspace');
select is(tests.error_full_as(tests.uid('outsider'), $$select public.create_tenant('Second Co', 'second-co')$$),
  'SM307|workspace limit reached: this plan allows 1 workspace(s) per owner||||', 'DENY: the second workspace is refused, with a clear error');
select is((select count(*) from public.tenants where slug = 'second-co'), 0::bigint, 'no second tenant row was left behind');
select is((select count(*) from public.memberships m where m.user_id = tests.uid('outsider') and m.role = 'owner'), 1::bigint,
  'the person still owns exactly one workspace');
select is((select count(*) from public.audit_events a where a.action = 'tenant.create' and a.new_values ->> 'slug' = 'second-co'), 0::bigint,
  'the refused attempt left no audit event (it rolled back)');
select is(tests.sqlstate_as(tests.uid('dual'), $$select public.create_tenant('Dual Co', 'dual-co')$$), 'SM307',
  'DENY: a person who owns one workspace and is only a viewer of another is still at the limit');

-- ---- only OWNER rows count
select is(tests.sqlstate_as(tests.uid('a_admin'), $$select public.create_tenant('Admin Co', 'admin-co')$$), 'ok',
  'an Admin or Viewer elsewhere owns nothing, so they may make a workspace of their own');
select is(tests.sqlstate_as(tests.uid('a_viewer'), $$select public.create_tenant('Viewer Co', 'viewer-co')$$), 'ok',
  'a Viewer elsewhere may make a workspace of their own');

-- ---- the limit holds against a direct insert and a direct update (privileged session, no API)
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, created_at, updated_at)
values (tests.uid('direct'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'direct@test.local', now(), now(), now());
insert into public.tenants (id, name, slug) values (tests.tid('d1'), 'Direct One', 'direct-one'), (tests.tid('d2'), 'Direct Two', 'direct-two');
insert into public.memberships (tenant_id, user_id, role) values (tests.tid('d1'), tests.uid('direct'), 'owner');
select throws_ok(
  format($$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'owner')$$, tests.tid('d2'), tests.uid('direct')),
  'SM307', null, 'DENY: a direct insert of a second owner row is refused');
insert into public.memberships (tenant_id, user_id, role) values (tests.tid('d2'), tests.uid('direct'), 'viewer');
select throws_ok(
  format($$update public.memberships set role = 'owner' where tenant_id = %L and user_id = %L$$, tests.tid('d2'), tests.uid('direct')),
  'SM307', null, 'DENY: promoting the same person to owner of a second workspace is refused');
select lives_ok(
  format($$update public.memberships set role = 'owner' where tenant_id = %L and user_id = %L$$, tests.tid('d1'), tests.uid('direct')),
  'an owner row written again as the same owner is not counted twice');
insert into public.memberships (tenant_id, user_id, role) values (tests.tid('d1'), tests.uid('x2'), 'owner'); -- so 'direct' is not the last owner
select lives_ok(
  format($$update public.memberships set role = 'admin' where tenant_id = %L and user_id = %L$$, tests.tid('d1'), tests.uid('direct')),
  'stepping down is never blocked by the limit');
select is((select count(*) from public.memberships where user_id = tests.uid('direct') and role = 'owner'), 0::bigint, 'and they own none now');

-- ---- a second owner of the SAME workspace is fine (each owns one)
select lives_ok(
  format($$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'owner')$$, tests.tid('a'), tests.uid('x1')),
  'a person who owns nothing can be made a second owner of an existing workspace');

-- ---- a raised limit (only the operator can raise it) lets one more through, and no more
update public.tenants set workspace_limit = 2 where slug = 'first-co';
select is(tests.sqlstate_as(tests.uid('outsider'), $$select public.create_tenant('Second Co', 'second-co')$$), 'ok',
  'with the limit raised to 2 by the operator, the second workspace is made');
select is(tests.sqlstate_as(tests.uid('outsider'), $$select public.create_tenant('Third Co', 'third-co')$$), 'SM307',
  'and the third is refused');

-- ---- a client's forbidden write is refused by row-level security, exactly as before (the limit does not change the error)
select is(tests.sqlstate_as(tests.uid('x3'), format($$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'owner')$$, tests.tid('a'), tests.uid('x3'))),
  '42501', 'DENY: a stranger forging an owner row in another workspace still gets the row-level-security error (42501), not SM307');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'owner')$$, tests.tid('b'), tests.uid('a_owner'))),
  '42501', 'DENY: an Owner of A forging an owner row in B (they are at their limit) still gets 42501');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$insert into public.memberships (tenant_id, user_id, role) values (%L, %L, 'owner')$$, tests.tid('a'), tests.uid('b_owner'))),
  'SM307', 'DENY: an Owner of A making someone who already owns B a second-workspace owner is refused by the limit');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$update public.memberships set role = 'owner' where tenant_id = %L and user_id = %L$$, tests.tid('a'), tests.uid('b_viewer'))),
  'ok', 'ALLOW: an Owner of A promoting a person who owns nothing is fine');

-- ---- the trigger function is not callable by clients
select is(has_function_privilege('authenticated', 'app.enforce_workspace_limit()', 'execute'), false, 'authenticated cannot execute the trigger function');
select is(has_function_privilege('anon', 'app.enforce_workspace_limit()', 'execute'), false, 'anon cannot execute the trigger function');
select is(has_function_privilege('anon', 'app.owner_allowance(uuid, uuid)', 'execute'), false, 'anon cannot execute the allowance function');
select is((select count(*) from pg_trigger where tgname = 'memberships_enforce_workspace_limit' and tgrelid = 'public.memberships'::regclass and not tgisinternal),
  1::bigint, 'the limit is a trigger on memberships');

select * from finish();
rollback;
