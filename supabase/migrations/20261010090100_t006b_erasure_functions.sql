-- T006b / M1 (2 of 2): the erasure functions (ADR 0014).
--
--   public.request_erasure(request_id, tenant_id, scope, subject_id)   Owner, Admin   records a pending request
--   public.execute_erasure(request_id, dry_run)                        Owner          runs it (or previews it)
--   public.cancel_erasure(request_id)                                  Owner, Admin   cancels a pending request
--
-- Every function is SECURITY DEFINER with an empty search_path, owned by the migration role (the trusted role of the
-- exception in the previous migration), executable by authenticated only. Each one:
--   * takes a REQUEST id (execute, cancel) or the tenant it must be proven to belong to (request): the tenant of everything
--     that follows comes from the request row, never from a parameter;
--   * answers every refusal that happens BEFORE the caller's role in that tenant is proven with the same generic 42501
--     ("erasure action not permitted"), so a stranger cannot tell an unknown request from someone else's;
--   * only afterwards uses fixed-message states. No message ever carries a row value.
--
-- SQLSTATEs:  42501 not permitted / unknown / someone else's      22023 invalid argument      23503 invalid reference
--             23505 request id already used (the same answer whether it is yours or another tenant's)
--             SM301 request is not pending   SM302 the 24-hour window has not elapsed
--             SM303 already executed (cannot cancel)   SM304 was cancelled (cannot execute)
--
-- Internal procedures (schema app, callable by no client role) do the work; the scope handlers choose WHICH rows, the
-- registry says WHAT happens to each column. Identifiers in dynamic SQL come from the registry or from this file, never from a caller.

-- ---------------------------------------------------------------------------------------------
-- Small helpers
-- ---------------------------------------------------------------------------------------------
create function app.erasure_deny() returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'erasure action not permitted' using errcode = '42501';
end;
$$;

create function app.erasure_state_error(p_code text) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', case p_code
      when 'SM301' then 'erasure request is not pending'
      when 'SM302' then 'erasure window has not elapsed'
      when 'SM303' then 'erasure request already executed'
      when 'SM304' then 'erasure request was cancelled'
      when 'used'  then 'erasure request id already used'
      when 'invalid' then 'invalid argument'
      else 'invalid reference' end
    using errcode = case p_code when 'used' then '23505' when 'invalid' then '22023' when 'reference' then '23503' else p_code end;
end;
$$;

create function app.erasure_json(r public.erasure_requests, p_replayed boolean) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('id', r.id, 'tenant_id', r.tenant_id, 'scope', r.scope, 'subject_id', r.subject_id,
                            'status', r.status, 'execute_after', r.execute_after, 'replayed', p_replayed)
$$;

create function app.erasure_add(p_counts jsonb, p_key text, p_n bigint) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when coalesce(p_n, 0) = 0 then p_counts
              else p_counts || jsonb_build_object(p_key, coalesce((p_counts ->> p_key)::bigint, 0) + p_n) end
$$;

create function app.erasure_regex_escape(p text) returns text
language sql
immutable
set search_path = ''
as $$ select regexp_replace(p, '([\\.^$*+?()\[\]{}|/-])', '\\\1', 'g') $$;

-- An e-mail address, as a case-insensitive pattern that does not match inside a longer address.
create function app.erasure_email_pattern(p_email text) returns text
language sql
immutable
set search_path = ''
as $$
  select case when nullif(btrim(p_email), '') is null then null
              else '(?<![A-Za-z0-9._%+-])' || app.erasure_regex_escape(btrim(p_email)) || '(?![A-Za-z0-9_-])' end
$$;

-- A phone number: its last ten digits (the national number), with up to two separator characters between digits
-- (space . _ ( ) -), not matching inside a longer run of digits. Fewer than seven digits identify nobody: no pattern.
create function app.erasure_phone_pattern(p_phone text) returns text
language sql
immutable
set search_path = ''
as $$
  select case when length(d) < 7 then null
              else '(?<![0-9])' || array_to_string(regexp_split_to_array(right(d, 10), ''), '[ ._()-]{0,2}') || '(?![0-9])' end
    from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) s
