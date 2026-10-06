-- Consent ledger, consent functions, suppression and app.can_contact.
-- Roles: Sales+ record withdrawal / suppress / grant (grant needs basis + evidence);
--        only Admin+ lifts a suppression. Viewers can do none of it.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

-- helper: ledger rows for the tenant-A base contact
create function pg_temp.ledger(p_contact text default 'a_contact') returns bigint
language sql as $$ select count(*) from public.consent_events where contact_id = tests.rid(p_contact) $$;

-- ================================================================ authorization
-- who may call record_consent (grant)
create function pg_temp.grant_sql(p_tenant text, p_contact text, p_ref text default 'form:123') returns text
language sql as $$
  select format($q$select public.record_consent(%L, %L, 'email', 'granted', 'explicit_consent', 'web_form', %L)$q$,
                tests.tid(p_tenant), tests.rid(p_contact), p_ref)
$$;

select is(tests.outcome_as(tests.uid('a_viewer'), pg_temp.grant_sql('a', 'a_contact')), '42501', 'viewer: DENY record_consent');
select is(tests.outcome_as(tests.uid('outsider'), pg_temp.grant_sql('a', 'a_contact')), '42501', 'outsider: DENY record_consent');
select is(tests.outcome_as(null, pg_temp.grant_sql('a', 'a_contact')), '42501', 'anon: DENY record_consent');
select is(tests.outcome_as(tests.uid('b_owner'), pg_temp.grant_sql('a', 'a_contact')), '42501', 'owner of B stating tenant A: DENY');
select is(tests.outcome_as(tests.uid('a_owner'), pg_temp.grant_sql('a', 'b_contact')), 'P0002',
  'A owner stating tenant A but naming a tenant-B contact: not found');
select is(tests.outcome_as(tests.uid('a_owner'), pg_temp.grant_sql('b', 'b_contact')), '42501',
  'A owner stating tenant B (the contact''s tenant): DENY (not a member there)');
select is(pg_temp.ledger(), 0::bigint, 'none of the denied calls wrote a ledger row');
select is((select email_consent::text from public.contacts where id = tests.rid('a_contact')), 'unknown', '... or changed any state');

-- the same tenant/contact binding for suppress and lift (a contact of ANOTHER tenant is "not found")
select is(tests.outcome_as(tests.uid('a_owner'), format($q$select public.suppress_contact(%L, %L, 'manual')$q$, tests.tid('a'), tests.rid('b_contact'))),
  'P0002', 'suppress: tenant-A owner stating tenant A but naming a tenant-B contact -> not found');
select is((select suppressed_at is null from public.contacts where id = tests.rid('b_contact')), true, '... and tenant B''s contact was not touched');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$select public.suppress_contact(%L, %L, 'manual')$q$, tests.tid('b'), tests.rid('b_contact'))),
  '42501', 'suppress: tenant-A owner stating tenant B -> DENY (not a member there)');
update public.contacts set suppressed_at = now(), suppression_reason = 'legal' where id = tests.rid('b_contact');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$select public.lift_suppression(%L, %L, 'written', 'ref:1')$q$, tests.tid('a'), tests.rid('b_contact'))),
  'P0002', 'lift: tenant-A owner naming a tenant-B contact -> not found');
select is((select suppressed_at is not null from public.contacts where id = tests.rid('b_contact')), true, '... and tenant B''s suppression is intact');
update public.contacts set suppressed_at = null, suppression_reason = null where id = tests.rid('b_contact');

-- ================================================================ granting
select is(tests.outcome_as(tests.uid('a_sales'), format($q$select public.record_consent(%L, %L, 'email', 'granted')$q$, tests.tid('a'), tests.rid('a_contact'))),
  '22023', 'grant without basis and evidence is refused');
select is(tests.outcome_as(tests.uid('a_sales'), format($q$select public.record_consent(%L, %L, 'email', 'granted', 'explicit_consent', 'web_form')$q$, tests.tid('a'), tests.rid('a_contact'))),
  '22023', 'grant without an evidence reference is refused');
select is(tests.outcome_as(tests.uid('a_sales'), format($q$select public.record_consent(%L, %L, 'email', 'unknown')$q$, tests.tid('a'), tests.rid('a_contact'))),
  '22023', 'status must be granted or withdrawn');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.grant_sql('a', 'a_contact', 'jane doe')), '23514',
  'an evidence reference with spaces (e.g. a name) is refused');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.grant_sql('a', 'a_contact', 'jane@example.test')), '23514',
  'an evidence reference containing an address is refused');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.grant_sql('a', 'a_contact', repeat('x', 121))), '23514',
  'an evidence reference over 120 characters is refused');
