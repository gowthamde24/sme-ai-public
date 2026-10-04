-- 1c review changes:
--  R1 an opt-out / complaint / legal suppression withdraws consent; a lift never revives it
--  R2 explicit NULL guards (no fall-through)   R3 no chosen status at insert   R4 typed evidence_ref
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.grant(p_channel text, p_ref text, p_contact text default 'a_contact', p_who text default 'a_sales') returns text
language sql as $$
  select tests.outcome_as(tests.uid(p_who), format(
    $q$select public.record_consent(%L, %L, %L, 'granted', 'explicit_consent', 'web_form', %L)$q$,
    tests.tid('a'), tests.rid(p_contact), p_channel, p_ref))
$$;
create function pg_temp.suppress(p_reason text, p_contact text default 'a_contact', p_who text default 'a_sales', p_ref text default null) returns text
language sql as $$
  select tests.outcome_as(tests.uid(p_who), format(
    $q$select public.suppress_contact(%L, %L, %L, %s, %s)$q$, tests.tid('a'), tests.rid(p_contact), p_reason,
    case when p_ref is null then 'null' else '''verbal''' end, case when p_ref is null then 'null' else quote_literal(p_ref) end))
$$;
create function pg_temp.lift(p_contact text default 'a_contact') returns text
language sql as $$
  select tests.outcome_as(tests.uid('a_admin'), format(
    $q$select public.lift_suppression(%L, %L, 'written', 'letter:9')$q$, tests.tid('a'), tests.rid(p_contact)))
$$;
create function pg_temp.can(p_contact text, p_channel text) returns text
language sql as $$ select tests.scalar_as(tests.uid('a_viewer'), format($q$select app.can_contact(%L, %L)::text$q$, tests.rid(p_contact), p_channel)) $$;
create function pg_temp.state(p_contact text default 'a_contact') returns text
language sql as $$
  select concat_ws('/', email_consent, whatsapp_consent, phone_consent, coalesce(suppression_reason::text, '-'))
    from public.contacts where id = tests.rid(p_contact)
$$;
create function pg_temp.events(p_contact text, p_type text) returns bigint
language sql as $$ select count(*) from public.consent_events where contact_id = tests.rid(p_contact) and event_type = p_type::public.consent_event_type $$;

-- ====================================================================== R1
-- three channels granted, then an opt-out
select is(pg_temp.grant('email', 'form:1'), 'rows:1', 'setup: email granted');
select is(pg_temp.grant('whatsapp', 'form:2'), 'rows:1', 'setup: whatsapp granted');
select is(pg_temp.grant('phone', 'form:3'), 'rows:1', 'setup: phone granted');
select is(pg_temp.state(), 'granted/granted/granted/-', 'before: all three granted, not suppressed');
select is(pg_temp.suppress('opted_out', p_ref => 'call:55'), 'rows:1', 'ALLOW: sales records an opt-out');
select is(pg_temp.state(), 'withdrawn/withdrawn/withdrawn/opted_out', 'R1: every granted channel is now withdrawn, in the same call');
select is(pg_temp.events('a_contact', 'suppressed'), 1::bigint, 'R1: one suppressed ledger row');
select is(pg_temp.events('a_contact', 'withdrawn'), 3::bigint, 'R1: one withdrawn ledger row per changed channel');
select is(
  (select array_agg(channel::text order by channel::text) from public.consent_events
    where contact_id = tests.rid('a_contact') and event_type = 'withdrawn'),
  array['email', 'phone', 'whatsapp'], 'R1: the withdrawn rows cover exactly email, whatsapp and phone');
select is(
  (select count(*) from public.consent_events where contact_id = tests.rid('a_contact') and event_type = 'withdrawn'
      and recorded_by = tests.uid('a_sales') and evidence_ref = 'call:55'),
  3::bigint, 'R1: the withdrawn rows carry who recorded them and the evidence given');
select is(pg_temp.can('a_contact', 'email') || pg_temp.can('a_contact', 'whatsapp') || pg_temp.can('a_contact', 'phone'),
  'falsefalsefalse', 'can_contact is false on every channel');
