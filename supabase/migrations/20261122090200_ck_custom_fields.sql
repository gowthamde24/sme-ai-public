-- Job CK (wave 1, C1, ADR 0084 part 2): CUSTOM FIELDS on contacts and catalogue items. Migration 3 of 4 of the job (structure, generated data, THIS, activation).
--
--   public.custom_field_defs    a business's field definitions: entity (contact | catalogue_item), a code that never changes, a label per language, a kind (text | number | date | choice | multi_choice | yes_no),
--                               the choices (append-only), required, position, a personal-data class (none | personal), mergeable, active, and where it came from (pack | owner). NEVER deleted: made inactive.
--                               At most 20 ACTIVE per entity (40 in all) per business.
--   public.custom_field_values  one typed value per (definition, contact | catalogue item): a side table, not a jsonb column on the hot tables, so those tables and their narrow grants are untouched and erasure
--                               can reach exactly these values. Composite foreign keys keep a value inside its own business.
--
-- Who: every member reads definitions; Owner / Admin create and change them WITH A SECOND FACTOR; values are written by the roles that may edit the entity (a contact: Owner, Admin, Sales; a catalogue item: Owner, Admin).
-- Nobody writes a table directly; every write is a SECURITY DEFINER function that proves the role first. A module that is off refuses its entity's fields (SM701).
--
-- Rules in the database: a value of the wrong kind, a choice that is not in the definition, a date that is not a date, a text longer than 100 characters, an invisible character, and (class none) a phone number or an
-- e-mail address inside a text value are all refused (SM711). A model never reads these values (nothing in the agent paths selects them).
--
-- Personal data: every value column is PII-commented (a definition marked `personal` holds personal data by design). Erasure: a contact's values are DELETED when the contact is erased (trigger below); the
-- tenant-wide erasure and the identifier sweep are driven by the registry rows at the end of this file.
--
-- SQLSTATEs: 22023 invalid input, 42501 not allowed, 23503 not found, 23505 code already used, SM701 module off, SM711 the value does not fit, SM712 field limit reached.

-- ---------------------------------------------------------------------------------------------------------------------------------
-- errors and small checks
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.cf_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'taken'     then raise exception 'that field code is already used' using errcode = '23505';
    when 'value'     then raise exception 'that value does not fit this field' using errcode = 'SM711';
    when 'limit'     then raise exception 'too many fields' using errcode = 'SM712';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.cf_error(text) from public;

