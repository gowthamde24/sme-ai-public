-- 1d: dedicated SQLSTATEs (no message-text matching anywhere) and "no grant while suppressed".
--   SM001 opportunity won<->lost (terminal)     SM002 granting consent to a suppressed contact
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
create function pg_temp.withdraw(p_channel text, p_contact text default 'a_contact') returns text
language sql as $$
  select tests.outcome_as(tests.uid('a_sales'), format($q$select public.record_consent(%L, %L, %L, 'withdrawn')$q$,
    tests.tid('a'), tests.rid(p_contact), p_channel))
$$;
create function pg_temp.suppress(p_reason text, p_contact text default 'a_contact') returns text
language sql as $$ select tests.outcome_as(tests.uid('a_sales'), format($q$select public.suppress_contact(%L, %L, %L)$q$, tests.tid('a'), tests.rid(p_contact), p_reason)) $$;
create function pg_temp.state(p_contact text default 'a_contact') returns text
language sql as $$
  select concat_ws('/', email_consent, whatsapp_consent, phone_consent, coalesce(suppression_reason::text, '-'))
    from public.contacts where id = tests.rid(p_contact)
$$;
create function pg_temp.ledger(p_contact text default 'a_contact') returns bigint
language sql as $$ select count(*) from public.consent_events where contact_id = tests.rid(p_contact) $$;

-- ===================================================================== F1: no grant while suppressed
select is(pg_temp.grant('email', 'form:1'), 'rows:1', 'setup: email granted while not suppressed');
select is(pg_temp.suppress('bounced'), 'rows:1', 'setup: suppressed as bounced (consent kept)');
select is(pg_temp.state(), 'granted/unknown/unknown/bounced', '... email still granted, suppressed');
select is(pg_temp.ledger(), 2::bigint, '... ledger: grant + suppressed');

select is(pg_temp.grant('email', 'form:2'), 'SM002', 'F1: re-granting a channel of a suppressed contact -> SM002');
select is(pg_temp.grant('phone', 'form:3'), 'SM002', 'F1: granting another channel -> SM002');
select is(pg_temp.grant('whatsapp', 'form:4'), 'SM002', 'F1: and a third -> SM002');
select is(pg_temp.grant('email', 'form:5', 'a_contact', 'a_owner'), 'SM002', 'F1: an Owner cannot either');
select is(pg_temp.state(), 'granted/unknown/unknown/bounced', 'F1: refused grants changed nothing');
select is(pg_temp.ledger(), 2::bigint, 'F1: ... and wrote no ledger row');

select throws_ok(
  format($$select set_config('request.jwt.claim.sub', %L, true), public.record_consent(%L, %L, 'phone', 'granted', 'explicit_consent', 'web_form', 'form:6')$$,
         tests.uid('a_owner')::text, tests.tid('a'), tests.rid('a_contact')),
  'SM002', 'contact is suppressed; lift the suppression first', 'F1: exact SQLSTATE and message');

-- withdrawals stay allowed on suppressed contacts
select is(pg_temp.withdraw('email'), 'rows:1', 'F1: withdrawing consent of a SUPPRESSED contact is allowed');
select is(pg_temp.state(), 'withdrawn/unknown/unknown/bounced', '... and recorded');
select is(pg_temp.withdraw('phone'), 'rows:1', 'F1: withdrawing a never-granted channel while suppressed is allowed too');
select is(pg_temp.ledger(), 4::bigint, '... each with its ledger row');

-- ... and on archived contacts
insert into public.contacts (id, tenant_id, company_id, full_name, email) values (tests.rid('a_arch'), tests.tid('a'), tests.rid('a_company'), 'Archived', 'arch@example.test');
select is(pg_temp.grant('email', 'form:7', 'a_arch'), 'rows:1', 'setup: grant before archiving');
update public.contacts set archived_at = now() where id = tests.rid('a_arch');
select is(pg_temp.withdraw('email', 'a_arch'), 'rows:1', 'F1: withdrawing consent of an ARCHIVED contact is allowed');
select is(pg_temp.state('a_arch'), 'withdrawn/unknown/unknown/-', '... and recorded');

