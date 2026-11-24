-- One lead address per job and its activity list (migration 20261231990500): Owner and Admin only, one webhook source per job, activity holds closed words, never another workspace's.
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.at(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

insert into public.lead_sources (id, tenant_id, kind, tag, label, token_hash, token_hint, created_by) values
  (tests.rid('la_w1'), tests.tid('a'), 'webhook', 'webhook', 'Form one', encode(sha256(convert_to('la_w1', 'UTF8')), 'hex'), 'abcd', tests.uid('a_owner')),
  (tests.rid('la_w2'), tests.tid('a'), 'webhook', 'webhook', 'Form two', encode(sha256(convert_to('la_w2', 'UTF8')), 'hex'), 'efgh', tests.uid('a_owner')),
  (tests.rid('la_f1'), tests.tid('a'), 'website_form', 'website_form', 'Site form', encode(sha256(convert_to('la_f1', 'UTF8')), 'hex'), 'ijkl', tests.uid('a_owner'));

select is(pg_temp.at('a_sales', format($q$select public.job_lead_address_link(%L, 'shop_jobs', %L)::text$q$, tests.tid('a'), tests.rid('la_w1'))), 'ERR:42501', 'A1: Sales cannot link');
select is(pg_temp.at('b_owner', format($q$select public.job_lead_address_link(%L, 'shop_jobs', %L)::text$q$, tests.tid('a'), tests.rid('la_w1'))), 'ERR:42501', 'A2: nor another workspace');
select is(pg_temp.at('a_admin', format($q$select (public.job_lead_address_link(%L, 'shop_jobs', %L)) ->> 'job_id'$q$, tests.tid('a'), tests.rid('la_w1'))), 'shop_jobs', 'A3: an Admin links a webhook source to a job');
select is(pg_temp.at('a_owner', format($q$select (public.job_lead_address_link(%L, 'shop_jobs', %L)) ->> 'job_id'$q$, tests.tid('a'), tests.rid('la_w1'))), 'shop_jobs', 'A4: the same link again is a retry');
select is(pg_temp.at('a_owner', format($q$select public.job_lead_address_link(%L, 'other_job', %L)::text$q$, tests.tid('a'), tests.rid('la_w1'))), 'ERR:22023', 'A5: a source belongs to one job');
select is(pg_temp.at('a_owner', format($q$select public.job_lead_address_link(%L, 'shop_jobs', %L)::text$q$, tests.tid('a'), tests.rid('la_w2'))), 'ERR:23505', 'A6: a job has one address');
select is(pg_temp.at('a_owner', format($q$select public.job_lead_address_link(%L, 'site_job', %L)::text$q$, tests.tid('a'), tests.rid('la_f1'))), 'ERR:23503', 'A7: only a webhook source can be a job address');
select is(pg_temp.at('a_owner', format($q$select public.job_lead_address_link(%L, 'Bad Job', %L)::text$q$, tests.tid('a'), tests.rid('la_w2'))), 'ERR:22023', 'A8: a job id is a plain word');

select is(pg_temp.at('a_owner', format($q$select (public.job_lead_address_get(%L, 'shop_jobs')) ->> 'source_id'$q$, tests.tid('a'))), tests.rid('la_w1')::text, 'B1: the Owner reads the address of the job');
select is(pg_temp.at('a_owner', format($q$select coalesce((public.job_lead_address_get(%L, 'nothing_here'))::text, 'none')$q$, tests.tid('a'))), 'none', 'B2: a job without one reads null');
select is(pg_temp.at('a_owner', format($q$select (public.job_lead_address_get(%L, 'shop_jobs')) ? 'token_hash'$q$, tests.tid('a'))), 'false', 'B3: never the secret or its hash');
select is(pg_temp.at('b_owner', format($q$select public.job_lead_address_get(%L, 'shop_jobs')::text$q$, tests.tid('a'))), 'ERR:42501', 'B4: another workspace cannot read it');

-- activity: written by the worker account (here directly), read by Owner and Admin
insert into public.lead_source_activity (tenant_id, source_id, outcome, reason) values (tests.tid('a'), tests.rid('la_w1'), 'accepted', 'new_lead'), (tests.tid('a'), tests.rid('la_w1'), 'refused', 'bot');
select is(pg_temp.at('a_owner', format($q$select jsonb_array_length((public.lead_source_activity_list(%L, %L)) -> 'items')::text$q$, tests.tid('a'), tests.rid('la_w1'))), '2', 'C1: the Owner reads the activity');
select is(pg_temp.at('a_sales', format($q$select public.lead_source_activity_list(%L, %L)::text$q$, tests.tid('a'), tests.rid('la_w1'))), 'ERR:42501', 'C2: Sales cannot');
select is(pg_temp.at('b_owner', format($q$select public.lead_source_activity_list(%L, %L)::text$q$, tests.tid('a'), tests.rid('la_w1'))), 'ERR:42501', 'C3: nor another workspace');
select is(pg_temp.at('a_owner', format($q$select public.lead_source_activity_list(%L, %L)::text$q$, tests.tid('a'), tests.rid('nobody'))), 'ERR:23503', 'C4: an unknown source is a reference error');
select is(pg_temp.at('a_viewer', format($q$select count(*)::text from public.lead_source_activity where tenant_id = %L$q$, tests.tid('a'))), '0', 'C5: a Viewer sees no rows by RLS');
select is(pg_temp.at('a_owner', format($q$select count(*)::text from public.lead_source_activity where tenant_id = %L$q$, tests.tid('a'))), '2', 'C6: the Owner sees them by RLS');
select is(pg_temp.at('a_owner', format($q$select public.scheduler_lead_activity(%L, 'accepted', 'new_lead')$q$, encode(sha256(convert_to('la_w1', 'UTF8')), 'hex'))), 'ERR:42501', 'C7: a member cannot write the activity');
select is(pg_temp.at('a_owner', format($q$insert into public.lead_source_activity (tenant_id, source_id, outcome, reason) values (%L, %L, 'accepted', 'Has Spaces')$q$, tests.tid('a'), tests.rid('la_w1'))), 'ERR:42501', 'C8: no direct writes by a member');
select is((select count(*) from pg_constraint where conrelid = 'public.lead_source_activity'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%reason%'), 1::bigint, 'C9: the reason is a closed pattern');

-- the dry-run log
select is(pg_temp.at('a_owner', format($q$select public.lead_source_test_logged(%L, %L, 'accepted', 'new_lead')::text$q$, tests.tid('a'), tests.rid('la_w1'))), '', 'D1: a test is noted');
select is((select count(*) from public.lead_source_activity where source_id = tests.rid('la_w1') and test), 1::bigint, 'D2: marked as a test');
select is(pg_temp.at('a_sales', format($q$select public.lead_source_test_logged(%L, %L, 'accepted', 'new_lead')::text$q$, tests.tid('a'), tests.rid('la_w1'))), 'ERR:42501', 'D3: Sales cannot');

select * from finish();
rollback;
