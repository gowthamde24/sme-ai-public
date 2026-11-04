-- Lead Finder (2 Nov 2026 job; ADR 0119): the businesses the assistant finds, before they are customers.
--
--   public.lead_finder_settings   one row per workspace: the owner's bar, daily call cap, calling hours, the search caps
--   public.prospect_searches      one row per search ("find saree shops in Jayanagar"): the plan the owner approved, the SKU it bills, the cost
--   public.prospects              one row per business found: where it came from, the fit score and reason, the decision (status), the call result
--   public.prospect_* functions   the only way in; the tables are written by nobody directly
--
-- Who: Owner, Admin and Sales read and act; the Owner and Admin approve a search and change the settings; a Viewer sees nothing. A workspace whose business type does not list the module `lead_finder` (a school) is refused (SM971).
-- Google Maps terms: `place_id` is kept for good; every other field that came from Google is kept for at most 30 days (`fetched_at`, `prospect_places_expire`) and shown with the "Google Maps" attribution (`source = 'google_maps'`).
-- "Not interested" and "do not call" set `suppressed`: the business never comes back from a search and is never called again in this workspace.
-- Real-data gate: results from Google Places are accepted only in a workspace whose gate is open; a closed workspace takes only the reserved "+00" numbers of synthetic data.
-- SQLSTATEs: 22023 invalid, 42501 not allowed, 23503 not found, SM971 not for this business type, SM972 search cap reached, SM973 not in a state that allows this.

-- the Lead Desk's closed list of lead sources gains `lead_finder` (a lead made from a qualifying call of a business the Lead Finder found)
create or replace function app.lead_tag_ok(p text) returns boolean
language sql
immutable
set search_path = ''
as $$ select p = any (array['indiamart', 'justdial', '99acres', 'magicbricks', 'housing', 'meta_lead_ads', 'website_form', 'webhook', 'email_forward', 'excel_upload', 'google_sheet', 'pasted_list', 'vcard', 'lead_finder']) $$;
revoke all on function app.lead_tag_ok(text) from public;

