-- JOBS S1: the trust pieces (migration 20261231986900; contract 1.0 sections 1, 6, 14, 15, 16).
--   A who may use what (roles, other businesses, no direct writes, the functions' grants)
--   B a job's own name (clears, refuses digits-only, web addresses, e-mail addresses, phone numbers, long names) and what it asks (closed keys)
--   C FAQs (300 + 300, a retry is the same FAQ, an answer with a price, a discount or a promise is refused)
--   D the do-not-call list: add (a number that is not a contact is stored as its KEY only), the list (search, pages, count), the reasons, and the rule that an entry the customer asked for can NEVER be removed
--   E the history of a customer who opted back in (and the lifted list)
--   F the consent tick on a lead source
--   G erasure: the workspace's names and FAQs are tombstoned
-- Every key is a well-formed FAKE (md5 twice): the database cannot verify an HMAC, only store, compare and refuse. All data is synthetic.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.er_plant('b');

create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.oc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.outcome_as(tests.uid(p_user), p_sql);
end $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
create function pg_temp.keys(p_label text) returns text language sql as $$ select jsonb_build_object('version', 1, 'phone', pg_temp.h(p_label))::text $$;
create function pg_temp.mk(p_label text, p_phone text) returns void language plpgsql as $$
begin
  insert into public.contacts (id, tenant_id, company_id, full_name, phone) values (tests.rid(p_label), tests.tid('a'), tests.rid('a_company'), 'Contact ' || p_label, p_phone);
end $$;
-- the owner's calls
create function pg_temp.add(p_user text, p_phone text, p_label text) returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.do_not_call_add(%L, %L, %L::jsonb)::text$q$, tests.tid('a'), p_phone, pg_temp.keys(p_label)))
$$;
create function pg_temp.rm(p_user text, p_id uuid, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.do_not_call_remove(%L, %L)::text$q$, tests.tid('a'), p_id), p_aal)
$$;
create function pg_temp.lst(p_user text, p_q text default null, p_cursor text default null, p_limit int default 50, p_lifted boolean default false) returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.do_not_call_list(%L, %L, %L, %s, %L)::text$q$, tests.tid('a'), p_q, p_cursor, p_limit, p_lifted))
$$;
-- the entry of a contact or of an event, from the list the Owner reads
create function pg_temp.entry(p_id uuid, p_lifted boolean default false) returns jsonb language sql as $$
  select i from jsonb_array_elements(pg_temp.lst('a_owner', null, null, 100, p_lifted)::jsonb -> 'items') i where i ->> 'id' = p_id::text
$$;
-- every page of the list: "<items>/<distinct ids>/<count>"
create function pg_temp.pages(p_limit int) returns text language plpgsql as $$
declare
  v_cursor text;
  v_res jsonb;
  v_ids text[] := '{}';
  v_count int;
  v_loops int := 0;
begin
  loop
    v_res := pg_temp.lst('a_owner', null, v_cursor, p_limit)::jsonb;
    v_count := (v_res ->> 'count')::int;
    v_ids := v_ids || array(select i ->> 'id' from jsonb_array_elements(v_res -> 'items') i);
    v_cursor := v_res ->> 'next_cursor';
    v_loops := v_loops + 1;
    exit when v_cursor is null or v_loops > 30;
  end loop;
  return cardinality(v_ids)::text || '/' || (select count(distinct x) from unnest(v_ids) x)::text || '/' || v_count::text;
end $$;

