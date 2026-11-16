-- Campaigns S2 (owner-approved plan docs/plans/textiles-campaigns-marketing.md, owner decisions 15-16 Nov 2026): the campaign kind `offer` (a new collection, a festival), built on the reminder-campaign machinery.
--   * The message is a fixed APPROVED MARKETING template (purpose `offer`, with the opt-out button) with structured values: {{1}} first name, {{2}} business name, {{3}} a short label (campaigns.offer_label, app.offer_label_problem).
--     The campaign's text is that template's words with {{name}}, {{business}}, {{label}}; the approval samples show exactly what goes out.
--   * Per-message checks on top of every outbox rule (STOP, suppression key, quiet hours, daily limit, kill switch): the customer's MARKETING consent is `granted` (else the step is skipped, reason `no_marketing_consent`),
--     the template is approved and marketing, and a frequency cap (campaigns.weekly_cap, 1 to 3, default 1): at most that many offer messages to one customer in 7 days (else `frequency_cap`).
--   * An offer is always sent as the template, even inside the customer's 24-hour window (marketing never goes as free text), so it carries the opt-out button.
--   * The approval screen can say how many customers are in and how many are left out, and why (public.campaign_preview: `offer`).
-- Everything else (approval once by the Owner with the second factor, the content hash, quiet hours, pausing, results) is the existing machinery, unchanged for the other kinds.

alter table public.campaigns drop constraint campaigns_kind_check;
alter table public.campaigns add constraint campaigns_kind_check check (kind in ('payment_due', 'delivery_update', 'fee_due', 'event', 'exam', 'holiday', 'offer'));
alter table public.campaigns
  add column offer_label text check (offer_label is null or (kind = 'offer' and app.text_is_clean(offer_label) and app.offer_label_problem(offer_label) is null)),
  add column weekly_cap smallint not null default 1 check (weekly_cap between 1 and 3);
comment on column public.campaigns.offer_label is 'SAFE: the short label of an offer ("Silk sarees", "Diwali"): 2 to 30 characters, clean text, no link, price or discount word (app.offer_label_problem); a collection or an occasion, never a person';
comment on column public.campaigns.weekly_cap is 'SAFE: at most this many offer messages to one customer in 7 days (1 to 3)';

alter table public.campaign_steps drop constraint campaign_steps_reason_check;
alter table public.campaign_steps add constraint campaign_steps_reason_check
  check (reason in ('past', 'missed', 'changed', 'cancelled', 'recipient_closed', 'promised', 'paid', 'balance_changed', 'template', 'no_marketing_consent', 'frequency_cap'));

-- an offer needs the `campaigns` module only
create or replace function app.campaign_kind_module(p_kind text) returns text
language sql
immutable
set search_path = ''
as $$ select case p_kind when 'payment_due' then 'dues' when 'delivery_update' then 'deliveries' when 'fee_due' then 'fees' when 'event' then 'programmes' when 'exam' then 'programmes' when 'holiday' then 'programmes' when 'offer' then 'campaigns' end $$;

-- the merge field {{label}} belongs to an offer only (and has a sample for the word check)
do $patch$
declare
  v_def text := pg_get_functiondef('app.campaign_text_check(text, text)'::regprocedure);
  v_old1 text := $q$f not in ('name', 'amount', 'due_date', 'reference', 'business')$q$;
  v_new1 text := $q$(f not in ('name', 'amount', 'due_date', 'reference', 'business') and not (f = 'label' and p_kind = 'offer'))$q$;
  v_old2 text := $q$  v_flags := app.outbox_content_flags(v_sample);$q$;
  v_new2 text := $q$  v_sample := replace(v_sample, '{{label}}', 'Silk sarees');
  v_flags := app.outbox_content_flags(v_sample);$q$;
begin
  if position(v_old1 in v_def) = 0 or position(v_old2 in v_def) = 0 then
    raise exception 'campaign_text_check has changed: the offer patch no longer fits';
  end if;
  execute replace(replace(v_def, v_old1, v_new1), v_old2, v_new2);
end;
$patch$;

-- the render takes the label as a seventh value (null for every other kind)
drop function app.campaign_render(text, text, bigint, date, text, text);
create function app.campaign_render(p_text text, p_name text, p_amount bigint, p_due date, p_ref text, p_business text, p_label text default null) returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(replace(replace(replace(p_text,
           '{{name}}', coalesce(p_name, '')),
           '{{amount}}', coalesce(app.format_inr(p_amount), '')),
           '{{due_date}}', coalesce(to_char(p_due, 'DD Mon YYYY'), '')),
           '{{reference}}', coalesce(p_ref, '')),
           '{{business}}', coalesce(p_business, '')),
           '{{label}}', coalesce(p_label, ''))
