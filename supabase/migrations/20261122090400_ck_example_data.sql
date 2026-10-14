-- Job CK (wave 1, C1, blueprint section 3.2): THE EXAMPLE-DATA WORKSPACE. "See how it works with example data": one call loads a small, clearly labelled sample (from the business's own pack, `example_data` in
-- its manifest), another removes it.
--
--   packs.example_batches   one row per load: who, when, from which pack version, and when it was removed. At most ONE batch is live per business.
--   packs.example_rows      every row a load made (table and id) with the `updated_at` it had when it was made. Ids only: no personal data. No client grant.
--
-- Clearly labelled, three ways: every sample name starts with "Example:", a sample lead's source is "Example data", and the batch is recorded and listed by GET .../example-data.
-- A sample contact has NO phone number and NO e-mail address: nothing can ever be sent to it (the outbox needs a way to reach a person), and nothing in it could be real.
--
-- Removable, and safe to remove: the removal deletes ONLY the rows the load made, ONLY while they are unchanged since the load (same updated_at) and ONLY while nothing else points at them (a quote, an
-- order or a message that uses a sample row keeps it). A row the person changed or used is KEPT and reported, never deleted. Owner or Admin; the delete is of sample rows by a person's explicit act, which is
-- the approval path (non-negotiable 3).
--
-- The load goes through ordinary inserts, so every table rule still applies: the module guards (a pack whose example data needs an off module cannot load), text hygiene, the real-data gate.
--
-- SQLSTATEs: SM721 the example data is already loaded; 42501 not allowed; 23503 no pack / not found.

create table packs.example_batches (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  pack_code    text not null,
  pack_version integer not null,
  loaded_by    uuid not null,
  loaded_at    timestamptz not null default now(),
  removed_by   uuid,
  removed_at   timestamptz,
  counts       jsonb not null default '{}'::jsonb check (jsonb_typeof(counts) = 'object'),
  foreign key (pack_code, pack_version) references packs.pack_versions (code, version),
  check ((removed_at is null) = (removed_by is null))
);
create unique index example_batches_one_live on packs.example_batches (tenant_id) where removed_at is null;
create index example_batches_tenant_idx on packs.example_batches (tenant_id, loaded_at desc);

create table packs.example_rows (
  batch_id   uuid not null references packs.example_batches (id),
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  table_name text not null check (table_name in ('companies', 'contacts', 'leads', 'products')),
  row_id     uuid not null,
  made_at    timestamptz not null,
  primary key (batch_id, table_name, row_id)
);
create index example_rows_tenant_idx on packs.example_rows (tenant_id, batch_id);

do $$
declare t text;
begin
  foreach t in array array['example_batches', 'example_rows'] loop
    execute format('alter table packs.%I enable row level security', t);
    execute format('alter table packs.%I force row level security', t);
    execute format('revoke all on packs.%I from public, anon, authenticated, service_role', t);
  end loop;
end;
$$;

create function app.example_json(b packs.example_batches) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('loaded', b.removed_at is null, 'batch_id', b.id, 'pack_id', b.pack_code, 'loaded_at', b.loaded_at, 'removed_at', b.removed_at, 'counts', b.counts)
$$;
revoke all on function app.example_json(packs.example_batches) from public;