$$;

-- A website host as a pattern (a host that many businesses share, such as a social page, identifies nobody).
create function app.erasure_host_pattern(p_website text) returns text
language sql
immutable
set search_path = ''
as $$
  select case when h is null or app.is_shared_host(h) then null
              else '(?<![A-Za-z0-9.-])' || app.erasure_regex_escape(h) || '(?![A-Za-z0-9_-]|\.[A-Za-z0-9])' end
    from (select app.website_host(p_website) as h) s
$$;

-- A name, normalised for comparison; NULL when it is too short to compare without hitting strangers.
create function app.erasure_name(p_name text) returns text
language sql
immutable
set search_path = ''
as $$ select case when char_length(app.match_key(p_name)) >= 3 then app.match_key(p_name) end $$;

revoke all on function app.erasure_deny(), app.erasure_state_error(text), app.erasure_json(public.erasure_requests, boolean),
  app.erasure_add(jsonb, text, bigint), app.erasure_regex_escape(text), app.erasure_email_pattern(text),
  app.erasure_phone_pattern(text), app.erasure_host_pattern(text), app.erasure_name(text) from public;

-- ---------------------------------------------------------------------------------------------
-- The two workhorses
-- ---------------------------------------------------------------------------------------------

-- Apply the registry's strategy for (table, column, scope) to the rows of ONE tenant that p_where selects. p_where is a SQL
-- fragment written by this file (never by a caller) over the alias t. Returns the number of rows changed.
create function app.erase_column(p_tenant_id uuid, p_scope text, p_table text, p_column text, p_where text) returns bigint
language plpgsql
set search_path = ''
as $$
declare
  g erasure.registry;
  v_set  text;
  v_cond text;
  n bigint;
begin
  select * into g from erasure.registry where table_name = p_table and column_name = p_column and scope = p_scope;
  if not found then
    raise exception 'erasure registry has no row for %.% in scope %', p_table, p_column, p_scope;
  end if;
  case g.strategy
    when 'null' then
      v_set := format('%I = null', p_column);
      v_cond := format('t.%I is not null', p_column);
    when 'tombstone' then
      v_set := format('%I = %L', p_column, g.replacement);
      v_cond := format('t.%I is not null and t.%I <> %L', p_column, p_column, g.replacement);
    when 'empty_array' then
      v_set := format('%I = ''{}''', p_column);
      v_cond := format('cardinality(t.%I) > 0', p_column);
    else
      raise exception 'strategy % is not a column strategy', g.strategy;
  end case;
  if g.with_set is not null then
    v_set := v_set || ', ' || g.with_set;
  end if;
  execute format('update public.%I t set %s where t.tenant_id = $1 and (%s) and %s', p_table, v_set, p_where, v_cond)
    using p_tenant_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- The sweep. For every free-text PII column of the workspace (the registry's 'sweep' rows; a company's identity columns are
-- skipped: contact erasure never touches a company, decision 4):
--   * each identifier pattern is replaced INSIDE the text by the token erased-1 (case-insensitive);
--   * a field that EQUALS the name is tombstoned;
--   * a field that merely CONTAINS the name is not touched and is listed for manual review (table, column, row id; never a value).
create function app.erasure_sweep(
  p_tenant_id uuid, p_patterns text[], p_name text, out o_counts jsonb, out o_review jsonb, out o_truncated boolean
)
language plpgsql
set search_path = ''
as $$
declare
  s record;
  pat text;
  v_expr text;
  v_cond text;
  v_key text;
  v_ids uuid[];
  v_id uuid;
  n bigint;
  c_max constant int := 1000;
