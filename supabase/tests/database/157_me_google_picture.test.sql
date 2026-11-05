-- My profile for a person who signed in with Google and has a Google photo (owner bug, 5 Nov 2026; migration 20261231100000): the photo check used a regex repeat count above
-- Postgres's limit of 255, so my_profile_get, my_profile_set and people_profiles failed (SQLSTATE 2201B) for every such person. The rule stays: a Google address only, never too long.
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform tests.as_aal('aal2');
  return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.photo(p_user text, p_url text) returns void language sql as $$
  update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('picture', p_url) where id = tests.uid(p_user) $$;
create function pg_temp.mine(p_user text) returns text language sql as $$
  select pg_temp.val(p_user, format('select public.my_profile_get(%L)::text', tests.tid('a'))) $$;

-- a real-looking Google photo address (the shape Google sign-in gives)
select pg_temp.photo('a_owner', 'https://lh3.googleusercontent.com/a/ACg8ocK3xYz-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_abcdEF=s96-c');
select isnt(pg_temp.mine('a_owner'), null, 'G0: my_profile_get answers');
select ok(pg_temp.mine('a_owner') not like 'ERR:%', 'G1: my_profile_get works for a person with a Google photo (it failed with 2201B before)');
select is(pg_temp.mine('a_owner')::jsonb ->> 'google_picture', 'https://lh3.googleusercontent.com/a/ACg8ocK3xYz-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_abcdEF=s96-c', 'G2: ...and gives the Google photo');
select ok(pg_temp.val('a_owner', format('select public.my_profile_set(%L, %L::jsonb)::text', tests.tid('a'), '{"display_name":"Lakshmi"}')) not like 'ERR:%', 'G3: my_profile_set works for them too');
select ok(pg_temp.val('a_viewer', format('select public.people_profiles(%L)::text', tests.tid('a'))) not like 'ERR:%', 'G4: people_profiles works when a member has a Google photo');
select is((select p ->> 'google_picture' from jsonb_array_elements(pg_temp.val('a_viewer', format('select public.people_profiles(%L)::text', tests.tid('a')))::jsonb) p where p ->> 'user_id' = tests.uid('a_owner')::text),
  'https://lh3.googleusercontent.com/a/ACg8ocK3xYz-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_abcdEF=s96-c', 'G5: ...and lists that photo');

-- the old rule still holds
select pg_temp.photo('a_owner', 'https://evil.example.com/a/x.jpg');
select is(pg_temp.mine('a_owner')::jsonb ->> 'google_picture', null, 'G6: never another host');
select pg_temp.photo('a_owner', 'https://lh3.googleusercontent.com.evil.example/a/x.jpg');
select is(pg_temp.mine('a_owner')::jsonb ->> 'google_picture', null, 'G7: never a look-alike host');
select pg_temp.photo('a_owner', 'https://lh3.googleusercontent.com/a/' || repeat('x', 600));
select is(pg_temp.mine('a_owner')::jsonb ->> 'google_picture', null, 'G8: never a very long address');
select pg_temp.photo('a_owner', 'https://lh3.googleusercontent.com/a/x"onerror=1');
select is(pg_temp.mine('a_owner')::jsonb ->> 'google_picture', null, 'G9: never a quote or other odd character');
select pg_temp.photo('a_owner', 'https://lh3.googleusercontent.com/a/' || repeat('x', 500));
select is(pg_temp.mine('a_owner')::jsonb ->> 'google_picture', 'https://lh3.googleusercontent.com/a/' || repeat('x', 500), 'G10: an address of up to 500 characters after the host is kept');

-- the trap itself: no app or public function compares with a regex repeat count above 255 (Postgres refuses those, but only when the text is not null)
select is((select count(*) from pg_proc p where p.pronamespace in ('app'::regnamespace, 'public'::regnamespace, 'workspace'::regnamespace)
  and p.prosrc ~ '\{[0-9]*,?(25[6-9]|2[6-9][0-9]|[3-9][0-9]{2}|[0-9]{4,})\}'), 0::bigint, 'G11: no function holds a regex repeat count above 255');

select * from finish();
rollback;
