-- "Continue the chat" for businesses that already have the first templates (planner, 19 Nov 2026): the first-template set is created per business when the Owner presses "create the first templates", so a
-- business that did it before continue_chat existed does not have it. This adds continue_chat in English and Telugu as DRAFTS for every business that has the first set (it has lead_ack), and nothing else:
-- never submitted to Meta (the Owner presses "Send for review" himself), idempotent (an existing row, in any status, is left as it is), ids exactly as the API makes them (uuid v5 of tenant|name|language).

insert into integrations.wa_templates (id, tenant_id, name, language, category, purpose, body, status)
select extensions.uuid_generate_v5('0f6a3c1e-7d2b-4e58-9a14-5b8c2d3e6f70'::uuid, t.tenant_id::text || '|continue_chat|' || v.language), t.tenant_id, 'continue_chat', v.language, 'utility', 'followup', v.body, 'draft'
  from (select distinct tenant_id from integrations.wa_templates where name = 'lead_ack') t
 cross join (values ('en', 'Hi {{1}}, you contacted {{2}} about {{3}}. Reply here if you would like to continue.'),
                    ('te', 'నమస్కారం {{1}} గారు! మీరు {{3}} గురించి {{2}} ని అడిగారు. కొనసాగించాలంటే ఇక్కడే reply ఇవ్వండి.')) as v(language, body)
on conflict do nothing;