select is((select email_consent::text from public.contacts where id = tests.rid('a_contact')), 'unknown',
  'a refused grant leaves the contact state untouched (atomic)');

select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.grant_sql('a', 'a_contact')), 'rows:1', 'ALLOW: sales records an email grant');
select is((select email_consent::text from public.contacts where id = tests.rid('a_contact')), 'granted', 'contact state updated');
select is((select whatsapp_consent::text from public.contacts where id = tests.rid('a_contact')), 'unknown', '... only for that channel');
select results_eq(
  format($$select event_type::text, channel::text, basis::text, evidence_type::text, evidence_ref, recorded_by
           from public.consent_events where contact_id = %L$$, tests.rid('a_contact')),
  format($$values ('granted'::text, 'email'::text, 'explicit_consent'::text, 'web_form'::text, 'form:123'::text, %L::uuid)$$, tests.uid('a_sales')),
  'ledger row records event, channel, basis, evidence and who recorded it');

-- idempotent: repeating the current state adds nothing and returns the SAME ledger row
select is(
  tests.scalar_as(tests.uid('a_sales'), pg_temp.grant_sql('a', 'a_contact')),
  (select id::text from public.consent_events where contact_id = tests.rid('a_contact')),
  'repeating the same grant returns the existing ledger row id');
select is(pg_temp.ledger(), 1::bigint, '... and the ledger still has exactly one row (retry-safe)');

-- ================================================================ can_contact
create function pg_temp.can(p_uid uuid, p_contact text, p_channel text) returns text
language sql as $$
  select tests.scalar_as(p_uid, format($q$select app.can_contact(%L, %L)::text$q$, tests.rid(p_contact), p_channel))
$$;
select is(pg_temp.can(tests.uid('a_viewer'), 'a_contact', 'email'), 'true', 'can_contact: granted, not suppressed -> true (any role may ask)');
select is(pg_temp.can(tests.uid('a_viewer'), 'a_contact', 'whatsapp'), 'false', 'can_contact: other channel was never granted -> false');
select is(pg_temp.can(tests.uid('a_viewer'), 'a_contact', 'phone'), 'false', 'can_contact: phone -> false');
select is(pg_temp.can(tests.uid('b_viewer'), 'a_contact', 'email'), 'false', 'can_contact: a contact of another tenant answers false (no probing)');
select is(pg_temp.can(tests.uid('outsider'), 'a_contact', 'email'), 'false', 'can_contact: outsider -> false');
select is(pg_temp.can(tests.uid('a_viewer'), 'does-not-exist', 'email'), 'false', 'can_contact: unknown contact -> false');
select ok(not has_function_privilege('anon', 'app.can_contact(uuid, public.consent_channel)', 'execute'), 'anon cannot call can_contact');
select is((select prosecdef from pg_proc where oid = 'app.can_contact(uuid, public.consent_channel)'::regprocedure), false,
  'can_contact is SECURITY INVOKER: it reads through RLS and elevates nothing');

-- withdrawal
select is(tests.outcome_as(tests.uid('a_sales'), format($q$select public.record_consent(%L, %L, 'email', 'withdrawn')$q$, tests.tid('a'), tests.rid('a_contact'))),
  'rows:1', 'ALLOW: sales records a withdrawal (no evidence needed)');
select is(pg_temp.can(tests.uid('a_viewer'), 'a_contact', 'email'), 'false', 'can_contact: withdrawn -> false');
select is(pg_temp.ledger(), 2::bigint, 'withdrawal appended a second ledger row');

-- grant again, then suppression
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.grant_sql('a', 'a_contact', 'form:456')), 'rows:1', 're-grant');
select is(pg_temp.can(tests.uid('a_viewer'), 'a_contact', 'email'), 'true', 'can_contact: granted again -> true');

select is(tests.outcome_as(tests.uid('a_viewer'), format($q$select public.suppress_contact(%L, %L, 'opted_out')$q$, tests.tid('a'), tests.rid('a_contact'))),
  '42501', 'viewer: DENY suppress');
