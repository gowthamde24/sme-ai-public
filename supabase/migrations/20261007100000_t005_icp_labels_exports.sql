-- T005 / milestone 1: ICP profile versions, lead labels, export log (ADR 0010).
--
--   icp_config_versions  the tenant's ICP scoring parameters as immutable, numbered DATA (not code). The engine
--                        (milestone 2) is a pure function of one of these configs; an invalid or missing config means
--                        "no score", never a default guess. Publishing = a new row; rolling back = publishing a copy.
--   lead_labels          a reviewer's Good / Bad / Maybe on a lead, append-only. A changed mind is a NEW row; the
--                        current label of a reviewer is their newest. Each label snapshots the score the reviewer was
--                        (or was not) shown, with the ICP version it came from, so every label stays reproducible.
--   data_exports         one immutable record per export, written BEFORE the file is streamed.
--
-- Same rules as T003 / T004: composite (tenant_id, x_id) foreign keys, no cascade, RLS enabled + forced with the
-- once-per-statement helpers, column-level grants, server-owned created_by / created_via / created_at, text hygiene on every
-- free-text / jsonb column, audit via app.audit_row_change. None of these tables can be updated or deleted by anyone.

create type public.lead_label as enum ('good', 'bad', 'maybe');
create type public.lead_label_reason as enum (
  'not_our_market', 'wrong_product', 'too_small', 'too_large', 'inactive', 'not_a_business',
  'no_contact_route', 'already_customer', 'duplicate', 'insufficient_info', 'payment_risk');
create type public.export_kind as enum ('lead_labels');
create type public.export_format as enum ('csv', 'json');

-- ---------------------------------------------------------------------------------------------
-- icp_config_versions
-- ---------------------------------------------------------------------------------------------
create table public.icp_config_versions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete restrict,
  -- server-assigned: 1, 2, 3 ... per tenant (app.assign_icp_version)
  version_no     integer not null check (version_no >= 1),
  -- which rule engine can read this config (a slug such as "icp-rules"); the config's own shape is validated by the API
  engine         text not null check (engine ~ '^[a-z][a-z0-9_.-]{1,39}$'),
  schema_version integer not null check (schema_version between 1 and 1000),
  -- Structural minimum only (the API validates the full schema): an object with 1..20 factors, at most 32 KB.
  config         jsonb not null check (
                   jsonb_typeof(config) = 'object'
                   and octet_length(config::text) <= 32768
                   and case when jsonb_typeof(config -> 'factors') = 'array'
                            then jsonb_array_length(config -> 'factors') between 1 and 20 else false end
                   and app.text_is_clean(config)),
  -- server-assigned: sha256 of the stored config text
  config_sha256  text not null check (config_sha256 ~ '^[0-9a-f]{64}$'),
  created_by     uuid,
  created_via    public.record_origin not null default 'manual',
  created_at     timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, version_no)
);

create function app.assign_icp_version() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- one publisher at a time per tenant, so two concurrent publishes cannot both take the same number
  perform pg_advisory_xact_lock(hashtextextended('icp:' || new.tenant_id::text, 0));
  select coalesce(max(v.version_no), 0) + 1 into new.version_no
    from public.icp_config_versions v where v.tenant_id = new.tenant_id;
  new.config_sha256 := encode(sha256(convert_to(new.config::text, 'UTF8')), 'hex');
  return new;
end;
$$;
revoke all on function app.assign_icp_version() from public;

-- ---------------------------------------------------------------------------------------------
-- lead_labels
-- ---------------------------------------------------------------------------------------------
create table public.lead_labels (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references public.tenants (id) on delete restrict,
  lead_id             uuid not null,
  label               public.lead_label not null,
  -- a fixed list, never free text; required for Bad
  reason_code         public.lead_label_reason,
  -- the score snapshot: all four columns or none (no profile, no score: nothing is guessed)
  icp_version_id      uuid,
  score               smallint check (score between 0 and 100),
  score_max_reachable smallint check (score_max_reachable between 0 and 100),
  snapshot            jsonb check (
                        jsonb_typeof(snapshot) = 'object'
                        and octet_length(snapshot::text) <= 4096
                        and app.text_is_clean(snapshot)),
  created_by          uuid,
  created_via         public.record_origin not null default 'manual',
  created_at          timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  foreign key (tenant_id, icp_version_id) references public.icp_config_versions (tenant_id, id),
  check (label <> 'bad' or reason_code is not null),
  check ((icp_version_id is null) = (score is null)
         and (score is null) = (score_max_reachable is null)
         and (score is null) = (snapshot is null)),
  check (score is null or score <= score_max_reachable)
);

-- ---------------------------------------------------------------------------------------------
-- data_exports
-- ---------------------------------------------------------------------------------------------
create table public.data_exports (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references public.tenants (id) on delete restrict,
  kind           public.export_kind not null,
  format         public.export_format not null,
  row_count      integer not null check (row_count between 0 and 10000),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_by     uuid,
  created_via    public.record_origin not null default 'manual',
  created_at     timestamptz not null default now(),
  unique (tenant_id, id)
);