-- one audit event for the whole thing, with before/after
select results_eq(
  format($$select old_values ->> 'email_consent', new_values ->> 'email_consent', new_values ->> 'suppression_reason'
           from public.audit_events where entity_id = %L and action = 'contact.update' and new_values ->> 'suppression_reason' = 'opted_out'$$, tests.rid('a_contact')),
  $$values ('granted'::text, 'withdrawn'::text, 'opted_out'::text)$$,
  'R1: the contact change is audited once, with the before/after consent status');

-- lifting does NOT revive consent
select is(pg_temp.lift(), 'rows:1', 'ALLOW: admin lifts the suppression');
select is(pg_temp.state(), 'withdrawn/withdrawn/withdrawn/-', 'R1: suppression gone, consent still withdrawn');
select is(pg_temp.can('a_contact', 'email') || pg_temp.can('a_contact', 'whatsapp') || pg_temp.can('a_contact', 'phone'),
  'falsefalsefalse', 'R1: can_contact stays false on every channel after the lift');
select is(pg_temp.grant('email', 'form:4'), 'rows:1', 'a fresh grant is the only way back');
select is(pg_temp.can('a_contact', 'email'), 'true', '... email is contactable again');
select is(pg_temp.can('a_contact', 'phone'), 'false', '... phone is not (it needs its own fresh grant)');

-- idempotent repeat; and a re-grant made WHILE suppressed is withdrawn by a repeated opt-out
select is(pg_temp.suppress('opted_out'), 'rows:1', 'suppressed again');
select is(pg_temp.events('a_contact', 'suppressed'), 2::bigint, '(second suppression after the lift)');
select is(pg_temp.suppress('opted_out'), 'rows:1', 'a retry of the same opt-out succeeds');
select is(pg_temp.events('a_contact', 'suppressed'), 2::bigint, '... and writes no new suppressed row');
select is(pg_temp.events('a_contact', 'withdrawn'), 4::bigint, '... or withdrawn row (3 from the first opt-out + 1 for the re-granted email)');
select is(pg_temp.grant('phone', 'form:5'), 'rows:1', 'someone records a grant while the contact is suppressed');
select is(pg_temp.can('a_contact', 'phone'), 'false', '... which is useless while suppressed');
select is(pg_temp.suppress('opted_out'), 'rows:1', 'the opt-out is repeated');
select is(pg_temp.state(), 'withdrawn/withdrawn/withdrawn/opted_out', 'R1: the stray grant was withdrawn again');
select is(pg_temp.events('a_contact', 'withdrawn'), 5::bigint, 'R1: ... with its own withdrawn ledger row');

-- only the channels that were granted are touched
insert into public.contacts (id, tenant_id, company_id, full_name, email, phone)
values (tests.rid('a_partial'), tests.tid('a'), tests.rid('a_company'), 'Partial', 'partial@example.test', '+91 90000 11111');
select is(pg_temp.grant('email', 'form:6', 'a_partial'), 'rows:1', 'setup: only email granted; one channel withdrawn earlier');
select is(tests.outcome_as(tests.uid('a_sales'), format($q$select public.record_consent(%L, %L, 'phone', 'withdrawn')$q$, tests.tid('a'), tests.rid('a_partial'))),
  'rows:1', 'setup: phone explicitly withdrawn');
select is(pg_temp.suppress('legal', 'a_partial'), 'rows:1', 'legal suppression');
select is(pg_temp.state('a_partial'), 'withdrawn/unknown/withdrawn/legal', 'only the granted channel changed; unknown stays unknown');
select is(pg_temp.events('a_partial', 'withdrawn'), 2::bigint, 'one new withdrawn row (the earlier explicit phone withdrawal + email), none for whatsapp');

