-- T005 fix round F / group C: provenance for imported claims (CLAUDE.md non-negotiable 5).
--
-- Until now an imported attribute became a claim (created_via import, confidence unverified) with NOTHING saying where it
-- came from. From now on every import batch writes ONE evidence row and links every claim it creates to it:
--   evidence       kind import_batch, provider import.csv, reference import:<batch uuid>, snippet = a count sentence.
--                  No cell value, no batch label, no person's data (a pgTAP test scans for the canaries).
--   evidence_links one per claim (claim_id + stance 'supports'), created_via import by the importing user.
-- Claims the batch does NOT create (an attribute that already exists as a claim is kept) get no link: they were not
-- sourced by this batch. A refused row's claims and links roll back together with the row's savepoint.
--
-- A client must not be able to forge this provenance: a CHECK ties kind import_batch to created_via import, and
-- created_via is server-owned (app.set_created_meta) and only ever 'import' inside this function. (The enum value is
-- added by the previous migration: a new enum value cannot be used in the transaction that adds it.)
--
-- import_lead_rows is replaced IN PLACE (create or replace keeps owner and grants; they are restated below). Everything
-- else is unchanged: SECURITY DEFINER, search_path = '', role + tenant check, advisory lock, allow-list, savepoints,
-- text hygiene, the real-data gate, idempotent replay.

alter table public.evidence
  add constraint evidence_import_batch_needs_import_origin
  check (kind <> 'import_batch' or created_via = 'import');

