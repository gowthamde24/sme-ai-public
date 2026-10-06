-- T010 part 2 (docs/plans/t010-integration.md, migration 20261024090000): touches, the cadence policy, follow-up drafts. NOTHING IS SENT: every row here is a person's record.
--   A catalog (definer, search_path, grants, no client write)   B create_followup_policy_version (Owner + aal2, role first, every shape, replay, effective dates)
--   C record_touch (role x aal, shapes, replay, the outbound GATE cell by cell, an inbound touch is always recordable, the cap, side effects)
--   D create_followup_draft (role x aal, the gate, SM227 stops, SM222, SM226 forgeries, SM225 reasons, SM223, template, replay)   E approve_followup_draft (role x aal, SM223, SM224, the gate again, SM227 again)
--   F discard_followup_draft   G record_draft_sent   H the contact trigger (suppress / erase discard open drafts)   I direct writes and the guard triggers
--   J followup_gate (the read)   K audit   L app.followup_blocker, hand-made requests   M invariants over every draft
-- Every key is a well-formed FAKE (md5 twice): the database cannot verify an HMAC, only store, compare and refuse. All data is synthetic. The engine itself is pinned against these rules by
-- tests/integration/test_followup_equivalence.py (the real package, generated histories).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();
select tests.seed_t009();
select tests.as_aal('aal2');

-- ---------------------------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------------------------
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
-- run as a user at an assurance level; 'ok', or SQLSTATE[:DETAIL]
create function pg_temp.at(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform tests.as_aal(p_aal);
  r := tests.error_full_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
  perform tests.as_aal('aal2');
  if r = 'ok' then return 'ok'; end if;
  return split_part(r, '|', 1) || case when split_part(r, '|', 3) <> '' then ':' || split_part(r, '|', 3) else '' end;
end $$;
create function pg_temp.try(p_user text, p_sql text) returns text language sql as $$ select pg_temp.at('aal2', p_user, p_sql) $$;
-- the whole error a caller can see
create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.error_full_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql); end $$;
-- a scalar as a user; 'ERR:<sqlstate>' on failure
create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;
create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
-- a fixture step that must work
create function pg_temp.run(p_user text, p_sql text) returns void language plpgsql as $$
declare r text;
begin
  r := pg_temp.try(p_user, p_sql);
  if r <> 'ok' then raise exception 'fixture step failed (%): %', r, left(p_sql, 200); end if;
end $$;
create function pg_temp.today() returns date language sql as $$ select app.quote_today() $$;
create function pg_temp.asof(p_shift interval default '0') returns text language sql as $$ select to_char((now() + p_shift) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;
-- the fixed UTC offset (minutes) that makes the recipient's local clock read about 12:00 NOW, whatever time the tests run
create function pg_temp.noon_offset() returns integer language sql as $$
  select case when ((720 - (extract(hour from now() at time zone 'UTC')::int * 60 + extract(minute from now() at time zone 'UTC')::int) + 1440) % 1440) > 840
              then ((720 - (extract(hour from now() at time zone 'UTC')::int * 60 + extract(minute from now() at time zone 'UTC')::int) + 1440) % 1440) - 1440
              else ((720 - (extract(hour from now() at time zone 'UTC')::int * 60 + extract(minute from now() at time zone 'UTC')::int) + 1440) % 1440) end $$;
-- a policy document; every part can be overridden
create function pg_temp.pol(p_gaps text default '[1, 2]', p_max int default 3, p_qs text default '03:00', p_qe text default '04:00', p_wd text default '[0, 1, 2, 3, 4, 5, 6]',
                            p_hol text default '[]', p_min int default 0, p_off int default null) returns text language sql as $$
  select jsonb_build_object('gap_days', p_gaps::jsonb, 'max_touches', p_max, 'quiet_hours', jsonb_build_object('start', p_qs, 'end', p_qe), 'allowed_weekdays', p_wd::jsonb,
                            'holidays', p_hol::jsonb, 'min_gap_hours', p_min, 'recipient_utc_offset_minutes', coalesce(p_off, pg_temp.noon_offset()))::text $$;
create function pg_temp.mkpol(p_label text, p_policy text default null, p_tenant text default 'a', p_from date default null, p_user text default 'a_owner') returns text language sql as $$
  select pg_temp.try(p_user, format('select public.create_followup_policy_version(%L, %L, %L, %L::jsonb)', tests.rid('pol_' || p_label), tests.tid(p_tenant),
                                    coalesce(p_from, pg_temp.today()), coalesce(p_policy, pg_temp.pol()))) $$;
-- a lead with its own contact: keyed, consent granted for e-mail and WhatsApp (by the Owner), or any part left out
create function pg_temp.mklead(p_label text, p_keyed boolean default true, p_consent boolean default true, p_email boolean default true, p_status text default 'new') returns void language plpgsql as $$
begin
  insert into public.contacts (id, tenant_id, company_id, full_name, email, phone)
  values (tests.rid(p_label || '_c'), tests.tid('a'), tests.rid('a_company'), 'Contact ' || p_label, case when p_email then p_label || '@example.test' end,
          '+00 9' || lpad((abs(hashtext(p_label)) % 100000)::text, 5, '0'));
  insert into public.leads (id, tenant_id, company_id, contact_id, status, created_at) values (tests.rid(p_label), tests.tid('a'), tests.rid('a_company'), tests.rid(p_label || '_c'), p_status::public.lead_status, now() - interval '30 days');
  if p_keyed then
    perform pg_temp.run('a_owner', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid(p_label || '_c'),
            jsonb_build_object('version', 1, 'email', case when p_email then pg_temp.h(p_label || '_e') end, 'phone', pg_temp.h(p_label || '_p'))));
  end if;
  if p_consent then
    if p_email then
      perform pg_temp.run('a_owner', format($q$select public.record_consent(%L, %L, 'email', 'granted', 'explicit_consent', 'web_form', %L)$q$, tests.tid('a'), tests.rid(p_label || '_c'), 'ref:' || p_label));
    end if;
    perform pg_temp.run('a_owner', format($q$select public.record_consent(%L, %L, 'whatsapp', 'granted', 'explicit_consent', 'web_form', %L)$q$, tests.tid('a'), tests.rid(p_label || '_c'), 'refw:' || p_label));
  end if;
end $$;
-- a touch by a user; p_ago null = now (the database clock)
create function pg_temp.touch(p_user text, p_label text, p_lead text, p_dir text, p_channel text default 'email', p_ago interval default null) returns text language sql as $$
  select pg_temp.try(p_user, format('select public.record_touch(%L, %L, %L, %L, %L)', tests.rid('t_' || p_label), tests.rid(p_lead), p_dir, p_channel,
                                    case when p_ago is null then null else (now() - p_ago)::text end)) $$;
-- the request the database builds, and the honest engine result for a draft
create function pg_temp.polid(p_lead text) returns uuid language sql as $$ select app.followup_active_policy_version((select tenant_id from public.leads where id = tests.rid(p_lead)), pg_temp.today()) $$;
create function pg_temp.req(p_lead text, p_asof text default null) returns jsonb language sql as $$ select app.followup_build(tests.rid(p_lead), coalesce(p_asof, pg_temp.asof()), pg_temp.polid(p_lead)) $$;
create function pg_temp.res(p_req jsonb, p_ver text default '1.0.0', p_reqtext text default null) returns jsonb language sql as $$
  select jsonb_build_object('action', 'draft_followup', 'reason_code', 'eligible_now', 'terminal', false,
           'touch_number', (select count(*) + 1 from jsonb_array_elements(p_req -> 'history') h where h ->> 'direction' = 'out'), 'next_eligible_at', p_req ->> 'as_of',
           'engine_version', p_ver, 'canonical_hash', app.followup_request_hash(p_ver, coalesce(p_reqtext, p_req::text)), 'trace', '[]'::jsonb) $$;
-- the SQL of a create call; p_req / p_res / p_reqtext override the honest request / result / request text (a forgery)
create function pg_temp.cd(p_label text, p_lead text, p_channel text default 'email', p_req jsonb default null, p_res jsonb default null, p_ver text default '1.0.0', p_reqtext text default null)
returns text language plpgsql as $$
declare r jsonb := coalesce(p_req, pg_temp.req(p_lead));
begin
  return format('select public.create_followup_draft(%L, %L, %L, %L, %L, %L)', tests.rid('d_' || p_label), tests.rid(p_lead), p_channel, p_ver, coalesce(p_reqtext, r::text),
                coalesce(p_res, pg_temp.res(r, p_ver, p_reqtext))::text);
end $$;
create function pg_temp.mk(p_user text, p_label text, p_lead text, p_channel text default 'email') returns text language sql as $$
  select pg_temp.try(p_user, pg_temp.cd(p_label, p_lead, p_channel)) $$;
create function pg_temp.did(p_label text) returns uuid language sql as $$ select tests.rid('d_' || p_label) $$;
create function pg_temp.dst(p_label text) returns text language sql as $$ select status::text from public.followup_drafts where id = pg_temp.did(p_label) $$;
create function pg_temp.approve(p_user text, p_label text, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.at(p_aal, p_user, format('select public.approve_followup_draft(%L, %L)', pg_temp.did(p_label), (select state_hash from public.followup_drafts where id = pg_temp.did(p_label)))) $$;
create function pg_temp.sent(p_user text, p_label text, p_touch text default null) returns text language sql as $$
  select pg_temp.try(p_user, format('select public.record_draft_sent(%L, %L, null)', pg_temp.did(p_label), tests.rid('s_' || coalesce(p_touch, p_label)))) $$;
create function pg_temp.nd(p_lead text) returns bigint language sql as $$ select count(*) from public.followup_drafts where lead_id = tests.rid(p_lead) $$;
create function pg_temp.nt(p_lead text) returns bigint language sql as $$ select count(*) from public.lead_touches where lead_id = tests.rid(p_lead) $$;
create function pg_temp.gate(p_lead text, p_channel text default 'email', p_user text default 'a_sales') returns jsonb language sql as $$ select pg_temp.sc(p_user, format('select public.followup_gate(%L, %L)', tests.rid(p_lead), p_channel))::jsonb $$;
-- a contact marked erased the way only an erasure may (the guard trigger is switched off for this one statement, inside the test transaction)
create function pg_temp.mark_erased(p_contact text) returns void language plpgsql as $$
begin
  alter table public.contacts disable trigger contacts_guard_erased;
  update public.contacts set erased_at = now() where id = tests.rid(p_contact);
  alter table public.contacts enable trigger contacts_guard_erased;
end $$;
-- the matrix: one cell per (role, aal) of a call; returns 'user@aal=result' for every cell that differs from the expectation
create function pg_temp.cells(p_sql text, p_expect text) returns text language plpgsql as $$
declare
  c text[];
  r text;
  bad text := '';
begin
  foreach c slice 1 in array array[['a_owner', 'aal1'], ['a_owner', 'aal2'], ['a_admin', 'aal1'], ['a_admin', 'aal2'], ['a_sales', 'aal1'], ['a_sales', 'aal2'], ['a_viewer', 'aal1'], ['a_viewer', 'aal2'],
                                    ['b_owner', 'aal2'], ['outsider', 'aal2'], ['anon', 'aal2']] loop
    r := pg_temp.at(c[2], c[1], p_sql);
    -- p_expect is a comma list of user@aal=result cells; every unlisted cell must be 42501
    if (select coalesce((regexp_match(p_expect, '(^|,)' || c[1] || '@' || c[2] || '=([^,]*)'))[2], '42501')) is distinct from r then
      bad := bad || c[1] || '@' || c[2] || '=' || r || ' ';
    end if;
  end loop;
  return nullif(bad, '');
end $$;

-- ============================================================================ A. catalog
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('create_followup_policy_version', 'followup_gate', 'record_touch', 'create_followup_draft', 'approve_followup_draft', 'discard_followup_draft', 'record_draft_sent',
                               'persist_question_drafts', 'decide_question_draft')
             and p.prosecdef and p.proconfig = array['search_path=""']), 9::bigint, 'A1 the nine public follow-up functions are SECURITY DEFINER with an empty search_path');
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('create_followup_policy_version', 'followup_gate', 'record_touch', 'create_followup_draft', 'approve_followup_draft', 'discard_followup_draft', 'record_draft_sent',
                               'persist_question_drafts', 'decide_question_draft')), 9::bigint, 'A2 each has exactly one overload');
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('create_followup_policy_version', 'followup_gate', 'record_touch', 'create_followup_draft', 'approve_followup_draft', 'discard_followup_draft', 'record_draft_sent',
                               'persist_question_drafts', 'decide_question_draft')
             and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('public', p.oid, 'execute')),
          9::bigint, 'A3 signed-in people may execute them; anon and PUBLIC may not');
select is((select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace
             and (p.proname like 'followup\_%' or p.proname like 'question\_drafts\_%' or p.proname in ('int2_array_within', 'date_array_ok', 'int2_array_distinct', 'contacts_discard_followup_drafts'))
             and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
          0::bigint, 'A4 no internal follow-up helper is callable by a client role');
select cmp_ok((select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname like 'followup\_%'), '>=', 12::bigint, 'A4b (the helper family exists: the check above is not vacuous)');
select is((select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('followup_policy_versions', 'followup_drafts', 'lead_touches', 'question_drafts', 'followup_engine_versions', 'followup_templates')
            and c.relrowsecurity and c.relforcerowsecurity), 6::bigint, 'A5 row level security is enabled and forced on all six new tables');
select is((select count(*) from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name in ('followup_policy_versions', 'followup_drafts', 'lead_touches', 'question_drafts')
             and g.grantee in ('authenticated', 'anon', 'public') and g.privilege_type <> 'SELECT'), 0::bigint, 'A6 no client role holds INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER on them');
select is((select count(*) from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name in ('followup_policy_versions', 'followup_drafts', 'lead_touches', 'question_drafts')
             and g.grantee = 'anon'), 0::bigint, 'A7 anon holds nothing on them');
select is((select count(*) from information_schema.role_table_grants g where g.table_schema = 'public' and g.table_name in ('followup_engine_versions', 'followup_templates')
             and g.grantee in ('authenticated', 'anon', 'public')), 0::bigint, 'A8 the allow-list and the templates are not readable by clients');
select is((select array_agg(version) from public.followup_engine_versions), array['1.0.0'], 'A9 the engine allow-list holds exactly 1.0.0');
select is((select string_agg(code, ',' order by code) from public.followup_templates), 'followup_gentle,followup_last,followup_reminder', 'A10 three closed templates');
select is((select count(*) from public.followup_templates where body ~ '[0-9@]' or app.text_has_contact(body) or not app.text_is_clean(body)), 0::bigint, 'A11 no template holds a digit, an at-sign, contact data or a hidden character (no variables at all)');
select is(app.followup_template_code(2, 3) || ',' || app.followup_template_code(3, 3) || ',' || app.followup_template_code(3, 5) || ',' || app.followup_template_code(2, 2) || ',' || app.followup_template_code(5, 5),
          'followup_gentle,followup_last,followup_reminder,followup_last,followup_last', 'A12 the wording: the last allowed touch, then the second, then every other');
select is((select string_agg(t.tgrelid::regclass::text, ',' order by t.tgrelid::regclass::text) from pg_trigger t where t.tgrelid in ('public.followup_policy_versions'::regclass, 'public.followup_drafts'::regclass,
            'public.lead_touches'::regclass, 'public.question_drafts'::regclass) and not t.tgisinternal and t.tgname like '%no\_truncate' and t.tgenabled = 'O'),
          'followup_drafts,followup_policy_versions,lead_touches,question_drafts', 'A13 every new table has its enabled TRUNCATE guard');
select is((select count(*) from pg_trigger t where t.tgrelid = 'public.contacts'::regclass and t.tgname = 'contacts_discard_followup_drafts' and t.tgenabled = 'O'), 1::bigint, 'A14 the contact trigger exists and is enabled');
select is((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = 'public.followup_draft_status'::regtype), 'draft,approved,discarded,recorded_sent', 'A15 the draft states');
select is((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = 'public.followup_discard_code'::regtype), 'person,superseded,reply_recorded,suppressed,erased', 'A16 the discard reasons');
select is((select indexdef from pg_indexes where indexname = 'followup_drafts_one_active_key') ~ 'UNIQUE.*\(tenant_id, lead_id, touch_number\).*WHERE.*draft.*approved', true, 'A17 one ACTIVE draft per (tenant, lead, touch number)');
select is((select count(*) from pg_indexes where indexname in ('lead_touches_draft_key', 'question_drafts_one_active_key')), 2::bigint, 'A18 one touch per draft; one active question per (requirement, code, line)');
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'followup_gate' and p.prosecdef), 1::bigint, 'A19 the read is a definer function too (the key tables are private)');

-- ============================================================================ B. create_followup_policy_version
create temp table pol_ok as select pg_temp.pol() as doc;
select is(pg_temp.mkpol('p1'), 'ok', 'B1 the Owner (aal2) creates a policy version');
select is((select version_no || '/' || max_touches || '/' || quiet_start || '/' || quiet_end || '/' || cardinality(gap_days) || '/' || min_gap_hours from public.followup_policy_versions where id = tests.rid('pol_p1')),
          '1/3/03:00/04:00/2/0', 'B2 it is stored as given (a typed row, not a blob)');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.create_followup_policy_version(%L, %L, %L, %L::jsonb)', tests.rid('pol_p1'), tests.tid('a'), pg_temp.today(), pg_temp.pol())), 'replayed'), 'true', 'B3 an exact retry replays');