select is(tests.outcome_as(tests.uid('a_sales'), format($q$select public.suppress_contact(%L, %L, 'opted_out', 'verbal', 'call:789')$q$, tests.tid('a'), tests.rid('a_contact'))),
  'rows:1', 'ALLOW: sales suppresses a contact');
select is(pg_temp.can(tests.uid('a_viewer'), 'a_contact', 'email'), 'false', 'can_contact: suppressed -> false even though consent was granted');
select ok((select suppressed_at is not null and suppression_reason = 'opted_out' from public.contacts where id = tests.rid('a_contact')), 'suppression state recorded');
select is(pg_temp.ledger(), 5::bigint, 'ledger: grant, withdraw, grant, suppressed, and the withdrawn row the opt-out produced (R1)');
select is((select email_consent::text from public.contacts where id = tests.rid('a_contact')), 'withdrawn', 'opted_out withdrew the granted email consent (R1)');
select is(tests.outcome_as(tests.uid('a_sales'), format($q$select public.suppress_contact(%L, %L, 'manual')$q$, tests.tid('a'), tests.rid('a_contact'))),
  'rows:1', 'suppressing again is accepted');
select is(pg_temp.ledger(), 5::bigint, '... and adds nothing (idempotent)');
select is((select suppression_reason::text from public.contacts where id = tests.rid('a_contact')), 'opted_out', '... the original reason is kept');

-- lifting: Admin+ only, evidence required
select is(tests.outcome_as(tests.uid('a_sales'), format($q$select public.lift_suppression(%L, %L, 'written', 'letter:1')$q$, tests.tid('a'), tests.rid('a_contact'))),
  '42501', 'sales: DENY lifting a suppression');
select is(tests.outcome_as(tests.uid('a_viewer'), format($q$select public.lift_suppression(%L, %L, 'written', 'letter:1')$q$, tests.tid('a'), tests.rid('a_contact'))),
  '42501', 'viewer: DENY lifting a suppression');
select is(tests.outcome_as(tests.uid('a_admin'), format($q$select public.lift_suppression(%L, %L, 'written', 'letter:1')$q$, tests.tid('a'), tests.rid('a_contact'))),
  '42501', 'admin: DENY lifting a suppression (T010, ADR 0020: the Owner with aal2 only)');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$select public.lift_suppression(%L, %L, null, null)$q$, tests.tid('a'), tests.rid('a_contact'))),
  '22023', 'owner: lifting without evidence is refused');
select is(pg_temp.can(tests.uid('a_viewer'), 'a_contact', 'email'), 'false', 'still suppressed after the refusals');
select is(tests.outcome_as(tests.uid('b_owner'), format($q$select public.lift_suppression(%L, %L, 'written', 'letter:1')$q$, tests.tid('a'), tests.rid('a_contact'))),
  '42501', 'owner of tenant B: DENY lifting A''s suppression');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$select public.lift_suppression(%L, %L, 'written', 'letter:1')$q$, tests.tid('a'), tests.rid('a_contact'))),
  'rows:1', 'ALLOW: the owner lifts the suppression with evidence');
select is(pg_temp.can(tests.uid('a_viewer'), 'a_contact', 'email'), 'false', 'can_contact: STILL false after the lift: an opt-out withdrew consent and lifting does not revive it (R1)');
select is(tests.outcome_as(tests.uid('a_sales'), pg_temp.grant_sql('a', 'a_contact', 'form:789')), 'rows:1', 'a fresh grant is required');
select is(pg_temp.can(tests.uid('a_viewer'), 'a_contact', 'email'), 'true', 'can_contact: true only after a fresh record_consent grant');
select ok((select suppressed_at is null and suppression_reason is null from public.contacts where id = tests.rid('a_contact')), 'suppression state cleared');
select is(tests.scalar_as(tests.uid('a_owner'), format($q$select public.lift_suppression(%L, %L, 'written', 'letter:2') is null$q$, tests.tid('a'), tests.rid('a_contact'))),
  'true', 'lifting a suppression that is not set is a no-op (returns NULL)');
select is(pg_temp.ledger(), 7::bigint, '... and adds no ledger row (7 = through the fresh grant)');

