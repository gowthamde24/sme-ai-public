-- Job BY (ADR 0077): the team (migration 20261118090000). Invitations by one-time code, acceptance with the failed-attempt lock, revoking, listing, role changes, removing and leaving, the Owner cap.
--   A catalog and the code helpers   B create_invitation   C accept_invitation   D revoke and list   E change_member_role   F remove_member and leave   G the Owner cap   H erasure of labels
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();

create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
-- invite: (user, id label, role, days, label, tenant, aal) -> json
create function pg_temp.inv(p_user text, p_id text, p_role text, p_days int default 7, p_label text default null, p_tenant text default 'a', p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.create_invitation(%L, %L, %L, %L, %L)$q$, tests.rid(p_id), tests.tid(p_tenant), p_role, p_days, p_label), p_aal) $$;
create function pg_temp.acc(p_user text, p_code text, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.accept_invitation(%L)$q$, p_code), p_aal) $$;
create temp table codes (label text primary key, code text);
create function pg_temp.mk(p_label text, p_user text, p_role text, p_tenant text default 'a', p_days int default 7) returns text language plpgsql as $$
declare v text;
begin
  v := pg_temp.j(pg_temp.inv(p_user, 'inv_' || p_label, p_role, p_days, null, p_tenant), 'code');
  insert into codes values (p_label, v);
  return v;
end $$;
create function pg_temp.code(p_label text) returns text language sql as $$ select code from codes where label = p_label $$;

-- ---------------------------------------------------------------------------------------------
-- A. catalog and the code helpers
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'team' and c.relkind = 'r' and c.relrowsecurity and c.relforcerowsecurity), 2::bigint, 'A: both team tables have row-level security on and forced');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'team' and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint, 'A: no client role holds any privilege on them');
select is((select count(*) from information_schema.schemata where schema_name = 'team' and (has_schema_privilege('anon', schema_name, 'usage') or has_schema_privilege('authenticated', schema_name, 'usage'))), 0::bigint, 'A: no client role can use the team schema');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('create_invitation', 'accept_invitation', 'revoke_invitation', 'list_invitations', 'change_member_role', 'remove_member', 'team_members')
            and p.prosecdef and p.proconfig @> array['search_path=""']), 7::bigint, 'A: all seven functions are SECURITY DEFINER with an empty search_path');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('create_invitation', 'accept_invitation', 'revoke_invitation', 'list_invitations', 'change_member_role', 'remove_member', 'team_members') and has_function_privilege('anon', p.oid, 'execute')), 0::bigint, 'A: anon can execute none of them');
select is((select column_name from information_schema.columns where table_schema = 'team' and table_name = 'invitations' and column_name like '%code%' and column_name <> 'code_sha256'), null, 'A: the table has no column that could hold a code except its hash');
select is(app.invite_code_normalise('7QX2K-M9R4D-0A1B2-C3D4E'), '7QX2KM9R4D0A1B2C3D4E', 'A: a code is normalised to 20 symbols');
select is(app.invite_code_normalise(' 7qx2k m9r4d-0a1b2 c3d4e '), '7QX2KM9R4D0A1B2C3D4E', 'A: ...lower case, spaces and hyphens do not matter');
select is(app.invite_code_normalise('7QX2K-M9R4D-OAIB2-C3D4E'), '7QX2KM9R4D0A1B2C3D4E', 'A: ...O is 0 and I is 1');
select is(app.invite_code_normalise('7QX2K-M9R4D-0ALB2-C3D4E'), '7QX2KM9R4D0A1B2C3D4E', 'A: ...and L is 1');
select is(app.invite_code_normalise('7QX2K-M9R4D-0A1B2-C3D4U'), null, 'A: U is not in the alphabet');
select is(app.invite_code_normalise('7QX2K-M9R4D-0A1B2-C3D4'), null, 'A: 19 symbols is not a code');
select is(app.invite_code_normalise('7QX2K-M9R4D-0A1B2-C3D4E5'), null, 'A: 21 symbols is not a code');
select is(app.invite_code_normalise(repeat('A', 100)), null, 'A: a very long text is not a code (and is not hashed)');
select is(app.invite_code_normalise('７QX2K-M9R4D-0A1B2-C3D4E'), null, 'A: a full-width digit is not a symbol');
select is(app.invite_code_normalise(null), null, 'A: null is not a code');
select is((select count(distinct app.invite_code_make()) from generate_series(1, 500)), 500::bigint, 'A: 500 made codes are 500 different codes');
select is(app.invite_code_make() ~ '^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$', true, 'A: a made code has four groups of five Crockford symbols');
select is(app.invite_code_normalise(app.invite_code_make()) is not null, true, 'A: ...and normalises');

