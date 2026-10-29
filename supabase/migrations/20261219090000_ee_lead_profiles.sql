-- Job EE (lead profile, contract-context-sources.md B3): every lead, whatever its source, has ONE normalised profile: what they want, how much, where, the budget, the timeline, how urgent, the language, a junk flag, and
-- what the owner fixed by hand (a fixed field is never overwritten by a later guess). One table, written only by the functions below; the list and the one-lead read are functions too, so a lead comes with its profile,
-- its contact's name, how many times the same person arrived again (the merge note) and whether THIS person has opened it yet.
-- The guesses are made by the API (rules first, the model second for what the rules left empty); the database stores them and keeps the rule that a field the owner fixed stays fixed.
-- Nothing here sends anything or changes a lead's status.

create table public.lead_profiles (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id) on delete restrict,
  lead_id       uuid not null,
  need          text check (need is null or (char_length(need) between 1 and 200 and app.text_is_clean(need) and not app.text_has_contact(need))),
  quantity      text check (quantity is null or (char_length(quantity) between 1 and 100 and app.text_is_clean(quantity) and not app.text_has_contact(quantity))),
  area          text check (area is null or (char_length(area) between 1 and 100 and app.text_is_clean(area) and not app.text_has_contact(area))),
  city          text check (city is null or (char_length(city) between 1 and 100 and app.text_is_clean(city) and not app.text_has_contact(city))),
  budget        text check (budget is null or (char_length(budget) between 1 and 100 and app.text_is_clean(budget) and not app.text_has_contact(budget))),
  timeline      text check (timeline is null or (char_length(timeline) between 1 and 100 and app.text_is_clean(timeline) and not app.text_has_contact(timeline))),
  campaign      text check (campaign is null or (char_length(campaign) between 1 and 120 and app.text_is_clean(campaign) and not app.text_has_contact(campaign))),
  urgency       text check (urgency in ('low', 'normal', 'high')),
  language      text check (language in ('en', 'te', 'hi', 'kn', 'ta', 'ml')),
  junk_reason   text check (junk_reason in ('spam', 'test', 'no_contact', 'abuse')),
  confidence    jsonb not null default '{}'::jsonb check (jsonb_typeof(confidence) = 'object'),
  fixed         text[] not null default '{}' check (cardinality(fixed) <= 20),
  opened_by     uuid[] not null default '{}' check (cardinality(opened_by) <= 50),
  normalised_by text check (normalised_by in ('rules', 'ai')),
  normalised_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, lead_id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id)
);
create index lead_profiles_urgency_idx on public.lead_profiles (tenant_id, urgency) where urgency is not null;
create index lead_profiles_junk_idx on public.lead_profiles (tenant_id, junk_reason) where junk_reason is not null;
comment on table public.lead_profiles is 'Job EE: the normalised profile of a lead (what they want, how much, where, budget, timeline, urgency, language, junk flag) with a confidence per guessed field, the fields the owner fixed, and who has opened the lead. Written only by the lead_profile_* functions.';
comment on column public.lead_profiles.id is 'SAFE: a row id. CLEAN-EXEMPT: uuid';
comment on column public.lead_profiles.need is 'PII: what the person wrote they want (taken from their own words; a phone number or an e-mail address is refused). Erased with the workspace.';
comment on column public.lead_profiles.quantity is 'PII: how much they want, in their words. Erased with the workspace.';
comment on column public.lead_profiles.area is 'PII: the area they named. Erased with the workspace.';
comment on column public.lead_profiles.city is 'PII: the city they named. Erased with the workspace.';
comment on column public.lead_profiles.budget is 'PII: the budget they named. Erased with the workspace.';
comment on column public.lead_profiles.timeline is 'PII: when they need it, in their words. Erased with the workspace.';
comment on column public.lead_profiles.campaign is 'PII: the campaign name the lead came from (an advertiser''s label). Erased with the workspace.';
comment on column public.lead_profiles.urgency is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.lead_profiles.language is 'SAFE: a closed language code. CLEAN-EXEMPT: closed CHECK list';
comment on column public.lead_profiles.junk_reason is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.lead_profiles.confidence is 'SAFE: a field name to high, medium or low. CLEAN-EXEMPT: written only by the lead_profile_* functions';
comment on column public.lead_profiles.fixed is 'SAFE: the names of the fields the owner fixed. CLEAN-EXEMPT: written only by the lead_profile_* functions';
comment on column public.lead_profiles.opened_by is 'SAFE: ids of the members who opened the lead. CLEAN-EXEMPT: uuid list';
comment on column public.lead_profiles.normalised_by is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
alter table public.lead_profiles enable row level security;
alter table public.lead_profiles force row level security;
revoke all on public.lead_profiles from public, anon, authenticated, service_role;
grant select on public.lead_profiles to authenticated;
create policy lead_profiles_select on public.lead_profiles for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));
create trigger lead_profiles_forbid_tenant_id_change before update on public.lead_profiles for each row execute function app.forbid_tenant_id_change();
create trigger audit_lead_profiles after insert or update or delete on public.lead_profiles for each row execute function app.audit_row_change('lead_profile', 'need,quantity,area,city,budget,timeline,campaign');

