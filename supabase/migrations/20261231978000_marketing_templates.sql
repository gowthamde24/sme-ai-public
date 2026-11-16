-- Campaigns S2a (owner decisions 16 Nov 2026): what the two MARKETING templates (new_collection_offer, festival_offer) need before they can exist.
--   * a third template variable {{3}}: a short label (a collection or an occasion, "Silk sarees", "Diwali"), never free message text, never a price or a link (app.offer_label_problem, one rule for every caller);
--   * the template purpose `offer`;
--   * Meta's marketing opt-out: a quick-reply button ("Stop promotions") on the template. A tap withdraws the customer's MARKETING consent only (service messages go on) and is audited;
--     typing STOP still stops everything, as before (migration 977000);
--   * `opt_out_label` on the template (the button's words, 2 to 25 characters: Meta's limit) and `opt_out` in what the sender is told about the template.

alter table integrations.wa_templates add column opt_out_label text check (opt_out_label is null or (char_length(opt_out_label) between 2 and 25 and opt_out_label = btrim(opt_out_label) and app.text_is_clean(opt_out_label)));
comment on column integrations.wa_templates.opt_out_label is 'SAFE: the words on the template''s marketing opt-out quick-reply button (for example "Stop promotions"); never customer data';

alter table integrations.wa_templates drop constraint wa_templates_purpose_check;
alter table integrations.wa_templates add constraint wa_templates_purpose_check check (purpose in ('visit', 'followup', 'order_status', 'info', 'reminder', 'lead', 'offer'));
-- an `offer` is always a marketing template and always carries its opt-out button
alter table integrations.wa_templates add constraint wa_templates_offer_is_marketing check (purpose <> 'offer' or (category = 'marketing' and opt_out_label is not null));

-- the body rule: {{1}} always; {{2}} and {{3}} allowed ({{3}} only with {{2}}); never {{4}}.. ; never a variable at the start or the end; never two side by side
alter table integrations.wa_templates drop constraint wa_templates_body_check1;
alter table integrations.wa_templates add constraint wa_templates_body_check1
  check (body ~ '\{\{1\}\}' and body !~ '\{\{[4-9]\}\}' and body !~ '^\s*\{\{[123]\}\}' and body !~ '\{\{[123]\}\}\s*$' and body !~ '\}\}\s*\{\{' and (body !~ '\{\{3\}\}' or body ~ '\{\{2\}\}'));

-- ------------------------------------------------------------------------------------------------------------------------------
-- the {{3}} label: NULL when it is fine, else the closed reason (length, text, link, price, discount)
-- ------------------------------------------------------------------------------------------------------------------------------
create function app.offer_label_problem(p text) returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p is null or p <> btrim(p) or char_length(p) not between 2 and 30 then 'length'
    when not app.text_is_clean(p) or p ~ '[[:cntrl:]]' or p ~ '\s{2,}' then 'text'
    when p ~* '(https?:|www\.|://|@|\.(com|in|co|net|org|app|me|io|shop|store)(\M|$))' then 'link'
    when p ~* '(₹|\mrs\.?|\minr|\mrupees?)\s*[0-9]' or p ~* '[0-9]\s*(₹|%|\mrs\M|\minr\M|\mrupees?\M|\mpercent\M)' or p ~* '(\mpercent\M|%)' then 'price'
    when p ~* '\m(off|discount|cashback)\M' or p ~ '(తగ్గింపు|డిస్కౌంట్|छूट|डिस्काउंट|ರಿಯಾಯಿತಿ|ಡಿಸ್ಕೌಂಟ್)' then 'discount'
    else null end
$$;
revoke all on function app.offer_label_problem(text) from public;

-- ------------------------------------------------------------------------------------------------------------------------------
-- the template as JSON (adds the button words) and its save (adds the optional button words)
-- ------------------------------------------------------------------------------------------------------------------------------
create or replace function app.wa_template_json(t integrations.wa_templates) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('id', t.id, 'name', t.name, 'language', t.language, 'category', t.category, 'purpose', t.purpose, 'body', t.body, 'opt_out_label', t.opt_out_label, 'status', t.status, 'updated_at', t.updated_at)
$$;