-- ---------------------------------------------------------------------------------------------
-- B. create_invitation
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.j(pg_temp.inv('a_owner', 'o1', 'sales'), 'status'), 'pending', 'B: the Owner invites a Sales member');
select is(pg_temp.j(pg_temp.inv('a_owner', 'o2', 'viewer'), 'role'), 'viewer', 'B: ...a Viewer');
select is(pg_temp.j(pg_temp.inv('a_owner', 'o3', 'admin'), 'role'), 'admin', 'B: ...an Admin');
select is(pg_temp.inv('a_owner', 'o4', 'owner'), 'ERR:SM242', 'B: nobody is ever invited as Owner (SM242), not even by the Owner');
select is(pg_temp.inv('a_admin', 'o5', 'owner'), 'ERR:SM242', 'B: ...nor by an Admin');
select is(pg_temp.inv('a_admin', 'o5', 'admin'), 'ERR:SM242', 'B: an Admin cannot invite an Admin (SM242)');
select is(pg_temp.j(pg_temp.inv('a_admin', 'o5', 'sales'), 'role'), 'sales', 'B: an Admin invites Sales');
select is(pg_temp.j(pg_temp.inv('a_admin', 'o6', 'viewer'), 'role'), 'viewer', 'B: ...and Viewers');
select is(pg_temp.inv('a_sales', 'o7', 'viewer'), 'ERR:42501', 'B: Sales cannot invite');
select is(pg_temp.inv('a_viewer', 'o7', 'viewer'), 'ERR:42501', 'B: a Viewer cannot');
select is(pg_temp.inv('b_owner', 'o7', 'viewer'), 'ERR:42501', 'B: another business''s Owner cannot invite into ours');
select is(pg_temp.inv('anon', 'o7', 'viewer'), 'ERR:42501', 'B: anon cannot');
select is(pg_temp.inv('a_owner', 'o7', 'viewer', 7, null, 'a', 'aal1'), 'ERR:SM306', 'B: the Owner needs the second factor (SM306)');
select is(pg_temp.inv('a_owner', 'o7', 'viewer', 0), 'ERR:22023', 'B: 0 days is invalid');
select is(pg_temp.inv('a_owner', 'o7', 'viewer', 31), 'ERR:22023', 'B: 31 days is invalid');
select is(pg_temp.j(pg_temp.inv('a_owner', 'o8', 'viewer', 30), 'status'), 'pending', 'B: 30 days is the most');
select is((select expires_at - created_at from team.invitations where id = tests.rid('o8')), interval '30 days', 'B: ...and is kept');
select is((select expires_at - created_at from team.invitations where id = tests.rid('o1')), interval '7 days', 'B: 7 days is the default');
select is(pg_temp.inv('a_owner', 'o9', 'viewer', 7, 'x@y.test'), 'ERR:22023', 'B: a label with an at sign is invalid');
select is(pg_temp.inv('a_owner', 'o9', 'viewer', 7, 'call 9876543'), 'ERR:22023', 'B: a label with seven digits in a row is invalid');
select is(pg_temp.j(pg_temp.inv('a_owner', 'o9', 'viewer', 7, 'call 987654'), 'label'), 'call 987654', 'B: six digits in a row are fine');
select is(pg_temp.inv('a_owner', 'o10', 'viewer', 7, repeat('x', 61)), 'ERR:22023', 'B: 61 characters is too long');
select is(pg_temp.j(pg_temp.inv('a_owner', 'o11', 'viewer', 7, repeat('x', 60)), 'status'), 'pending', 'B: 60 is fine');
select is(pg_temp.j(pg_temp.inv('a_owner', 'o12', 'viewer', 7, '   '), 'label'), null, 'B: a blank label is no label');
select is(pg_temp.j(pg_temp.inv('a_owner', 'o1', 'sales'), 'replayed'), 'true', 'B: the same request again is a replay');
select is(pg_temp.j(pg_temp.inv('a_owner', 'o1', 'sales'), 'code'), null, 'B: ...and never shows the code again');
select is(pg_temp.inv('a_owner', 'o1', 'viewer'), 'ERR:23505', 'B: the same id with another role is not a replay (23505)');
select is(pg_temp.inv('a_admin', 'o1', 'sales'), 'ERR:23505', 'B: ...nor from another person');
select is((select count(*) from team.invitations where id = tests.rid('o1')), 1::bigint, 'B: one row');
-- the code is shown once and only its hash is kept
select pg_temp.mk('c1', 'a_owner', 'sales');
select is(pg_temp.code('c1') ~ '^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$', true, 'B: the code is returned in four groups');
select is((select code_sha256 from team.invitations where id = tests.rid('inv_c1')), encode(sha256(convert_to(app.invite_code_normalise(pg_temp.code('c1')), 'UTF8')), 'hex'), 'B: only the SHA-256 of the normalised code is stored');
select is((select count(*) from team.invitations where code_sha256 = pg_temp.code('c1') or label = pg_temp.code('c1')), 0::bigint, 'B: the code itself is stored nowhere');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'invitation.created'), 10::bigint, 'B: every creation was audited (and no refused one)');
select is((select bool_and(new_values::text !~* '([0-9A-Z]{5}-[0-9A-Z]{5}|code|label|call)' ) from public.audit_events where action like 'invitation.%'), true, 'B: ...with no code and no label');
-- ---------------------------------------------------------------------------------------------
-- C. accept_invitation
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.acc('anon', pg_temp.code('c1')), 'ERR:42501', 'C: anon cannot accept');
select is(pg_temp.j(pg_temp.acc('x1', 'AAAAA-AAAAA-AAAAA-AAAAA'), 'status'), 'invalid', 'C: an unknown code RETURNS "invalid" (it does not raise)');
select is((select count(*) from team.invitation_attempts where user_id = tests.uid('x1')), 1::bigint, 'C: ...and the failed attempt is recorded');
select is(pg_temp.acc('x1', 'not a code at all'), pg_temp.acc('x1', 'AAAAA-AAAAA-AAAAA-AAAAB'), 'C: garbage and a wrong code give the same answer');
select is(pg_temp.acc('x1', repeat('9', 5000)), '{"status": "invalid"}', 'C: a very long hostile text gives the same answer');
select is(pg_temp.acc('x1', E'1\'; drop table team.invitations; --'), '{"status": "invalid"}', 'C: ...and so does text that looks like SQL');
select is((select count(*) from team.invitation_attempts where user_id = tests.uid('x1')), 5::bigint, 'C: five failures are recorded');
select is(pg_temp.acc('x1', pg_temp.code('c1')), '{"status": "locked"}', 'C: the sixth presentation is locked, even with the right code (it is not looked at)');
select is((select status from team.invitations where id = tests.rid('inv_c1')), 'pending', 'C: ...and the invitation is untouched');
select is((select count(*) from team.invitation_attempts where user_id = tests.uid('x1')), 5::bigint, 'C: ...and the locked attempt is not counted again');
select is(pg_temp.j(pg_temp.acc('x2', pg_temp.code('c1')), 'status'), 'joined', 'C: another person is not locked by x1''s failures: x2 joins with the right code');
select is((select role::text from public.memberships where tenant_id = tests.tid('a') and user_id = tests.uid('x2')), 'sales', 'C: ...as Sales');
select is(pg_temp.j(pg_temp.acc('x3', pg_temp.code('c1')), 'status'), 'invalid', 'C: the code works once: a second person with it gets "invalid"');
select is((select status from team.invitations where id = tests.rid('inv_c1')), 'accepted', 'C: the invitation is accepted');
select is((select accepted_by from team.invitations where id = tests.rid('inv_c1')), tests.uid('x2'), 'C: ...by x2');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'invitation.accepted'), 1::bigint, 'C: audited');
-- old failures are forgotten after 24 hours
update team.invitation_attempts set at = now() - interval '25 hours' where user_id = tests.uid('x1');
select is(pg_temp.j(pg_temp.acc('x1', 'AAAAA-AAAAA-AAAAA-AAAAA'), 'status'), 'invalid', 'C: after the lock ends the caller can try again');
select is((select count(*) from team.invitation_attempts where user_id = tests.uid('x1')), 1::bigint, 'C: ...the old attempts were deleted');
-- the same answer for every cause: expired, revoked, used, another workspace, unknown
select pg_temp.mk('exp', 'a_owner', 'viewer');
update team.invitations set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where id = tests.rid('inv_exp');
select pg_temp.mk('rev', 'a_owner', 'viewer');
select pg_temp.sc('a_owner', format('select public.revoke_invitation(%L, %L)', tests.tid('a'), tests.rid('inv_rev')));
select is(pg_temp.acc('x3', pg_temp.code('exp')), '{"status": "invalid"}', 'C: an expired code is "invalid"');
select is(pg_temp.acc('x3', pg_temp.code('rev')), '{"status": "invalid"}', 'C: a revoked code is "invalid"');
select is(pg_temp.acc('x3', pg_temp.code('c1')), '{"status": "invalid"}', 'C: a used code is "invalid"');
select is(pg_temp.acc('x3', 'AAAAA-AAAAA-AAAAA-AAAAA'), '{"status": "invalid"}', 'C: an unknown code is "invalid": the same answer for every cause');
select is((select count(*) from team.invitation_attempts where user_id = tests.uid('x3')), 5::bigint, 'C: ...and each left the same kind of attempt row (five of them)');
-- case, spaces, hyphens and look-alikes are forgiven
select pg_temp.mk('lc', 'a_owner', 'viewer');
select is(pg_temp.j(pg_temp.acc('x4', ' ' || lower(replace(pg_temp.code('lc'), '-', ' ')) || ' '), 'status'), 'joined', 'C: a code typed in lower case with spaces works');
-- Admin invitations need the CURRENT session at the second factor, checked after the code is proven
select pg_temp.mk('adm', 'a_owner', 'admin');
select is(pg_temp.acc('x5', pg_temp.code('adm'), 'aal1'), 'ERR:SM306', 'C: an Admin invitation accepted by a password-only session is refused (SM306)');
select is((select count(*) from team.invitation_attempts where user_id = tests.uid('x5')), 0::bigint, 'C: ...and no failure is recorded for it');
select is((select status from team.invitations where id = tests.rid('inv_adm')), 'pending', 'C: ...the invitation still waits');
select is(pg_temp.j(pg_temp.acc('x5', pg_temp.code('adm'), 'aal2'), 'role'), 'admin', 'C: with the second factor the same code joins as Admin');
-- already a member: told only after the code is proven valid
select pg_temp.mk('dup', 'a_owner', 'viewer');
select is(pg_temp.acc('x4', pg_temp.code('dup')), 'ERR:SM247', 'C: an existing member with a VALID code is told SM247');
select is(pg_temp.j(pg_temp.acc('x4', 'AAAAA-AAAAA-AAAAA-AAAAB'), 'status'), 'invalid', 'C: ...with a wrong code they are only told "invalid" (SM247 is no oracle for who is a member)');
-- Sales and Viewer invitations need no second factor
select pg_temp.mk('v1', 'a_owner', 'viewer');
select is(pg_temp.j(pg_temp.acc('x6', pg_temp.code('v1'), 'aal1'), 'status'), 'joined', 'C: a Viewer invitation joins with a password-only session');
select is(pg_temp.j(pg_temp.acc('x6', 'x', 'aal1'), 'status'), 'invalid', 'C: (and a member who tries garbage is just "invalid")');

