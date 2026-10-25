-- Job DJ (ADR 0093): the speaker of a voice is data (voice.voices.speaker) and a real voice enters only through the operator's function, with someone who listened.
begin;
select no_plan();
select tests.seed_two_tenants();

select is((select count(*) from information_schema.columns where table_schema = 'voice' and table_name = 'voices' and column_name = 'speaker'), 1::bigint, 'A1 a voice has a speaker column');
select is((select count(*) from voice.voices where speaker is not null), 0::bigint, 'A2 the synthetic voices of the fake provider have none');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname = 'operator_register_voice' and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))), 0::bigint, 'A3 no client can add a voice');
select is(tests.sqlstate_as(tests.uid('a_owner'), $$select app.operator_register_voice('sarvam-x-te', 'sarvam', 'te', 'X', 'kavya', 'someone')$$), '42501', 'A4 DENY: a signed-in Owner cannot (it is the operator''s)');
select throws_ok($$select app.operator_register_voice('sarvam-x-te', 'sarvam', 'te', 'Unreviewed', 'kavya')$$, '23514', null, 'B1 a real voice nobody listened to is refused (the table''s CHECK)');
select throws_ok($$select app.operator_register_voice('fake-new', 'fake', 'te', 'Fake', null)$$, '22023', null, 'B2 the fake provider is not added this way');
select throws_ok($$select app.operator_register_voice('sarvam-y-te', 'sarvam', 'te', 'No speaker', null, 'someone')$$, '22023', null, 'B3 a real voice names its speaker');
select throws_ok($$select app.operator_register_voice('sarvam-z-te', 'sarvam', 'te', 'Bad speaker', 'Kavya; drop table', 'someone')$$, '23514', null, 'B4 the speaker is a plain lower-case name');
select lives_ok($$select app.operator_register_voice('sarvam-kavya-te', 'sarvam', 'te', 'Kavya, Telugu', 'kavya', 'a native Telugu speaker')$$, 'B5 ALLOW: a reviewed voice with its speaker');
select is((select provider || '/' || speaker || '/' || synthetic::text from voice.voices where code = 'sarvam-kavya-te'), 'sarvam/kavya/false', 'B6 it is stored as a real, reviewed Sarvam voice');
select is((select count(*) from voice.voices where code = 'sarvam-kavya-te' and reviewed_at is not null and reviewed_by = 'a native Telugu speaker'), 1::bigint, 'B7 with who listened and when');
select * from finish();
rollback;