begin
  o_counts := '{}'::jsonb;
  o_review := '[]'::jsonb;
  o_truncated := false;
  for s in
    select r.table_name, r.column_name, r.strategy, r.replacement
      from erasure.registry r
     where r.scope = 'sweep'
       and not exists (select 1 from erasure.registry x
                        where x.table_name = r.table_name and x.column_name = r.column_name and x.scope = 'company' and x.tenant_exempt)
     order by r.table_name, r.column_name
  loop
    v_key := s.table_name || '.' || s.column_name;

    -- exact identifiers: replaced inside the text
    if cardinality(p_patterns) > 0 then
      if s.strategy = 'substring' then
        v_expr := format('t.%I', s.column_name);
        v_cond := 'false';
        foreach pat in array p_patterns loop
          v_expr := format('regexp_replace(%s, %L, ''erased-1'', ''gi'')', v_expr, pat);
          v_cond := v_cond || format(' or t.%I ~* %L', s.column_name, pat);
        end loop;
        execute format('update public.%I t set %I = %s where t.tenant_id = $1 and t.%I is not null and (%s)',
                       s.table_name, s.column_name, v_expr, s.column_name, v_cond) using p_tenant_id;
      else
        v_expr := 'u.e';
        v_cond := 'false';
        foreach pat in array p_patterns loop
          v_expr := format('regexp_replace(%s, %L, ''erased-1'', ''gi'')', v_expr, pat);
          v_cond := v_cond || format(' or e ~* %L', pat);
        end loop;
        execute format('update public.%1$I t set %2$I = array(select %3$s from unnest(t.%2$I) with ordinality u(e, o) order by o) '
                       'where t.tenant_id = $1 and exists (select 1 from unnest(t.%2$I) e where %4$s)',
                       s.table_name, s.column_name, v_expr, v_cond) using p_tenant_id;
      end if;
      get diagnostics n = row_count;
      o_counts := app.erasure_add(o_counts, v_key, n);
    end if;

    if p_name is not null then
      -- a whole field that equals the name: tombstoned
      if s.strategy = 'substring' then
        execute format('update public.%1$I t set %2$I = %3$L where t.tenant_id = $1 and t.%2$I is not null and t.%2$I <> %3$L and app.match_key(t.%2$I) = $2',
                       s.table_name, s.column_name, s.replacement) using p_tenant_id, p_name;
      else
        execute format('update public.%1$I t set %2$I = array(select case when app.match_key(u.e) = $2 then %3$L else u.e end from unnest(t.%2$I) with ordinality u(e, o) order by o) '
                       'where t.tenant_id = $1 and exists (select 1 from unnest(t.%2$I) e where app.match_key(e) = $2)',
                       s.table_name, s.column_name, s.replacement) using p_tenant_id, p_name;
      end if;
      get diagnostics n = row_count;
      o_counts := app.erasure_add(o_counts, v_key, n);

      -- a field that merely contains the name: listed, untouched
      if s.strategy = 'substring' then
        execute format('select array_agg(q.id order by q.id) from (select t.id from public.%I t where t.tenant_id = $1 and t.%I is not null '
                       'and position($2 in app.match_key(t.%I)) > 0 order by t.id limit %s) q',
                       s.table_name, s.column_name, s.column_name, c_max + 1) into v_ids using p_tenant_id, p_name;
      else
        execute format('select array_agg(q.id order by q.id) from (select t.id from public.%I t where t.tenant_id = $1 '
                       'and exists (select 1 from unnest(t.%I) e where position($2 in app.match_key(e)) > 0) order by t.id limit %s) q',
                       s.table_name, s.column_name, c_max + 1) into v_ids using p_tenant_id, p_name;
      end if;
      foreach v_id in array coalesce(v_ids, '{}'::uuid[]) loop
        if jsonb_array_length(o_review) >= c_max then
          o_truncated := true;
          exit;
        end if;
        o_review := o_review || jsonb_build_array(jsonb_build_object('table', s.table_name, 'column', s.column_name, 'id', v_id));
      end loop;
    end if;
  end loop;
end;
$$;

revoke all on function app.erase_column(uuid, text, text, text, text), app.erasure_sweep(uuid, text[], text) from public;

-- ---------------------------------------------------------------------------------------------
-- The three scopes
-- ---------------------------------------------------------------------------------------------

