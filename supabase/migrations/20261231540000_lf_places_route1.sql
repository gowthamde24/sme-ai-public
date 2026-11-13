-- LEAD FINDER, GOOGLE PLACES ROUTE 1 (owner decision 12 Nov 2026; plan docs/plans/lead-finder-places-storage.md; ADR 0119 addendum). From Google Places we keep only the PLACE ID (for good) and the
-- COORDINATES (at most 30 days). Name, category, address, phone, website, rating and review count are fetched fresh by place ID when a prospect is shown or called, used in memory, never saved.
--   * the existing Google rows (the Owner Test workspace only; no real customer data exists) are blanked here
--   * a CHECK keeps those columns null for a 'google_maps' row, whoever writes it
--   * prospect_search_finish drops them for a Places search (the caller is not trusted with it)
--   * prospect_places_expire now clears the coordinates after 30 days (the rest is never stored); the status of the prospect is left alone
-- The fixture source (invented businesses, demo workspaces) keeps storing everything.

update public.prospects set name = null, name_key = null, category = null, area = null, phone = null, phone_key = null, website = null, rating = null, review_count = null
 where source = 'google_maps';

alter table public.prospects alter column name drop not null;
alter table public.prospects alter column name_key drop not null;
alter table public.prospects add constraint prospects_google_route1_check check (
  source <> 'google_maps' or (name is null and name_key is null and category is null and area is null and phone is null and phone_key is null and website is null and rating is null and review_count is null));
-- (a fixture row still carries a name: an unnamed fixture prospect would be a bug)
alter table public.prospects add constraint prospects_fixture_named_check check (source <> 'fixture' or (name is not null and name_key is not null));

comment on column public.prospects.name is 'PII: the business name of a FIXTURE (invented) prospect; always null for google_maps (route 1: fetched fresh by place ID, never saved). Erased with the workspace. CLEAN-EXEMPT: length CHECK, written by the finder only, never read by a model';
comment on column public.prospects.lat is 'SAFE: the business''s place on the map (a shop, not a home address); for google_maps cleared after 30 days (prospect_places_expire). CLEAN-EXEMPT: range CHECK';

create or replace function public.prospect_search_finish(p_tenant_id uuid, p_id uuid, p_items jsonb, p_state text, p_cost_paise bigint, p_counts jsonb) returns jsonb
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
                                    status, decision_reason, fit, fit_reason, stock_match, created_by)
      -- ROUTE 1 (owner, 12 Nov 2026): from Google Places only the place ID (for good), the coordinates (30 days) and OUR decision are kept. Whatever else the item carries is dropped here, not trusted to the caller.
      values (p_tenant_id, p_id,
              case when x.provider = 'places' then null else left(btrim(v_item ->> 'name'), 200) end,
              case when x.provider = 'places' then null else left(coalesce(v_item ->> 'name_key', ''), 200) end,
              case when x.provider = 'places' then null else left(v_item ->> 'category', 80) end,
              case when x.provider = 'places' then null else left(v_item ->> 'area', 160) end,
              (v_item ->> 'lat')::numeric, (v_item ->> 'lng')::numeric,
              case when x.provider = 'places' then null else nullif(v_item ->> 'phone', '') end,
              case when x.provider = 'places' then null else nullif(v_item ->> 'phone_key', '') end,
              case when x.provider = 'places' then null else left(v_item ->> 'website', 300) end,
              case when x.provider = 'places' then null else (v_item ->> 'rating')::numeric end,
              case when x.provider = 'places' then null else (v_item ->> 'review_count')::integer end,
              case when x.provider = 'places' then 'google_maps' else 'fixture' end, x.source_label, v_item ->> 'place_id',
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

-- the coordinates from Google may be kept 30 days, nothing else is ever stored (route 1); the scheduler runs this daily
create or replace function public.prospect_places_expire(p_max_age_days integer default 30) returns integer
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
  update public.prospects z set lat = null, lng = null
   where z.source = 'google_maps' and z.fetched_at < now() - make_interval(days => p_max_age_days) and (z.lat is not null or z.lng is not null);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function public.prospect_places_expire(integer) from public, anon;
grant execute on function public.prospect_places_expire(integer) to authenticated;
