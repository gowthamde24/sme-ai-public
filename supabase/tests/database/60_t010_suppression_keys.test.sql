-- T010 part 1 (ADR 0020, migration 20261018090000): suppression keys.
--   A private schema, no client access    B record_contact_keys (roles, shapes, idempotency, merge, versions)   C the keys follow the contact's suppression and lifting
--   D a contact that arrives with a suppressed key is flagged   E a changed identifier forgets its key   F the unkeyed list, the count and the backfill
--   G erasure writes the keys first, SM221, the Owner's "without a key" step, dry run, the whole workspace   H the ledger is append-only   I the audit trail never holds a key
--   J lift_suppression is the Owner's with aal2   K check_suppression
-- Every key here is a well-formed FAKE (md5 twice): the database cannot verify an HMAC, only store, compare and refuse. All data is synthetic.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.as_aal('aal2');

create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
-- err / code / sc run at aal2 (the default of these tests); pg_temp.at sets its own level and leaves it set, so these reset it
create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.error_full_as(tests.uid(p_user), p_sql); end $$;
create function pg_temp.code(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return split_part(tests.error_full_as(tests.uid(p_user), p_sql), '|', 1); end $$;
create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.at(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return split_part(tests.error_full_as(tests.uid(p_user), p_sql), '|', 1); end $$;
create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
-- a key set for a contact: e-mail and phone keys derived from the given words
create function pg_temp.ks(p_email text, p_phone text default null, p_ver int default 1) returns text language sql as $$
  select jsonb_build_object('version', p_ver, 'email', case when p_email is null then null else pg_temp.h(p_email) end,
                            'phone', case when p_phone is null then null else pg_temp.h(p_phone) end)::text $$;
create function pg_temp.rk(p_user text, p_contact text, p_keys text, p_also text default '{}') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.record_contact_keys(%L, %L::jsonb, %L::jsonb)', tests.rid(p_contact), p_keys, p_also)) $$;
create function pg_temp.events(p_event text default null) returns bigint language sql as $$
  select count(*) from suppression.key_events e where e.tenant_id = tests.tid('a') and (p_event is null or e.event = p_event) $$;

insert into public.contacts (id, tenant_id, company_id, full_name, email, phone) values
  (tests.rid('c2'), tests.tid('a'), tests.rid('a_company'), 'Contact two', 'c2@example.test', '+00 90000 00022'),
  (tests.rid('c3'), tests.tid('a'), tests.rid('a_company'), 'Contact three', 'c3@example.test', null),
  (tests.rid('c4'), tests.tid('a'), tests.rid('a_company'), 'Contact four', null, null),
  (tests.rid('c5'), tests.tid('a'), tests.rid('a_company'), 'Contact five', 'c5@example.test', '+00 90000 00055'),
  (tests.rid('c6'), tests.tid('a'), tests.rid('a_company'), 'Contact six', 'c6@example.test', '+00 90000 00066'),
  (tests.rid('c7'), tests.tid('a'), tests.rid('a_company'), 'Contact seven', 'c7@example.test', '+00 90000 00077'),
  (tests.rid('c9'), tests.tid('a'), tests.rid('a_company'), 'Contact nine', 'c9@example.test', '+00 90000 00099');

-- ============================================================================ A. a private schema; no client can reach it
select is((select count(*) from unnest(array['anon', 'authenticated', 'service_role']) r where has_schema_privilege(r, 'suppression', 'usage')), 0::bigint, 'A1 no client role has USAGE on the schema suppression');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'suppression' and grantee in ('anon', 'authenticated', 'service_role', 'public')), 0::bigint, 'A2 no client role holds any privilege on its tables');
select is((select bool_and(c.relrowsecurity and c.relforcerowsecurity) from pg_class c where c.relnamespace = 'suppression'::regnamespace and c.relkind = 'r'), true, 'A3 both tables have row level security enabled and forced');
select is((select count(*) from pg_class c where c.relnamespace = 'suppression'::regnamespace and c.relkind = 'r'), 2::bigint, 'A4 the schema holds exactly the two tables');
select is(pg_temp.code('a_owner', 'select count(*) from suppression.key_events'), '42501', 'A5 even an Owner cannot read the ledger (no USAGE on the schema)');
select is(pg_temp.code('a_owner', 'select count(*) from suppression.contact_keys'), '42501', 'A6 ... nor the stored keys');
select is((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'contacts' and column_name ~ 'hmac'), 0::bigint, 'A7 the contacts table itself holds no key column (select=* can never return one)');
select is((select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace
             and p.proname in ('suppression_error', 'is_hex64', 'key_active', 'key_reason', 'suppression_key_add', 'suppression_key_lift', 'suppression_keys_ok', 'contact_keys_record',
                               'contacts_forget_changed_keys', 'contacts_sync_suppression_keys')
             and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute'))),
          0::bigint, 'A8 no client role can execute an internal suppression function');
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('record_contact_keys', 'check_suppression', 'unkeyed_contact_count', 'unkeyed_contacts', 'backfill_contact_keys', 'allow_erasure_without_key')
             and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute') and not has_function_privilege('public', p.oid, 'execute')
             and p.prosecdef and p.proconfig @> array['search_path=""'] ), 6::bigint, 'A9 the six public functions: signed-in people only, SECURITY DEFINER, an empty search_path');
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
             and p.proname in ('record_contact_keys', 'check_suppression', 'unkeyed_contact_count', 'unkeyed_contacts', 'backfill_contact_keys', 'allow_erasure_without_key')), 6::bigint, 'A10 one overload each');