create function app.lf_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'module'    then raise exception 'not available for this business type' using errcode = 'SM971';
    when 'cap'       then raise exception 'the search limit for today is reached' using errcode = 'SM972';
    when 'state'     then raise exception 'not possible in the state it is in now' using errcode = 'SM973';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.lf_error(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- settings
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.lead_finder_settings (
  tenant_id          uuid primary key references public.tenants (id) on delete restrict,
  fit_bar            integer not null default 70 check (fit_bar between 50 and 100),
  daily_call_cap     integer not null default 20 check (daily_call_cap between 0 and 500),
  call_from_hour     integer not null default 10 check (call_from_hour between 9 and 20),
  call_to_hour       integer not null default 19 check (call_to_hour between 10 and 21),
  searches_per_day   integer not null default 5 check (searches_per_day between 1 and 20),
  results_per_search integer not null default 20 check (results_per_search between 1 and 20),
  updated_by         uuid,
  updated_at         timestamptz not null default now(),
  check (call_from_hour < call_to_hour)
);
comment on table public.lead_finder_settings is 'Lead Finder: the Owner''s bar for calling, the daily call cap, the calling hours (India time, 09:00 to 21:00 at most) and the search caps. One row per workspace, written by the settings function.';
comment on column public.lead_finder_settings.fit_bar is 'SAFE: a number from 50 to 100. CLEAN-EXEMPT: range CHECK';
comment on column public.lead_finder_settings.daily_call_cap is 'SAFE: a number. CLEAN-EXEMPT: range CHECK';
comment on column public.lead_finder_settings.call_from_hour is 'SAFE: an hour of the day. CLEAN-EXEMPT: range CHECK';
comment on column public.lead_finder_settings.call_to_hour is 'SAFE: an hour of the day. CLEAN-EXEMPT: range CHECK';
comment on column public.lead_finder_settings.searches_per_day is 'SAFE: a number. CLEAN-EXEMPT: range CHECK';
comment on column public.lead_finder_settings.results_per_search is 'SAFE: a number. CLEAN-EXEMPT: range CHECK';
comment on column public.lead_finder_settings.updated_by is 'SAFE: the id of the member who last changed the settings. CLEAN-EXEMPT: uuid';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- searches
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.prospect_searches (
  id             uuid primary key,
  tenant_id      uuid not null references public.tenants (id) on delete restrict,
  query          text not null check (char_length(query) between 2 and 200),
  area           text check (char_length(area) <= 120),
  category_hint  text check (category_hint in ('retailer', 'boutique', 'contractor', 'builder', 'dealer', 'other')),
  max_results    integer not null check (max_results between 1 and 20),
  provider       text not null check (provider in ('fixture', 'places')),
  sku            text not null check (sku ~ '^[a-z0-9_]{2,60}$'),
  est_cost_paise bigint not null default 0 check (est_cost_paise >= 0),
  cost_paise     bigint not null default 0 check (cost_paise >= 0),
  state          text not null default 'planned' check (state in ('planned', 'approved', 'done', 'failed', 'cancelled')),
  found          integer not null default 0 check (found >= 0),
  counts         jsonb check (counts is null or jsonb_typeof(counts) = 'object'),
  source_label   text not null check (char_length(source_label) <= 240),
  created_by     uuid,
  created_at     timestamptz not null default now(),
  approved_at    timestamptz,
  finished_at    timestamptz,
  unique (tenant_id, id)
);
comment on table public.prospect_searches is 'Lead Finder: one search the assistant planned, the Owner approved and the finder ran (a fixture for demo workspaces, Google Places for the Owner Test workspace). Written only by the lead finder functions.';
comment on column public.prospect_searches.query is 'PII: the words of the search, which may name a place or a person. Erased with the workspace. CLEAN-EXEMPT: length CHECK, written only by the search function';
comment on column public.prospect_searches.area is 'PII: the area searched. Erased with the workspace. CLEAN-EXEMPT: length CHECK, written only by the search function';
comment on column public.prospect_searches.category_hint is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.prospect_searches.provider is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.prospect_searches.sku is 'SAFE: the name of the Google Places SKU the search bills (or fixture). CLEAN-EXEMPT: pattern CHECK';
comment on column public.prospect_searches.state is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.prospect_searches.counts is 'SAFE: counts only (found, call_ready, needs_owner, skipped, duplicates). CLEAN-EXEMPT: validated document of numbers';
comment on column public.prospect_searches.source_label is 'PII: where the prospects came from, in words ("Google Maps search ''saree shops Jayanagar'', 2 Nov"). Erased with the workspace. CLEAN-EXEMPT: length CHECK';
comment on column public.prospect_searches.created_by is 'SAFE: the id of the member. CLEAN-EXEMPT: uuid';
create index prospect_searches_tenant_idx on public.prospect_searches (tenant_id, created_at desc, id);
create index prospect_searches_day_idx on public.prospect_searches (tenant_id, approved_at) where approved_at is not null;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- prospects
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.prospects (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete restrict,
  search_id         uuid,
  name              text not null check (char_length(name) between 1 and 200),
  name_key          text not null check (char_length(name_key) <= 200),
  category          text check (char_length(category) <= 80),
  area              text check (char_length(area) <= 160),
  lat               numeric(9, 6) check (lat between -90 and 90),
  lng               numeric(9, 6) check (lng between -180 and 180),
  phone             text check (phone is null or phone ~ '^\+?[0-9 ()-]{6,20}$'),
  phone_key         text check (phone_key is null or phone_key ~ '^[0-9]{6,15}$'),
  website           text check (char_length(website) <= 300),
  rating            numeric(2, 1) check (rating between 0 and 5),
  review_count      integer check (review_count >= 0),
  source            text not null check (source in ('google_maps', 'fixture')),
  source_label      text not null check (char_length(source_label) <= 240),
  place_id          text not null check (place_id ~ '^[A-Za-z0-9_.:-]{3,200}$'),
  fetched_at        timestamptz not null default now(),
  status            text not null default 'new' check (status in ('new', 'researching', 'call_ready', 'needs_owner', 'skipped', 'contacted', 'qualified', 'not_interested')),
  decision_reason   text check (decision_reason in ('fit_high', 'fit_middle', 'fit_low', 'first_calls', 'low_stock', 'no_stock_match', 'very_large', 'competitor', 'not_a_buyer', 'suppressed', 'contacted_recently', 'outside_hours', 'daily_cap', 'owner_approved', 'owner_skipped', 'asked_later', 'no_phone')),
  fit_score         integer check (fit_score between 0 and 100),
  fit_reason        text check (char_length(fit_reason) <= 300),
  stock_match       jsonb check (stock_match is null or jsonb_typeof(stock_match) = 'object'),
  owner_approved    boolean not null default false,
  suppressed        boolean not null default false,
  ask_after         timestamptz,
  last_contacted_at timestamptz,
  call_id           uuid,
  qualification     jsonb check (qualification is null or jsonb_typeof(qualification) = 'object'),
  lead_id           uuid,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, place_id),
  foreign key (tenant_id, search_id) references public.prospect_searches (tenant_id, id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id)
);
comment on table public.prospects is 'Lead Finder: a business the assistant found and may call to ask what it needs. Not a lead until a call qualifies it. Written only by the lead finder functions.';
comment on column public.prospects.name is 'PII: the business name (it may be a person''s name). Erased with the workspace. CLEAN-EXEMPT: length CHECK, written by the finder only, never read by a model';
comment on column public.prospects.name_key is 'PII: the comparison form of the name, for finding the same business twice. Erased with the workspace. CLEAN-EXEMPT: length CHECK';
comment on column public.prospects.category is 'SAFE: the kind of business as the source names it ("Saree shop"). CLEAN-EXEMPT: length CHECK';
comment on column public.prospects.area is 'PII: the neighbourhood. Erased with the workspace. CLEAN-EXEMPT: length CHECK';
comment on column public.prospects.lat is 'SAFE: the business''s place on the map (a shop, not a home address). CLEAN-EXEMPT: range CHECK';
comment on column public.prospects.lng is 'SAFE: the business''s place on the map. CLEAN-EXEMPT: range CHECK';
comment on column public.prospects.phone is 'PII: the business telephone number. Erased with the workspace. CLEAN-EXEMPT: pattern CHECK';
comment on column public.prospects.phone_key is 'PII: the digits of the number, for finding the same business twice. Erased with the workspace. CLEAN-EXEMPT: pattern CHECK';
comment on column public.prospects.website is 'SAFE: the business''s public web address. CLEAN-EXEMPT: length CHECK, never fetched by a model';
comment on column public.prospects.rating is 'SAFE: a star rating. CLEAN-EXEMPT: range CHECK';
comment on column public.prospects.review_count is 'SAFE: a number. CLEAN-EXEMPT: range CHECK';
comment on column public.prospects.source is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.prospects.source_label is 'PII: where it came from, in words. Erased with the workspace. CLEAN-EXEMPT: length CHECK';
comment on column public.prospects.place_id is 'SAFE: the source''s id of the place (Google''s place_id may be kept for good under its terms). CLEAN-EXEMPT: pattern CHECK';
comment on column public.prospects.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.prospects.decision_reason is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.prospects.fit_reason is 'SAFE: one line written from the score and the stock match, with no personal data. CLEAN-EXEMPT: length CHECK, built by code from closed words';
comment on column public.prospects.stock_match is 'SAFE: names of our own catalogue items and a yes or no. CLEAN-EXEMPT: validated document';
comment on column public.prospects.qualification is 'PII: what the business said on the call (what it sells, quantities, timing). Erased with the workspace. CLEAN-EXEMPT: a validated document, never read by a model';
create index prospects_tenant_idx on public.prospects (tenant_id, created_at desc, id);
create index prospects_status_idx on public.prospects (tenant_id, status, fit_score desc nulls last);
create index prospects_search_idx on public.prospects (tenant_id, search_id);
create index prospects_lead_idx on public.prospects (tenant_id, lead_id) where lead_id is not null;
create index prospects_phone_idx on public.prospects (tenant_id, phone_key) where phone_key is not null;

