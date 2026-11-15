-- 15 Nov 2026 (owner): the first WhatsApp to a NEW lead (the after-hours step of a lead rule) must be an approved template, never free text: the 24-hour window is closed for someone who has not written to us.
-- Until now an outreach message (category campaign_reminder, no campaign behind it) found no template and failed `template_required`. A template of the new purpose `lead` ("lead_ack", data/first_templates.json)
-- is what such a message uses, per language, once Meta approved it. A campaign reminder keeps the template its campaign names, exactly as before.
alter table integrations.wa_templates drop constraint wa_templates_purpose_check;
alter table integrations.wa_templates add constraint wa_templates_purpose_check check (purpose in ('visit', 'followup', 'order_status', 'info', 'reminder', 'lead'));

do $patch$
declare
  v_def text := pg_get_functiondef('app.wa_send_context(public.outbox_messages, timestamp with time zone)'::regprocedure);
  v_old text := $q$ where s.tenant_id = m.tenant_id and s.outbox_message_id = m.id and w.status = 'approved' and w.language = m.language;$q$;
  v_new text := $q$ where s.tenant_id = m.tenant_id and s.outbox_message_id = m.id and w.status = 'approved' and w.language = m.language;
    if t.id is null and not exists (select 1 from public.campaign_steps s where s.tenant_id = m.tenant_id and s.outbox_message_id = m.id) then
      select * into t from integrations.wa_templates x where x.tenant_id = m.tenant_id and x.purpose = 'lead' and x.language = m.language and x.status = 'approved' order by x.created_at, x.id limit 1;
    end if;$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'wa_send_context has changed: the lead-template patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;
