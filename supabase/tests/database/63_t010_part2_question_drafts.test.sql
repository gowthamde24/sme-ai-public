-- T010 part 2 (docs/plans/t010-integration.md decision 10, migration 20261024090100): persisted QUESTION DRAFTS. The API derives the clarifying questions of a requirement from closed templates
-- and stores them for a person to approve and copy. NOTHING IS SENT.
--   A catalog   B persist_question_drafts (role x aal, every shape, text hygiene and contact data, the sync rules, replay, atomicity)   C decide_question_draft (role x aal, the state machine, replay)
--   D direct writes and the guard triggers   E audit and invariants
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();
select tests.as_aal('aal2');

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
-- a fixture step that must work (returns nothing: a bare "ok" line would read as a TAP test)
create function pg_temp.run(p_user text, p_sql text) returns void language plpgsql as $$
declare r text;
begin
  r := pg_temp.try(p_user, p_sql);
  if r <> 'ok' then raise exception 'fixture step failed (%): %', r, left(p_sql, 200); end if;
end $$;
create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.error_full_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql); end $$;
create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;
create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.cells(p_sql text, p_expect text) returns text language plpgsql as $$
declare
  c text[];
  r text;
  bad text := '';
begin
  foreach c slice 1 in array array[['a_owner', 'aal1'], ['a_owner', 'aal2'], ['a_admin', 'aal1'], ['a_admin', 'aal2'], ['a_sales', 'aal1'], ['a_sales', 'aal2'], ['a_viewer', 'aal1'], ['a_viewer', 'aal2'],
                                    ['b_owner', 'aal2'], ['outsider', 'aal2'], ['anon', 'aal2']] loop
    r := pg_temp.at(c[2], c[1], p_sql);
    if (select coalesce((regexp_match(p_expect, '(^|,)' || c[1] || '@' || c[2] || '=([^,]*)'))[2], '42501')) is distinct from r then
      bad := bad || c[1] || '@' || c[2] || '=' || r || ' ';
    end if;
  end loop;
  return nullif(bad, '');
end $$;
-- one item of a persist call
create function pg_temp.it(p_id text, p_code text, p_line text, p_text text) returns jsonb language sql as $$
  select jsonb_build_object('id', tests.rid(p_id), 'code', p_code, 'line', case when p_line is null then null else p_line::int end, 'text', p_text) $$;
create function pg_temp.persist(p_user text, p_req text, p_items jsonb) returns text language sql as $$
  select pg_temp.try(p_user, format('select public.persist_question_drafts(%L, %L::jsonb)', tests.rid(p_req), p_items)) $$;
