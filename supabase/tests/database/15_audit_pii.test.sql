-- PII-aware audit (ADR 0005, "A-hybrid"): personal data never enters audit_events.
-- PII columns are recorded by NAME only (metadata.pii_fields_changed); every other column keeps
-- its before/after values. Sentinels below are distinctive so a whole-row text scan is meaningful.
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.audit_text(p_tenant uuid) returns text
language sql as $$ select coalesce(string_agg(to_jsonb(a)::text, E'\n'), '') from public.audit_events a where a.tenant_id = p_tenant $$;

-- ================================================================= contacts (the main case)
-- created through the real client path, as a tenant-A sales user
select is(tests.outcome_as(tests.uid('a_sales'), format(
  $q$insert into public.contacts (id, tenant_id, full_name, email, phone, job_title)
     values (%L, %L, 'Quasimodo Zephyrine', 'zephyr.quasi@example.test', '+91 98765 43210', 'Chief Pretzel Officer')$q$,
  tests.rid('c1'), tests.tid('a'))), 'rows:1', 'setup: sales creates a contact with personal data');

select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'contact.create' and entity_id = tests.rid('c1')),
  1::bigint, 'the create is audited');
select results_eq(
  format($$select (select array_agg(x order by x) from jsonb_array_elements_text(metadata -> 'pii_fields_changed') x), actor_user_id, old_values is null
           from public.audit_events where entity_id = %L and action = 'contact.create'$$, tests.rid('c1')),
  format($$values (array['email','full_name','job_title','phone']::text[], %L::uuid, true)$$, tests.uid('a_sales')),
  'create: the PII FIELD NAMES that were set, the actor, and no old values');
select ok(not (select new_values ? 'email' or new_values ? 'full_name' or new_values ? 'phone' or new_values ? 'job_title'
                 from public.audit_events where entity_id = tests.rid('c1') and action = 'contact.create'),
  'create: new_values has none of the PII keys');
select ok((select new_values ? 'company_id' and new_values ? 'tenant_id' and new_values ->> 'email_consent' = 'unknown'
             from public.audit_events where entity_id = tests.rid('c1') and action = 'contact.create'),
  'create: non-PII columns keep their values (company_id, tenant_id, consent state)');

-- updates: email, then job_title ONLY (a PII-only change must still be recorded), then phone
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.contacts set email = 'second.addr@example.test' where id = %L$$, tests.rid('c1'))), 'rows:1', 'setup: email changes');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.contacts set job_title = 'Pretzel Emeritus' where id = %L$$, tests.rid('c1'))), 'rows:1', 'setup: only the title changes');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.contacts set phone = '+91 91234 56789' where id = %L$$, tests.rid('c1'))), 'rows:1', 'setup: phone changes');

select is(
  (select array_agg(m order by id) from (
     select a.id, (select array_agg(x order by x) from jsonb_array_elements_text(a.metadata -> 'pii_fields_changed') x) as m
       from public.audit_events a where a.entity_id = tests.rid('c1') and a.action = 'contact.update') u),
  array[array['email'], array['job_title'], array['phone']]::text[][] ,
  'each update lists exactly the PII field names that changed (title-only change was recorded)');
select ok(not exists (select 1 from public.audit_events a where a.entity_id = tests.rid('c1') and a.action = 'contact.update'
                        and (a.old_values ? 'email' or a.new_values ? 'email' or a.old_values ? 'phone' or a.new_values ? 'phone'
                             or a.old_values ? 'job_title' or a.new_values ? 'job_title' or a.old_values ? 'full_name')),
  'update: neither old_values nor new_values ever contains a PII key');

-- consent changes are NOT personal data: before / after status is kept
select is(tests.outcome_as(tests.uid('a_sales'), format(
  $q$select public.record_consent(%L, %L, 'email', 'granted', 'explicit_consent', 'web_form', 'form:abc-999')$q$, tests.tid('a'), tests.rid('c1'))), 'rows:1', 'setup: consent granted');
select results_eq(
  format($$select old_values ->> 'email_consent', new_values ->> 'email_consent', metadata -> 'pii_fields_changed'
           from public.audit_events where entity_id = %L and action = 'contact.update' and new_values ->> 'email_consent' = 'granted'$$, tests.rid('c1')),
  $$values ('unknown'::text, 'granted'::text, '[]'::jsonb)$$,
  'a consent change is audited with its before/after status and no PII fields');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'consent_event.create'), 1::bigint,
  'the ledger insert is audited too');
select ok(not (select new_values ? 'evidence_ref' from public.audit_events where tenant_id = tests.tid('a') and action = 'consent_event.create'),
  'the evidence reference is not copied into the audit trail (named only)');
select ok((select new_values ->> 'event_type' = 'granted' and new_values ->> 'channel' = 'email'
             from public.audit_events where tenant_id = tests.tid('a') and action = 'consent_event.create'),
  'ledger audit keeps event_type and channel');