select pg_temp.inv('b_owner', 'bo0', 'viewer', 7, null, 'b');
-- ---------------------------------------------------------------------------------------------
-- D. revoke and list
-- ---------------------------------------------------------------------------------------------
create function pg_temp.rev(p_user text, p_id text, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.revoke_invitation(%L, %L)', tests.tid('a'), tests.rid(p_id)), p_aal) $$;
select is(pg_temp.rev('a_sales', 'o2'), 'ERR:42501', 'D: Sales cannot revoke');
select is(pg_temp.rev('a_owner', 'o2', 'aal1'), 'ERR:SM306', 'D: the Owner needs the second factor');
select is(pg_temp.j(pg_temp.rev('a_owner', 'o2'), 'status'), 'revoked', 'D: the Owner revokes a pending invitation');
select is(pg_temp.j(pg_temp.rev('a_owner', 'o2'), 'status'), 'revoked', 'D: ...revoking twice is harmless');
select is(pg_temp.rev('a_admin', 'o3'), 'ERR:SM242', 'D: an Admin cannot revoke an Admin invitation (SM242)');
select is(pg_temp.j(pg_temp.rev('a_admin', 'o6'), 'status'), 'revoked', 'D: an Admin revokes a Viewer invitation');
select is(pg_temp.rev('a_owner', 'inv_c1'), 'ERR:SM248', 'D: an accepted invitation cannot be revoked (SM248)');
select is(pg_temp.rev('a_owner', 'inv_nope'), 'ERR:SM243', 'D: an unknown one is not found (SM243)');
select is(pg_temp.sc('b_owner', format('select public.revoke_invitation(%L, %L)', tests.tid('b'), tests.rid('o3'))), 'ERR:SM243', 'D: another business cannot reach ours by its id');
select is(pg_temp.sc('a_sales', format('select public.list_invitations(%L)', tests.tid('a'))), 'ERR:42501', 'D: Sales cannot list');
select is(pg_temp.sc('b_owner', format('select public.list_invitations(%L)', tests.tid('a'))), 'ERR:42501', 'D: another business cannot');
create temp table inv_list as select pg_temp.sc('a_admin', format('select public.list_invitations(%L)', tests.tid('a')))::jsonb as r;
select is((select r::text !~* '[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}' from inv_list), true, 'D: the list never holds a code');
select is((select x ->> 'status' from inv_list, jsonb_array_elements(r) x where x ->> 'id' = tests.rid('inv_exp')::text), 'expired', 'D: a pending invitation past its date reads "expired"');
select is((select x ->> 'status' from inv_list, jsonb_array_elements(r) x where x ->> 'id' = tests.rid('inv_c1')::text), 'accepted', 'D: an accepted one reads "accepted"');
select is((select x ->> 'created_by_name' from inv_list, jsonb_array_elements(r) x where x ->> 'id' = tests.rid('inv_c1')::text), 'a_owner', 'D: ...with the inviter''s display name');
select is(jsonb_array_length(pg_temp.sc('b_owner', format('select public.list_invitations(%L)', tests.tid('b')))::jsonb), 1, 'D: another business lists only its own');
-- the team
create function pg_temp.team(p_user text, p_tenant text default 'a') returns text language sql as $$ select pg_temp.sc(p_user, format('select public.team_members(%L)', tests.tid(p_tenant))) $$;
select is(pg_temp.team('a_viewer') like 'ERR:%', false, 'D: any member sees the team');
select is(pg_temp.j(pg_temp.team('a_viewer'), 'pending_invitations'), null, 'D: ...a Viewer is not told how many invitations wait');
select is((pg_temp.team('a_owner')::jsonb ->> 'pending_invitations')::int >= 1, true, 'D: ...the Owner is');
select is((pg_temp.team('a_owner')::jsonb -> 'members' -> 0 ->> 'role'), 'owner', 'D: owners are listed first');
select is((select count(*) from jsonb_array_elements(pg_temp.team('a_sales')::jsonb -> 'members') x where (x ->> 'is_you')::boolean), 1::bigint, 'D: exactly one row is "you"');
select is(pg_temp.team('b_owner', 'a'), 'ERR:42501', 'D: another business sees nothing of our team');
select is(pg_temp.team('x6', 'a') like 'ERR:%', false, 'D: (x6 joined as a Viewer and sees the team)');

-- ---------------------------------------------------------------------------------------------
-- E. change_member_role
-- ---------------------------------------------------------------------------------------------
create function pg_temp.chg(p_user text, p_target text, p_role text, p_reason text default 'role_changed', p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.change_member_role(%L, %L, %L, %L)', tests.tid('a'), tests.uid(p_target), p_role, p_reason), p_aal) $$;
select is(pg_temp.chg('a_sales', 'a_viewer', 'sales'), 'ERR:42501', 'E: Sales cannot change a role');
select is(pg_temp.chg('a_owner', 'a_viewer', 'sales', 'role_changed', 'aal1'), 'ERR:SM306', 'E: the Owner needs the second factor');
select is(pg_temp.j(pg_temp.chg('a_owner', 'a_viewer', 'sales'), 'role'), 'sales', 'E: the Owner makes a Viewer a Sales member');
select is(pg_temp.j(pg_temp.chg('a_owner', 'a_viewer', 'sales'), 'changed'), 'false', 'E: ...the same again changes nothing');
select is(pg_temp.j(pg_temp.chg('a_owner', 'a_sales', 'admin'), 'role'), 'admin', 'E: the Owner makes a Sales member an Admin');
select is(pg_temp.chg('a_owner', 'a_sales', 'owner'), 'ERR:SM242', 'E: nobody is made Owner here (SM242)');
select is(pg_temp.chg('a_owner', 'a_owner2', 'admin'), 'ERR:SM242', 'E: an Owner is not demoted here (that is the operator''s)');
select is(pg_temp.chg('a_owner', 'a_owner', 'admin'), 'ERR:SM245', 'E: nobody changes their own role (SM245)');
select is(pg_temp.chg('a_owner', 'b_owner', 'sales'), 'ERR:SM243', 'E: a person of another workspace is not a member (SM243)');
select is(pg_temp.chg('a_owner', 'a_viewer', 'sales', 'because'), 'ERR:22023', 'E: the reason must be one of the closed words (22023)');
select is(pg_temp.chg('a_owner', 'a_viewer', 'sales', null), 'ERR:22023', 'E: ...and must be given');
select is(pg_temp.chg('a_owner', 'a_viewer', 'janitor'), 'ERR:SM242', 'E: an unknown role is refused');
select is(pg_temp.chg('a_admin', 'a_viewer', 'sales') like 'ERR:%', false, 'E: an Admin changes Sales <-> Viewer');
select is(pg_temp.chg('a_admin', 'a_viewer', 'admin'), 'ERR:SM242', 'E: an Admin cannot make anyone an Admin');
select is(pg_temp.chg('a_admin', 'a_sales', 'viewer'), 'ERR:SM242', 'E: an Admin cannot change an Admin (a_sales is an Admin now)');
select is(pg_temp.chg('a_admin', 'a_owner', 'viewer'), 'ERR:SM242', 'E: ...or an Owner');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'member.role_changed' and metadata ->> 'reason' = 'role_changed'), 2::bigint, 'E: each real change is audited with its reason (2 changes so far)');
select is((select (old_values ->> 'role') || '>' || (new_values ->> 'role') from public.audit_events where action = 'member.role_changed' order by id limit 1), 'viewer>sales', 'E: ...with the old and new role');
select is(pg_temp.chg('a_owner', 'a_viewer', 'viewer') like 'ERR:%', false, 'E: back to viewer');