create function pg_temp.qd(p_id text) returns text language sql as $$ select status::text || coalesce('/' || discard_code::text, '') from public.question_drafts where id = tests.rid(p_id) $$;
create function pg_temp.nact(p_req text) returns bigint language sql as $$ select count(*) from public.question_drafts where requirement_id = tests.rid(p_req) and status in ('draft', 'approved') $$;
-- extra requirements (each with its own enquiry) in tenant a, and the states they can be in
insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body)
select tests.rid('e_' || n), tests.tid('a'), tests.rid('a_lead'), 'email', now() - interval '1 hour', 'Fixture enquiry ' || n from unnest(array['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) n;
insert into public.requirements (id, tenant_id, enquiry_id) select tests.rid(n), tests.tid('a'), tests.rid('e_' || n) from unnest(array['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) n;
update public.requirements set status = 'confirmed', confirmed_at = now(), confirmed_by = tests.uid('a_owner') where id = tests.rid('r2');
update public.requirements set status = 'discarded' where id = tests.rid('r3');
update public.requirements set status = 'superseded' where id = tests.rid('r4');

-- ============================================================================ A. catalog
select is((select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname like 'question\_drafts\_%'), 2::bigint, 'A1 the two guard functions exist');
select is((select count(*) from pg_trigger t where t.tgrelid = 'public.question_drafts'::regclass and not t.tgisinternal and t.tgenabled = 'O'), 8::bigint, 'A2 eight enabled triggers on question_drafts (tenant, created meta, updated at, two guards, delete, truncate, audit)');
select is((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = 'public.question_draft_status'::regtype), 'draft,approved,discarded', 'A3 the states');
select is((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = 'public.question_discard_code'::regtype), 'person,resolved,superseded', 'A4 the discard reasons');
select is((select indexdef from pg_indexes where indexname = 'question_drafts_one_active_key') ~ 'UNIQUE.*\(tenant_id, requirement_id, question_code, line_no\).*WHERE', true, 'A5 one ACTIVE question per (tenant, requirement, code, line)');

-- ============================================================================ B. persist_question_drafts
select is(pg_temp.cells(format('select public.persist_question_drafts(%L, %L::jsonb)', tests.rid('r1'), jsonb_build_array(pg_temp.it('x1', 'missing_quantity', null, 'How many pieces do you need?'))),
                        'a_owner@aal1=ok,a_owner@aal2=ok,a_admin@aal1=ok,a_admin@aal2=ok,a_sales@aal1=ok,a_sales@aal2=ok'), null,
          'B1 the matrix: Owner / Admin / Sales persist at aal1 and aal2 (no second factor: it is a draft); a Viewer, another tenant, an outsider and anon get 42501');
select is(pg_temp.nact('r1'), 1::bigint, 'B2 one question (the retries changed nothing)');
select is((select line_no || '/' || question_code || '/' || status::text || '/' || (created_by = tests.uid('a_owner')) from public.question_drafts where id = tests.rid('x1')), '0/missing_quantity/draft/true', 'B3 a null line is stored as 0 (the whole enquiry); the first caller created it');
select is(pg_temp.err('a_viewer', format('select public.persist_question_drafts(%L, ''[]'')', tests.rid('r1'))), pg_temp.err('a_viewer', format('select public.persist_question_drafts(%L, ''[]'')', gen_random_uuid())), 'B4 a refusal for a role and for an unknown requirement are the SAME answer');
select is(pg_temp.try('a_sales', 'select public.persist_question_drafts(null, ''[]'')'), '42501', 'B5 a null requirement is the generic refusal');
select is(pg_temp.try('a_sales', format('select public.persist_question_drafts(%L, null)', tests.rid('r1'))), '22023', 'B6 a null set is invalid');
select is(pg_temp.try('a_sales', format('select public.persist_question_drafts(%L, ''{}'')', tests.rid('r1'))), '22023', 'B7 a set that is not an array is invalid');
select is(pg_temp.try('a_sales', format('select public.persist_question_drafts(%L, %L::jsonb)', tests.rid('r1'), (select jsonb_agg(pg_temp.it('y' || n, 'confirm_colour', n::text, 'Could you confirm the colour?')) from generate_series(1, 41) n))), '22023', 'B8 more than 40 items is invalid');
-- shapes (22023) and values (23514), one at a time; none of them writes anything
create function pg_temp.bad(p_item jsonb) returns text language sql as $$ select pg_temp.persist('a_sales', 'r5', jsonb_build_array(p_item)) $$;
select is(pg_temp.bad('{"id": "00000000-0000-0000-0000-000000000001", "code": "missing_quantity", "line": null}'::jsonb), '22023', 'B9 a missing key is invalid');
select is(pg_temp.bad('{"id": "00000000-0000-0000-0000-000000000001", "code": "missing_quantity", "line": null, "text": "How many pieces do you need?", "x": 1}'::jsonb), '22023', 'B10 an extra key is invalid');
select is(pg_temp.bad('{"id": "not-a-uuid", "code": "missing_quantity", "line": null, "text": "How many pieces do you need?"}'::jsonb), '22023', 'B11 an id that is not a UUID is invalid');
select is(pg_temp.bad('{"id": "00000000-0000-0000-0000-000000000001", "code": 5, "line": null, "text": "How many pieces do you need?"}'::jsonb), '22023', 'B12 a code that is not a string is invalid');
select is(pg_temp.bad('{"id": "00000000-0000-0000-0000-000000000001", "code": "missing_quantity", "line": "1", "text": "How many pieces do you need?"}'::jsonb), '22023', 'B13 a line that is a string is invalid');
select is(pg_temp.bad('{"id": "00000000-0000-0000-0000-000000000001", "code": "missing_quantity", "line": 6, "text": "How many pieces do you need?"}'::jsonb), '22023', 'B14 line 6 is invalid (0..5)');
select is(pg_temp.bad('{"id": "00000000-0000-0000-0000-000000000001", "code": "missing_quantity", "line": 1.5, "text": "How many pieces do you need?"}'::jsonb), '22023', 'B15 a fractional line is invalid');
select is(pg_temp.bad('{"id": "00000000-0000-0000-0000-000000000001", "code": "ask_anything", "line": null, "text": "How many pieces do you need?"}'::jsonb), '23514', 'B16 a code outside the closed list is refused');
select is(pg_temp.bad('{"id": "00000000-0000-0000-0000-000000000001", "code": "missing_price", "line": null, "text": "How many pieces do you need?"}'::jsonb), '23514', 'B17 ... a field that is not one of the eight');
select is(pg_temp.bad('{"id": "00000000-0000-0000-0000-000000000001", "code": "missing_quantity", "line": null, "text": "Short"}'::jsonb), '23514', 'B18 a text under 8 characters is refused');
select is(pg_temp.bad(jsonb_build_object('id', gen_random_uuid(), 'code', 'missing_quantity', 'line', null, 'text', repeat('x', 301))), '23514', 'B19 a text over 300 characters is refused');
select is(pg_temp.bad(jsonb_build_object('id', gen_random_uuid(), 'code', 'missing_quantity', 'line', null, 'text', repeat('x', 300))), 'ok', 'B20 exactly 300 is allowed');
select is(pg_temp.bad(jsonb_build_object('id', gen_random_uuid(), 'code', 'missing_budget', 'line', null, 'text', 'Please write to buyer@example.test about the budget')), '23514', 'B21 a text with an e-mail address is refused (no contact data in a question)');
select is(pg_temp.bad(jsonb_build_object('id', gen_random_uuid(), 'code', 'missing_budget', 'line', null, 'text', 'Please call 98765 43210 about the budget')), '23514', 'B22 ... or an Indian mobile number');
select is(pg_temp.bad(jsonb_build_object('id', gen_random_uuid(), 'code', 'missing_budget', 'line', null, 'text', E'What is the bud​get for this order?')), '23514', 'B23 a hidden character is refused (text hygiene)');
select is(pg_temp.persist('a_sales', 'r5', jsonb_build_array(pg_temp.it('d1', 'missing_budget', null, 'What is your budget?'), pg_temp.it('d2', 'missing_budget', null, 'What is your budget please?'))), '22023', 'B24 two items with the same code and line are invalid');
select is(pg_temp.nact('r5'), 1::bigint, 'B25 (only the 300-character item of B20 exists: every other call above wrote nothing)');
select is(pg_temp.persist('a_sales', 'r6', jsonb_build_array(pg_temp.it('a1', 'missing_quantity', null, 'How many pieces do you need?'), pg_temp.it('a2', 'missing_budget', null, E'bad​text here'))), '23514', 'B26 a set with one bad item writes NOTHING (all or nothing)');
select is(pg_temp.nact('r6'), 0::bigint, 'B27 ... not even the good item');
-- states of the requirement
select is(pg_temp.persist('a_sales', 'r2', jsonb_build_array(pg_temp.it('c1', 'missing_quantity', null, 'How many pieces do you need?'))), 'ok', 'B28 a CONFIRMED requirement can still have questions');
select is(pg_temp.persist('a_sales', 'r3', jsonb_build_array(pg_temp.it('c2', 'missing_quantity', null, 'How many pieces do you need?'))), 'SM223:closed', 'B29 a DISCARDED requirement cannot (SM223, closed)');
select is(pg_temp.persist('a_sales', 'r4', jsonb_build_array(pg_temp.it('c3', 'missing_quantity', null, 'How many pieces do you need?'))), 'SM223:closed', 'B30 a SUPERSEDED one cannot');
select is(pg_temp.try('b_sales', format('select public.persist_question_drafts(%L, ''[]'')', tests.rid('r2'))), '42501', 'B31 another tenant''s requirement is the generic refusal');
-- the sync rules
create function pg_temp.set1() returns jsonb language sql as $$ select jsonb_build_array(pg_temp.it('s1', 'missing_quantity', null, 'How many pieces do you need?'), pg_temp.it('s2', 'missing_deadline', null, 'By what date do you need the order delivered?')) $$;
select is(pg_temp.persist('a_sales', 'a_requirement', pg_temp.set1()), 'ok', 'B32 a first set of two questions is stored');
select is(pg_temp.nact('a_requirement'), 2::bigint, 'B33 two active questions');
select is(pg_temp.j(pg_temp.sc('a_sales', format('select public.persist_question_drafts(%L, %L::jsonb)', tests.rid('a_requirement'), pg_temp.set1())), 'changed'), '0', 'B34 the same set again changes nothing');
select is(pg_temp.j(pg_temp.sc('a_admin', format('select public.persist_question_drafts(%L, %L::jsonb)', tests.rid('a_requirement'),
          jsonb_build_array(pg_temp.it('n1', 'missing_quantity', null, 'How many pieces do you need?'), pg_temp.it('n2', 'missing_deadline', null, 'By what date do you need the order delivered?')))), 'changed'), '0',
          'B35 ... even with new ids: a question that is already there is kept (the retry is idempotent)');
select is((select count(*) from public.question_drafts where id in (tests.rid('n1'), tests.rid('n2'))), 0::bigint, 'B36 (and the new ids were not stored)');
select pg_temp.run('a_owner', format('select public.decide_question_draft(%L, ''approve'')', tests.rid('s1')));
select is(pg_temp.qd('s1'), 'approved', 'B37 (the first question is approved)');
select is(pg_temp.j(pg_temp.sc('a_sales', format('select public.persist_question_drafts(%L, %L::jsonb)', tests.rid('a_requirement'),
          jsonb_build_array(pg_temp.it('t1', 'missing_quantity', null, 'How many pieces of Kanjivaram do you need?'), pg_temp.it('s2', 'missing_deadline', null, 'By what date do you need the order delivered?')))), 'changed'), '2',
          'B38 a CHANGED text supersedes the old question and stores a new draft (two changes)');
select is(pg_temp.qd('s1') || ' ' || pg_temp.qd('t1') || ' ' || pg_temp.qd('s2'), 'discarded/superseded draft draft', 'B39 the approved question is superseded (its approval does not carry over to new text); the new one is a draft; the untouched one is untouched');
select is(pg_temp.j(pg_temp.sc('a_sales', format('select public.persist_question_drafts(%L, %L::jsonb)', tests.rid('a_requirement'), jsonb_build_array(pg_temp.it('t1', 'missing_quantity', null, 'How many pieces of Kanjivaram do you need?')))), 'changed'), '1',
          'B40 a question that is no longer derived is resolved (one change)');
select is(pg_temp.qd('s2'), 'discarded/resolved', 'B41 ... with the reason resolved');
select is(pg_temp.nact('a_requirement'), 1::bigint, 'B42 one active question left');
select is(pg_temp.persist('a_sales', 'a_requirement', jsonb_build_array(pg_temp.it('t1', 'missing_quantity', null, 'How many pieces of Kanjivaram do you need?'), pg_temp.it('s2', 'missing_deadline', null, 'By what date do you need the order delivered?'))), '23505',
          'B43 a question that comes BACK under an id that was used before is the constant conflict (the caller mints a fresh id)');
select is(pg_temp.persist('a_sales', 'a_requirement', jsonb_build_array(pg_temp.it('t1', 'missing_quantity', null, 'How many pieces of Kanjivaram do you need?'), pg_temp.it('s2b', 'missing_deadline', null, 'By what date do you need the order delivered?'))), 'ok',
          'B44 ... and works with a fresh one');
select is(pg_temp.persist('a_sales', 'a_requirement', jsonb_build_array(pg_temp.it('q9', 'missing_quantity', '1', 'How many pieces do you need for item 1?'), pg_temp.it('q9b', 'missing_quantity', '2', 'How many pieces do you need for item 2?'))), 'ok',
          'B45 the same code on two lines is two questions');
select is((select count(*) from public.question_drafts where requirement_id = tests.rid('a_requirement') and status in ('draft', 'approved') and question_code = 'missing_quantity'), 2::bigint, 'B46 (and the line-less ones are resolved: only the two line questions stay)');
select is(pg_temp.persist('a_sales', 'a_requirement', '[]'::jsonb), 'ok', 'B47 an empty set resolves every question');
select is(pg_temp.nact('a_requirement'), 0::bigint, 'B48 none active');
select is(pg_temp.persist('b_sales', 'b_requirement', jsonb_build_array(pg_temp.it('bq1', 'missing_quantity', null, 'How many pieces do you need?'))), 'ok', 'B49 another tenant persists for its own requirement');
select is((select count(*) from public.question_drafts where tenant_id = tests.tid('b')), 1::bigint, 'B50 and tenant b has its own row');

-- ============================================================================ C. decide_question_draft
select pg_temp.run('a_sales', format('select public.persist_question_drafts(%L, %L::jsonb)', tests.rid('r1'), jsonb_build_array(pg_temp.it('x1', 'missing_quantity', null, 'How many pieces do you need?'))));
select is(pg_temp.qd('x1'), 'draft', 'C0 (the question the matrix decides)');
select is(pg_temp.cells(format('select public.decide_question_draft(%L, ''approve'')', tests.rid('x1')), 'a_owner@aal1=ok,a_owner@aal2=ok,a_admin@aal1=ok,a_admin@aal2=ok,a_sales@aal1=ok,a_sales@aal2=ok'), null,
          'C1 the matrix: Owner / Admin / Sales approve at either level (the first writes, the rest replay); a Viewer, another tenant, an outsider and anon get 42501');
select is((select status::text || '/' || (decided_by = tests.uid('a_owner')) || '/' || (decided_at is not null) from public.question_drafts where id = tests.rid('x1')), 'approved/true/true', 'C2 approved by the first caller');
select is(pg_temp.err('a_viewer', format('select public.decide_question_draft(%L, ''approve'')', tests.rid('x1'))), pg_temp.err('a_viewer', format('select public.decide_question_draft(%L, ''approve'')', gen_random_uuid())), 'C3 a refusal for a role and for an unknown question are the SAME answer');
select is(pg_temp.try('a_owner', 'select public.decide_question_draft(null, ''approve'')'), '42501', 'C4 a null id is the generic refusal');
select is(pg_temp.try('a_owner', format('select public.decide_question_draft(%L, ''reject'')', tests.rid('x1'))), '22023', 'C5 a decision other than approve / discard is invalid');
select is(pg_temp.try('a_owner', format('select public.decide_question_draft(%L, null)', tests.rid('x1'))), '22023', 'C6 a null decision is invalid');
select is(pg_temp.j(pg_temp.sc('a_sales', format('select public.decide_question_draft(%L, ''approve'')', tests.rid('x1'))), 'replayed'), 'true', 'C7 approving an approved question replays');
select is(pg_temp.try('a_sales', format('select public.decide_question_draft(%L, ''discard'')', tests.rid('x1'))), 'ok', 'C8 an approved question can be discarded');
select is(pg_temp.qd('x1'), 'discarded/person', 'C9 by a person');
select is(pg_temp.j(pg_temp.sc('a_sales', format('select public.decide_question_draft(%L, ''discard'')', tests.rid('x1'))), 'replayed'), 'true', 'C10 discarding again replays');
select is(pg_temp.try('a_sales', format('select public.decide_question_draft(%L, ''approve'')', tests.rid('x1'))), 'SM223:closed', 'C11 a discarded question cannot be approved (SM223)');
select is(pg_temp.persist('a_sales', 'r1', jsonb_build_array(pg_temp.it('x1b', 'missing_quantity', null, 'How many pieces do you need?'))), 'ok', 'C12 the same question can be derived and stored again after a discard');
select is(pg_temp.qd('x1b'), 'draft', 'C13 as a fresh draft');
select is(pg_temp.try('b_owner', format('select public.decide_question_draft(%L, ''approve'')', tests.rid('x1b'))), '42501', 'C14 another tenant''s Owner cannot decide it');

-- ============================================================================ D. direct writes and the guard triggers
select is(tests.sqlstate_as(tests.uid('a_owner'), format($q$insert into public.question_drafts (id, tenant_id, requirement_id, question_code, question_text) values (gen_random_uuid(), %L, %L, 'missing_colour', 'Which colour would you like?')$q$, tests.tid('a'), tests.rid('r1'))), '42501', 'D1 an Owner cannot INSERT a question draft');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($q$update public.question_drafts set status = 'approved' where id = %L$q$, tests.rid('x1b'))), '42501', 'D2 ... approve one by UPDATE');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($q$delete from public.question_drafts where id = %L$q$, tests.rid('x1b'))), '42501', 'D3 ... delete one');
select is(tests.sqlstate_as(null, 'select count(*) from public.question_drafts'), '42501', 'D4 anon cannot read');
select is(tests.rows_as(tests.uid('a_viewer'), 'select * from public.question_drafts'), 0::bigint, 'D5 a Viewer reads none');
select cmp_ok(tests.rows_as(tests.uid('a_sales'), 'select * from public.question_drafts'), '>', 0::bigint, 'D6 Sales reads them');
select is(tests.rows_as(tests.uid('b_sales'), format('select * from public.question_drafts where tenant_id = %L', tests.tid('a'))), 0::bigint, 'D7 another tenant reads none of tenant a''s');
select is(pg_temp.priv(format($q$update public.question_drafts set question_text = 'Another synthetic question text?' where id = %L$q$, tests.rid('x1b'))), '42501', 'D8 a question''s text is immutable even for the table owner');
select is(pg_temp.priv(format($q$update public.question_drafts set question_code = 'missing_colour' where id = %L$q$, tests.rid('x1b'))), '42501', 'D9 ... and its code');
select is(pg_temp.priv(format($q$update public.question_drafts set status = 'draft', decided_at = null, discard_code = null where id = %L$q$, tests.rid('x1'))), '42501', 'D10 a discarded question stays discarded');
select is(pg_temp.priv(format($q$update public.question_drafts set status = 'approved', discard_code = null, decided_at = now() where id = %L$q$, tests.rid('x1'))), '42501', 'D11 ... whatever it is moved to');
select is(pg_temp.priv(format($q$insert into public.question_drafts (id, tenant_id, requirement_id, question_code, question_text, status, decided_at) values (gen_random_uuid(), %L, %L, 'missing_colour', 'Which colour would you like?', 'approved', now())$q$, tests.tid('a'), tests.rid('r1'))), '42501', 'D12 a question cannot be INSERTED already approved');
select is(pg_temp.priv(format($q$delete from public.question_drafts where id = %L$q$, tests.rid('x1b'))), '42501', 'D13 never deleted');
select is(pg_temp.priv('truncate public.question_drafts cascade'), '42501', 'D14 never truncated');
select is(pg_temp.priv(format($q$insert into public.question_drafts (id, tenant_id, requirement_id, question_code, question_text) values (gen_random_uuid(), %L, %L, 'missing_quantity', 'How many pieces do you need now?')$q$, tests.tid('a'), tests.rid('r1'))), '23505', 'D15 the unique index refuses a second ACTIVE question for the same requirement, code and line');
select is(pg_temp.priv(format($q$insert into public.question_drafts (id, tenant_id, requirement_id, question_code, question_text) values (gen_random_uuid(), %L, %L, 'missing_colour', 'Which colour would you like?')$q$, tests.tid('b'), tests.rid('r1'))), '23503', 'D16 a question cannot name another tenant''s requirement (composite key)');
select is(pg_temp.priv(format($q$insert into public.question_drafts (id, tenant_id, requirement_id, question_code, question_text) values (gen_random_uuid(), %L, %L, 'missing_colour', 'Please email buyer@example.test about colour')$q$, tests.tid('a'), tests.rid('r1'))), '23514', 'D17 the database refuses contact data in a question even from a privileged writer');
select is(pg_temp.priv(format($q$insert into public.question_drafts (id, tenant_id, requirement_id, question_code, question_text) values (gen_random_uuid(), %L, %L, 'bogus_code', 'Which colour would you like?')$q$, tests.tid('a'), tests.rid('r1'))), '23514', 'D18 ... or a code outside the closed list');
select is(pg_temp.priv(format($q$insert into public.question_drafts (id, tenant_id, requirement_id, question_code, question_text, line_no) values (gen_random_uuid(), %L, %L, 'missing_colour', 'Which colour would you like?', 6)$q$, tests.tid('a'), tests.rid('r1'))), '23514', 'D19 ... or a line beyond 5');
select is(pg_temp.priv(format($q$update public.question_drafts set tenant_id = %L where id = %L$q$, tests.tid('b'), tests.rid('x1b'))), '42501', 'D20 a question cannot move to another tenant');

