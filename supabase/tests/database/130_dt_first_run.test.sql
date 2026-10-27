-- Job DT (ADR 0115): the first real sign-in. A the catalog  B the second factor is optional, sensitive actions need a recent sign-in  C the business profile  D members' own profiles and pictures
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

-- run as a person at an assurance level; p_factor says whether the person has an authenticator on (an aal1 session of a person WHO HAS one is the old tests' password-only session); returns the SQLSTATE or 'ok'
create function pg_temp.at(p_user text, p_aal text, p_factor boolean, p_sql text) returns text language plpgsql as $$
begin
  perform tests.as_aal(p_aal);
  perform tests.as_no_factor(not p_factor);
  return tests.sqlstate_as(tests.uid(p_user), p_sql);
end $$;
create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform tests.as_aal('aal2');
  return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
-- a raw token: whatever claims the test names, as an authenticated caller
create function pg_temp.raw(p_user text, p_claims jsonb, p_sql text) returns text language plpgsql as $$
declare v text := 'ok';
begin
  perform set_config('request.jwt.claims', (jsonb_build_object('sub', tests.uid(p_user), 'role', 'authenticated', 'aud', 'authenticated') || p_claims)::text, true);
  perform set_config('request.jwt.claim.sub', tests.uid(p_user)::text, true);
  perform set_config('role', 'authenticated', true);
  begin execute p_sql; exception when others then v := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;

-- ---------------------------------------------------------------------------------------------
-- A. catalog
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('workspace_business_get', 'workspace_business_set', 'workspace_images_ensure_bucket', 'workspace_logo_set',
  'my_profile_get', 'my_profile_set', 'people_profiles', 'account_security_get') and p.prosecdef and p.proconfig @> array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')), 8::bigint,
  'A: the eight new functions are SECURITY DEFINER with a pinned search path, for signed-in callers only');
select is((select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('second_factor_on', 'last_signin_at', 'workspace_conflict', 'images_bucket', 'pack_is_deep', 'workspace_business_json', 'google_picture_of', 'member_profile_json')
  and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0::bigint, 'A: the helpers are callable by no client role');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'workspace' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'A: no client role holds any privilege on the workspace tables');
select is((select count(*) from pg_policy where polrelid = 'storage.objects'::regclass and polname like 'images_objects_%'), 3::bigint, 'A: three storage rules for the images bucket');
select is(app.images_bucket_tenant(app.images_bucket(tests.tid('a'))), tests.tid('a'), 'A: the bucket name leads back to the business...');
select is(app.images_bucket_tenant('cat-' || tests.tid('a')::text), null, 'A: ...and any other name leads nowhere');
select is((select count(*) from pg_proc where pronamespace = 'app'::regnamespace and proname in ('require_aal2', 'guard_aal2_client_write')), 2::bigint, 'A: the two aal helpers keep their names');

-- ---------------------------------------------------------------------------------------------
-- B. the second factor is optional and asked ONCE per session, never on a timer (probe: the agents switch, which calls app.require_aal2 after the role)
-- ---------------------------------------------------------------------------------------------
create function pg_temp.sw(p_tenant text default 'a') returns text language sql as $$ select format('select public.set_tenant_agents_enabled(%L, true)', tests.tid(p_tenant)) $$;
select is(pg_temp.at('a_owner', 'aal1', false, pg_temp.sw()), 'ok', 'B1: a person with NO authenticator is never asked (a Google or a password sign-in alike), at the password-only level');
select is(pg_temp.at('a_owner', 'absent', false, pg_temp.sw()), 'ok', 'B2: ...even with a token that carries no assurance claim');
select is(pg_temp.at('a_owner', 'aal1', true, pg_temp.sw()), 'SM306', 'B3: a person who TURNED the authenticator ON, in a session that has not entered the code, is asked');
select is(pg_temp.at('a_owner', 'absent', true, pg_temp.sw()), 'SM306', 'B4: ...and a token with no assurance claim counts as not entered (fail closed)');
select is(pg_temp.at('a_owner', 'aal2', true, pg_temp.sw()), 'ok', 'B5: once the code was entered (aal2) the action goes through');
select is(pg_temp.at('a_sales', 'aal1', true, pg_temp.sw()), '42501', 'B6: the role is still proven first (Sales: the generic refusal)');
select is(pg_temp.at('b_owner', 'aal1', true, pg_temp.sw()), '42501', 'B7: ...and another business''s Owner');
-- no window: an aal2 session keeps working however old the sign-in (a token of a day ago, a sign-in method time of a day ago)
insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at, secret)
select gen_random_uuid(), tests.uid('a_owner'), 'phone', 'totp', 'verified', now(), now(), 'JBSWY3DPEHPK3PXP' where not exists (select 1 from auth.mfa_factors where user_id = tests.uid('a_owner'));
select is(pg_temp.raw('a_owner', jsonb_build_object('aal', 'aal2', 'iat', extract(epoch from now())::bigint - 86400, 'amr', jsonb_build_array(jsonb_build_object('method', 'password', 'timestamp', extract(epoch from now())::bigint - 86400), jsonb_build_object('method', 'totp', 'timestamp', extract(epoch from now())::bigint - 86000))), pg_temp.sw()),
  'ok', 'B8: NO time window: an aal2 session of a person with the authenticator on works a day after sign-in (owner decision, 28 Oct)');