-- {"en": "...", "te": "..."}: English required, te / hi / kn optional, each 1 to 80 clean characters
create function app.cf_label_ok(p jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null and jsonb_typeof(p) = 'object' and p ? 'en'
     and not exists (select 1 from jsonb_each(p) e
                      where e.key not in ('en', 'te', 'hi', 'kn') or jsonb_typeof(e.value) <> 'string'
                         or char_length(e.value #>> '{}') not between 1 and 80 or not app.text_is_clean(e.value #>> '{}'))
$$;
revoke all on function app.cf_label_ok(jsonb) from public;

-- [{"code": "a1", "label": {...}}, ...]: 1 to 30 choices, unique codes, each code ^[a-z0-9][a-z0-9_]{0,39}$
create function app.cf_choices_ok(p jsonb) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is not null and jsonb_typeof(p) = 'array' and jsonb_array_length(p) between 1 and 30
     and not exists (select 1 from jsonb_array_elements(p) c
                      where jsonb_typeof(c) <> 'object' or (c ->> 'code') is null or (c ->> 'code') !~ '^[a-z0-9][a-z0-9_]{0,39}$'
                         or not app.cf_label_ok(c -> 'label') or exists (select 1 from jsonb_object_keys(c) k where k not in ('code', 'label')))
     and (select count(distinct c ->> 'code') from jsonb_array_elements(p) c) = jsonb_array_length(p)
$$;
revoke all on function app.cf_choices_ok(jsonb) from public;

create function app.cf_codes_ok(p text[]) returns boolean
language sql
immutable
set search_path = ''
as $$
  select p is null or (cardinality(p) <= 30 and not exists (select 1 from unnest(p) c where c is null or c !~ '^[a-z0-9][a-z0-9_]{0,39}$'))
$$;
revoke all on function app.cf_codes_ok(text[]) from public;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- tables
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.custom_field_defs (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  entity     text not null check (entity in ('contact', 'catalogue_item')),
  code       text not null check (code ~ '^[a-z][a-z0-9_]{1,39}$'),
  label      jsonb not null check (app.cf_label_ok(label)),
  kind       text not null check (kind in ('text', 'number', 'date', 'choice', 'multi_choice', 'yes_no')),
  choices    jsonb check (choices is null or app.cf_choices_ok(choices)),
  required   boolean not null default false,
  position   integer not null default 0 check (position between 0 and 10000),
  pii_class  text not null default 'none' check (pii_class in ('none', 'personal')),
  mergeable  boolean not null default false,
  active     boolean not null default true,
  source     text not null check (source in ('pack', 'owner')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, entity, code),
  check ((kind in ('choice', 'multi_choice')) = (choices is not null)),
  check (not mergeable or kind not in ('multi_choice', 'yes_no'))
);
create index custom_field_defs_entity_idx on public.custom_field_defs (tenant_id, entity, active, position);
comment on column public.custom_field_defs.code is 'SAFE: a short machine name the business or its pack chose; never changes. CLEAN-EXEMPT: strict pattern in a CHECK';
comment on column public.custom_field_defs.entity is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.custom_field_defs.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.custom_field_defs.pii_class is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.custom_field_defs.source is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.custom_field_defs.label is 'SAFE: the name of a field, in up to four languages (what the owner typed to name a column, never a person''s data). CLEAN-EXEMPT: every string is checked by app.cf_label_ok, which calls text_is_clean';
comment on column public.custom_field_defs.choices is 'SAFE: the choices of a choice field (codes and labels the owner or the pack chose). CLEAN-EXEMPT: every label is checked by app.cf_choices_ok, which calls text_is_clean';

create table public.custom_field_values (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants (id) on delete restrict,
  field_id          uuid not null,
  entity            text not null check (entity in ('contact', 'catalogue_item')),
  contact_id        uuid,
  catalogue_item_id uuid,
  value_text        text check (value_text is null or (char_length(value_text) between 1 and 100 and app.text_is_clean(value_text))),
  value_number      numeric check (value_number is null or abs(value_number) < 1000000000000),
  value_date        date check (value_date is null or value_date between date '1900-01-01' and date '2200-12-31'),
  value_bool        boolean,
  value_choices     text[] check (app.cf_codes_ok(value_choices) and app.text_is_clean(value_choices)),
  updated_by        uuid,
  updated_at        timestamptz not null default now(),
  foreign key (tenant_id, field_id) references public.custom_field_defs (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  foreign key (tenant_id, catalogue_item_id) references public.catalogue_items (tenant_id, id),
  unique (tenant_id, field_id, contact_id),
  unique (tenant_id, field_id, catalogue_item_id),
  unique (tenant_id, id),
  check ((entity = 'contact' and contact_id is not null and catalogue_item_id is null)
      or (entity = 'catalogue_item' and catalogue_item_id is not null and contact_id is null)),
  check (num_nonnulls(value_text, value_number, value_date, value_bool, value_choices) <= 1)
);
create index custom_field_values_contact_idx on public.custom_field_values (tenant_id, contact_id);
create index custom_field_values_item_idx on public.custom_field_values (tenant_id, catalogue_item_id);
comment on column public.custom_field_values.value_text is 'PII: a short text value of a custom field (up to 100 characters); a field marked personal holds personal data by design';
comment on column public.custom_field_values.value_number is 'PII: a number value of a custom field; a field marked personal holds personal data by design';
comment on column public.custom_field_values.value_date is 'PII: a date value of a custom field; a field marked personal holds personal data by design';
comment on column public.custom_field_values.value_bool is 'PII: a yes or no value of a custom field; a field marked personal holds personal data by design';
comment on column public.custom_field_values.value_choices is 'PII: the chosen codes of a choice field; a field marked personal holds personal data by design';
comment on column public.custom_field_values.entity is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';

-- a definition never moves: not its business, entity, code, kind, class or source; its choices only grow
create function app.custom_field_defs_guard() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'custom field definitions are never deleted: make them inactive' using errcode = '42501';
  end if;
  if new.tenant_id is distinct from old.tenant_id or new.entity is distinct from old.entity or new.code is distinct from old.code
     or new.kind is distinct from old.kind or new.pii_class is distinct from old.pii_class or new.source is distinct from old.source then
    raise exception 'a custom field''s business, entity, code, kind, class and source never change' using errcode = '42501';
  end if;
  if old.choices is not null and not (
       select coalesce(bool_and(exists (select 1 from jsonb_array_elements(new.choices) n where n ->> 'code' = o ->> 'code')), true) from jsonb_array_elements(old.choices) o) then
    raise exception 'a choice is never removed from a custom field' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.custom_field_defs_guard() from public;
create trigger custom_field_defs_guard before update or delete on public.custom_field_defs for each row execute function app.custom_field_defs_guard();
create trigger custom_field_defs_set_updated_at before update on public.custom_field_defs for each row execute function app.set_updated_at();
create trigger custom_field_values_forbid_tenant_id_change before update on public.custom_field_values for each row execute function app.forbid_tenant_id_change();
create trigger custom_field_values_set_updated_at before update on public.custom_field_values for each row execute function app.set_updated_at();
create trigger audit_custom_field_defs after insert or update or delete on public.custom_field_defs for each row execute function app.audit_row_change('custom_field_def', '');
create trigger audit_custom_field_values after insert or update or delete on public.custom_field_values
  for each row execute function app.audit_row_change('custom_field_value', 'value_text,value_number,value_date,value_bool,value_choices');
create trigger custom_field_defs_forbid_tenant_id_change before update on public.custom_field_defs for each row execute function app.forbid_tenant_id_change();

alter table public.custom_field_defs enable row level security;
alter table public.custom_field_defs force row level security;
revoke all on public.custom_field_defs from public, anon, authenticated, service_role;
grant select on public.custom_field_defs to authenticated;
create policy custom_field_defs_select on public.custom_field_defs for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]));
alter table public.custom_field_values enable row level security;
alter table public.custom_field_values force row level security;
revoke all on public.custom_field_values from public, anon, authenticated, service_role;
grant select on public.custom_field_values to authenticated;
create policy custom_field_values_select on public.custom_field_values for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));

