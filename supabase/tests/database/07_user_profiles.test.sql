-- public.users is a minimal profile mirroring auth.users. PII minimisation: display_name only.
begin;
select no_plan();
select tests.seed_two_tenants();

select is((select count(*) from public.users), 16::bigint, 'signup trigger created one profile per auth user');
select is((select display_name from public.users where id = tests.uid('a_owner')), 'a_owner',
  'display_name is taken from signup metadata');

-- a signup with no metadata still gets a profile
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
  (tests.uid('nometa'), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'nometa@test.local', now(), now());
select is((select count(*) from public.users where id = tests.uid('nometa')), 1::bigint,
  'signup without metadata still creates a profile');
select is((select display_name from public.users where id = tests.uid('nometa')), null,
  'display_name is null when not provided (no email scraped into the profile)');

-- own profile: ALLOW read + edit of display_name only
select is(tests.rows_as(tests.uid('a_viewer'), format($$select 1 from public.users where id = %L$$, tests.uid('a_viewer'))),
  1::bigint, 'ALLOW read own profile');
select is(tests.rows_as(tests.uid('a_viewer'), format(
  $$update public.users set display_name = 'Vee' where id = %L$$, tests.uid('a_viewer'))),
  1::bigint, 'ALLOW edit own display_name (any role)');
select is((select display_name from public.users where id = tests.uid('a_viewer')), 'Vee', 'edit persisted');

-- DENY editing someone else, even an owner editing a member of their own tenant
select is(tests.rows_as(tests.uid('a_owner'), format(
  $$update public.users set display_name = 'hijack' where id = %L$$, tests.uid('a_viewer'))),
  0::bigint, 'DENY owner editing a member''s profile (0 rows)');
select is(tests.rows_as(tests.uid('a_viewer'), format(
  $$update public.users set display_name = 'hijack' where id = %L$$, tests.uid('a_owner'))),
  0::bigint, 'DENY editing a co-member''s profile (0 rows)');

-- DENY structural changes
select is(tests.sqlstate_as(tests.uid('a_viewer'), format(
  $$update public.users set id = %L where id = %L$$, tests.uid('x1'), tests.uid('a_viewer'))),
  '42501', 'DENY changing profile id (column not writable)');
select is(tests.sqlstate_as(tests.uid('x1'), format(
  $$insert into public.users (id, display_name) values (%L, 'dup')$$, gen_random_uuid())),
  '42501', 'DENY creating profiles directly (signup trigger only)');
select is(tests.sqlstate_as(tests.uid('a_owner'), format(
  $$delete from public.users where id = %L$$, tests.uid('a_viewer'))),
  '42501', 'DENY deleting profiles');

-- visibility is exactly "myself + people who share a tenant with me"
select is(tests.rows_as(tests.uid('a_viewer'), 'select 1 from public.users'),
  5::bigint, 'viewer A sees exactly the 5 members of tenant A');
select is(tests.rows_as(tests.uid('b_viewer'), 'select 1 from public.users'),
  4::bigint, 'viewer B sees exactly the 4 members of tenant B');
select is(tests.rows_as(tests.uid('outsider'), 'select 1 from public.users'),
  1::bigint, 'outsider sees only themselves');

select * from finish();
rollback;
