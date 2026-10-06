-- Erased marker (owner review 2026-10-07, step 0). ONE migration; earlier migrations untouched; create or replace of the LATEST definitions plus the lines named here
-- (tests/test_migration_copies.py pins every copy).
--   a. app.suppression_key_mark_erased   the 'erased' key event is appended even when the key is already suppressed (it used to be skipped by suppression_key_add, so lifting
--      the contact that had suppressed the key first lost the erased person's protection); app.erase_contact and app.erase_tenant use it and count 'suppression.erased_markers'
--   b. app.contacts_sync_suppression_keys   a key is lifted only if NO 'erased' event exists for it since its last 'lifted' event

-- ---------------------------------------------------------------------------------------------
-- app.suppression_key_mark_erased: the ERASED marker of a key. Unlike suppression_key_add it appends its event even when the key is already suppressed (by an opt-out of another
-- contact that shares the number): the erasure must outlive that suppression being lifted. Same per-key lock as add / lift. Returns whether the key was NOT suppressed before
-- (a newly suppressed key). Internal: revoked from every role.
-- ---------------------------------------------------------------------------------------------
create function app.suppression_key_mark_erased(p_tenant uuid, p_kind text, p_hmac text, p_version smallint, p_source uuid, p_by uuid) returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_was boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('suppression_key:' || p_tenant::text || ':' || p_kind || ':' || p_hmac, 0));
  v_was := app.key_active(p_tenant, p_kind, p_hmac);
  insert into suppression.key_events (tenant_id, kind, key_hmac, key_version, event, reason, source_contact_id, created_by)
  values (p_tenant, p_kind, p_hmac, p_version, 'suppressed', 'erased', p_source, p_by);
  return not v_was;
end;
$$;
revoke all on function app.suppression_key_mark_erased(uuid, text, text, smallint, uuid, uuid) from public, anon, authenticated, service_role;

