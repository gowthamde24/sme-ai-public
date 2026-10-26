-- Job DS (night run 27 Oct, owner feedback 26 Oct): HOW THE ASSISTANT TALKS. A speaking style per workspace and per language, and for Telugu, Tamil and Kannada an optional region.
--
--   public.speaking_styles               one row per workspace and language that the Owner set; no row = the default (everyday_mixed, neutral)
--   public.speaking_style_get / _set     every member of the workspace reads it (the prompts need it); the Owner (second factor) sets all languages at once
--
-- Styles: everyday_mixed (default: how people talk, with the English words people use), everyday_pure (spoken, fewer English words), formal (written register; only if the Owner wants it).
-- Regions: te neutral | coastal | telangana | rayalaseema; ta neutral | chennai | kongu; kn neutral | bengaluru | north_karnataka; the other languages: neutral only.
-- Nothing here is personal data. SQLSTATEs: 22023 invalid, 42501 not allowed, SM306 second factor needed.

create table public.speaking_styles (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  language   text not null check (language in ('en', 'te', 'hi', 'kn', 'ta', 'ml')),
  style      text not null check (style in ('everyday_mixed', 'everyday_pure', 'formal')),
  region     text not null default 'neutral' check (region in ('neutral', 'coastal', 'telangana', 'rayalaseema', 'chennai', 'kongu', 'bengaluru', 'north_karnataka')),
  updated_by uuid not null,
  updated_at timestamptz not null default app.outbox_now(),
  unique (tenant_id, language),
  check (region = 'neutral'
         or (language = 'te' and region in ('coastal', 'telangana', 'rayalaseema'))
         or (language = 'ta' and region in ('chennai', 'kongu'))
         or (language = 'kn' and region in ('bengaluru', 'north_karnataka')))
);
comment on table public.speaking_styles is 'Job DS: how the assistant talks in each language of a workspace. Written only by speaking_style_set (Owner, second factor). Not personal data.';
comment on column public.speaking_styles.language is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.speaking_styles.style is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.speaking_styles.region is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
alter table public.speaking_styles enable row level security;
alter table public.speaking_styles force row level security;
revoke all on public.speaking_styles from public, anon, authenticated, service_role;
grant select on public.speaking_styles to authenticated;
create policy speaking_styles_select on public.speaking_styles for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create trigger speaking_styles_forbid_tenant_id_change before update on public.speaking_styles for each row execute function app.forbid_tenant_id_change();
create trigger audit_speaking_styles after insert or update or delete on public.speaking_styles for each row execute function app.audit_row_change('speaking_style', '');

create function public.speaking_style_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return jsonb_build_object('languages', (
    select jsonb_object_agg(l.code, jsonb_build_object('style', coalesce(s.style, 'everyday_mixed'), 'region', coalesce(s.region, 'neutral'), 'saved', s.id is not null) order by l.code)
      from unnest(array['en', 'te', 'hi', 'kn', 'ta', 'ml']) as l(code)
      left join public.speaking_styles s on s.tenant_id = p_tenant_id and s.language = l.code));
end;
$$;
revoke all on function public.speaking_style_get(uuid) from public, anon;
grant execute on function public.speaking_style_get(uuid) to authenticated;

-- sets all six languages at once: p_settings = {"languages": {"te": {"style": "everyday_mixed", "region": "telangana"}, ...}}; a language left out goes back to the default
create function public.speaking_style_set(p_tenant_id uuid, p_settings jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  k text;
  v jsonb;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform app.require_aal2();
  if p_settings is null or jsonb_typeof(p_settings) <> 'object' or (select count(*) from jsonb_object_keys(p_settings) x where x <> 'languages') > 0
     or jsonb_typeof(p_settings -> 'languages') is distinct from 'object' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  for k, v in select * from jsonb_each(p_settings -> 'languages') loop
    if k not in ('en', 'te', 'hi', 'kn', 'ta', 'ml') or jsonb_typeof(v) <> 'object' or (select count(*) from jsonb_object_keys(v) x where x not in ('style', 'region')) > 0
       or (v ->> 'style') is null or (v ->> 'style') not in ('everyday_mixed', 'everyday_pure', 'formal')
       or coalesce(v ->> 'region', 'neutral') not in ('neutral', 'coastal', 'telangana', 'rayalaseema', 'chennai', 'kongu', 'bengaluru', 'north_karnataka')
       or (coalesce(v ->> 'region', 'neutral') <> 'neutral' and not (
             (k = 'te' and (v ->> 'region') in ('coastal', 'telangana', 'rayalaseema'))
          or (k = 'ta' and (v ->> 'region') in ('chennai', 'kongu'))
          or (k = 'kn' and (v ->> 'region') in ('bengaluru', 'north_karnataka')))) then
      raise exception 'invalid input' using errcode = '22023';
    end if;
  end loop;
  perform pg_advisory_xact_lock(hashtextextended('speaking_style:' || p_tenant_id::text, 0));
  delete from public.speaking_styles where tenant_id = p_tenant_id;
  for k, v in select * from jsonb_each(p_settings -> 'languages') loop
    insert into public.speaking_styles (tenant_id, language, style, region, updated_by) values (p_tenant_id, k, v ->> 'style', coalesce(v ->> 'region', 'neutral'), v_uid);
  end loop;
  return public.speaking_style_get(p_tenant_id);
end;
$$;
revoke all on function public.speaking_style_set(uuid, jsonb) from public, anon;
grant execute on function public.speaking_style_set(uuid, jsonb) to authenticated;
