-- T006b / M2: the last Owner cannot erase themselves, and the operator adds family members (ADR 0014 open question 2, ADR 0015).
--
--   SM305  erase_contact refuses a contact whose address is the sign-in address of the workspace's ONLY Owner: ownership is transferred first.
--          The preview refuses too. Nothing changes and the request stays pending.
--   app.operator_add_member(slug, email, role, reason)
--          operator only (schema app, owner-executable, refuses any session with a request identity). Adds an EXISTING account (the person
--          must have been invited: hosted sign-up is closed) to a workspace as admin, sales or viewer. Never owner. A reason is required
--          and recorded in the audit log (the membership trigger records the row, as the system).
--   app.operator_add_owner_exception(slug, email, reason)
--          the recorded exception for "the sole Owner is the person being erased": adds a second Owner after out-of-band identity
--          verification. The reason (20+ characters) states how the person was verified.
-- Same function bodies as 20261010090100 apart from the SM305 lines.

create or replace function app.erasure_state_error(p_code text) returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', case p_code
      when 'SM301' then 'erasure request is not pending'
      when 'SM302' then 'erasure window has not elapsed'
      when 'SM303' then 'erasure request already executed'
      when 'SM304' then 'erasure request was cancelled'
      when 'SM305' then 'ownership must be transferred before this contact can be erased'
      when 'used'  then 'erasure request id already used'
      when 'invalid' then 'invalid argument'
      else 'invalid reference' end
    using errcode = case p_code when 'used' then '23505' when 'invalid' then '22023' when 'reference' then '23503' else p_code end;
end;
$$;

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

-- ---------------------------------------------------------------------------------------------
-- The operator's two member functions
-- ---------------------------------------------------------------------------------------------
create function app.operator_add_member(p_tenant_slug text, p_email text, p_role text, p_reason text) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user   uuid;
  v_member uuid;
begin
  if auth.uid() is not null then
    raise exception 'operator function' using errcode = '42501';
  end if;
  if p_role is null or p_role not in ('admin', 'sales', 'viewer') then
    raise exception 'invalid role' using errcode = '22023';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 or char_length(p_reason) > 200 or not app.text_is_clean(p_reason) then
    raise exception 'a reason is required' using errcode = '22023';
  end if;
  select t.id into v_tenant from public.tenants t where t.slug = p_tenant_slug;
  if v_tenant is null then
    raise exception 'unknown workspace' using errcode = '23503';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'no such account: invite the person first' using errcode = '23503';
  end if;
  if exists (select 1 from public.memberships m where m.tenant_id = v_tenant and m.user_id = v_user) then
    raise exception 'already a member' using errcode = '23505';
  end if;
  insert into public.memberships (tenant_id, user_id, role) values (v_tenant, v_user, p_role::public.app_role) returning id into v_member;
  perform app.write_audit_event(v_tenant, 'membership.operator_added', 'membership', v_member, null,
                                jsonb_build_object('role', p_role), jsonb_build_object('reason', p_reason));
end;
$$;

create function app.operator_add_owner_exception(p_tenant_slug text, p_email text, p_reason text) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
  v_user   uuid;
  v_member uuid;
begin
  if auth.uid() is not null then
    raise exception 'operator function' using errcode = '42501';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 20 or char_length(p_reason) > 200 or not app.text_is_clean(p_reason) then
    raise exception 'a reason of at least 20 characters is required' using errcode = '22023';
  end if;
  select t.id into v_tenant from public.tenants t where t.slug = p_tenant_slug;
  if v_tenant is null then
    raise exception 'unknown workspace' using errcode = '23503';
  end if;
  select u.id into v_user from auth.users u where lower(u.email) = lower(btrim(p_email));
  if v_user is null then
    raise exception 'no such account: invite the person first' using errcode = '23503';
  end if;
  if exists (select 1 from public.memberships m where m.tenant_id = v_tenant and m.user_id = v_user) then
    raise exception 'already a member: change the role in the dashboard, not here' using errcode = '23505';
  end if;
  insert into public.memberships (tenant_id, user_id, role) values (v_tenant, v_user, 'owner') returning id into v_member;
  perform app.write_audit_event(v_tenant, 'membership.operator_added_owner', 'membership', v_member, null,
                                jsonb_build_object('role', 'owner'), jsonb_build_object('reason', p_reason));
end;
$$;
revoke all on function app.operator_add_member(text, text, text, text), app.operator_add_owner_exception(text, text, text)
  from public, anon, authenticated, service_role;