-- complained and legal withdraw too; bounced and manual do not
insert into public.contacts (id, tenant_id, company_id, full_name, email, phone)
select tests.rid('a_r_' || r), tests.tid('a'), tests.rid('a_company'), 'Reason ' || r, r || '@example.test', null
from unnest(array['complained', 'legal', 'bounced', 'manual']) r;
select pg_temp.grant('email', 'form:7', 'a_r_' || r) from unnest(array['complained', 'legal', 'bounced', 'manual']) r;
select pg_temp.suppress(r, 'a_r_' || r) from unnest(array['complained', 'legal', 'bounced', 'manual']) r;
select is(pg_temp.state('a_r_complained'), 'withdrawn/unknown/unknown/complained', 'complained withdraws');
select is(pg_temp.state('a_r_legal'), 'withdrawn/unknown/unknown/legal', 'legal withdraws');
select is(pg_temp.state('a_r_bounced'), 'granted/unknown/unknown/bounced', 'bounced suppresses but keeps the current behaviour (consent untouched)');
select is(pg_temp.state('a_r_manual'), 'granted/unknown/unknown/manual', 'manual suppresses but keeps the current behaviour');
select is(pg_temp.events('a_r_bounced', 'withdrawn'), 0::bigint, 'bounced writes no withdrawn row');
select is(pg_temp.can('a_r_bounced', 'email'), 'false', 'bounced: not contactable while suppressed');
select is(pg_temp.lift('a_r_bounced'), 'rows:1', 'lift a bounced suppression');
select is(pg_temp.can('a_r_bounced', 'email'), 'true', 'bounced: contactable again after the lift (consent was never withdrawn)');
select is(pg_temp.lift('a_r_manual'), 'rows:1', 'lift a manual suppression');
select is(pg_temp.can('a_r_manual', 'email'), 'true', 'manual: contactable again after the lift');
select is(pg_temp.lift('a_r_legal'), 'rows:1', 'lift a legal suppression');
select is(pg_temp.can('a_r_legal', 'email'), 'false', 'legal: consent stays withdrawn after the lift');

-- a weaker suppression followed by a withdrawing one upgrades the reason and withdraws
insert into public.contacts (id, tenant_id, company_id, full_name, email) values (tests.rid('a_upg'), tests.tid('a'), tests.rid('a_company'), 'Upgrade', 'upg@example.test');
select pg_temp.grant('email', 'form:8', 'a_upg');
select pg_temp.suppress('bounced', 'a_upg');
select is(pg_temp.state('a_upg'), 'granted/unknown/unknown/bounced', 'bounced first');
select pg_temp.suppress('opted_out', 'a_upg');
select is(pg_temp.state('a_upg'), 'withdrawn/unknown/unknown/opted_out', 'an opt-out arriving later upgrades the reason and withdraws consent');
select is(pg_temp.events('a_upg', 'suppressed'), 2::bigint, '... and is recorded as its own suppressed row');
select pg_temp.suppress('manual', 'a_upg');
select is(pg_temp.state('a_upg'), 'withdrawn/unknown/unknown/opted_out', 'a weaker reason later does not downgrade it');

-- atomic: a bad evidence reference rolls back the whole suppression
insert into public.contacts (id, tenant_id, company_id, full_name, email) values (tests.rid('a_atomic'), tests.tid('a'), tests.rid('a_company'), 'Atomic', 'atomic@example.test');
select pg_temp.grant('email', 'form:9', 'a_atomic');
select is(pg_temp.suppress('opted_out', 'a_atomic', 'a_sales', 'not typed'), '23514', 'a malformed evidence reference fails the call');
select is(pg_temp.state('a_atomic'), 'granted/unknown/unknown/-', '... and NOTHING changed (atomic: still granted, not suppressed)');
select is(pg_temp.events('a_atomic', 'suppressed'), 0::bigint, '... and no ledger row was written');

-- the role rules are unchanged
select is(pg_temp.suppress('opted_out', 'a_contact', 'a_viewer'), '42501', 'viewer still cannot suppress');
select is(tests.outcome_as(tests.uid('a_sales'), format($q$select public.lift_suppression(%L, %L, 'written', 'letter:9')$q$, tests.tid('a'), tests.rid('a_contact'))),
  '42501', 'sales still cannot lift');

-- ====================================================================== R2
insert into public.contacts (id, tenant_id, company_id, full_name, email, phone) values (tests.rid('a_null'), tests.tid('a'), tests.rid('a_company'), 'Null Guard', 'null@example.test', '+91 90000 22222');
create function pg_temp.null_case(p_label text, p_sql text) returns setof text
language plpgsql as $$
begin
  return next is(tests.outcome_as(tests.uid('a_owner'), p_sql), '22023', p_label || ' -> 22023');