-- ---------------------------------------------------------------------------------------------------------------------------------
-- erasure: the values of an erased contact are deleted (the contact's own erasure sets erased_at; nothing else does)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.custom_values_on_contact_erased() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.erased_at is null and new.erased_at is not null then
    delete from public.custom_field_values v where v.tenant_id = new.tenant_id and v.contact_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function app.custom_values_on_contact_erased() from public;
create trigger contacts_erase_custom_values after update of erased_at on public.contacts for each row execute function app.custom_values_on_contact_erased();

insert into erasure.registry (table_name, column_name, scope, strategy, replacement, with_set) values
  ('custom_field_values', 'value_text',    'tenant', 'tombstone',   'erased:1', null),
  ('custom_field_values', 'value_number',  'tenant', 'null',        'erased:1', null),
  ('custom_field_values', 'value_date',    'tenant', 'null',        'erased:1', null),
  ('custom_field_values', 'value_bool',    'tenant', 'null',        'erased:1', null),
  ('custom_field_values', 'value_choices', 'tenant', 'empty_array', 'erased:1', null),
  ('custom_field_values', 'value_text',    'sweep',  'substring',   'erased:1', null),
  -- (a choice code is [a-z0-9_] only, so the array replacement is erased_1 and not erased-1)
  ('custom_field_values', 'value_choices', 'sweep',  'substring_array', 'erased_1', null);

-- ---------------------------------------------------------------------------------------------------------------------------------
-- reading
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.cf_def_json(d public.custom_field_defs) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', d.id, 'entity', d.entity, 'code', d.code, 'label', d.label, 'kind', d.kind, 'choices', d.choices, 'required', d.required,
                            'position', d.position, 'pii_class', d.pii_class, 'mergeable', d.mergeable, 'active', d.active, 'source', d.source)
$$;
revoke all on function app.cf_def_json(public.custom_field_defs) from public;