create or replace function public.import_lead_rows(
  p_tenant_id uuid,
  p_batch_id  uuid,
  p_rows      jsonb,
  p_label     text    default null,
  p_dry_run   boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_max_rows  constant int  := 500;
  c_max_bytes constant int  := 1048576;
  c_keys      constant text[] := array[
    'company_name', 'website', 'country', 'city', 'industry', 'categories', 'contact_name', 'contact_email',
    'contact_phone', 'contact_job_title', 'source', 'buyer_type', 'size_band', 'operating_status', 'order_scale'];
  c_attrs     constant text[] := array['buyer_type', 'size_band', 'operating_status', 'order_scale'];
  -- THE REAL-DATA GATE: reserved e-mail domains (RFC 2606 / 6761) and the reserved phone prefix.
  c_reserved  constant text[] := array['example.com', 'example.org', 'example.net', 'test', 'invalid', 'example'];
  c_phone_prefix constant text := '+00';

  v_uid        uuid := auth.uid();
  v_hash       text;
  v_batch      uuid;
  v_existing   public.import_batches;
  v_n          int;
  v_i          int;
  v_row        jsonb;
  v_key        text;
  v_type       text;
  v_report     jsonb;

  -- one row's working state
  v_outcome    public.import_outcome;
  v_reason     public.import_reason;
  v_constraint text;
  v_sqlstate   text;
  v_company_id uuid;
  v_contact_id uuid;
  v_lead_id    uuid;
  v_co_created boolean;
  v_ct_created boolean;
  v_written    int;
  v_kept       int;
  v_evidence_id uuid;
  v_claim_id    uuid;

  -- the row's values
  v_name text; v_website text; v_country text; v_city text; v_industry text; v_source text;
  v_cname text; v_cemail text; v_cphone text; v_ctitle text;
  v_tags text[];
  v_has_contact boolean;
  v_domain text;
  v_parts text[];
  v_host text;
  v_host_id text;
  v_city_key text;
  v_matches uuid[];
  v_value text;
  v_archived boolean;
  v_contact public.contacts;

  -- batch counters
  n_created int := 0; n_dup int := 0; n_amb int := 0; n_rej int := 0;
  n_companies int := 0; n_contacts int := 0; n_claims int := 0;
begin
  -- Never trust a value that was there before: clear, then set our own right before the writes.
  perform set_config('app.created_via', '', true);

  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_batch_id is null or p_rows is null then
    raise exception 'tenant, batch id and rows are required' using errcode = '22023';
  end if;
  if not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    raise exception 'your role cannot import leads' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and c_max_rows then
    raise exception 'rows must be an array of 1 to 500 rows' using errcode = '22023';
  end if;
  if octet_length(p_rows::text) > c_max_bytes then
    raise exception 'rows are larger than 1 MiB' using errcode = '22023';
  end if;
  if p_label is not null and p_label !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]{0,59}$' then
    raise exception 'the label must be a plain label of at most 60 characters' using errcode = '22023';
  end if;

  v_n := jsonb_array_length(p_rows);
  -- computed here, from the rows themselves: a caller cannot supply (or lie about) it
  v_hash := encode(sha256(convert_to(p_rows::text, 'UTF8')), 'hex');

  perform pg_advisory_xact_lock(hashtextextended('import:' || p_tenant_id::text, 0));

  -- Idempotency: the same batch id with the same rows is a replay; with other rows it is a conflict, shaped exactly
  -- like a batch id that belongs to another tenant (a primary-key violation).
  if not p_dry_run then
    select * into v_existing from public.import_batches b where b.tenant_id = p_tenant_id and b.id = p_batch_id;
    if found then
      if v_existing.content_sha256 <> v_hash then
        raise exception 'batch id already used' using errcode = '23505', constraint = 'import_batches_pkey', table = 'import_batches', schema = 'public';
      end if;
      return (
        select jsonb_build_object(
          'batch_id', b.id, 'replayed', true, 'dry_run', false,
          'counts', jsonb_build_object('rows', b.row_count, 'created', b.created_count, 'skipped_duplicate', b.duplicate_count,
                                       'ambiguous', b.ambiguous_count, 'rejected', b.rejected_count,
                                       'companies_created', b.companies_created, 'contacts_created', b.contacts_created,
                                       'claims_created', b.claims_created),
          'rows', coalesce((
            select jsonb_agg(jsonb_build_object(
                     'row', r.row_no, 'outcome', r.outcome, 'reason', r.reason, 'constraint', r.constraint_name,
                     'sqlstate', r.sqlstate, 'company_created', r.company_created, 'contact_created', r.contact_created,
                     'attributes_written', r.attributes_written, 'attributes_kept', r.attributes_kept,
                     'company_id', r.company_id, 'contact_id', r.contact_id, 'lead_id', r.lead_id) order by r.row_no)
              from public.import_rows r where r.tenant_id = p_tenant_id and r.batch_id = b.id), '[]'::jsonb))
          from public.import_batches b where b.tenant_id = p_tenant_id and b.id = p_batch_id);
    end if;
  end if;
  v_batch := case when p_dry_run then gen_random_uuid() else p_batch_id end;

  perform set_config('app.created_via', 'import', true);

  begin  -- the work; a dry run raises SM100 at its end so that every write is rolled back
    -- Provenance: ONE evidence row per batch (written before any row, so a batch that fails fails whole). It names the
    -- batch (reference import:<batch id>) and states COUNTS only: no cell value, no label, nothing a person typed.
    -- Every claim this batch writes is linked to it below. A dry run rolls it back with everything else.
    v_evidence_id := gen_random_uuid();
    insert into public.evidence (id, tenant_id, kind, provider, reference, snippet)
    values (v_evidence_id, p_tenant_id, 'import_batch', 'import.csv', 'import:' || v_batch::text,
            format('Lead import batch: %s submitted rows', v_n));

    for v_i in 1..v_n loop
      v_row := p_rows -> (v_i - 1);
      v_outcome := null; v_reason := null; v_constraint := null; v_sqlstate := null;
      v_company_id := null; v_contact_id := null; v_lead_id := null;
      v_co_created := false; v_ct_created := false; v_written := 0; v_kept := 0;

      begin  -- one row = one savepoint: all of it, or none of it
        -- ---- 4 allowlist and types
        if jsonb_typeof(v_row) is distinct from 'object' then
          v_outcome := 'rejected'; v_reason := 'invalid_row';
          raise exception 'row refused' using errcode = 'SM101';
        end if;
        select k into v_key from jsonb_object_keys(v_row) k where k <> all (c_keys) limit 1;
        if found then
          v_outcome := 'rejected'; v_reason := 'unknown_field';
          raise exception 'row refused' using errcode = 'SM101';
        end if;
        foreach v_key in array c_keys loop
          if v_row ? v_key then
            v_type := jsonb_typeof(v_row -> v_key);
            if (v_key = 'categories' and v_type not in ('array', 'null')) or (v_key <> 'categories' and v_type not in ('string', 'null')) then
              v_outcome := 'rejected'; v_reason := 'invalid_row';
              raise exception 'row refused' using errcode = 'SM101';
            end if;
          end if;
        end loop;
        v_tags := null;
        if jsonb_typeof(v_row -> 'categories') = 'array' then
          if exists (select 1 from jsonb_array_elements(v_row -> 'categories') e
                      where jsonb_typeof(e) <> 'string' or btrim(e #>> '{}') = '') then
            v_outcome := 'rejected'; v_reason := 'invalid_row';
            raise exception 'row refused' using errcode = 'SM101';
          end if;
          select coalesce(array_agg(btrim(e #>> '{}') order by o), '{}') into v_tags
            from jsonb_array_elements(v_row -> 'categories') with ordinality as t(e, o);
        end if;

        v_name    := nullif(btrim(v_row ->> 'company_name'), '');
        v_website := nullif(btrim(v_row ->> 'website'), '');
        v_country := nullif(btrim(v_row ->> 'country'), '');
        v_city    := nullif(btrim(v_row ->> 'city'), '');
        v_industry := nullif(btrim(v_row ->> 'industry'), '');
        v_source  := nullif(btrim(v_row ->> 'source'), '');
        v_cname   := nullif(btrim(v_row ->> 'contact_name'), '');
        v_cemail  := nullif(btrim(v_row ->> 'contact_email'), '');
        v_cphone  := nullif(btrim(v_row ->> 'contact_phone'), '');
        v_ctitle  := nullif(btrim(v_row ->> 'contact_job_title'), '');

        if v_name is null then
          v_outcome := 'rejected'; v_reason := 'company_name_missing';
          raise exception 'row refused' using errcode = 'SM101';
        end if;

        -- ---- 5 the real-data gate
        v_has_contact := v_cname is not null or v_cemail is not null or v_cphone is not null or v_ctitle is not null;
        if v_has_contact then
          if v_cemail is null then
            v_outcome := 'rejected'; v_reason := 'contact_requires_email';
            raise exception 'row refused' using errcode = 'SM101';
          end if;
          v_parts := string_to_array(v_cemail, '@');
          v_domain := lower(coalesce(v_parts[2], ''));
          if array_length(v_parts, 1) is distinct from 2
             or v_parts[1] = ''
             or v_domain !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'
             or v_domain ~ '\.\.'
             or not exists (select 1 from unnest(c_reserved) r where v_domain = r or right(v_domain, length(r) + 1) = '.' || r) then
            v_outcome := 'rejected'; v_reason := 'contact_domain_not_reserved';
            raise exception 'row refused' using errcode = 'SM101';
          end if;
          if v_cphone is not null and left(v_cphone, length(c_phone_prefix)) <> c_phone_prefix then
            v_outcome := 'rejected'; v_reason := 'contact_phone_not_reserved';
            raise exception 'row refused' using errcode = 'SM101';
          end if;
          if v_cname is null then
            v_outcome := 'rejected'; v_reason := 'contact_name_missing';
            raise exception 'row refused' using errcode = 'SM101';
          end if;
        end if;

        -- ---- attribute values: slugs only (the tenant's ICP config decides which are meaningful)
        foreach v_key in array c_attrs loop
          v_value := nullif(btrim(v_row ->> v_key), '');
          if v_value is not null and v_value !~ '^[a-z][a-z0-9_]{0,39}$' then
            v_outcome := 'rejected'; v_reason := 'invalid_attribute';
            raise exception 'row refused' using errcode = 'SM101';
          end if;
        end loop;

        -- ---- the company: website host first (never a shared host), then the normalised name
        v_host := app.website_host(v_website);
        v_host_id := case when v_host is not null and not app.is_shared_host(v_host) then v_host end;
        v_city_key := app.match_key(v_city);
        v_matches := '{}'::uuid[];
        if v_host_id is not null then
          select coalesce(array_agg(c.id), '{}'::uuid[]) into v_matches
            from public.companies c
           where c.tenant_id = p_tenant_id and app.website_host(c.website) = v_host_id;
        end if;
        if cardinality(v_matches) = 0 then
          select coalesce(array_agg(c.id), '{}'::uuid[]) into v_matches
            from public.companies c
           where c.tenant_id = p_tenant_id
             and app.match_key(c.name) = app.match_key(v_name)
             -- two different websites, or two different cities, mean two different businesses
             and not (v_host_id is not null
                      and app.website_host(c.website) is not null
                      and not app.is_shared_host(app.website_host(c.website))
                      and app.website_host(c.website) <> v_host_id)
             and not (v_city_key is not null
                      and app.match_key(c.city) is not null
                      and app.match_key(c.city) <> v_city_key);
        end if;

        if cardinality(v_matches) > 1 then
          v_outcome := 'ambiguous'; v_reason := 'ambiguous_company';
          raise exception 'row refused' using errcode = 'SM101';
        elsif cardinality(v_matches) = 1 then
          v_company_id := v_matches[1];
          select c.archived_at is not null into v_archived
            from public.companies c where c.tenant_id = p_tenant_id and c.id = v_company_id;
          if v_archived then
            v_outcome := 'rejected'; v_reason := 'archived_company';
            raise exception 'row refused' using errcode = 'SM101';
          end if;
        else
          insert into public.companies (tenant_id, name, website, country, city, industry, tags)
          values (p_tenant_id, v_name, v_website, v_country, v_city, v_industry, coalesce(v_tags, '{}'::text[]))
          returning id into v_company_id;
          v_co_created := true;
        end if;

        -- ---- the contact: by e-mail (case-insensitive), never updated
        if v_has_contact then
          select * into v_contact from public.contacts k
           where k.tenant_id = p_tenant_id and lower(k.email) = lower(v_cemail);
          if found then
            if v_contact.company_id is distinct from v_company_id then
              v_outcome := 'rejected'; v_reason := 'contact_belongs_to_other_company';
              raise exception 'row refused' using errcode = 'SM101';
            end if;
            v_contact_id := v_contact.id;
          else
            insert into public.contacts (tenant_id, company_id, full_name, email, phone, job_title)
            values (p_tenant_id, v_company_id, v_cname, v_cemail, v_cphone, v_ctitle)
            returning id into v_contact_id;
            v_ct_created := true;
          end if;
        end if;

        -- ---- the lead: an open lead for the same company (and the same contact, if the row names one) is a duplicate
        if exists (select 1 from public.leads l
                    where l.tenant_id = p_tenant_id and l.company_id = v_company_id and l.archived_at is null
                      and l.status in ('new', 'in_review', 'qualified')
                      and (v_contact_id is null or l.contact_id = v_contact_id)) then
          v_outcome := 'skipped_duplicate'; v_reason := 'existing_open_lead';
          raise exception 'row refused' using errcode = 'SM101';
        end if;
        insert into public.leads (tenant_id, company_id, contact_id, source)
        values (p_tenant_id, v_company_id, v_contact_id, v_source)
        returning id into v_lead_id;

        -- ---- attributes become claims about the company, unless a (non-archived) claim already exists
        foreach v_key in array c_attrs loop
          v_value := nullif(btrim(v_row ->> v_key), '');
          if v_value is not null then
            if exists (select 1 from public.claims cl
                        where cl.tenant_id = p_tenant_id and cl.company_id = v_company_id
                          and cl.predicate = v_key and cl.archived_at is null) then
              v_kept := v_kept + 1;
            else
              insert into public.claims (tenant_id, company_id, predicate, value, confidence)
              values (p_tenant_id, v_company_id, v_key, v_value, 'unverified')
              returning id into v_claim_id;
              -- the source of the fact: this batch (a claim link needs a stance; the batch states it)
              insert into public.evidence_links (tenant_id, evidence_id, claim_id, stance)
              values (p_tenant_id, v_evidence_id, v_claim_id, 'supports');
              v_written := v_written + 1;
            end if;
          end if;
        end loop;

        v_outcome := 'created';
      exception
        when sqlstate 'SM101' then
          -- a business-rule refusal: everything this row wrote is rolled back; the matched ids stay for a duplicate
          v_co_created := false; v_ct_created := false; v_written := 0; v_kept := 0; v_lead_id := null;
          if v_outcome is distinct from 'skipped_duplicate' then
            v_company_id := null; v_contact_id := null;
          end if;
        when others then
          v_outcome := 'rejected'; v_reason := 'data_rejected';
          v_sqlstate := sqlstate;
          get stacked diagnostics v_constraint = constraint_name;
          v_co_created := false; v_ct_created := false; v_written := 0; v_kept := 0;
          v_company_id := null; v_contact_id := null; v_lead_id := null;
      end;

      insert into public.import_rows
        (tenant_id, batch_id, row_no, outcome, reason, constraint_name, sqlstate, company_id, contact_id, lead_id,
         company_created, contact_created, attributes_written, attributes_kept)
      values
        (p_tenant_id, v_batch, v_i, v_outcome, v_reason,
         case when v_constraint ~ '^[a-z][a-z0-9_]{0,62}$' then v_constraint end,
         case when v_constraint ~ '^[a-z][a-z0-9_]{0,62}$' then v_sqlstate end,
         v_company_id, v_contact_id, v_lead_id, v_co_created, v_ct_created, v_written, v_kept);

      case v_outcome
        when 'created' then n_created := n_created + 1;
        when 'skipped_duplicate' then n_dup := n_dup + 1;
        when 'ambiguous' then n_amb := n_amb + 1;
        else n_rej := n_rej + 1;
      end case;
      n_companies := n_companies + case when v_co_created then 1 else 0 end;
      n_contacts  := n_contacts  + case when v_ct_created then 1 else 0 end;
      n_claims    := n_claims + v_written;
    end loop;

    insert into public.import_batches
      (id, tenant_id, label, content_sha256, row_count, created_count, duplicate_count, ambiguous_count, rejected_count,
       companies_created, contacts_created, claims_created)
    values
      (v_batch, p_tenant_id, p_label, v_hash, v_n, n_created, n_dup, n_amb, n_rej, n_companies, n_contacts, n_claims);

    select jsonb_build_object(
        'batch_id', case when p_dry_run then null else b.id end, 'replayed', false, 'dry_run', p_dry_run,
        'counts', jsonb_build_object('rows', b.row_count, 'created', b.created_count, 'skipped_duplicate', b.duplicate_count,
                                     'ambiguous', b.ambiguous_count, 'rejected', b.rejected_count,
                                     'companies_created', b.companies_created, 'contacts_created', b.contacts_created,
                                     'claims_created', b.claims_created),
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object(
                   'row', r.row_no, 'outcome', r.outcome, 'reason', r.reason, 'constraint', r.constraint_name,
                   'sqlstate', r.sqlstate, 'company_created', r.company_created, 'contact_created', r.contact_created,
                   'attributes_written', r.attributes_written, 'attributes_kept', r.attributes_kept,
                   'company_id', r.company_id, 'contact_id', r.contact_id, 'lead_id', r.lead_id) order by r.row_no)
            from public.import_rows r where r.tenant_id = p_tenant_id and r.batch_id = v_batch), '[]'::jsonb))
      into v_report
      from public.import_batches b where b.tenant_id = p_tenant_id and b.id = v_batch;

    if p_dry_run then
      raise exception 'dry run' using errcode = 'SM100';
    end if;
  exception
    when sqlstate 'SM100' then
      null;  -- the report is already built; the writes of the dry run are gone
  end;

  perform set_config('app.created_via', '', true);
  return v_report;
end;
$$;

revoke all on function public.import_lead_rows(uuid, uuid, jsonb, text, boolean) from public, anon;
grant execute on function public.import_lead_rows(uuid, uuid, jsonb, text, boolean) to authenticated;