do $$
declare
  t text;
begin
  foreach t in array array['lead_finder_settings', 'prospect_searches', 'prospects'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format('create trigger %I before update on public.%I for each row execute function app.forbid_tenant_id_change()', t || '_forbid_tenant_id_change', t);
  end loop;
end $$;
create policy lead_finder_settings_select on public.lead_finder_settings for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));
create policy prospect_searches_select on public.prospect_searches for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));
create policy prospects_select on public.prospects for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));
create trigger audit_lead_finder_settings after insert or update or delete on public.lead_finder_settings for each row execute function app.audit_row_change('lead_finder_settings', '');
create trigger audit_prospect_searches after insert or update or delete on public.prospect_searches for each row execute function app.audit_row_change('prospect_search', 'query,area,source_label');
create trigger audit_prospects after insert or update or delete on public.prospects for each row execute function app.audit_row_change('prospect', 'name,name_key,area,phone,phone_key,source_label,qualification');

insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('prospect_searches', 'query',        'tenant', 'tombstone', 'erased:1'),
  ('prospect_searches', 'query',        'sweep',  'substring', 'erased:1'),
  ('prospect_searches', 'area',         'tenant', 'null',      'erased:1'),
  ('prospect_searches', 'area',         'sweep',  'substring', 'erased:1'),
  ('prospect_searches', 'source_label', 'tenant', 'tombstone', 'erased:1'),
  ('prospect_searches', 'source_label', 'sweep',  'substring', 'erased:1'),
  ('prospects', 'name',         'tenant', 'tombstone', 'erased:1'),
  ('prospects', 'name',         'sweep',  'substring', 'erased:1'),
  ('prospects', 'name_key',     'tenant', 'tombstone', 'erased:1'),
  ('prospects', 'name_key',     'sweep',  'substring', 'erased:1'),
  ('prospects', 'area',         'tenant', 'null',      'erased:1'),
  ('prospects', 'area',         'sweep',  'substring', 'erased:1'),
  ('prospects', 'phone',        'tenant', 'null',      'erased:1'),
  ('prospects', 'phone',        'sweep',  'substring', 'erased:1'),
  ('prospects', 'phone_key',    'tenant', 'null',      'erased:1'),
  ('prospects', 'phone_key',    'sweep',  'substring', 'erased:1'),
  ('prospects', 'source_label', 'tenant', 'tombstone', 'erased:1'),
  ('prospects', 'source_label', 'sweep',  'substring', 'erased:1'),
  ('prospects', 'qualification', 'tenant', 'null',     'erased:1');

-- the call result and the suppression never move backwards: a suppressed business stays suppressed (until the Owner's erasure runs)
create function app.prospects_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    if app.erasure_running(old.tenant_id) then
      return old;
    end if;
    raise exception 'prospects are never deleted' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.suppressed and not new.suppressed and not app.erasure_running(old.tenant_id) then
      raise exception 'a suppressed business stays suppressed' using errcode = 'SM973';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;
revoke all on function app.prospects_guard() from public, anon, authenticated, service_role;
create trigger prospects_guard before update or delete on public.prospects for each row execute function app.prospects_guard();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- who may do what
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.lf_gate(p_tenant_id uuid, p_roles public.app_role[]) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, p_roles) then
    perform app.lf_error('deny');
  end if;
  if not app.module_enabled(p_tenant_id, 'lead_finder') then
    perform app.lf_error('module');
  end if;