-- ============================================================================ A. who may use what
select is(pg_temp.sc('a_owner', format($q$select (public.job_meta_ensure(%L, 'speed_to_lead') ->> 'kind')$q$, tests.tid('a'))), 'speed_to_lead', 'A1 the Owner makes the job of a kind');
select is(pg_temp.sc('a_admin', format($q$select (public.job_meta_ensure(%L, 'followups') ->> 'kind')$q$, tests.tid('a'))), 'followups', 'A2 an Admin does too');
select is(pg_temp.sc('a_sales', format($q$select public.job_meta_ensure(%L, 'offers')::text$q$, tests.tid('a'))), 'ERR:42501', 'A3 Sales cannot');
select is(pg_temp.sc('a_viewer', format($q$select public.job_meta_ensure(%L, 'offers')::text$q$, tests.tid('a'))), 'ERR:42501', 'A4 a Viewer cannot');
select is(pg_temp.sc('b_owner', format($q$select public.job_meta_ensure(%L, 'offers')::text$q$, tests.tid('a'))), 'ERR:42501', 'A5 another business''s Owner cannot');
select is(pg_temp.sc('a_owner', format($q$select public.job_meta_ensure(%L, 'custom')::text$q$, tests.tid('a'))), 'ERR:22023', 'A6 a custom job is not made this way');
select is(pg_temp.sc('a_owner', format($q$select public.job_meta_ensure(%L, 'nonsense')::text$q$, tests.tid('a'))), 'ERR:22023', 'A7 an unknown kind is refused');
select is(pg_temp.sc('a_owner', format($q$select public.job_meta_ensure(%L, 'speed_to_lead')::text$q$, tests.tid('a')))::jsonb ->> 'id', (select id::text from public.jobs_meta where tenant_id = tests.tid('a') and kind = 'speed_to_lead'), 'A8 asking again gives the same job');
select is((select count(*)::int from public.jobs_meta where tenant_id = tests.tid('a') and kind = 'speed_to_lead'), 1, 'A9 ... not a second row');
select is(jsonb_array_length(pg_temp.sc('a_viewer', format($q$select public.job_meta_list(%L)::text$q$, tests.tid('a')))::jsonb), 2, 'A10 a Viewer reads the jobs (speed_to_lead and followups)');
select is(pg_temp.sc('outsider', format($q$select public.job_meta_list(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'A11 a stranger does not');
select is(pg_temp.oc('a_owner', $q$update public.jobs_meta set custom_name = 'x'$q$), '42501', 'A12 nobody writes the table directly (update)');
select is(pg_temp.oc('a_owner', format($q$insert into public.jobs_meta (tenant_id, kind, created_by) values (%L, 'custom', %L)$q$, tests.tid('a'), tests.uid('a_owner'))), '42501', 'A13 ... nor inserts');
select is(pg_temp.oc('a_owner', $q$delete from public.job_faqs$q$), '42501', 'A14 ... nor deletes a FAQ');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('job_meta_ensure', 'job_meta_list', 'job_meta_set_name', 'job_meta_set_finds_out', 'job_faq_add', 'job_faq_update', 'job_faq_remove', 'job_faq_list',
                               'do_not_call_list', 'do_not_call_add', 'do_not_call_remove', 'lead_source_consent_tick')
             and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('public', p.oid, 'execute')
             and p.prosecdef and p.proconfig @> array['search_path=""']), 12, 'A15 the twelve public functions: signed-in people only, SECURITY DEFINER, an empty search_path');
select is((select count(*)::int from pg_proc p where p.pronamespace = 'app'::regnamespace
             and p.proname in ('jobs_error', 'ascii_digits', 'job_name_ok', 'job_finds_out_ok', 'job_faq_answer_ok', 'job_meta_json', 'job_faq_json', 'dnc_reason_of', 'dnc_key_reason', 'dnc_entries', 'dnc_opt_in')
             and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0, 'A16 no client role can execute an internal function');

-- ============================================================================ B. a job's own name and what it asks
create function pg_temp.nm(p_user text, p_name text) returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select (public.job_meta_set_name(%L, %L, %L) ->> 'custom_name')$q$, tests.tid('a'), (select id from public.jobs_meta where tenant_id = tests.tid('a') and kind = 'speed_to_lead'), p_name))
$$;
select is(pg_temp.nm('a_owner', 'Priya'), 'Priya', 'B1 the Owner names the helper');
select is(pg_temp.nm('a_owner', '  Ravi 2  '), 'Ravi 2', 'B2 spaces are trimmed; a digit in a name is fine');
select is(pg_temp.nm('a_admin', 'ప్రియ'), 'ప్రియ', 'B3 an Admin may; a Telugu name is fine');
select is(pg_temp.nm('a_sales', 'Hacker'), 'ERR:42501', 'B4 Sales cannot rename');
select is(pg_temp.nm('a_viewer', 'Hacker'), 'ERR:42501', 'B5 a Viewer cannot');
select is(pg_temp.nm('a_owner', '12345'), 'ERR:SM983', 'B6 digits only: refused');
select is(pg_temp.nm('a_owner', '+91 98450 12345'), 'ERR:SM983', 'B7 a phone number: refused');
select is(pg_temp.nm('a_owner', 'Call 9845012345 now'), 'ERR:SM983', 'B8 a name with a phone number in it: refused');
select is(pg_temp.nm('a_owner', 'https://shop.example/x'), 'ERR:SM983', 'B9 a web address: refused');
select is(pg_temp.nm('a_owner', 'www.mysilks'), 'ERR:SM983', 'B10 ... also without the scheme');
select is(pg_temp.nm('a_owner', 'priya@silks.in'), 'ERR:SM983', 'B11 an e-mail address: refused');
select is(pg_temp.nm('a_owner', repeat('a', 41)), 'ERR:SM983', 'B12 more than 40 characters: refused');
select is(pg_temp.nm('a_owner', repeat('a', 40)), repeat('a', 40), 'B13 exactly 40 is fine');
select is(pg_temp.nm('a_owner', 'Priya'), 'Priya', 'B14 a good name again');
select is((select custom_name from public.jobs_meta where tenant_id = tests.tid('a') and kind = 'speed_to_lead'), 'Priya', 'B15 the refusals changed nothing');
select is(pg_temp.nm('a_owner', '   '), null, 'B16 a whitespace name clears it');
select is((select custom_name from public.jobs_meta where tenant_id = tests.tid('a') and kind = 'speed_to_lead'), null, 'B17 ... the name is gone');
select is(pg_temp.nm('a_owner', 'Priya'), 'Priya', 'B18 named again');
select is(pg_temp.nm('a_owner', ''), null, 'B19 an empty name clears it too');
select is(pg_temp.sc('b_owner', format($q$select public.job_meta_set_name(%L, %L, 'Mine')::text$q$, tests.tid('b'), (select id from public.jobs_meta where tenant_id = tests.tid('a') and kind = 'speed_to_lead'))), 'ERR:23503', 'B20 another business cannot rename this job (not found for it)');