$$;
revoke all on function app.campaign_render(text, text, bigint, date, text, text, text) from public;

-- guards: the label and the cap are CONTENT (they change only after going back to draft)
do $patch$
declare
  v_def text := pg_get_functiondef('app.campaigns_guard()'::regprocedure);
  v_old1 text := $q$(new.kind, new.language, new.wa_template_id, new.message_text, new.steps, new.call_after_step, new.call_wait_hours, new.audience_kind, new.audience_filter)$q$;
  v_new1 text := $q$(new.kind, new.language, new.wa_template_id, new.message_text, new.steps, new.call_after_step, new.call_wait_hours, new.audience_kind, new.audience_filter, new.offer_label, new.weekly_cap)$q$;
  v_old2 text := $q$(old.kind, old.language, old.wa_template_id, old.message_text, old.steps, old.call_after_step, old.call_wait_hours, old.audience_kind, old.audience_filter)$q$;
  v_new2 text := $q$(old.kind, old.language, old.wa_template_id, old.message_text, old.steps, old.call_after_step, old.call_wait_hours, old.audience_kind, old.audience_filter, old.offer_label, old.weekly_cap)$q$;
begin
  if position(v_old1 in v_def) = 0 or position(v_old2 in v_def) = 0 then
    raise exception 'campaigns_guard has changed: the offer patch no longer fits';
  end if;
  execute replace(replace(v_def, v_old1, v_new1), v_old2, v_new2);
end;
$patch$;

-- the content hash of an OFFER also covers its label and cap (the hash of every other kind is unchanged: an approved campaign must not reset)
do $patch$
declare
  v_def text := pg_get_functiondef('app.campaign_content_sha(uuid, uuid)'::regprocedure);
  v_old text := $q$c.call_wait_hours::text)$q$;
  v_new text := $q$c.call_wait_hours::text) || case when c.kind = 'offer' then '#offer=' || coalesce(c.offer_label, '') || ':' || c.weekly_cap::text else '' end$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'campaign_content_sha has changed: the offer patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

-- the samples: an offer greets by first name (as the template does) and carries its label
do $patch$
declare
  v_def text := pg_get_functiondef('app.campaign_samples(uuid, uuid)'::regprocedure);
  v_old text := $q$app.campaign_render(c.message_text, ct.full_name, r.amount_paise, r.due_date, r.reference, (select t.name from public.tenants t where t.id = p_tenant)) as body$q$;
  v_new text := $q$app.campaign_render(c.message_text, case when c.kind = 'offer' then app.wa_first_name(ct.id, c.language) else ct.full_name end, r.amount_paise, r.due_date, r.reference, (select t.name from public.tenants t where t.id = p_tenant), c.offer_label) as body$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'campaign_samples has changed: the offer patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

-- what blocks approval: the template of an offer is an `offer` template, its label is fine, and the campaign's words ARE the template's words
do $patch$
declare
  v_def text := pg_get_functiondef('app.campaign_issues(uuid, uuid)'::regprocedure);
  v_old1 text := $q$elsif t.purpose <> 'reminder' then$q$;
  v_new1 text := $q$elsif t.purpose <> (case when c.kind = 'offer' then 'offer' else 'reminder' end) then$q$;
  v_old2 text := $q$  v_word := app.campaign_text_check(c.kind, c.message_text);$q$;
  v_new2 text := $q$  if c.kind = 'offer' then
    if c.offer_label is null or app.offer_label_problem(c.offer_label) is not null then
      v_out := array_append(v_out, 'offer_label');
    end if;
    if t.id is not null and c.message_text is distinct from replace(replace(replace(t.body, '{{1}}', '{{name}}'), '{{2}}', '{{business}}'), '{{3}}', '{{label}}') then
      v_out := array_append(v_out, 'text_not_template');
    end if;
  end if;
  v_word := app.campaign_text_check(c.kind, c.message_text);$q$;
begin
  if position(v_old1 in v_def) = 0 or position(v_old2 in v_def) = 0 then
    raise exception 'campaign_issues has changed: the offer patch no longer fits';
  end if;
  execute replace(replace(v_def, v_old1, v_new1), v_old2, v_new2);
end;
$patch$;