create or replace function app.erase_contact(r public.erasure_requests) returns jsonb
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
  v_enq text;
  k suppression.contact_keys;
  v_keys_n bigint := 0;
  v_markers bigint := 0;
  v_unkeyed boolean;
  v_fields text;
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

  -- The last Owner cannot erase their own record: ownership is transferred first. An exception goes through the operator, after the
  -- person's identity was verified out of band, with a recorded reason (app.operator_add_owner_exception; docs/runbooks/sole-owner-erasure.md).
  -- The Owner's identity is their sign-in address; the comparison ignores case.
  if c.email is not null
     and (select count(*) from public.memberships m where m.tenant_id = r.tenant_id and m.role = 'owner') = 1
     and exists (select 1 from public.memberships m join auth.users u on u.id = m.user_id
                  where m.tenant_id = r.tenant_id and m.role = 'owner' and lower(u.email) = lower(c.email)) then
    perform app.erasure_state_error('SM305');
  end if;

  -- T010 / ADR 0020: the suppression keys are written BEFORE any identifier is removed, so a later import of the same address is recognised.
  -- A contact that holds an e-mail or a phone number with no recorded key is refused (SM221), UNLESS an Owner with aal2 marked this request
  -- "without a key" (allow_erasure_without_key): erasure itself is never blocked for good, and that step is audited and counted.
  select * into k from suppression.contact_keys where tenant_id = r.tenant_id and contact_id = c.id for update;
  v_unkeyed := (c.email is not null and k.email_hmac is null) or (c.phone is not null and k.phone_hmac is null);
  if v_unkeyed then
    if r.without_key_at is null then
      perform app.suppression_error('SM221');
    end if;
    v_counts := app.erasure_add(v_counts, 'suppression.erased_without_key', 1);
  end if;
  if c.email is not null and k.email_hmac is not null then
    -- the ERASED marker is appended even when the key is already suppressed by someone else (an opt-out): the erasure must survive that contact being lifted
    v_markers := v_markers + 1;
    if app.suppression_key_mark_erased(r.tenant_id, 'email', k.email_hmac, k.key_version, c.id, auth.uid()) then
      v_keys_n := v_keys_n + 1;
    end if;
  end if;
  if c.phone is not null and k.phone_hmac is not null then
    -- the ERASED marker is appended even when the key is already suppressed by someone else (an opt-out): the erasure must survive that contact being lifted
    v_markers := v_markers + 1;
    if app.suppression_key_mark_erased(r.tenant_id, 'phone', k.phone_hmac, k.key_version, c.id, auth.uid()) then
      v_keys_n := v_keys_n + 1;
    end if;
  end if;
  delete from suppression.contact_keys where tenant_id = r.tenant_id and contact_id = c.id;
  get diagnostics n = row_count;
  v_counts := app.erasure_add(v_counts, 'suppression.keys_written', v_keys_n);
  v_counts := app.erasure_add(v_counts, 'suppression.erased_markers', v_markers);
  v_counts := app.erasure_add(v_counts, 'suppression.contact_keys', n);

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

  -- T008: the enquiries captured on this person's leads (or from them), and what was extracted from them
  v_enq := format('(%1$s.contact_id = %2$L or %1$s.lead_id in (select l.id from public.leads l where l.tenant_id = %1$s.tenant_id and l.contact_id = %2$L))', 't', c.id);
  v_fields := format('t.requirement_id in (select q.id from public.requirements q join public.enquiries e on e.tenant_id = q.tenant_id and e.id = q.enquiry_id where q.tenant_id = t.tenant_id and %s)',
                     format('(%1$s.contact_id = %2$L or %1$s.lead_id in (select l.id from public.leads l where l.tenant_id = %1$s.tenant_id and l.contact_id = %2$L))', 'e', c.id));
  v_counts := app.erasure_add(v_counts, 'enquiries.subject',          app.erase_column(r.tenant_id, 'contact', 'enquiries', 'subject', v_enq));
  v_counts := app.erasure_add(v_counts, 'enquiries.body',             app.erase_column(r.tenant_id, 'contact', 'enquiries', 'body', v_enq));
  v_counts := app.erasure_add(v_counts, 'requirement_fields.quote',      app.erase_column(r.tenant_id, 'contact', 'requirement_fields', 'quote', v_fields));
  v_counts := app.erasure_add(v_counts, 'requirement_fields.value_text', app.erase_column(r.tenant_id, 'contact', 'requirement_fields', 'value_text', v_fields));

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

create or replace function app.erase_tenant(r public.erasure_requests) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  g record;
  v_counts jsonb := '{}'::jsonb;
  n bigint;
  k suppression.contact_keys;
  v_keys_n bigint := 0;
  v_markers bigint := 0;
begin
  -- T010 / ADR 0020: the whole workspace is erased, never refused for a missing key: the keys that exist become suppression events FIRST (the registry
  -- loop below nulls every e-mail and phone, and a changed identifier forgets its stored key)
  for k in select * from suppression.contact_keys where tenant_id = r.tenant_id order by id loop
    if k.email_hmac is not null then
      v_markers := v_markers + 1;
      if app.suppression_key_mark_erased(r.tenant_id, 'email', k.email_hmac, k.key_version, k.contact_id, auth.uid()) then
        v_keys_n := v_keys_n + 1;
      end if;
    end if;
    if k.phone_hmac is not null then
      v_markers := v_markers + 1;
      if app.suppression_key_mark_erased(r.tenant_id, 'phone', k.phone_hmac, k.key_version, k.contact_id, auth.uid()) then
        v_keys_n := v_keys_n + 1;
      end if;
    end if;
  end loop;
  delete from suppression.contact_keys where tenant_id = r.tenant_id;
  get diagnostics n = row_count;
  v_counts := app.erasure_add(v_counts, 'suppression.keys_written', v_keys_n);
  v_counts := app.erasure_add(v_counts, 'suppression.erased_markers', v_markers);
  v_counts := app.erasure_add(v_counts, 'suppression.contact_keys', n);
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