create function pg_temp.fo(p_user text, p_kind text, p_json text) returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select (public.job_meta_set_finds_out(%L, %L, %L::jsonb) ->> 'finds_out')$q$, tests.tid('a'), (select id from public.jobs_meta where tenant_id = tests.tid('a') and kind = p_kind), p_json))
$$;
select is(pg_temp.fo('a_owner', 'speed_to_lead', '{"need": true, "visit": false}')::jsonb, '{"need": true, "visit": false}'::jsonb, 'B21 what the helper asks: closed keys, true or false');
select is(pg_temp.fo('a_owner', 'speed_to_lead', '{"quantity": true}')::jsonb, '{"need": true, "quantity": true, "visit": false}'::jsonb, 'B22 a PATCH keeps the keys it does not name');
select is(pg_temp.fo('a_owner', 'speed_to_lead', '{"budget_range": true}'), 'ERR:22023', 'B23 a key of another kind is refused');
select is(pg_temp.fo('a_owner', 'speed_to_lead', '{"need": "yes"}'), 'ERR:22023', 'B24 a value that is not true or false is refused');
select is(pg_temp.fo('a_owner', 'speed_to_lead', '[]'), 'ERR:22023', 'B25 not an object: refused');
select is(pg_temp.fo('a_owner', 'followups', '{"still_interested": true, "budget_range": false}')::jsonb, '{"still_interested": true, "budget_range": false}'::jsonb, 'B26 follow-ups have their own two keys');
select is(pg_temp.fo('a_sales', 'followups', '{"still_interested": false}'), 'ERR:42501', 'B27 Sales cannot change them');
select is((select finds_out::text from public.jobs_meta where tenant_id = tests.tid('a') and kind = 'followups'), '{"budget_range": false, "still_interested": true}', 'B28 the refusals changed nothing');
select throws_ok($$insert into public.jobs_meta (tenant_id, kind, finds_out, created_by) values (tests.tid('a'), 'answer_calls', '{"need": true}', tests.uid('a_owner'))$$, '23514', null, 'B29 a kind with no keys holds none (the table says so too)');

-- ============================================================================ C. FAQs
select pg_temp.sc('a_owner', format($q$select public.job_meta_ensure(%L, 'answer_calls')$q$, tests.tid('a')));
create function pg_temp.job() returns uuid language sql as $$ select id from public.jobs_meta where tenant_id = tests.tid('a') and kind = 'answer_calls' $$;
create function pg_temp.fa(p_user text, p_q text, p_a text, p_id text default null) returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.job_faq_add(%L, %L, %L, %L, %s)::text$q$, tests.tid('a'), pg_temp.job(), p_q, p_a, case when p_id is null then 'gen_random_uuid()' else quote_literal(tests.rid(p_id)::text) || '::uuid' end))
$$;
select is(pg_temp.fa('a_owner', 'What are your hours?', 'We are open from 9 am to 6 pm, every day.', 'faq1')::jsonb ->> 'question', 'What are your hours?', 'C1 the Owner adds a question with its answer');
select is(pg_temp.fa('a_owner', 'What are your hours?', 'We are open from 9 am to 6 pm, every day.', 'faq1')::jsonb ->> 'id', tests.rid('faq1')::text, 'C2 the same id again is the same FAQ (a retry)');
select is((select count(*)::int from public.job_faqs where tenant_id = tests.tid('a')), 1, 'C3 ... not a second row');
select is(pg_temp.fa('a_admin', 'Do you deliver?', 'We deliver inside the city.')::jsonb ->> 'answer', 'We deliver inside the city.', 'C4 an Admin adds one too');
select is(pg_temp.fa('a_sales', 'Q', 'A'), 'ERR:42501', 'C5 Sales cannot');
select is(pg_temp.fa('a_viewer', 'Q', 'A'), 'ERR:42501', 'C6 a Viewer cannot');
select is(pg_temp.fa('a_owner', 'Q', 'Our price is 500 rupees.'), 'ERR:SM984', 'C7 an answer with a price is refused');
select is(pg_temp.fa('a_owner', 'Q', 'We give a discount to regular customers.'), 'ERR:SM984', 'C8 ... a discount');
select is(pg_temp.fa('a_owner', 'Q', 'We promise delivery in two days.'), 'ERR:SM984', 'C9 ... a promise');
select is(pg_temp.fa('a_owner', 'Q', 'Sarees from ₹500'), 'ERR:SM984', 'C10 ... a rupee sign');
select is(pg_temp.fa('a_owner', 'What is the price of a saree?', 'Please ask the shop for the current list.')::jsonb ->> 'question', 'What is the price of a saree?', 'C11 the QUESTION may mention a price: only the answer is checked');
select is(pg_temp.fa('a_owner', '', 'A'), 'ERR:22023', 'C12 an empty question is refused');
select is(pg_temp.fa('a_owner', 'Q', ''), 'ERR:22023', 'C13 an empty answer is refused');
select is(pg_temp.fa('a_owner', repeat('q', 301), 'A'), 'ERR:22023', 'C14 a question over 300 characters is refused');
select is(pg_temp.fa('a_owner', 'Q', repeat('a', 301)), 'ERR:22023', 'C15 an answer over 300 characters is refused');
select is(char_length(pg_temp.fa('a_owner', repeat('q', 300), repeat('a', 300))::jsonb ->> 'answer'), 300, 'C16 exactly 300 + 300 is fine');
select is(pg_temp.sc('a_owner', format($q$select public.job_faq_add(%L, %L, 'Q', 'A')::text$q$, tests.tid('a'), tests.rid('no_such_job'))), 'ERR:23503', 'C17 a job that does not exist: not found');
select is(pg_temp.sc('b_owner', format($q$select public.job_faq_add(%L, %L, 'Q', 'A')::text$q$, tests.tid('b'), pg_temp.job())), 'ERR:23503', 'C18 another business cannot add to this job');
select is(jsonb_array_length(pg_temp.sc('a_viewer', format($q$select public.job_faq_list(%L, %L)::text$q$, tests.tid('a'), pg_temp.job()))::jsonb), 4, 'C19 a Viewer reads the FAQs (4 so far)');
select is(pg_temp.sc('b_owner', format($q$select public.job_faq_list(%L, %L)::text$q$, tests.tid('a'), pg_temp.job())), 'ERR:42501', 'C20 another business does not');
select is(pg_temp.sc('a_owner', format($q$select (public.job_faq_update(%L, %L, %L, null, 'We are open every day from 9 am.') ->> 'answer')$q$, tests.tid('a'), pg_temp.job(), tests.rid('faq1'))), 'We are open every day from 9 am.', 'C21 the Owner changes an answer');
select is(pg_temp.sc('a_owner', format($q$select public.job_faq_update(%L, %L, %L, null, 'We guarantee the lowest rate.')::text$q$, tests.tid('a'), pg_temp.job(), tests.rid('faq1'))), 'ERR:SM984', 'C22 ... but not to a promise');
select is(pg_temp.sc('a_owner', format($q$select public.job_faq_update(%L, %L, %L)::text$q$, tests.tid('a'), pg_temp.job(), tests.rid('faq1'))), 'ERR:22023', 'C23 an update that changes nothing is refused');
select is(pg_temp.sc('a_sales', format($q$select public.job_faq_update(%L, %L, %L, 'Q', null)::text$q$, tests.tid('a'), pg_temp.job(), tests.rid('faq1'))), 'ERR:42501', 'C24 Sales cannot update');
select is((select answer from public.job_faqs where id = tests.rid('faq1')), 'We are open every day from 9 am.', 'C25 the refusals changed nothing');
select is(pg_temp.sc('a_owner', format($q$select public.job_faq_remove(%L, %L, %L)::text$q$, tests.tid('a'), (select id from public.jobs_meta where tenant_id = tests.tid('a') and kind = 'speed_to_lead'), tests.rid('faq1'))), 'ERR:23503', 'C25b the same FAQ under another job is not found');
select is(pg_temp.sc('a_owner', format($q$select (public.job_faq_remove(%L, %L, %L) ->> 'removed')$q$, tests.tid('a'), pg_temp.job(), tests.rid('faq1'))), 'true', 'C26 the Owner removes one (no HTTP DELETE: a function)');
select is(pg_temp.sc('a_owner', format($q$select public.job_faq_remove(%L, %L, %L)::text$q$, tests.tid('a'), pg_temp.job(), tests.rid('faq1'))), 'ERR:23503', 'C27 ... once');
select is(pg_temp.sc('b_owner', format($q$select public.job_faq_remove(%L, %L, %L)::text$q$, tests.tid('b'), pg_temp.job(), (select id from public.job_faqs where tenant_id = tests.tid('a') limit 1))), 'ERR:23503', 'C28 another business cannot remove it (not found for it)');