-- ============================================================================ B. record_contact_keys
select is(pg_temp.code('a_viewer', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('a_contact'), pg_temp.ks('x1', 'x2'))), '42501', 'B1 a Viewer cannot record keys');
select is(pg_temp.code('b_owner', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('a_contact'), pg_temp.ks('x1', 'x2'))), '42501', 'B2 another tenant''s Owner cannot');
select is(pg_temp.code('outsider', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('a_contact'), pg_temp.ks('x1', 'x2'))), '42501', 'B3 an outsider cannot');
select is(pg_temp.err('a_viewer', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('a_contact'), pg_temp.ks('x1', 'x2'))),
          pg_temp.err('b_owner', format('select public.record_contact_keys(%L, %L::jsonb)', gen_random_uuid(), pg_temp.ks('x1', 'x2'))), 'B4 a refusal for a role and for an unknown contact are the SAME answer');
select is(pg_temp.code('a_sales', format('select public.record_contact_keys(null, %L::jsonb)', pg_temp.ks('x1', 'x2'))), '42501', 'B5 a null contact is the same refusal');
select is(pg_temp.rk('a_sales', 'a_contact', pg_temp.ks('a_mail', 'a_phone')) ::jsonb ->> 'recorded', 'true', 'B6 Sales records the keys of a contact');
select is((select email_hmac = pg_temp.h('a_mail') and phone_hmac = pg_temp.h('a_phone') and key_version = 1 from suppression.contact_keys where contact_id = tests.rid('a_contact')), true, 'B7 the keys are stored with their version');
select is((select count(*) from suppression.contact_keys where contact_id = tests.rid('a_contact')), 1::bigint, 'B8 one row per contact');
select is(pg_temp.rk('a_admin', 'c2', pg_temp.ks('c2_mail', 'c2_phone')) ::jsonb ->> 'recorded', 'true', 'B9 an Admin records');
select is(pg_temp.rk('a_owner', 'c3', pg_temp.ks('c3_mail', null)) ::jsonb ->> 'recorded', 'true', 'B10 an Owner records (a contact with only an e-mail)');
-- idempotent: the same keys again change nothing, not even the stored row
select is((select recorded_at from suppression.contact_keys where contact_id = tests.rid('a_contact')), (select recorded_at from suppression.contact_keys where contact_id = tests.rid('a_contact')), 'B11 (control)');
create temp table t_before as select recorded_at, key_version from suppression.contact_keys where contact_id = tests.rid('a_contact');
select pg_temp.rk('a_sales', 'a_contact', pg_temp.ks('a_mail', 'a_phone'));
select is((select recorded_at from suppression.contact_keys where contact_id = tests.rid('a_contact')), (select recorded_at from t_before), 'B12 recording the same keys again does not touch the row (idempotent)');
-- shapes
select is(pg_temp.code('a_sales', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('a_contact'), '{"version": 1, "email": "ABC"}')), '22023', 'B13 a key that is not 64 hex digits is refused');
select is(pg_temp.code('a_sales', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('a_contact'), jsonb_build_object('version', 1, 'email', upper(pg_temp.h('q')))::text)), '22023', 'B14 upper-case hex is refused');
select is(pg_temp.code('a_sales', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('a_contact'), '{"email": "' || pg_temp.h('q') || '"}')), '22023', 'B15 a missing version is refused');
select is(pg_temp.code('a_sales', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('a_contact'), '{"version": 0, "email": "' || pg_temp.h('q') || '"}')), '22023', 'B16 version 0 is refused');
select is(pg_temp.code('a_sales', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('a_contact'), '{"version": 33, "email": "' || pg_temp.h('q') || '"}')), '22023', 'B17 version 33 is refused');
select is(pg_temp.code('a_sales', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('a_contact'), '{"version": 1.5, "email": "' || pg_temp.h('q') || '"}')), '22023', 'B18 a fractional version is refused');
select is(pg_temp.code('a_sales', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('a_contact'), '{"version": 1}')), '22023', 'B19 no key at all is refused');
select is(pg_temp.code('a_sales', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('a_contact'), '{"version": 1, "email": null, "phone": null}')), '22023', 'B20 two null keys are refused');
select is(pg_temp.code('a_sales', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('a_contact'), '{"version": 1, "email": "' || pg_temp.h('q') || '", "name": "x"}')), '22023', 'B21 an unknown key is refused');
select is(pg_temp.code('a_sales', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('a_contact'), '[]')), '22023', 'B22 a non-object is refused');
select is(pg_temp.code('a_sales', format('select public.record_contact_keys(%L, null)', tests.rid('a_contact'))), '22023', 'B23 a null key set is refused');
select is(pg_temp.code('a_sales', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('c3'), pg_temp.ks('c3_mail', 'c3_phone'))), '22023', 'B24 a phone key for a contact with no phone is refused (a key never names an identifier that is not there)');
select is(pg_temp.code('a_sales', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('c4'), pg_temp.ks('c4_mail', null))), '22023', 'B25 an e-mail key for a contact with no e-mail is refused');
select is(pg_temp.code('a_sales', format('select public.record_contact_keys(%L, %L::jsonb, %L::jsonb)', tests.rid('a_contact'), pg_temp.ks('a_mail', 'a_phone'), '{"email": ["zz"]}')), '22023', 'B26 a bad previous-version key is refused');
select is(pg_temp.code('a_sales', format('select public.record_contact_keys(%L, %L::jsonb, %L::jsonb)', tests.rid('a_contact'), pg_temp.ks('a_mail', 'a_phone'), jsonb_build_object('email', jsonb_build_array(pg_temp.h('1'), pg_temp.h('2'), pg_temp.h('3'), pg_temp.h('4'), pg_temp.h('5')))::text)), '22023', 'B27 more than four previous keys are refused');
select is(pg_temp.code('a_sales', format('select public.record_contact_keys(%L, %L::jsonb, %L::jsonb)', tests.rid('a_contact'), pg_temp.ks('a_mail', 'a_phone'), '{"name": []}')), '22023', 'B28 an unknown previous-version kind is refused');
-- merge: a call with one key never forgets the other; another version replaces both
select pg_temp.rk('a_sales', 'a_contact', pg_temp.ks('a_mail', null));
select is((select phone_hmac = pg_temp.h('a_phone') from suppression.contact_keys where contact_id = tests.rid('a_contact')), true, 'B29 a call with only the e-mail key keeps the phone key');
select pg_temp.rk('a_sales', 'a_contact', pg_temp.ks('a_mail2', null, 2));
select is((select email_hmac = pg_temp.h('a_mail2') and phone_hmac is null and key_version = 2 from suppression.contact_keys where contact_id = tests.rid('a_contact')), true, 'B30 a NEW version replaces the whole set (keys of two versions are never mixed)');
select pg_temp.rk('a_sales', 'a_contact', pg_temp.ks('a_mail', 'a_phone', 1));
-- an erased contact
-- (the refusal for an ERASED contact is tested in G, after a real erasure: only an erasure can mark a contact erased)