select is(pg_temp.try('a_owner', format('select public.create_followup_policy_version(%L, %L, %L, %L::jsonb)', tests.rid('pol_p1'), tests.tid('a'), pg_temp.today(), pg_temp.pol(p_min => 5))), '23505', 'B4 the same id with another policy is the constant conflict');
select is(pg_temp.try('a_owner', format('select public.create_followup_policy_version(%L, %L, %L, %L::jsonb)', tests.rid('pol_p1'), tests.tid('b'), pg_temp.today(), pg_temp.pol())), '42501', 'B4b ... and for another tenant it is the generic refusal (the Owner is not theirs)');
select is(pg_temp.cells(format('select public.create_followup_policy_version(%L, %L, %L, %L::jsonb)', gen_random_uuid(), tests.tid('a'), pg_temp.today(), pg_temp.pol()),
                        'a_owner@aal1=SM306,a_owner@aal2=ok'), null, 'B5 the matrix: ONLY the Owner at aal2 may create a policy (the Owner at aal1 is SM306 below; the other nine cells are 42501)');
select is(pg_temp.at('aal1', 'a_owner', format('select public.create_followup_policy_version(%L, %L, %L, %L::jsonb)', gen_random_uuid(), tests.tid('a'), pg_temp.today(), pg_temp.pol())), 'SM306', 'B6 the Owner at aal1 is asked for a second factor');
select is(pg_temp.at('aal1', 'a_admin', format('select public.create_followup_policy_version(%L, %L, %L, %L::jsonb)', gen_random_uuid(), tests.tid('a'), pg_temp.today(), pg_temp.pol())), '42501', 'B7 an Admin at aal1 is refused as a stranger is (the role is proven BEFORE the second factor)');
select is(pg_temp.err('a_admin', format('select public.create_followup_policy_version(%L, %L, %L, %L::jsonb)', gen_random_uuid(), tests.tid('a'), pg_temp.today(), pg_temp.pol())),
          pg_temp.err('outsider', format('select public.create_followup_policy_version(%L, %L, %L, %L::jsonb)', gen_random_uuid(), gen_random_uuid(), pg_temp.today(), pg_temp.pol())), 'B8 an Admin''s refusal and an outsider''s on an unknown tenant are the SAME answer');
select is(pg_temp.try('a_owner', format('select public.create_followup_policy_version(null, %L, %L, %L::jsonb)', tests.tid('a'), pg_temp.today(), pg_temp.pol())), '22023', 'B9 a null id is invalid (after the role)');
select is(pg_temp.try('a_owner', format('select public.create_followup_policy_version(%L, null, %L, %L::jsonb)', gen_random_uuid(), pg_temp.today(), pg_temp.pol())), '42501', 'B9b a null tenant is the generic refusal');
select is(pg_temp.try('a_owner', format('select public.create_followup_policy_version(%L, %L, null, %L::jsonb)', gen_random_uuid(), tests.tid('a'), pg_temp.pol())), '22023', 'B9c a null date is invalid');
select is(pg_temp.try('a_owner', format('select public.create_followup_policy_version(%L, %L, %L, null)', gen_random_uuid(), tests.tid('a'), pg_temp.today())), '22023', 'B9d a null policy is invalid');

-- shapes (22023) and values (23514), one at a time
create function pg_temp.pol_try(p_policy text, p_from date default null) returns text language sql as $$
  select pg_temp.try('a_owner', format('select public.create_followup_policy_version(%L, %L, %L, %L::jsonb)', gen_random_uuid(), tests.tid('a'), coalesce(p_from, pg_temp.today()), p_policy)) $$;
select is(pg_temp.pol_try('[]'), '22023', 'B10 an array is not a policy');
select is(pg_temp.pol_try((pg_temp.pol()::jsonb || '{"extra": 1}')::text), '22023', 'B11 an unknown key is refused');
select is(pg_temp.pol_try((pg_temp.pol()::jsonb - 'holidays')::text), '22023', 'B12 a missing key is refused');
select is(pg_temp.pol_try((pg_temp.pol()::jsonb || '{"max_touches": "3"}')::text), '22023', 'B13 a string where an integer belongs is refused');
select is(pg_temp.pol_try((pg_temp.pol()::jsonb || '{"max_touches": 3.5}')::text), '22023', 'B14 a fraction is refused');
select is(pg_temp.pol_try(pg_temp.pol(p_gaps => '[1]')), '23514', 'B15 the number of gaps must be max_touches - 1');
select is(pg_temp.pol_try(pg_temp.pol(p_gaps => '[1, 366]')), '23514', 'B16 a gap over 365 days is refused');
select is(pg_temp.pol_try(pg_temp.pol(p_gaps => '[1, -1]')), '23514', 'B17 a negative gap is refused');
select is(pg_temp.pol_try(pg_temp.pol(p_gaps => '[1, "x"]')), '22023', 'B18 a gap that is not a number is refused');
select is(pg_temp.pol_try(pg_temp.pol(p_max => 0, p_gaps => '[]')), '23514', 'B19 zero touches is refused');
select is(pg_temp.pol_try(pg_temp.pol(p_max => 101, p_gaps => (select jsonb_agg(1)::text from generate_series(1, 100)))), '23514', 'B20 more than 100 touches is refused');
select is(pg_temp.try('b_owner', format('select public.create_followup_policy_version(%L, %L, %L, %L::jsonb)', gen_random_uuid(), tests.tid('b'), pg_temp.today() + 1, pg_temp.pol(p_max => 1, p_gaps => '[]'))), 'ok', 'B21 one touch (no gaps) is a valid policy (it never drafts a follow-up); dated in the future so tenant b still has none in force'); -- tenant b
select is(pg_temp.pol_try(pg_temp.pol(p_wd => '[]')), '23514', 'B22 no allowed weekday is refused');
select is(pg_temp.pol_try(pg_temp.pol(p_wd => '[1, 1]')), '23514', 'B23 a repeated weekday is refused');
select is(pg_temp.pol_try(pg_temp.pol(p_wd => '[7]')), '23514', 'B24 weekday 7 is refused (Monday = 0 .. Sunday = 6)');
select is(pg_temp.pol_try(pg_temp.pol(p_qs => '03:00', p_qe => '03:00')), '23514', 'B25 equal quiet endpoints are refused');
select is(pg_temp.pol_try(pg_temp.pol(p_qs => '24:00')), '23514', 'B26 24:00 is not a time');
select is(pg_temp.pol_try(pg_temp.pol(p_qs => '3:00')), '23514', 'B27 a time must be HH:MM');
select is(pg_temp.pol_try(pg_temp.pol(p_hol => '["2026-02-30"]')), '22023', 'B28 an impossible holiday is refused');
select is(pg_temp.pol_try(pg_temp.pol(p_hol => '["2026-12-25", "2026-12-25"]')), '23514', 'B29 a repeated holiday is refused');
select is(pg_temp.pol_try(pg_temp.pol(p_hol => '["25-12-2026"]')), '22023', 'B30 a holiday must be an ISO date');
select is(pg_temp.pol_try(pg_temp.pol(p_off => 841)), '23514', 'B31 an offset beyond +14:00 is refused');
select is(pg_temp.pol_try(pg_temp.pol(p_off => -841)), '23514', 'B32 an offset beyond -14:00 is refused');
select is(pg_temp.pol_try(pg_temp.pol(p_min => 8761)), '23514', 'B33 a minimum gap over 8,760 hours is refused');
select is(pg_temp.pol_try(pg_temp.pol(p_min => -1)), '23514', 'B34 a negative minimum gap is refused');
select is(pg_temp.pol_try((pg_temp.pol()::jsonb || '{"quiet_hours": {"start": "03:00"}}')::text), '22023', 'B35 quiet hours need both ends');
select is(pg_temp.pol_try((pg_temp.pol()::jsonb || '{"quiet_hours": {"start": "03:00", "end": "04:00", "x": 1}}')::text), '22023', 'B36 quiet hours with an extra key are refused');
select is(pg_temp.pol_try(pg_temp.pol(), pg_temp.today() - 1), '23514', 'B37 an effective date in the past is refused');
-- tenant b: versions dated in the future only, so b has NO policy in force today (SM222 below); tenant a keeps ONE benign version in force
select is(pg_temp.mkpol('q1', pg_temp.pol(p_wd => '[3, 1, 2]', p_hol => '["2026-12-26", "2026-12-25"]'), 'b', pg_temp.today() + 3, 'b_owner'), 'ok', 'B38 a version dated in the future is allowed');
select is((select allowed_weekdays::text || holidays::text from public.followup_policy_versions where id = tests.rid('pol_q1')), '{1,2,3}{2026-12-25,2026-12-26}', 'B39 weekdays and holidays are stored SORTED (the engine request carries them in that order)');
select is((select version_no from public.followup_policy_versions where id = tests.rid('pol_q1')), 2, 'B40 version numbers count up per tenant (B21 was the first of tenant b)');
select is(app.followup_active_policy_version(tests.tid('b'), pg_temp.today()), null, 'B41 a future version is not in force today');
select is(pg_temp.mkpol('q2', pg_temp.pol(), 'b', pg_temp.today() + 10, 'b_owner'), 'ok', 'B42 a later version');
select is(app.followup_active_policy_version(tests.tid('b'), pg_temp.today() + 3) = tests.rid('pol_q1') and app.followup_active_policy_version(tests.tid('b'), pg_temp.today() + 10) = tests.rid('pol_q2'), true, 'B43 each is in force from its own day');
select is(pg_temp.mkpol('q3', pg_temp.pol(), 'b', pg_temp.today() + 5, 'b_owner'), '23514', 'B44 a version dated before the latest is refused');
select is(pg_temp.mkpol('q4', pg_temp.pol(), 'b', pg_temp.today() + 10, 'b_owner'), 'ok', 'B45 a version on the same day as the latest is allowed (the higher number wins the tie)');
select is(app.followup_active_policy_version(tests.tid('b'), pg_temp.today() + 10), tests.rid('pol_q4'), 'B46 ... and wins it');
select is(pg_temp.priv(format('update public.followup_policy_versions set max_touches = 5 where id = %L', tests.rid('pol_p1'))), '42501', 'B47 a version is immutable (even for the table owner)');
select is(pg_temp.priv(format('delete from public.followup_policy_versions where id = %L', tests.rid('pol_p1'))), '42501', 'B48 and is never deleted');
select is(app.followup_active_policy_version(tests.tid('a'), pg_temp.today()) is not null and (select content_sha256 from public.followup_policy_versions where id = app.followup_active_policy_version(tests.tid('a'), pg_temp.today()))
          = (select content_sha256 from public.followup_policy_versions where id = tests.rid('pol_p1')), true, 'B49 tenant a has a policy in force and it is the benign one (noon clock, quiet 03:00-04:00, gaps 1 and 2 days, every weekday)');

-- ============================================================================ C. record_touch
-- fixtures: one lead per gate cell. Every contact is keyed with fake keys; consent is granted unless the cell says otherwise.
select pg_temp.mklead('m1');                                       -- the matrix lead
select pg_temp.mklead('l1');                                       -- the ordinary, eligible lead
select pg_temp.mklead('g_sup');                                    select pg_temp.run('a_owner', format($q$select public.suppress_contact(%L, %L, 'manual', 'other', 'ref:sup')$q$, tests.tid('a'), tests.rid('g_sup_c')));
select pg_temp.mklead('g_optout');                                 select pg_temp.run('a_owner', format($q$select public.suppress_contact(%L, %L, 'opted_out', 'other', 'ref:opt')$q$, tests.tid('a'), tests.rid('g_optout_c')));
select pg_temp.mklead('g_erased');                                 select pg_temp.mark_erased('g_erased_c');
select pg_temp.mklead('g_unkeyed', false);                         -- consent, but no recorded key
select pg_temp.mklead('g_nocons', true, false);                    -- keyed, no consent
select pg_temp.mklead('g_noemail', true, true, false);             -- no e-mail address (WhatsApp consent only)
select pg_temp.mklead('g_arch');                                   update public.contacts set archived_at = now() where id = tests.rid('g_arch_c');
select pg_temp.mklead('g_key');                                    -- its e-mail key is suppressed through ANOTHER contact (a shared address)
insert into public.contacts (id, tenant_id, company_id, full_name, email, phone) values (tests.rid('g_key_x'), tests.tid('a'), tests.rid('a_company'), 'Contact g_key_x', 'g_key_x@example.test', '+00 9 99991');
select pg_temp.run('a_owner', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('g_key_x'), jsonb_build_object('version', 1, 'email', pg_temp.h('g_key_e'), 'phone', pg_temp.h('g_key_x_p'))));
select pg_temp.run('a_owner', format($q$select public.suppress_contact(%L, %L, 'opted_out', 'other', 'ref:keyx')$q$, tests.tid('a'), tests.rid('g_key_x')));
select pg_temp.mklead('g_erkey');                                  -- its e-mail key carries an ERASED marker (a person erased by right shared the address)
insert into suppression.key_events (tenant_id, kind, key_hmac, key_version, event, reason) values (tests.tid('a'), 'email', pg_temp.h('g_erkey_e'), 1, 'suppressed', 'erased');
insert into public.leads (id, tenant_id, company_id, created_at) values (tests.rid('g_nocontact'), tests.tid('a'), tests.rid('a_company'), now() - interval '30 days');    -- a lead without a contact
select pg_temp.mklead('g_lost', true, true, true, 'disqualified');

-- control: the matrix helper really reports a cell that differs from the expectation (so a null answer below means every cell matched)
select isnt(pg_temp.cells(format('select public.record_touch(%L, %L, ''out'', ''email'', null)', gen_random_uuid(), tests.rid('m1')), 'a_owner@aal2=ok'), null, 'C0 (control) the helper reports the cells that differ from an expectation');
-- the matrix (role x assurance level): Owner, Admin and Sales record a touch at either level; nobody else
select is(pg_temp.cells(format('select public.record_touch(%L, %L, ''out'', ''email'', null)', gen_random_uuid(), tests.rid('m1')),
                        'a_owner@aal1=ok,a_owner@aal2=ok,a_admin@aal1=ok,a_admin@aal2=ok,a_sales@aal1=ok,a_sales@aal2=ok'), null,
          'C1 the matrix: Owner / Admin / Sales record a touch at aal1 and aal2; a Viewer, another tenant, an outsider and anon get 42501');
select is(pg_temp.err('a_viewer', format('select public.record_touch(%L, %L, ''out'', ''email'', null)', gen_random_uuid(), tests.rid('m1'))),
          pg_temp.err('a_viewer', format('select public.record_touch(%L, %L, ''out'', ''email'', null)', gen_random_uuid(), gen_random_uuid())), 'C2 a refusal for a role and for an unknown lead are the SAME answer');