-- ============================================================================ D. the do-not-call list
select pg_temp.mk('ck1', '+00 90000 10001');   -- the owner will add it
select pg_temp.mk('ck2', '+00 90000 10002');   -- the customer sent STOP on WhatsApp
select pg_temp.mk('ck3', '+00 90000 10003');   -- the customer said it on a call
select pg_temp.mk('ck4', '+00 90000 10004');   -- a complaint
select pg_temp.mk('ck5', '+00 90000 10005');   -- an opt-out with no WhatsApp or call reference
select pg_temp.mk('ck6', '+00 90000 10006');   -- never suppressed
select pg_temp.mk('ck7', '+00 90000 10007');   -- STOP, then the owner records the customer's yes
select pg_temp.mk('ck8', '+00 90000 10008');   -- STOP, then the customer ticks a form
select is(jsonb_array_length(pg_temp.lst('a_owner')::jsonb -> 'items'), 0, 'D0 nothing is on the list yet');
select is((pg_temp.lst('a_owner')::jsonb ->> 'count')::int, 0, 'D0b the count is 0');

-- who may add
select is(pg_temp.add('a_sales', '+91 98450 20001', 'n1'), 'ERR:42501', 'D1 Sales cannot add');
select is(pg_temp.add('a_viewer', '+91 98450 20001', 'n1'), 'ERR:42501', 'D2 a Viewer cannot');
select is(pg_temp.add('b_owner', '+91 98450 20001', 'n1'), 'ERR:42501', 'D3 another business''s Owner cannot add to this list');
select is(pg_temp.add('a_owner', 'abc', 'n1'), 'ERR:22023', 'D4 a phone number that is not one: refused');
select is(pg_temp.sc('a_owner', format($q$select public.do_not_call_add(%L, '+91 98450 20001', %L::jsonb)::text$q$, tests.tid('a'), jsonb_build_object('version', 1, 'email', pg_temp.h('x'))::text)), 'ERR:22023', 'D5 a key set without the phone key: refused');
select is(pg_temp.sc('a_owner', format($q$select public.do_not_call_add(%L, '+91 98450 20001', %L::jsonb)::text$q$, tests.tid('a'), jsonb_build_object('version', 1, 'phone', 'zz')::text)), 'ERR:22023', 'D6 a bad key: refused');
-- a number that is not a contact: the KEY only, with its last four digits
select is(pg_temp.add('a_owner', '+91 98450 20001', 'n1')::jsonb ->> 'phone_masked', '•••• 0001', 'D7 the Owner adds a number: it is shown by its last four digits');
select is((pg_temp.add('a_owner', '+91 98450 20001', 'n1')::jsonb ->> 'reason'), 'added_by_owner', 'D8 the reason is "added_by_owner" (the same number again is the same entry)');
select is((select count(*)::int from suppression.key_events where tenant_id = tests.tid('a') and kind = 'phone' and key_hmac = pg_temp.h('n1')), 1, 'D9 one key event, however often it is added');
select is((select last4 from suppression.key_events where tenant_id = tests.tid('a') and key_hmac = pg_temp.h('n1')), '0001', 'D10 it keeps the last four digits');
select is((select count(*)::int from public.contacts where tenant_id = tests.tid('a') and phone like '+91 98450%'), 0, 'D11 no contact was made for it');
select is(pg_temp.add('a_admin', '+91 98450 20001', 'n1')::jsonb ->> 'id', pg_temp.add('a_owner', '+91 98450 20001', 'n1')::jsonb ->> 'id', 'D12 an Admin adding it again gets the same entry');
select ok(pg_temp.add('a_owner', '+91 98450 20001', 'n1')::jsonb ? 'added_by', 'D13 the entry carries who added it');
select is(pg_temp.sc('a_viewer', format($q$select public.check_suppression(%L, %L::jsonb)::text$q$, tests.tid('a'), jsonb_build_object('phone', jsonb_build_array(pg_temp.h('n1')))::text)), 'ERR:42501', 'D14 (control) a Viewer cannot ask the key check: it needs Sales');
select is(pg_temp.sc('a_sales', format($q$select public.check_suppression(%L, %L::jsonb)::text$q$, tests.tid('a'), jsonb_build_object('phone', jsonb_build_array(pg_temp.h('n1')))::text))::jsonb ->> 'phone', 'true', 'D15 the number is suppressed for every outreach rule (the existing key check says so)');
-- a number that IS a contact: the contact is suppressed through the existing function, as the owner's entry
select is(pg_temp.add('a_owner', '+00 90000 10001', 'k1')::jsonb ->> 'id', tests.rid('ck1')::text, 'D16 a number that is a contact: the entry is the contact''s');
select is((select suppression_reason::text from public.contacts where id = tests.rid('ck1')), 'manual', 'D17 the contact is suppressed, reason manual');
select is((select count(*)::int from suppression.key_events where tenant_id = tests.tid('a') and key_hmac = pg_temp.h('k1')), 0, 'D18 no key-only event for a contact''s number');
select is((select count(*)::int from public.consent_events where contact_id = tests.rid('ck1') and event_type = 'suppressed' and evidence_ref = 'dnc:owner_added'), 1, 'D19 the ledger records it');
-- the customer's own stops
select app.wa_suppress_contact(tests.tid('a'), tests.rid('ck2'), 'opted_out', 'whatsapp:in#abc123', null);
select pg_temp.sc('a_sales', format($q$select public.suppress_contact(%L, %L, 'opted_out', 'verbal', 'call:77')::text$q$, tests.tid('a'), tests.rid('ck3')));
select pg_temp.sc('a_sales', format($q$select public.suppress_contact(%L, %L, 'complained', 'written', 'form:5')::text$q$, tests.tid('a'), tests.rid('ck4')));
select pg_temp.sc('a_sales', format($q$select public.suppress_contact(%L, %L, 'opted_out', 'written', 'form:9')::text$q$, tests.tid('a'), tests.rid('ck5')));
select is(pg_temp.entry(tests.rid('ck2')) ->> 'reason', 'stop_whatsapp', 'D20 STOP on WhatsApp is "stop_whatsapp"');
select is(pg_temp.entry(tests.rid('ck3')) ->> 'reason', 'asked_on_call', 'D21 an opt-out said on a call is "asked_on_call"');
select is(pg_temp.entry(tests.rid('ck4')) ->> 'reason', 'other', 'D22 a complaint is "other"');
select is(pg_temp.entry(tests.rid('ck5')) ->> 'reason', 'other', 'D23 an opt-out with no WhatsApp or call reference is "other" (never removable)');
select is(pg_temp.entry(tests.rid('ck6')), null, 'D24 a contact that is not suppressed is not on the list');
select is(pg_temp.entry(tests.rid('ck2')) ->> 'phone_masked', '•••• 0002', 'D25 a contact''s entry shows the last four digits');
select is(pg_temp.entry(tests.rid('ck2')) ->> 'added_by', null, 'D26 a customer''s own stop has no "added by" (it was not the owner)');
select is(pg_temp.entry(tests.rid('ck2')) ->> 'state', 'active', 'D27 it is active');
select is(pg_temp.entry(tests.rid('ck2')) -> 'history', '[]'::jsonb, 'D28 with no history');
select is((pg_temp.lst('a_viewer')::jsonb ->> 'count')::int, 6, 'D29 a Viewer reads the list: 6 entries (the owner''s number, ck1, ck2, ck3, ck4, ck5)');
select is(pg_temp.lst('b_owner'), 'ERR:42501', 'D30 another business does not');
select is(jsonb_array_length(pg_temp.sc('b_owner', format($q$select (public.do_not_call_list(%L)->'items')::text$q$, tests.tid('b')))::jsonb), 0, 'D31 and has its own, empty list');
-- the list: search, pages, the cursor
select is(jsonb_array_length(pg_temp.lst('a_owner', '10003')::jsonb -> 'items'), 1, 'D32 a search by digits finds the contact whose number holds them (ck3)');
select is(pg_temp.lst('a_owner', '98450 20001')::jsonb -> 'items' -> 0 ->> 'phone_masked', '•••• 0001', 'D33 a whole number is compared with the last four digits of a number kept as a key');
select is(jsonb_array_length(pg_temp.lst('a_owner', '9999')::jsonb -> 'items'), 0, 'D34 a number nobody has: nothing');
select is(jsonb_array_length(pg_temp.lst('a_owner', 'zzzz')::jsonb -> 'items'), 0, 'D35 words that match no one: nothing');
select is(pg_temp.pages(2), '6/6/6', 'D36 pages of two: every entry once, 6 in all');
select is(pg_temp.pages(100), '6/6/6', 'D37 one page: the same');
select is(pg_temp.lst('a_owner', null, 'nonsense'), 'ERR:22023', 'D38 a cursor that is not ours is refused');
select is(pg_temp.lst('a_owner', null, null, 0), 'ERR:22023', 'D39 a limit of 0 is refused');
select is(pg_temp.lst('a_owner', null, null, 101), 'ERR:22023', 'D40 ... and over 100');
select is((pg_temp.lst('a_owner', null, null, 2)::jsonb ->> 'next_cursor') is not null, true, 'D41 a full page has a next cursor');
select is((pg_temp.lst('a_owner', null, null, 100)::jsonb ->> 'next_cursor'), null, 'D42 the last page has none');
select is((pg_temp.lst('a_owner')::jsonb ? 'lifted_count'), false, 'D43 lifted_count is only there when asked for');

