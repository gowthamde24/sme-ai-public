-- First run by business type (25 Nov 2026; migration 20261231988000): the Owner changes the pack of an existing workspace, nobody else can, nothing is removed, and the first-run facts say whether anyone chose a type.
--   A the Owner changes it     B who may not     C the same pack again and unknown packs     D the first-run facts
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.cp_pack('a', 'textiles');
update packs.workspace_pack set source = 'default' where tenant_id = tests.tid('a');   -- cp_pack marks it chosen by the operator; D wants a workspace nobody typed

create function pg_temp.at(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

-- D first: a workspace nobody typed (the default pack from the tenants insert) says so
select is(pg_temp.at('aal1', 'a_owner', format($$select (public.first_run_facts(%L) ->> 'typed')$$, tests.tid('a'))), 'false', 'D1: a workspace that was never typed says typed = false');
select is(pg_temp.at('aal1', 'a_owner', format($$select (public.first_run_facts(%L) ->> 'items_count')$$, tests.tid('a'))), '0', 'D2: and holds no item yet');
select is(pg_temp.at('aal1', 'b_owner', format($$select (public.first_run_facts(%L) ->> 'pack_code')$$, tests.tid('a'))), 'ERR:42501', 'D3: another business reads nothing of ours');

-- A: the Owner changes it
select is(pg_temp.at('aal2', 'a_owner', format($$select (public.workspace_pack_set(%L, 'clinic') -> 'pack_id')$$, tests.tid('a'))), '"clinic"', 'A1: the Owner makes it a clinic');
select is((select source from packs.workspace_pack where tenant_id = tests.tid('a')), 'owner', 'A2: the source says the Owner chose it');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'workspace_pack.choose' and new_values ->> 'source' = 'owner'), 1::bigint, 'A3: one audit line');
select is(pg_temp.at('aal1', 'a_owner', format($$select (public.first_run_facts(%L) ->> 'typed')$$, tests.tid('a'))), 'true', 'A4: the workspace now counts as typed');
select is(pg_temp.at('aal2', 'a_owner', format($$select (public.workspace_pack_set(%L, 'coaching') -> 'pack_id')$$, tests.tid('a'))), '"coaching"', 'A5: and it can be changed again');

-- B: who may not
select is(pg_temp.at('aal2', 'a_admin', format($$select public.workspace_pack_set(%L, 'clinic')::text$$, tests.tid('a'))), 'ERR:42501', 'B1: an Admin may not');
select is(pg_temp.at('aal2', 'a_viewer', format($$select public.workspace_pack_set(%L, 'clinic')::text$$, tests.tid('a'))), 'ERR:42501', 'B2: nor a Viewer');
select is(pg_temp.at('aal2', 'b_owner', format($$select public.workspace_pack_set(%L, 'clinic')::text$$, tests.tid('a'))), 'ERR:42501', 'B3: nor the Owner of another business');
select is(pg_temp.at('aal2', 'anon', format($$select public.workspace_pack_set(%L, 'clinic')::text$$, tests.tid('a'))), 'ERR:42501', 'B4: nor a person who is not signed in');

-- C: the same pack again, an unknown pack
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'workspace_pack.choose'), 2::bigint, 'C0: two changes so far');
select is(pg_temp.at('aal2', 'a_owner', format($$select (public.workspace_pack_set(%L, 'coaching') -> 'pack_id')$$, tests.tid('a'))), '"coaching"', 'C1: the same pack again answers as before');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'workspace_pack.choose'), 2::bigint, 'C2: and writes no new audit line');
select is(pg_temp.at('aal2', 'a_owner', format($$select public.workspace_pack_set(%L, 'no_such_pack')::text$$, tests.tid('a'))), 'ERR:SM702', 'C3: a pack that does not exist is refused');
select is(pg_temp.at('aal2', 'a_owner', format($$select public.workspace_pack_set(%L, 'Bad Code')::text$$, tests.tid('a'))), 'ERR:22023', 'C4: a malformed code is invalid');
select is((select pack_code from packs.workspace_pack where tenant_id = tests.tid('a')), 'coaching', 'C5: a refusal changed nothing');

-- E: choosing the pack the workspace already holds is a choice when nobody typed it (26 Nov 2026), and still a no-op once somebody did
update packs.workspace_pack set pack_code = 'textiles', source = 'default' where tenant_id = tests.tid('a');
select is(pg_temp.at('aal2', 'a_owner', format($$select (public.workspace_pack_set(%L, 'textiles') -> 'pack_id')$$, tests.tid('a'))), '"textiles"', 'E1: the Owner picks the pack the workspace already has');
select is((select source from packs.workspace_pack where tenant_id = tests.tid('a')), 'owner', 'E2: the source now says the Owner chose it');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'workspace_pack.choose'), 3::bigint, 'E3: one audit line for it');
select is(pg_temp.at('aal1', 'a_owner', format($$select (public.first_run_facts(%L) ->> 'typed')$$, tests.tid('a'))), 'true', 'E4: and the workspace counts as typed (the picker stays away)');
select is(pg_temp.at('aal2', 'a_owner', format($$select (public.workspace_pack_set(%L, 'textiles') -> 'pack_id')$$, tests.tid('a'))), '"textiles"', 'E5: the same pack again answers as before');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'workspace_pack.choose'), 3::bigint, 'E6: and writes no new audit line');
update packs.workspace_pack set source = 'signup' where tenant_id = tests.tid('a');
select pg_temp.at('aal2', 'a_owner', format($$select (public.workspace_pack_set(%L, 'textiles') -> 'pack_id')$$, tests.tid('a')));
select is((select source from packs.workspace_pack where tenant_id = tests.tid('a')), 'signup', 'E7: the same pack on a workspace made by sign-up changes nothing (source stays signup)');
update packs.workspace_pack set source = 'legacy' where tenant_id = tests.tid('a');
select pg_temp.at('aal2', 'a_owner', format($$select (public.workspace_pack_set(%L, 'textiles') -> 'pack_id')$$, tests.tid('a')));
select is((select source from packs.workspace_pack where tenant_id = tests.tid('a')), 'owner', 'E8: a legacy workspace is recorded as chosen too');

select * from finish();
rollback;
