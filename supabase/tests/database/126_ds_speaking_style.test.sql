-- Job DS (migration 20261203090000): how the assistant talks. A style per workspace and language, a region for Telugu, Tamil and Kannada; every member reads, the Owner (second factor) sets.
--   A defaults   B who may set   C validation   D the set replaces   E isolation   F the doors
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.get(p_user text, p_tenant text) returns text language sql as $$ select pg_temp.val(p_user, format($q$select public.speaking_style_get(%L)::text$q$, tests.tid(p_tenant))) $$;
create function pg_temp.setit(p_user text, p_tenant text, p_doc text, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.speaking_style_set(%L, %L::jsonb)::text$q$, tests.tid(p_tenant), p_doc), p_aal) $$;

-- ============================================================================ A. defaults
select is(pg_temp.val('a_viewer', format($q$select (public.speaking_style_get(%L) -> 'languages' -> 'te' ->> 'style')$q$, tests.tid('a'))), 'everyday_mixed', 'A1 before any save: everyday_mixed (a Viewer reads it)');
select is(pg_temp.val('a_sales', format($q$select (public.speaking_style_get(%L) -> 'languages' -> 'te' ->> 'region')$q$, tests.tid('a'))), 'neutral', 'A2 ... neutral region (Sales reads it)');
select is(pg_temp.val('a_owner', format($q$select (public.speaking_style_get(%L) -> 'languages' -> 'te' ->> 'saved')$q$, tests.tid('a'))), 'false', 'A3 ... and says it was not saved');
select is(pg_temp.val('a_owner', format($q$select (select count(*) from jsonb_object_keys(public.speaking_style_get(%L) -> 'languages'))::text$q$, tests.tid('a'))), '6', 'A4 all six languages are listed');

-- ============================================================================ B. who may set
select is(pg_temp.setit('a_owner', 'a', '{"languages": {"te": {"style": "everyday_mixed", "region": "telangana"}, "ta": {"style": "everyday_pure"}}}') is not null, true, 'B1 the Owner sets it');
select is(pg_temp.val('a_owner', format($q$select (public.speaking_style_get(%L) -> 'languages' -> 'te' ->> 'region')$q$, tests.tid('a'))), 'telangana', 'B2 the region is kept');
select is(pg_temp.val('a_owner', format($q$select (public.speaking_style_get(%L) -> 'languages' -> 'ta' ->> 'style')$q$, tests.tid('a'))), 'everyday_pure', 'B3 so is the style of another language');
select is(pg_temp.setit('a_admin', 'a', '{"languages": {}}'), 'ERR:42501', 'B4 an Admin cannot set it');
select is(pg_temp.setit('a_sales', 'a', '{"languages": {}}'), 'ERR:42501', 'B5 Sales cannot');
select is(pg_temp.setit('a_owner', 'a', '{"languages": {}}', 'aal1'), 'ERR:SM306', 'B6 the Owner needs the second factor');
select is(pg_temp.setit('anon', 'a', '{"languages": {}}'), 'ERR:42501', 'B7 nobody signed in cannot');

-- ============================================================================ C. validation
select is(pg_temp.setit('a_owner', 'a', '{"languages": {"te": {"style": "bookish"}}}'), 'ERR:22023', 'C1 an unknown style');
select is(pg_temp.setit('a_owner', 'a', '{"languages": {"xx": {"style": "formal"}}}'), 'ERR:22023', 'C2 an unknown language');
select is(pg_temp.setit('a_owner', 'a', '{"languages": {"te": {"style": "formal", "region": "chennai"}}}'), 'ERR:22023', 'C3 a region of another language');
select is(pg_temp.setit('a_owner', 'a', '{"languages": {"hi": {"style": "formal", "region": "coastal"}}}'), 'ERR:22023', 'C4 Hindi has no region');
select is(pg_temp.setit('a_owner', 'a', '{"languages": {"te": {"style": "formal", "colour": "red"}}}'), 'ERR:22023', 'C5 an unknown key');
select is(pg_temp.setit('a_owner', 'a', '{"languages": {"te": {"region": "coastal"}}}'), 'ERR:22023', 'C6 a style is needed');
select is(pg_temp.setit('a_owner', 'a', '{"extra": 1, "languages": {}}'), 'ERR:22023', 'C7 an unknown top-level key');
select is(pg_temp.setit('a_owner', 'a', '[]'), 'ERR:22023', 'C8 not an object');
select is(pg_temp.setit('a_owner', 'a', '{"languages": {"kn": {"style": "everyday_mixed", "region": "north_karnataka"}, "ta": {"style": "formal", "region": "kongu"}}}') is not null, true, 'C9 the regions of Kannada and Tamil are accepted');
select is((select count(*)::int from public.speaking_styles where tenant_id = tests.tid('a')), 2, 'C10 a refused save changed nothing, an accepted one replaced the rest');

-- ============================================================================ D. the set replaces
select is(pg_temp.val('a_owner', format($q$select (public.speaking_style_get(%L) -> 'languages' -> 'te' ->> 'saved')$q$, tests.tid('a'))), 'false', 'D1 a language left out goes back to the default');
select is((select count(*)::int from public.audit_events where tenant_id = tests.tid('a') and action like 'speaking_style%'), (select count(*)::int from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'speaking_style'), 'D2 changes are in the audit trail') ;

-- ============================================================================ E. isolation
select is(pg_temp.val('a_owner', format($q$select public.speaking_style_get(%L)::text$q$, tests.tid('b'))), 'ERR:42501', 'E1 another workspace is not readable');
select is(pg_temp.setit('a_owner', 'b', '{"languages": {}}'), 'ERR:42501', 'E2 ... nor settable');
select is(pg_temp.val('b_owner', format($q$select (public.speaking_style_get(%L) -> 'languages' -> 'kn' ->> 'saved')$q$, tests.tid('b'))), 'false', 'E3 the other workspace has its own (default) settings');

-- ============================================================================ F. the doors
select is(pg_temp.val('a_owner', $q$select count(*)::text from public.speaking_styles$q$), '2', 'F1 the Owner sees their own rows by the table too');
select is(pg_temp.val('anon', $q$select count(*)::text from public.speaking_styles$q$), 'ERR:42501', 'F2 the public key has no right on the table');
select is((select count(*)::int from information_schema.role_table_grants where table_name = 'speaking_styles' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'), 0, 'F3 nobody can write the table directly');

select * from finish();
rollback;