-- the per-message checks of an offer, and the first-name greeting
do $patch$
declare
  v_def text := pg_get_functiondef('app.campaign_step_run(uuid, public.campaign_steps)'::regprocedure);
  v_old1 text := $q$  v_id := app.campaign_message_id(s.campaign_id, s.recipient_id, s.step_no, r.due_date);$q$;
  v_new1 text := $q$  if c.kind = 'offer' then
    -- marketing goes only to a customer who said yes to marketing, only as an approved marketing template, and at most `weekly_cap` times in 7 days
    if ct.id is null or ct.erased_at is not null or ct.marketing_consent is distinct from 'granted' then
      perform app.campaign_step_skip(s.id, 'no_marketing_consent'); return 'skipped';
    end if;
    if (select w.category from integrations.wa_templates w where w.tenant_id = s.tenant_id and w.id = c.wa_template_id) is distinct from 'marketing' then
      perform app.campaign_step_skip(s.id, 'template'); return 'skipped';
    end if;
    if (select count(*) from public.campaign_steps x2
          join public.campaigns c2 on c2.tenant_id = x2.tenant_id and c2.id = x2.campaign_id and c2.kind = 'offer'
          join public.outbox_messages o on o.tenant_id = x2.tenant_id and o.id = x2.outbox_message_id
         where x2.tenant_id = s.tenant_id and o.contact_id = r.contact_id and o.status in ('queued', 'needs_approval', 'sent') and o.created_at > v_now - interval '7 days') >= c.weekly_cap then
      perform app.campaign_step_skip(s.id, 'frequency_cap'); return 'skipped';
    end if;
  end if;
  v_id := app.campaign_message_id(s.campaign_id, s.recipient_id, s.step_no, r.due_date);$q$;
  v_old2 text := $q$app.campaign_render(c.message_text, case when ct.erased_at is null then ct.full_name else '' end, r.amount_paise, r.due_date, r.reference, v_biz), c.language);$q$;
  v_new2 text := $q$app.campaign_render(c.message_text, case when ct.erased_at is not null then '' when c.kind = 'offer' then app.wa_first_name(ct.id, c.language) else ct.full_name end, r.amount_paise, r.due_date, r.reference, v_biz, c.offer_label), c.language);$q$;
begin
  if position(v_old1 in v_def) = 0 or position(v_old2 in v_def) = 0 then
    raise exception 'campaign_step_run has changed: the offer patch no longer fits';
  end if;
  execute replace(replace(v_def, v_old1, v_new1), v_old2, v_new2);
end;
$patch$;

-- the campaign as JSON: the label and the cap
do $patch$
declare
  v_def text := pg_get_functiondef('app.campaign_json(public.campaigns)'::regprocedure);
  v_old text := $q$'call_after_step', c.call_after_step,$q$;
  v_new text := $q$'offer_label', c.offer_label, 'weekly_cap', c.weekly_cap, 'call_after_step', c.call_after_step,$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'campaign_json has changed: the offer patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

-- the third template value: an offer's label (its campaign's), else a visit's date and time; an offer is never sent as free text inside the 24-hour window
create function app.wa_third_value(t integrations.wa_templates, m public.outbox_messages) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when t.purpose = 'offer'
              then (select c.offer_label from public.campaign_steps s join public.campaigns c on c.tenant_id = s.tenant_id and c.id = s.campaign_id
                     where s.tenant_id = m.tenant_id and s.outbox_message_id = m.id)
              else app.wa_visit_label(m.tenant_id, m.lead_id, m.id) end
$$;
revoke all on function app.wa_third_value(integrations.wa_templates, public.outbox_messages) from public, anon, authenticated, service_role;

do $patch$
declare
  v_def text := pg_get_functiondef('app.wa_send_context(public.outbox_messages, timestamp with time zone)'::regprocedure);
  v_old1 text := $q$jsonb_build_array(app.wa_visit_label(m.tenant_id, m.lead_id, m.id))$q$;
  v_new1 text := $q$jsonb_build_array(app.wa_third_value(t, m))$q$;
  v_old2 text := $q$t.body like '%{{3}}%' and app.wa_visit_label(m.tenant_id, m.lead_id, m.id) is null$q$;
  v_new2 text := $q$t.body like '%{{3}}%' and app.wa_third_value(t, m) is null$q$;
  v_old3 text := $q$'window_open', v_open,$q$;
  v_new3 text := $q$'window_open', v_open and coalesce(t.purpose, '') <> 'offer',$q$;
begin
  if position(v_old1 in v_def) = 0 or position(v_old2 in v_def) = 0 or position(v_old3 in v_def) = 0 then
    raise exception 'wa_send_context has changed: the offer patch no longer fits';
  end if;
  execute replace(replace(replace(v_def, v_old1, v_new1), v_old2, v_new2), v_old3, v_new3);