-- ---------------------------------------------------------------------------------------------
-- F. remove_member and leave
-- ---------------------------------------------------------------------------------------------
create function pg_temp.rm(p_user text, p_target text, p_reason text, p_aal text default 'aal2', p_tenant text default 'a') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.remove_member(%L, %L, %L)', tests.tid(p_tenant), tests.uid(p_target), p_reason), p_aal) $$;
-- open work of the person who will be removed (x2 joined as Sales; make them own a lead and an opportunity, and have a running agent run)
update public.leads set owner_user_id = tests.uid('x2') where id = tests.rid('a_lead');
update public.opportunities set owner_user_id = tests.uid('x2') where id = tests.rid('a_opp');
select is(tests.scalar_as(tests.uid('x2'), format('select count(*) from public.leads where tenant_id = %L', tests.tid('a'))) <> '0', true, 'F: before removal x2 reads the workspace');
select is(pg_temp.rm('x6', 'x4', 'no_longer_works_here'), 'ERR:42501', 'F: a Viewer cannot remove anyone');
select is(pg_temp.rm('a_owner', 'x2', 'no_longer_works_here', 'aal1'), 'ERR:SM306', 'F: removing needs the second factor');
select is(pg_temp.rm('a_owner', 'x2', 'left'), 'ERR:22023', 'F: "left" is only for leaving');
select is(pg_temp.rm('a_owner', 'x2', 'because'), 'ERR:22023', 'F: the reason is a closed word');
select is(pg_temp.rm('a_owner', 'a_owner2', 'no_longer_works_here'), 'ERR:SM242', 'F: an Owner is not removed from the app (the operator''s job)');
select is(pg_temp.rm('a_admin', 'a_sales', 'no_longer_works_here'), 'ERR:SM242', 'F: an Admin cannot remove an Admin (a_sales is one now)');
select is(pg_temp.rm('a_admin', 'a_owner', 'no_longer_works_here'), 'ERR:SM242', 'F: ...or an Owner');
select is(pg_temp.rm('a_owner', 'b_owner', 'no_longer_works_here'), 'ERR:SM243', 'F: a person of another workspace is not found');
create temp table rm_result as select pg_temp.rm('a_owner', 'x2', 'no_longer_works_here')::jsonb as r;
select is((select r ->> 'removed' from rm_result), 'true', 'F: the Owner removes x2');
select is((select (r ->> 'leads_unassigned')::int from rm_result), 1, 'F: ...and is told one lead lost its owner');
select is((select (r ->> 'opportunities_unassigned')::int from rm_result), 1, 'F: ...and one opportunity');
select is((select owner_user_id from public.leads where id = tests.rid('a_lead')), null, 'F: the lead is unassigned');
select is((select owner_user_id from public.opportunities where id = tests.rid('a_opp')), null, 'F: the opportunity is unassigned');
select is((select count(*) from public.memberships where tenant_id = tests.tid('a') and user_id = tests.uid('x2')), 0::bigint, 'F: the membership is gone');
select is(tests.scalar_as(tests.uid('x2'), format('select count(*) from public.leads where tenant_id = %L', tests.tid('a'))), '0', 'F: with the same token, x2 reads nothing at once');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'member.removed' and metadata ->> 'reason' = 'no_longer_works_here' and (metadata ->> 'leads_unassigned')::int = 1), 1::bigint, 'F: audited with the reason and counts only');
select is((select old_values ->> 'role' from public.audit_events where action = 'member.removed' and metadata ->> 'reason' = 'no_longer_works_here' order by id limit 1), 'sales', 'F: ...and the role they had');
select is(pg_temp.rm('a_owner', 'x2', 'no_longer_works_here'), 'ERR:SM243', 'F: removing again: not a member (SM243)');
-- another workspace untouched
select is((select count(*) from public.memberships where tenant_id = tests.tid('b')), 5::bigint, 'F: the other business''s members are untouched');
-- an admin removed: their pending invitations are revoked, a running agent run is cancelled
select pg_temp.mk('byadm', 'x5', 'viewer');
select is((select status from team.invitations where id = tests.rid('inv_byadm')), 'pending', 'F: x5 (an Admin since C) has a pending invitation');
insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, lead_id, expires_at, input_sha256)
values (tests.rid('run_x5'), tests.tid('a'), tests.uid('x5'), 'research', 'research-1', tests.rid('a_lead'), now() + interval '15 minutes', repeat('3', 64));
select is(pg_temp.j(pg_temp.rm('a_owner', 'x5', 'security_concern'), 'runs_cancelled'), '1', 'F: removing an Admin cancels their running agent run');
select is((select status::text from public.agent_runs where id = tests.rid('run_x5')), 'cancelled', 'F: ...it is cancelled');
select is((select status from team.invitations where id = tests.rid('inv_byadm')), 'revoked', 'F: ...and their pending invitations are revoked');
-- leaving
select is(pg_temp.rm('x6', 'x6', 'no_longer_works_here'), 'ERR:22023', 'F: leaving must say "left"');
select is(pg_temp.j(pg_temp.rm('x6', 'x6', 'left', 'aal1'), 'removed'), 'true', 'F: a Viewer leaves with a password-only session');
select is((select count(*) from public.memberships where tenant_id = tests.tid('a') and user_id = tests.uid('x6')), 0::bigint, 'F: ...and is gone');
select is(pg_temp.rm('b_owner', 'b_owner', 'left', 'aal2', 'b'), 'ERR:SM244', 'F: the only Owner cannot leave (SM244)');
select is(pg_temp.j(pg_temp.rm('a_owner2', 'a_owner2', 'left'), 'removed'), 'true', 'F: an Owner can leave while another Owner remains');
select is((select count(*) from public.memberships where tenant_id = tests.tid('a') and role = 'owner'), 2::bigint, 'F: ...two Owners remain (a_owner and dual)');

