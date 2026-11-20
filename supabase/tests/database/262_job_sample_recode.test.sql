-- 262: the system account may replace the sound of a job sample whose words are the same (migration 20261231987100); nobody else; nothing is spent.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');
create function pg_temp.w(p_sql text, p_user text default 'outsider') returns text language plpgsql as $$
begin return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

select is(pg_temp.w($q$select (public.ops_job_sample_put('textiles', 'enquiry_call_right_away', 'te', repeat('a', 64), 100, 'audio/wav', 'UklGRg==', 1000) ->> 'stored')$q$), 'true', 'setup: a sample of 100 characters');

select is(pg_temp.w($q$select (public.ops_job_sample_recode('textiles', 'enquiry_call_right_away', 'te', repeat('a', 64), 'audio/mpeg', 'SUQz') ->> 'recoded')$q$), 'true', 'A1 the system account replaces the sound');
select is(pg_temp.w($q$select (public.job_sample_get('textiles', 'enquiry_call_right_away', 'te') ->> 'content_type')$q$, 'a_viewer'), 'audio/mpeg', 'A2 everybody now plays the new type');
select is(pg_temp.w($q$select (public.job_sample_get('textiles', 'enquiry_call_right_away', 'te') ->> 'sha8')$q$, 'a_viewer'), repeat('a', 8), 'A3 the link hash is unchanged');
select is(pg_temp.w($q$select (public.ops_job_sample_index() ->> 'total_chars')$q$), '100', 'A4 no characters were counted again');

select is(pg_temp.w($q$select (public.ops_job_sample_recode('textiles', 'enquiry_call_right_away', 'te', repeat('b', 64), 'audio/mpeg', 'SUQz') ->> 'recoded')$q$), 'false', 'B1 other words: not recoded (the sound must match the words)');
select is(pg_temp.w($q$select (public.ops_job_sample_recode('textiles', 'nothing_here', 'te', repeat('a', 64), 'audio/mpeg', 'SUQz') ->> 'recoded')$q$), 'false', 'B2 an unknown sample: not recoded');
select is(pg_temp.w($q$select public.ops_job_sample_recode('textiles', 'enquiry_call_right_away', 'te', repeat('a', 64), 'audio/mpeg', '!!notbase64!!')::text$q$), 'ERR:22023', 'B3 bad sound data is refused');
select is(pg_temp.w($q$select public.ops_job_sample_recode('textiles', 'enquiry_call_right_away', 'te', repeat('a', 64), 'text/html', 'SUQz')::text$q$), 'ERR:22023', 'B4 only an audio type');

select is(pg_temp.w($q$select public.ops_job_sample_recode('textiles', 'enquiry_call_right_away', 'te', repeat('a', 64), 'audio/mpeg', 'SUQz')::text$q$, 'a_owner'), 'ERR:42501', 'C1 a workspace owner cannot');
select is(has_function_privilege('anon', 'public.ops_job_sample_recode(text,text,text,text,text,text)', 'execute'), false, 'C2 not signed in: no');

select * from finish();
rollback;