select is(pg_temp.try('a_sales', format('select public.record_touch(null, %L, ''out'', ''email'', null)', tests.rid('m1'))), '42501', 'C3 a null touch id is the generic refusal');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, null, ''out'', ''email'', null)', gen_random_uuid())), '42501', 'C4 a null lead is the generic refusal');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''sideways'', ''email'', null)', gen_random_uuid(), tests.rid('m1'))), '22023', 'C5 a direction outside out / in is invalid');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, null, ''email'', null)', gen_random_uuid(), tests.rid('m1'))), '22023', 'C6 a null direction is invalid');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''out'', ''sms'', null)', gen_random_uuid(), tests.rid('m1'))), '22023', 'C7 a channel outside e-mail / WhatsApp / phone is invalid');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''out'', null, null)', gen_random_uuid(), tests.rid('m1'))), '22023', 'C8 a null channel is invalid');
-- the time of a touch: never after now, at most 7 days back, never before the lead existed; an OUTBOUND touch never before the lead's latest outbound touch (a reply may be recorded late)
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''in'', ''email'', %L)', gen_random_uuid(), tests.rid('m1'), now())), 'ok', 'C9 a touch exactly now is allowed');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''in'', ''email'', %L)', gen_random_uuid(), tests.rid('m1'), now() + interval '1 second')), '23514', 'C9b one second after now is refused (no future slack: the web form sends null for "now")');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''out'', ''email'', %L)', gen_random_uuid(), tests.rid('m1'), now() + interval '1 second')), '23514', 'C9c ... for an outbound touch too');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''in'', ''email'', %L)', gen_random_uuid(), tests.rid('m1'), now() + interval '5 minutes')), '23514', 'C9d ... and five minutes ahead (there is no slack any more)');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''in'', ''email'', %L)', gen_random_uuid(), tests.rid('m1'), now() - interval '7 days 1 second')), '23514', 'C10 a touch more than 7 days back is refused');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''in'', ''email'', %L)', gen_random_uuid(), tests.rid('m1'), now() - interval '7 days')), 'ok', 'C11 exactly 7 days back is allowed');
select pg_temp.mklead('lo');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''out'', ''email'', %L)', gen_random_uuid(), tests.rid('lo'), now() - interval '7 days 1 second')), '23514', 'C12 an outbound touch more than 7 days back is refused');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''out'', ''email'', %L)', tests.rid('lo_1'), tests.rid('lo'), now() - interval '2 days')), 'ok', 'C12a the first outbound touch (2 days ago)');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''out'', ''email'', %L)', gen_random_uuid(), tests.rid('lo'), now() - interval '2 days 1 second')), '23514', 'C12b an outbound touch one second BEFORE the latest outbound touch is refused');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''out'', ''whatsapp'', %L)', gen_random_uuid(), tests.rid('lo'), now() - interval '5 days')), '23514', 'C12c ... however far back, and on any channel');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''out'', ''email'', %L)', gen_random_uuid(), tests.rid('lo'), now() - interval '2 days')), 'ok', 'C12d an outbound touch exactly AT the latest one is allowed');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''out'', ''email'', %L)', gen_random_uuid(), tests.rid('lo'), now() - interval '1 day')), 'ok', 'C12e ... and one after it');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''in'', ''email'', %L)', gen_random_uuid(), tests.rid('lo'), now() - interval '4 days')), 'ok', 'C12f a REPLY may be recorded late: before the latest outbound touch is fine');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''out'', ''email'', %L)', gen_random_uuid(), tests.rid('lo'), now() - interval '1 day 1 second')), '23514', 'C12g (and the latest outbound touch is now 1 day ago: one second before it is refused)');
-- not before the lead existed (a lead created 3 days ago: the lower bound is the lead's creation, tighter than 7 days)
select pg_temp.mklead('young');   update public.leads set created_at = now() - interval '3 days' where id = tests.rid('young');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''out'', ''email'', %L)', gen_random_uuid(), tests.rid('young'), now() - interval '3 days 1 second')), '23514', 'C12h a touch one second before the lead was created is refused');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''in'', ''email'', %L)', gen_random_uuid(), tests.rid('young'), now() - interval '3 days 1 second')), '23514', 'C12i ... a reply too');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''out'', ''email'', %L)', gen_random_uuid(), tests.rid('young'), now() - interval '3 days')), 'ok', 'C12j a touch exactly at the lead''s creation is allowed');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''out'', ''email'', %L)', gen_random_uuid(), tests.rid('young'), now() - interval '2 days 23 hours')), 'ok', 'C12k ... and one after it');
select is(pg_temp.priv(format($q$insert into public.lead_touches (id, tenant_id, lead_id, direction, channel, occurred_at) values (gen_random_uuid(), %L, %L, 'in', 'email', now() + interval '1 second')$q$, tests.tid('a'), tests.rid('m1'))), '23514', 'C12l the table itself refuses a touch after its own recording, even for a privileged writer');
select is(pg_temp.priv(format($q$insert into public.lead_touches (id, tenant_id, lead_id, direction, channel, occurred_at) values (gen_random_uuid(), %L, %L, 'in', 'email', now())$q$, tests.tid('a'), tests.rid('m1'))), 'ok', 'C12m ... and allows exactly the moment of recording');
-- replay and conflict
select is(pg_temp.touch('a_sales', 'r1', 'm1', 'out', 'email'), 'ok', 'C13 a touch is recorded');
select is(pg_temp.j(pg_temp.sc('a_sales', format('select public.record_touch(%L, %L, ''out'', ''email'', null)', tests.rid('t_r1'), tests.rid('m1'))), 'replayed'), 'true', 'C14 an exact retry replays (a null time matches the stored one)');
select is(pg_temp.j(pg_temp.sc('a_admin', format('select public.record_touch(%L, %L, ''out'', ''email'', %L)', tests.rid('t_r1'), tests.rid('m1'), (select occurred_at from public.lead_touches where id = tests.rid('t_r1')))), 'replayed'), 'true', 'C15 ... so does a retry that states the stored time (by another person)');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''out'', ''email'', %L)', tests.rid('t_r1'), tests.rid('m1'), now() - interval '1 day')), '23505', 'C16 the same id at another time is the constant conflict');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''out'', ''whatsapp'', null)', tests.rid('t_r1'), tests.rid('m1'))), '23505', 'C17 ... in another channel');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''in'', ''email'', null)', tests.rid('t_r1'), tests.rid('m1'))), '23505', 'C18 ... in the other direction');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''out'', ''email'', null)', tests.rid('t_r1'), tests.rid('l1'))), '23505', 'C19 ... for another lead');
select is((select count(*) from public.lead_touches where id = tests.rid('t_r1')), 1::bigint, 'C20 one row, whatever was retried');
select is((select contact_id = tests.rid('m1_c') and recorded_by = tests.uid('a_sales') and direction = 'out' and channel = 'email' and draft_id is null from public.lead_touches where id = tests.rid('t_r1')), true, 'C21 the contact is DERIVED from the lead, the recorder is the caller');

-- the OUTBOUND gate, cell by cell (a Sales user records an outbound touch; nobody can record contacting a person the system may not contact)
select is(pg_temp.touch('a_sales', 'o1', 'l1', 'out', 'email', interval '5 days'), 'ok', 'C22 an eligible lead: an outbound e-mail is recorded (5 days ago)');
select is(pg_temp.touch('a_sales', 'o2', 'g_sup', 'out'), 'SM220:contact', 'C23 a SUPPRESSED contact: refused (SM220, detail contact)');
select is(pg_temp.touch('a_sales', 'o3', 'g_optout', 'out'), 'SM220:contact', 'C24 an OPTED-OUT contact: refused (SM220, contact)');
select is(pg_temp.touch('a_owner', 'i2o', 'g_erased', 'in'), 'SM220:erased', 'C39b the Owner is refused the same way');
select is(pg_temp.touch('a_sales', 'o4', 'g_erased', 'out'), 'SM220:erased', 'C25 an ERASED contact: refused (SM220, detail erased)');
select is(pg_temp.touch('a_sales', 'o5', 'g_unkeyed', 'out'), 'SM221', 'C26 a contact with NO recorded key: refused (SM221): missing data never means "not suppressed"');
select is(pg_temp.touch('a_sales', 'o6', 'g_key', 'out', 'email'), 'SM220:key', 'C27 an e-mail key suppressed through ANOTHER contact: refused (SM220, detail key)');
select is(pg_temp.touch('a_sales', 'o7', 'g_key', 'out', 'whatsapp'), 'ok', 'C28 ... but the phone key of the same contact is not suppressed: the WhatsApp touch is recorded (the key kind is part of the check)');
select is(pg_temp.touch('a_sales', 'o8', 'g_erkey', 'out', 'email'), 'SM220:erased_key', 'C29 a key with an ERASED marker: refused (SM220, detail erased_key)');
select is(pg_temp.touch('a_sales', 'o9', 'g_nocons', 'out'), 'SM220:consent', 'C30 consent not granted: refused (SM220, detail consent)');
select is(pg_temp.touch('a_sales', 'o10', 'g_noemail', 'out', 'email'), 'SM220:consent', 'C31 no e-mail address for an e-mail touch: refused (consent)');
select is(pg_temp.touch('a_sales', 'o11', 'g_noemail', 'out', 'whatsapp'), 'ok', 'C32 ... but WhatsApp works for the same contact');
select is(pg_temp.touch('a_sales', 'o12', 'g_arch', 'out'), 'SM220:consent', 'C33 an ARCHIVED contact: refused (consent)');
select is(pg_temp.touch('a_sales', 'o13', 'g_nocontact', 'out'), 'SM220:consent', 'C34 a lead without a contact: refused (consent)');
select is(pg_temp.touch('a_sales', 'o14', 'g_nocons', 'out', 'phone'), 'SM220:consent', 'C35 a PHONE touch needs the phone consent too');
select is(pg_temp.touch('a_owner', 'o15', 'g_sup', 'out'), 'SM220:contact', 'C36 the Owner is refused exactly like Sales (no role may record contacting a suppressed person)');
select is((select count(*) from public.lead_touches where lead_id in (tests.rid('g_sup'), tests.rid('g_optout'), tests.rid('g_erased'), tests.rid('g_unkeyed'), tests.rid('g_erkey'), tests.rid('g_nocons'), tests.rid('g_arch'), tests.rid('g_nocontact'))),
          0::bigint, 'C37 nothing was written for any refused cell');
-- an INBOUND touch can only stop outreach: it is ALWAYS recordable
select is(pg_temp.touch('a_sales', 'i1', 'g_sup', 'in'), 'ok', 'C38 a reply from a suppressed contact is recorded (an inbound touch can only stop outreach)');
select is(pg_temp.touch('a_sales', 'i2', 'g_erased', 'in'), 'SM220:erased', 'C39 ... but NOT for an ERASED contact: erasure wins, no new record about an erased person (SM220, erased)');
select is(pg_temp.touch('a_sales', 'i3', 'g_unkeyed', 'in'), 'ok', 'C40 ... from a contact with no key');
select is(pg_temp.touch('a_sales', 'i4', 'g_key', 'in', 'email'), 'ok', 'C41 ... through a suppressed key');
select is(pg_temp.touch('a_sales', 'i5', 'g_nocontact', 'in'), 'ok', 'C42 ... on a lead without a contact');
select is((select contact_id is null from public.lead_touches where id = tests.rid('t_i5')), true, 'C43 (that touch carries no contact)');
select is(pg_temp.touch('a_sales', 'i6', 'g_nocons', 'in', 'phone'), 'ok', 'C44 ... without consent, on any channel');
-- the cap
select pg_temp.mklead('cap');
insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at)
select gen_random_uuid(), tests.tid('a'), tests.rid('cap'), tests.rid('cap_c'), 'in', 'email', now() - make_interval(secs => n) from generate_series(1, 500) n;
select is(pg_temp.touch('a_sales', 'cap1', 'cap', 'in'), 'SM229', 'C45 a lead with 500 touches records no more (SM229)');
select is(pg_temp.touch('a_sales', 'cap2', 'cap', 'out'), 'SM229', 'C46 ... in either direction');
select is(pg_temp.touch('a_sales', 'cap3', 'l1', 'out', 'email', interval '4 days'), 'ok', 'C47 (a lead under the cap is unaffected)');
-- a second outbound touch makes the first draft stale; a reply discards every open draft: see sections D and G
select is((select count(*) from public.audit_events where entity_type = 'lead_touch' and action = 'lead_touch.create' and tenant_id = tests.tid('a')), (select count(*) from public.lead_touches where tenant_id = tests.tid('a')), 'C48 every touch has its audit event (the 500 planted ones too: the trigger fires for a privileged insert)');

-- an inbound touch NEVER lifts, shortens or weakens a suppression or a follow-up stop (it writes one touch row and discards open drafts; nothing else)
create function pg_temp.snap(p_lead text) returns text language sql as $$
  select (select concat_ws('|', c.suppressed_at is not null, c.suppression_reason::text, c.email_consent::text, c.whatsapp_consent::text, c.phone_consent::text, c.erased_at is not null, c.archived_at is not null)
            from public.contacts c where c.id = (select contact_id from public.leads where id = tests.rid(p_lead)))
      || '|' || (select count(*) from suppression.key_events where tenant_id = tests.tid('a'))
      || '|' || (select count(*) from public.consent_events where tenant_id = tests.tid('a'))
      || '|' || coalesce(app.followup_stopped(tests.rid(p_lead)), '-')
      || '|' || coalesce(app.followup_gate(tests.rid(p_lead), 'email', false) ->> 'detail', app.followup_gate(tests.rid(p_lead), 'email', false) ->> 'code', 'open') $$;
create temp table snaps as select 'g_sup'::text as lead, pg_temp.snap('g_sup') as before union all select 'g_key', pg_temp.snap('g_key') union all select 'g_unkeyed', pg_temp.snap('g_unkeyed') union all select 'g_optout', pg_temp.snap('g_optout');
select is(pg_temp.touch('a_sales', 'ii1', 'g_optout', 'in'), 'ok', 'C49 a reply from an opted-out contact is recorded');
select is(pg_temp.touch('a_sales', 'ii2', 'g_key', 'in'), 'ok', 'C50 ... and from a contact with a suppressed key');
select is(pg_temp.touch('a_sales', 'ii3', 'g_unkeyed', 'in'), 'ok', 'C51 ... and from an unkeyed one');
select is(pg_temp.touch('a_sales', 'ii4', 'g_sup', 'in'), 'ok', 'C52 ... and a second one from a suppressed contact');
select is((select count(*) from snaps s where s.before <> pg_temp.snap(s.lead)), 0::bigint, 'C53 after an inbound touch the contact''s suppression, its consent, the key ledger, the consent ledger, the follow-up stop and the gate are EXACTLY as before (an inbound touch weakens nothing)');
select is((select count(*) from public.lead_touches where lead_id in (tests.rid('g_sup'), tests.rid('g_key'), tests.rid('g_unkeyed'), tests.rid('g_optout')) and direction = 'in'), 7::bigint, 'C54 (the replies were recorded: this is not a vacuous pass)');

-- ============================================================================ D. create_followup_draft
select tests.seed_orders();
-- an approved quote and its order for a lead, in a state the order functions would have reached (the guard trigger is switched off for the one state update, inside the test transaction)
create function pg_temp.mkorder(p_label text, p_lead text, p_state text) returns void language plpgsql as $$ -- a null state makes the quote only
begin
  insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (tests.rid(p_label || '_enq'), tests.tid('a'), tests.rid(p_lead), 'email', now() - interval '1 hour', 'Synthetic enquiry ' || p_label);
  insert into public.requirements (id, tenant_id, enquiry_id) values (tests.rid(p_label || '_req'), tests.tid('a'), tests.rid(p_label || '_enq'));
  insert into public.quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, price_list_version_id, policy_version_id, engine_version, request_text, result_text,
                             canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, merchandise_net_paise, item_tax_paise, shipping_net_paise,
                             shipping_tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval, approved_by, approved_at, approved_hash)
  values (tests.rid(p_label || '_quote'), tests.tid('a'), (select coalesce(max(quote_no), 0) + 1 from public.quotes where tenant_id = tests.tid('a')), tests.rid(p_label || '_req'),
          tests.rid(p_label || '_enq'), tests.rid(p_lead), 'approved', tests.rid('a_price_version'), tests.rid('a_policy_version'), '1.1.0', '{}', '{}', repeat('3', 64),
          'new', 'TS', 'intra_state', pg_temp.today(), pg_temp.today() + 10, pg_temp.today() + 30, 100000, 0, 0, 0, 100000, 40000, 60000, false, tests.uid('a_owner'), now(), repeat('5', 64));
  if p_state is null then
    return;
  end if;
  insert into public.orders (id, tenant_id, order_no, quote_id, enquiry_id, requirement_id, lead_id, order_total_paise, advance_paise, valid_until, policy_version_id)
  values (tests.rid(p_label || '_order'), tests.tid('a'), (select coalesce(max(order_no), 0) + 1 from public.orders where tenant_id = tests.tid('a')), tests.rid(p_label || '_quote'),
          tests.rid(p_label || '_enq'), tests.rid(p_label || '_req'), tests.rid(p_lead), 100000, 40000, pg_temp.today() + 10, tests.rid('a_order_policy'));
  insert into public.order_events (id, tenant_id, order_id, seq, type, prior_state, new_state, occurred_at)
  values (gen_random_uuid(), tests.tid('a'), tests.rid(p_label || '_order'), 1, 'created', null, 'quote_approved', now());
  if p_state <> 'quote_approved' then
    alter table public.orders disable trigger orders_guard_update;
    update public.orders set state = p_state::public.order_state, closed_at = case when p_state in ('declined', 'cancelled', 'expired', 'closed_paid') then now() end where id = tests.rid(p_label || '_order');
    alter table public.orders enable trigger orders_guard_update;
  end if;
end $$;
-- a lead that is due: keyed, consented, one outbound touch 5 days ago
create function pg_temp.mkdue(p_label text, p_outs int default 1) returns void language plpgsql as $$
begin
  perform pg_temp.mklead(p_label);
  for n in 1 .. p_outs loop
    perform pg_temp.run('a_sales', format('select public.record_touch(%L, %L, ''out'', ''email'', %L)', tests.rid('t_' || p_label || '_' || n), tests.rid(p_label), (now() - make_interval(days => 6 - n))::text));
  end loop;
end $$;

select pg_temp.mkdue('dm');
select pg_temp.mkdue('dd');
select pg_temp.mkdue('f1');
-- the matrix: Owner / Admin / Sales create a draft at either level (the first call writes, the rest replay); nobody else
select is(pg_temp.cells(pg_temp.cd('dm', 'dm'), 'a_owner@aal1=ok,a_owner@aal2=ok,a_admin@aal1=ok,a_admin@aal2=ok,a_sales@aal1=ok,a_sales@aal2=ok'), null,
          'D1 the matrix: Owner / Admin / Sales create a draft at aal1 and aal2; a Viewer, another tenant, an outsider and anon get 42501');
select is(pg_temp.nd('dm'), 1::bigint, 'D2 ... and ONE draft exists (the other cells replayed)');
select is(pg_temp.err('a_viewer', pg_temp.cd('x1', 'dm')), pg_temp.err('a_viewer', format('select public.create_followup_draft(%L, %L, ''email'', ''1.0.0'', ''{}'', ''{}'')', gen_random_uuid(), gen_random_uuid())),
          'D3 a refusal for a role and for an unknown lead are the SAME answer');
