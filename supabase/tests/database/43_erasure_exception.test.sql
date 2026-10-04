-- T006b M1 (ADR 0014): the exception to immutability is narrow. Three conditions, each tested ON ITS OWN:
--   (a) the caller is the trusted role (current_user = 'postgres': the owner of the definer functions)
--   (b) the transaction-local setting app.erasure_request names a request of THE SAME TENANT whose status is 'executing'
--   (c) only the columns registered for erasure change (for the audit log: only the four company identity keys, removed)
--
-- The immutable tables are protected by more than the triggers: privileges, RLS, column grants, and a registry no client can
-- read. A test that hits one of those layers proves nothing about the trigger. So the test below REMOVES the other layers inside
-- its transaction (rolled back at the end) and then attacks the trigger alone. Each payload is a CORRECT erasure statement, so
-- the only thing that can refuse it is the condition under test.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_evidence();
select tests.er_plant('a');
select tests.er_plant('b');

insert into public.contacts (id, tenant_id, company_id, full_name, email) values (tests.rid('a_other'), tests.tid('a'), tests.rid('a_company'), 'Other Person', 'other.person@example.test');
insert into public.audit_events (id, tenant_id, actor_type, action, entity_type, entity_id, old_values, new_values, metadata) overriding system value values
  (900001, tests.tid('a'), 'user', 'company.update', 'company', tests.rid('a_company'), '{"name":"N","website":"w","country":"IN"}', '{"city":"c","region":"r","industry":"Textiles"}', '{}'),
  (900002, tests.tid('a'), 'user', 'contact.update', 'contact', tests.rid('a_contact'), '{"name":"N","country":"IN"}', '{"name":"M"}', '{}');
insert into public.erasure_requests (id, tenant_id, scope, subject_id, status, requested_by, execute_after) values
  (tests.rid('x1'), tests.tid('a'), 'contact', tests.rid('a_contact'), 'executing', tests.uid('a_owner'), now()),
  (tests.rid('x2'), tests.tid('a'), 'contact', tests.rid('a_contact'), 'pending',   tests.uid('a_owner'), now()),
  (tests.rid('x3'), tests.tid('b'), 'contact', tests.rid('b_contact'), 'executing', tests.uid('b_owner'), now()),
  (tests.rid('x4'), tests.tid('a'), 'contact', tests.rid('a_contact'), 'executed',  tests.uid('a_owner'), now());

-- ---- 0. with every layer in place, the immutable tables stay immutable for an ordinary caller
select is(tests.outcome_as(tests.uid('a_owner'), format($q$update public.evidence set snippet = 'x' where id = %L$q$, tests.rid('a_er_e1'))), '42501', 'evidence stays immutable for an Owner');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$update public.claims set value = 'x' where id = %L$q$, tests.rid('a_er_c1'))), '42501', 'claims stay immutable for an Owner');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$update public.consent_events set evidence_ref = 'x:1' where id = %L$q$, tests.rid('a_er_consent'))), '42501', 'the consent ledger stays append-only for an Owner');
select is(tests.outcome_as(tests.uid('a_owner'), 'update public.audit_events set new_values = ''{}'' where id = 900001'), '42501', 'the audit log stays append-only for an Owner');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$delete from public.consent_events where id = %L$q$, tests.rid('a_er_consent'))), '42501', 'DELETE stays forbidden');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$update public.contacts set erased_at = now() where id = %L$q$, tests.rid('a_other'))), '42501', 'a client cannot write erased_at (no column grant)');

-- ---- remove the other layers: UPDATE privileges, RLS, the registry's own RLS and schema privilege, the helper grants
alter table public.evidence       no force row level security;
alter table public.claims         no force row level security;
alter table public.consent_events no force row level security;
alter table public.audit_events   no force row level security;
alter table public.evidence       disable row level security;
alter table public.claims         disable row level security;
alter table public.consent_events disable row level security;
alter table public.audit_events   disable row level security;
grant update on public.evidence, public.claims, public.consent_events, public.audit_events to authenticated;
grant update (erased_at) on public.contacts, public.companies to authenticated;
alter table erasure.registry no force row level security;
alter table erasure.registry disable row level security;
grant usage on schema erasure to authenticated;
grant select on erasure.registry to authenticated;
grant execute on function app.erasure_running(uuid), app.erasure_columns(text), app.changed_columns(jsonb, jsonb) to authenticated;