-- ============================================================================ K. check_suppression (nothing is suppressed yet)
select is(pg_temp.sc('a_sales', format('select public.check_suppression(%L, %L::jsonb)', tests.tid('a'), jsonb_build_object('email', jsonb_build_array(pg_temp.h('a_mail')), 'phone', jsonb_build_array(pg_temp.h('a_phone')))::text)),
          '{"email": false, "phone": false, "suppressed": false}', 'K1 nothing is suppressed yet');
select is(pg_temp.code('a_viewer', format('select public.check_suppression(%L, %L::jsonb)', tests.tid('a'), '{}')), '42501', 'K2 a Viewer cannot ask');
select is(pg_temp.code('b_owner', format('select public.check_suppression(%L, %L::jsonb)', tests.tid('a'), '{}')), '42501', 'K3 another tenant''s Owner cannot ask');
select is(pg_temp.code('a_sales', format('select public.check_suppression(%L, %L::jsonb)', tests.tid('a'), '{"email": "x"}')), '22023', 'K4 a non-array is refused');
select is(pg_temp.code('a_sales', format('select public.check_suppression(%L, %L::jsonb)', tests.tid('a'), '{"fax": []}')), '22023', 'K5 an unknown kind is refused');
select is(pg_temp.code('a_sales', format('select public.check_suppression(%L, %L::jsonb)', tests.tid('a'), '{"email": ["zz"]}')), '22023', 'K6 a bad key is refused');
select is(pg_temp.sc('a_sales', format('select public.check_suppression(%L, %L::jsonb)', tests.tid('a'), '{}')), '{"email": false, "phone": false, "suppressed": false}', 'K7 an empty question has an empty answer');

-- ============================================================================ C. the keys follow the contact's suppression and its lifting
select is(pg_temp.events(), 0::bigint, 'C0 no event yet');
select is(pg_temp.sc('a_sales', format($q$select public.suppress_contact(%L, %L, 'opted_out', 'verbal', 'call:1') is not null$q$, tests.tid('a'), tests.rid('a_contact'))), 'true', 'C1 Sales suppresses a keyed contact through the EXISTING function');
select is((select string_agg(kind || ':' || event || ':' || reason, ',' order by kind) from suppression.key_events where tenant_id = tests.tid('a')), 'email:suppressed:opted_out,phone:suppressed:opted_out', 'C2 both keys became suppressed, with the contact''s reason');
select is((select count(*) from suppression.key_events where source_contact_id = tests.rid('a_contact') and created_by = tests.uid('a_sales')), 2::bigint, 'C3 each event records the contact it came from and who did it');
select is(pg_temp.sc('a_sales', format('select public.check_suppression(%L, %L::jsonb)', tests.tid('a'), jsonb_build_object('email', jsonb_build_array(pg_temp.h('a_mail')), 'phone', jsonb_build_array(pg_temp.h('nobody')))::text)),
          '{"email": true, "phone": false, "suppressed": true}', 'C4 check_suppression says which KIND, never why or whose');