create or replace function app.contacts_sync_suppression_keys() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k suppression.contact_keys;
begin
  select * into k from suppression.contact_keys where tenant_id = new.tenant_id and contact_id = new.id;
  if not found then
    return new;
  end if;
  if new.suppressed_at is not null then
    if k.email_hmac is not null then
      perform app.suppression_key_add(new.tenant_id, 'email', k.email_hmac, k.key_version, new.suppression_reason::text, new.id, auth.uid());
    end if;
    if k.phone_hmac is not null then
      perform app.suppression_key_add(new.tenant_id, 'phone', k.phone_hmac, k.key_version, new.suppression_reason::text, new.id, auth.uid());
    end if;
  else
    if k.email_hmac is not null then
      -- review fix (steps 1): a key is lifted only when no OTHER non-erased contact of the tenant still holds it while suppressed. The per-key lock (the one
      -- suppression_key_lift takes) comes first, so two contacts lifted at once see each other's committed lift and the last one lifts the key.
      perform pg_advisory_xact_lock(hashtextextended('suppression_key:' || new.tenant_id::text || ':email:' || k.email_hmac, 0));
      if not exists (select 1 from suppression.contact_keys k2 join public.contacts c2 on c2.tenant_id = k2.tenant_id and c2.id = k2.contact_id
                      where k2.tenant_id = new.tenant_id and k2.contact_id <> new.id and k2.email_hmac = k.email_hmac and c2.erased_at is null and c2.suppressed_at is not null)
         -- ... and a key with an ERASED marker since its last lift stays suppressed, whoever else suppressed it first (a person erased by right is never re-contacted
         -- through a shared number; the marker is appended even when the key was already suppressed by an opt-out: app.suppression_key_mark_erased)
         and not exists (select 1 from suppression.key_events e where e.tenant_id = new.tenant_id and e.kind = 'email' and e.key_hmac = k.email_hmac
                            and e.event = 'suppressed' and e.reason = 'erased'
                            and e.seq > coalesce((select max(l.seq) from suppression.key_events l where l.tenant_id = e.tenant_id and l.kind = e.kind and l.key_hmac = e.key_hmac and l.event = 'lifted'), 0)) then
        perform app.suppression_key_lift(new.tenant_id, 'email', k.email_hmac, k.key_version, new.id, auth.uid());
      end if;
    end if;
    if k.phone_hmac is not null then
      -- review fix (steps 1): a key is lifted only when no OTHER non-erased contact of the tenant still holds it while suppressed. The per-key lock (the one
      -- suppression_key_lift takes) comes first, so two contacts lifted at once see each other's committed lift and the last one lifts the key.
      perform pg_advisory_xact_lock(hashtextextended('suppression_key:' || new.tenant_id::text || ':phone:' || k.phone_hmac, 0));
      if not exists (select 1 from suppression.contact_keys k2 join public.contacts c2 on c2.tenant_id = k2.tenant_id and c2.id = k2.contact_id
                      where k2.tenant_id = new.tenant_id and k2.contact_id <> new.id and k2.phone_hmac = k.phone_hmac and c2.erased_at is null and c2.suppressed_at is not null)
         -- ... and a key with an ERASED marker since its last lift stays suppressed, whoever else suppressed it first (a person erased by right is never re-contacted
         -- through a shared number; the marker is appended even when the key was already suppressed by an opt-out: app.suppression_key_mark_erased)
         and not exists (select 1 from suppression.key_events e where e.tenant_id = new.tenant_id and e.kind = 'phone' and e.key_hmac = k.phone_hmac
                            and e.event = 'suppressed' and e.reason = 'erased'
                            and e.seq > coalesce((select max(l.seq) from suppression.key_events l where l.tenant_id = e.tenant_id and l.kind = e.kind and l.key_hmac = e.key_hmac and l.event = 'lifted'), 0)) then
        perform app.suppression_key_lift(new.tenant_id, 'phone', k.phone_hmac, k.key_version, new.id, auth.uid());
      end if;
    end if;
  end if;
  return new;
end;
$$;