end $$;
select * from pg_temp.null_case('record_consent: NULL tenant', format($q$select public.record_consent(null, %L, 'email', 'granted', 'explicit_consent', 'web_form', 'form:1')$q$, tests.rid('a_null')));
select * from pg_temp.null_case('record_consent: NULL contact', format($q$select public.record_consent(%L, null, 'email', 'granted', 'explicit_consent', 'web_form', 'form:1')$q$, tests.tid('a')));
select * from pg_temp.null_case('record_consent: NULL channel', format($q$select public.record_consent(%L, %L, null, 'granted', 'explicit_consent', 'web_form', 'form:1')$q$, tests.tid('a'), tests.rid('a_null')));
select * from pg_temp.null_case('record_consent: NULL status', format($q$select public.record_consent(%L, %L, 'email', null, 'explicit_consent', 'web_form', 'form:1')$q$, tests.tid('a'), tests.rid('a_null')));
select * from pg_temp.null_case('record_consent: NULL channel on a WITHDRAWAL', format($q$select public.record_consent(%L, %L, null, 'withdrawn')$q$, tests.tid('a'), tests.rid('a_null')));
select * from pg_temp.null_case('suppress_contact: NULL tenant', format($q$select public.suppress_contact(null, %L, 'manual')$q$, tests.rid('a_null')));
select * from pg_temp.null_case('suppress_contact: NULL contact', format($q$select public.suppress_contact(%L, null, 'manual')$q$, tests.tid('a')));
select * from pg_temp.null_case('suppress_contact: NULL reason', format($q$select public.suppress_contact(%L, %L, null)$q$, tests.tid('a'), tests.rid('a_null')));
select * from pg_temp.null_case('lift_suppression: NULL tenant', format($q$select public.lift_suppression(null, %L, 'written', 'letter:1')$q$, tests.rid('a_null')));
select * from pg_temp.null_case('lift_suppression: NULL contact', format($q$select public.lift_suppression(%L, null, 'written', 'letter:1')$q$, tests.tid('a')));
select is(pg_temp.state('a_null'), 'unknown/unknown/unknown/-', 'R2: NULL arguments changed nothing (in particular no phone fall-through)');
select is(
  (select count(*) from public.consent_events where contact_id = tests.rid('a_null')), 0::bigint, 'R2: ... and wrote no ledger row');
select is(tests.outcome_as(null, $q$select public.record_consent(null, null, null, null)$q$), '42501', 'anon with NULLs: authentication is checked first (42501)');

-- ====================================================================== R3
select ok(not has_column_privilege('authenticated', 'public.leads', 'status', 'INSERT'), 'R3: no INSERT grant on leads.status');
select ok(not has_column_privilege('authenticated', 'public.opportunities', 'status', 'INSERT'), 'R3: no INSERT grant on opportunities.status');
select ok(has_column_privilege('authenticated', 'public.leads', 'status', 'UPDATE'), 'R3: leads.status stays updatable');
select ok(has_column_privilege('authenticated', 'public.opportunities', 'status', 'UPDATE'), 'R3: opportunities.status stays updatable');
select is(tests.outcome_as(tests.uid('a_sales'), format($$insert into public.leads (tenant_id, status) values (%L, 'qualified')$$, tests.tid('a'))), '42501', 'R3: inserting a lead as qualified is rejected');
select is(tests.outcome_as(tests.uid('a_sales'), format($$insert into public.leads (tenant_id, status) values (%L, 'disqualified')$$, tests.tid('a'))), '42501', 'R3: inserting a lead as disqualified is rejected');
select is(tests.outcome_as(tests.uid('a_sales'), format($$insert into public.opportunities (tenant_id, company_id, title, status) values (%L, %L, 'x', 'won')$$, tests.tid('a'), tests.rid('a_company'))), '42501', 'R3: inserting an opportunity as won is rejected');
select is(tests.outcome_as(tests.uid('a_sales'), format($$insert into public.opportunities (tenant_id, company_id, title, status) values (%L, %L, 'x', 'open')$$, tests.tid('a'), tests.rid('a_company'))), '42501', 'R3: even naming the default status is rejected');
select is(tests.outcome_as(tests.uid('a_sales'), format($$insert into public.leads (id, tenant_id) values (%L, %L)$$, tests.rid('a_newlead'), tests.tid('a'))), 'rows:1', 'R3: a lead without a status is accepted');
select is((select status::text from public.leads where id = tests.rid('a_newlead')), 'new', 'R3: ... and starts as new');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.leads set status = 'qualified' where id = %L$$, tests.rid('a_newlead'))), 'rows:1', 'R3: status can still be updated');