select is(pg_temp.sc('a_viewer', format('select public.suppress_contact(%L, %L, ''opted_out'', ''verbal'', ''call:1'') is not null', tests.tid('a'), tests.rid('a_contact'))), 'ERR:42501', 'C5 (control) a Viewer still cannot suppress');
select is(pg_temp.sc('a_sales', format($q$select public.suppress_contact(%L, %L, 'opted_out', 'verbal', 'call:1') is not null$q$, tests.tid('a'), tests.rid('a_contact'))), 'true', 'C6 suppressing again is a no-op');
select is(pg_temp.events(), 2::bigint, 'C7 ... and writes no new event');
-- a contact without keys: nothing to mirror
select pg_temp.sc('a_sales', format($q$select public.suppress_contact(%L, %L, 'manual', null, null) is not null$q$, tests.tid('a'), tests.rid('c5')));
select is(pg_temp.events(), 2::bigint, 'C8 suppressing a contact with no recorded keys writes no event');
-- lifting: the Owner with aal2 only
select is(pg_temp.at('aal2', 'a_admin', format($q$select public.lift_suppression(%L, %L, 'written', 'letter:1')$q$, tests.tid('a'), tests.rid('a_contact'))), '42501', 'C9 an Admin cannot lift (owner decision 4)');
select is(pg_temp.at('aal2', 'a_sales', format($q$select public.lift_suppression(%L, %L, 'written', 'letter:1')$q$, tests.tid('a'), tests.rid('a_contact'))), '42501', 'C10 Sales cannot lift');
select is(pg_temp.at('aal1', 'a_admin', format($q$select public.lift_suppression(%L, %L, 'written', 'letter:1')$q$, tests.tid('a'), tests.rid('a_contact'))), '42501', 'C11 an Admin at aal1 gets the plain refusal (the role is proven before the level)');
select is(pg_temp.at('aal1', 'a_owner', format($q$select public.lift_suppression(%L, %L, 'written', 'letter:1')$q$, tests.tid('a'), tests.rid('a_contact'))), 'SM306', 'C12 an Owner with a password only is told to use the second factor');
select is(pg_temp.at('absent', 'a_owner', format($q$select public.lift_suppression(%L, %L, 'written', 'letter:1')$q$, tests.tid('a'), tests.rid('a_contact'))), 'SM306', 'C13 ... and so is a token with no assurance claim');
select is(pg_temp.events('lifted'), 0::bigint, 'C14 nothing was lifted by those refusals');
select is(pg_temp.at('aal2', 'a_owner', format($q$select public.lift_suppression(%L, %L, 'written', 'letter:1')$q$, tests.tid('a'), tests.rid('a_contact'))), 'ok', 'C15 the Owner with aal2 lifts');
select is((select string_agg(kind || ':' || event, ',' order by seq) from suppression.key_events where tenant_id = tests.tid('a') and event = 'lifted'), 'email:lifted,phone:lifted', 'C16 the keys were lifted with it');
select is(pg_temp.sc('a_sales', format('select public.check_suppression(%L, %L::jsonb)', tests.tid('a'), jsonb_build_object('email', jsonb_build_array(pg_temp.h('a_mail')))::text)), '{"email": false, "phone": false, "suppressed": false}', 'C17 the lifted key is no longer suppressed');
select is(pg_temp.at('aal2', 'a_owner', format($q$select public.lift_suppression(%L, %L, 'written', 'letter:2')$q$, tests.tid('a'), tests.rid('a_contact'))), 'ok', 'C18 lifting a contact that is not suppressed is a no-op');
select is(pg_temp.events('lifted'), 2::bigint, 'C19 ... and writes nothing');
-- suppressed again: the LATEST event decides, by the sequence, not by the clock
select pg_temp.sc('a_sales', format($q$select public.suppress_contact(%L, %L, 'bounced', null, null) is not null$q$, tests.tid('a'), tests.rid('a_contact')));
select is(pg_temp.sc('a_sales', format('select public.check_suppression(%L, %L::jsonb)', tests.tid('a'), jsonb_build_object('email', jsonb_build_array(pg_temp.h('a_mail')))::text)), '{"email": true, "phone": false, "suppressed": true}', 'C20 suppressed again (the later event wins even inside one transaction)');
select is((select string_agg(distinct reason, ',') from suppression.key_events where event = 'suppressed' and tenant_id = tests.tid('a')), 'bounced,opted_out', 'C21 the new reason is recorded');
select is((select count(*) from suppression.key_events where seq is null), 0::bigint, 'C22 every event has its sequence');

-- ============================================================================ D. a contact that arrives with a suppressed key is FLAGGED
-- c2 arrives with the PHONE of the suppressed contact (another e-mail): it is created flagged, consent withdrawn, never contactable
select pg_temp.sc('a_sales', format($q$select public.record_consent(%L, %L, 'email', 'granted', 'explicit_consent', 'web_form', 'form:c2')$q$, tests.tid('a'), tests.rid('c2')));
select is(pg_temp.sc('a_sales', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('c2'), jsonb_build_object('version', 1, 'email', pg_temp.h('c2_mail'), 'phone', pg_temp.h('a_phone'))::text)) ::jsonb ->> 'flagged', 'true', 'D1 a contact arriving with a suppressed phone key is flagged');
select is((select suppressed_at is not null and suppression_reason::text = 'bounced' from public.contacts where id = tests.rid('c2')), true, 'D2 it is suppressed with the key''s reason');
select is((select email_consent::text from public.contacts where id = tests.rid('c2')), 'granted', 'D3 (bounced does not withdraw consent: the existing rule)');
select is((select count(*) from public.consent_events where contact_id = tests.rid('c2') and event_type = 'suppressed' and evidence_ref = 'system:suppression-key'), 1::bigint, 'D4 the consent ledger records who flagged it: the system, by a key');
select is(pg_temp.sc('a_sales', format('select public.check_suppression(%L, %L::jsonb)', tests.tid('a'), jsonb_build_object('email', jsonb_build_array(pg_temp.h('c2_mail')))::text)), '{"email": true, "phone": false, "suppressed": true}', 'D5 the arriving contact''s OTHER key became suppressed too (the same person)');
select is(pg_temp.sc('a_sales', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('c2'), jsonb_build_object('version', 1, 'email', pg_temp.h('c2_mail'), 'phone', pg_temp.h('a_phone'))::text)) ::jsonb ->> 'flagged', 'false', 'D6 recording again flags nothing more (already suppressed)');
-- an opt-out reason withdraws consent when a contact is flagged by it
select pg_temp.sc('a_sales', format($q$select public.suppress_contact(%L, %L, 'opted_out', 'verbal', 'call:2') is not null$q$, tests.tid('a'), tests.rid('c6')));
select pg_temp.rk('a_sales', 'c6', pg_temp.ks('c6_mail', 'c6_phone'));
select pg_temp.sc('a_sales', format($q$select public.record_consent(%L, %L, 'email', 'granted', 'explicit_consent', 'web_form', 'form:c9')$q$, tests.tid('a'), tests.rid('c9')));
select is(pg_temp.sc('a_sales', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('c9'), jsonb_build_object('version', 1, 'email', pg_temp.h('c9_mail'), 'phone', pg_temp.h('c6_phone'))::text)) ::jsonb ->> 'flagged', 'true', 'D7 arriving with the phone key of an OPTED-OUT person is flagged');
select is((select suppression_reason::text || '/' || email_consent::text from public.contacts where id = tests.rid('c9')), 'opted_out/withdrawn', 'D8 ... with the opt-out reason, and the consent it held is withdrawn');
-- previous key versions are matched too, never stored
select is(pg_temp.sc('a_sales', format('select public.record_contact_keys(%L, %L::jsonb, %L::jsonb)', tests.rid('c3'), jsonb_build_object('version', 2, 'email', pg_temp.h('c3_mail_v2'))::text,
                                       jsonb_build_object('email', jsonb_build_array(pg_temp.h('c3_old1'), pg_temp.h('a_mail')))::text)) ::jsonb ->> 'flagged', 'true', 'D9 a PREVIOUS key version is matched (a rotation never forgets an address)');