select is(pg_temp.raw('a_owner', jsonb_build_object('aal', 'aal1', 'iat', extract(epoch from now())::bigint), pg_temp.sw()), 'SM306', 'B9: and a FRESH aal1 session of that person is still asked (time does not matter either way)');
select is(pg_temp.raw('a_admin', jsonb_build_object('aal', 'aal1', 'iat', extract(epoch from now())::bigint - 86400), pg_temp.sw()), 'ok', 'B10: a person without an authenticator is not asked after a day either');
select is(pg_temp.val('a_owner', 'select public.account_security_get()::text')::jsonb ->> 'second_factor_on', 'true', 'B11: the status says the authenticator is on');
select is(pg_temp.val('a_admin', 'select public.account_security_get()::text')::jsonb ->> 'second_factor_on', 'false', 'B12: ...and off for the others');
select is(pg_temp.val('a_admin', 'select public.account_security_get()::text')::jsonb ? 'recent', false, 'B13: no "recent sign-in" in the status any more');
select is(pg_temp.val('anon', 'select public.account_security_get()::text'), 'ERR:42501', 'B14: no status without a sign-in');
select is((select count(*) from pg_proc where pronamespace = 'app'::regnamespace and proname = 'last_signin_at'), 0::bigint, 'B15: the sign-in time helper is gone');
-- the client-write trigger on memberships and tenants asks the same single question
select is(pg_temp.at('a_owner', 'aal1', true, format($q$update public.tenants set name = 'Renamed by hand' where id = %L$q$, tests.tid('a'))), 'SM306', 'B16: a person with the authenticator on, without the code, cannot write a tenant row straight through the API role');
select is(pg_temp.at('a_owner', 'aal2', true, format($q$update public.tenants set name = 'Renamed by hand' where id = %L$q$, tests.tid('a'))), 'ok', 'B17: ...and with the code entered can');
select is(pg_temp.at('a_owner2', 'aal1', false, format($q$update public.memberships set role = 'admin' where tenant_id = %L and user_id = %L$q$, tests.tid('a'), tests.uid('a_sales'))), 'ok', 'B18: an Owner without an authenticator may change a membership at the password-only level');
delete from auth.mfa_factors where user_id = tests.uid('a_owner');

-- ---------------------------------------------------------------------------------------------
-- C. the business profile
-- ---------------------------------------------------------------------------------------------
create function pg_temp.bget(p_user text, p_tenant text default 'a') returns text language sql as $$ select pg_temp.val(p_user, format('select public.workspace_business_get(%L)::text', tests.tid(p_tenant))) $$;
-- the Owner saves from a password-only session of a person who has the authenticator ON and never entered the code: the profile asks for no second factor at all
create function pg_temp.bset(p_user text, p_patch text, p_tenant text default 'a') returns text language plpgsql as $$
begin
  perform tests.as_aal('aal1');
  return tests.scalar_as(tests.uid(p_user), format('select public.workspace_business_set(%L, %L::jsonb)::text', tests.tid(p_tenant), p_patch));
