-- Job OR (owner, 30 Oct 2026): leads that arrive through the forwarding address show as "Forwarded e-mail", not "Webhook (Zapier, n8n)".
-- A forwarding address without a portal named was tagged `webhook` (tag_of(kind, portal) fell back to it). The source tag now has a word of its own, `email_forward` (the same word as the source's kind), and the
-- existing sources and what came through them are moved over. A portal source (JustDial, 99acres, ...) keeps its portal's tag.

create or replace function app.lead_tag_ok(p text) returns boolean
language sql
immutable
set search_path = ''
as $$ select p = any (array['indiamart', 'justdial', '99acres', 'magicbricks', 'housing', 'meta_lead_ads', 'website_form', 'webhook', 'email_forward', 'excel_upload', 'google_sheet', 'pasted_list', 'vcard']) $$;
revoke all on function app.lead_tag_ok(text) from public;

do $$
declare
  t uuid;
begin
  -- only a workspace with no real webhook source of its own: there the old tag could only have come from the forwarding address
  for t in
    select s.tenant_id from public.lead_sources s
     where s.kind = 'email_forward' and s.tag = 'webhook'
       and not exists (select 1 from public.lead_sources w where w.tenant_id = s.tenant_id and w.kind = 'webhook')
     group by s.tenant_id
  loop
    update public.leads set source = 'email_forward' where tenant_id = t and source = 'webhook';
    update public.lead_arrivals set source_tag = 'email_forward' where tenant_id = t and source_tag = 'webhook';
    update integrations.lead_items set source_tag = 'email_forward' where tenant_id = t and source_tag = 'webhook';
    update public.lead_sources set tag = 'email_forward' where tenant_id = t and kind = 'email_forward' and tag = 'webhook';
  end loop;
end $$;