create function public.custom_field_defs_list(p_tenant_id uuid, p_entity text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.cf_error('deny');
  end if;
  if p_entity is not null and p_entity not in ('contact', 'catalogue_item') then
    perform app.cf_error('invalid');
  end if;
  return coalesce((select jsonb_agg(app.cf_def_json(d) order by d.entity, d.position, d.code) from public.custom_field_defs d
                    where d.tenant_id = p_tenant_id and (p_entity is null or d.entity = p_entity)), '[]'::jsonb);
end;
$$;
revoke all on function public.custom_field_defs_list(uuid, text) from public, anon;
grant execute on function public.custom_field_defs_list(uuid, text) to authenticated;

-- the values of one contact or item: every active definition (null when unset) and any inactive one that still holds a value. A Viewer does not see `personal` values.
create function app.cf_values_json(p_tenant uuid, p_entity text, p_id uuid, p_hide_personal boolean) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'code', d.code, 'kind', d.kind, 'active', d.active,
           'value', case when p_hide_personal and d.pii_class = 'personal' then null
                         else case d.kind when 'text' then to_jsonb(v.value_text) when 'choice' then to_jsonb(v.value_text) when 'number' then to_jsonb(v.value_number)
                                          when 'date' then to_jsonb(v.value_date) when 'yes_no' then to_jsonb(v.value_bool) else to_jsonb(v.value_choices) end end)
         order by d.position, d.code), '[]'::jsonb)
    from public.custom_field_defs d
    left join public.custom_field_values v on v.tenant_id = d.tenant_id and v.field_id = d.id
         and ((p_entity = 'contact' and v.contact_id = p_id) or (p_entity = 'catalogue_item' and v.catalogue_item_id = p_id))
   where d.tenant_id = p_tenant and d.entity = p_entity and (d.active or v.id is not null)
$$;
revoke all on function app.cf_values_json(uuid, text, uuid, boolean) from public;

