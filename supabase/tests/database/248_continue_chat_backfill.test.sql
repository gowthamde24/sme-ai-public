-- The continue_chat backfill (migration 20261231985100): drafts only, for businesses that have the first templates, idempotent.
begin;
select no_plan();
select tests.seed_two_tenants();
insert into integrations.wa_templates (id, tenant_id, name, language, category, purpose, body) values (gen_random_uuid(), tests.tid('a'), 'lead_ack', 'en', 'utility', 'lead', 'Hi {{1}}, thanks for contacting {{2}}. We will reply soon.');
insert into integrations.wa_templates (id, tenant_id, name, language, category, purpose, body, status)
select extensions.uuid_generate_v5('0f6a3c1e-7d2b-4e58-9a14-5b8c2d3e6f70'::uuid, t.tenant_id::text || '|continue_chat|' || v.language), t.tenant_id, 'continue_chat', v.language, 'utility', 'followup', v.body, 'draft'
  from (select distinct tenant_id from integrations.wa_templates where name = 'lead_ack') t
 cross join (values ('en', 'Hi {{1}}, you contacted {{2}} about {{3}}. Reply here if you would like to continue.'),
                    ('te', 'నమస్కారం {{1}} గారు! మీరు {{3}} గురించి {{2}} ని అడిగారు. కొనసాగించాలంటే ఇక్కడే reply ఇవ్వండి.')) as v(language, body)
on conflict do nothing;

select is((select count(*)::int from integrations.wa_templates where name = 'continue_chat' and tenant_id = tests.tid('a')), 2, 'A1 a business that has the first templates gets continue_chat in two languages');
select is((select count(*)::int from integrations.wa_templates where name = 'continue_chat' and tenant_id = tests.tid('b')), 0, 'A2 a business without them gets nothing');
select is((select string_agg(language || ':' || status, ',' order by language) from integrations.wa_templates where name = 'continue_chat' and tenant_id = tests.tid('a')), 'en:draft,te:draft', 'A3 English and Telugu, as DRAFTS (never submitted)');
select is((select id from integrations.wa_templates where name = 'continue_chat' and language = 'en' and tenant_id = tests.tid('a')), extensions.uuid_generate_v5('0f6a3c1e-7d2b-4e58-9a14-5b8c2d3e6f70'::uuid, tests.tid('a')::text || '|continue_chat|en'), 'A4 the id is the one the API makes');
update integrations.wa_templates set status = 'approved' where name = 'continue_chat' and language = 'en' and tenant_id = tests.tid('a');
insert into integrations.wa_templates (id, tenant_id, name, language, category, purpose, body, status)
select extensions.uuid_generate_v5('0f6a3c1e-7d2b-4e58-9a14-5b8c2d3e6f70'::uuid, t.tenant_id::text || '|continue_chat|' || v.language), t.tenant_id, 'continue_chat', v.language, 'utility', 'followup', v.body, 'draft'
  from (select distinct tenant_id from integrations.wa_templates where name = 'lead_ack') t
 cross join (values ('en', 'Hi {{1}}, you contacted {{2}} about {{3}}. Reply here if you would like to continue.'),
                    ('te', 'నమస్కారం {{1}} గారు! మీరు {{3}} గురించి {{2}} ని అడిగారు. కొనసాగించాలంటే ఇక్కడే reply ఇవ్వండి.')) as v(language, body)
on conflict do nothing;

select is((select count(*)::int from integrations.wa_templates where name = 'continue_chat' and tenant_id = tests.tid('a')), 2, 'B1 running it again adds nothing');
select is((select status from integrations.wa_templates where name = 'continue_chat' and language = 'en' and tenant_id = tests.tid('a')), 'approved', 'B2 and leaves an existing row as it is, whatever its status');
select * from finish();
rollback;