-- the person's words in the profile leave with the workspace (erasure) and are swept when a person asks to be forgotten
insert into erasure.registry (table_name, column_name, scope, strategy, replacement)
select 'lead_profiles', c, 'tenant', 'null', 'erased:1' from unnest(array['need', 'quantity', 'area', 'city', 'budget', 'timeline', 'campaign']) c
union all
select 'lead_profiles', c, 'sweep', 'substring', 'erased:1' from unnest(array['need', 'quantity', 'area', 'city', 'budget', 'timeline', 'campaign']) c;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- The one JSON shape of a lead in the Lead Desk: the lead's own fields (as the CRM list has always shown them) plus `profile`, `is_new` and `needs_profile` (the API has not guessed this lead's profile yet).
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.lead_desk_json(l public.leads, p public.lead_profiles, c public.contacts, v_uid uuid, v_full boolean) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', l.id, 'created_by', l.created_by, 'created_via', l.created_via, 'created_at', l.created_at, 'updated_at', l.updated_at, 'archived_at', l.archived_at,
    'company_id', l.company_id, 'contact_id', l.contact_id, 'owner_user_id', l.owner_user_id, 'status', l.status, 'source', l.source, 'disqualified_reason', l.disqualified_reason,
    'is_new', not (v_uid = any (coalesce(p.opened_by, '{}'::uuid[]))),
    'needs_profile', p.normalised_at is null,
    'profile', jsonb_build_object(
      'name', c.full_name, 'phone_e164', c.phone, 'email', c.email,
      'city', p.city, 'area', p.area, 'need', p.need, 'quantity', p.quantity, 'budget', p.budget, 'timeline', p.timeline, 'urgency', p.urgency, 'language', p.language,
      'source', l.source, 'campaign', p.campaign,
      'original_text', case when v_full then (select a.message from public.lead_arrivals a where a.tenant_id = l.tenant_id and a.lead_id = l.id and a.kind = 'first' order by a.received_at, a.id limit 1) end,
      'confidence', coalesce(p.confidence, '{}'::jsonb),
      'duplicate_of', case when c.phone is not null and app.phone_norm(c.phone) is not null then
          (select l2.id from public.leads l2 join public.contacts c2 on c2.tenant_id = l2.tenant_id and c2.id = l2.contact_id
            where l2.tenant_id = l.tenant_id and l2.id <> l.id and l2.archived_at is null and app.phone_norm(c2.phone) = app.phone_norm(c.phone)
              and (l2.created_at, l2.id) < (l.created_at, l.id) order by l2.created_at, l2.id limit 1) end,
      'merged_count', case when v_full then (select count(*) from public.lead_arrivals a where a.tenant_id = l.tenant_id and a.lead_id = l.id and a.kind = 'repeat') else 0 end,
      'junk', case when p.junk_reason is null then to_jsonb(false) else jsonb_build_object('reason', p.junk_reason) end,
      'fixed_by_you', to_jsonb(coalesce(p.fixed, '{}'::text[]))))