select is(pg_temp.try('a_sales', 'select public.create_followup_draft(null, null, ''email'', ''1.0.0'', ''{}'', ''{}'')'), '42501', 'D4 null ids are the generic refusal');
select is(pg_temp.try('a_sales', format('select public.create_followup_draft(%L, %L, ''phone'', ''1.0.0'', ''{}'', ''{}'')', gen_random_uuid(), tests.rid('dd'))), '22023', 'D5 a draft is for e-mail or WhatsApp, not a phone call (22023)');
select is(pg_temp.try('a_sales', format('select public.create_followup_draft(%L, %L, null, ''1.0.0'', ''{}'', ''{}'')', gen_random_uuid(), tests.rid('dd'))), '22023', 'D6 a null channel is invalid');
select is(pg_temp.try('a_sales', format('select public.create_followup_draft(%L, %L, ''email'', null, ''{}'', ''{}'')', gen_random_uuid(), tests.rid('dd'))), '22023', 'D7 a null engine version is invalid');
select is(pg_temp.try('a_sales', format('select public.create_followup_draft(%L, %L, ''email'', ''1.0.0'', ''not json'', ''{}'')', gen_random_uuid(), tests.rid('dd'))), '22023', 'D8 a request that is not JSON is invalid');
select is(pg_temp.try('a_sales', format('select public.create_followup_draft(%L, %L, ''email'', ''1.0.0'', ''[1]'', ''{}'')', gen_random_uuid(), tests.rid('dd'))), '22023', 'D9 a request that is not an object is invalid');
select is(pg_temp.try('a_sales', format('select public.create_followup_draft(%L, %L, ''email'', ''1.0.0'', %L, ''"x"'')', gen_random_uuid(), tests.rid('dd'), pg_temp.req('dd')::text)), '22023', 'D10 a result that is not an object is invalid');
select is(pg_temp.try('a_sales', format('select public.create_followup_draft(%L, %L, ''email'', ''1.0.0'', %L, ''{}'')', gen_random_uuid(), tests.rid('dd'), E'{"as_of": "x​"}')), '22023', 'D11 a hidden character in the request is refused (text hygiene)');
select is(pg_temp.try('a_sales', pg_temp.cd('v9', 'dd', 'email', null, null, '9.9.9')), '23514', 'D12 an engine version nobody reviewed is refused');

-- the gate (every cell of C again, through the draft; the gate runs BEFORE anything else is looked at)
select is(pg_temp.mk('a_sales', 'g1', 'g_sup'), 'SM220:contact', 'D13 a suppressed contact: no draft (SM220, contact)');
select is(pg_temp.mk('a_sales', 'g2', 'g_optout'), 'SM220:contact', 'D14 an opted-out contact: no draft');
select is(pg_temp.mk('a_sales', 'g3', 'g_erased'), 'SM220:erased', 'D15 an erased contact: no draft (SM220, erased)');
select is(pg_temp.mk('a_sales', 'g4', 'g_unkeyed'), 'SM221', 'D16 a contact with no recorded key: no draft (SM221)');
select is(pg_temp.mk('a_sales', 'g5', 'g_key', 'email'), 'SM220:key', 'D17 a key suppressed through another contact: no draft (SM220, key)');
select is(pg_temp.mk('a_sales', 'g6', 'g_erkey', 'email'), 'SM220:erased_key', 'D18 an erased marker on the key: no draft (SM220, erased_key)');
select is(pg_temp.mk('a_sales', 'g7', 'g_nocons'), 'SM220:consent', 'D19 no consent: no draft (SM220, consent)');
select is(pg_temp.mk('a_sales', 'g8', 'g_noemail', 'email'), 'SM220:consent', 'D20 no e-mail address: no draft');
select is(pg_temp.mk('a_sales', 'g9', 'g_arch'), 'SM220:consent', 'D21 an archived contact: no draft');
select is(pg_temp.mk('a_sales', 'g10', 'g_nocontact'), 'SM220:consent', 'D22 a lead without a contact: no draft');
select is(pg_temp.mk('a_owner', 'g11', 'g_sup'), 'SM220:contact', 'D23 the Owner is refused the same way');
select is((select count(*) from public.followup_drafts where lead_id in (tests.rid('g_sup'), tests.rid('g_optout'), tests.rid('g_erased'), tests.rid('g_unkeyed'), tests.rid('g_key'), tests.rid('g_erkey'), tests.rid('g_nocons'),
            tests.rid('g_noemail'), tests.rid('g_arch'), tests.rid('g_nocontact'))), 0::bigint, 'D24 nothing was written for any refused cell');
-- the stops: an order accepted, declined or cancelled, a withdrawn quote, an archived lead (SM227, detail = the closed reason)
select pg_temp.mkdue('st_acc');  select pg_temp.mkorder('st_acc', 'st_acc', 'accepted');
select pg_temp.mkdue('st_dec');  select pg_temp.mkorder('st_dec', 'st_dec', 'declined');
select pg_temp.mkdue('st_can');  select pg_temp.mkorder('st_can', 'st_can', 'cancelled');
select pg_temp.mkdue('st_new');  select pg_temp.mkorder('st_new', 'st_new', 'quote_approved');
select pg_temp.mkdue('st_wd');   select pg_temp.mkorder('st_wd', 'st_wd', null);
select pg_temp.mkdue('st_arch');
select pg_temp.mkdue('st_won');
update public.quotes set status = 'superseded', withdrawn_by = tests.uid('a_owner'), withdrawn_at = now(), withdraw_code = 'price_changed' where id = tests.rid('st_wd_quote');
update public.leads set archived_at = now() where id = tests.rid('st_arch');
insert into public.opportunities (id, tenant_id, company_id, contact_id, lead_id, title, status) values (tests.rid('st_won_opp'), tests.tid('a'), tests.rid('a_company'), tests.rid('st_won_c'), tests.rid('st_won'), 'Synthetic won deal', 'won');
select is(pg_temp.mk('a_sales', 's1', 'st_acc'), 'SM227:order_accepted', 'D25 an accepted order stops follow-ups (SM227, order_accepted)');
select is(pg_temp.mk('a_sales', 's2', 'st_dec'), 'SM227:order_declined', 'D26 a declined order (order_declined)');
select is(pg_temp.mk('a_sales', 's3', 'st_can'), 'SM227:order_cancelled', 'D27 a cancelled order (order_cancelled)');
select is(pg_temp.mk('a_sales', 's4', 'st_new'), 'ok', 'D28 an order that is only approved does not stop them');
select is(pg_temp.mk('a_sales', 's5', 'st_wd'), 'SM227:quote_withdrawn', 'D29 a withdrawn approved quote and no approved one since (quote_withdrawn)');
select is(pg_temp.mk('a_sales', 's6', 'st_arch'), 'SM227:lead_archived', 'D30 an archived lead (lead_archived)');
select is(pg_temp.mk('a_sales', 's7', 'st_won'), 'SM225:closed', 'D31 a lead with a WON opportunity: the engine''s own rule (closed): not due');
select is((select count(*) from public.followup_drafts where lead_id in (tests.rid('st_acc'), tests.rid('st_dec'), tests.rid('st_can'), tests.rid('st_wd'), tests.rid('st_arch'), tests.rid('st_won'))), 0::bigint, 'D32 nothing was written for a stopped lead');
select is(app.followup_stopped(tests.rid('st_wd')), 'quote_withdrawn', 'D33 the reason is the closed word the screen translates');
-- no policy in force (tenant b has only future-dated versions)
select pg_temp.run('b_owner', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('b_contact'), jsonb_build_object('version', 1, 'email', pg_temp.h('b_e'), 'phone', pg_temp.h('b_p'))));
select pg_temp.run('b_owner', format($q$select public.record_consent(%L, %L, 'email', 'granted', 'explicit_consent', 'web_form', 'ref:b')$q$, tests.tid('b'), tests.rid('b_contact')));
select is(pg_temp.try('b_sales', format('select public.create_followup_draft(%L, %L, ''email'', ''1.0.0'', ''{}'', ''{}'')', gen_random_uuid(), tests.rid('b_lead'))), 'SM222', 'D34 no policy in force for the tenant (only future-dated versions): SM222');
select is(pg_temp.try('a_sales', format('select public.create_followup_draft(%L, %L, ''email'', ''1.0.0'', ''{}'', ''{}'')', gen_random_uuid(), tests.rid('b_lead'))), '42501', 'D35 another tenant''s lead is the generic refusal');

-- forged requests and results (SM226): every one refused, nothing written, and then the honest call works
select is(pg_temp.try('a_sales', pg_temp.cd('f_old', 'f1', 'email', pg_temp.req('f1', pg_temp.asof(interval '-3 minutes -10 seconds')))), 'SM226', 'D36 an as_of more than 3 minutes old is refused');
select is(pg_temp.try('a_sales', pg_temp.cd('f_new', 'f1', 'email', pg_temp.req('f1', pg_temp.asof(interval '2 minutes 10 seconds')))), 'SM226', 'D37 an as_of more than 2 minutes ahead is refused');
select is(pg_temp.try('a_sales', pg_temp.cd('f_bad', 'f1', 'email', pg_temp.req('f1') || '{"as_of": "yesterday"}')), 'SM226', 'D38 a malformed as_of is refused');
select is(pg_temp.try('a_sales', pg_temp.cd('f_noas', 'f1', 'email', pg_temp.req('f1') - 'as_of')), 'SM226', 'D39 a missing as_of is refused');
select is(pg_temp.try('a_sales', pg_temp.cd('f_flag', 'f1', 'email', jsonb_set(pg_temp.req('f1'), '{lead,won}', 'true'))), 'SM226', 'D40 a changed lead flag is refused (the database owns the flags)');
select is(pg_temp.try('a_sales', pg_temp.cd('f_hist', 'f1', 'email', jsonb_set(pg_temp.req('f1'), '{history}', '[]'))), 'SM226', 'D41 a dropped history is refused');
select is(pg_temp.try('a_sales', pg_temp.cd('f_hist2', 'f1', 'email', jsonb_set(pg_temp.req('f1'), '{history,0,timestamp}', to_jsonb(pg_temp.asof(interval '-10 days'))))), 'SM226', 'D42 a moved history time is refused');
select is(pg_temp.try('a_sales', pg_temp.cd('f_gap', 'f1', 'email', jsonb_set(pg_temp.req('f1'), '{policy,gap_days}', '[0, 0]'))), 'SM226', 'D43 a changed policy (a shorter gap) is refused');
select is(pg_temp.try('a_sales', pg_temp.cd('f_off', 'f1', 'email', jsonb_set(pg_temp.req('f1'), '{recipient_utc_offset_minutes}', '0'))), 'SM226', 'D44 a changed offset is refused');
select is(pg_temp.try('a_sales', pg_temp.cd('f_extra', 'f1', 'email', pg_temp.req('f1') || '{"x": 1}')), 'SM226', 'D45 an extra key is refused');
select is(pg_temp.try('a_sales', pg_temp.cd('f_pol', 'f1', 'email', jsonb_set(pg_temp.req('f1'), '{policy,quiet_hours,start}', '"00:00"'))), 'SM226', 'D46 changed quiet hours are refused');
select is(pg_temp.try('a_sales', pg_temp.cd('f_pretty', 'f1', 'email', null, pg_temp.res(pg_temp.req('f1')), '1.0.0', jsonb_pretty(pg_temp.req('f1')))), 'SM226', 'D47 a request text that is not the canonical one the result was hashed from is refused');
select is(pg_temp.try('a_sales', pg_temp.cd('r_hash', 'f1', 'email', null, pg_temp.res(pg_temp.req('f1')) || jsonb_build_object('canonical_hash', repeat('0', 64)))), 'SM226', 'D48 a result with another hash is refused');
select is(pg_temp.try('a_sales', pg_temp.cd('r_ver', 'f1', 'email', null, pg_temp.res(pg_temp.req('f1')) || '{"engine_version": "2.0.0"}')), 'SM226', 'D49 a result of another engine version is refused');
select is(pg_temp.try('a_sales', pg_temp.cd('r_n', 'f1', 'email', null, pg_temp.res(pg_temp.req('f1')) || '{"touch_number": 3}')), 'SM226', 'D50 a result with another touch number is refused');
select is(pg_temp.try('a_sales', pg_temp.cd('r_at', 'f1', 'email', null, pg_temp.res(pg_temp.req('f1')) || jsonb_build_object('next_eligible_at', pg_temp.asof(interval '-1 hour')))), 'SM226', 'D51 a result due at another time is refused');
select is(pg_temp.try('a_sales', pg_temp.cd('r_act', 'f1', 'email', null, pg_temp.res(pg_temp.req('f1')) || '{"action": "wait", "reason_code": "not_yet_eligible"}')), 'SM226', 'D52 a result that says wait for a lead the database finds due is refused');
select is(pg_temp.try('a_sales', pg_temp.cd('r_term', 'f1', 'email', null, pg_temp.res(pg_temp.req('f1')) || '{"terminal": true}')), 'SM226', 'D53 a terminal result is refused');
select is(pg_temp.try('a_sales', pg_temp.cd('r_extra', 'f1', 'email', null, pg_temp.res(pg_temp.req('f1')) || '{"x": 1}')), 'SM226', 'D54 a result with an extra key is refused');
select is(pg_temp.try('a_sales', pg_temp.cd('r_miss', 'f1', 'email', null, pg_temp.res(pg_temp.req('f1')) - 'trace')), 'SM226', 'D55 a result with a missing key is refused');
select is(pg_temp.try('a_sales', pg_temp.cd('r_trace', 'f1', 'email', null, pg_temp.res(pg_temp.req('f1')) || '{"trace": {}}')), 'SM226', 'D56 a trace that is not a list is refused');
select is(pg_temp.try('a_sales', pg_temp.cd('r_rej', 'f1', 'email', null, jsonb_build_object('status', 'rejected', 'codes', jsonb_build_array('FUTURE_HISTORY'), 'engine_version', '1.0.0', 'canonical_hash', null, 'trace', '[]'::jsonb))), 'SM226', 'D57 an engine REJECTION is not a draft (refused)');
select is(pg_temp.try('a_sales', pg_temp.cd('r_str', 'f1', 'email', null, pg_temp.res(pg_temp.req('f1')) || '{"touch_number": "2"}')), 'SM226', 'D58 a touch number that is a string is refused');
select is(pg_temp.nd('f1'), 0::bigint, 'D59 nothing was written for any forgery');
select is(pg_temp.mk('a_sales', 'f1', 'f1'), 'ok', 'D60 the honest call on the same lead works');
select pg_temp.mkdue('w1');  select pg_temp.mkdue('w2');
select is(pg_temp.try('a_sales', pg_temp.cd('w1', 'w1', 'email', pg_temp.req('w1', pg_temp.asof(interval '-2 minutes -50 seconds')))), 'ok', 'D60a an as_of 2 minutes 50 seconds old is accepted (the window is 3 minutes back)');
select is(pg_temp.try('a_sales', pg_temp.cd('w2', 'w2', 'email', pg_temp.req('w2', pg_temp.asof(interval '2 minutes')))), 'ok', 'D60b an as_of exactly 2 minutes ahead is accepted');

-- not due (SM225, the database's own decision, detail = the closed reason)
select pg_temp.mklead('n0');
select pg_temp.mklead('n1');   select pg_temp.run('a_sales', format('select public.record_touch(%L, %L, ''out'', ''email'', null)', tests.rid('t_n1'), tests.rid('n1')));
select pg_temp.mkdue('n3', 3);
select pg_temp.mkdue('n4');    select pg_temp.run('a_sales', format('select public.record_touch(%L, %L, ''in'', ''email'', null)', tests.rid('t_n4_in'), tests.rid('n4')));
select pg_temp.mkdue('n5');    insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at, recorded_at) values (tests.rid('t_n5_f'), tests.tid('a'), tests.rid('n5'), tests.rid('n5_c'), 'out', 'email', now() + interval '1 hour', now() + interval '2 hours');
select is(pg_temp.mk('a_sales', 'n0', 'n0'), 'SM225:initial_outreach', 'D61 a lead with no outbound touch: the first message is a person''s (initial_outreach)');
select is(pg_temp.mk('a_sales', 'n1', 'n1'), 'SM225:not_yet', 'D62 a touch just now and a gap of one day: not yet');
select is(pg_temp.mk('a_sales', 'n3', 'n3'), 'SM225:max_touches', 'D63 three outbound touches under a limit of three: the limit is reached');
select is(pg_temp.mk('a_sales', 'n4', 'n4'), 'SM225:replied', 'D64 a reply: a person takes over (replied)');
select is(pg_temp.mk('a_sales', 'n5', 'n5'), 'SM225:future_history', 'D65 a touch after as_of: refused (future_history)');
select is((select count(*) from public.followup_drafts where lead_id in (tests.rid('n0'), tests.rid('n1'), tests.rid('n3'), tests.rid('n4'), tests.rid('n5'))), 0::bigint, 'D66 nothing was written for a lead that is not due');

-- the draft itself
select is((select touch_number || '/' || status || '/' || channel || '/' || template_code || '/' || engine_version || '/' || (policy_version_id = app.followup_active_policy_version(tests.tid('a'), pg_temp.today()))
             || '/' || (contact_id = tests.rid('f1_c')) || '/' || (created_by = tests.uid('a_sales')) || '/' || (state_hash ~ '^[0-9a-f]{64}$') || '/' || (canonical_hash ~ '^[0-9a-f]{64}$')
             from public.followup_drafts where id = pg_temp.did('f1')),
          '2/draft/email/followup_gentle/1.0.0/true/true/true/true/true', 'D67 the draft: touch 2, a draft, the second-touch template, the policy in force, the lead''s contact, the caller as creator, both hashes');