-- delete (privileged: clients cannot delete). Fresh contact so no ledger rows reference it.
insert into public.contacts (id, tenant_id, full_name, email) values (tests.rid('c2'), tests.tid('a'), 'Erasable Person Qux', 'qux.person@example.test');
delete from public.contacts where id = tests.rid('c2');
select results_eq(
  format($$select (select array_agg(x order by x) from jsonb_array_elements_text(metadata -> 'pii_fields_changed') x), new_values is null, old_values ? 'email'
           from public.audit_events where entity_id = %L and action = 'contact.delete'$$, tests.rid('c2')),
  $$values (array['email','full_name']::text[], true, false)$$,
  'delete: PII field names only, no PII key in old_values, no new_values');

-- ============================== THE ASSERTION: no PII value anywhere in the audit table
select is(
  (select count(*) from public.audit_events a
    where a.tenant_id in (tests.tid('a'), tests.tid('b'))   -- this test's own tenants: other suites leave rows whose ids/timestamps can contain digits like 98765
      and to_jsonb(a)::text ~* '(quasimodo|zephyr|98765|91234|56789|pretzel|second\.addr|qux|erasable|form:abc-999)'),
  0::bigint, 'no contact name, email, phone, title or evidence reference appears ANYWHERE in audit_events (whole row as text)');

-- ================================================ the other tables follow the same rule
insert into public.companies (id, tenant_id, name, tags) values (tests.rid('co1'), tests.tid('a'), 'Visible Trading Co', array['secret-tag-xyz']);
update public.companies set name = 'Visible Trading Ltd', tags = array['another-secret-tag'] where id = tests.rid('co1');
select results_eq(
  format($$select old_values ->> 'name', new_values ->> 'name', metadata -> 'pii_fields_changed' from public.audit_events
           where entity_id = %L and action = 'company.update'$$, tests.rid('co1')),
  $$values ('Visible Trading Co'::text, 'Visible Trading Ltd'::text, '["tags"]'::jsonb)$$,
  'company: the name is audited with values, tags by name only');
insert into public.products (id, tenant_id, sku, name, description) values (tests.rid('p1'), tests.tid('a'), 'AUD-1', 'Audited Product', 'zzz-confidential-description');
update public.products set name = 'Audited Product v2' where id = tests.rid('p1');
select is((select new_values ->> 'name' from public.audit_events where entity_id = tests.rid('p1') and action = 'product.update'),
  'Audited Product v2', 'product: name is audited with values');
insert into public.leads (id, tenant_id, source, disqualified_reason) values (tests.rid('l1'), tests.tid('a'), 'whispered by Mr Xylo', 'rude to Ms Yara');
insert into public.opportunities (id, tenant_id, company_id, title) values (tests.rid('o1'), tests.tid('a'), tests.rid('co1'), 'Deal with Zorblax');
update public.opportunities set status = 'lost', lost_reason = 'Zorblax said no' where id = tests.rid('o1');
select results_eq(
  format($$select old_values ->> 'status', new_values ->> 'status', metadata -> 'pii_fields_changed' from public.audit_events
           where entity_id = %L and action = 'opportunity.update'$$, tests.rid('o1')),
  $$values ('open'::text, 'lost'::text, '["lost_reason"]'::jsonb)$$,
  'opportunity: the status change is audited with values, the reason by name only');
select is(
  (select count(*) from public.audit_events a
    where a.tenant_id in (tests.tid('a'), tests.tid('b'))   -- this test's own tenants: other suites leave rows whose ids/timestamps can contain digits like 98765
      and to_jsonb(a)::text ~* '(secret-tag|another-secret|zzz-confidential|xylo|yara|zorblax)'),
  0::bigint, 'no tag, description, lead source/reason, opportunity title/reason value appears in audit_events');

-- ===================================================== T002 behaviour is unchanged
select tests.outcome_as(tests.uid('a_owner'), format($$update public.tenants set name = 'Renamed A' where id = %L$$, tests.tid('a')));
select results_eq(
  format($$select old_values ->> 'name', new_values ->> 'name', metadata from public.audit_events where tenant_id = %L and action = 'tenant.update'$$, tests.tid('a')),
  $$values ('Tenant A'::text, 'Renamed A'::text, '{}'::jsonb)$$,
  'tenants: names still audited with values, metadata stays {}');
select tests.outcome_as(tests.uid('a_owner'), format($$update public.memberships set role = 'sales' where tenant_id = %L and user_id = %L$$, tests.tid('a'), tests.uid('a_viewer')));
select results_eq(
  format($$select old_values ->> 'role', new_values ->> 'role', metadata from public.audit_events where tenant_id = %L and action = 'membership.update'$$, tests.tid('a')),
  $$values ('viewer'::text, 'sales'::text, '{}'::jsonb)$$,
  'memberships: old and new role still audited, metadata stays {}');
select ok(exists (select 1 from pg_proc where oid = 'app.write_audit_event(uuid,text,text,uuid,jsonb,jsonb)'::regprocedure),
  'the 6-argument audit writer from T002 still exists');
select ok(not has_function_privilege('authenticated', 'app.write_audit_event(uuid,text,text,uuid,jsonb,jsonb,jsonb)', 'execute')
      and not has_function_privilege('anon', 'app.write_audit_event(uuid,text,text,uuid,jsonb,jsonb,jsonb)', 'execute'),
  'the new 7-argument writer is not callable by clients either');

select * from finish();
rollback;