-- removing: the Owner only, with the second factor
select is(pg_temp.rm('a_admin', tests.rid('ck1')), 'ERR:42501', 'D44 an Admin cannot remove');
select is(pg_temp.rm('a_sales', tests.rid('ck1')), 'ERR:42501', 'D45 Sales cannot');
select is(pg_temp.rm('a_viewer', tests.rid('ck1')), 'ERR:42501', 'D46 a Viewer cannot');
select is(pg_temp.rm('b_owner', tests.rid('ck1')), 'ERR:42501', 'D47 another business''s Owner cannot');
select is(pg_temp.rm('a_owner', tests.rid('ck1'), 'aal1'), 'ERR:SM306', 'D48 the Owner needs the second factor');
select is((select suppressed_at is not null from public.contacts where id = tests.rid('ck1')), true, 'D49 so nothing was removed');
-- the rule: what the customer asked for can NEVER be removed
select is(pg_temp.rm('a_owner', tests.rid('ck2')), 'ERR:SM985', 'D50 STOP on WhatsApp: the Owner cannot remove it (stopped_by_customer)');
select is(pg_temp.rm('a_owner', tests.rid('ck3')), 'ERR:SM985', 'D51 said on a call: the same');
select is(pg_temp.rm('a_owner', tests.rid('ck4')), 'ERR:SM986', 'D52 a complaint ("other") has no Remove');
select is(pg_temp.rm('a_owner', tests.rid('ck5')), 'ERR:SM986', 'D53 an opt-out we cannot place ("other") has no Remove');
select is((select count(*)::int from public.contacts where id in (tests.rid('ck2'), tests.rid('ck3'), tests.rid('ck4'), tests.rid('ck5')) and suppressed_at is not null), 4, 'D54 all four are still suppressed');
select is(pg_temp.rm('a_owner', tests.rid('ck6')), 'ERR:23503', 'D55 a contact that is not on the list: not found');
select is(pg_temp.rm('a_owner', tests.rid('no_such_entry')), 'ERR:23503', 'D56 an id that is not an entry: not found');
-- adding a number that the customer stopped does not change its reason
select is(pg_temp.add('a_owner', '+00 90000 10002', 'k2')::jsonb ->> 'reason', 'stop_whatsapp', 'D57 the Owner adding a stopped number does not turn it into the owner''s own entry');
select is(pg_temp.rm('a_owner', tests.rid('ck2')), 'ERR:SM985', 'D58 ... so it still cannot be removed');
-- a number kept as a key carrying a stronger reason cannot be removed either
select pg_temp.add('a_owner', '+91 98450 20002', 'n2');
insert into suppression.key_events (tenant_id, kind, key_hmac, key_version, event, reason, created_by) values (tests.tid('a'), 'phone', pg_temp.h('n2'), 1, 'suppressed', 'opted_out', null);
select is(pg_temp.entry((select id from suppression.key_events where key_hmac = pg_temp.h('n2') and last4 is not null)) ->> 'reason', null, 'D59 (the owner''s event is no longer the latest: the entry is hidden until the owner adds the number again)');
select is(pg_temp.add('a_owner', '+91 98450 20002', 'n2')::jsonb ->> 'reason', 'other', 'D60 added again: it shows as "other", because an opt-out of the same number is on its record');
select is(pg_temp.rm('a_owner', (pg_temp.add('a_owner', '+91 98450 20002', 'n2')::jsonb ->> 'id')::uuid), 'ERR:SM986', 'D61 and the Owner cannot remove it');
select is(pg_temp.sc('a_sales', format($q$select public.check_suppression(%L, %L::jsonb)::text$q$, tests.tid('a'), jsonb_build_object('phone', jsonb_build_array(pg_temp.h('n2')))::text))::jsonb ->> 'phone', 'true', 'D62 it is still suppressed');
-- what the Owner may remove: his own entries
select is(pg_temp.rm('a_owner', tests.rid('ck1'))::jsonb ->> 'state', 'removed', 'D63 the Owner removes the contact he added to the list');
select is((select suppressed_at is null from public.contacts where id = tests.rid('ck1')), true, 'D64 the contact is not suppressed any more');
select is((select count(*)::int from public.consent_events where contact_id = tests.rid('ck1') and event_type = 'suppression_lifted' and evidence_ref = 'dnc:owner_removed' and recorded_by = tests.uid('a_owner')), 1, 'D65 the removal is a recorded event (who, and that it was the owner''s removal)');
select is(pg_temp.rm('a_owner', tests.rid('ck1')), 'ERR:23503', 'D66 removing it again: not found');
select is(pg_temp.entry(tests.rid('ck1')), null, 'D67 it left the list');
select is(pg_temp.rm('a_owner', (pg_temp.add('a_owner', '+91 98450 20001', 'n1')::jsonb ->> 'id')::uuid)::jsonb ->> 'state', 'removed', 'D68 the Owner removes a number he added that is not a contact');
select is((select count(*)::int from suppression.key_events where tenant_id = tests.tid('a') and key_hmac = pg_temp.h('n1') and event = 'lifted' and created_by = tests.uid('a_owner')), 1, 'D69 the removal is a recorded key event');
select is(pg_temp.sc('a_sales', format($q$select public.check_suppression(%L, %L::jsonb)::text$q$, tests.tid('a'), jsonb_build_object('phone', jsonb_build_array(pg_temp.h('n1')))::text))::jsonb ->> 'phone', 'false', 'D70 the number is allowed again');
select is((pg_temp.lst('a_owner')::jsonb ->> 'count')::int, 5, 'D71 the count follows: ck2, ck3, ck4, ck5 and n2');
select is((pg_temp.lst('a_owner', null, null, 100, true)::jsonb ->> 'lifted_count')::int, 0, 'D72 an owner''s own removal is not a "lifted" entry (only a customer who came back is)');