select is((select body = (select t.body from public.followup_templates t where t.code = 'followup_gentle') from public.followup_drafts where id = pg_temp.did('f1')), true, 'D68 the body is the closed template COPIED by the database (the caller supplied no text)');
select is((select as_of = date_trunc('second', now()) from public.followup_drafts where id = pg_temp.did('f1')), true, 'D69 as_of is the request''s');
select is(pg_temp.mk('a_sales', 'l1', 'l1'), 'ok', 'D70 a lead with two outbound touches under a limit of three');
select is((select touch_number || '/' || template_code from public.followup_drafts where id = pg_temp.did('l1')), '3/followup_last', 'D71 touch 3 of 3: the LAST wording');
-- replay and conflict
select is(pg_temp.j(pg_temp.sc('a_sales', pg_temp.cd('f1', 'f1')), 'replayed'), 'true', 'D72 an exact retry replays');
select is(pg_temp.j(pg_temp.sc('a_admin', pg_temp.cd('f1', 'f1')), 'status'), 'draft', 'D73 ... by anyone with the role, and reports the status');
select is(pg_temp.try('a_sales', pg_temp.cd('f1', 'f1', 'whatsapp')), '23505', 'D74 the same id on another channel is the constant conflict');
select is(pg_temp.try('a_sales', pg_temp.cd('f1', 'dd')), '23505', 'D75 the same id for another lead');
select is(pg_temp.try('a_sales', format('select public.create_followup_draft(%L, %L, ''email'', ''1.0.0'', %L, %L)', pg_temp.did('f1'), tests.rid('f1'), pg_temp.req('f1', pg_temp.asof(interval '-1 minute'))::text,
                                       pg_temp.res(pg_temp.req('f1', pg_temp.asof(interval '-1 minute')))::text)), '23505', 'D76 the same id with another request (another as_of) is the constant conflict');
select is(pg_temp.try('a_sales', pg_temp.cd('f1b', 'f1')), 'SM223:exists', 'D77 a second draft for the same lead and touch number is refused (SM223, exists): one active draft per touch');
select is(pg_temp.priv(format($q$insert into public.followup_drafts (id, tenant_id, lead_id, contact_id, touch_number, channel, template_code, body, policy_version_id, engine_version, request_text, result_text, canonical_hash, state_hash, as_of)
                               select gen_random_uuid(), tenant_id, lead_id, contact_id, touch_number, channel, template_code, body, policy_version_id, engine_version, request_text, result_text, canonical_hash, state_hash, as_of
                                 from public.followup_drafts where id = %L$q$, pg_temp.did('f1'))), '23505', 'D78 and the unique index refuses it even from a privileged writer');
select is(pg_temp.try('a_sales', pg_temp.cd('dd1', 'dd', 'whatsapp')), 'ok', 'D79 a WhatsApp draft is allowed for a WhatsApp-consented contact');
select is(pg_temp.mk('a_sales', 'dd2', 'dd', 'email'), 'SM223:exists', 'D80 ... and the active WhatsApp draft already holds touch 2 for this lead (the unique key is per touch number, not per channel)');
select is(pg_temp.nd('f1') + pg_temp.nd('dd'), 2::bigint, 'D81 one draft each');

-- ============================================================================ E. approve_followup_draft
-- the matrix: the Owner and the Admin approve at aal2 (aal1 asks for the second factor, AFTER the role is proven); Sales, a Viewer, another tenant, an outsider and anon get the generic refusal
select is(pg_temp.cells(format('select public.approve_followup_draft(%L, %L)', pg_temp.did('dm'), (select state_hash from public.followup_drafts where id = pg_temp.did('dm'))),
                        'a_owner@aal1=SM306,a_owner@aal2=ok,a_admin@aal1=SM306,a_admin@aal2=ok'), null,
          'E1 the matrix: Owner and Admin approve at aal2 (SM306 at aal1); Sales (even at aal2), a Viewer, another tenant, an outsider and anon get 42501');
select is((select status::text || '/' || (approved_by = tests.uid('a_owner')) || '/' || (approved_at is not null) from public.followup_drafts where id = pg_temp.did('dm')), 'approved/true/true', 'E2 the draft is approved by the first successful caller (the Owner)');
select is(pg_temp.err('a_sales', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('f1'), repeat('0', 64))), pg_temp.err('a_sales', format('select public.approve_followup_draft(%L, %L)', gen_random_uuid(), repeat('0', 64))),
          'E3 a refusal for a role and for an unknown draft are the SAME answer');