exception when others then return 'ERR:' || sqlstate;
end $$;
select is(pg_temp.j(pg_temp.bget('a_viewer'), 'name'), 'Renamed by hand', 'C1: any member reads the profile; the name is the workspace''s own');
select is(pg_temp.bget('b_owner', 'a'), 'ERR:42501', 'C2: another business reads nothing of ours');
select is(pg_temp.bget('anon'), 'ERR:42501', 'C3: anon neither');
select is(pg_temp.bset('a_admin', '{"name":"Admin Rename"}'), 'ERR:42501', 'C4: only the OWNER edits it (an Admin cannot)');
select is(pg_temp.bset('a_sales', '{"name":"x"}'), 'ERR:42501', 'C5: nor Sales');
select is(pg_temp.bset('b_owner', '{"name":"x"}', 'a'), 'ERR:42501', 'C6: nor another business');
select is(pg_temp.j(pg_temp.bset('a_owner', '{"name":"Lakshmi Sarees","city":"Guntur","phone":"+91 98765 43210","languages":["te","en","te"]}'), 'name'), 'Lakshmi Sarees', 'C7: the Owner edits the name, city, phone and languages at any time (no second factor)');
select is(pg_temp.bget('a_viewer')::jsonb ->> 'city', 'Guntur', 'C8: ...and it is read back at once');
select is(pg_temp.bget('a_viewer')::jsonb -> 'languages', '["en", "te"]'::jsonb, 'C9: languages are a set, in order');
select is((select name from public.tenants where id = tests.tid('a')), 'Lakshmi Sarees', 'C10: the workspace name everything else reads IS the one saved');
select is(pg_temp.bset('a_owner', '{"name":"  "}'), 'ERR:22023', 'C11: an empty name is invalid');
select is(pg_temp.bset('a_owner', '{"colour":"red"}'), 'ERR:22023', 'C12: an unknown key is invalid');
select is(pg_temp.bset('a_owner', '{}'), 'ERR:22023', 'C13: an empty patch is invalid');
select is(pg_temp.bset('a_owner', '{"phone":"call me"}'), 'ERR:22023', 'C14: a phone is digits, spaces, + ( ) -');
select is(pg_temp.bset('a_owner', '{"languages":[]}'), 'ERR:22023', 'C15: at least one language');
select is(pg_temp.bset('a_owner', '{"languages":["xx"]}'), 'ERR:22023', 'C16: a known language');
select is(pg_temp.j(pg_temp.bset('a_owner', '{"phone":null,"city":null}'), 'phone'), null, 'C17: a phone and a city can be cleared');
-- the type: the default pack of a new business is the deep textiles one; no records yet, so it may move
select is(pg_temp.j(pg_temp.bset('a_owner', '{"type":"clinic"}'), 'type'), 'clinic', 'C18: an Owner with no records moves from the deep pack to a Lead Desk type');
select is(pg_temp.bset('a_owner', '{"type":"other"}'), 'ERR:22023', 'C19: "other" needs the Owner''s own words');
select is(pg_temp.j(pg_temp.bset('a_owner', '{"type":"other","type_label":"Pet shop"}'), 'type_label'), 'Pet shop', 'C20: "other" with a label (the generic Lead Desk type)');
select is(pg_temp.j(pg_temp.bget('a_viewer'), 'type'), 'other', 'C21: ...is read back as other, with the words');
select is(pg_temp.j(pg_temp.bset('a_owner', '{"type_label":"Pet food shop"}'), 'type_label'), 'Pet food shop', 'C22: the words can change on their own');
select is(pg_temp.j(pg_temp.bset('a_owner', '{"type":"coaching"}'), 'type_label'), null, 'C23: another type drops the words');
select is(pg_temp.bset('a_owner', '{"type":"no_such_type"}'), 'ERR:SM791', 'C24: an unknown type is refused (SM791)');
select is((select pack_code || ':' || source from packs.workspace_pack where tenant_id = tests.tid('a')), 'coaching:owner', 'C25: the pack is the one chosen, and the choice is the Owner''s');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'workspace_pack.choose' and new_values ->> 'source' = 'owner'), 3::bigint, 'C26: each type change is in the audit log');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'workspace.business_saved'), 6::bigint, 'C27: so is each save (the keys changed, never the values)');
-- into a deep pack only when the business holds no leads (the fixture's tenants each have one)
select is(pg_temp.bset('a_owner', '{"type":"textiles"}'), 'ERR:SM791', 'C28: a business WITH leads cannot move into a deep pack (its screens would not show them)');
-- out of a deep pack only when it holds none of its records
select is(pg_temp.j(pg_temp.bset('b_owner', '{"type":"other","type_label":"Pet shop"}', 'b'), 'type'), 'other', 'C30: tenant B (deep default, no records) may move');
update packs.workspace_pack set pack_code = 'textiles', pack_version = (select max(version) from packs.pack_versions where code = 'textiles') where tenant_id = tests.tid('b');
insert into public.catalogue_items (id, tenant_id, name, fabric, colours, price_band, created_by) values (gen_random_uuid(), tests.tid('b'), 'Synthetic saree', 'soft_silk', array['red'], '5k_10k', tests.uid('b_owner'));
select is(pg_temp.bset('b_owner', '{"type":"clinic"}', 'b'), 'ERR:SM791', 'C32: a deep business with catalogue records cannot leave its pack (SM791 pack_data_present)');
select is(pg_temp.j(pg_temp.bset('b_owner', '{"name":"Still Editable"}', 'b'), 'name'), 'Still Editable', 'C33: ...but its name is still editable');

-- ---------------------------------------------------------------------------------------------
-- D. members' own profiles and pictures
-- ---------------------------------------------------------------------------------------------
create function pg_temp.mset(p_user text, p_patch text, p_tenant text default 'a') returns text language sql as $$
  select pg_temp.val(p_user, format('select public.my_profile_set(%L, %L::jsonb)::text', tests.tid(p_tenant), p_patch)) $$;
select is(pg_temp.j(pg_temp.mset('a_sales', '{"display_name":"Ravi","language":"te"}'), 'display_name'), 'Ravi', 'D1: a member (Sales) sets their own name and language');
select is(pg_temp.val('a_sales', format('select public.my_profile_get(%L)::text', tests.tid('a')))::jsonb ->> 'language', 'te', 'D2: ...and reads it back');
select is(pg_temp.mset('a_sales', '{"language":"xx"}'), 'ERR:22023', 'D3: a language of the product');
select is(pg_temp.mset('a_sales', '{"display_name":""}'), 'ERR:22023', 'D4: a name');
select is(pg_temp.mset('a_sales', '{"other":1}'), 'ERR:22023', 'D5: no unknown key');
select is(pg_temp.mset('b_owner', '{"language":"te"}', 'a'), 'ERR:42501', 'D6: another business is refused');
select is(pg_temp.mset('anon', '{"language":"te"}'), 'ERR:42501', 'D7: anon neither');
-- a picture: only a file the member itself put in the business's bucket
select is(pg_temp.val('a_sales', format('select public.workspace_images_ensure_bucket(%L)', tests.tid('a'))), app.images_bucket(tests.tid('a')), 'D8: a member opens the business''s images bucket');
select is(pg_temp.val('a_sales', format('select public.workspace_images_ensure_bucket(%L)', tests.tid('b'))), 'ERR:42501', 'D9: not another business''s');
select is(pg_temp.mset('a_sales', format('{"avatar_path":"member/%s/%s.jpg"}', tests.uid('a_sales'), gen_random_uuid())), 'ERR:22023', 'D10: a picture that is not in storage is refused');
insert into storage.objects (bucket_id, name, metadata) values
  (app.images_bucket(tests.tid('a')), 'member/' || tests.uid('a_sales') || '/' || tests.rid('p1') || '.jpg', '{"mimetype":"image/jpeg","size":1000}'),
  (app.images_bucket(tests.tid('a')), 'member/' || tests.uid('a_viewer') || '/' || tests.rid('p2') || '.jpg', '{"mimetype":"image/jpeg","size":1000}'),
  (app.images_bucket(tests.tid('a')), 'logo/' || tests.rid('l1') || '.jpg', '{"mimetype":"image/jpeg","size":1000}');
select is(pg_temp.j(pg_temp.mset('a_sales', format('{"avatar_path":"member/%s/%s.jpg"}', tests.uid('a_sales'), tests.rid('p1'))), 'avatar_path'), 'member/' || tests.uid('a_sales') || '/' || tests.rid('p1') || '.jpg', 'D11: a member sets their own picture');
select is(pg_temp.mset('a_sales', format('{"avatar_path":"member/%s/%s.jpg"}', tests.uid('a_viewer'), tests.rid('p2'))), 'ERR:22023', 'D12: never somebody else''s file');
select is(pg_temp.j(pg_temp.mset('a_sales', '{"avatar_path":null}'), 'avatar_path'), null, 'D13: and removes it');
select is(jsonb_array_length(pg_temp.val('a_viewer', format('select public.people_profiles(%L)::text', tests.tid('a')))::jsonb) >= 5, true, 'D14: any member lists everybody''s name and picture');
select is(pg_temp.val('b_owner', format('select public.people_profiles(%L)::text', tests.tid('a'))), 'ERR:42501', 'D15: another business does not');
-- the storage rules
select is(tests.scalar_as(tests.uid('a_viewer'), format($q$select count(*) from storage.objects where bucket_id = %L$q$, app.images_bucket(tests.tid('a')))), '3', 'D16: a member reads the business''s images');
select is(tests.scalar_as(tests.uid('b_owner'), format($q$select count(*) from storage.objects where bucket_id = %L$q$, app.images_bucket(tests.tid('a')))), '0', 'D17: another business reads none');
select is(tests.sqlstate_as(tests.uid('a_viewer'), format($q$insert into storage.objects (bucket_id, name, metadata) values (%L, 'logo/%s.jpg', '{"mimetype":"image/jpeg"}')$q$, app.images_bucket(tests.tid('a')), gen_random_uuid())), '42501', 'D18: a Viewer cannot put a logo');
select is(tests.sqlstate_as(tests.uid('a_admin'), format($q$insert into storage.objects (bucket_id, name, metadata) values (%L, 'logo/%s.jpg', '{"mimetype":"image/jpeg"}')$q$, app.images_bucket(tests.tid('a')), gen_random_uuid())), 'ok', 'D19: an Admin can');
select is(tests.sqlstate_as(tests.uid('a_viewer'), format($q$insert into storage.objects (bucket_id, name, metadata) values (%L, 'member/%s/%s.jpg', '{"mimetype":"image/jpeg"}')$q$, app.images_bucket(tests.tid('a')), tests.uid('a_viewer'), gen_random_uuid())), 'ok', 'D20: every member can put their OWN picture');
select is(tests.sqlstate_as(tests.uid('a_viewer'), format($q$insert into storage.objects (bucket_id, name, metadata) values (%L, 'member/%s/%s.jpg', '{"mimetype":"image/jpeg"}')$q$, app.images_bucket(tests.tid('a')), tests.uid('a_sales'), gen_random_uuid())), '42501', 'D21: but not somebody else''s');
-- the logo
select is(pg_temp.val('a_admin', format($q$select public.workspace_logo_set(%L, 'logo/%s.jpg')::text$q$, tests.tid('a'), tests.rid('l1')))::jsonb ->> 'logo_path', 'logo/' || tests.rid('l1') || '.jpg', 'D22: the Owner or an Admin records the logo (a file that is in storage)');
select is(pg_temp.j(pg_temp.bget('a_viewer'), 'logo_path'), 'logo/' || tests.rid('l1') || '.jpg', 'D23: ...and everybody reads it');
select is(pg_temp.val('a_viewer', format($q$select public.workspace_logo_set(%L, 'logo/%s.jpg')$q$, tests.tid('a'), tests.rid('l1'))), 'ERR:42501', 'D24: a Viewer cannot');
select is(pg_temp.val('a_admin', format($q$select public.workspace_logo_set(%L, 'logo/%s.jpg')$q$, tests.tid('a'), gen_random_uuid())), 'ERR:22023', 'D25: a logo that is not in storage is refused');
select is(pg_temp.val('a_admin', format($q$select public.workspace_logo_set(%L, null)::text$q$, tests.tid('a')))::jsonb ->> 'old_path', 'logo/' || tests.rid('l1') || '.jpg', 'D26: and removed (the old path comes back so the API deletes the file)');

select * from finish();
rollback;