-- ---------------------------------------------------------------------------------------------
-- G. the Owner cap (the operator)
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.priv($$select app.operator_add_owner_exception('tenant-a', 'x1@test.local', 'the family adds a third owner for safety')$$), 'ok', 'G: the operator adds a third Owner');
select is(pg_temp.priv($$select app.operator_add_owner_exception('tenant-a', 'x3@test.local', 'a fourth owner is one too many here')$$), '22023', 'G: a fourth is refused (22023)');
select is(pg_temp.priv(format($i$select tests.scalar_as(%L, 'select app.operator_add_owner_exception(''tenant-b'', ''x3@test.local'', ''this is allowed for nobody here'')')$i$, tests.uid('b_owner'))), '42501', 'G: a signed-in caller cannot use it');

-- ---------------------------------------------------------------------------------------------
-- H. labels go with the workspace
-- ---------------------------------------------------------------------------------------------
select pg_temp.inv('b_owner', 'blab', 'viewer', 7, 'for the new cutter', 'b');
select is((select label from team.invitations where id = tests.rid('blab')), 'for the new cutter', 'H: B''s invitation has a label');
insert into public.erasure_requests (id, tenant_id, scope, status, requested_by, execute_after) values (tests.rid('er_b'), tests.tid('b'), 'tenant', 'pending', tests.uid('b_owner'), now() - interval '1 minute');
select is(pg_temp.sc('b_owner', format('select public.execute_erasure(%L, false)', tests.rid('er_b'))) like 'ERR:%', false, 'H: the Owner erases the workspace');
select is((select label from team.invitations where id = tests.rid('blab')), null, 'H: the label is gone with it');
select is((select status from team.invitations where id = tests.rid('blab')), 'pending', 'H: ...the rows, dates and roles stay');

-- ---------------------------------------------------------------------------------------------
-- I. the pending cap: 20 per workspace
-- ---------------------------------------------------------------------------------------------
do $$ declare n integer := 0; begin
  while (select count(*) from team.invitations x where x.tenant_id = tests.tid('a') and x.status = 'pending' and x.expires_at > now()) < 20 loop
    n := n + 1; perform pg_temp.inv('a_owner', 'cap' || n, 'viewer');
  end loop; end $$;
select is((select count(*) from team.invitations x where x.tenant_id = tests.tid('a') and x.status = 'pending' and x.expires_at > now()), 20::bigint, 'I: twenty are pending');
select is(pg_temp.inv('a_owner', 'cap_extra', 'viewer'), 'ERR:SM246', 'I: the twenty-first pending invitation is refused (SM246)');
select is(pg_temp.j(pg_temp.inv('b_owner', 'bo1', 'viewer', 7, null, 'b'), 'status'), 'pending', 'I: the cap is per workspace (B is not full)');
select pg_temp.rev('a_owner', 'cap1');
select is(pg_temp.j(pg_temp.inv('a_owner', 'cap_again', 'viewer'), 'status'), 'pending', 'I: after one is revoked there is room again');

select * from finish();
rollback;