-- ---------------------------------------------------------------------------------------------
-- Indexes: keyset pagination on every table; the child side of every composite foreign key.
-- ---------------------------------------------------------------------------------------------
create index icp_config_versions_tenant_created_idx on public.icp_config_versions (tenant_id, created_at desc, id);
create index lead_labels_tenant_created_idx         on public.lead_labels         (tenant_id, created_at desc, id);
create index data_exports_tenant_created_idx        on public.data_exports        (tenant_id, created_at desc, id);
-- "the newest label of this reviewer on this lead"
create index lead_labels_latest_idx on public.lead_labels (tenant_id, lead_id, created_by, created_at desc, id desc);
create index lead_labels_icp_version_idx on public.lead_labels (tenant_id, icp_version_id) where icp_version_id is not null;

-- ---------------------------------------------------------------------------------------------
-- Triggers: tenant immutable, provenance server-set, append-only, audit.
-- ---------------------------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['icp_config_versions', 'lead_labels', 'data_exports'] loop
    execute format('create trigger %1$s_forbid_tenant_id_change before update on public.%1$s for each row execute function app.forbid_tenant_id_change()', t);
    execute format('create trigger %1$s_set_created_meta before insert or update on public.%1$s for each row execute function app.set_created_meta()', t);
    execute format('create trigger %1$s_guard_immutable before update on public.%1$s for each row execute function app.guard_immutable_record()', t);
  end loop;
end $$;

create trigger icp_config_versions_assign_version
  before insert on public.icp_config_versions
  for each row execute function app.assign_icp_version();

create trigger audit_icp_config_versions after insert or update or delete on public.icp_config_versions
  for each row execute function app.audit_row_change('icp_config_version');
create trigger audit_lead_labels after insert or update or delete on public.lead_labels
  for each row execute function app.audit_row_change('lead_label');
create trigger audit_data_exports after insert or update or delete on public.data_exports
  for each row execute function app.audit_row_change('data_export');

-- ---------------------------------------------------------------------------------------------
-- Column classification (read by the audit and text-hygiene guards)
-- ---------------------------------------------------------------------------------------------
comment on column public.icp_config_versions.engine        is 'SAFE: slug of the rule engine that reads this config. CLEAN-EXEMPT: strict anchored slug pattern';
comment on column public.icp_config_versions.config        is 'SAFE: the tenant''s scoring parameters (vocabularies, places, weights, thresholds); business configuration, never personal data; hygiene-checked';
comment on column public.icp_config_versions.config_sha256 is 'SAFE: sha256 of the stored config, assigned by the server. CLEAN-EXEMPT: strict anchored hex pattern';
comment on column public.lead_labels.snapshot              is 'SAFE: what the scoring engine returned when the label was given (factor results and non-personal features); size-capped and hygiene-checked. A reviewer can only misreport the context of their own label';
comment on column public.data_exports.content_sha256       is 'SAFE: sha256 of the exported file. CLEAN-EXEMPT: strict anchored hex pattern';

-- ---------------------------------------------------------------------------------------------
-- RLS: enabled and forced; default deny; policies TO authenticated; pattern-B helpers only.
--   icp_config_versions : read = any member, insert = Owner / Admin
--   lead_labels         : read = any member, insert = Owner / Admin / Sales
--   data_exports        : read = Owner / Admin, insert = Owner / Admin
--   nobody updates or deletes any of them (no grant, no policy)
-- ---------------------------------------------------------------------------------------------
do $$
declare
  t text;
  writers text;
begin
  foreach t in array array['icp_config_versions', 'lead_labels', 'data_exports'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);

    writers := case t when 'lead_labels' then '''owner'', ''admin'', ''sales''' else '''owner'', ''admin''' end;

    if t = 'data_exports' then
      execute format(
        'create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array[''owner'', ''admin'']::public.app_role[])))::uuid[]))', t);
    else
      execute format(
        'create policy %1$s_select on public.%1$s for select to authenticated using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]))', t);
    end if;
    execute format(
      'create policy %1$s_insert on public.%1$s for insert to authenticated with check (tenant_id = any (((select app.my_tenant_ids_with_role(array[%2$s]::public.app_role[])))::uuid[]))', t, writers);

    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- Column grants. Absent on purpose: version_no / config_sha256 (assigned by the server), created_by / created_via /
-- created_at, and every UPDATE.
grant insert (id, tenant_id, engine, schema_version, config) on public.icp_config_versions to authenticated;
grant insert (id, tenant_id, lead_id, label, reason_code, icp_version_id, score, score_max_reachable, snapshot)
  on public.lead_labels to authenticated;
grant insert (id, tenant_id, kind, format, row_count, content_sha256) on public.data_exports to authenticated;
