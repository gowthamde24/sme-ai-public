-- The spoken samples of the job cards (migration 20261231986500; owner approved the spend, cap Rs 350): written only by the system account, one row per (business type, template, language), the same words
-- again change nothing, the database refuses to go past the character cap, every signed-in person may list and play, nobody reads the table directly.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');
create function pg_temp.w(p_sql text, p_user text default 'outsider') returns text language plpgsql as $$
begin return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.put(p_tpl text, p_lang text, p_sha text, p_chars int, p_cap int default 1000, p_user text default 'outsider') returns text language sql as $$
  select pg_temp.w(format($q$select (public.ops_job_sample_put('textiles', %L, %L, %L, %s, 'audio/wav', 'UklGRg==', %s) ->> 'stored')$q$, p_tpl, p_lang, p_sha, p_chars, p_cap), p_user)
$$;

-- A. who writes
select is(pg_temp.put('enquiry_call_right_away', 'te', repeat('a', 64), 100, 1000, 'a_owner'), 'ERR:42501', 'A1 a workspace owner cannot write a sample');
select is(pg_temp.put('enquiry_call_right_away', 'te', repeat('a', 64), 100), 'true', 'A2 the system account does');
select is(pg_temp.w($q$select (public.ops_job_sample_index() ->> 'total_chars')$q$), '100', 'A3 the characters are counted');
select is(pg_temp.w($q$select (public.ops_job_sample_index() ->> 'total_chars')$q$, 'a_owner'), 'ERR:42501', 'A4 and only the system reads the count');

-- B. the same words again change nothing and cost nothing; other words are new spend
select is(pg_temp.put('enquiry_call_right_away', 'te', repeat('a', 64), 100), 'false', 'B1 the same words: nothing stored');
select is(pg_temp.w($q$select (public.ops_job_sample_index() ->> 'total_chars')$q$), '100', 'B2 and nothing spent');
select is(pg_temp.put('enquiry_call_right_away', 'te', repeat('b', 64), 50), 'true', 'B3 other words for the same template: stored again');
select is(pg_temp.w($q$select (public.ops_job_sample_index() ->> 'total_chars')$q$), '150', 'B4 the new characters count again (they were spent again)');
select is(pg_temp.w($q$select jsonb_array_length(public.ops_job_sample_index() -> 'items')::text$q$), '1', 'B5 still one row for the template and language');

-- C. the cap is the database's, not the script's
select is(pg_temp.put('visit_booking', 'en', repeat('c', 64), 900, 1000), 'ERR:SM980', 'C1 150 + 900 passes the cap of 1000: refused');
select is(pg_temp.put('visit_booking', 'en', repeat('c', 64), 800, 1000), 'true', 'C2 150 + 800 fits');
select is(pg_temp.put('visit_booking', 'te', repeat('d', 64), 100, 1000), 'ERR:SM980', 'C3 950 + 100 passes it: refused');
select is(pg_temp.put('visit_booking', 'te', repeat('d', 64), 10, 200001), 'ERR:22023', 'C4 a cap above the platform limit is refused');
select is(pg_temp.w($q$select public.ops_job_sample_put('textiles', 'x', 'te', repeat('e', 64), 5, 'audio/wav', '!!notbase64!!', 1000) ->> 'stored'$q$), 'ERR:22023', 'C5 bad sound data is refused');

-- D. everybody signed in lists and plays; nobody else; nobody reads the table
select is(pg_temp.w($q$select jsonb_array_length(public.job_sample_list())::text$q$, 'a_viewer'), '2', 'D1 a viewer lists the two samples');
select is(pg_temp.w($q$select (public.job_sample_get('textiles', 'enquiry_call_right_away', 'te') ->> 'content_type')$q$, 'b_owner'), 'audio/wav', 'D2 another business plays one');
select is(pg_temp.w($q$select (public.job_sample_get('textiles', 'enquiry_call_right_away', 'te') ->> 'sha8')$q$, 'a_owner'), repeat('b', 8), 'D3 the sample is the latest words');
select is(pg_temp.w($q$select public.job_sample_get('textiles', 'nothing_here', 'te')::text$q$, 'a_owner'), null, 'D4 a missing sample is null');
select is(has_function_privilege('anon', 'public.job_sample_get(text,text,text)', 'execute') or has_function_privilege('anon', 'public.job_sample_list()', 'execute'), false, 'D5 not signed in: nothing');
select is(has_table_privilege('authenticated', 'ops.job_samples', 'select') or has_table_privilege('service_role', 'ops.job_samples', 'select'), false, 'D6 no role reads the table directly');

select * from finish();
rollback;