-- ONE CONTACT. The contact row, its ledger reference, the free text of the leads / opportunities linked to it; then the sweep
-- for its e-mail, phone and name. Never touches a company.
create function app.erase_contact(r public.erasure_requests) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  c public.contacts;
  v_counts jsonb := '{}'::jsonb;
  v_review jsonb := '[]'::jsonb;
  v_truncated boolean := false;
  v_patterns text[];
  v_name text;
  v_phone_digits text;
  sw record;
  d record;
  n bigint;
begin
  select * into c from public.contacts where id = r.subject_id and tenant_id = r.tenant_id for update;
  if not found then
    perform app.erasure_state_error('reference');
  end if;
  if c.erased_at is not null then
    -- nothing identifying is left to search for
    return jsonb_build_object('counts', v_counts, 'review', v_review, 'review_truncated', false);
  end if;

  -- what identifies the person, taken BEFORE the row is anonymised
  v_patterns := array_remove(array[app.erasure_email_pattern(c.email), app.erasure_phone_pattern(c.phone)], null);
  v_name := app.erasure_name(c.full_name);
  v_phone_digits := nullif(regexp_replace(coalesce(c.phone, ''), '[^0-9]', '', 'g'), '');

  v_counts := app.erasure_add(v_counts, 'contacts.full_name', app.erase_column(r.tenant_id, 'contact', 'contacts', 'full_name', format('t.id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'contacts.email',     app.erase_column(r.tenant_id, 'contact', 'contacts', 'email',     format('t.id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'contacts.phone',     app.erase_column(r.tenant_id, 'contact', 'contacts', 'phone',     format('t.id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'contacts.job_title', app.erase_column(r.tenant_id, 'contact', 'contacts', 'job_title', format('t.id = %L', c.id)));
  update public.contacts set erased_at = now(), archived_at = coalesce(archived_at, now()) where id = c.id;

  -- the consent ledger is KEPT (event, channel, basis, type, time); only its reference is anonymised
  v_counts := app.erasure_add(v_counts, 'consent_events.evidence_ref', app.erase_column(r.tenant_id, 'contact', 'consent_events', 'evidence_ref', format('t.contact_id = %L', c.id)));
  -- what was written about this person in the leads and opportunities linked to them
  v_counts := app.erasure_add(v_counts, 'leads.source',               app.erase_column(r.tenant_id, 'contact', 'leads', 'source',               format('t.contact_id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'leads.disqualified_reason',  app.erase_column(r.tenant_id, 'contact', 'leads', 'disqualified_reason',  format('t.contact_id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'opportunities.title',        app.erase_column(r.tenant_id, 'contact', 'opportunities', 'title',        format('t.contact_id = %L', c.id)));
  v_counts := app.erasure_add(v_counts, 'opportunities.lost_reason',  app.erase_column(r.tenant_id, 'contact', 'opportunities', 'lost_reason',  format('t.contact_id = %L', c.id)));

  select * into sw from app.erasure_sweep(r.tenant_id, v_patterns, v_name);
  for d in select key, value from jsonb_each_text(sw.o_counts) loop
    v_counts := app.erasure_add(v_counts, d.key, d.value::bigint);
  end loop;
  v_review := sw.o_review;
  v_truncated := sw.o_truncated;

  -- another contact that carries the same e-mail or number is the same person in a structured column: listed for the Owner
  for d in
    select o.id, (lower(o.email) = lower(c.email)) as same_email
      from public.contacts o
     where o.tenant_id = r.tenant_id and o.id <> c.id and o.erased_at is null
       and ((c.email is not null and lower(o.email) = lower(c.email))
         or (v_phone_digits is not null and regexp_replace(coalesce(o.phone, ''), '[^0-9]', '', 'g') = v_phone_digits))
     order by o.id
  loop
    v_review := v_review || jsonb_build_array(jsonb_build_object('table', 'contacts', 'column', case when d.same_email then 'email' else 'phone' end, 'id', d.id));
  end loop;

  return jsonb_build_object('counts', v_counts, 'review', v_review, 'review_truncated', v_truncated);
end;
$$;

-- ONE COMPANY (a sole proprietor's business, chosen by the Owner). Its identity, its leads and opportunities, the claims and the
-- evidence attached to it, its existing audit rows; then the sweep for its website host and its name. Its contacts are untouched
-- (each is their own data principal).
create function app.erase_company(r public.erasure_requests) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  co public.companies;
  v_counts jsonb := '{}'::jsonb;
  v_patterns text[];
  v_name text;
  v_leads text;
  v_claims text;
  v_evidence text;
  v_keys constant text[] := array['name', 'website', 'city', 'region'];
  sw record;
  d record;
  n bigint;
begin
  select * into co from public.companies where id = r.subject_id and tenant_id = r.tenant_id for update;
  if not found then
    perform app.erasure_state_error('reference');
  end if;
  if co.erased_at is not null then
    return jsonb_build_object('counts', v_counts, 'review', '[]'::jsonb, 'review_truncated', false);
  end if;

  v_patterns := array_remove(array[app.erasure_host_pattern(co.website)], null);
  v_name := app.erasure_name(co.name);

  -- row selectors, over the alias t of the table being changed
  v_leads := format('t.company_id = %L', co.id);
  v_claims := format('(t.company_id = %1$L or t.lead_id in (select l.id from public.leads l where l.tenant_id = t.tenant_id and l.company_id = %1$L))', co.id);
  v_evidence := format($f$t.id in (select k.evidence_id from public.evidence_links k where k.tenant_id = t.tenant_id and (
      k.company_id = %1$L
      or k.lead_id in (select l.id from public.leads l where l.tenant_id = t.tenant_id and l.company_id = %1$L)
      or k.claim_id in (select c.id from public.claims c where c.tenant_id = t.tenant_id and (
           c.company_id = %1$L or c.lead_id in (select l.id from public.leads l where l.tenant_id = t.tenant_id and l.company_id = %1$L)))))$f$, co.id);

  v_counts := app.erasure_add(v_counts, 'evidence.url',       app.erase_column(r.tenant_id, 'company', 'evidence', 'url',       v_evidence));
  v_counts := app.erasure_add(v_counts, 'evidence.reference', app.erase_column(r.tenant_id, 'company', 'evidence', 'reference', v_evidence));
  v_counts := app.erasure_add(v_counts, 'evidence.snippet',   app.erase_column(r.tenant_id, 'company', 'evidence', 'snippet',   v_evidence));
  v_counts := app.erasure_add(v_counts, 'claims.value',       app.erase_column(r.tenant_id, 'company', 'claims', 'value',       v_claims));
  v_counts := app.erasure_add(v_counts, 'leads.source',              app.erase_column(r.tenant_id, 'company', 'leads', 'source',              v_leads));
  v_counts := app.erasure_add(v_counts, 'leads.disqualified_reason', app.erase_column(r.tenant_id, 'company', 'leads', 'disqualified_reason', v_leads));
  v_counts := app.erasure_add(v_counts, 'opportunities.title',       app.erase_column(r.tenant_id, 'company', 'opportunities', 'title',       v_leads));
  v_counts := app.erasure_add(v_counts, 'opportunities.lost_reason', app.erase_column(r.tenant_id, 'company', 'opportunities', 'lost_reason', v_leads));

  v_counts := app.erasure_add(v_counts, 'companies.name',    app.erase_column(r.tenant_id, 'company', 'companies', 'name',    format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.website', app.erase_column(r.tenant_id, 'company', 'companies', 'website', format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.city',    app.erase_column(r.tenant_id, 'company', 'companies', 'city',    format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.region',  app.erase_column(r.tenant_id, 'company', 'companies', 'region',  format('t.id = %L', co.id)));
  v_counts := app.erasure_add(v_counts, 'companies.tags',    app.erase_column(r.tenant_id, 'company', 'companies', 'tags',    format('t.id = %L', co.id)));
  update public.companies set erased_at = now(), archived_at = coalesce(archived_at, now()) where id = co.id;

  -- audit rows written before the four identity columns were classified PII carry their values: remove those KEYS (nothing else)
  update public.audit_events a
     set old_values = a.old_values - v_keys, new_values = a.new_values - v_keys
   where a.tenant_id = r.tenant_id and a.entity_type = 'company' and a.entity_id = co.id
     and (a.old_values ?| v_keys or a.new_values ?| v_keys);
  get diagnostics n = row_count;
  v_counts := app.erasure_add(v_counts, 'audit_events.values', n);

  select * into sw from app.erasure_sweep(r.tenant_id, v_patterns, v_name);
  for d in select key, value from jsonb_each_text(sw.o_counts) loop
    v_counts := app.erasure_add(v_counts, d.key, d.value::bigint);
  end loop;
  return jsonb_build_object('counts', v_counts, 'review', sw.o_review, 'review_truncated', sw.o_truncated);
end;
$$;

-- THE WHOLE WORKSPACE. Every registered PII column in every row, and every contact. A company's identity (name, website, city,
-- region) is deliberately left: a business is not a person, and a sole proprietor is erased through the company scope (decision 4).
create function app.erase_tenant(r public.erasure_requests) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  g record;
  v_counts jsonb := '{}'::jsonb;
  n bigint;
begin
  for g in
    select x.table_name, x.column_name from erasure.registry x where x.scope = 'tenant' order by x.table_name, x.column_name
  loop
    v_counts := app.erasure_add(v_counts, g.table_name || '.' || g.column_name,
                                app.erase_column(r.tenant_id, 'tenant', g.table_name, g.column_name, 'true'));
  end loop;
  update public.contacts set erased_at = now(), archived_at = coalesce(archived_at, now())
   where tenant_id = r.tenant_id and erased_at is null;
  get diagnostics n = row_count;
  v_counts := app.erasure_add(v_counts, 'contacts.erased', n);
  return jsonb_build_object('counts', v_counts, 'review', '[]'::jsonb, 'review_truncated', false);
end;
$$;

revoke all on function app.erase_contact(public.erasure_requests), app.erase_company(public.erasure_requests),
  app.erase_tenant(public.erasure_requests) from public;

-- ---------------------------------------------------------------------------------------------
-- The three public functions
-- ---------------------------------------------------------------------------------------------
create function public.request_erasure(
  p_request_id uuid,
  p_tenant_id  uuid,
  p_scope      text,
  p_subject_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope public.erasure_scope;
  r public.erasure_requests;
begin
  -- 1. who: an Owner or Admin of that tenant. Everything before this line answers the generic refusal.
  if auth.uid() is null or p_request_id is null or p_tenant_id is null
     or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.erasure_deny();
  end if;
  -- 2. what
  if p_scope is null or p_scope not in ('contact', 'company', 'tenant') then
    perform app.erasure_state_error('invalid');
  end if;
  v_scope := p_scope::public.erasure_scope;
  if (v_scope = 'tenant') <> (p_subject_id is null) then
    perform app.erasure_state_error('invalid');
  end if;
  if v_scope = 'contact' and not exists (select 1 from public.contacts where id = p_subject_id and tenant_id = p_tenant_id) then
    perform app.erasure_state_error('reference');
  end if;
  if v_scope = 'company' and not exists (select 1 from public.companies where id = p_subject_id and tenant_id = p_tenant_id) then
    perform app.erasure_state_error('reference');
  end if;
  -- 3. idempotency
  perform pg_advisory_xact_lock(hashtextextended('erasure:' || p_tenant_id::text, 0));
  select * into r from public.erasure_requests where id = p_request_id;
  if found then
    if r.tenant_id = p_tenant_id and r.scope = v_scope and r.subject_id is not distinct from p_subject_id then
      return app.erasure_json(r, true);
    end if;
    perform app.erasure_state_error('used');
  end if;
  begin
    insert into public.erasure_requests (id, tenant_id, scope, subject_id, requested_by, execute_after)
    values (p_request_id, p_tenant_id, v_scope, p_subject_id, auth.uid(),
            case when v_scope = 'tenant' then now() + interval '24 hours' else now() end)
    returning * into r;
  exception when unique_violation then
    perform app.erasure_state_error('used');
  end;
  return app.erasure_json(r, false);
end;
$$;

create function public.cancel_erasure(p_request_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.erasure_requests;
begin
  select * into r from public.erasure_requests where id = p_request_id;
  if auth.uid() is null or not found
     or not app.has_tenant_role(r.tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.erasure_deny();
  end if;
  perform pg_advisory_xact_lock(hashtextextended('erasure:' || r.tenant_id::text, 0));
  select * into r from public.erasure_requests where id = p_request_id for update;
  if r.status = 'cancelled' then
    return app.erasure_json(r, true);
  elsif r.status = 'executed' then
    perform app.erasure_state_error('SM303');
  elsif r.status <> 'pending' then
    perform app.erasure_state_error('SM301');
  end if;
  update public.erasure_requests set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now()
   where id = r.id returning * into r;
  return app.erasure_json(r, false);
end;
$$;

create function public.execute_erasure(p_request_id uuid, p_dry_run boolean default false) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.erasure_requests;
  v_body jsonb;
  v_result jsonb;
  v_note constant text :=
    'Erasure is complete for structured data and for exact identifiers (e-mail address, phone number, website host). '
    'Names are matched only when a whole field equals the name; free text that merely contains a name is listed under review '
    'and left unchanged, and the Owner decides. Files already exported or downloaded, and backups, are outside this procedure.';
begin
  select * into r from public.erasure_requests where id = p_request_id;
  if auth.uid() is null or not found or not app.has_tenant_role(r.tenant_id, array['owner']::public.app_role[]) then
    perform app.erasure_deny();
  end if;
  -- one erasure at a time per workspace; re-read the row once the lock is held
  perform pg_advisory_xact_lock(hashtextextended('erasure:' || r.tenant_id::text, 0));
  select * into r from public.erasure_requests where id = p_request_id for update;

  if r.status = 'executed' then
    return r.result || jsonb_build_object('replayed', true);
  elsif r.status = 'cancelled' then
    perform app.erasure_state_error('SM304');
  elsif r.status <> 'pending' then
    perform app.erasure_state_error('SM301');
  end if;
  if r.scope = 'tenant' and not p_dry_run and now() < r.execute_after then
    perform app.erasure_state_error('SM302');
  end if;

  begin
    -- open the door (condition b): the setting names this request and the request says 'executing'
    perform set_config('app.erasure_request', r.id::text, true);
    update public.erasure_requests set status = 'executing' where id = r.id;

    v_body := case r.scope
                when 'contact' then app.erase_contact(r)
                when 'company' then app.erase_company(r)
                else app.erase_tenant(r)
              end;
    v_result := v_body || jsonb_build_object(
      'request_id', r.id,
      'scope', r.scope,
      'status', case when p_dry_run then 'dry_run' else 'executed' end,
      'dry_run', p_dry_run,
      'exports_logged', (select count(*) from public.data_exports e where e.tenant_id = r.tenant_id),
      'note', v_note);

    if p_dry_run then
      -- unwind everything done above (rows, audit rows, the status); the answer travels in the exception text
      raise exception '%', v_result::text using errcode = 'SM399';
    end if;

    update public.erasure_requests
       set status = 'executed', executed_by = auth.uid(), executed_at = now(), result = v_result
     where id = r.id;
  exception when sqlstate 'SM399' then
    return sqlerrm::jsonb;
  end;

  perform set_config('app.erasure_request', '', true);
  return v_result || jsonb_build_object('replayed', false);
end;
$$;

revoke all on function public.request_erasure(uuid, uuid, text, uuid), public.cancel_erasure(uuid), public.execute_erasure(uuid, boolean)
  from public, anon;
grant execute on function public.request_erasure(uuid, uuid, text, uuid), public.cancel_erasure(uuid), public.execute_erasure(uuid, boolean)
  to authenticated;

comment on function public.request_erasure(uuid, uuid, text, uuid) is 'ADR 0014: Owner or Admin records a pending erasure request (contact, company, tenant). Idempotent on the request id.';
comment on function public.execute_erasure(uuid, boolean) is 'ADR 0014: Owner runs a request (or previews it with p_dry_run). All or nothing; a replay returns the stored result.';
comment on function public.cancel_erasure(uuid) is 'ADR 0014: Owner or Admin cancels a pending request.';
