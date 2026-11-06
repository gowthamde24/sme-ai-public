-- "Correct it" (migration 20261231330000): a person corrects a finished call's summary and answers and adds a note; the rest of the call stays as it was; only the worker reads the notes.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');

create function pg_temp.q(p_user text, p_sql text) returns text language plpgsql as $$
begin
  return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

insert into public.phone_calls (id, tenant_id, direction, provider, sandbox, purpose, language, ai_disclosed, state, end_reason, summary, answered_at, ended_at)
values (tests.rid('k1'), tests.tid('a'), 'inbound', 'exotel', true, 'inbound', 'te', true, 'completed', 'goodbye', 'Wants a cotton saree', now() - interval '3 minutes', now() - interval '1 minute');

select is(pg_temp.q('a_sales', format($$select public.phone_call_correct(%L, %L, 'Wants a red Kanchi silk, visiting Saturday', '{"budget": "15000"}', 'Kanchi pattu means Kanchipuram silk, not cotton') ->> 'note'$$, tests.tid('a'), tests.rid('k1'))),
          'Kanchi pattu means Kanchipuram silk, not cotton', 'A1 Sales corrects a finished call');
select is((select summary from public.phone_calls where id = tests.rid('k1')), 'Wants a cotton saree', 'A2 the AI''s own summary stays as it was');
select is(pg_temp.q('a_owner', format($$select public.phone_call_get(%L, %L) -> 'correction' ->> 'summary'$$, tests.tid('a'), tests.rid('k1'))), 'Wants a red Kanchi silk, visiting Saturday', 'A3 the call shows its correction');
select is(pg_temp.q('a_owner', format($$select public.phone_call_correct(%L, %L, null, null, '') ->> 'summary'$$, tests.tid('a'), tests.rid('k1'))), 'Wants a red Kanchi silk, visiting Saturday', 'A4 null keeps a field, an empty string clears it');
select is((select correction_note from public.phone_calls where id = tests.rid('k1')), null, 'A5 ... the note is cleared');
select is(pg_temp.q('a_viewer', format($$select public.phone_call_correct(%L, %L, 'x', null, null)::text$$, tests.tid('a'), tests.rid('k1'))), 'ERR:42501', 'B1 a Viewer cannot');
select is(pg_temp.q('b_owner', format($$select public.phone_call_correct(%L, %L, 'x', null, null)::text$$, tests.tid('a'), tests.rid('k1'))), 'ERR:42501', 'B2 nor another workspace');
select is(pg_temp.q('a_owner', format($$select public.phone_call_correct(%L, %L, null, null, 'call me on +91 98765 43210')::text$$, tests.tid('a'), tests.rid('k1'))), 'ERR:23514', 'B3 a note with a phone number is refused');
select is(pg_temp.q('a_owner', format($$select public.phone_call_correct(%L, %L, null, null, 'mail ramesh@example.com')::text$$, tests.tid('a'), tests.rid('k1'))), 'ERR:23514', 'B4 ... and one with an e-mail address');
select is(pg_temp.q('a_owner', format($$select public.phone_call_correct(%L, %L, null, null, 'Say 15,000 as fifteen thousand') ->> 'note'$$, tests.tid('a'), tests.rid('k1'))), 'Say 15,000 as fifteen thousand', 'B5 a price is fine');
select throws_ok($$update public.phone_calls set summary = 'changed' where id = tests.rid('k1')$$, 'SM961', null, 'C1 the call itself still does not change');
select lives_ok($$update public.phone_calls set handled_at = now(), handled_by = tests.uid('a_owner') where id = tests.rid('k1')$$, 'C2 the handled mark still can be set once');
select is(pg_temp.q('a_owner', format($$select public.phone_call_correct(%L, %L, null, null, 'Pattu means silk') ->> 'note'$$, tests.tid('a'), tests.rid('k1'))), 'Pattu means silk', 'C3 a handled call can still be corrected');
select throws_ok($$update public.phone_calls set handled_at = null where id = tests.rid('k1')$$, 'SM961', null, 'C4 the handled mark is not taken back');
select is(pg_temp.q('outsider', format($$select public.call_corrections_for_call(%L)::text$$, tests.tid('a'))), '["Pattu means silk"]', 'D1 the worker reads the notes (never the corrected details)');
select is(pg_temp.q('a_owner', format($$select public.call_corrections_for_call(%L)::text$$, tests.tid('a'))), 'ERR:42501', 'D2 nobody else does');

select * from finish();
rollback;
