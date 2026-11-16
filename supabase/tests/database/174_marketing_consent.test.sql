-- MARKETING CONSENT per customer (migration 20261231977000; owner-approved plan, slice S1; owner's addition 15 Nov 2026): unknown = no marketing; an owner-recorded grant needs a "how given" note,
-- who and when; STOP withdraws it; every change is audited without the note; erasing a contact clears the note.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.j(p_json text, p_path text) returns text language sql as $$ select (p_json::jsonb #>> string_to_array(p_path, '.')) $$;
create function pg_temp.mc(p_user text, p_tenant text, p_contact text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.marketing_consent_get(%L, %L)::text$q$, tests.tid(p_tenant), tests.rid(p_contact))) $$;
create function pg_temp.setc(p_user text, p_tenant text, p_contact text, p_note text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.marketing_consent_set(%L, %L, %L)::text$q$, tests.tid(p_tenant), tests.rid(p_contact), p_note)) $$;

-- A. the default: unknown means no marketing
select is(pg_temp.j(pg_temp.mc('a_owner', 'a', 'a_contact'), 'state'), 'unknown', 'A1 a contact starts with marketing consent unknown');
select is(pg_temp.j(pg_temp.mc('a_owner', 'a', 'a_contact'), 'note'), null, 'A2 ... with no note, no time, no way');
select is(pg_temp.mc('a_viewer', 'a', 'a_contact'), 'ERR:42501', 'A3 a viewer cannot read it');
select is(pg_temp.mc('a_owner', 'b', 'b_contact'), 'ERR:42501', 'A4 nor can the owner of another business');

-- B. the owner records that the customer said yes: a note, who and when
select is(pg_temp.setc('a_owner', 'a', 'a_contact', null), 'ERR:22023', 'B1 no note, no consent');
select is(pg_temp.setc('a_owner', 'a', 'a_contact', 'x'), 'ERR:22023', 'B2 a one-letter note is not a note');
select is(pg_temp.setc('a_owner', 'a', 'a_contact', repeat('a', 161)), 'ERR:22023', 'B3 161 characters is too long');
select is(pg_temp.setc('a_viewer', 'a', 'a_contact', 'said yes in shop'), 'ERR:42501', 'B4 a viewer cannot record it');
select is(pg_temp.setc('a_owner', 'b', 'b_contact', 'said yes in shop'), 'ERR:42501', 'B5 not for another business''s contact');
select is(pg_temp.j(pg_temp.setc('a_owner', 'a', 'a_contact', '  said   yes in shop  '), 'state'), 'granted', 'B6 the owner records it');
select is(pg_temp.j(pg_temp.mc('a_owner', 'a', 'a_contact'), 'note'), 'said yes in shop', 'B7 the note is kept, tidied');
select is(pg_temp.j(pg_temp.mc('a_owner', 'a', 'a_contact'), 'via'), 'owner_recorded', 'B8 ... with the way');
select is(pg_temp.j(pg_temp.mc('a_owner', 'a', 'a_contact'), 'by'), tests.uid('a_owner')::text, 'B9 ... and who recorded it');
select ok((select marketing_consent_at > now() - interval '1 minute' from public.contacts where id = tests.rid('a_contact')), 'B10 ... and when');
select is(pg_temp.j(pg_temp.setc('a_sales', 'a', 'a_contact', 'asked on the phone'), 'by'), tests.uid('a_sales')::text, 'B11 a salesperson can record it too, under their own name');

-- C. every change is audited, and the audit trail never holds the note
select ok((select count(*) from public.audit_events where entity_type = 'contact' and entity_id = tests.rid('a_contact') and new_values ->> 'marketing_consent' = 'granted') >= 1, 'C1 the grant is in the audit trail (who and when)');
select is((select count(*) from public.audit_events where entity_id = tests.rid('a_contact') and (new_values::text like '%said yes%' or old_values::text like '%said yes%' or new_values::text like '%asked on the phone%')), 0::bigint, 'C2 the note is never in the audit trail');