select is((select email_hmac = pg_temp.h('c3_mail_v2') and key_version = 2 from suppression.contact_keys where contact_id = tests.rid('c3')), true, 'D10 only the current version is stored');
select is((select count(*) from suppression.contact_keys where email_hmac = pg_temp.h('a_mail') and contact_id = tests.rid('c3')), 0::bigint, 'D11 the previous-version key itself is not stored');

-- ============================================================================ E. a changed identifier forgets its stored key
select is((select phone_hmac is not null and email_hmac is not null from suppression.contact_keys where contact_id = tests.rid('c6')), true, 'E0 c6 is keyed');
update public.contacts set phone = '+00 90000 00067' where id = tests.rid('c6');
select is((select email_hmac is not null and phone_hmac is null from suppression.contact_keys where contact_id = tests.rid('c6')), true, 'E1 a changed phone forgets the phone key and keeps the e-mail key');
update public.contacts set email = 'c6b@example.test' where id = tests.rid('c6');
select is((select email_hmac is null and phone_hmac is null from suppression.contact_keys where contact_id = tests.rid('c6')), true, 'E2 a changed e-mail forgets the e-mail key');
update public.contacts set full_name = 'Contact six renamed' where id = tests.rid('c6');
select is((select count(*) from suppression.contact_keys where contact_id = tests.rid('c6')), 1::bigint, 'E3 another change leaves the row');
select pg_temp.rk('a_sales', 'c6', pg_temp.ks('c6b_mail', 'c6b_phone'));
select is((select email_hmac = pg_temp.h('c6b_mail') and phone_hmac = pg_temp.h('c6b_phone') from suppression.contact_keys where contact_id = tests.rid('c6')), true, 'E4 the API records the new keys');

-- ============================================================================ F. the unkeyed list, the count and the backfill
select is(pg_temp.sc('a_owner', format('select public.unkeyed_contact_count(%L)', tests.tid('a'))), '2', 'F1 two contacts hold identifiers with no key (c5 and c7); c4 has no identifier and is never unkeyed');
select is(pg_temp.sc('a_admin', format('select public.unkeyed_contact_count(%L)', tests.tid('a'))), '2', 'F2 an Admin may count');
select is(pg_temp.code('a_sales', format('select public.unkeyed_contact_count(%L)', tests.tid('a'))), '42501', 'F3 Sales may not');
select is(pg_temp.code('a_viewer', format('select public.unkeyed_contact_count(%L)', tests.tid('a'))), '42501', 'F4 a Viewer may not');
select is(pg_temp.code('b_owner', format('select public.unkeyed_contact_count(%L)', tests.tid('a'))), '42501', 'F5 another tenant''s Owner may not');
select is(pg_temp.code('a_owner', 'select public.unkeyed_contact_count(null)'), '42501', 'F6 a null tenant is the same refusal');
select is(pg_temp.at('aal2', 'a_owner', format('select public.unkeyed_contacts(%L, 10)', tests.tid('a'))), 'ok', 'F7 the Owner with aal2 lists the contacts that still need keys');
select is(pg_temp.sc('a_owner', format('select public.unkeyed_contacts(%L, 10)', tests.tid('a'))) like '%' || tests.rid('c7')::text || '%', true, 'F8 it names c7');
select is(pg_temp.sc('a_owner', format('select jsonb_array_length(public.unkeyed_contacts(%L, 10))', tests.tid('a'))), '2', 'F9 and c5, nothing else');
select is(pg_temp.code('a_admin', format('select public.unkeyed_contacts(%L, 10)', tests.tid('a'))), '42501', 'F10 an Admin may not (it hands out contact details)');
select is(pg_temp.at('aal1', 'a_owner', format('select public.unkeyed_contacts(%L, 10)', tests.tid('a'))), 'SM306', 'F11 an Owner without the second factor may not');
select is(pg_temp.code('a_owner', format('select public.unkeyed_contacts(%L, 0)', tests.tid('a'))), '22023', 'F12 a limit of 0 is refused');
select is(pg_temp.code('a_owner', format('select public.unkeyed_contacts(%L, 501)', tests.tid('a'))), '22023', 'F13 a limit of 501 is refused');
select is(pg_temp.code('a_owner', format('select public.unkeyed_contacts(%L, null)', tests.tid('a'))), '22023', 'F14 a null limit is refused');
-- the backfill: c7 plus a new contact c8 whose phone key is the opted-out person's
insert into public.contacts (id, tenant_id, company_id, full_name, email, phone) values (tests.rid('c8'), tests.tid('a'), tests.rid('a_company'), 'Contact eight', 'c8@example.test', '+00 90000 00088');
select is(pg_temp.code('a_admin', format('select public.backfill_contact_keys(%L, %L::jsonb)', tests.tid('a'), '[]')), '42501', 'F15 an Admin cannot backfill');
select is(pg_temp.code('a_sales', format('select public.backfill_contact_keys(%L, %L::jsonb)', tests.tid('a'), '[]')), '42501', 'F16 Sales cannot');
select is(pg_temp.at('aal1', 'a_owner', format('select public.backfill_contact_keys(%L, %L::jsonb)', tests.tid('a'), '[]')), 'SM306', 'F17 an Owner without the second factor cannot');
select is(pg_temp.code('b_owner', format('select public.backfill_contact_keys(%L, %L::jsonb)', tests.tid('a'), '[]')), '42501', 'F18 another tenant''s Owner cannot');
select is(pg_temp.code('a_owner', format('select public.backfill_contact_keys(%L, %L::jsonb)', tests.tid('a'), '{}')), '22023', 'F19 a non-array is refused');
select is(pg_temp.code('a_owner', format('select public.backfill_contact_keys(%L, null)', tests.tid('a'))), '22023', 'F20 a null list is refused');
select is(pg_temp.code('a_owner', format('select public.backfill_contact_keys(%L, (select jsonb_agg(jsonb_build_object(''contact_id'', gen_random_uuid())) from generate_series(1, 201)))', tests.tid('a'))), '22023', 'F21 more than 200 items are refused');
select is(pg_temp.sc('a_owner', format('select public.backfill_contact_keys(%L, %L::jsonb)', tests.tid('a'),
            jsonb_build_array(jsonb_build_object('contact_id', tests.rid('c7'), 'keys', jsonb_build_object('version', 1, 'email', pg_temp.h('c7_mail'), 'phone', pg_temp.h('c7_phone'))),
                              jsonb_build_object('contact_id', tests.rid('c5'), 'keys', jsonb_build_object('version', 1, 'email', pg_temp.h('c5_mail'), 'phone', pg_temp.h('c5_phone'))),
                              jsonb_build_object('contact_id', tests.rid('c8'), 'keys', jsonb_build_object('version', 1, 'email', pg_temp.h('c8_mail'), 'phone', pg_temp.h('c6_phone'))),
                              jsonb_build_object('contact_id', tests.rid('b_contact'), 'keys', jsonb_build_object('version', 1, 'email', pg_temp.h('b_mail'))),
                              jsonb_build_object('contact_id', 'not-a-uuid', 'keys', jsonb_build_object('version', 1, 'email', pg_temp.h('x'))),
                              jsonb_build_object('contact_id', tests.rid('c4'), 'keys', jsonb_build_object('version', 1, 'email', pg_temp.h('x'))),
                              jsonb_build_object('contact_id', tests.rid('c7'), 'keys', jsonb_build_object('version', 1, 'email', 'bad')))::text))::jsonb,
          '{"recorded": 3, "skipped": 4, "flagged": 1, "remaining": 0}'::jsonb, 'F22 the backfill records c5, c7 and c8, skips another tenant''s contact, a bad id, an identifier the contact lacks and a bad key, flags the one that arrived suppressed, and nothing remains');