-- ============================================================================ E. audit and invariants
select cmp_ok((select count(*) from public.audit_events where entity_type = 'question_draft' and action = 'question_draft.create'), '>=', 8::bigint, 'E1 every stored question is in the audit trail');
select cmp_ok((select count(*) from public.audit_events where entity_type = 'question_draft' and action = 'question_draft.update'), '>=', 5::bigint, 'E2 every approval, discard and sync change too');
select is((select count(*) from public.audit_events a where a.entity_type = 'question_draft' and a.action = 'question_draft.create' and a.actor_user_id is null), 0::bigint, 'E3 every creation names the actor');
select is((select count(*) from (select tenant_id, requirement_id, question_code, line_no from public.question_drafts where status in ('draft', 'approved') group by 1, 2, 3, 4 having count(*) > 1) x), 0::bigint, 'E4 never two active questions for one (requirement, code, line)');
select is((select count(*) from public.question_drafts d where d.status = 'discarded' and d.discard_code is null), 0::bigint, 'E5 a discarded question always says why');
select is((select count(*) from public.question_drafts d where d.status = 'draft' and d.decided_at is not null), 0::bigint, 'E6 a draft has no decision');
select is((select count(*) from public.question_drafts d where not exists (select 1 from public.requirements r where r.tenant_id = d.tenant_id and r.id = d.requirement_id)), 0::bigint, 'E7 every question''s requirement is in its own tenant');
select is((select count(*) from public.question_drafts d where d.question_text ~ '[@]' or app.text_has_contact(d.question_text) or not app.text_is_clean(d.question_text)), 0::bigint, 'E8 no question holds contact data or a hidden character');