drop function public.wa_template_save(uuid, uuid, text, text, text, text, text);
create function public.wa_template_save(p_id uuid, p_tenant_id uuid, p_name text, p_language text, p_category text, p_purpose text, p_body text, p_opt_out_label text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t integrations.wa_templates;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.wa_error('deny');
  end if;
  if p_id is null or p_name is null or p_language is null or p_category is null or p_purpose is null or p_body is null then
    perform app.wa_error('invalid');
  end if;
  select * into t from integrations.wa_templates x where x.id = p_id;
  if found then
    if t.tenant_id <> p_tenant_id then
      perform app.wa_error('invalid');
    end if;
    if t.status in ('approved', 'submitted') then
      perform app.wa_error('state');   -- a template under review or approved is not edited: make a new one
    end if;
  end if;
  begin
    insert into integrations.wa_templates as x (id, tenant_id, name, language, category, purpose, body, opt_out_label, created_by)
    values (p_id, p_tenant_id, btrim(p_name), p_language, p_category, p_purpose, btrim(p_body), nullif(btrim(coalesce(p_opt_out_label, '')), ''), auth.uid())
    on conflict (id) do update set name = excluded.name, language = excluded.language, category = excluded.category, purpose = excluded.purpose, body = excluded.body,
                                   opt_out_label = excluded.opt_out_label, status = 'draft', updated_at = now()
    returning x.* into t;
  exception
    when unique_violation then perform app.wa_error('used');
    when check_violation then perform app.wa_error('invalid');
  end;
  perform app.write_audit_event(p_tenant_id, 'whatsapp.template_saved', 'wa_template', t.id, null, jsonb_build_object('purpose', t.purpose, 'language', t.language));
  return app.wa_template_json(t);
end;
$$;
revoke all on function public.wa_template_save(uuid, uuid, text, text, text, text, text, text) from public, anon;
grant execute on function public.wa_template_save(uuid, uuid, text, text, text, text, text, text) to authenticated;

-- the sender is told whether the template carries the opt-out button (it then sends the button's payload with the message)
do $patch$
declare
  v_def text := pg_get_functiondef('app.wa_send_context(public.outbox_messages, timestamp with time zone)'::regprocedure);
  v_old text := $q$ else '{}'::jsonb end end);$q$;
  v_new text := $q$ else '{}'::jsonb end || case when t.opt_out_label is not null then jsonb_build_object('opt_out', true) else '{}'::jsonb end end);$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'wa_send_context has changed: the opt-out patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

-- ------------------------------------------------------------------------------------------------------------------------------
-- a tap on the opt-out button: marketing consent withdrawn, nothing else
-- ------------------------------------------------------------------------------------------------------------------------------
do $c$
declare
  v_name text;
begin
  select c.conname into v_name from pg_constraint c where c.conrelid = 'public.contacts'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%marketing_consent_via = ANY%' and pg_get_constraintdef(c.oid) like '%stop_reply%';
  if v_name is null then
    raise exception 'the marketing_consent_via check is not where it was';
  end if;
  execute format('alter table public.contacts drop constraint %I', v_name);
end;
$c$;
alter table public.contacts add constraint contacts_marketing_consent_via_check
  check (marketing_consent_via in ('whatsapp_reply', 'form_tick', 'owner_recorded', 'import_with_proof', 'stop_reply', 'stop_button', 'customer_link', 'erasure'));

create or replace function app.marketing_consent_withdraw_system(p_tenant uuid, p_contact uuid, p_via text) returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if p_via is null or p_via not in ('stop_reply', 'stop_button', 'customer_link') then
    raise exception 'unknown way of withdrawing consent' using errcode = '22023';
  end if;
  update public.contacts set marketing_consent = 'withdrawn', marketing_consent_at = now(), marketing_consent_via = p_via, marketing_consent_by = null, marketing_consent_note = null
   where id = p_contact and tenant_id = p_tenant and marketing_consent = 'granted';
  return found;
end;
$$;

-- the customer's tap arrives as an inbound message of the kind `button_marketing_stop` (the API sets it from the payload we sent with the template, never from the button's words): the message is stored as always
-- (its text is the button's words) and, in the SAME transaction, the customer's marketing consent is withdrawn. Typing STOP is unchanged: it stops everything.
do $patch$
declare
  v_def text := pg_get_functiondef('public.wa_ingest_inbound(text, text, text, text, text, text, timestamptz, text, integer, boolean)'::regprocedure);
  v_old text := $q$  exception when sqlstate 'SM401' then
    return jsonb_build_object('outcome', 'gate_closed');$q$;
  v_new text := $q$    if p_kind = 'button_marketing_stop' then
      perform app.marketing_consent_withdraw_system(a.tenant_id, c.id, 'stop_button');
    end if;
  exception when sqlstate 'SM401' then
    return jsonb_build_object('outcome', 'gate_closed');$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'wa_ingest_inbound has changed: the marketing opt-out patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;