end;
$patch$;

-- ------------------------------------------------------------------------------------------------------------------------------
-- the offer's own settings: the label and the weekly cap (a draft is edited in place; an approved one goes back to draft)
-- ------------------------------------------------------------------------------------------------------------------------------
create function public.campaign_offer_set(p_tenant_id uuid, p_campaign_id uuid, p_label text, p_weekly_cap integer default 1) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_label text := btrim(regexp_replace(coalesce(p_label, ''), '\s+', ' ', 'g'));
  c       public.campaigns;
  v_back  boolean := false;
begin
  if v_uid is null or p_tenant_id is null or p_campaign_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.campaign_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'campaigns');
  if p_weekly_cap is null or p_weekly_cap not between 1 and 3 or app.offer_label_problem(v_label) is not null then
    perform app.campaign_error('invalid', coalesce(app.offer_label_problem(v_label), 'weekly_cap'));
  end if;
  select * into c from public.campaigns x where x.tenant_id = p_tenant_id and x.id = p_campaign_id for update;
  if not found then
    perform app.campaign_error('reference');
  end if;
  if c.kind <> 'offer' then
    perform app.campaign_error('invalid');
  end if;
  if c.status in ('done', 'cancelled') then
    perform app.campaign_error('state');
  end if;
  if (c.offer_label, c.weekly_cap) is distinct from (v_label, p_weekly_cap::smallint) then
    v_back := app.campaign_reset(p_tenant_id, p_campaign_id, 'changed');
    update public.campaigns set offer_label = v_label, weekly_cap = p_weekly_cap where id = c.id returning * into c;
  end if;
  return jsonb_build_object('campaign', app.campaign_json(c), 'back_to_draft', v_back);
end;
$$;
revoke all on function public.campaign_offer_set(uuid, uuid, text, integer) from public, anon;
grant execute on function public.campaign_offer_set(uuid, uuid, text, integer) to authenticated;

-- who is in and who is left out, and why (what the approval screen shows)
create function app.campaign_offer_counts(p_tenant uuid, p_campaign uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'recipients', count(*),
    'will_receive', count(*) filter (where k.marketing_consent = 'granted' and k.suppressed_at is null and k.whatsapp_consent <> 'withdrawn' and k.phone is not null),
    'left_out', jsonb_build_object(
      'stopped', count(*) filter (where k.suppressed_at is not null or k.whatsapp_consent = 'withdrawn'),
      'marketing_withdrawn', count(*) filter (where k.suppressed_at is null and k.whatsapp_consent <> 'withdrawn' and k.marketing_consent = 'withdrawn'),
      'no_marketing_consent', count(*) filter (where k.suppressed_at is null and k.whatsapp_consent <> 'withdrawn' and k.marketing_consent = 'unknown'),
      'no_whatsapp', count(*) filter (where k.suppressed_at is null and k.whatsapp_consent <> 'withdrawn' and k.marketing_consent = 'granted' and k.phone is null)))
    from public.campaign_recipients r join public.contacts k on k.tenant_id = r.tenant_id and k.id = r.contact_id
   where r.tenant_id = p_tenant and r.campaign_id = p_campaign
$$;
revoke all on function app.campaign_offer_counts(uuid, uuid) from public, anon, authenticated, service_role;

do $patch$
declare
  v_def text := pg_get_functiondef('public.campaign_preview(uuid, uuid)'::regprocedure);
  v_old text := $q$'disclosure', app.outbox_disclosure(c.language),$q$;
  v_new text := $q$'disclosure', app.outbox_disclosure(c.language),
    'offer', case when c.kind = 'offer' then app.campaign_offer_counts(p_tenant_id, p_campaign_id) end,$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'campaign_preview has changed: the offer patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

-- whatever suppresses a customer (a STOP, the staff's own "stop messaging", a complaint, a legal hold) withdraws marketing consent too: one rule on the contact, not one per route
create function app.contacts_marketing_on_suppress() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.suppressed_at is not null and old.suppressed_at is null and new.marketing_consent = 'granted' then
    new.marketing_consent := 'withdrawn';
    new.marketing_consent_via := 'stop_reply';
    new.marketing_consent_at := now();
    new.marketing_consent_by := null;
    new.marketing_consent_note := null;
  end if;
  return new;
end;
$$;
revoke all on function app.contacts_marketing_on_suppress() from public;
create trigger contacts_marketing_on_suppress before update of suppressed_at on public.contacts
  for each row execute function app.contacts_marketing_on_suppress();
