-- The line's business name and the assistant's name come from its workspace (migration 20261231290000): the telephony worker's lookup returns the workspace's name with the tenant id; still only for the scheduler principal.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');
insert into public.phone_numbers (tenant_id, number, label, inbound_on) values (tests.tid('a'), '+914045903172', 'Test line', true);

select is(tests.scalar_as(tests.uid('outsider'), $$select public.phone_line_find('+914045903172') ->> 'business'$$), (select name from public.tenants where id = tests.tid('a')), 'A1 the worker gets the workspace''s name');
select is(tests.scalar_as(tests.uid('outsider'), $$select public.phone_line_find('+914045903172') ->> 'tenant_id'$$), tests.tid('a')::text, 'A2 ... with its tenant, as before');
select is(tests.scalar_as(tests.uid('outsider'), $$select (public.phone_line_find('+910000000000'))::text$$), null, 'A3 an unknown number is null, as before');
select is(tests.scalar_as(tests.uid('outsider'), $$select public.phone_line_find('+914045903172') ->> 'assistant'$$), null, 'A5 no assistant name set: null (the call says Priya)');
insert into public.assistant_settings (tenant_id, assistant_name, voice_persona, main_language, auto_switch_language, allow_english_mixing, style, speed, may_answer_prices, may_book_visits, may_send_media,
                                      may_talk_dues, max_discount_percent, handover_owner_asked, handover_upset, call_days, call_from_minute, call_to_minute)
values (tests.tid('a'), 'Lakshmi', 'female_warm', 'te', true, true, 'warm', 1.0, false, false, false, false, 0, true, true, array[1, 2, 3, 4, 5, 6]::smallint[], 600, 1140);
select is(tests.scalar_as(tests.uid('outsider'), $$select public.phone_line_find('+914045903172') ->> 'assistant'$$), 'Lakshmi', 'A6 the workspace''s assistant name');
select throws_ok(format($$select tests.scalar_as(%L, 'select public.phone_line_find(''+914045903172'')')$$, tests.uid('a_owner')), null, null, 'A4 an Owner is not the worker: refused');

select * from finish();
rollback;