-- ============================================================================ E. a customer who opts back in: history and the lifted list
select app.wa_suppress_contact(tests.tid('a'), tests.rid('ck7'), 'opted_out', 'whatsapp:in#def456', null);
select app.wa_suppress_contact(tests.tid('a'), tests.rid('ck8'), 'opted_out', 'whatsapp:in#ghi789', null);
select is((select app.dnc_opt_in(tests.tid('a'), tests.rid('ck6'), 'customer_message', null)), null, 'E1 a contact that is not suppressed: nothing to lift');
select throws_ok($$select app.dnc_opt_in(tests.tid('a'), tests.rid('ck7'), 'because', null)$$, '22023', null, 'E2 the way a customer came back is a closed word');
select throws_ok($$select app.dnc_opt_in(tests.tid('a'), tests.rid('no_such_contact'), 'customer_message', null)$$, '23503', null, 'E3 a contact that does not exist: not found');
select is((select app.dnc_opt_in(tests.tid('a'), tests.rid('ck7'), 'owner_recorded_yes', tests.uid('a_owner')) is not null), true, 'E4 the owner records the customer''s yes (how it was given)');
select is((select app.dnc_opt_in(tests.tid('a'), tests.rid('ck8'), 'form_tick', null) is not null), true, 'E5 a customer ticks a form');
select is((select app.dnc_opt_in(tests.tid('a'), tests.rid('ck2'), 'customer_message', null) is not null), true, 'E6 a customer writes that they want contact (the STOP of ck2 comes off)');
select is((select suppressed_at is null from public.contacts where id = tests.rid('ck2')), true, 'E7 the contact is no longer suppressed');
select is(pg_temp.entry(tests.rid('ck2')), null, 'E8 the lifted entry LEAVES the list');
select is((pg_temp.lst('a_owner')::jsonb ->> 'count')::int, 4, 'E9 the count is the active entries only (ck3, ck4, ck5, n2)');
select is((pg_temp.lst('a_owner', null, null, 100, true)::jsonb ->> 'lifted_count')::int, 3, 'E10 ?include=lifted counts the three who came back, apart');
select is((pg_temp.lst('a_owner', null, null, 100, true)::jsonb ->> 'count')::int, 4, 'E11 ... and count stays the active ones');
select is(pg_temp.entry(tests.rid('ck2'), true) ->> 'state', 'lifted', 'E12 with include=lifted the entry is back, state "lifted"');
select is(pg_temp.entry(tests.rid('ck2'), true) -> 'history' -> 0 ->> 'how', 'customer_message', 'E13 its history says how: customer_message');
select is(pg_temp.entry(tests.rid('ck2'), true) -> 'history' -> 0 ->> 'by', 'customer', 'E14 ... by the customer');
select is(pg_temp.entry(tests.rid('ck7'), true) -> 'history' -> 0 ->> 'how', 'owner_recorded_yes', 'E15 the owner recorded a yes: owner_recorded_yes');
select is(pg_temp.entry(tests.rid('ck7'), true) -> 'history' -> 0 ->> 'by', 'owner_recorded', 'E16 ... by owner_recorded');
select is(pg_temp.entry(tests.rid('ck8'), true) -> 'history' -> 0 ->> 'how', 'form_tick', 'E17 a form tick: form_tick');
select is(pg_temp.entry(tests.rid('ck2'), true) -> 'history' -> 0 ? 'at', true, 'E18 each history line has its time');
select is(pg_temp.entry(tests.rid('ck2'), true) ->> 'reason', 'stop_whatsapp', 'E19 a lifted entry still says why it was there');
select is(pg_temp.entry(tests.rid('ck1'), true), null, 'E20 the owner''s own removal (ck1) is not in the lifted list');
select is((select suppressed_at is null and whatsapp_consent <> 'granted' from public.contacts where id = tests.rid('ck2')), true, 'E21 lifting the stop does NOT give consent back');
-- stopped again: an active entry that remembers
select app.wa_suppress_contact(tests.tid('a'), tests.rid('ck2'), 'opted_out', 'whatsapp:in#jkl012', null);
select is(pg_temp.entry(tests.rid('ck2')) ->> 'state', 'active', 'E22 stopped again: back on the list');
select is(jsonb_array_length(pg_temp.entry(tests.rid('ck2')) -> 'history'), 1, 'E23 with the history of the first time');
select is(pg_temp.rm('a_owner', tests.rid('ck2')), 'ERR:SM985', 'E24 and it cannot be removed');