-- ====================================================================== R4
select is(pg_temp.grant('email', 'form:8841', 'a_null'), 'rows:1', 'R4: form:8841 is accepted');
select is(pg_temp.grant('phone', 'ticket:2201', 'a_null'), 'rows:1', 'R4: ticket:2201 is accepted');
select is(pg_temp.grant('whatsapp', 'my_kind-2:A.b_c#d/e-9', 'a_null'), 'rows:1', 'R4: the allowed character set is accepted');
select is(pg_temp.grant('email', 'abcdefghijklmnopqrst:' || repeat('x', 96), 'a_empty') , 'P0002', '(longest legal shape is checked below against the table constraint)');
select ok(('abcdefghijklmnopqrst:' || repeat('x', 96)) ~ '^[a-z][a-z0-9_-]{1,19}:[A-Za-z0-9._#/-]{1,96}$', 'R4: 20 + 1 + 96 characters matches the pattern');
select ok(char_length('abcdefghijklmnopqrst:' || repeat('x', 96)) <= 120, 'R4: and stays within 120 characters');
select ok(('erased:1') ~ '^[a-z][a-z0-9_-]{1,19}:[A-Za-z0-9._#/-]{1,96}$', 'R4: the erasure tombstone "erased:1" is a valid reference');

insert into public.contacts (id, tenant_id, company_id, full_name) values (tests.rid('a_r4'), tests.tid('a'), tests.rid('a_company'), 'Ref Test');
select is(pg_temp.grant('email', p_ref => 'form-123', p_contact => 'a_r4'), '23514', 'R4: no colon (the old style) is rejected');
select is(pg_temp.grant('email', p_ref => 'Form:123', p_contact => 'a_r4'), '23514', 'R4: uppercase prefix is rejected');
select is(pg_temp.grant('email', p_ref => 'f:123', p_contact => 'a_r4'), '23514', 'R4: one-letter prefix is rejected');
select is(pg_temp.grant('email', p_ref => 'form:', p_contact => 'a_r4'), '23514', 'R4: empty token is rejected');
select is(pg_temp.grant('email', p_ref => ':123', p_contact => 'a_r4'), '23514', 'R4: empty prefix is rejected');
select is(pg_temp.grant('email', p_ref => 'form:jane doe', p_contact => 'a_r4'), '23514', 'R4: a space (a name) is rejected');
select is(pg_temp.grant('email', p_ref => 'form:jane@example.test', p_contact => 'a_r4'), '23514', 'R4: an address in the token is rejected');
select is(pg_temp.grant('email', p_ref => 'jane@example.test', p_contact => 'a_r4'), '23514', 'R4: a bare address is rejected');
select is(pg_temp.grant('email', p_ref => 'a-prefix-that-is-too-long:1', p_contact => 'a_r4'), '23514', 'R4: a prefix over 20 characters is rejected');
select is(pg_temp.grant('email', p_ref => 'form:' || repeat('x', 97), p_contact => 'a_r4'), '23514', 'R4: a token over 96 characters is rejected');
select is(pg_temp.grant('email', p_ref => 'form:12:34', p_contact => 'a_r4'), '23514', 'R4: a second colon is rejected');
select is((select email_consent::text from public.contacts where id = tests.rid('a_r4')), 'unknown', 'R4: rejected references left the contact untouched');
select ok((select col_description('public.consent_events'::regclass, attnum) like '%does NOT prevent%' and col_description('public.consent_events'::regclass, attnum) like '%tombstone%'
             from pg_attribute where attrelid = 'public.consent_events'::regclass and attname = 'evidence_ref'),
  'R4: the column comment says the format does not prevent accidental PII and documents the tombstone');
select ok((select pg_get_constraintdef(oid) like '%[a-z][a-z0-9_-]{1,19}:[A-Za-z0-9._#/-]{1,96}%' from pg_constraint
            where conname = 'consent_events_evidence_ref_check' and conrelid = 'public.consent_events'::regclass),
  'R4: the table check is the typed-prefix pattern');

select * from finish();
rollback;