-- ============================================================================ F. commit 5, the mutation pass (docs/checklist-notes/A.md, "T010 part 2")
-- the one CHECK constraint left standing (see 62, section O): every other CHECK of the table is dropped and its user triggers disabled inside a sub-transaction that is rolled back
create function pg_temp.only_check(p_table regclass, p_keep text, p_sql text) returns text language plpgsql as $$
declare
  c record;
  r text;
  v_con text;
begin
  begin
    for c in select conname from pg_constraint where conrelid = p_table and contype = 'c' and conname <> p_keep loop
      execute format('alter table %s drop constraint %I', p_table, c.conname);
    end loop;
    execute format('alter table %s disable trigger user', p_table);
    begin
      execute p_sql;
      r := 'ok';
    exception when others then
      get stacked diagnostics v_con = constraint_name;
      r := sqlstate || ':' || coalesce(v_con, '');
    end;
    raise exception 'sandbox' using detail = r;
  exception when raise_exception then
    get stacked diagnostics r = pg_exception_detail;
    return r;
  end;
end $$;
create function pg_temp.sandbox(p_sql text) returns text language plpgsql as $$
declare r text;
begin
  begin
    begin
      execute p_sql;
      r := 'ok';
    exception when others then
      r := sqlstate;
    end;
    raise exception 'sandbox' using detail = r;
  exception when raise_exception then
    get stacked diagnostics r = pg_exception_detail;
    return r;
  end;