create function public.example_data_status(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b packs.example_batches;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into b from packs.example_batches x where x.tenant_id = p_tenant_id order by x.loaded_at desc limit 1;
  if not found then
    return jsonb_build_object('loaded', false, 'batch_id', null, 'pack_id', null, 'loaded_at', null, 'removed_at', null, 'counts', '{}'::jsonb);
  end if;
  return app.example_json(b);
end;
$$;
revoke all on function public.example_data_status(uuid) from public, anon;
grant execute on function public.example_data_status(uuid) to authenticated;

create function public.example_data_load(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w       packs.workspace_pack;
  v_m     jsonb;
  v_batch packs.example_batches;
  e       jsonb;
  v_ids   jsonb := '{}'::jsonb;
  v_id    uuid;
  v_co    uuid;
  v_ct    uuid;
  v_counts jsonb := jsonb_build_object('companies', 0, 'contacts', 0, 'leads', 0, 'products', 0);
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('example_data:' || p_tenant_id::text, 0));
  select * into w from packs.workspace_pack x where x.tenant_id = p_tenant_id;
  if not found then
    raise exception 'not found' using errcode = '23503';
  end if;
  if exists (select 1 from packs.example_batches b where b.tenant_id = p_tenant_id and b.removed_at is null) then
    raise exception 'the example data is already loaded' using errcode = 'SM721';
  end if;
  select v.manifest -> 'example_data' into v_m from packs.pack_versions v where v.code = w.pack_code and v.version = w.pack_version;
  if v_m is null or jsonb_typeof(v_m) <> 'object' then
    raise exception 'not found' using errcode = '23503';
  end if;
  insert into packs.example_batches (tenant_id, pack_code, pack_version, loaded_by) values (p_tenant_id, w.pack_code, w.pack_version, auth.uid()) returning * into v_batch;

  for e in select * from jsonb_array_elements(coalesce(v_m -> 'companies', '[]'::jsonb)) loop
    insert into public.companies (tenant_id, name, type, city) values (p_tenant_id, e ->> 'name', (e ->> 'type')::public.company_type, e ->> 'city') returning id into v_id;
    insert into packs.example_rows (batch_id, tenant_id, table_name, row_id, made_at) select v_batch.id, p_tenant_id, 'companies', c.id, c.updated_at from public.companies c where c.id = v_id;
    v_ids := v_ids || jsonb_build_object('company:' || (e ->> 'key'), v_id);
    v_counts := jsonb_set(v_counts, '{companies}', to_jsonb((v_counts ->> 'companies')::integer + 1));
  end loop;
  for e in select * from jsonb_array_elements(coalesce(v_m -> 'contacts', '[]'::jsonb)) loop
    v_co := case when e ->> 'company' is null then null else (v_ids ->> ('company:' || (e ->> 'company')))::uuid end;
    insert into public.contacts (tenant_id, company_id, full_name) values (p_tenant_id, v_co, e ->> 'full_name') returning id into v_id;
    insert into packs.example_rows (batch_id, tenant_id, table_name, row_id, made_at) select v_batch.id, p_tenant_id, 'contacts', c.id, c.updated_at from public.contacts c where c.id = v_id;
    v_ids := v_ids || jsonb_build_object('contact:' || (e ->> 'key'), v_id);
    v_counts := jsonb_set(v_counts, '{contacts}', to_jsonb((v_counts ->> 'contacts')::integer + 1));
  end loop;
  for e in select * from jsonb_array_elements(coalesce(v_m -> 'leads', '[]'::jsonb)) loop
    v_co := case when e ->> 'company' is null then null else (v_ids ->> ('company:' || (e ->> 'company')))::uuid end;
    v_ct := case when e ->> 'contact' is null then null else (v_ids ->> ('contact:' || (e ->> 'contact')))::uuid end;
    insert into public.leads (tenant_id, company_id, contact_id, source) values (p_tenant_id, v_co, v_ct, e ->> 'source') returning id into v_id;
    insert into packs.example_rows (batch_id, tenant_id, table_name, row_id, made_at) select v_batch.id, p_tenant_id, 'leads', l.id, l.updated_at from public.leads l where l.id = v_id;
    v_counts := jsonb_set(v_counts, '{leads}', to_jsonb((v_counts ->> 'leads')::integer + 1));
  end loop;
  for e in select * from jsonb_array_elements(coalesce(v_m -> 'products', '[]'::jsonb)) loop
    insert into public.products (tenant_id, sku, name, unit, category) values (p_tenant_id, e ->> 'sku', e ->> 'name', e ->> 'unit', e ->> 'category')
    on conflict do nothing returning id into v_id;
    if v_id is not null then
      insert into packs.example_rows (batch_id, tenant_id, table_name, row_id, made_at) select v_batch.id, p_tenant_id, 'products', p.id, p.updated_at from public.products p where p.id = v_id;
      v_counts := jsonb_set(v_counts, '{products}', to_jsonb((v_counts ->> 'products')::integer + 1));
    end if;
    v_id := null;
  end loop;

  update packs.example_batches set counts = v_counts where id = v_batch.id returning * into v_batch;
  perform app.write_audit_event(p_tenant_id, 'example_data.load', 'example_data', v_batch.id, null, jsonb_build_object('pack', w.pack_code, 'counts', v_counts));
  return app.example_json(v_batch);
end;
$$;
revoke all on function public.example_data_load(uuid) from public, anon;
grant execute on function public.example_data_load(uuid) to authenticated;

-- Remove the sample rows that are still untouched and unused; keep (and count) every other one.
create function public.example_data_remove(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_batch   packs.example_batches;
  r         record;
  v_removed jsonb := jsonb_build_object('companies', 0, 'contacts', 0, 'leads', 0, 'products', 0);
  v_kept    jsonb := jsonb_build_object('companies', 0, 'contacts', 0, 'leads', 0, 'products', 0);
  v_updated timestamptz;
  v_ok      boolean;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('example_data:' || p_tenant_id::text, 0));
  select * into v_batch from packs.example_batches b where b.tenant_id = p_tenant_id and b.removed_at is null;
  if not found then
    return jsonb_build_object('removed', v_removed, 'kept', v_kept, 'batch_id', null);
  end if;
  -- dependants first: leads, contacts, companies, products
  for r in
    select x.table_name, x.row_id, x.made_at from packs.example_rows x where x.batch_id = v_batch.id
     order by case x.table_name when 'leads' then 1 when 'contacts' then 2 when 'companies' then 3 else 4 end, x.row_id
  loop
    execute format('select updated_at from public.%I where tenant_id = $1 and id = $2', r.table_name) into v_updated using p_tenant_id, r.row_id;
    if v_updated is null then
      continue;  -- already gone
    end if;
    v_ok := false;
    if v_updated = r.made_at then
      begin
        execute format('delete from public.%I where tenant_id = $1 and id = $2', r.table_name) using p_tenant_id, r.row_id;
        v_ok := true;
      exception when foreign_key_violation then
        v_ok := false;  -- something points at it: keep it
      end;
    end if;
    if v_ok then
      v_removed := jsonb_set(v_removed, array[r.table_name], to_jsonb((v_removed ->> r.table_name)::integer + 1));
    else
      v_kept := jsonb_set(v_kept, array[r.table_name], to_jsonb((v_kept ->> r.table_name)::integer + 1));
    end if;
  end loop;
  update packs.example_batches set removed_at = now(), removed_by = auth.uid() where id = v_batch.id;
  perform app.write_audit_event(p_tenant_id, 'example_data.remove', 'example_data', v_batch.id, null, jsonb_build_object('removed', v_removed, 'kept', v_kept));
  return jsonb_build_object('removed', v_removed, 'kept', v_kept, 'batch_id', v_batch.id);
end;
$$;
revoke all on function public.example_data_remove(uuid) from public, anon;
grant execute on function public.example_data_remove(uuid) to authenticated;