-- ============================================================================ F. the consent tick on a lead source
insert into public.lead_sources (id, tenant_id, kind, tag, label, token_hash, token_hint, created_by)
values (tests.rid('src1'), tests.tid('a'), 'email_forward', 'webhook', 'Portal mail', encode(sha256(convert_to('src1', 'UTF8')), 'hex'), 'wxyz', tests.uid('a_owner')),
       (tests.rid('src2'), tests.tid('a'), 'website_form', 'website_form', 'Website', encode(sha256(convert_to('src2', 'UTF8')), 'hex'), 'abcd', tests.uid('a_owner'));
select is((select consent_confirmed_at is null and consent_confirmed_by is null and consent_text_version is null from public.lead_sources where id = tests.rid('src1')), true, 'F1 a source starts with no tick');
select is(pg_temp.sc('a_sales', format($q$select public.lead_source_consent_tick(%L, array['email_forward'], 'tick-1')::text$q$, tests.tid('a'))), 'ERR:42501', 'F2 Sales cannot tick');
select is(pg_temp.sc('a_viewer', format($q$select public.lead_source_consent_tick(%L, array['email_forward'], 'tick-1')::text$q$, tests.tid('a'))), 'ERR:42501', 'F3 a Viewer cannot');
select is(pg_temp.sc('b_owner', format($q$select public.lead_source_consent_tick(%L, array['email_forward'], 'tick-1')::text$q$, tests.tid('a'))), 'ERR:42501', 'F4 another business cannot');
select is(pg_temp.sc('a_owner', format($q$select public.lead_source_consent_tick(%L, array['email_forward'], 'Not a Version')::text$q$, tests.tid('a'))), 'ERR:22023', 'F5 the wording version is a closed word');
select is(pg_temp.sc('a_owner', format($q$select public.lead_source_consent_tick(%L, array[]::text[], 'tick-1')::text$q$, tests.tid('a'))), 'ERR:22023', 'F6 no kinds: refused');
select is(pg_temp.sc('a_owner', format($q$select (public.lead_source_consent_tick(%L, array['email_forward'], 'tick-1') ->> 'updated')$q$, tests.tid('a'))), '1', 'F7 the Owner ticks: one source');
select is((select consent_confirmed_by::text || '|' || consent_text_version from public.lead_sources where id = tests.rid('src1')), tests.uid('a_owner')::text || '|tick-1', 'F8 who and which wording are stored');
select is((select consent_confirmed_at is not null from public.lead_sources where id = tests.rid('src1')), true, 'F9 and when');
select is((select consent_confirmed_at is null from public.lead_sources where id = tests.rid('src2')), true, 'F10 another kind of source is not touched');
select is(pg_temp.sc('a_admin', format($q$select (public.lead_source_consent_tick(%L, array['website_form', 'webhook'], 'tick-2') ->> 'updated')$q$, tests.tid('a'))), '1', 'F11 an Admin ticks the website source');
select is((select consent_confirmed_by::text from public.lead_sources where id = tests.rid('src2')), tests.uid('a_admin')::text, 'F12 and it is the Admin who is recorded');
select throws_ok($$update public.lead_sources set consent_confirmed_by = null where id = tests.rid('src2')$$, '23514', null, 'F13 who and when come together (the table says so)');
select throws_ok($$update public.lead_sources set consent_text_version = 'Bad Word' where id = tests.rid('src2')$$, '23514', null, 'F14 the wording version is a closed word (the table says so)');