select is((select suppressed_at is not null from public.contacts where id = tests.rid('c8')), true, 'F23 c8 (its phone key was an opted-out person''s) is now suppressed');
select is((select count(*) from suppression.contact_keys where contact_id = tests.rid('b_contact')), 0::bigint, 'F24 another tenant''s contact was not keyed');
select is(pg_temp.sc('a_owner', format('select public.unkeyed_contact_count(%L)', tests.tid('a'))), '0', 'F25 nothing is unkeyed any more');
select is(pg_temp.sc('a_owner', format('select public.backfill_contact_keys(%L, %L::jsonb)', tests.tid('a'), jsonb_build_array(jsonb_build_object('contact_id', tests.rid('c7'), 'keys', jsonb_build_object('version', 1, 'email', pg_temp.h('c7_mail'), 'phone', pg_temp.h('c7_phone'))))::text)) ::jsonb ->> 'remaining', '0', 'F26 a second run is harmless');

-- ============================================================================ G. erasure writes the keys first; SM221; the Owner's "without a key" step
create function pg_temp.req(p_id text, p_subject text, p_scope text default 'contact') returns text language sql as $$
  select pg_temp.at('aal2', 'a_owner', format('select public.request_erasure(%L, %L, %L, %L)', tests.rid(p_id), tests.tid('a'), p_scope, case when p_subject is null then null else tests.rid(p_subject) end)) $$;
create function pg_temp.exec(p_user text, p_id text, p_dry boolean default false) returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.execute_erasure(%L, %L)', tests.rid(p_id), p_dry)) $$;
insert into public.contacts (id, tenant_id, company_id, full_name, email, phone) values
  (tests.rid('e1'), tests.tid('a'), tests.rid('a_company'), 'Erase one', 'e1@example.test', '+00 90000 00101'),
  (tests.rid('e2'), tests.tid('a'), tests.rid('a_company'), 'Erase two', 'e2@example.test', '+00 90000 00102'),
  (tests.rid('e3'), tests.tid('a'), tests.rid('a_company'), 'Erase three', null, null),
  (tests.rid('e4'), tests.tid('a'), tests.rid('a_company'), 'Erase four', 'e4@example.test', '+00 90000 00104');