create function public.custom_values_get(p_tenant_id uuid, p_entity text, p_entity_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hide boolean;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.cf_error('deny');
  end if;
  if p_entity is null or p_entity not in ('contact', 'catalogue_item') or p_entity_id is null then
    perform app.cf_error('invalid');
  end if;
  if (p_entity = 'contact' and not exists (select 1 from public.contacts c where c.tenant_id = p_tenant_id and c.id = p_entity_id))
     or (p_entity = 'catalogue_item' and not exists (select 1 from public.catalogue_items i where i.tenant_id = p_tenant_id and i.id = p_entity_id)) then
    perform app.cf_error('reference');
  end if;
  v_hide := not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  return jsonb_build_object('entity', p_entity, 'entity_id', p_entity_id, 'values', app.cf_values_json(p_tenant_id, p_entity, p_entity_id, v_hide));
end;
$$;
revoke all on function public.custom_values_get(uuid, text, uuid) from public, anon;
grant execute on function public.custom_values_get(uuid, text, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- definitions: create and change (Owner / Admin, second factor)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.cf_entity_module(p_entity text) returns text
language sql
immutable
set search_path = ''
as $$ select case p_entity when 'contact' then 'contacts' when 'catalogue_item' then 'catalogue' end $$;
revoke all on function app.cf_entity_module(text) from public;

create function public.custom_field_def_create(
  p_tenant_id uuid, p_entity text, p_code text, p_label jsonb, p_kind text, p_choices jsonb default null, p_required boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_def    public.custom_field_defs;
  v_active integer;
  v_total  integer;
  v_pos    integer;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.cf_error('deny');
  end if;
  perform app.require_aal2();
  if p_entity is null or p_entity not in ('contact', 'catalogue_item') or p_code is null or p_code !~ '^[a-z][a-z0-9_]{1,39}$'
     or p_kind is null or p_kind not in ('text', 'number', 'date', 'choice', 'multi_choice', 'yes_no')
     or not app.cf_label_ok(p_label) or (p_kind in ('choice', 'multi_choice')) <> (p_choices is not null)
     or (p_choices is not null and not app.cf_choices_ok(p_choices)) or p_required is null then
    perform app.cf_error('invalid');
  end if;
  perform app.require_module(p_tenant_id, app.cf_entity_module(p_entity));
  perform pg_advisory_xact_lock(hashtextextended('custom_field:' || p_tenant_id::text || ':' || p_entity, 0));
  if exists (select 1 from public.custom_field_defs d where d.tenant_id = p_tenant_id and d.entity = p_entity and d.code = p_code) then
    perform app.cf_error('taken');
  end if;
  select count(*) filter (where d.active), count(*), coalesce(max(d.position), 0) into v_active, v_total, v_pos
    from public.custom_field_defs d where d.tenant_id = p_tenant_id and d.entity = p_entity;
  if v_active >= 20 or v_total >= 40 then
    perform app.cf_error('limit');
  end if;
  insert into public.custom_field_defs (tenant_id, entity, code, label, kind, choices, required, position, pii_class, mergeable, source, created_by)
  values (p_tenant_id, p_entity, p_code, p_label, p_kind, p_choices, p_required, least(v_pos + 10, 10000), 'none', p_kind in ('choice', 'number', 'date'), 'owner', auth.uid())
  returning * into v_def;
  return app.cf_def_json(v_def);
end;
$$;
revoke all on function public.custom_field_def_create(uuid, text, text, jsonb, text, jsonb, boolean) from public, anon;
grant execute on function public.custom_field_def_create(uuid, text, text, jsonb, text, jsonb, boolean) to authenticated;

create function public.custom_field_def_update(
  p_tenant_id uuid, p_id uuid, p_label jsonb default null, p_required boolean default null, p_active boolean default null, p_position integer default null, p_add_choices jsonb default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d        public.custom_field_defs;
  v_choices jsonb;
  v_active integer;
begin
  if auth.uid() is null or p_tenant_id is null or p_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.cf_error('deny');
  end if;
  perform app.require_aal2();
  select * into d from public.custom_field_defs x where x.tenant_id = p_tenant_id and x.id = p_id for update;
  if not found then
    perform app.cf_error('reference');
  end if;
  perform app.require_module(p_tenant_id, app.cf_entity_module(d.entity));
  if (p_label is not null and not app.cf_label_ok(p_label)) or (p_position is not null and p_position not between 0 and 10000) then
    perform app.cf_error('invalid');
  end if;
  v_choices := d.choices;
  if p_add_choices is not null then
    if d.choices is null or jsonb_typeof(p_add_choices) <> 'array' or jsonb_array_length(p_add_choices) = 0 then
      perform app.cf_error('invalid');
    end if;
    v_choices := d.choices || p_add_choices;
    if not app.cf_choices_ok(v_choices) then
      perform app.cf_error('invalid');
    end if;
  end if;
  if p_active is true and not d.active then
    perform pg_advisory_xact_lock(hashtextextended('custom_field:' || p_tenant_id::text || ':' || d.entity, 0));
    select count(*) into v_active from public.custom_field_defs x where x.tenant_id = p_tenant_id and x.entity = d.entity and x.active;
    if v_active >= 20 then
      perform app.cf_error('limit');
    end if;
  end if;
  update public.custom_field_defs set
    label = coalesce(p_label, label), required = coalesce(p_required, required), active = coalesce(p_active, active),
    position = coalesce(p_position, position), choices = v_choices
   where tenant_id = p_tenant_id and id = p_id returning * into d;
  return app.cf_def_json(d);
end;
$$;
revoke all on function public.custom_field_def_update(uuid, uuid, jsonb, boolean, boolean, integer, jsonb) from public, anon;
grant execute on function public.custom_field_def_update(uuid, uuid, jsonb, boolean, boolean, integer, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- values
-- ---------------------------------------------------------------------------------------------------------------------------------
-- one value: null clears it. Returns nothing; a value that does not fit raises SM711.
create function app.cf_put_value(p_def public.custom_field_defs, p_entity_id uuid, p_value jsonb) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_text    text;
  v_num     numeric;
  v_date    date;
  v_bool    boolean;
  v_choices text[];
  v_item    jsonb;
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then
    delete from public.custom_field_values v where v.tenant_id = p_def.tenant_id and v.field_id = p_def.id
       and ((p_def.entity = 'contact' and v.contact_id = p_entity_id) or (p_def.entity = 'catalogue_item' and v.catalogue_item_id = p_entity_id));
    return;
  end if;
  if not p_def.active then
    perform app.cf_error('value');
  end if;
  case p_def.kind
    when 'text' then
      if jsonb_typeof(p_value) <> 'string' then perform app.cf_error('value'); end if;
      v_text := btrim(p_value #>> '{}');
      if char_length(v_text) not between 1 and 100 or not app.text_is_clean(v_text) then perform app.cf_error('value'); end if;
      if p_def.pii_class = 'none' and app.text_has_contact(v_text) then perform app.cf_error('value'); end if;
    when 'number' then
      if jsonb_typeof(p_value) <> 'number' then perform app.cf_error('value'); end if;
      v_num := (p_value #>> '{}')::numeric;
      if abs(v_num) >= 1000000000000 then perform app.cf_error('value'); end if;
    when 'date' then
      if jsonb_typeof(p_value) <> 'string' or (p_value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then perform app.cf_error('value'); end if;
      begin
        v_date := (p_value #>> '{}')::date;
      exception when others then
        perform app.cf_error('value');
      end;
      if v_date not between date '1900-01-01' and date '2200-12-31' then perform app.cf_error('value'); end if;
    when 'yes_no' then
      if jsonb_typeof(p_value) <> 'boolean' then perform app.cf_error('value'); end if;
      v_bool := (p_value #>> '{}')::boolean;
    when 'choice' then
      if jsonb_typeof(p_value) <> 'string' or not exists (select 1 from jsonb_array_elements(p_def.choices) c where c ->> 'code' = p_value #>> '{}') then perform app.cf_error('value'); end if;
      v_text := p_value #>> '{}';
    when 'multi_choice' then
      if jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) = 0 then perform app.cf_error('value'); end if;
      v_choices := '{}';
      for v_item in select * from jsonb_array_elements(p_value) loop
        if jsonb_typeof(v_item) <> 'string' or not exists (select 1 from jsonb_array_elements(p_def.choices) c where c ->> 'code' = v_item #>> '{}') then perform app.cf_error('value'); end if;
        if (v_item #>> '{}') = any (v_choices) then perform app.cf_error('value'); end if;
        v_choices := v_choices || (v_item #>> '{}');
      end loop;
  end case;
  if p_def.entity = 'contact' then
    insert into public.custom_field_values (tenant_id, field_id, entity, contact_id, value_text, value_number, value_date, value_bool, value_choices, updated_by)
    values (p_def.tenant_id, p_def.id, 'contact', p_entity_id, case when p_def.kind in ('text', 'choice') then v_text end, v_num, v_date, v_bool, v_choices, auth.uid())
    on conflict (tenant_id, field_id, contact_id) do update
      set value_text = excluded.value_text, value_number = excluded.value_number, value_date = excluded.value_date, value_bool = excluded.value_bool,
          value_choices = excluded.value_choices, updated_by = excluded.updated_by;
  else
    insert into public.custom_field_values (tenant_id, field_id, entity, catalogue_item_id, value_text, value_number, value_date, value_bool, value_choices, updated_by)
    values (p_def.tenant_id, p_def.id, 'catalogue_item', p_entity_id, case when p_def.kind in ('text', 'choice') then v_text end, v_num, v_date, v_bool, v_choices, auth.uid())
    on conflict (tenant_id, field_id, catalogue_item_id) do update
      set value_text = excluded.value_text, value_number = excluded.value_number, value_date = excluded.value_date, value_bool = excluded.value_bool,
          value_choices = excluded.value_choices, updated_by = excluded.updated_by;
  end if;
end;
$$;
revoke all on function app.cf_put_value(public.custom_field_defs, uuid, jsonb) from public;

-- who may edit the entity's values, and does it exist (and not erased)
create function app.cf_check_entity(p_tenant uuid, p_entity text, p_entity_id uuid) returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant is null or p_entity is null or p_entity not in ('contact', 'catalogue_item') or p_entity_id is null then
    perform app.cf_error('invalid');
  end if;
  if p_entity = 'contact' then
    if not app.has_tenant_role(p_tenant, array['owner', 'admin', 'sales']::public.app_role[]) then perform app.cf_error('deny'); end if;
    if not exists (select 1 from public.contacts c where c.tenant_id = p_tenant and c.id = p_entity_id and c.erased_at is null) then perform app.cf_error('reference'); end if;
  else
    if not app.has_tenant_role(p_tenant, array['owner', 'admin']::public.app_role[]) then perform app.cf_error('deny'); end if;
    if not exists (select 1 from public.catalogue_items i where i.tenant_id = p_tenant and i.id = p_entity_id) then perform app.cf_error('reference'); end if;
  end if;
  perform app.require_module(p_tenant, app.cf_entity_module(p_entity));
end;
$$;
revoke all on function app.cf_check_entity(uuid, text, uuid) from public;

-- set several values of one contact or item at once: {"code": value, ...}; a null value clears one. All or nothing. A code the business does not have is refused (SM711).
create function public.custom_values_set(p_tenant_id uuid, p_entity text, p_entity_id uuid, p_values jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
  d public.custom_field_defs;
  v_n integer := 0;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.cf_error('deny');
  end if;
  perform app.cf_check_entity(p_tenant_id, p_entity, p_entity_id);
  if p_values is null or jsonb_typeof(p_values) <> 'object' or (select count(*) from jsonb_object_keys(p_values)) > 40 then
    perform app.cf_error('invalid');
  end if;
  for k in select key from jsonb_object_keys(p_values) as key order by key loop
    select * into d from public.custom_field_defs x where x.tenant_id = p_tenant_id and x.entity = p_entity and x.code = k;
    if not found then
      perform app.cf_error('value');
    end if;
    perform app.cf_put_value(d, p_entity_id, p_values -> k);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('entity', p_entity, 'entity_id', p_entity_id, 'values', app.cf_values_json(p_tenant_id, p_entity, p_entity_id, false));
end;
$$;
revoke all on function public.custom_values_set(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.custom_values_set(uuid, text, uuid, jsonb) to authenticated;

-- the spreadsheet import: [{"id": contact id, "values": {...}}], at most 500 per call, Owner / Admin. A row that does not fit is reported and skipped; the others are kept.
create function public.custom_values_set_many(p_tenant_id uuid, p_items jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  it      jsonb;
  k       text;
  d       public.custom_field_defs;
  v_set   integer := 0;
  v_failed jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.cf_error('deny');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 500 then
    perform app.cf_error('invalid');
  end if;
  perform app.require_module(p_tenant_id, 'contacts');
  for it in select * from jsonb_array_elements(p_items) loop
    begin
      if jsonb_typeof(it) <> 'object' or (it ->> 'id') is null or (it ->> 'id') !~ '^[0-9a-f-]{36}$' or jsonb_typeof(it -> 'values') <> 'object' then
        perform app.cf_error('invalid');
      end if;
      perform app.cf_check_entity(p_tenant_id, 'contact', (it ->> 'id')::uuid);
      for k in select key from jsonb_object_keys(it -> 'values') as key order by key loop
        select * into d from public.custom_field_defs x where x.tenant_id = p_tenant_id and x.entity = 'contact' and x.code = k;
        if not found then
          perform app.cf_error('value');
        end if;
        perform app.cf_put_value(d, (it ->> 'id')::uuid, it -> 'values' -> k);
      end loop;
      v_set := v_set + 1;
    exception when others then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('id', it -> 'id', 'code', sqlstate));
    end;
  end loop;
  return jsonb_build_object('set', v_set, 'failed', v_failed);
end;
$$;
revoke all on function public.custom_values_set_many(uuid, jsonb) from public, anon;
grant execute on function public.custom_values_set_many(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- a pack's fields are copied into a business when it takes the pack (called by the activation file's complete_setup)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.apply_pack_fields(p_tenant uuid, p_code text, p_version integer, p_actor uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into public.custom_field_defs (tenant_id, entity, code, label, kind, choices, required, position, pii_class, mergeable, active, source, created_by)
  select p_tenant, f ->> 'entity', f ->> 'code', f -> 'label', f ->> 'kind', f -> 'choices', coalesce((f ->> 'required')::boolean, false),
         (ord::integer - 1) * 10, coalesce(f ->> 'pii_class', 'none'), coalesce((f ->> 'mergeable')::boolean, false), true, 'pack', p_actor
    from packs.pack_versions v, jsonb_array_elements(v.manifest -> 'custom_fields') with ordinality as t(f, ord)
   where v.code = p_code and v.version = p_version
  on conflict (tenant_id, entity, code) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke all on function app.apply_pack_fields(uuid, text, integer, uuid) from public;