-- ============================================================================ G. erasure: the business's own words are tombstoned with the workspace (tenant b was planted at the top)
select tests.scalar_as(tests.uid('b_owner'), format('select public.request_erasure(%L, %L, ''tenant'')', tests.rid('t1'), tests.tid('b')));
update public.erasure_requests set execute_after = now() - interval '1 minute' where id = tests.rid('t1');
create temp table gres as select tests.scalar_as(tests.uid('b_owner'), format('select public.execute_erasure(%L, false)', tests.rid('t1')))::jsonb as r;
select is((select r ->> 'status' from gres), 'executed', 'G1 the workspace was erased');
select is((select custom_name from public.jobs_meta where id = tests.rid('b_er_jmeta')), 'erased:1', 'G2 the helper''s own name is tombstoned');
select results_eq(format($$select question, answer from public.job_faqs where id = %L$$, tests.rid('b_er_jfaq')), $$values ('erased:1'::text, 'erased:1'::text)$$, 'G3 the FAQ''s question and answer are tombstoned');
select is(tests.er_hits('b', 'jmq7|jfq7'), '{}'::text[], 'G4 no trace of either anywhere, the audit log included');
select is((select custom_name from public.jobs_meta where tenant_id = tests.tid('a') and kind = 'speed_to_lead'), 'Priya', 'G5 the other business is untouched');

select * from finish();
rollback;