end $$;
insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (tests.rid('e_r7'), tests.tid('a'), tests.rid('a_lead'), 'email', now() - interval '1 hour', 'Fixture enquiry r7');
insert into public.requirements (id, tenant_id, enquiry_id) values (tests.rid('r7'), tests.tid('a'), tests.rid('e_r7'));
create function pg_temp.qins(p_status text default 'draft', p_decided text default 'null', p_code text default 'null') returns text language sql as $$
  select format($q$insert into public.question_drafts (id, tenant_id, requirement_id, question_code, question_text, line_no, status, decided_at, discard_code)
                   values (gen_random_uuid(), %L, %L, 'confirm_budget', 'Is the budget still the same?', 5, %L::public.question_draft_status, %s, %s)$q$, tests.tid('a'), tests.rid('r7'), p_status, p_decided, p_code) $$;
select is(pg_temp.priv(pg_temp.qins('draft')), 'ok', 'F1 (fixture) a plain question row is accepted by the table');
select is(pg_temp.only_check('public.question_drafts', 'question_drafts_check', pg_temp.qins('draft', 'now()')), '23514:question_drafts_check', 'F2 a question still waiting cannot carry a decision time: refused by the table check by itself');
select is(pg_temp.only_check('public.question_drafts', 'question_drafts_check', pg_temp.qins('approved', 'null')), '23514:question_drafts_check', 'F3 ... and a decided question must carry one');
select is(pg_temp.only_check('public.question_drafts', 'question_drafts_check1', pg_temp.qins('draft', 'null', $$'person'$$)), '23514:question_drafts_check1', 'F4 a question that is not discarded cannot carry a discard reason: refused by the table check by itself');
select is(pg_temp.only_check('public.question_drafts', 'question_drafts_check1', pg_temp.qins('discarded', 'now()', 'null')), '23514:question_drafts_check1', 'F5 ... and a discarded one must carry one');