-- one CORRECT erasure statement per guarded table
create temp table payload (label text primary key, sql text not null);
insert into payload values
  ('evidence',  format($q$update public.evidence set snippet = 'erased:1' where id = %L$q$, tests.rid('a_er_e1'))),
  ('claims',    format($q$update public.claims set value = 'erased:1' where id = %L$q$, tests.rid('a_er_c1'))),
  ('ledger',    format($q$update public.consent_events set evidence_ref = 'erased:1' where id = %L$q$, tests.rid('a_er_consent'))),
  ('audit',     $q$update public.audit_events set old_values = '{"country":"IN"}', new_values = '{"industry":"Textiles"}' where id = 900001$q$),
  ('contact',   format($q$update public.contacts set erased_at = now(), full_name = 'erased:1' where id = %L$q$, tests.rid('a_other'))),
  ('company',   format($q$update public.companies set erased_at = now() where id = %L$q$, tests.rid('a_er_company2')));

create function pg_temp.trusted(p_setting text, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('app.erasure_request', p_setting, true);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform set_config('app.erasure_request', '', true);
  return r;
end $$;
create function pg_temp.forge(p_uid text, p_sql text) returns text language plpgsql as $$
begin
  perform set_config('app.erasure_request', tests.rid('x1')::text, true);
  return tests.outcome_as(tests.uid(p_uid), p_sql);
end $$;

-- ---- (a) the trusted-role predicate: an Owner who sets the setting AND has a real running request of their own tenant
select is(pg_temp.forge('a_owner', p.sql), '42501', '(a) ' || p.label || ': an Owner naming the running request is still refused (not the trusted role)')
  from payload p order by p.label;

-- ---- (b) the running request, with the trusted role: none, unknown, pending, executed, another tenant's
select is(pg_temp.trusted(s.setting, p.sql), '42501', '(b) ' || p.label || ': ' || s.label)
  from payload p cross join (values
    ('', 'no setting is refused'),
    (gen_random_uuid()::text, 'an unknown request is refused'),
    (tests.rid('x2')::text, 'a PENDING request does not open the door'),
    (tests.rid('x4')::text, 'an EXECUTED request does not open it again'),
    (tests.rid('x3')::text, 'an executing request of ANOTHER tenant does not open it')) s(setting, label)
  order by p.label, s.label;

-- ---- (c) only registered columns; for the audit log only the four keys, removed
select is(pg_temp.trusted(tests.rid('x1')::text, format($q$update public.evidence set kind = 'document' where id = %L$q$, tests.rid('a_er_e2'))), '42501', '(c) even with the door open, evidence.kind cannot change');
select is(pg_temp.trusted(tests.rid('x1')::text, format($q$update public.evidence set provider = 'forged' where id = %L$q$, tests.rid('a_er_e2'))), '42501', '(c) nor evidence.provider');
select is(pg_temp.trusted(tests.rid('x1')::text, format($q$update public.evidence set snippet = 'erased:1', kind = 'document' where id = %L$q$, tests.rid('a_er_e2'))), '42501', '(c) nor a registered column together with an unregistered one');
select is(pg_temp.trusted(tests.rid('x1')::text, format($q$update public.claims set predicate = 'other' where id = %L$q$, tests.rid('a_er_c1'))), '42501', '(c) nor a claim''s predicate');
select is(pg_temp.trusted(tests.rid('x1')::text, format($q$update public.claims set confidence = 'high' where id = %L$q$, tests.rid('a_er_c1'))), '42501', '(c) nor a claim''s confidence');
select is(pg_temp.trusted(tests.rid('x1')::text, format($q$update public.consent_events set channel = 'phone' where id = %L$q$, tests.rid('a_er_consent'))), '42501', '(c) nor the ledger''s channel');
select is(pg_temp.trusted(tests.rid('x1')::text, format($q$update public.consent_events set evidence_ref = 'erased:1', event_type = 'withdrawn' where id = %L$q$, tests.rid('a_er_consent'))), '42501', '(c) nor the ledger''s reference together with its event type');
select is(pg_temp.trusted(tests.rid('x1')::text, $q$update public.audit_events set action = 'forged', old_values = '{"country":"IN"}', new_values = '{"industry":"Textiles"}' where id = 900001$q$), '42501', '(c) the audit scrub changes no column but the two value columns');
select is(pg_temp.trusted(tests.rid('x1')::text, $q$update public.audit_events set old_values = '{"country":"IN"}', new_values = '{}' where id = 900002$q$), '42501', '(c) ...and only on a row about a company');
select is(pg_temp.trusted(tests.rid('x1')::text, $q$update public.audit_events set old_values = '{"country":"XX"}', new_values = '{"industry":"Textiles"}' where id = 900001$q$), '42501', '(c) ...never changes a value (old_values)');
select is(pg_temp.trusted(tests.rid('x1')::text, $q$update public.audit_events set old_values = '{"country":"IN"}', new_values = '{"industry":"Textiles","note":"added"}' where id = 900001$q$), '42501', '(c) ...never adds a key (new_values)');
select is(pg_temp.trusted(tests.rid('x1')::text, $q$update public.audit_events set old_values = '{"country":"IN"}', new_values = '{}' where id = 900001$q$), '42501', '(c) ...never removes a key that is not one of the four');
select is(pg_temp.trusted(tests.rid('x1')::text, $q$update public.audit_events set tenant_id = (select id from public.tenants where id <> (select tenant_id from public.audit_events where id = 900001) limit 1) where id = 900001$q$), '42501', '(c) ...and a row cannot be moved to another tenant');
select is(pg_temp.trusted(tests.rid('x1')::text, format($q$delete from public.consent_events where id = %L$q$, tests.rid('a_er_consent'))), '42501', 'DELETE is forbidden even with the door open (the ledger)');
select is(pg_temp.trusted(tests.rid('x1')::text, 'truncate public.consent_events'), '42501', 'TRUNCATE too');
select is(pg_temp.trusted(tests.rid('x1')::text, format($q$update public.contacts set email = 'a@b.test' where id = %L$q$, tests.rid('a_other'))), 'ok', 'sanity: the door lets a contact be changed before it is erased');

-- ---- and with the door properly open, each correct statement is allowed: this is the erasure itself
select is(pg_temp.trusted(tests.rid('x1')::text, p.sql), 'ok', 'door open, same tenant, running request, registered columns: ' || p.label || ' is allowed')
  from payload p order by p.label;

-- ---- an erased contact / company stays erased
select is(tests.outcome_as(tests.uid('a_owner'), format($q$update public.contacts set email = 'back@example.test' where id = %L$q$, tests.rid('a_other'))), '42501', 'an erased contact''s e-mail cannot be written back, even by an Owner');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$update public.contacts set full_name = 'Somebody' where id = %L$q$, tests.rid('a_other'))), '42501', '...nor the name');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$update public.contacts set erased_at = null where id = %L$q$, tests.rid('a_other'))), '42501', '...nor can the marker be removed');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$update public.contacts set archived_at = null where id = %L$q$, tests.rid('a_other'))), 'rows:1', '...but archive state is still the ordinary admin action');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$update public.companies set name = 'Back' where id = %L$q$, tests.rid('a_er_company2'))), '42501', 'an erased company''s name cannot be written back either');
select is(tests.outcome_as(tests.uid('a_owner'), format($q$update public.companies set erased_at = null where id = %L$q$, tests.rid('a_er_company2'))), '42501', '...nor its marker removed');
select is(pg_temp.trusted('', format($q$update public.contacts set erased_at = now() where id = %L$q$, tests.rid('a_contact'))), '42501', 'the marker cannot be set even by the trusted role without a running request');
select is((select count(*) from public.contacts where erased_at is not null and tenant_id = tests.tid('a')), 1::bigint, 'exactly the contact the door was opened for is marked');

select * from finish();
rollback;