end;
$$;
revoke all on function app.lf_gate(uuid, public.app_role[]) from public, anon, authenticated, service_role;

create function app.lf_settings_json(s public.lead_finder_settings) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('fit_bar', s.fit_bar, 'daily_call_cap', s.daily_call_cap, 'call_from_hour', s.call_from_hour, 'call_to_hour', s.call_to_hour,
                            'searches_per_day', s.searches_per_day, 'results_per_search', s.results_per_search, 'updated_at', s.updated_at)
$$;
revoke all on function app.lf_settings_json(public.lead_finder_settings) from public, anon, authenticated, service_role;

create function public.lead_finder_settings_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.lead_finder_settings;
begin
  perform app.lf_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  select * into s from public.lead_finder_settings x where x.tenant_id = p_tenant_id;
  if not found then
    s := row(p_tenant_id, 70, 20, 10, 19, 5, 20, null, now())::public.lead_finder_settings;
  end if;
  return app.lf_settings_json(s);
end;
$$;
revoke all on function public.lead_finder_settings_get(uuid) from public, anon;
grant execute on function public.lead_finder_settings_get(uuid) to authenticated;

create function public.lead_finder_settings_set(p_tenant_id uuid, p_settings jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.lead_finder_settings;
  k text;
begin
  perform app.lf_gate(p_tenant_id, array['owner', 'admin']::public.app_role[]);
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    perform app.lf_error('invalid');
  end if;
  for k in select jsonb_object_keys(p_settings) loop
    if k not in ('fit_bar', 'daily_call_cap', 'call_from_hour', 'call_to_hour', 'searches_per_day', 'results_per_search') then
      perform app.lf_error('invalid');
    end if;
  end loop;
  insert into public.lead_finder_settings (tenant_id) values (p_tenant_id) on conflict do nothing;
  begin
    update public.lead_finder_settings x set
      fit_bar            = coalesce((p_settings ->> 'fit_bar')::integer, x.fit_bar),
      daily_call_cap     = coalesce((p_settings ->> 'daily_call_cap')::integer, x.daily_call_cap),
      call_from_hour     = coalesce((p_settings ->> 'call_from_hour')::integer, x.call_from_hour),
      call_to_hour       = coalesce((p_settings ->> 'call_to_hour')::integer, x.call_to_hour),
      searches_per_day   = coalesce((p_settings ->> 'searches_per_day')::integer, x.searches_per_day),
      results_per_search = coalesce((p_settings ->> 'results_per_search')::integer, x.results_per_search),
      updated_by = auth.uid(), updated_at = now()
     where x.tenant_id = p_tenant_id returning * into s;
  exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
    perform app.lf_error('invalid');
  end;
  return app.lf_settings_json(s);
end;
$$;
revoke all on function public.lead_finder_settings_set(uuid, jsonb) from public, anon;
grant execute on function public.lead_finder_settings_set(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- searches: plan -> approve -> finish
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.lf_search_json(x public.prospect_searches) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', x.id, 'query', x.query, 'area', x.area, 'category_hint', x.category_hint, 'max_results', x.max_results, 'provider', x.provider, 'sku', x.sku,
    'est_cost_paise', x.est_cost_paise, 'cost_paise', x.cost_paise, 'state', x.state, 'found', x.found, 'counts', x.counts, 'source_label', x.source_label,
    'created_at', x.created_at, 'approved_at', x.approved_at, 'finished_at', x.finished_at)
$$;
revoke all on function app.lf_search_json(public.prospect_searches) from public, anon, authenticated, service_role;

-- the number of searches approved since midnight India time
create function app.lf_searches_today(p_tenant_id uuid) returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer from public.prospect_searches s
   where s.tenant_id = p_tenant_id and s.approved_at is not null and s.state <> 'cancelled'
     and (s.approved_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date
$$;
revoke all on function app.lf_searches_today(uuid) from public, anon, authenticated, service_role;

create function public.prospect_search_plan(p_tenant_id uuid, p_id uuid, p_query text, p_area text, p_category_hint text, p_max_results integer, p_provider text, p_sku text, p_est_cost_paise bigint, p_source_label text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.prospect_searches;
  s public.lead_finder_settings;
begin
  perform app.lf_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  if p_id is null or p_query is null or char_length(btrim(p_query)) not between 2 and 200 or p_provider is null or p_provider not in ('fixture', 'places') or p_sku is null
     or p_max_results is null or p_est_cost_paise is null or p_est_cost_paise < 0 or p_source_label is null or char_length(p_source_label) > 240 or not app.text_is_clean(p_query)
     or (p_area is not null and (char_length(p_area) > 120 or not app.text_is_clean(p_area))) then
    perform app.lf_error('invalid');
  end if;
  select * into s from public.lead_finder_settings z where z.tenant_id = p_tenant_id;
  if found and p_max_results > s.results_per_search then
    perform app.lf_error('invalid');
  end if;
  select * into x from public.prospect_searches z where z.tenant_id = p_tenant_id and z.id = p_id;
  if found then
    return app.lf_search_json(x);   -- the same plan again: replayed
  end if;
  begin
    insert into public.prospect_searches (id, tenant_id, query, area, category_hint, max_results, provider, sku, est_cost_paise, source_label, created_by)
    values (p_id, p_tenant_id, btrim(p_query), nullif(btrim(coalesce(p_area, '')), ''), p_category_hint, p_max_results, p_provider, p_sku, p_est_cost_paise, p_source_label, auth.uid())
    returning * into x;
  exception when check_violation then
    perform app.lf_error('invalid');
  end;
  return app.lf_search_json(x);
end;
$$;
revoke all on function public.prospect_search_plan(uuid, uuid, text, text, text, integer, text, text, bigint, text) from public, anon;
grant execute on function public.prospect_search_plan(uuid, uuid, text, text, text, integer, text, text, bigint, text) to authenticated;

-- the Owner's yes: counts against the day's cap; the same yes again changes nothing
create function public.prospect_search_approve(p_tenant_id uuid, p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.prospect_searches;
  s public.lead_finder_settings;
  v_cap integer := 5;
begin
  perform app.lf_gate(p_tenant_id, array['owner', 'admin']::public.app_role[]);
  perform pg_advisory_xact_lock(hashtextextended('lead_finder:' || p_tenant_id::text, 0));
  select * into x from public.prospect_searches z where z.tenant_id = p_tenant_id and z.id = p_id for update;
  if not found then
    perform app.lf_error('reference');
  end if;
  if x.state <> 'planned' then
    if x.state in ('approved', 'done') then
      return app.lf_search_json(x);
    end if;
    perform app.lf_error('state');
  end if;
  select * into s from public.lead_finder_settings z where z.tenant_id = p_tenant_id;
  if found then
    v_cap := s.searches_per_day;
  end if;
  if app.lf_searches_today(p_tenant_id) >= v_cap then
    perform app.lf_error('cap');
  end if;
  update public.prospect_searches z set state = 'approved', approved_at = now() where z.tenant_id = p_tenant_id and z.id = p_id returning * into x;
  return app.lf_search_json(x);
end;
$$;
revoke all on function public.prospect_search_approve(uuid, uuid) from public, anon;
grant execute on function public.prospect_search_approve(uuid, uuid) to authenticated;

create function public.prospect_search_cancel(p_tenant_id uuid, p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.prospect_searches;
begin
  perform app.lf_gate(p_tenant_id, array['owner', 'admin']::public.app_role[]);
  update public.prospect_searches z set state = 'cancelled' where z.tenant_id = p_tenant_id and z.id = p_id and z.state = 'planned' returning * into x;
  if not found then
    perform app.lf_error(case when exists (select 1 from public.prospect_searches z where z.tenant_id = p_tenant_id and z.id = p_id) then 'state' else 'reference' end);
  end if;
  return app.lf_search_json(x);
end;
$$;
revoke all on function public.prospect_search_cancel(uuid, uuid) from public, anon;
grant execute on function public.prospect_search_cancel(uuid, uuid) to authenticated;

create function public.prospect_searches_list(p_tenant_id uuid, p_limit integer default 20) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.lf_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  return coalesce((select jsonb_agg(app.lf_search_json(z) order by z.created_at desc, z.id) from (
    select * from public.prospect_searches s where s.tenant_id = p_tenant_id order by s.created_at desc, s.id limit least(greatest(coalesce(p_limit, 20), 1), 100)) z), '[]'::jsonb);
end;
$$;
revoke all on function public.prospect_searches_list(uuid, integer) from public, anon;
grant execute on function public.prospect_searches_list(uuid, integer) to authenticated;

create function public.prospect_search_get(p_tenant_id uuid, p_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  x public.prospect_searches;
begin
  perform app.lf_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  select * into x from public.prospect_searches z where z.tenant_id = p_tenant_id and z.id = p_id;
  if not found then
    perform app.lf_error('reference');
  end if;
  return app.lf_search_json(x);
end;
$$;
revoke all on function public.prospect_search_get(uuid, uuid) from public, anon;
grant execute on function public.prospect_search_get(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- what the finder must know to dedupe and to decide: the people already ours, the businesses already found, the day's counts
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.prospect_context(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  perform app.lf_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  return jsonb_build_object(
    'customers', coalesce((select jsonb_agg(jsonb_build_object('phone_key', app.phone_norm(c.phone), 'name', c.full_name)) from (
        select * from public.contacts k where k.tenant_id = p_tenant_id and k.erased_at is null and k.archived_at is null order by k.created_at desc limit 5000) c), '[]'::jsonb),
    'companies', coalesce((select jsonb_agg(jsonb_build_object('name', co.name)) from (
        select * from public.companies z where z.tenant_id = p_tenant_id order by z.created_at desc limit 5000) co), '[]'::jsonb),
    'prospects', coalesce((select jsonb_agg(jsonb_build_object('place_id', p.place_id, 'phone_key', p.phone_key, 'name_key', p.name_key, 'area', p.area, 'suppressed', p.suppressed,
                                                                'last_contacted_at', p.last_contacted_at)) from (
        select * from public.prospects z where z.tenant_id = p_tenant_id order by z.created_at desc limit 5000) p), '[]'::jsonb),
    'real_data_open', app.real_data_gate_open(p_tenant_id),
    'approved_by_search', coalesce((select jsonb_object_agg(z.search_id, z.n) from (
        select p.search_id, count(*) as n from public.prospects p where p.tenant_id = p_tenant_id and p.owner_approved and p.search_id is not null group by p.search_id) z), '{}'::jsonb),
    'ready_waiting', (select count(*) from public.prospects z where z.tenant_id = p_tenant_id and z.status = 'call_ready'),
    'searches_today', app.lf_searches_today(p_tenant_id),
    'calls_today', (select count(*) from public.prospects z where z.tenant_id = p_tenant_id and z.last_contacted_at is not null and (z.last_contacted_at at time zone 'Asia/Kolkata')::date = v_today));
end;
$$;
revoke all on function public.prospect_context(uuid) from public, anon;
grant execute on function public.prospect_context(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the finder's results: prospects with their decisions (computed by code, checked here)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.lf_prospect_json(x public.prospects) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', x.id, 'search_id', x.search_id, 'name', x.name, 'category', x.category, 'area', x.area, 'lat', x.lat, 'lng', x.lng, 'phone', x.phone, 'website', x.website,
    'rating', x.rating, 'review_count', x.review_count, 'source', x.source, 'source_label', x.source_label, 'place_id', x.place_id, 'fetched_at', x.fetched_at, 'status', x.status,
    'decision_reason', x.decision_reason, 'fit_score', x.fit_score, 'fit_reason', x.fit_reason, 'stock_match', x.stock_match, 'owner_approved', x.owner_approved, 'suppressed', x.suppressed,
    'ask_after', x.ask_after, 'last_contacted_at', x.last_contacted_at, 'lead_id', x.lead_id, 'qualification', x.qualification, 'created_at', x.created_at, 'updated_at', x.updated_at)
$$;
revoke all on function app.lf_prospect_json(public.prospects) from public, anon, authenticated, service_role;

-- p_items: up to 20 objects {place_id, name, name_key, category, area, lat, lng, phone, phone_key, website, rating, review_count, status, decision_reason, fit_score, fit_reason, stock_match};
-- a place the workspace already holds is left as it is (the unique key), so a repeated or overlapping search never duplicates or revives a suppressed business
create function public.prospect_search_finish(p_tenant_id uuid, p_id uuid, p_items jsonb, p_state text, p_cost_paise bigint, p_counts jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  x       public.prospect_searches;
  v_item  jsonb;
  v_n     integer := 0;
begin
  perform app.lf_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 20 or p_state is null or p_state not in ('done', 'failed')
     or p_cost_paise is null or p_cost_paise < 0 or (p_counts is not null and jsonb_typeof(p_counts) <> 'object') then
    perform app.lf_error('invalid');
  end if;
  select * into x from public.prospect_searches z where z.tenant_id = p_tenant_id and z.id = p_id for update;
  if not found then
    perform app.lf_error('reference');
  end if;
  if x.state = 'done' then
    return app.lf_search_json(x);   -- the same result again: replayed
  end if;
  if x.state <> 'approved' then
    perform app.lf_error('state');
  end if;
  if jsonb_array_length(p_items) > x.max_results then
    perform app.lf_error('invalid');
  end if;
  -- hard rule 1: real businesses (Google Places) only where the real-data gate is open (the Owner Test workspace); everywhere else only synthetic "+00" numbers
  if x.provider = 'places' and not app.real_data_gate_open(p_tenant_id) then
    perform app.lf_error('deny');
  end if;
  if not app.real_data_gate_open(p_tenant_id) and exists (select 1 from jsonb_array_elements(p_items) e where coalesce(e ->> 'phone', '') <> '' and (e ->> 'phone') !~ '^\+\s*00') then
    perform app.lf_error('invalid');
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      insert into public.prospects (tenant_id, search_id, name, name_key, category, area, lat, lng, phone, phone_key, website, rating, review_count, source, source_label, place_id,
                                    status, decision_reason, fit_score, fit_reason, stock_match, created_by)
      values (p_tenant_id, p_id, left(btrim(v_item ->> 'name'), 200), left(coalesce(v_item ->> 'name_key', ''), 200), left(v_item ->> 'category', 80), left(v_item ->> 'area', 160),
              (v_item ->> 'lat')::numeric, (v_item ->> 'lng')::numeric, nullif(v_item ->> 'phone', ''), nullif(v_item ->> 'phone_key', ''), left(v_item ->> 'website', 300),
              (v_item ->> 'rating')::numeric, (v_item ->> 'review_count')::integer, case when x.provider = 'places' then 'google_maps' else 'fixture' end, x.source_label, v_item ->> 'place_id',
              coalesce(v_item ->> 'status', 'new'), v_item ->> 'decision_reason', (v_item ->> 'fit_score')::integer, left(v_item ->> 'fit_reason', 300),
              case when jsonb_typeof(v_item -> 'stock_match') = 'object' then v_item -> 'stock_match' end, auth.uid())
      on conflict (tenant_id, place_id) do nothing;
      if found then
        v_n := v_n + 1;
      end if;
    exception when check_violation or invalid_text_representation or numeric_value_out_of_range or not_null_violation then
      perform app.lf_error('invalid');
    end;
  end loop;
  update public.prospect_searches z set state = p_state, found = v_n, cost_paise = p_cost_paise, counts = p_counts, finished_at = now() where z.tenant_id = p_tenant_id and z.id = p_id returning * into x;
  return app.lf_search_json(x);
end;
$$;
revoke all on function public.prospect_search_finish(uuid, uuid, jsonb, text, bigint, jsonb) from public, anon;
grant execute on function public.prospect_search_finish(uuid, uuid, jsonb, text, bigint, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- reading
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.prospects_list(p_tenant_id uuid, p_status text default null, p_search_id uuid default null, p_limit integer default 50, p_before_score integer default null, p_before_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.lf_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  if p_status is not null and p_status not in ('new', 'researching', 'call_ready', 'needs_owner', 'skipped', 'contacted', 'qualified', 'not_interested') then
    perform app.lf_error('invalid');
  end if;
  return coalesce((select jsonb_agg(app.lf_prospect_json(z) order by z.fit_score desc nulls last, z.id) from (
    select * from public.prospects p
     where p.tenant_id = p_tenant_id and (p_status is null or p.status = p_status) and (p_search_id is null or p.search_id = p_search_id)
       and (p_before_score is null or (coalesce(p.fit_score, -1), p.id) < (p_before_score, coalesce(p_before_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid)))
     order by p.fit_score desc nulls last, p.id desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) z), '[]'::jsonb);
end;
$$;
revoke all on function public.prospects_list(uuid, text, uuid, integer, integer, uuid) from public, anon;
grant execute on function public.prospects_list(uuid, text, uuid, integer, integer, uuid) to authenticated;

create function public.prospect_get(p_tenant_id uuid, p_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  x public.prospects;
begin
  perform app.lf_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  select * into x from public.prospects z where z.tenant_id = p_tenant_id and z.id = p_id;
  if not found then
    perform app.lf_error('reference');
  end if;
  return app.lf_prospect_json(x);
end;
$$;
revoke all on function public.prospect_get(uuid, uuid) from public, anon;
grant execute on function public.prospect_get(uuid, uuid) to authenticated;

create function public.prospect_stats(p_tenant_id uuid, p_search_id uuid default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.lf_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  return jsonb_build_object(
    'total', (select count(*) from public.prospects p where p.tenant_id = p_tenant_id and (p_search_id is null or p.search_id = p_search_id)),
    'by_status', coalesce((select jsonb_object_agg(s.status, s.n) from (
        select p.status, count(*) as n from public.prospects p where p.tenant_id = p_tenant_id and (p_search_id is null or p.search_id = p_search_id) group by p.status) s), '{}'::jsonb));
end;
$$;
revoke all on function public.prospect_stats(uuid, uuid) from public, anon;
grant execute on function public.prospect_stats(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- decisions re-computed by code (hours passed, the cap changed): only a prospect that is not finished may move, and never out of suppression
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.prospect_decisions_apply(p_tenant_id uuid, p_items jsonb) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_n    integer := 0;
begin
  perform app.lf_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 200 then
    perform app.lf_error('invalid');
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    begin
      update public.prospects z set status = v_item ->> 'status', decision_reason = v_item ->> 'decision_reason', fit_score = (v_item ->> 'fit_score')::integer, fit_reason = left(v_item ->> 'fit_reason', 300),
             stock_match = case when jsonb_typeof(v_item -> 'stock_match') = 'object' then v_item -> 'stock_match' else z.stock_match end
       where z.tenant_id = p_tenant_id and z.id = (v_item ->> 'id')::uuid and z.status in ('new', 'researching', 'call_ready', 'needs_owner', 'skipped') and not z.suppressed
         and (v_item ->> 'status') in ('researching', 'call_ready', 'needs_owner', 'skipped');
      if found then
        v_n := v_n + 1;
      end if;
    exception when check_violation or invalid_text_representation or numeric_value_out_of_range then
      perform app.lf_error('invalid');
    end;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.prospect_decisions_apply(uuid, jsonb) from public, anon;
grant execute on function public.prospect_decisions_apply(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the Owner's answers: call, ask me later, skip, not interested, do not call
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.prospect_act(p_tenant_id uuid, p_id uuid, p_action text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.prospects;
begin
  perform app.lf_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  if p_action is null or p_action not in ('call', 'later', 'skip', 'not_interested', 'do_not_call') then
    perform app.lf_error('invalid');
  end if;
  select * into x from public.prospects z where z.tenant_id = p_tenant_id and z.id = p_id for update;
  if not found then
    perform app.lf_error('reference');
  end if;
  if p_action in ('not_interested', 'do_not_call') then
    update public.prospects z set status = 'not_interested', suppressed = true, decision_reason = 'suppressed' where z.id = x.id returning * into x;
    return app.lf_prospect_json(x);
  end if;
  if x.suppressed or x.status in ('contacted', 'qualified', 'not_interested') then
    perform app.lf_error('state');
  end if;
  if p_action = 'call' then
    if x.phone is null then
      perform app.lf_error('state');
    end if;
    update public.prospects z set status = 'call_ready', owner_approved = true, decision_reason = 'owner_approved', ask_after = null where z.id = x.id returning * into x;
  elsif p_action = 'later' then
    update public.prospects z set status = 'needs_owner', decision_reason = 'asked_later', ask_after = now() + interval '1 day' where z.id = x.id returning * into x;
  else
    update public.prospects z set status = 'skipped', decision_reason = 'owner_skipped' where z.id = x.id returning * into x;
  end if;
  return app.lf_prospect_json(x);
end;
$$;
revoke all on function public.prospect_act(uuid, uuid, text) from public, anon;
grant execute on function public.prospect_act(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the result of a qualifying call. 'qualified' makes (or finds) a Lead Desk lead with the source "lead_finder"; 'not_interested' and 'do_not_call' suppress for good
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.prospect_call_finish(p_tenant_id uuid, p_id uuid, p_call_id uuid, p_result text, p_qualification jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  x       public.prospects;
  v_out   jsonb;
  v_lead  uuid;
  v_ext   text;
begin
  perform app.lf_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  if p_result is null or p_result not in ('qualified', 'contacted', 'not_interested', 'do_not_call') or (p_qualification is not null and (jsonb_typeof(p_qualification) <> 'object' or octet_length(p_qualification::text) > 8000)) then
    perform app.lf_error('invalid');
  end if;
  select * into x from public.prospects z where z.tenant_id = p_tenant_id and z.id = p_id for update;
  if not found then
    perform app.lf_error('reference');
  end if;
  if x.status in ('qualified', 'not_interested', 'contacted') and x.call_id is not distinct from p_call_id and p_call_id is not null then
    return app.lf_prospect_json(x);   -- the same result again: replayed
  end if;
  if x.suppressed or x.status not in ('call_ready') then
    perform app.lf_error('state');
  end if;
  if p_result in ('not_interested', 'do_not_call') then
    update public.prospects z set status = 'not_interested', suppressed = true, decision_reason = 'suppressed', last_contacted_at = now(), call_id = p_call_id, qualification = p_qualification where z.id = x.id returning * into x;
    return app.lf_prospect_json(x);
  end if;
  if p_result = 'contacted' then
    update public.prospects z set status = 'contacted', last_contacted_at = now(), call_id = p_call_id, qualification = p_qualification where z.id = x.id returning * into x;
    return app.lf_prospect_json(x);
  end if;
  -- qualified: a lead in the Lead Desk, source lead_finder (the lead is a normal one: consent, hours and the opt-out lists still apply to any message to it)
  v_ext := 'prospect:' || x.id::text;
  v_out := app.lead_intake_core(p_tenant_id, auth.uid(), 'lead_finder', null,
             jsonb_build_array(jsonb_build_object('name', x.name, 'phone', x.phone, 'city', x.area, 'message', left(coalesce(p_qualification ->> 'summary', ''), 900), 'external_id', v_ext)), false);
  select i.lead_id into v_lead from integrations.lead_items i where i.tenant_id = p_tenant_id and i.source_tag = 'lead_finder' and i.external_id = v_ext;
  if v_lead is null then
    perform app.lf_error('state');   -- the lead could not be made (a bad number, an opt-out): nothing changes
  end if;
  update public.prospects z set status = 'qualified', last_contacted_at = now(), call_id = p_call_id, qualification = p_qualification, lead_id = v_lead where z.id = x.id returning * into x;
  return app.lf_prospect_json(x);
end;
$$;
revoke all on function public.prospect_call_finish(uuid, uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.prospect_call_finish(uuid, uuid, uuid, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- Google Maps terms: what came from Google other than its place_id is not kept past 30 days (the scheduler runs this daily; the details are fetched again by place_id when a call is due)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.prospect_places_expire(p_max_age_days integer default 30) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if auth.uid() is null or not app.is_scheduler() then
    perform app.lf_error('deny');
  end if;
  if p_max_age_days is null or p_max_age_days not between 1 and 30 then
    perform app.lf_error('invalid');
  end if;
  update public.prospects z set name = 'Business (details expired)', name_key = '', phone = null, phone_key = null, website = null, rating = null, review_count = null, lat = null, lng = null, area = null,
         category = null, status = case when z.status in ('call_ready', 'needs_owner', 'new', 'researching') then 'skipped' else z.status end,
         decision_reason = case when z.status in ('call_ready', 'needs_owner', 'new', 'researching') then 'no_phone' else z.decision_reason end
   where z.source = 'google_maps' and z.fetched_at < now() - make_interval(days => p_max_age_days) and z.name <> 'Business (details expired)'
     and z.status not in ('qualified');
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.prospect_places_expire(integer) from public, anon;
grant execute on function public.prospect_places_expire(integer) to authenticated;