select is(pg_temp.j(pg_temp.sc('a_admin', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('dm'), (select state_hash from public.followup_drafts where id = pg_temp.did('dm')))), 'replayed'), 'true', 'E4 approving an approved draft with its own hash replays');
select is(pg_temp.try('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('dm'), repeat('0', 64))), 'SM223:not_draft', 'E5 ... but with another hash it is not a draft any more (SM223)');
select is(pg_temp.try('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('f1'), repeat('0', 64))), 'SM224', 'E6 a person who reviewed another version (a wrong hash) is refused as stale (SM224)');
select is(pg_temp.try('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('f1'), 'nothex')), '22023', 'E7 a hash that is not 64 hex digits is invalid');
select is(pg_temp.try('a_owner', format('select public.approve_followup_draft(%L, null)', pg_temp.did('f1'))), '22023', 'E8 a null hash is invalid');
select is(pg_temp.try('a_owner', 'select public.approve_followup_draft(null, null)'), '42501', 'E9 null ids are the generic refusal');
select is(pg_temp.dst('f1'), 'draft', 'E10 (nothing above changed f1)');
-- a discarded draft cannot be approved
select is(pg_temp.try('a_admin', format('select public.discard_followup_draft(%L)', pg_temp.did('dd1'))), 'ok', 'E11 (an Admin discards the WhatsApp draft)');
select is(pg_temp.approve('a_owner', 'dd1'), 'SM223:not_draft', 'E12 a discarded draft cannot be approved (SM223)');
-- the gate AGAIN at approval: a key suppressed through ANOTHER contact after the draft was made
select pg_temp.mkdue('ak');   select pg_temp.run('a_sales', pg_temp.cd('ak', 'ak'));
insert into public.contacts (id, tenant_id, company_id, full_name, email, phone) values (tests.rid('ak_x'), tests.tid('a'), tests.rid('a_company'), 'Contact ak_x', 'ak_x@example.test', '+00 9 88881');
select pg_temp.run('a_owner', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('ak_x'), jsonb_build_object('version', 1, 'email', pg_temp.h('ak_e'), 'phone', pg_temp.h('ak_x_p'))));
select is(pg_temp.approve('a_owner', 'ak'), 'ok', 'E13 (control: with nothing wrong the same draft could be approved: we test the refusal on a twin below)');
select pg_temp.mkdue('ak2');  select pg_temp.run('a_sales', pg_temp.cd('ak2', 'ak2'));
insert into public.contacts (id, tenant_id, company_id, full_name, email, phone) values (tests.rid('ak2_x'), tests.tid('a'), tests.rid('a_company'), 'Contact ak2_x', 'ak2_x@example.test', '+00 9 88882');
select pg_temp.run('a_owner', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('ak2_x'), jsonb_build_object('version', 1, 'email', pg_temp.h('ak2_e'), 'phone', pg_temp.h('ak2_x_p'))));
select pg_temp.run('a_owner', format($q$select public.suppress_contact(%L, %L, 'opted_out', 'other', 'ref:ak2x')$q$, tests.tid('a'), tests.rid('ak2_x')));
select is(pg_temp.approve('a_owner', 'ak2'), 'SM220:key', 'E14 a key suppressed since the draft was made: the approval is refused (SM220, key)');
select is(pg_temp.dst('ak2'), 'draft', 'E15 ... and the draft stays a draft');
-- ... and again for a contact that lost its key (an address changed: the stored key is forgotten until the API records the new one)
select pg_temp.mkdue('ak3');  select pg_temp.run('a_sales', pg_temp.cd('ak3', 'ak3'));
update public.contacts set email = 'ak3.new@example.test' where id = tests.rid('ak3_c');
select is(pg_temp.approve('a_owner', 'ak3'), 'SM221', 'E16 an address changed since the draft was made: its key is forgotten, the approval is refused (SM221)');
-- the stop again at approval
select pg_temp.mkdue('as');   select pg_temp.run('a_sales', pg_temp.cd('as', 'as'));
select pg_temp.mkorder('as', 'as', 'accepted');
select is(pg_temp.approve('a_owner', 'as'), 'SM227:order_accepted', 'E17 an order accepted since the draft was made: the approval is refused (SM227)');
select pg_temp.mkdue('ac');   select pg_temp.run('a_sales', pg_temp.cd('ac', 'ac'));
update public.leads set archived_at = now() where id = tests.rid('ac');
select is(pg_temp.approve('a_owner', 'ac'), 'SM227:lead_archived', 'E18 a lead archived since the draft was made (lead_archived)');
-- consent withdrawn since the draft was made
select pg_temp.mkdue('aw');   select pg_temp.run('a_sales', pg_temp.cd('aw', 'aw'));
select pg_temp.run('a_owner', format($q$select public.record_consent(%L, %L, 'email', 'withdrawn')$q$, tests.tid('a'), tests.rid('aw_c')));
select is(pg_temp.approve('a_owner', 'aw'), 'SM220:consent', 'E19 consent withdrawn since the draft was made: the approval is refused (SM220, consent)');
-- stale: the contact of the lead changed
select is(pg_temp.dst('s4'), 'draft', 'E20 (the draft of the lead with an approved order)');
update public.leads set contact_id = tests.rid('a_contact'), company_id = tests.rid('a_company') where id = tests.rid('st_new');
select is(pg_temp.approve('a_owner', 's4'), 'SM224', 'E21 the lead''s contact changed since the draft was made: stale (SM224)');
-- stale: a reply recorded behind the system''s back (a privileged insert: the function would also have discarded the draft)
select pg_temp.mkdue('sr');   select pg_temp.run('a_sales', pg_temp.cd('sr', 'sr'));
insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at) values (tests.rid('t_sr_in'), tests.tid('a'), tests.rid('sr'), tests.rid('sr_c'), 'in', 'email', now());
select is(pg_temp.approve('a_owner', 'sr'), 'SM224', 'E22 a reply that appeared since the draft was made: stale (SM224)');
-- stale: another outbound touch behind the system''s back
select pg_temp.mkdue('so');   select pg_temp.run('a_sales', pg_temp.cd('so', 'so'));
insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at) values (tests.rid('t_so_out'), tests.tid('a'), tests.rid('so'), tests.rid('so_c'), 'out', 'email', now() - interval '1 hour');
select is(pg_temp.approve('a_owner', 'so'), 'SM224', 'E23 an outbound touch that appeared since the draft was made: stale (SM224)');
-- stale: the policy changed (a new version in force)
select pg_temp.mkdue('sp');   select pg_temp.run('a_sales', pg_temp.cd('sp', 'sp'));
select is(pg_temp.mkpol('p9', pg_temp.pol(p_min => 1)), 'ok', 'E24 (a new benign policy version, the one in force from now on)');
select is(pg_temp.approve('a_owner', 'sp'), 'SM224', 'E25 the policy in force changed since the draft was made: stale (SM224)');
select is(pg_temp.approve('a_owner', 'f1'), 'SM224', 'E26 so is every draft made under the old policy (f1)');
select is(pg_temp.mk('a_sales', 'sp2', 'sp'), 'SM223:exists', 'E27 (the stale draft still holds its touch number: discard it first)');
select is(pg_temp.try('a_sales', format('select public.discard_followup_draft(%L)', pg_temp.did('sp'))), 'ok', 'E28 a Sales user discards her own stale draft');
select is(pg_temp.try('a_sales', pg_temp.cd('sp3', 'sp')), 'ok', 'E29 and makes a fresh one under the new policy');
select is(pg_temp.approve('a_owner', 'sp3'), 'ok', 'E30 which the Owner approves');

-- ============================================================================ F. discard_followup_draft
select pg_temp.mkdue('fd');   select pg_temp.run('a_owner', pg_temp.cd('fd', 'fd'));
select is(pg_temp.cells(format('select public.discard_followup_draft(%L)', pg_temp.did('fd')),
                        'a_owner@aal1=ok,a_owner@aal2=ok,a_admin@aal1=ok,a_admin@aal2=ok,a_sales@aal1=SM228,a_sales@aal2=SM228'), null,
          'F1 the matrix: Owner and Admin discard any draft at either level; Sales only her own (SM228 for another person''s); a Viewer, another tenant, an outsider and anon get 42501');
select is((select status::text || '/' || discard_code::text || '/' || (discarded_by = tests.uid('a_owner')) || '/' || (discarded_at is not null) from public.followup_drafts where id = pg_temp.did('fd')), 'discarded/person/true/true', 'F2 discarded by a person, with the reason recorded');
select is(pg_temp.j(pg_temp.sc('a_admin', format('select public.discard_followup_draft(%L)', pg_temp.did('fd'))), 'replayed'), 'true', 'F3 discarding again replays');
select pg_temp.mkdue('fs');   select pg_temp.run('a_sales', pg_temp.cd('fs', 'fs'));
select is(pg_temp.try('a_sales', format('select public.discard_followup_draft(%L)', pg_temp.did('fs'))), 'ok', 'F4 Sales discards her OWN draft');
select pg_temp.mkdue('fs2');  select pg_temp.run('a_owner', pg_temp.cd('fs2', 'fs2'));
select pg_temp.run('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('fs2'), (select state_hash from public.followup_drafts where id = pg_temp.did('fs2'))));
select is(pg_temp.try('a_sales', format('select public.discard_followup_draft(%L)', pg_temp.did('fs2'))), 'SM228', 'F5 ... and not an approved draft someone else made');
select is(pg_temp.try('a_admin', format('select public.discard_followup_draft(%L)', pg_temp.did('fs2'))), 'ok', 'F6 an Admin discards an APPROVED draft (it was not sent)');
select is(pg_temp.try('a_sales', pg_temp.cd('fd2', 'fd')), 'ok', 'F7 a discarded draft frees its touch number: a new draft can be made');
select is(pg_temp.err('b_sales', format('select public.discard_followup_draft(%L)', pg_temp.did('fd2'))), pg_temp.err('b_sales', format('select public.discard_followup_draft(%L)', gen_random_uuid())),
          'F8 a Sales user of another tenant is refused exactly as for an unknown draft (no existence oracle)');
select is(pg_temp.try('a_owner', 'select public.discard_followup_draft(null)'), '42501', 'F9 a null id is the generic refusal');

-- ============================================================================ G. record_draft_sent ("I sent it": a person's word; the system sends nothing)
select pg_temp.mkdue('gm');   select pg_temp.run('a_sales', pg_temp.cd('gm', 'gm'));
select is(pg_temp.sent('a_sales', 'gm'), 'SM223:not_approved', 'G1 a draft that is not approved cannot be recorded as sent (SM223)');
select pg_temp.run('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('gm'), (select state_hash from public.followup_drafts where id = pg_temp.did('gm'))));
select is(pg_temp.cells(format('select public.record_draft_sent(%L, %L, null)', pg_temp.did('gm'), tests.rid('s_gm')), 'a_owner@aal1=ok,a_owner@aal2=ok,a_admin@aal1=ok,a_admin@aal2=ok,a_sales@aal1=ok,a_sales@aal2=ok'), null,
          'G2 the matrix: Owner / Admin / Sales record "I sent it" at either level (the first writes, the rest replay); a Viewer, another tenant, an outsider and anon get 42501');
select is((select status::text from public.followup_drafts where id = pg_temp.did('gm')), 'recorded_sent', 'G3 the draft is recorded as sent');
select is((select count(*) from public.lead_touches where draft_id = pg_temp.did('gm')), 1::bigint, 'G4 exactly one outbound touch carries it');
select is((select direction::text || '/' || channel::text || '/' || (contact_id = tests.rid('gm_c')) || '/' || (lead_id = tests.rid('gm')) || '/' || (recorded_by = tests.uid('a_owner')) from public.lead_touches where id = tests.rid('s_gm')), 'out/email/true/true/true',
          'G5 an outbound touch on the draft''s channel and contact, recorded by the first caller');
select is(pg_temp.j(pg_temp.sc('a_sales', format('select public.record_draft_sent(%L, %L, null)', pg_temp.did('gm'), tests.rid('s_gm'))), 'replayed'), 'true', 'G6 an exact retry replays');
select is(pg_temp.try('a_sales', format('select public.record_draft_sent(%L, %L, null)', pg_temp.did('gm'), gen_random_uuid())), 'SM223:closed', 'G7 a draft already recorded under another touch id is closed (SM223)');
select is(pg_temp.try('a_sales', format('select public.record_draft_sent(%L, %L, null)', pg_temp.did('dm'), tests.rid('s_gm'))), '23505', 'G8 a touch id already used by another draft is the constant conflict');
select is(pg_temp.try('a_owner', format('select public.discard_followup_draft(%L)', pg_temp.did('gm'))), 'SM223:closed', 'G9 a recorded draft cannot be discarded (SM223, closed)');
select is(pg_temp.approve('a_owner', 'gm'), 'SM223:not_draft', 'G10 ... or approved again');
select is(app.followup_build(tests.rid('gm'), pg_temp.asof(), pg_temp.polid('gm')) -> 'history' -> 1 ->> 'direction', 'out', 'G11 the history the cadence reads now has the second outbound touch');
-- time of the touch
select pg_temp.mkdue('gt');   select pg_temp.run('a_sales', pg_temp.cd('gt', 'gt'));
select pg_temp.run('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('gt'), (select state_hash from public.followup_drafts where id = pg_temp.did('gt'))));
-- the sent time: not before the approval, not more than 5 minutes ahead (the approval is aged by switching the guard off for one statement, inside the test transaction)
create function pg_temp.age_approval(p_label text, p_by interval) returns void language plpgsql as $$
begin
  alter table public.followup_drafts disable trigger followup_drafts_guard_update;
  update public.followup_drafts set approved_at = approved_at - p_by where id = pg_temp.did(p_label);
  alter table public.followup_drafts enable trigger followup_drafts_guard_update;
end $$;
select pg_temp.age_approval('gt', interval '2 hours');
select is(pg_temp.try('a_sales', format('select public.record_draft_sent(%L, %L, %L)', pg_temp.did('gt'), gen_random_uuid(), now() + interval '1 second')), '23514', 'G12 a sent time after now is refused (no future slack)');
select is(pg_temp.try('a_sales', format('select public.record_draft_sent(%L, %L, %L)', pg_temp.did('gt'), gen_random_uuid(), (select approved_at - interval '1 second' from public.followup_drafts where id = pg_temp.did('gt')))), '23514', 'G13 one second before the approval is refused');
select is(pg_temp.try('a_sales', format('select public.record_draft_sent(%L, %L, %L)', pg_temp.did('gt'), tests.rid('s_gt'), (select approved_at from public.followup_drafts where id = pg_temp.did('gt')))), 'ok', 'G14 exactly at the approval time is allowed');
select is((select occurred_at = (select approved_at from public.followup_drafts where id = pg_temp.did('gt')) from public.lead_touches where id = tests.rid('s_gt')), true, 'G15 recorded as stated');
select pg_temp.mkdue('gt2');   select pg_temp.run('a_sales', pg_temp.cd('gt2', 'gt2'));
select pg_temp.run('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('gt2'), (select state_hash from public.followup_drafts where id = pg_temp.did('gt2'))));
select is(pg_temp.try('a_sales', format('select public.record_draft_sent(%L, %L, %L)', pg_temp.did('gt2'), tests.rid('s_gt2'), now())), 'ok', 'G15b exactly now is allowed');
select is(pg_temp.try('a_sales', format('select public.record_draft_sent(%L, %L, %L)', pg_temp.did('gt2'), gen_random_uuid(), now())), 'SM223:closed', 'G15c (the draft is recorded: a second try is closed, whatever the time)');
select pg_temp.mkdue('gt3');   select pg_temp.run('a_sales', pg_temp.cd('gt3', 'gt3'));
select pg_temp.run('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('gt3'), (select state_hash from public.followup_drafts where id = pg_temp.did('gt3'))));
select is(pg_temp.try('a_sales', format('select public.record_draft_sent(%L, %L, %L)', pg_temp.did('gt3'), gen_random_uuid(), now() - interval '1 second')), '23514', 'G15d a draft approved just now cannot have been sent a second ago');
select is(pg_temp.try('a_sales', format('select public.record_draft_sent(%L, %L, null)', pg_temp.did('gt3'), gen_random_uuid())), 'ok', 'G15e ... but "now" (null) is allowed');
select is(pg_temp.try('a_sales', 'select public.record_draft_sent(null, null, null)'), '42501', 'G16 null ids are the generic refusal');
select is(pg_temp.err('a_viewer', format('select public.record_draft_sent(%L, %L, null)', pg_temp.did('gt'), gen_random_uuid())), pg_temp.err('a_viewer', format('select public.record_draft_sent(%L, %L, null)', gen_random_uuid(), gen_random_uuid())),
          'G17 a refusal for a role and for an unknown draft are the SAME answer');
-- the gate, the stop and the history AGAIN at this step (an approval that was valid when given is not enough later)
select pg_temp.mkdue('gk');   select pg_temp.run('a_sales', pg_temp.cd('gk', 'gk'));
select pg_temp.run('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('gk'), (select state_hash from public.followup_drafts where id = pg_temp.did('gk'))));
insert into public.contacts (id, tenant_id, company_id, full_name, email, phone) values (tests.rid('gk_x'), tests.tid('a'), tests.rid('a_company'), 'Contact gk_x', 'gk_x@example.test', '+00 9 77771');
select pg_temp.run('a_owner', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('gk_x'), jsonb_build_object('version', 1, 'email', pg_temp.h('gk_e'), 'phone', pg_temp.h('gk_x_p'))));
select pg_temp.run('a_owner', format($q$select public.suppress_contact(%L, %L, 'opted_out', 'other', 'ref:gkx')$q$, tests.tid('a'), tests.rid('gk_x')));
select is(pg_temp.sent('a_sales', 'gk'), 'SM220:key', 'G18 a key suppressed AFTER the approval: "I sent it" is refused (SM220, key)');
select is((select count(*) from public.lead_touches where lead_id = tests.rid('gk')) - 1, 0::bigint, 'G19 ... and no touch was written (the one touch is the lead''s own earlier one)');
select pg_temp.mkdue('gu');   select pg_temp.run('a_sales', pg_temp.cd('gu', 'gu'));
select pg_temp.run('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('gu'), (select state_hash from public.followup_drafts where id = pg_temp.did('gu'))));
delete from suppression.contact_keys where contact_id = tests.rid('gu_c');
select is(pg_temp.sent('a_sales', 'gu'), 'SM221', 'G20 the contact''s key is gone after the approval: refused (SM221)');
select pg_temp.mkdue('go');   select pg_temp.run('a_sales', pg_temp.cd('go', 'go'));
select pg_temp.run('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('go'), (select state_hash from public.followup_drafts where id = pg_temp.did('go'))));
select pg_temp.mkorder('go', 'go', 'accepted');
select is(pg_temp.sent('a_sales', 'go'), 'SM227:order_accepted', 'G21 an order accepted after the approval: refused (SM227)');
select pg_temp.mkdue('gh');   select pg_temp.run('a_sales', pg_temp.cd('gh', 'gh'));
select pg_temp.run('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('gh'), (select state_hash from public.followup_drafts where id = pg_temp.did('gh'))));
insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at) values (tests.rid('t_gh_out'), tests.tid('a'), tests.rid('gh'), tests.rid('gh_c'), 'out', 'email', now() - interval '1 hour');
select is(pg_temp.sent('a_sales', 'gh'), 'SM224', 'G22 another outbound touch appeared after the approval: the history moved (SM224)');
select pg_temp.mkdue('gr');   select pg_temp.run('a_sales', pg_temp.cd('gr', 'gr'));
select pg_temp.run('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('gr'), (select state_hash from public.followup_drafts where id = pg_temp.did('gr'))));
insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at) values (tests.rid('t_gr_in'), tests.tid('a'), tests.rid('gr'), tests.rid('gr_c'), 'in', 'email', now());
select is(pg_temp.sent('a_sales', 'gr'), 'SM224', 'G23 a reply appeared after the approval (SM224)');
select pg_temp.mkdue('gc');   select pg_temp.run('a_sales', pg_temp.cd('gc', 'gc'));
select pg_temp.run('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('gc'), (select state_hash from public.followup_drafts where id = pg_temp.did('gc'))));
update public.leads set contact_id = tests.rid('a_contact') where id = tests.rid('gc');
select is(pg_temp.sent('a_sales', 'gc'), 'SM224', 'G24 the lead''s contact changed after the approval (SM224)');
select pg_temp.mkdue('gw');   select pg_temp.run('a_sales', pg_temp.cd('gw', 'gw'));
select pg_temp.run('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('gw'), (select state_hash from public.followup_drafts where id = pg_temp.did('gw'))));
select pg_temp.run('a_owner', format($q$select public.record_consent(%L, %L, 'email', 'withdrawn')$q$, tests.tid('a'), tests.rid('gw_c')));
select is(pg_temp.sent('a_sales', 'gw'), 'SM220:consent', 'G25 consent withdrawn after the approval (SM220, consent)');
-- side effects of recording a touch on the open drafts
select pg_temp.mkdue('sp1');  select pg_temp.run('a_sales', pg_temp.cd('sp1', 'sp1'));
select is(pg_temp.touch('a_sales', 'sp1o', 'sp1', 'out'), 'ok', 'G26 a person records an outbound touch on a lead with an open draft');
select is((select status::text || '/' || discard_code::text from public.followup_drafts where id = pg_temp.did('sp1')), 'discarded/superseded', 'G27 the open draft for that touch number is discarded as superseded');
select pg_temp.mkdue('rp1');  select pg_temp.run('a_sales', pg_temp.cd('rp1', 'rp1'));
select pg_temp.run('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('rp1'), (select state_hash from public.followup_drafts where id = pg_temp.did('rp1'))));
select is(pg_temp.touch('a_sales', 'rp1i', 'rp1', 'in'), 'ok', 'G28 a reply is recorded on a lead with an APPROVED draft');
select is((select status::text || '/' || discard_code::text from public.followup_drafts where id = pg_temp.did('rp1')), 'discarded/reply_recorded', 'G29 the approved draft is discarded: a person takes over (reply_recorded)');
select is(pg_temp.sent('a_sales', 'rp1'), 'SM223:not_approved', 'G30 and cannot be recorded as sent');

-- a draft older than 7 days is stale: neither approved nor recorded as sent (SM224); exactly 7 days is still fine
create function pg_temp.age_created(p_label text, p_by interval) returns void language plpgsql as $$
begin
  alter table public.followup_drafts disable trigger followup_drafts_guard_update;
  update public.followup_drafts set created_at = now() - p_by where id = pg_temp.did(p_label);
  alter table public.followup_drafts enable trigger followup_drafts_guard_update;
end $$;
select pg_temp.mkdue('ag1');  select pg_temp.run('a_sales', pg_temp.cd('ag1', 'ag1'));  select pg_temp.age_created('ag1', interval '7 days 1 second');
select is(pg_temp.approve('a_owner', 'ag1'), 'SM224', 'G31 a draft older than 7 days cannot be approved (SM224)');
select pg_temp.mkdue('ag2');  select pg_temp.run('a_sales', pg_temp.cd('ag2', 'ag2'));  select pg_temp.age_created('ag2', interval '7 days');
select is(pg_temp.approve('a_owner', 'ag2'), 'ok', 'G32 a draft exactly 7 days old can');
select pg_temp.mkdue('ag3');  select pg_temp.run('a_sales', pg_temp.cd('ag3', 'ag3'));
select pg_temp.run('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('ag3'), (select state_hash from public.followup_drafts where id = pg_temp.did('ag3'))));
select pg_temp.age_created('ag3', interval '7 days 1 second');
select is(pg_temp.sent('a_sales', 'ag3'), 'SM224', 'G33 ... nor recorded as sent once it is older than 7 days (SM224), even though it was approved in time');
select is(pg_temp.dst('ag3'), 'approved', 'G34 (it stays approved: a person discards it)');
select pg_temp.mkdue('ag4');  select pg_temp.run('a_sales', pg_temp.cd('ag4', 'ag4'));
select pg_temp.run('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('ag4'), (select state_hash from public.followup_drafts where id = pg_temp.did('ag4'))));
select pg_temp.age_created('ag4', interval '7 days');
select is(pg_temp.sent('a_sales', 'ag4'), 'ok', 'G35 a draft exactly 7 days old can be recorded as sent');
-- the sent time is not before the lead's latest outbound touch either (the approval is aged to 6 days ago so that this rule, not the approval, is the one that bites; the lead's outbound touch is 5 days ago)
select pg_temp.mkdue('so2');  select pg_temp.run('a_sales', pg_temp.cd('so2', 'so2'));
select pg_temp.run('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('so2'), (select state_hash from public.followup_drafts where id = pg_temp.did('so2'))));
select pg_temp.age_approval('so2', interval '6 days');
select is(pg_temp.try('a_sales', format('select public.record_draft_sent(%L, %L, %L)', pg_temp.did('so2'), gen_random_uuid(), now() - interval '5 days 1 second')), '23514', 'G36 a sent time one second before the lead''s latest outbound touch is refused');
select is(pg_temp.try('a_sales', format('select public.record_draft_sent(%L, %L, %L)', pg_temp.did('so2'), tests.rid('s_so2'), now() - interval '5 days')), 'ok', 'G37 exactly at it is allowed');

-- a change of a contact's e-mail or phone INVALIDATES the stored key of that identifier (part 1's trigger): the gate answers SM221 until the API re-keys it
select pg_temp.mklead('kc');
create function pg_temp.kg(p_channel text) returns text language sql as $$ select coalesce(pg_temp.gate('kc', p_channel) ->> 'blocked', 'open') $$;
select is(pg_temp.kg('email') || '/' || pg_temp.kg('whatsapp'), 'open/open', 'N1 a keyed, consented contact: both channels open');
select is(tests.rows_as(tests.uid('a_sales'), format($q$update public.contacts set email = email where id = %L$q$, tests.rid('kc_c'))), 1::bigint, 'N2 (an update that does not change the address)');
select is(pg_temp.kg('email'), 'open', 'N3 ... keeps the key');
select is((select email_hmac is not null and phone_hmac is not null from suppression.contact_keys where contact_id = tests.rid('kc_c')), true, 'N4 (both stored keys present)');
select is(tests.rows_as(tests.uid('a_sales'), format($q$update public.contacts set email = 'kc.changed@example.test' where id = %L$q$, tests.rid('kc_c'))), 1::bigint, 'N5 a person changes the contact''s e-mail address');
select is((select email_hmac is null and phone_hmac is not null from suppression.contact_keys where contact_id = tests.rid('kc_c')), true, 'N6 the stored E-MAIL key is forgotten; the phone key stays');
select is(pg_temp.kg('email'), 'unkeyed', 'N7 the gate answers `unkeyed` for e-mail');
select is(pg_temp.touch('a_sales', 'kc1', 'kc', 'out', 'email'), 'SM221', 'N8 and an outbound e-mail touch is refused with SM221');
select is(pg_temp.mk('a_sales', 'kc1', 'kc', 'email'), 'SM221', 'N9 as is a draft (the gate runs before everything else)');
select is(pg_temp.kg('whatsapp'), 'open', 'N10 WhatsApp is unaffected (the phone key is intact)');
select pg_temp.run('a_owner', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('kc_c'), jsonb_build_object('version', 1, 'email', pg_temp.h('kc_new_e'))));
select is(pg_temp.kg('email'), 'open', 'N11 once the API records the new key, the gate opens again');
select is(tests.rows_as(tests.uid('a_sales'), format($q$update public.contacts set phone = '+00 9 55501' where id = %L$q$, tests.rid('kc_c'))), 1::bigint, 'N12 a person changes the contact''s phone number');
select is(pg_temp.kg('whatsapp') || '/' || pg_temp.kg('email'), 'unkeyed/open', 'N13 the PHONE key is forgotten: WhatsApp answers `unkeyed`, e-mail stays open');
select is(pg_temp.touch('a_sales', 'kc2', 'kc', 'out', 'whatsapp'), 'SM221', 'N14 an outbound WhatsApp touch is refused (SM221)');
select is(pg_temp.touch('a_sales', 'kc3', 'kc', 'out', 'phone'), 'SM221', 'N15 and a phone-call touch');
select is(pg_temp.touch('a_sales', 'kc4', 'kc', 'in', 'whatsapp'), 'ok', 'N16 (a reply is still recordable)');
select pg_temp.run('a_owner', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('kc_c'), jsonb_build_object('version', 1, 'phone', pg_temp.h('kc_new_p'))));
select is(pg_temp.kg('whatsapp'), 'open', 'N17 re-keyed: open again');

-- ============================================================================ H. the contact trigger: a contact that becomes suppressed or erased has its open drafts discarded
select pg_temp.mkdue('hs');   select pg_temp.run('a_sales', pg_temp.cd('hs', 'hs'));
select pg_temp.run('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('hs'), (select state_hash from public.followup_drafts where id = pg_temp.did('hs'))));
insert into public.leads (id, tenant_id, company_id, contact_id, created_at) values (tests.rid('hs2'), tests.tid('a'), tests.rid('a_company'), tests.rid('hs_c'), now() - interval '30 days');
select pg_temp.run('a_sales', format('select public.record_touch(%L, %L, ''out'', ''email'', %L)', tests.rid('t_hs2'), tests.rid('hs2'), (now() - interval '5 days')::text));
select pg_temp.run('a_sales', pg_temp.cd('hs2', 'hs2'));
select is(pg_temp.dst('hs') || '/' || pg_temp.dst('hs2'), 'approved/draft', 'H1 a contact with an approved draft and a draft (two leads)');
select pg_temp.run('a_sales', format($q$select public.suppress_contact(%L, %L, 'opted_out', 'other', 'ref:hs')$q$, tests.tid('a'), tests.rid('hs_c')));
select is(pg_temp.dst('hs') || '/' || pg_temp.dst('hs2'), 'discarded/discarded', 'H2 suppressing the contact discards BOTH open drafts');
select is((select string_agg(discard_code::text, ',' order by id) from public.followup_drafts where id in (pg_temp.did('hs'), pg_temp.did('hs2'))), 'suppressed,suppressed', 'H3 with the reason (suppressed)');
select is((select discarded_by = tests.uid('a_sales') from public.followup_drafts where id = pg_temp.did('hs')), true, 'H4 and the person who suppressed (recorded in the draft and, through the audit trigger, in the trail)');
select is(pg_temp.dst('dm'), 'approved', 'H5 another contact''s drafts are untouched');
select pg_temp.run('a_owner', format($q$select public.lift_suppression(%L, %L, 'other', 'ref:lift')$q$, tests.tid('a'), tests.rid('hs_c')));
select is(pg_temp.dst('hs'), 'discarded', 'H6 lifting the suppression does not bring a draft back');
select pg_temp.mkdue('he');   select pg_temp.run('a_sales', pg_temp.cd('he', 'he'));
select pg_temp.mark_erased('he_c');
select is((select status::text || '/' || discard_code::text from public.followup_drafts where id = pg_temp.did('he')), 'discarded/erased', 'H7 erasing the contact discards its open draft (erased)');
select is(pg_temp.mk('a_sales', 'he2', 'he'), 'SM220:erased', 'H8 and no new draft can be made for an erased contact');
select is(pg_temp.touch('a_sales', 'he3', 'he', 'out'), 'SM220:erased', 'H9 nor a new outbound touch');

-- ============================================================================ I. direct writes and the guard triggers
-- no client writes any of the four tables (not even the Owner), by any statement
select is(tests.sqlstate_as(tests.uid('a_owner'), format($q$insert into public.lead_touches (id, tenant_id, lead_id, direction, channel, occurred_at) values (gen_random_uuid(), %L, %L, 'in', 'email', now())$q$, tests.tid('a'), tests.rid('l1'))), '42501', 'I1 an Owner cannot INSERT a touch');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($q$update public.lead_touches set channel = 'phone' where id = %L$q$, tests.rid('t_r1'))), '42501', 'I2 ... UPDATE one');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($q$delete from public.lead_touches where id = %L$q$, tests.rid('t_r1'))), '42501', 'I3 ... DELETE one');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($q$update public.followup_drafts set status = 'approved' where id = %L$q$, pg_temp.did('f1'))), '42501', 'I4 an Owner cannot approve a draft by UPDATE');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($q$delete from public.followup_drafts where id = %L$q$, pg_temp.did('f1'))), '42501', 'I5 ... delete a draft');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($q$update public.followup_policy_versions set max_touches = 9 where id = %L$q$, tests.rid('pol_p1'))), '42501', 'I6 ... change a policy');
select is(tests.sqlstate_as(tests.uid('a_owner'), 'truncate public.followup_drafts'), '42501', 'I7 ... truncate');
select is(tests.sqlstate_as(null, 'select count(*) from public.followup_drafts'), '42501', 'I8 anon cannot even read');
select is(tests.rows_as(tests.uid('a_viewer'), 'select * from public.followup_drafts'), 0::bigint, 'I9 a Viewer reads no draft');
select is(tests.rows_as(tests.uid('a_viewer'), 'select * from public.lead_touches') + tests.rows_as(tests.uid('a_viewer'), 'select * from public.followup_policy_versions'), 0::bigint, 'I10 ... no touch, no policy');
select cmp_ok(tests.rows_as(tests.uid('a_sales'), 'select * from public.followup_drafts'), '>', 0::bigint, 'I11 Sales reads drafts');
select is(tests.rows_as(tests.uid('b_sales'), format('select * from public.followup_drafts where tenant_id = %L', tests.tid('a'))), 0::bigint, 'I12 another tenant reads none of tenant a''s drafts');
select is(tests.rows_as(tests.uid('b_sales'), format('select * from public.lead_touches where tenant_id = %L', tests.tid('a'))), 0::bigint, 'I13 ... nor its touches');
-- the guard triggers (privileged writes)
select is(pg_temp.priv(format($q$update public.followup_drafts set body = 'Another synthetic body, long enough' where id = %L$q$, pg_temp.did('f1'))), '42501', 'I14 a draft''s content is immutable even for the table owner');
select is(pg_temp.priv(format($q$update public.followup_drafts set lead_id = %L where id = %L$q$, tests.rid('dd'), pg_temp.did('f1'))), '42501', 'I15 ... its lead too');
select is(pg_temp.priv(format($q$update public.followup_drafts set state_hash = repeat('9', 64) where id = %L$q$, pg_temp.did('f1'))), '42501', 'I16 ... and the fingerprint approvals compare against');
select is(pg_temp.priv(format($q$update public.followup_drafts set status = 'recorded_sent' where id = %L$q$, pg_temp.did('f1'))), '42501', 'I17 a draft cannot jump to recorded_sent (draft -> recorded_sent is not a move)');
select is(pg_temp.priv(format($q$update public.followup_drafts set status = 'approved', approved_at = now() + interval '1 hour' where id = %L$q$, pg_temp.did('ak'))), '42501', 'I18 an approved draft cannot be approved again by a write');
select is(pg_temp.priv(format($q$update public.followup_drafts set status = 'draft', approved_at = null, approved_by = null where id = %L$q$, pg_temp.did('ak'))), '42501', 'I19 an approved draft cannot go back to draft');
select is(pg_temp.priv(format($q$update public.followup_drafts set status = 'draft', discarded_at = null, discard_code = null where id = %L$q$, pg_temp.did('fd'))), '42501', 'I20 a discarded draft stays discarded');
select is(pg_temp.priv(format($q$update public.followup_drafts set status = 'approved', discarded_at = null, discard_code = null where id = %L$q$, pg_temp.did('fd'))), '42501', 'I21 ... whatever it is moved to');
select is(pg_temp.priv(format($q$update public.followup_drafts set status = 'approved', approved_at = now() + interval '1 hour' where id = %L$q$, pg_temp.did('gm'))), '42501', 'I22 a recorded draft stays recorded');
select is(pg_temp.priv(format($q$update public.followup_drafts set status = 'recorded_sent' where id = %L$q$, pg_temp.did('ak'))), '42501', 'I23 approved -> recorded_sent needs its outbound touch (a privileged write without one is refused)');
select is(pg_temp.priv(format($q$insert into public.followup_drafts (id, tenant_id, lead_id, contact_id, touch_number, status, approved_by, approved_at, channel, template_code, body, policy_version_id, engine_version, request_text, result_text, canonical_hash, state_hash, as_of)
                               select gen_random_uuid(), tenant_id, lead_id, contact_id, 9, 'approved', created_by, now(), channel, template_code, body, policy_version_id, engine_version, request_text, result_text, canonical_hash, state_hash, as_of
                                 from public.followup_drafts where id = %L$q$, pg_temp.did('f1'))), '42501', 'I24 a draft cannot be INSERTED already approved');
select is(pg_temp.priv(format($q$delete from public.followup_drafts where id = %L$q$, pg_temp.did('f1'))), '42501', 'I25 a draft is never deleted');
select is(pg_temp.priv('truncate public.followup_drafts cascade'), '42501', 'I26 ... nor truncated');
select is(pg_temp.priv(format($q$update public.lead_touches set occurred_at = now() where id = %L$q$, tests.rid('t_r1'))), '42501', 'I27 a touch is append-only (update)');
select is(pg_temp.priv(format($q$delete from public.lead_touches where id = %L$q$, tests.rid('t_r1'))), '42501', 'I28 ... delete');
select is(pg_temp.priv('truncate public.lead_touches cascade'), '42501', 'I29 ... truncate');
select is(pg_temp.priv(format($q$insert into public.lead_touches (id, tenant_id, lead_id, direction, channel, occurred_at, draft_id) values (gen_random_uuid(), %L, %L, 'in', 'email', now(), %L)$q$, tests.tid('a'), tests.rid('f1'), pg_temp.did('f1'))), '23514', 'I30 an INBOUND touch cannot carry a draft');
select is(pg_temp.priv(format($q$insert into public.lead_touches (id, tenant_id, lead_id, direction, channel, occurred_at, draft_id) values (gen_random_uuid(), %L, %L, 'out', 'email', now(), %L)$q$, tests.tid('a'), tests.rid('gm'), pg_temp.did('gm'))), '23505', 'I31 a draft has at most ONE touch');
select is(pg_temp.priv(format($q$insert into public.lead_touches (id, tenant_id, lead_id, direction, channel, occurred_at, draft_id) values (gen_random_uuid(), %L, %L, 'out', 'email', now(), %L)$q$, tests.tid('b'), tests.rid('b_lead'), pg_temp.did('f1'))), '23503', 'I32 a touch cannot name another tenant''s draft (composite key)');
select is(pg_temp.priv(format($q$update public.followup_drafts set tenant_id = %L where id = %L$q$, tests.tid('b'), pg_temp.did('f1'))), '42501', 'I33 a draft cannot move to another tenant');
select is(pg_temp.priv(format($q$insert into public.followup_drafts (id, tenant_id, lead_id, contact_id, touch_number, channel, template_code, body, policy_version_id, engine_version, request_text, result_text, canonical_hash, state_hash, as_of)
                               select gen_random_uuid(), tenant_id, lead_id, contact_id, 77, channel, 'no_such_template', body, policy_version_id, engine_version, request_text, result_text, canonical_hash, state_hash, as_of
                                 from public.followup_drafts where id = %L$q$, pg_temp.did('f1'))), '23503', 'I34 a draft needs a template from the closed list');
select is(pg_temp.priv(format($q$insert into public.followup_drafts (id, tenant_id, lead_id, contact_id, touch_number, channel, template_code, body, policy_version_id, engine_version, request_text, result_text, canonical_hash, state_hash, as_of)
                               select gen_random_uuid(), tenant_id, lead_id, contact_id, 78, channel, template_code, body, policy_version_id, '9.9.9', request_text, result_text, canonical_hash, state_hash, as_of
                                 from public.followup_drafts where id = %L$q$, pg_temp.did('f1'))), '23503', 'I35 ... and an engine version from the allow-list');
select is(pg_temp.priv(format($q$insert into public.followup_drafts (id, tenant_id, lead_id, contact_id, touch_number, channel, template_code, body, policy_version_id, engine_version, request_text, result_text, canonical_hash, state_hash, as_of)
                               select gen_random_uuid(), tenant_id, lead_id, contact_id, 79, 'phone', template_code, body, policy_version_id, engine_version, request_text, result_text, canonical_hash, state_hash, as_of
                                 from public.followup_drafts where id = %L$q$, pg_temp.did('f1'))), '23514', 'I36 a draft is for e-mail or WhatsApp only');
select is(pg_temp.priv(format($q$insert into public.followup_drafts (id, tenant_id, lead_id, contact_id, touch_number, channel, template_code, body, policy_version_id, engine_version, request_text, result_text, canonical_hash, state_hash, as_of)
                               select gen_random_uuid(), tenant_id, lead_id, contact_id, 80, channel, template_code, E'Body with a hidden​ character, long enough', policy_version_id, engine_version, request_text, result_text, canonical_hash, state_hash, as_of
                                 from public.followup_drafts where id = %L$q$, pg_temp.did('f1'))), '23514', 'I37 a hidden character in a draft body is refused by the database (text hygiene)');
select is(pg_temp.priv(format($q$insert into public.followup_drafts (id, tenant_id, lead_id, contact_id, touch_number, channel, template_code, body, policy_version_id, engine_version, request_text, result_text, canonical_hash, state_hash, as_of)
                               select gen_random_uuid(), tenant_id, lead_id, contact_id, 1, channel, template_code, body, policy_version_id, engine_version, request_text, result_text, canonical_hash, state_hash, as_of
                                 from public.followup_drafts where id = %L$q$, pg_temp.did('f1'))), '23514', 'I38 touch 1 is a person''s: a draft starts at touch 2');

-- ============================================================================ J. followup_gate (the read the screens use: closed words, never a key)
select is(pg_temp.cells(format('select public.followup_gate(%L, ''email'')', tests.rid('l1')), 'a_owner@aal1=ok,a_owner@aal2=ok,a_admin@aal1=ok,a_admin@aal2=ok,a_sales@aal1=ok,a_sales@aal2=ok'), null,
          'J1 the matrix: Owner / Admin / Sales read the gate at either level; a Viewer, another tenant, an outsider and anon get 42501');
select is(pg_temp.err('a_viewer', format('select public.followup_gate(%L, ''email'')', tests.rid('l1'))), pg_temp.err('a_viewer', format('select public.followup_gate(%L, ''email'')', gen_random_uuid())), 'J2 a refusal for a role and for an unknown lead are the SAME answer');
select is(pg_temp.try('a_sales', format('select public.followup_gate(%L, ''sms'')', tests.rid('l1'))), '22023', 'J3 an unknown channel is invalid');
select is(pg_temp.try('a_sales', format('select public.followup_gate(%L, null)', tests.rid('l1'))), '22023', 'J4 a null channel is invalid');
select is(pg_temp.gate('l1') ->> 'blocked', null, 'J5 an eligible lead: not blocked');
select is(pg_temp.gate('g_sup') ->> 'blocked', 'contact', 'J6 suppressed: contact');
select is(pg_temp.gate('g_erased') ->> 'blocked', 'erased', 'J7 erased');
select is(pg_temp.gate('g_unkeyed') ->> 'blocked', 'unkeyed', 'J8 no key: unkeyed');
select is(pg_temp.gate('g_key') ->> 'blocked', 'key', 'J9 a suppressed key (another contact)');
select is(pg_temp.gate('g_key', 'whatsapp') ->> 'blocked', null, 'J10 ... for e-mail only: WhatsApp is fine');
select is(pg_temp.gate('g_erkey') ->> 'blocked', 'key', 'J11 an erased marker on the key is shown by the read as plain `key` (the write refusals keep the detail erased_key: C29, D18)');
select is(pg_temp.gate('g_nocons') ->> 'blocked', 'consent', 'J12 no consent');
select is(pg_temp.gate('g_nocontact') ->> 'blocked', 'consent', 'J13 no contact');
select is(pg_temp.gate('st_acc') ->> 'stopped', 'order_accepted', 'J14 a stopped lead says why');
select is(pg_temp.gate('st_arch') ->> 'stopped', 'lead_archived', 'J15 ... archived');
select is(pg_temp.gate('l1') ->> 'stopped', null, 'J16 an ordinary lead is not stopped');
select is((pg_temp.gate('l1') ->> 'policy_in_force')::boolean, true, 'J17 a policy is in force for tenant a');
select is((pg_temp.sc('b_sales', format('select public.followup_gate(%L, ''email'')', tests.rid('b_lead')))::jsonb ->> 'policy_in_force')::boolean, false, 'J18 and not for tenant b');
select is((select array_agg(k order by k) from jsonb_object_keys(pg_temp.gate('l1')) k), array['blocked', 'policy_in_force', 'stopped'], 'J19 the answer has exactly three keys: no key, no identifier, no contact');
select is(pg_temp.gate('l1', 'email', 'a_owner')::text !~ '[0-9a-f]{32}', true, 'J20 and holds no hash-like value');

-- ============================================================================ K. audit
select cmp_ok((select count(*) from public.audit_events where entity_type = 'followup_draft' and action = 'followup_draft.create'), '>=', 10::bigint, 'K1 every draft creation is in the audit trail');
select cmp_ok((select count(*) from public.audit_events where entity_type = 'followup_draft' and action = 'followup_draft.update'), '>=', 5::bigint, 'K2 every approval, discard and "recorded as sent" too');
select cmp_ok((select count(*) from public.audit_events where entity_type = 'followup_policy_version' and action = 'followup_policy_version.create'), '>=', 3::bigint, 'K3 policy versions too');
select is((select count(*) from public.audit_events a where a.entity_type in ('followup_draft', 'lead_touch', 'followup_policy_version') and a.action like '%.create' and a.actor_user_id is null
            and a.entity_id in (select id from public.followup_drafts where created_by is not null union all select id from public.lead_touches where recorded_by is not null)), 0::bigint, 'K4 every creation of a person-made draft or touch names the actor');
select is((select count(*) from public.audit_events a where a.entity_type in ('followup_draft', 'lead_touch', 'followup_policy_version', 'question_draft')
             and exists (select 1 from suppression.contact_keys k where a.new_values::text like '%' || k.email_hmac || '%' or a.new_values::text like '%' || k.phone_hmac || '%'
                                                                       or a.old_values::text like '%' || k.email_hmac || '%' or a.old_values::text like '%' || k.phone_hmac || '%')), 0::bigint,
          'K5 no suppression key value appears in the audit trail of these tables');
select is((select (new_values ->> 'status') from public.audit_events where entity_id = pg_temp.did('dm') and action = 'followup_draft.update' order by created_at desc, id desc limit 1), 'approved', 'K6 an approval is recorded with the new state');
select is((select count(*) from public.audit_events a where a.entity_type = 'lead_touch' and a.old_values is not null), 0::bigint, 'K7 touches have only creation events (append-only)');

-- ============================================================================ L. app.followup_blocker on hand-made requests: the engine's own draft condition, one rule at a time
-- base: Wednesday 2026-10-07 12:00 local (as_of 06:30Z, offset +330); one outbound touch 5 days before; gaps [1, 2]; max 3; quiet 21:00-09:00; Monday to Friday; no holiday; no minimum gap
create function pg_temp.bl(p_asof text default '2026-10-07T06:30:00Z', p_hist text default '[{"timestamp": "2026-10-02T06:30:00Z", "channel": "email", "direction": "out", "outcome": "recorded_sent"}]',
                           p_flags text default '{}', p_gaps text default '[1, 2]', p_max int default 3, p_min int default 0, p_wd text default '[0, 1, 2, 3, 4]', p_hol text default '[]',
                           p_qs text default '21:00', p_qe text default '09:00', p_off int default 330) returns text language sql as $$
  select app.followup_blocker(jsonb_build_object('as_of', p_asof, 'recipient_utc_offset_minutes', p_off,
           'lead', jsonb_build_object('do_not_contact', false, 'opted_out', false, 'replied', false, 'bounced', false, 'won', false, 'lost', false) || p_flags::jsonb,
           'history', p_hist::jsonb,
           'policy', jsonb_build_object('gap_days', p_gaps::jsonb, 'max_touches', p_max, 'quiet_hours', jsonb_build_object('start', p_qs, 'end', p_qe), 'allowed_weekdays', p_wd::jsonb,
                                        'holidays', p_hol::jsonb, 'min_gap_hours', p_min))) $$;
create function pg_temp.o(p_ts text) returns text language sql as $$ select format('{"timestamp": "%s", "channel": "email", "direction": "out", "outcome": "recorded_sent"}', p_ts) $$;
create function pg_temp.i(p_ts text) returns text language sql as $$ select format('{"timestamp": "%s", "channel": "email", "direction": "in", "outcome": "recorded_reply"}', p_ts) $$;
select is(pg_temp.bl(), null, 'L1 the base request is DUE (the engine would answer draft_followup)');
select is(pg_temp.bl(p_flags => '{"do_not_contact": true}'), 'suppressed', 'L2 do_not_contact: suppressed');
select is(pg_temp.bl(p_flags => '{"opted_out": true}'), 'suppressed', 'L3 opted_out: suppressed');
select is(pg_temp.bl(p_flags => '{"bounced": true}'), 'suppressed', 'L4 bounced: suppressed');
select is(pg_temp.bl(p_flags => '{"replied": true}'), 'replied', 'L5 replied: replied');
select is(pg_temp.bl(p_hist => '[' || pg_temp.o('2026-10-02T06:30:00Z') || ',' || pg_temp.i('2026-10-03T06:30:00Z') || ']'), 'replied', 'L6 an inbound touch in the history: replied');
select is(pg_temp.bl(p_flags => '{"won": true}'), 'closed', 'L7 won: closed');
select is(pg_temp.bl(p_flags => '{"lost": true}'), 'closed', 'L8 lost: closed');
select is(pg_temp.bl(p_flags => '{"do_not_contact": true, "replied": true, "won": true}'), 'suppressed', 'L9 suppression wins over a reply and a close (the engine''s order)');
select is(pg_temp.bl(p_flags => '{"replied": true, "won": true}'), 'replied', 'L10 a reply wins over a close');
select is(pg_temp.bl(p_hist => '[' || pg_temp.o('2026-10-02T06:30:00Z') || ',' || pg_temp.o('2026-10-07T06:30:01Z') || ']'), 'future_history', 'L11 a touch one second after as_of: future_history');
select is(pg_temp.bl(p_hist => '[' || pg_temp.o('2026-10-02T06:30:00Z') || ',' || pg_temp.o('2026-10-07T06:30:00Z') || ']', p_max => 5, p_gaps => '[0, 0, 0, 0]'), null, 'L12 a touch exactly at as_of is not in the future');
select is(pg_temp.bl(p_hist => '[]'), 'initial_outreach', 'L13 no outbound touch: initial_outreach');
select is(pg_temp.bl(p_hist => '[' || pg_temp.o('2026-10-01T06:30:00Z') || ',' || pg_temp.o('2026-10-02T06:30:00Z') || ',' || pg_temp.o('2026-10-03T06:30:00Z') || ']'), 'max_touches', 'L14 three outbound under a limit of three: max_touches');
select is(pg_temp.bl(p_hist => '[' || pg_temp.o('2026-10-01T06:30:00Z') || ',' || pg_temp.o('2026-10-02T06:30:00Z') || ']'), null, 'L15 two outbound under a limit of three: due (touch 3)');
select is(pg_temp.bl(p_max => 1, p_gaps => '[]'), 'max_touches', 'L16 a limit of one: the first touch already reached it');
select is(pg_temp.bl(p_gaps => '[5, 1]'), null, 'L17 the gap before touch 2 is gap_days[0]: exactly 5 days after the touch is due (boundary)');
select is(pg_temp.bl(p_gaps => '[6, 1]'), 'not_yet', 'L19 one day short of the gap: not yet');
select is(pg_temp.bl(p_hist => '[' || pg_temp.o('2026-10-02T06:30:01Z') || ']', p_gaps => '[5, 1]'), 'not_yet', 'L20 one SECOND short of the gap: not yet');
select is(pg_temp.bl(p_hist => '[' || pg_temp.o('2026-10-01T06:30:00Z') || ',' || pg_temp.o('2026-10-05T06:30:00Z') || ']', p_gaps => '[1, 2]'), null, 'L21 touch 3 uses gap_days[1] = 2 days after the LAST outbound touch: exactly 2 days later is due (boundary)');
select is(pg_temp.bl(p_hist => '[' || pg_temp.o('2026-10-01T06:30:00Z') || ',' || pg_temp.o('2026-10-05T06:30:00Z') || ']', p_gaps => '[1, 3]'), 'not_yet', 'L23 touch 3 with gap_days[1] = 3: the last touch was 2 days ago: not yet (the index is touch_number - 2)');
select is(pg_temp.bl(p_hist => '[' || pg_temp.o('2026-10-01T06:30:00Z') || ',' || pg_temp.o('2026-10-05T06:30:00Z') || ']', p_gaps => '[9, 2]'), null, 'L24 ... and with gap_days[1] = 2 it is due, whatever gap_days[0] says');
select is(pg_temp.bl(p_hist => '[' || pg_temp.o('2026-10-05T06:30:00Z') || ',' || pg_temp.o('2026-10-01T06:30:00Z') || ']', p_gaps => '[9, 2]'), null, 'L25 the LAST outbound touch is the latest by time, whatever the list order');
select is(pg_temp.bl(p_min => 120), null, 'L26 a minimum gap of 120 hours after a touch 120 hours ago: due (boundary)');
select is(pg_temp.bl(p_min => 121), 'not_yet', 'L27 121 hours: not yet');
select is(pg_temp.bl(p_hist => '[' || pg_temp.o('2026-10-05T06:30:00Z') || ']', p_gaps => '[1, 1]', p_min => 48), null, 'L28 the minimum gap is satisfied exactly at 48 hours');
select is(pg_temp.bl(p_hist => '[' || pg_temp.o('2026-10-05T06:30:01Z') || ']', p_gaps => '[1, 1]', p_min => 48), 'not_yet', 'L29 one second short of the minimum gap');
-- the calendar: weekday (Monday = 0), holidays (the recipient''s LOCAL date), quiet hours ([start, end), wrapping)
select is(pg_temp.bl(p_asof => '2026-10-10T06:30:00Z'), 'not_yet', 'L30 a Saturday (local) with Monday to Friday allowed: not yet');
select is(pg_temp.bl(p_asof => '2026-10-10T06:30:00Z', p_wd => '[0, 1, 2, 3, 4, 5]'), null, 'L31 ... and due when Saturday (5) is allowed');
select is(pg_temp.bl(p_asof => '2026-10-11T06:30:00Z', p_wd => '[0, 1, 2, 3, 4, 5]'), 'not_yet', 'L32 a Sunday (6) is not allowed');
select is(pg_temp.bl(p_asof => '2026-10-05T06:30:00Z', p_hist => '[' || pg_temp.o('2026-09-25T06:30:00Z') || ']', p_wd => '[0]'), null, 'L33 Monday is weekday 0');
select is(pg_temp.bl(p_hol => '["2026-10-07"]'), 'not_yet', 'L34 a holiday (the local date): not yet');
select is(pg_temp.bl(p_hol => '["2026-10-06", "2026-10-08"]'), null, 'L35 the days around it are fine');
select is(pg_temp.bl(p_asof => '2026-10-07T20:00:00Z', p_hol => '["2026-10-08"]', p_wd => '[0, 1, 2, 3, 4, 5, 6]', p_qs => '02:00', p_qe => '03:00'), 'not_yet', 'L36 a holiday is judged on the RECIPIENT''S date: 20:00Z on the 7th is 01:30 on the 8th locally');
select is(pg_temp.bl(p_asof => '2026-10-07T20:00:00Z', p_hol => '["2026-10-07"]', p_wd => '[0, 1, 2, 3, 4, 5, 6]', p_qs => '02:00', p_qe => '03:00'), null, 'L37 ... and the 7th is no holiday for them any more');
select is(pg_temp.bl(p_asof => '2026-10-07T03:29:00Z'), 'not_yet', 'L38 08:59 local with quiet hours 21:00-09:00 (wrapping): quiet');
select is(pg_temp.bl(p_asof => '2026-10-07T03:30:00Z'), null, 'L39 09:00 local: the end is ALLOWED');
select is(pg_temp.bl(p_asof => '2026-10-07T15:29:00Z'), null, 'L40 20:59 local: allowed');
select is(pg_temp.bl(p_asof => '2026-10-07T15:30:00Z'), 'not_yet', 'L41 21:00 local: the start is QUIET');
select is(pg_temp.bl(p_asof => '2026-10-07T18:30:00Z', p_wd => '[0, 1, 2, 3, 4, 5, 6]'), 'not_yet', 'L42 midnight local: quiet (the window crosses midnight)');
select is(pg_temp.bl(p_qs => '12:00', p_qe => '13:00'), 'not_yet', 'L43 a non-wrapping window 12:00-13:00: 12:00 local is quiet');
select is(pg_temp.bl(p_qs => '11:00', p_qe => '12:00'), null, 'L44 ... 12:00 is the END of 11:00-12:00: allowed');
select is(pg_temp.bl(p_qs => '12:01', p_qe => '13:00'), null, 'L45 ... and 11:59... the window 12:01-13:00 does not cover 12:00');
select is(pg_temp.bl(p_asof => '2026-10-07T06:30:59Z', p_hist => '[' || pg_temp.o('2026-10-02T06:30:00Z') || ']', p_qs => '12:00', p_qe => '13:00'), 'not_yet', 'L46 seconds do not move a time out of a quiet minute');
select is(pg_temp.bl(p_off => -300, p_asof => '2026-10-07T17:00:00Z'), null, 'L47 a negative offset (-05:00): 17:00Z is 12:00 local, due');
select is(pg_temp.bl(p_off => -300, p_asof => '2026-10-07T17:00:00Z', p_qs => '12:00', p_qe => '13:00'), 'not_yet', 'L48 ... and quiet in a window at 12:00 local');
select is(pg_temp.bl(p_off => 0, p_asof => '2026-10-07T12:00:00Z', p_qs => '12:00', p_qe => '13:00'), 'not_yet', 'L49 offset 0');
select is(pg_temp.bl(p_off => 840, p_asof => '2026-10-07T07:00:00Z'), 'not_yet', 'L50 offset +14:00: 07:00Z is 21:00 local (a Wednesday): the start of the quiet window');
select is(pg_temp.bl(p_off => 840, p_asof => '2026-10-07T06:59:00Z'), null, 'L51 ... and 06:59Z is 20:59 local: allowed');

-- ============================================================================ D2. the policy in force decides: the same lead, refused under a restrictive version and accepted under a benign one
select pg_temp.mkdue('pq1');  select pg_temp.mkdue('pq2');  select pg_temp.mkdue('pq3');  select pg_temp.mkdue('pq4');  select pg_temp.mkdue('pq5');
create function pg_temp.local_wd() returns int language sql as $$ select extract(isodow from (now() at time zone 'UTC') + pg_temp.noon_offset() * interval '1 minute')::int - 1 $$;
create function pg_temp.local_date() returns text language sql as $$ select to_char((now() at time zone 'UTC') + pg_temp.noon_offset() * interval '1 minute', 'YYYY-MM-DD') $$;
select is(pg_temp.mkpol('r1', pg_temp.pol(p_qs => '00:00', p_qe => '23:59')), 'ok', 'D82 (a version whose quiet hours cover the whole local day but its last minute)');
select is(pg_temp.mk('a_sales', 'pq1', 'pq1'), 'SM225:not_yet', 'D83 quiet hours: the lead is not due');
select is(pg_temp.mkpol('r2', pg_temp.pol(p_wd => (select jsonb_agg(d)::text from generate_series(0, 6) d where d <> pg_temp.local_wd()))), 'ok', 'D84 (a version that leaves out today''s local weekday)');
select is(pg_temp.mk('a_sales', 'pq2', 'pq2'), 'SM225:not_yet', 'D85 an excluded weekday: not due');
select is(pg_temp.mkpol('r3', pg_temp.pol(p_hol => jsonb_build_array(pg_temp.local_date())::text)), 'ok', 'D86 (a version with today''s local date as a holiday)');
select is(pg_temp.mk('a_sales', 'pq3', 'pq3'), 'SM225:not_yet', 'D87 a holiday: not due');
select is(pg_temp.mkpol('r4', pg_temp.pol(p_gaps => '[10, 10]')), 'ok', 'D88 (a version with a ten-day gap)');
select is(pg_temp.mk('a_sales', 'pq4', 'pq4'), 'SM225:not_yet', 'D89 a gap of ten days after a touch five days ago: not due');
select is(pg_temp.mkpol('r5', pg_temp.pol(p_min => 144)), 'ok', 'D90 (a version with a minimum gap of 144 hours)');
select is(pg_temp.mk('a_sales', 'pq5', 'pq5'), 'SM225:not_yet', 'D91 a minimum gap of six days after a touch five days ago: not due');
select is(pg_temp.mkpol('r6', pg_temp.pol()), 'ok', 'D92 (the benign version again: the latest of the day wins)');
select is(pg_temp.mk('a_sales', 'pq1', 'pq1') || pg_temp.mk('a_sales', 'pq2', 'pq2') || pg_temp.mk('a_sales', 'pq3', 'pq3') || pg_temp.mk('a_sales', 'pq4', 'pq4') || pg_temp.mk('a_sales', 'pq5', 'pq5'), 'okokokokok',
          'D93 the same five leads are all due under the benign version');
select is(pg_temp.mkpol('r7', pg_temp.pol(p_max => 4, p_gaps => '[1, 1, 1]')), 'ok', 'D94 (a version with four touches: touch 3 is a middle one)');
select pg_temp.mkdue('rm', 2);
select is(pg_temp.mk('a_sales', 'rm', 'rm'), 'ok', 'D95 a lead with two outbound touches under a limit of four');
select is((select template_code || '/' || touch_number from public.followup_drafts where id = pg_temp.did('rm')), 'followup_reminder/3', 'D95b touch 3 of 4 uses the REMINDER wording');
select is(pg_temp.mkpol('r8', pg_temp.pol()), 'ok', 'D96 (the benign version again)');
-- the blocker fails CLOSED: a request the rules cannot read is 'invalid', never due (and never an error)
select is(app.followup_blocker('{}'::jsonb), 'invalid', 'L52 an empty request is invalid, not due');
select is(app.followup_blocker(null), 'invalid', 'L53 a null request is invalid');
select is(pg_temp.bl(p_asof => 'garbage'), 'invalid', 'L54 an as_of that is not a time is invalid');
select is(pg_temp.bl(p_flags => '{"won": null}'), 'invalid', 'L55 a flag that is null is invalid (a NULL comparison must never read as "not closed")');
select is(pg_temp.bl(p_gaps => '[]'), 'invalid', 'L56 a gap list too short for the touch number is invalid');
select is(pg_temp.bl(p_hist => '{}'), 'invalid', 'L57 a history that is not a list is invalid');
select is(pg_temp.bl(p_wd => '"x"'), 'invalid', 'L58 weekdays that are not a list are invalid');
select is(app.followup_blocker(jsonb_set(jsonb_set(pg_temp.req('l1'), '{policy,quiet_hours}', '{}'), '{as_of}', to_jsonb(pg_temp.asof()))), 'invalid', 'L59 quiet hours without their ends are invalid');
select is(app.followup_blocker(jsonb_set(pg_temp.req('l1'), '{recipient_utc_offset_minutes}', '"x"')), 'invalid', 'L60 an offset that is not a number is invalid');

-- ============================================================================ M. invariants over every draft and touch this file made
select is((select count(*) from public.followup_drafts d where not exists (select 1 from public.leads l where l.tenant_id = d.tenant_id and l.id = d.lead_id)
              or not exists (select 1 from public.contacts c where c.tenant_id = d.tenant_id and c.id = d.contact_id)), 0::bigint, 'M1 every draft''s lead and contact are in its own tenant');
select is((select count(*) from (select tenant_id, lead_id, touch_number from public.followup_drafts where status in ('draft', 'approved') group by 1, 2, 3 having count(*) > 1) x), 0::bigint, 'M2 no (tenant, lead, touch number) has two active drafts');
select is((select count(*) from public.followup_drafts d where d.status = 'recorded_sent' and not exists (select 1 from public.lead_touches t where t.draft_id = d.id and t.direction = 'out')), 0::bigint, 'M3 every recorded draft has its outbound touch');
select is((select count(*) from public.lead_touches t where t.draft_id is not null and not exists (select 1 from public.followup_drafts d where d.id = t.draft_id and d.status = 'recorded_sent')), 0::bigint, 'M4 every touch that names a draft belongs to a recorded one');
select is((select count(*) from public.followup_drafts d where d.status in ('approved', 'recorded_sent') and (d.approved_at is null or d.approved_by is null)), 0::bigint, 'M5 an approved or recorded draft names its approver and time');
select is((select count(*) from public.followup_drafts d where d.status = 'discarded' and d.discard_code is null), 0::bigint, 'M6 a discarded draft always says why');
select is((select count(*) from public.followup_drafts d where d.status in ('draft', 'approved') and exists (select 1 from public.contacts c where c.id = d.contact_id and (c.suppressed_at is not null or c.erased_at is not null))), 0::bigint,
          'M7 no OPEN draft belongs to a suppressed or erased contact (the trigger discards them; a contact flagged by a key match is suppressed through the same path)');
select is((select count(*) from public.lead_touches t where t.direction = 'out' and t.contact_id is null), 0::bigint, 'M8 every outbound touch names its contact');
select is((select count(*) from public.followup_drafts d where d.canonical_hash <> app.followup_request_hash(d.engine_version, d.request_text)), 0::bigint, 'M9 every draft''s hash is the hash of its stored request text (nothing stored was edited)');
select is((select count(*) from public.followup_drafts d where d.body <> (select t.body from public.followup_templates t where t.code = d.template_code)), 0::bigint, 'M10 every body is its template''s text');
select is((select count(*) from public.followup_drafts d where (d.request_text::jsonb ->> 'as_of')::timestamptz <> d.as_of), 0::bigint, 'M11 as_of is the request''s as_of');

select * from finish();
