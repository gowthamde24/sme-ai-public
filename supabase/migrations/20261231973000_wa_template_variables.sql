-- 15 Nov 2026 (owner): a template variable never holds free message text. A template with two variables ({{1}} = the customer's first name, {{2}} = the business name; first templates, data/first_templates.json)
-- gets its values from the database at send time: app.wa_send_context adds `variables` to the template it names when the body has {{2}}. An older single-variable template keeps taking the message text.
-- The first name is the first word of the contact's name, cleaned (letters, digits and marks only, at most 30 characters); with no usable name the person is greeted with a plain word of their language.
-- the body rule allowed ONE variable; it now allows {{1}} alone (an older template: the message text) or {{1}} and {{2}} (structured), never {{3}}.., never a variable at the start or the end, never two side by side
alter table integrations.wa_templates drop constraint wa_templates_body_check1;
alter table integrations.wa_templates add constraint wa_templates_body_check1
  check (body ~ '\{\{1\}\}' and body !~ '\{\{[3-9]\}\}' and body !~ '^\s*\{\{[12]\}\}' and body !~ '\{\{[12]\}\}\s*$' and body !~ '\}\}\s*\{\{');

create function app.wa_first_name(p_contact uuid, p_language text) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select nullif(left(regexp_replace(split_part(btrim(c.full_name), ' ', 1), '[^[:alnum:]\u0900-\u0D7F._-]', '', 'g'), 30), '')
       from public.contacts c
      where c.id = p_contact and c.erased_at is null and c.full_name !~* '^\s*(whatsapp customer|unknown|new enquiry)' and split_part(btrim(c.full_name), ' ', 1) !~ '^[0-9+()-]+$'),
    case p_language when 'te' then 'అండీ' when 'hi' then 'जी' when 'kn' then 'ಅವರೇ' else 'there' end)
$$;
revoke all on function app.wa_first_name(uuid, text) from public, anon, authenticated, service_role;

do $patch$
declare
  v_def text := pg_get_functiondef('app.wa_send_context(public.outbox_messages, timestamp with time zone)'::regprocedure);
  v_old text := $q$jsonb_build_object('name', t.name, 'language', t.language, 'body', t.body)$q$;
  v_new text := $q$jsonb_build_object('name', t.name, 'language', t.language, 'body', t.body) || case when t.body like '%{{2}}%'
      then jsonb_build_object('variables', jsonb_build_array(app.wa_first_name(m.contact_id, m.language), (select tn.name from public.tenants tn where tn.id = m.tenant_id))) else '{}'::jsonb end$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'wa_send_context has changed: the template-variables patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;