-- after the lift a grant works again; an ordinary (not suppressed) contact is unaffected
select is(tests.outcome_as(tests.uid('a_admin'), format($q$select public.lift_suppression(%L, %L, 'written', 'letter:1')$q$, tests.tid('a'), tests.rid('a_contact'))), 'rows:1', 'setup: admin lifts');
select is(pg_temp.grant('email', 'form:8'), 'rows:1', 'F1: after the lift a grant is accepted again');
insert into public.contacts (id, tenant_id, company_id, full_name, email) values (tests.rid('a_plain'), tests.tid('a'), tests.rid('a_company'), 'Plain', 'plain@example.test');
select is(pg_temp.grant('email', 'form:9', 'a_plain'), 'rows:1', 'F1: an unsuppressed contact is unaffected');
select is(pg_temp.grant('email', 'form:9', 'a_plain'), 'rows:1', 'F1: ... and its idempotent retry still succeeds');

-- the role/tenant gates still come first
select is(tests.outcome_as(tests.uid('a_viewer'), format($q$select public.record_consent(%L, %L, 'email', 'granted', 'explicit_consent', 'web_form', 'form:1')$q$, tests.tid('a'), tests.rid('a_contact'))), '42501', 'a viewer gets 42501, not SM002');

-- ================================================================= F2: dedicated SQLSTATE for the state machine
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.opportunities set status = 'lost', lost_reason = 'price' where id = %L$$, tests.rid('a_opp'))), 'rows:1', 'setup: close as lost');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.opportunities set status = 'won', lost_reason = null where id = %L$$, tests.rid('a_opp'))), 'SM001', 'F2: lost -> won -> SM001');
select is(tests.outcome_as(tests.uid('a_admin'), format($$update public.opportunities set status = 'open' where id = %L$$, tests.rid('a_opp'))), 'rows:1', 'setup: admin reopens');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.opportunities set status = 'won' where id = %L$$, tests.rid('a_opp'))), 'rows:1', 'setup: close as won');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.opportunities set status = 'lost', lost_reason = 'x' where id = %L$$, tests.rid('a_opp'))), 'SM001', 'F2: won -> lost -> SM001');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.opportunities set status = 'open' where id = %L$$, tests.rid('a_opp'))), '42501', 'F2: a reopen by sales is still 42501');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.opportunities set status = 'lost' where id = %L$$, tests.rid('a_opp'))), 'SM001', 'F2: terminal wins over the missing-reason check (the trigger runs first)');
select throws_ok(format($$update public.opportunities set status = 'lost', lost_reason = 'x' where id = %L$$, tests.rid('a_opp')), 'SM001', null, 'F2: the privileged session sees the same SQLSTATE');
-- the ordinary check violation keeps its own code, so the two can never be confused
insert into public.opportunities (id, tenant_id, company_id, title) values (tests.rid('a_open'), tests.tid('a'), tests.rid('a_company'), 'Open one');
select is(tests.outcome_as(tests.uid('a_sales'), format($$update public.opportunities set status = 'lost' where id = %L$$, tests.rid('a_open'))), '23514', 'lost without a reason is an ordinary check violation (23514)');
select is((select count(*) from pg_proc where oid = 'app.guard_opportunity_status()'::regprocedure and prosrc like '%SM001%' and prosrc not like '%errcode = ''23514''%'), 1::bigint,
  'the trigger source uses SM001 and no longer raises 23514');
select is((select count(*) from pg_proc where oid = 'public.record_consent(uuid,uuid,public.consent_channel,public.consent_status,public.consent_basis,public.evidence_type,text)'::regprocedure and prosrc like '%SM002%'), 1::bigint,
  'record_consent raises SM002');

select * from finish();
rollback;