-- archived contacts are never contactable
update public.contacts set archived_at = now() where id = tests.rid('a_contact');
select is(pg_temp.can(tests.uid('a_viewer'), 'a_contact', 'email'), 'false', 'can_contact: archived -> false');
update public.contacts set archived_at = null where id = tests.rid('a_contact');
-- a channel needs an address of that kind
insert into public.contacts (id, tenant_id, full_name) values (tests.rid('a_noaddr'), tests.tid('a'), 'No address');
select tests.scalar_as(tests.uid('a_owner'), format(
  $q$select public.record_consent(%L, %L, 'email', 'granted', 'explicit_consent', 'web_form', 'form:1')::text$q$, tests.tid('a'), tests.rid('a_noaddr')));
select is(pg_temp.can(tests.uid('a_viewer'), 'a_noaddr', 'email'), 'false', 'can_contact: consent without an email address -> false');

-- ================================================================ the ledger is append-only
select is(tests.outcome_as(tests.uid('a_owner'), format($$update public.consent_events set channel = 'phone' where contact_id = %L$$, tests.rid('a_contact'))),
  '42501', 'owner: DENY updating the ledger');
select is(tests.outcome_as(tests.uid('a_owner'), format($$delete from public.consent_events where contact_id = %L$$, tests.rid('a_contact'))),
  '42501', 'owner: DENY deleting ledger rows');
select is(tests.outcome_as(tests.uid('a_owner'), $$truncate public.consent_events$$), '42501', 'owner: DENY truncating the ledger');
select is(tests.outcome_as(tests.uid('a_owner'), format(
  $$insert into public.consent_events (tenant_id, contact_id, event_type, channel) values (%L, %L, 'withdrawn', 'phone')$$, tests.tid('a'), tests.rid('a_contact'))),
  '42501', 'owner: DENY inserting a ledger row directly (functions only)');
select throws_ok(format($$update public.consent_events set channel = 'phone' where contact_id = %L$$, tests.rid('a_contact')), '42501', null, 'trigger blocks UPDATE even for the table owner');
select throws_ok(format($$delete from public.consent_events where contact_id = %L$$, tests.rid('a_contact')), '42501', null, 'trigger blocks DELETE even for the table owner');
select throws_ok($$truncate public.consent_events$$, '42501', null, 'trigger blocks TRUNCATE even for the table owner');
select throws_ok(format($$delete from public.contacts where id = %L$$, tests.rid('a_contact')), '23503', null,
  'a contact with consent history cannot be hard-deleted (erasure = anonymise in place)');

-- ledger visibility: every role of the tenant reads it, no one reads another tenant's
select cmp_ok(tests.rows_as(tests.uid('a_viewer'), format($$select 1 from public.consent_events where contact_id = %L$$, tests.rid('a_contact'))), '>', 0::bigint, 'viewer reads the ledger');
select is(tests.rows_as(tests.uid('b_owner'), format($$select 1 from public.consent_events where contact_id = %L$$, tests.rid('a_contact'))), 0::bigint, 'another tenant reads nothing');

-- ============================================================ no personal data in the ledger
select is(
  (select coalesce(string_agg(column_name, ', '), '') from information_schema.columns
    where table_schema = 'public' and table_name = 'consent_events'
      and data_type in ('text', 'character varying', 'ARRAY', 'jsonb', 'json')
      and column_name <> 'evidence_ref'),
  '', 'evidence_ref is the ONLY free-form column in the ledger (no evidence note, no names)');
select is(
  (select col_description('public.consent_events'::regclass, attnum) like 'PII:%'
     from pg_attribute where attrelid = 'public.consent_events'::regclass and attname = 'evidence_ref'),
  true, 'evidence_ref is classified PII so it is never copied into audit_events by value');

-- privileges of the functions
select ok(not has_function_privilege('anon', 'public.record_consent(uuid,uuid,public.consent_channel,public.consent_status,public.consent_basis,public.evidence_type,text)', 'execute'), 'anon cannot call record_consent');
select ok(not has_function_privilege('anon', 'public.suppress_contact(uuid,uuid,public.suppression_reason,public.evidence_type,text)', 'execute'), 'anon cannot call suppress_contact');
select ok(not has_function_privilege('anon', 'public.lift_suppression(uuid,uuid,public.evidence_type,text)', 'execute'), 'anon cannot call lift_suppression');
select is(
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
    and p.proname in ('record_consent', 'suppress_contact', 'lift_suppression')
    and p.prosecdef and 'search_path=""' = any (p.proconfig)),
  3::bigint, 'all three consent functions are SECURITY DEFINER with search_path pinned to empty');

select * from finish();
rollback;