-- D. withdrawing
select is(pg_temp.j(pg_temp.val('a_owner', format($q$select public.marketing_consent_withdraw(%L, %L)::text$q$, tests.tid('a'), tests.rid('a_contact'))), 'state'), 'withdrawn', 'D1 the owner records that the customer no longer wants it');
select is(pg_temp.j(pg_temp.mc('a_owner', 'a', 'a_contact'), 'via'), 'owner_recorded', 'D2 (by the owner)');
select is(pg_temp.val('a_viewer', format($q$select public.marketing_consent_withdraw(%L, %L)::text$q$, tests.tid('a'), tests.rid('a_contact'))), 'ERR:42501', 'D3 a viewer cannot');

-- E. STOP withdraws it first; a customer who asked to stop cannot be re-recorded as a yes
select pg_temp.setc('a_owner', 'a', 'a_contact', 'said yes again in shop');
select app.wa_suppress_contact(tests.tid('a'), tests.rid('a_contact'), 'opted_out', 'test:stop', null);
select is(pg_temp.j(pg_temp.mc('a_owner', 'a', 'a_contact'), 'state'), 'withdrawn', 'E1 STOP withdraws marketing consent');
select is(pg_temp.j(pg_temp.mc('a_owner', 'a', 'a_contact'), 'via'), 'stop_reply', 'E2 ... by the customer''s own stop');
select is(pg_temp.j(pg_temp.mc('a_owner', 'a', 'a_contact'), 'note'), null, 'E3 ... and the note is gone');
select is(pg_temp.setc('a_owner', 'a', 'a_contact', 'said yes once more'), 'ERR:55000', 'E4 the owner cannot record a yes for someone who asked to stop');

-- F. the system's own ways
select tests.cn_guards_off();
select tests.open_gate('a');
update public.contacts set suppressed_at = null, suppression_reason = null, whatsapp_consent = 'unknown' where id = tests.rid('a_contact');
select is(app.marketing_consent_grant_system(tests.tid('a'), tests.rid('a_contact'), 'whatsapp_reply'), true, 'F1 the customer''s own WhatsApp reply grants it');
select is((select marketing_consent || ':' || marketing_consent_via || ':' || coalesce(marketing_consent_by::text, 'nobody') from public.contacts where id = tests.rid('a_contact')), 'granted:whatsapp_reply:nobody', 'F2 ... with no staff name and no note');
select throws_ok($$select app.marketing_consent_grant_system(tests.tid('a'), tests.rid('a_contact'), 'owner_recorded')$$, '22023', null, 'F3 the system cannot pretend to be the owner');
select is(app.marketing_consent_withdraw_system(tests.tid('a'), tests.rid('a_contact'), 'customer_link'), true, 'F4 the customer''s own link withdraws it');

-- G. the table keeps its own promises
select throws_ok($$update public.contacts set marketing_consent = 'granted', marketing_consent_at = now(), marketing_consent_via = 'owner_recorded' where id = tests.rid('a_contact')$$, '23514', null, 'G1 an owner-recorded yes without a note and a name is refused by the table');
select throws_ok($$update public.contacts set marketing_consent = 'granted', marketing_consent_at = now(), marketing_consent_via = 'stop_reply' where id = tests.rid('a_contact')$$, '23514', null, 'G2 a "stop" is not a way of saying yes');
select throws_ok($$update public.contacts set marketing_consent = 'unknown' where id = tests.rid('a_contact')$$, '23514', null, 'G3 "unknown" cannot keep a time and a way');

-- H. erasing a contact clears the note and withdraws the consent
select pg_temp.setc('a_owner', 'a', 'a_contact', 'said yes in shop to Ravi');
insert into public.erasure_requests (id, tenant_id, scope, status, requested_by, execute_after) values (tests.rid('h1'), tests.tid('a'), 'tenant', 'executing', tests.uid('a_owner'), now());
select set_config('app.erasure_request', tests.rid('h1')::text, true);
update public.contacts set erased_at = now() where id = tests.rid('a_contact');
select set_config('app.erasure_request', '', true);
select is((select marketing_consent_note from public.contacts where id = tests.rid('a_contact')), null, 'H1 an erased contact keeps no note');
select is((select marketing_consent || ':' || marketing_consent_via from public.contacts where id = tests.rid('a_contact')), 'withdrawn:erasure', 'H2 ... and its marketing consent is withdrawn');

select * from finish();
rollback;