select pg_temp.rk('a_sales', 'e1', pg_temp.ks('e1_mail', 'e1_phone'));
select pg_temp.rk('a_sales', 'e2', pg_temp.ks('e2_mail', null));
select pg_temp.rk('a_sales', 'e4', pg_temp.ks('e4_mail', 'e4_phone'));
-- e2 holds a phone number with no key: refused
select is(pg_temp.req('g2', 'e2'), 'ok', 'G1 the Owner requests the erasure of e2');
select is(pg_temp.at('aal2', 'a_owner', format('select public.execute_erasure(%L, false)', tests.rid('g2'))), 'SM221', 'G2 an identifier with no recorded key: the erasure is refused (SM221)');
select is((select email from public.contacts where id = tests.rid('e2')), 'e2@example.test', 'G3 nothing was erased');
select is((select count(*) from suppression.key_events where reason = 'erased'), 0::bigint, 'G4 and no key was written');
select is((select status::text from public.erasure_requests where id = tests.rid('g2')), 'pending', 'G5 the request is still pending');
-- the Owner's explicit step
select is(pg_temp.at('aal2', 'a_admin', format('select public.allow_erasure_without_key(%L)', tests.rid('g2'))), '42501', 'G6 an Admin cannot allow an erasure without a key');
select is(pg_temp.at('aal2', 'a_sales', format('select public.allow_erasure_without_key(%L)', tests.rid('g2'))), '42501', 'G7 Sales cannot');
select is(pg_temp.at('aal2', 'b_owner', format('select public.allow_erasure_without_key(%L)', tests.rid('g2'))), '42501', 'G8 another tenant''s Owner cannot');
select is(pg_temp.at('aal2', 'a_owner', format('select public.allow_erasure_without_key(%L)', gen_random_uuid())), '42501', 'G9 an unknown request is the same refusal');
select is(pg_temp.at('aal2', 'a_owner', 'select public.allow_erasure_without_key(null)'), '42501', 'G10 a null request is the same refusal');
select is(pg_temp.at('aal1', 'a_owner', format('select public.allow_erasure_without_key(%L)', tests.rid('g2'))), 'SM306', 'G11 an Owner with a password only is told to use the second factor');
select is((select without_key_at is null from public.erasure_requests where id = tests.rid('g2')), true, 'G12 none of those refusals changed the request');
select is(pg_temp.at('aal2', 'a_owner', format('select public.allow_erasure_without_key(%L)', tests.rid('g2'))), 'ok', 'G13 the Owner with aal2 allows it');
select is(pg_temp.sc('a_owner', format('select public.allow_erasure_without_key(%L)', tests.rid('g2'))) ::jsonb ->> 'replayed', 'true', 'G14 a second call is a replay');
select is((select without_key_by = tests.uid('a_owner') and without_key_at is not null from public.erasure_requests where id = tests.rid('g2')), true, 'G15 who and when are recorded');
select is((select count(*) from public.audit_events where entity_type = 'erasure_request' and entity_id = tests.rid('g2') and action = 'erasure_request.update' and new_values ? 'without_key_at'), 1::bigint, 'G16 the step is audited');
select is(pg_temp.exec('a_owner', 'g2', true) ::jsonb -> 'counts' ->> 'suppression.erased_without_key', '1', 'G17 the preview counts the erasure without a key');
select is((select count(*) from suppression.key_events where reason = 'erased'), 0::bigint, 'G18 ... and the preview left nothing behind');
select is(pg_temp.exec('a_owner', 'g2') ::jsonb -> 'counts' ->> 'suppression.erased_without_key', '1', 'G19 the erasure runs and says it had no key for the phone');
select is(pg_temp.sc('a_owner', format('select public.execute_erasure(%L, false)', tests.rid('g2'))) ::jsonb ->> 'replayed', 'true', 'G20 (a replay of the executed request)');
select is((select email is null and phone is null and erased_at is not null from public.contacts where id = tests.rid('e2')), true, 'G21 e2 is erased');
select is((select count(*) from suppression.key_events where reason = 'erased' and source_contact_id = tests.rid('e2')), 1::bigint, 'G22 the e-mail key that existed was written as an `erased` event');
select is((select count(*) from suppression.contact_keys where contact_id = tests.rid('e2')), 0::bigint, 'G23 the stored keys went with the contact');
-- a fully keyed contact: no step is needed
select is(pg_temp.req('g1', 'e1'), 'ok', 'G24 the Owner requests the erasure of e1 (fully keyed)');
select is(pg_temp.exec('a_owner', 'g1') ::jsonb -> 'counts' ->> 'suppression.keys_written', '2', 'G25 both keys are written before the identifiers go');
select is(pg_temp.sc('a_owner', format('select public.execute_erasure(%L, false)', tests.rid('g1'))) ::jsonb -> 'counts' ? 'suppression.erased_without_key', 'false', 'G26 and it did not need the Owner''s step');
select is((select count(*) from suppression.key_events where reason = 'erased' and source_contact_id = tests.rid('e1')), 2::bigint, 'G27 two `erased` events');
select is(pg_temp.sc('a_sales', format('select public.check_suppression(%L, %L::jsonb)', tests.tid('a'), jsonb_build_object('email', jsonb_build_array(pg_temp.h('e1_mail')), 'phone', jsonb_build_array(pg_temp.h('e1_phone')))::text)),
          '{"email": true, "phone": true, "suppressed": true}', 'G28 both keys are suppressed after the erasure');
-- no identifiers: nothing to key
select is(pg_temp.req('g3', 'e3'), 'ok', 'G29 a contact with no identifiers can be erased');
select is((pg_temp.exec('a_owner', 'g3') ::jsonb -> 'counts') ? 'suppression.keys_written', false, 'G30 with no key and no step (a zero count is not listed)');
-- a preview unwinds everything, the keys included
select is(pg_temp.req('g4', 'e4'), 'ok', 'G31 the Owner requests the erasure of e4');
select is(pg_temp.exec('a_owner', 'g4', true) ::jsonb -> 'counts' ->> 'suppression.keys_written', '2', 'G32 the preview counts the keys it would write');
select is((select count(*) from suppression.key_events where source_contact_id = tests.rid('e4')), 0::bigint, 'G33 ... and wrote none');
select is((select count(*) from suppression.contact_keys where contact_id = tests.rid('e4')), 1::bigint, 'G34 ... and left the stored keys');
select is((select email from public.contacts where id = tests.rid('e4')), 'e4@example.test', 'G35 ... and the contact');
select is(pg_temp.exec('a_owner', 'g4') ::jsonb -> 'counts' ->> 'suppression.keys_written', '2', 'G36 the real run writes them');
-- the re-import: an erased person's address arrives again
insert into public.contacts (id, tenant_id, company_id, full_name, email, phone) values (tests.rid('e5'), tests.tid('a'), tests.rid('a_company'), 'Erase one again', 'e1@example.test', null);
select is(pg_temp.sc('a_sales', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('e5'), pg_temp.ks('e1_mail', null))) ::jsonb ->> 'flagged', 'true', 'G37 THE GATE: the same address imported again is flagged');
select is((select suppression_reason::text from public.contacts where id = tests.rid('e5')), 'legal', 'G38 as `legal` (a person exercised a right), not as an opt-out');
select is((select count(*) from public.consent_events where contact_id = tests.rid('e5') and event_type = 'suppressed' and evidence_ref = 'system:suppression-key'), 1::bigint, 'G39 and the consent ledger says the system did it');
select is(pg_temp.code('a_sales', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('e1'), pg_temp.ks('e1_mail', null))), '23503', 'G37b the keys of an ERASED contact are not recorded (invalid reference)');
-- the key does not cross tenants
select is(pg_temp.sc('b_owner', format('select public.check_suppression(%L, %L::jsonb)', tests.tid('b'), jsonb_build_object('email', jsonb_build_array(pg_temp.h('e1_mail')))::text)), '{"email": false, "phone": false, "suppressed": false}', 'G40 another workspace does not see it');
select is((select count(*) from suppression.key_events where tenant_id = tests.tid('b')), 0::bigint, 'G41 and has no event of its own');
-- the whole workspace: never refused; the keys that exist become events
select pg_temp.sc('b_owner', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid('b_contact'), pg_temp.ks('b_mail', 'b_phone')));
select is(pg_temp.at('aal2', 'b_owner', format('select public.request_erasure(%L, %L, ''tenant'', null)', tests.rid('gt'), tests.tid('b'))), 'ok', 'G42 the Owner of tenant b requests the whole-workspace erasure');
select is(pg_temp.sc('b_owner', format('select public.execute_erasure(%L, true)', tests.rid('gt'))) ::jsonb -> 'counts' ->> 'suppression.keys_written', '2', 'G43 its preview counts the keys');
select is((select count(*) from suppression.key_events where tenant_id = tests.tid('b')), 0::bigint, 'G44 ... and wrote none');
update public.erasure_requests set execute_after = now() - interval '1 second' where id = tests.rid('gt');
select is(pg_temp.sc('b_owner', format('select public.execute_erasure(%L, false)', tests.rid('gt'))) ::jsonb -> 'counts' ->> 'suppression.keys_written', '2', 'G45 the real run writes them, and is not blocked by anything');
select is((select count(*) from suppression.contact_keys where tenant_id = tests.tid('b')), 0::bigint, 'G46 the stored keys are gone');
select is(pg_temp.sc('b_owner', format('select public.check_suppression(%L, %L::jsonb)', tests.tid('b'), jsonb_build_object('email', jsonb_build_array(pg_temp.h('b_mail')))::text)), '{"email": true, "phone": false, "suppressed": true}', 'G47 the erased workspace''s address is still suppressed');