-- the cap on one persist call: 40 items are stored, 41 are an invalid argument
create function pg_temp.many(p_n int) returns jsonb language sql as $$
  select jsonb_agg(pg_temp.it('m' || i,
                              (array['missing', 'conflicting', 'confirm'])[(i - 1) % 3 + 1] || '_' || (array['saree_type', 'fabric', 'colour', 'quantity', 'budget', 'deadline', 'delivery_city', 'payment_terms'])[((i - 1) / 3) % 8 + 1],
                              case when i > 24 then '1' end, 'A synthetic question number ' || i || '?')) from generate_series(1, p_n) i $$;
select is(pg_temp.persist('a_sales', 'r6', pg_temp.many(41)), '22023', 'F6 41 items in one call are an invalid argument (nothing is stored)');
select is(pg_temp.nact('r6'), 0::bigint, 'F7 ... and nothing was');
select is(pg_temp.persist('a_sales', 'r6', pg_temp.many(40)), 'ok', 'F8 40 items in one call are stored (the cap itself is allowed)');
select is(pg_temp.nact('r6'), 40::bigint, 'F9 all forty');

-- the question guard trigger, branch by branch
select is(pg_temp.priv(format($q$update public.question_drafts set decided_at = decided_at + interval '1 day' where id = %L$q$, tests.rid('x1'))), '42501', 'F10 the decision time of a discarded question cannot change (it stays discarded)');
select is(pg_temp.try('a_sales', format('select public.decide_question_draft(%L, ''approve'')', tests.rid('m1'))), 'ok', 'F11 (fixture) a question is approved');
select is(pg_temp.priv(format($q$update public.question_drafts set status = 'draft', decided_at = null where id = %L$q$, tests.rid('m1'))), '42501', 'F12 an approved question cannot go back to waiting (the move guard: the table check is satisfied by decided_at = null)');
select is(pg_temp.sandbox(format($q$update public.question_drafts set decided_by = decided_by where id = %L$q$, tests.rid('x1'))), 'ok', 'F13 a write that changes nothing is not refused on a discarded question');
select is(pg_temp.sandbox(format($q$update public.question_drafts set decided_by = decided_by where id = %L$q$, tests.rid('m1'))), 'ok', 'F14 ... on an approved one');
select is(pg_temp.sandbox(format($q$update public.question_drafts set decided_by = decided_by where id = %L$q$, tests.rid('m2'))), 'ok', 'F15 ... on one waiting for a decision');

select * from finish();