$$;
revoke all on function app.lead_desk_json(public.leads, public.lead_profiles, public.contacts, uuid, boolean) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- The list: newest first (the same order and cursor as the CRM list), with the filters of the Lead Desk. Every member of the workspace may read; a Viewer sees no arrival text (as before: they cannot read arrivals).
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.lead_desk_page(
  p_tenant_id uuid, p_limit integer, p_cursor_at timestamptz, p_cursor_id uuid, p_include_archived boolean,
  p_status text, p_source text, p_urgency text, p_from timestamptz, p_to timestamptz, p_q text, p_new boolean, p_junk text
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_limit  integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_full   boolean;
  v_like   text;
  v_digits text;
  v_items  jsonb;
  v_more   boolean;
begin
  if v_uid is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.lead_error('deny');
  end if;
  if (p_status is not null and p_status not in ('new', 'in_review', 'qualified', 'disqualified')) or (p_urgency is not null and p_urgency not in ('low', 'normal', 'high'))
     or (p_junk is not null and p_junk not in ('only', 'hide')) or (p_q is not null and char_length(p_q) > 100) then
    perform app.lead_error('invalid');
  end if;
  v_full := app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  if p_q is not null and btrim(p_q) <> '' then
    v_like := '%' || replace(replace(replace(btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%';
    v_digits := regexp_replace(p_q, '[^0-9]', '', 'g');
    if char_length(v_digits) < 4 then
      v_digits := null;
    end if;
  end if;
  with rows as (
    select l, p, c
      from public.leads l
      left join public.lead_profiles p on p.tenant_id = l.tenant_id and p.lead_id = l.id
      left join public.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
     where l.tenant_id = p_tenant_id
       and (p_include_archived or l.archived_at is null)
       and (p_cursor_at is null or (l.created_at, l.id) < (p_cursor_at, p_cursor_id))
       and (p_status is null or l.status = p_status::public.lead_status)
       and (p_source is null or l.source = p_source)
       and (p_urgency is null or p.urgency = p_urgency)
       and (p_from is null or l.created_at >= p_from)
       and (p_to is null or l.created_at < p_to)
       and (p_new is not true or p.id is null or not (v_uid = any (p.opened_by)))
       and (p_junk is null or (p_junk = 'only' and p.junk_reason is not null) or (p_junk = 'hide' and p.junk_reason is null))
       and (v_like is null
            or c.full_name ilike v_like or c.email ilike v_like or c.phone ilike v_like or p.need ilike v_like or p.area ilike v_like or p.city ilike v_like
            or (v_digits is not null and regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g') like '%' || v_digits || '%')
            or (v_full and exists (select 1 from public.lead_arrivals a where a.tenant_id = l.tenant_id and a.lead_id = l.id and a.message ilike v_like)))
     order by l.created_at desc, l.id desc
     limit v_limit + 1
  ), shown as (select * from rows order by (l).created_at desc, (l).id desc limit v_limit)
  select coalesce(jsonb_agg(app.lead_desk_json(s.l, s.p, s.c, v_uid, v_full) order by (s.l).created_at desc, (s.l).id desc), '[]'::jsonb),
         (select count(*) from rows) > v_limit
    into v_items, v_more
    from shown s;
  return jsonb_build_object('items', v_items, 'more', v_more);
end;
$$;
revoke all on function public.lead_desk_page(uuid, integer, timestamptz, uuid, boolean, text, text, text, timestamptz, timestamptz, text, boolean, text) from public, anon;
grant execute on function public.lead_desk_page(uuid, integer, timestamptz, uuid, boolean, text, text, text, timestamptz, timestamptz, text, boolean, text) to authenticated;
comment on function public.lead_desk_page(uuid, integer, timestamptz, uuid, boolean, text, text, text, timestamptz, timestamptz, text, boolean, text) is 'Job EE: one page of leads with their profile, newest first, with the Lead Desk filters. PII: names, phone numbers, e-mail addresses and what people wrote.';

create function public.lead_desk_get(p_tenant_id uuid, p_lead_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_full boolean;
  v_out  jsonb;
begin
  if v_uid is null or p_tenant_id is null or p_lead_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.lead_error('deny');
  end if;
  v_full := app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  select app.lead_desk_json(l, p, c, v_uid, v_full) into v_out
    from public.leads l
    left join public.lead_profiles p on p.tenant_id = l.tenant_id and p.lead_id = l.id
    left join public.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
   where l.tenant_id = p_tenant_id and l.id = p_lead_id;
  return v_out;   -- null: no such lead in this workspace
end;
$$;
revoke all on function public.lead_desk_get(uuid, uuid) from public, anon;
grant execute on function public.lead_desk_get(uuid, uuid) to authenticated;
comment on function public.lead_desk_get(uuid, uuid) is 'Job EE: one lead with its profile (null when there is none in this workspace). PII.';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Leads that have no guessed profile yet (newest first), with what the person wrote: the API guesses them and stores the result with lead_profile_seed.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.lead_profile_unseeded(p_tenant_id uuid, p_limit integer) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('lead_id', t.id, 'source', t.source, 'text', t.text, 'has_phone', t.has_phone, 'has_email', t.has_email) order by t.created_at desc, t.id desc)
                     from (select l.id, l.source, l.created_at,
                                  (select a.message from public.lead_arrivals a where a.tenant_id = l.tenant_id and a.lead_id = l.id and a.kind = 'first' order by a.received_at, a.id limit 1) as text,
                                  c.phone is not null as has_phone, c.email is not null as has_email
                             from public.leads l
                             left join public.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
                            where l.tenant_id = p_tenant_id and l.archived_at is null
                              and not exists (select 1 from public.lead_profiles p where p.tenant_id = l.tenant_id and p.lead_id = l.id and p.normalised_at is not null)
                            order by l.created_at desc, l.id desc
                            limit least(greatest(coalesce(p_limit, 50), 1), 200)) t), '[]'::jsonb);
end;
$$;
revoke all on function public.lead_profile_unseeded(uuid, integer) from public, anon;
grant execute on function public.lead_profile_unseeded(uuid, integer) to authenticated;
comment on function public.lead_profile_unseeded(uuid, integer) is 'Job EE: the leads whose profile has not been guessed yet, with the words the person wrote. PII.';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Store the rules'' first guess for several leads. Only a lead nobody has guessed yet (normalised_at is null) takes it; what the owner fixed is never touched. A bad item is skipped, the rest are stored.
-- items: [{lead_id, fields: {need, quantity, area, city, budget, timeline, campaign, urgency, language}, confidence: {field: high|medium|low}, junk: reason|null}]
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.lead_profile_seed(p_tenant_id uuid, p_items jsonb) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  it     jsonb;
  f      jsonb;
  n      integer := 0;
  v_conf jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    perform app.lead_error('invalid');
  end if;
  for it in select * from jsonb_array_elements(p_items) loop
    begin
      f := coalesce(it -> 'fields', '{}'::jsonb);
      v_conf := coalesce(it -> 'confidence', '{}'::jsonb);
      if jsonb_typeof(f) <> 'object' or jsonb_typeof(v_conf) <> 'object' then
        continue;
      end if;
      insert into public.lead_profiles as x (tenant_id, lead_id, need, quantity, area, city, budget, timeline, campaign, urgency, language, junk_reason, confidence, normalised_by, normalised_at)
      values (p_tenant_id, (it ->> 'lead_id')::uuid, f ->> 'need', f ->> 'quantity', f ->> 'area', f ->> 'city', f ->> 'budget', f ->> 'timeline', f ->> 'campaign', f ->> 'urgency', f ->> 'language',
              it ->> 'junk', v_conf, 'rules', now())
      on conflict (tenant_id, lead_id) do update
        set need = excluded.need, quantity = excluded.quantity, area = excluded.area, city = excluded.city, budget = excluded.budget, timeline = excluded.timeline, campaign = excluded.campaign,
            urgency = excluded.urgency, language = excluded.language, junk_reason = excluded.junk_reason, confidence = excluded.confidence,
            normalised_by = 'rules', normalised_at = now(), updated_at = now()
        where x.normalised_at is null;
      if found then
        n := n + 1;
      end if;
    exception when check_violation or foreign_key_violation or invalid_text_representation then
      continue;
    end;
  end loop;
  return n;
end;
$$;
revoke all on function public.lead_profile_seed(uuid, jsonb) from public, anon;
grant execute on function public.lead_profile_seed(uuid, jsonb) to authenticated;
comment on function public.lead_profile_seed(uuid, jsonb) is 'Job EE: stores the first guess of several leads'' profiles (only leads nobody has guessed yet). PII.';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- The model''s better guess for one lead: fills the fields the owner has NOT fixed, with the confidence the API gives (never "high"), and says who made it.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.lead_profile_apply_ai(p_tenant_id uuid, p_lead_id uuid, p_fields jsonb, p_confidence jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p      public.lead_profiles;
  k      text;
  v_conf jsonb;
  v_ok   text[] := '{}';
begin
  if auth.uid() is null or p_tenant_id is null or p_lead_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' or p_confidence is null or jsonb_typeof(p_confidence) <> 'object' then
    perform app.lead_error('invalid');
  end if;
  if not exists (select 1 from public.leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id) then
    perform app.lead_error('reference');
  end if;
  insert into public.lead_profiles (tenant_id, lead_id) values (p_tenant_id, p_lead_id) on conflict (tenant_id, lead_id) do nothing;
  select * into p from public.lead_profiles x where x.tenant_id = p_tenant_id and x.lead_id = p_lead_id for update;
  v_conf := p.confidence;
  for k in select jsonb_object_keys(p_fields) loop
    if k not in ('need', 'quantity', 'area', 'city', 'budget', 'timeline', 'urgency', 'language') or k = any (p.fixed) or p_confidence ->> k not in ('low', 'medium') then
      continue;
    end if;
    v_conf := v_conf || jsonb_build_object(k, p_confidence ->> k);
    v_ok := array_append(v_ok, k);
  end loop;
  update public.lead_profiles x set
      need = case when 'need' = any (p.fixed) or not ('need' = any (v_ok)) then x.need else p_fields ->> 'need' end,
      quantity = case when 'quantity' = any (p.fixed) or not ('quantity' = any (v_ok)) then x.quantity else p_fields ->> 'quantity' end,
      area = case when 'area' = any (p.fixed) or not ('area' = any (v_ok)) then x.area else p_fields ->> 'area' end,
      city = case when 'city' = any (p.fixed) or not ('city' = any (v_ok)) then x.city else p_fields ->> 'city' end,
      budget = case when 'budget' = any (p.fixed) or not ('budget' = any (v_ok)) then x.budget else p_fields ->> 'budget' end,
      timeline = case when 'timeline' = any (p.fixed) or not ('timeline' = any (v_ok)) then x.timeline else p_fields ->> 'timeline' end,
      urgency = case when 'urgency' = any (p.fixed) or not ('urgency' = any (v_ok)) then x.urgency else p_fields ->> 'urgency' end,
      language = case when 'language' = any (p.fixed) or not ('language' = any (v_ok)) then x.language else p_fields ->> 'language' end,
      confidence = v_conf, normalised_by = 'ai', normalised_at = now(), updated_at = now()
    where x.tenant_id = p_tenant_id and x.lead_id = p_lead_id;
  return public.lead_desk_get(p_tenant_id, p_lead_id);
end;
$$;
revoke all on function public.lead_profile_apply_ai(uuid, uuid, jsonb, jsonb) from public, anon;
grant execute on function public.lead_profile_apply_ai(uuid, uuid, jsonb, jsonb) to authenticated;
comment on function public.lead_profile_apply_ai(uuid, uuid, jsonb, jsonb) is 'Job EE: the model''s guess for one lead''s profile; the fields the owner fixed are never changed. PII.';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- The owner fixes fields in one tap. A key with a value sets it; a key with null clears it; either way the field is "fixed by you" with confidence high and no later guess overwrites it.
-- Fields: need, quantity, area, city, budget, timeline, campaign, urgency, language, and junk (null = not junk, or spam|test|no_contact|abuse).
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.lead_profile_fix(p_tenant_id uuid, p_lead_id uuid, p_fields jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  p      public.lead_profiles;
  k      text;
  v_conf jsonb;
  v_fix  text[];
begin
  if auth.uid() is null or p_tenant_id is null or p_lead_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.lead_error('deny');
  end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object' or p_fields = '{}'::jsonb then
    perform app.lead_error('invalid');
  end if;
  for k in select jsonb_object_keys(p_fields) loop
    if k not in ('need', 'quantity', 'area', 'city', 'budget', 'timeline', 'campaign', 'urgency', 'language', 'junk') then
      perform app.lead_error('invalid');
    end if;
  end loop;
  if not exists (select 1 from public.leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id) then
    perform app.lead_error('reference');
  end if;
  insert into public.lead_profiles (tenant_id, lead_id, normalised_by, normalised_at) values (p_tenant_id, p_lead_id, 'rules', now()) on conflict (tenant_id, lead_id) do nothing;
  select * into p from public.lead_profiles x where x.tenant_id = p_tenant_id and x.lead_id = p_lead_id for update;
  v_conf := p.confidence;
  v_fix := p.fixed;
  for k in select jsonb_object_keys(p_fields) loop
    v_conf := v_conf || jsonb_build_object(k, 'high');
    if not (k = any (v_fix)) then
      v_fix := array_append(v_fix, k);
    end if;
  end loop;
  begin
    update public.lead_profiles x set
        need = case when p_fields ? 'need' then p_fields ->> 'need' else x.need end,
        quantity = case when p_fields ? 'quantity' then p_fields ->> 'quantity' else x.quantity end,
        area = case when p_fields ? 'area' then p_fields ->> 'area' else x.area end,
        city = case when p_fields ? 'city' then p_fields ->> 'city' else x.city end,
        budget = case when p_fields ? 'budget' then p_fields ->> 'budget' else x.budget end,
        timeline = case when p_fields ? 'timeline' then p_fields ->> 'timeline' else x.timeline end,
        campaign = case when p_fields ? 'campaign' then p_fields ->> 'campaign' else x.campaign end,
        urgency = case when p_fields ? 'urgency' then p_fields ->> 'urgency' else x.urgency end,
        language = case when p_fields ? 'language' then p_fields ->> 'language' else x.language end,
        junk_reason = case when p_fields ? 'junk' then p_fields ->> 'junk' else x.junk_reason end,
        confidence = v_conf, fixed = v_fix, normalised_at = coalesce(x.normalised_at, now()), normalised_by = coalesce(x.normalised_by, 'rules'), updated_at = now()
      where x.tenant_id = p_tenant_id and x.lead_id = p_lead_id;
  exception when check_violation then
    perform app.lead_error('invalid');
  end;
  return public.lead_desk_get(p_tenant_id, p_lead_id);
end;
$$;
revoke all on function public.lead_profile_fix(uuid, uuid, jsonb) from public, anon;
grant execute on function public.lead_profile_fix(uuid, uuid, jsonb) to authenticated;
comment on function public.lead_profile_fix(uuid, uuid, jsonb) is 'Job EE: the owner fixes fields of a lead''s profile; fixed fields are never overwritten by a later guess. PII.';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- "Opened": the caller has seen this lead (the highlight for new leads goes away for them, not for anyone else). Keeps the last 50 members.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.lead_profile_open(p_tenant_id uuid, p_lead_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null or p_tenant_id is null or p_lead_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.lead_error('deny');
  end if;
  if not exists (select 1 from public.leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id) then
    perform app.lead_error('reference');
  end if;
  insert into public.lead_profiles (tenant_id, lead_id, opened_by) values (p_tenant_id, p_lead_id, array[v_uid])
  on conflict (tenant_id, lead_id) do update
    set opened_by = case when v_uid = any (lead_profiles.opened_by) then lead_profiles.opened_by
                         else (array_append(lead_profiles.opened_by, v_uid))[greatest(cardinality(lead_profiles.opened_by) + 1 - 49, 1):] end,
        updated_at = now();
  return true;
end;
$$;
revoke all on function public.lead_profile_open(uuid, uuid) from public, anon;
grant execute on function public.lead_profile_open(uuid, uuid) to authenticated;
comment on function public.lead_profile_open(uuid, uuid) is 'Job EE: the caller has opened this lead (no longer new for them).';