-- ============================================================================ H. the ledger is append-only for every role
select is(pg_temp.priv('update suppression.key_events set reason = ''manual'''), '42501', 'H1 an UPDATE of the ledger is refused');
select is(pg_temp.priv('delete from suppression.key_events'), '42501', 'H2 a DELETE is refused');
select is(pg_temp.priv('truncate suppression.key_events'), '42501', 'H3 a TRUNCATE is refused');
select is(pg_temp.priv('truncate suppression.contact_keys'), '42501', 'H4 so is a TRUNCATE of the stored keys');
select is(pg_temp.priv(format('insert into suppression.key_events (tenant_id, kind, key_hmac, key_version, event) values (%L, ''email'', %L, 1, ''suppressed'')', tests.tid('a'), pg_temp.h('z'))), '23514', 'H5 a `suppressed` event without a reason is refused');
select is(pg_temp.priv(format('insert into suppression.key_events (tenant_id, kind, key_hmac, key_version, event, reason) values (%L, ''email'', %L, 1, ''lifted'', ''manual'')', tests.tid('a'), pg_temp.h('z'))), '23514', 'H6 a `lifted` event with a reason is refused');
select is(pg_temp.priv(format('insert into suppression.key_events (tenant_id, kind, key_hmac, key_version, event, reason) values (%L, ''email'', ''ABC'', 1, ''suppressed'', ''manual'')', tests.tid('a'))), '23514', 'H7 a key that is not 64 lower-case hex digits is refused');
select is(pg_temp.priv(format('insert into suppression.key_events (tenant_id, kind, key_hmac, key_version, event, reason) values (%L, ''fax'', %L, 1, ''suppressed'', ''manual'')', tests.tid('a'), pg_temp.h('z'))), '23514', 'H8 a kind other than e-mail or phone is refused');
select is(pg_temp.priv(format('insert into suppression.key_events (tenant_id, kind, key_hmac, key_version, event, reason) values (%L, ''email'', %L, 99, ''suppressed'', ''manual'')', tests.tid('a'), pg_temp.h('z'))), '23514', 'H9 a key version outside 1 to 32 is refused');
select is(pg_temp.priv(format('update suppression.contact_keys set tenant_id = %L', tests.tid('b'))), '42501', 'H10 a stored key cannot change tenant');

-- ============================================================================ I. the audit trail never holds a key
select ok((select count(*) from public.audit_events where entity_type = 'suppression_key_event') > 0 and (select count(*) from public.audit_events where entity_type = 'contact_key') > 0, 'I1 the events and the stored keys are audited');
select is((select count(*) from public.audit_events where entity_type = 'suppression_key_event' and (new_values ? 'key_hmac' or old_values ? 'key_hmac')), 0::bigint, 'I2 an event is audited WITHOUT its key value');
select is((select count(*) from public.audit_events where entity_type = 'contact_key' and (new_values ? 'email_hmac' or new_values ? 'phone_hmac' or old_values ? 'email_hmac' or old_values ? 'phone_hmac')), 0::bigint, 'I3 a stored key is audited WITHOUT its values');
select is((select count(*) from public.audit_events where entity_type = 'suppression_key_event' and metadata -> 'pii_fields_changed' ? 'key_hmac'), (select count(*) from public.audit_events where entity_type = 'suppression_key_event'), 'I4 ... but the audit says the key field changed');
select is((select count(*) from public.audit_events a where a.tenant_id = tests.tid('a') and (a.new_values::text like '%' || pg_temp.h('e1_mail') || '%' or a.old_values::text like '%' || pg_temp.h('e1_mail') || '%' or a.metadata::text like '%' || pg_temp.h('e1_mail') || '%')), 0::bigint, 'I5 a known key value appears nowhere in the audit trail');

select * from finish();
rollback;
