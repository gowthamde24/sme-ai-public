-- Order conversion (ADR 0021, migration 20261019090000): policy versions, orders, the append-only ledger, the three functions, the guard triggers, SM237 in the two replaced quote functions,
-- and the follow-up stop helper.
--   A catalog (definer, search_path, grants)   B order_policy_versions (Owner + aal2, shapes, effective dates, replay)   C create_order_from_quote (roles, aal2, SM230/231/233/236/239, copies the quote)
--   D record_order_event: roles and aal2 per event type, SM234, argument shapes   E the happy path to closed_paid, the ledger view, the cache equals the ledger
--   F every SM232 code and the override, refunds and cancellations   G forged requests and results (SM238), replay and conflict   H direct writes and the guard triggers
--   I SM237 through the REAL quote flow (withdraw, replace)   J app.order_stops_followups   K invariants over every order
-- All data is synthetic; the lifecycle's own rules are pinned against the real package by tests/integration/test_order_equivalence.py.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();
select tests.seed_t009();
select tests.as_aal('aal2');

create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.error_full_as(tests.uid(p_user), p_sql); end $$;
create function pg_temp.code(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return split_part(tests.error_full_as(tests.uid(p_user), p_sql), '|', 1); end $$;
create function pg_temp.at(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return split_part(tests.error_full_as(tests.uid(p_user), p_sql), '|', 1); end $$;
create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;
create function pg_temp.today() returns date language sql as $$ select app.quote_today() $$;
create function pg_temp.detail(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return split_part(tests.error_full_as(tests.uid(p_user), p_sql), '|', 3); end $$;

-- ---------------------------------------------------------------------------------------------
-- fixtures: a quote for a tenant (approved by default), its enquiry and requirement; the lead can be chosen
-- ---------------------------------------------------------------------------------------------
create function pg_temp.mkq(p_label text, p_total bigint, p_advance bigint, p_valid date default null, p_status text default 'approved', p_t text default 'a', p_lead text default null)
returns uuid language plpgsql as $$
declare v_lead uuid := tests.rid(coalesce(p_lead, p_t || '_lead'));
begin
  insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (tests.rid(p_label || '_enq'), tests.tid(p_t), v_lead, 'email', now() - interval '1 hour', 'Synthetic enquiry ' || p_label);
  insert into public.requirements (id, tenant_id, enquiry_id) values (tests.rid(p_label || '_req'), tests.tid(p_t), tests.rid(p_label || '_enq'));
  insert into public.quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, price_list_version_id, policy_version_id, engine_version, request_text, result_text,
                             canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, merchandise_net_paise, item_tax_paise, shipping_net_paise,
                             shipping_tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval, approved_by, approved_at, approved_hash, rejected_by, rejected_at, reject_code)
  values (tests.rid(p_label || '_quote'), tests.tid(p_t), (select coalesce(max(quote_no), 0) + 1 from public.quotes where tenant_id = tests.tid(p_t)), tests.rid(p_label || '_req'),
          tests.rid(p_label || '_enq'), v_lead, p_status::public.quote_status, tests.rid(p_t || '_price_version'), tests.rid(p_t || '_policy_version'), '1.1.0', '{}', '{}', repeat('3', 64),
          'new', 'TS', 'intra_state', least(pg_temp.today(), coalesce(p_valid, pg_temp.today() + 10)), coalesce(p_valid, pg_temp.today() + 10), pg_temp.today() + 30, p_total, 0, 0, 0, p_total, p_advance, p_total - p_advance, false,
          case when p_status in ('approved', 'superseded') then tests.uid(p_t || '_owner') end, case when p_status in ('approved', 'superseded') then now() end,
          case when p_status in ('approved', 'superseded') then repeat('5', 64) end,
          case when p_status = 'rejected' then tests.uid(p_t || '_owner') end, case when p_status = 'rejected' then now() end, case when p_status = 'rejected' then 'other'::public.quote_reject_code end);
  return tests.rid(p_label || '_quote');
end $$;

-- an order through the function (as the Owner at aal2); the order id is rid(label || '_order')
create function pg_temp.mko(p_label text) returns text language sql as $$
  select pg_temp.sc('a_owner', format('select public.create_order_from_quote(%L, %L)', tests.rid(p_label || '_order'), tests.rid(p_label || '_quote'))) $$;
create function pg_temp.ord(p_label text) returns uuid language sql as $$ select tests.rid(p_label || '_order') $$;
-- an order inserted the way a privileged fixture may (for a quote that has already expired)
create function pg_temp.mkorder_priv(p_label text, p_total bigint, p_advance bigint, p_valid date) returns uuid language plpgsql as $$
begin
  perform pg_temp.mkq(p_label, p_total, p_advance, p_valid);
  insert into public.orders (id, tenant_id, order_no, quote_id, enquiry_id, requirement_id, lead_id, order_total_paise, advance_paise, valid_until, policy_version_id)
  values (tests.rid(p_label || '_order'), tests.tid('a'), (select coalesce(max(order_no), 0) + 1 from public.orders where tenant_id = tests.tid('a')), tests.rid(p_label || '_quote'),
          tests.rid(p_label || '_enq'), tests.rid(p_label || '_req'), tests.rid('a_lead'), p_total, p_advance, p_valid, tests.rid('pol1'));
  insert into public.order_events (id, tenant_id, order_id, seq, type, prior_state, new_state, occurred_at)
  values (gen_random_uuid(), tests.tid('a'), tests.rid(p_label || '_order'), 1, 'created', null, 'quote_approved', now());
  return tests.rid(p_label || '_order');
end $$;

-- the request, the honest result and the call for one event
create function pg_temp.asof(p_shift interval default '0') returns text language sql as $$
  select to_char((now() + p_shift) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;
create function pg_temp.honest(p_req jsonb) returns jsonb language plpgsql as $$
declare d jsonb := app.order_decide(p_req);
begin
  if d ->> 'status' <> 'ok' then
    return jsonb_build_object('status', 'rejected', 'codes', jsonb_build_array(d ->> 'code'), 'new_state', null, 'engine_version', '1.0.0', 'canonical_hash', app.order_request_hash('1.0.0', p_req::text));
  end if;
  return jsonb_build_object('status', 'ok', 'new_state', d -> 'new_state', 'paid_total', d -> 'paid_total', 'balance_due', d -> 'balance_due', 'allowed_next_events', '[]'::jsonb,
           'flags', jsonb_build_object('needs_owner_approval', jsonb_array_length(d -> 'flags') > 0,
                                       'reasons', (select coalesce(jsonb_agg(jsonb_build_object('code', c)), '[]'::jsonb) from jsonb_array_elements_text(d -> 'flags') c)),
           'trace', '[]'::jsonb, 'engine_version', '1.0.0', 'canonical_hash', app.order_request_hash('1.0.0', p_req::text));
end $$;
-- the SQL of one call; p_req / p_res override the honest request / result (a forgery); the caller's role decides owner_override like the API does
create function pg_temp.callsql(p_user text, p_order uuid, p_type text, p_amount bigint default null, p_ledger uuid default null, p_reason text default null,
                                p_event uuid default null, p_req jsonb default null, p_res jsonb default null, p_ver text default '1.0.0', p_occ timestamptz default null,
                                p_reqtext text default null) returns text language plpgsql as $$
declare r jsonb := coalesce(p_req, app.order_build(p_order, p_type, p_amount, p_ledger, pg_temp.asof(), p_user = 'a_owner'));
begin
  return format('select public.record_order_event(%L, %L, %L, %L, %L::bigint, %L::uuid, %L, %L, %L, %L)', coalesce(p_event, gen_random_uuid()), p_order, p_type, coalesce(p_occ, now()),
                p_amount, p_ledger, p_reason, p_ver, coalesce(p_reqtext, r::text), coalesce(p_res, pg_temp.honest(r))::text);
end $$;
-- record an event as a user; returns the new state, or 'ERR:<sqlstate>' (detail appended for SM232)
create function pg_temp.rec(p_user text, p_label text, p_type text, p_amount bigint default null, p_ledger text default null, p_reason text default null) returns text language plpgsql as $$
declare v_out text;
begin
  perform tests.as_aal('aal2');
  v_out := tests.error_full_as(tests.uid(p_user), pg_temp.callsql(p_user, pg_temp.ord(p_label), p_type, p_amount, case when p_ledger is null then null else tests.rid(p_ledger) end, p_reason));
  if v_out = 'ok' then
    return (select state::text from public.orders where id = pg_temp.ord(p_label));
  end if;
  return 'ERR:' || split_part(v_out, '|', 1) || case when split_part(v_out, '|', 1) = 'SM232' then ':' || split_part(v_out, '|', 3) else '' end;
end $$;
create function pg_temp.st(p_label text) returns text language sql as $$ select state::text from public.orders where id = pg_temp.ord(p_label) $$;
create function pg_temp.nev(p_label text) returns bigint language sql as $$ select count(*) from public.order_events where order_id = pg_temp.ord(p_label) $$;

-- ============================================================================ A. catalog
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('create_order_policy_version', 'create_order_from_quote', 'record_order_event') and p.prosecdef
            and p.proconfig = array['search_path=""']), 3::bigint, 'A1 the three order functions are SECURITY DEFINER with an empty search_path');
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('create_order_policy_version', 'create_order_from_quote', 'record_order_event')), 3::bigint,
          'A2 each has exactly one overload');
select ok(not has_function_privilege('anon', 'public.record_order_event(uuid,uuid,text,timestamptz,bigint,uuid,text,text,text,text)', 'execute')
          and has_function_privilege('authenticated', 'public.record_order_event(uuid,uuid,text,timestamptz,bigint,uuid,text,text,text,text)', 'execute'), 'A3 authenticated may execute record_order_event, anon may not');
select ok(not has_function_privilege('anon', 'public.create_order_from_quote(uuid,uuid)', 'execute') and not has_function_privilege('anon', 'public.create_order_policy_version(uuid,uuid,date,jsonb)', 'execute'),
          'A4 anon cannot execute the other two');
select is((select count(*) from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname like 'order\_%' and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))),
          0::bigint, 'A5 no app.order_* helper is callable by a client');
select is((select reloptions::text from pg_class where oid = 'public.order_ledger'::regclass), '{security_invoker=true}', 'A6 order_ledger is a security-invoker view (the caller''s RLS applies)');
select ok(not has_table_privilege('anon', 'public.order_ledger', 'select') and has_table_privilege('authenticated', 'public.order_ledger', 'select'), 'A7 authenticated reads the ledger view, anon does not');
select is((select array_agg(version) from public.order_engine_versions), array['1.0.0'], 'A8 the lifecycle allow-list holds exactly 1.0.0');
select ok(not has_table_privilege('authenticated', 'public.order_engine_versions', 'select'), 'A9 the allow-list is not readable by clients');
select is((select string_agg(t.tgrelid::regclass::text, ',' order by t.tgrelid::regclass::text) from pg_trigger t where t.tgrelid in ('public.orders'::regclass, 'public.order_events'::regclass, 'public.order_policy_versions'::regclass)
            and not t.tgisinternal and tgname like '%no_truncate' and t.tgenabled = 'O'), 'order_events,order_policy_versions,orders', 'A10 every order table has its TRUNCATE guard, and it is enabled');
select is((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = 'public.order_lost_reason'::regtype),
          'price,timing,bought_elsewhere,no_response,requirement_changed,product_unavailable,credit_terms,other', 'A11 the lost reasons are the closed list of the plan (decision 7)');
select is((select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = 'public.order_state'::regtype),
          'quote_approved,quote_sent,accepted,advance_requested,advance_paid,in_preparation,dispatched,delivered,closed_paid,declined,expired,cancelled', 'A12 the order states are the lifecycle''s twelve');
select is((select count(*) from pg_indexes where schemaname = 'public' and indexname in ('order_events_payment_id_key', 'order_events_refund_id_key', 'orders_tenant_id_quote_id_key')), 3::bigint,
          'A13 one order per quote and a payment id and a refund id each unique within their own namespace');

-- ============================================================================ B. order policy versions
create temp table ids as select gen_random_uuid() as p2, gen_random_uuid() as p3;
select is(pg_temp.code('a_owner', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$q$,
          tests.rid('pol1'), tests.tid('a'), pg_temp.today())), 'ok', 'B1 the Owner (aal2) creates a policy version');
select is((select version_no || '/' || advance_required || '/' || dispatch_requires_advance || '/' || cancel_allowed_until_state || '/' || allow_zero_value_orders from public.order_policy_versions where id = tests.rid('pol1')),
          '1/true/true/in_preparation/false', 'B2 it is stored as given');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$q$,
          tests.rid('pol1'), tests.tid('a'), pg_temp.today())), 'replayed'), 'true', 'B3 an exact retry replays');
select is(pg_temp.code('a_owner', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": false, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$q$,
          tests.rid('pol1'), tests.tid('a'), pg_temp.today())), '23505', 'B4 the same id with another policy is the constant conflict');
select is(pg_temp.code('a_owner', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$q$,
          tests.rid('pol1'), tests.tid('b'), pg_temp.today())), '42501', 'B5 the Owner of A cannot create one in tenant B (and a used id reveals nothing: the role is proven first)');
select is(pg_temp.code('a_admin', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$q$,
          (select p2 from ids), tests.tid('a'), pg_temp.today())), '42501', 'B6 an Admin may not');
select is(pg_temp.code('a_sales', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$q$,
          (select p2 from ids), tests.tid('a'), pg_temp.today())), '42501', 'B7 Sales may not');
select is(pg_temp.code('a_viewer', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$q$,
          (select p2 from ids), tests.tid('a'), pg_temp.today())), '42501', 'B8 a Viewer may not');
select is(pg_temp.at('aal1', 'a_owner', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$q$,
          (select p2 from ids), tests.tid('a'), pg_temp.today())), 'SM306', 'B9 the Owner without a second factor is refused with the second-factor code');
select is(pg_temp.at('aal1', 'a_admin', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$q$,
          (select p2 from ids), tests.tid('a'), pg_temp.today())), '42501', 'B10 an Admin without a second factor learns nothing about it: the role is refused first');
select is(pg_temp.code('a_owner', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": "dispatched", "allow_zero_value_orders": false}'::jsonb)$q$,
          (select p2 from ids), tests.tid('a'), pg_temp.today())), '23514', 'B11 a cancel window after dispatch is not allowed');
select is(pg_temp.code('a_owner', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation"}'::jsonb)$q$,
          (select p2 from ids), tests.tid('a'), pg_temp.today())), '22023', 'B12 a missing key is invalid');
select is(pg_temp.code('a_owner', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": "yes", "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$q$,
          (select p2 from ids), tests.tid('a'), pg_temp.today())), '22023', 'B13 a non-boolean flag is invalid');
select is(pg_temp.code('a_owner', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false, "x": 1}'::jsonb)$q$,
          (select p2 from ids), tests.tid('a'), pg_temp.today())), '22023', 'B14 an unknown key is invalid');
select is(pg_temp.code('a_owner', format($q$select public.create_order_policy_version(%L, %L, %L, '[]'::jsonb)$q$, (select p2 from ids), tests.tid('a'), pg_temp.today())), '22023', 'B15 a non-object is invalid');
select is(pg_temp.code('a_owner', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$q$,
          (select p2 from ids), tests.tid('a'), pg_temp.today() - 1)), '23514', 'B16 a policy cannot take effect in the past');
select is(pg_temp.code('a_owner', format($q$select public.create_order_policy_version(%L, %L, null, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$q$,
          (select p2 from ids), tests.tid('a'))), '22023', 'B17 a missing date is invalid');
select is(pg_temp.code('a_owner', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": true, "dispatch_requires_advance": "yes", "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$q$,
          (select p2 from ids), tests.tid('a'), pg_temp.today())), '22023', 'B13b a non-boolean dispatch flag is invalid');
select is(pg_temp.code('a_owner', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": "no"}'::jsonb)$q$,
          (select p2 from ids), tests.tid('a'), pg_temp.today())), '22023', 'B13c a non-boolean zero-value flag is invalid');
select is(pg_temp.code('a_owner', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": 5, "allow_zero_value_orders": false}'::jsonb)$q$,
          (select p2 from ids), tests.tid('a'), pg_temp.today())), '22023', 'B13d a non-string window is invalid');
select is(pg_temp.code('b_owner', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$q$,
          (select p3 from ids), tests.tid('b'), pg_temp.today() - 1)), '23514', 'B16b a tenant''s FIRST policy cannot take effect in the past either');
select is(pg_temp.code('b_owner', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$q$,
          (select p3 from ids), tests.tid('b'), pg_temp.today() + 5)), 'ok', 'B16c a policy may be scheduled for the future');
select is(pg_temp.code('b_owner', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": false, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$q$,
          gen_random_uuid(), tests.tid('b'), pg_temp.today() + 3)), '23514', 'B16d but not before the latest one');
select is(pg_temp.code('b_owner', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$q$,
          tests.rid('pol1'), tests.tid('b'), pg_temp.today())), '23505', 'B16e another tenant''s Owner replaying tenant A''s policy id is the constant conflict (a replay is recognised only inside its own tenant)');
select is(pg_temp.code('a_owner', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": true, "dispatch_requires_advance": true, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$q$,
          tests.rid('pol1'), tests.tid('a'), pg_temp.today() + 1)), '23505', 'B16f the same id and policy with another date is the constant conflict');
select is(app.order_active_policy_version(tests.tid('a'), pg_temp.today()), tests.rid('pol1'), 'B18 the policy is active from its effective date');
select is(app.order_active_policy_version(tests.tid('a'), pg_temp.today() - 1), null, 'B19 and not before it');
select is(app.order_active_policy_version(tests.tid('b'), pg_temp.today()), null, 'B20 tenant B has none yet');
select is(pg_temp.priv('update public.order_policy_versions set advance_required = false'), '42501', 'B21 a policy version is immutable (even for a privileged session)');
select is(pg_temp.priv('delete from public.order_policy_versions'), '42501', 'B22 and never deleted');
select is(tests.rows_as(tests.uid('a_sales'), 'select 1 from public.order_policy_versions'), 1::bigint, 'B23 Sales reads the policy');
select is(tests.rows_as(tests.uid('a_viewer'), 'select 1 from public.order_policy_versions'), 0::bigint, 'B24 a Viewer reads nothing');
select is(tests.rows_as(tests.uid('b_owner'), format('select 1 from public.order_policy_versions where tenant_id = %L', tests.tid('a'))), 0::bigint, 'B25 another tenant''s Owner reads none of tenant A''s policies');

-- ============================================================================ C. create_order_from_quote
select pg_temp.mkq('o1', 100000, 40000);
select pg_temp.mkq('d1', 100000, 40000, null, 'draft');
select pg_temp.mkq('x1', 100000, 40000, null, 'rejected');
select pg_temp.mkq('s1', 100000, 40000, null, 'superseded');
select pg_temp.mkq('ex1', 100000, 40000, pg_temp.today() - 1);
select pg_temp.mkq('z1', 0, 0);
select pg_temp.mkq('na1', 100000, 0);
select pg_temp.mkq('big1', 1000000001, 100);
select pg_temp.mkq('b1', 100000, 40000, null, 'approved', 'b');
select is(pg_temp.code('a_sales', format('select public.create_order_from_quote(%L, %L)', tests.rid('o1_order'), tests.rid('o1_quote'))), '42501', 'C1 Sales may not create an order');
select is(pg_temp.code('a_viewer', format('select public.create_order_from_quote(%L, %L)', tests.rid('o1_order'), tests.rid('o1_quote'))), '42501', 'C2 a Viewer may not');
select is(pg_temp.code('b_owner', format('select public.create_order_from_quote(%L, %L)', tests.rid('o1_order'), tests.rid('o1_quote'))), '42501', 'C3 another tenant''s Owner may not');
select is(pg_temp.err('a_sales', format('select public.create_order_from_quote(%L, %L)', tests.rid('o1_order'), tests.rid('o1_quote'))),
          pg_temp.err('a_sales', format('select public.create_order_from_quote(%L, %L)', tests.rid('o1_order'), gen_random_uuid())), 'C4 a quote that does not exist is the same refusal as one the caller may not use');
select is(pg_temp.at('aal1', 'a_owner', format('select public.create_order_from_quote(%L, %L)', tests.rid('o1_order'), tests.rid('o1_quote'))), 'SM306', 'C5 the Owner needs a second factor (an order is a financial commitment record)');
select is(pg_temp.at('aal1', 'a_admin', format('select public.create_order_from_quote(%L, %L)', tests.rid('o1_order'), tests.rid('o1_quote'))), 'SM306', 'C6 so does an Admin');
select is(pg_temp.at('aal1', 'a_sales', format('select public.create_order_from_quote(%L, %L)', tests.rid('o1_order'), tests.rid('o1_quote'))), '42501', 'C7 Sales at aal1 is refused as a stranger is (the role comes first)');
select is((select count(*) from public.orders where tenant_id = tests.tid('a')), 0::bigint, 'C8 nothing was created by the refusals');
select is(pg_temp.code('a_owner', format('select public.create_order_from_quote(%L, %L)', tests.rid('d1_order'), tests.rid('d1_quote'))), 'SM230', 'C9 a draft quote cannot be ordered (SM230)');
select is(pg_temp.code('a_owner', format('select public.create_order_from_quote(%L, %L)', tests.rid('x1_order'), tests.rid('x1_quote'))), 'SM230', 'C10 a rejected quote cannot (SM230)');
select is(pg_temp.code('a_owner', format('select public.create_order_from_quote(%L, %L)', tests.rid('s1_order'), tests.rid('s1_quote'))), 'SM230', 'C11 a superseded or withdrawn quote cannot (SM230)');
select is(pg_temp.code('a_owner', format('select public.create_order_from_quote(%L, %L)', tests.rid('ex1_order'), tests.rid('ex1_quote'))), 'SM236', 'C12 an expired quote cannot (SM236)');
select is(pg_temp.code('a_owner', format('select public.create_order_from_quote(%L, %L)', tests.rid('z1_order'), tests.rid('z1_quote'))), 'SM233', 'C13 a zero-value order is refused while the policy does not allow it (SM233)');
select is(pg_temp.code('a_owner', format('select public.create_order_from_quote(%L, %L)', tests.rid('na1_order'), tests.rid('na1_quote'))), 'SM233', 'C14 an advance the policy requires but the quote lacks is refused (SM233)');
select is(pg_temp.code('a_owner', format('select public.create_order_from_quote(%L, %L)', tests.rid('big1_order'), tests.rid('big1_quote'))), 'SM233', 'C15 a total above the lifecycle''s cap is refused (SM233)');
select is(pg_temp.code('b_owner', format('select public.create_order_from_quote(%L, %L)', tests.rid('b1_order'), tests.rid('b1_quote'))), 'SM239', 'C16 a tenant with no order policy in force is refused (SM239)');
select is(pg_temp.j(pg_temp.mko('o1'), 'state'), 'quote_approved', 'C17 the Owner creates an order from an approved quote');
select is((select order_total_paise || '/' || advance_paise || '/' || valid_until || '/' || order_no || '/' || state from public.orders where id = pg_temp.ord('o1')),
          '100000/40000/' || (pg_temp.today() + 10) || '/1/quote_approved', 'C18 the figures are the quote''s (copied by the database), order number 1, state quote_approved');
select is((select quote_id || '/' || enquiry_id || '/' || requirement_id || '/' || lead_id || '/' || policy_version_id from public.orders where id = pg_temp.ord('o1')),
          tests.rid('o1_quote') || '/' || tests.rid('o1_enq') || '/' || tests.rid('o1_req') || '/' || tests.rid('a_lead') || '/' || tests.rid('pol1'), 'C19 it carries the quote''s enquiry, requirement and lead and the policy in force');
select is((select count(*) || '/' || min(type::text) || '/' || min(seq) || '/' || min(new_state::text) from public.order_events where order_id = pg_temp.ord('o1')), '1/created/1/quote_approved', 'C20 its ledger starts with one created event');
select is((select created_by from public.orders where id = pg_temp.ord('o1')), tests.uid('a_owner'), 'C21 the creator is the caller (server-owned)');
select is(pg_temp.j(pg_temp.mko('o1'), 'replayed'), 'true', 'C22 an exact retry replays');
select is((select count(*) from public.orders where tenant_id = tests.tid('a')), 1::bigint, 'C23 and creates nothing');
select is(pg_temp.code('a_owner', format('select public.create_order_from_quote(%L, %L)', tests.rid('o1_order'), tests.rid('s1_quote'))), '23505', 'C24 the same order id for another quote is the constant conflict');
select is(pg_temp.code('a_owner', format('select public.create_order_from_quote(%L, %L)', gen_random_uuid(), tests.rid('o1_quote'))), 'SM231', 'C25 a second order for the same quote is refused (SM231)');
select is(pg_temp.code('a_admin', format('select public.create_order_from_quote(%L, %L)', tests.rid('o1_order'), tests.rid('o1_quote'))), 'ok', 'C26 an Admin''s exact retry replays too');
select is(pg_temp.code('a_owner', format('select public.create_order_from_quote(%L, %L)', tests.rid('o1_order'), tests.rid('b1_quote'))), '42501', 'C27 a quote of another tenant is refused as a stranger (role first)');
select is((select count(*) from public.audit_events where entity_type = 'order' and action = 'order.create' and entity_id = pg_temp.ord('o1')), 1::bigint, 'C28 the creation is audited');
select is((select count(*) from public.audit_events where entity_type = 'order_event' and tenant_id = tests.tid('a')), 1::bigint, 'C29 and so is its first event');
select is(pg_temp.j(pg_temp.sc('a_admin', format('select public.create_order_from_quote(%L, %L)', tests.rid('o2_order'), pg_temp.mkq('o2', 100000, 40000))), 'order_no'), '2', 'C30 an Admin creates an order; the number is the tenant''s next');

select pg_temp.mkq('vt', 100000, 40000, pg_temp.today());
select is(pg_temp.j(pg_temp.mko('vt'), 'state'), 'quote_approved', 'C31 a quote is valid through its last day: an order may be created on the valid-until day itself (SM236 only from the next day)');
select pg_temp.mkq('cap', 1000000000, 100);
select is(pg_temp.j(pg_temp.mko('cap'), 'state'), 'quote_approved', 'C32 a total of exactly the lifecycle''s cap is accepted');
select is((select order_total_paise from public.orders where id = pg_temp.ord('cap')), 1000000000::bigint, 'C33 and kept');

-- ============================================================================ D. record_order_event: roles, aal2, argument shapes
select pg_temp.mkq('o3', 100000, 40000);  select pg_temp.mko('o3');
select pg_temp.mkq('o4', 100000, 40000);  select pg_temp.mko('o4');
select pg_temp.mkq('o5', 100000, 40000);  select pg_temp.mko('o5');
select is(pg_temp.rec('a_viewer', 'o1', 'send_quote'), 'ERR:42501', 'D1 a Viewer may not record an event');
select is(pg_temp.rec('b_owner', 'o1', 'send_quote'), 'ERR:42501', 'D2 another tenant''s Owner may not');
select is(pg_temp.err('a_viewer', pg_temp.callsql('a_viewer', pg_temp.ord('o1'), 'send_quote')), pg_temp.err('b_owner', pg_temp.callsql('b_owner', gen_random_uuid(), 'send_quote')),
          'D3 a stranger, a Viewer and an order that does not exist are the same refusal');
select is(pg_temp.rec('a_sales', 'o1', 'cancel'), 'ERR:42501', 'D4 Sales may not cancel');
select is(pg_temp.rec('a_sales', 'o1', 'record_payment', 100, 'pay-d'), 'ERR:42501', 'D5 Sales may not record a payment');
select is(pg_temp.rec('a_sales', 'o1', 'record_refund', 100, 'ref-d'), 'ERR:42501', 'D6 Sales may not record a refund (refused as a stranger is)');
select is(pg_temp.at('aal1', 'a_owner', pg_temp.callsql('a_owner', pg_temp.ord('o1'), 'cancel')), 'SM306', 'D7 a cancellation needs the second factor');
select is(pg_temp.at('aal1', 'a_admin', pg_temp.callsql('a_admin', pg_temp.ord('o1'), 'record_payment', 100, tests.rid('pay-d'))), 'SM306', 'D8 a payment needs the second factor');
select is(pg_temp.at('aal1', 'a_owner', pg_temp.callsql('a_owner', pg_temp.ord('o1'), 'record_refund', 100, tests.rid('ref-d'))), 'SM306', 'D9 a refund needs the second factor');
select is(pg_temp.at('aal1', 'a_sales', pg_temp.callsql('a_sales', pg_temp.ord('o1'), 'cancel')), '42501', 'D10 Sales at aal1 cancelling is refused as a stranger is (the role comes first)');
select is(pg_temp.rec('a_admin', 'o1', 'record_refund', 100, 'ref-d'), 'ERR:SM234', 'D11 an Admin recording a refund is told it needs the Owner (SM234)');
select is(pg_temp.at('aal1', 'a_admin', pg_temp.callsql('a_admin', pg_temp.ord('o1'), 'record_refund', 100, tests.rid('ref-d'))), 'SM306', 'D12 ... after the second factor is proven (an Admin at aal1 is told about the factor first)');
select is(pg_temp.at('aal1', 'a_sales', pg_temp.callsql('a_sales', pg_temp.ord('o1'), 'send_quote')), 'ok', 'D13 a plain event does not need the second factor');
select is(pg_temp.st('o1'), 'quote_sent', 'D14 ... and moved the order');
select is(pg_temp.code('a_sales', pg_temp.callsql('a_sales', pg_temp.ord('o3'), 'teleport')), '22023', 'D15 an unknown event type is invalid');
select is(pg_temp.code('a_sales', pg_temp.callsql('a_sales', pg_temp.ord('o3'), 'created')), '22023', 'D16 `created` is not an event a caller can record');
select is(pg_temp.code('a_admin', pg_temp.callsql('a_admin', pg_temp.ord('o3'), 'record_payment', null, null, null, null, app.order_build(pg_temp.ord('o3'), 'send_quote', null, null, pg_temp.asof(), false))), '22023', 'D17 a payment without an amount and an id is invalid');
select is(pg_temp.code('a_admin', pg_temp.callsql('a_admin', pg_temp.ord('o3'), 'record_payment', 100, null, null, null, app.order_build(pg_temp.ord('o3'), 'send_quote', null, null, pg_temp.asof(), false))), '22023', 'D18 a payment without a ledger id is invalid');
select is(pg_temp.code('a_sales', pg_temp.callsql('a_sales', pg_temp.ord('o3'), 'send_quote', 100, null, null, null, app.order_build(pg_temp.ord('o3'), 'send_quote', null, null, pg_temp.asof(), false))), '22023', 'D19 a plain event with an amount is invalid');
select is(pg_temp.code('a_sales', pg_temp.callsql('a_sales', pg_temp.ord('o3'), 'send_quote', null, tests.rid('x'), null, null, app.order_build(pg_temp.ord('o3'), 'send_quote', null, null, pg_temp.asof(), false))), '22023', 'D20 a plain event with a ledger id is invalid');
select is(pg_temp.rec('a_sales', 'o3', 'send_quote', null, null, 'price'), 'ERR:22023', 'D21 a reason on an event that is not a decline is invalid');
select is(pg_temp.rec('a_sales', 'o3', 'customer_decline'), 'ERR:22023', 'D22 a decline without a reason is invalid');
select is(pg_temp.rec('a_sales', 'o3', 'customer_decline', null, null, 'because'), 'ERR:22023', 'D23 a reason outside the closed list is invalid');
select is(pg_temp.code('a_sales', pg_temp.callsql('a_sales', pg_temp.ord('o3'), 'send_quote', null, null, null, null, null, null, '1.0.0', now() + interval '1 hour')), '23514', 'D24 an event cannot have happened in the future');
select is(pg_temp.code('a_sales', pg_temp.callsql('a_sales', pg_temp.ord('o3'), 'send_quote', null, null, null, null, null, null, '1.0.0', now() - interval '31 days')), '23514', 'D25 nor more than 30 days ago');
select is(pg_temp.code('a_sales', pg_temp.callsql('a_sales', pg_temp.ord('o3'), 'send_quote', null, null, null, null, null, null, '9.9.9')), '23514', 'D26 a lifecycle version nobody reviewed is refused');
select is(pg_temp.code('a_sales', format('select public.record_order_event(%L, %L, %L, now(), null, null, null, %L, %L, %L)', gen_random_uuid(), pg_temp.ord('o3'), 'send_quote', '1.0.0', '[1]', '{}')), '22023', 'D27 a request that is not an object is invalid');
select is(pg_temp.code('a_sales', format('select public.record_order_event(%L, %L, %L, now(), null, null, null, %L, %L, %L)', gen_random_uuid(), pg_temp.ord('o3'), 'send_quote', '1.0.0', 'not json', '{}')), '22023', 'D28 and so is text that is not JSON');
select is(pg_temp.code('a_sales', format('select public.record_order_event(%L, %L, %L, now(), null, null, null, %L, null, %L)', gen_random_uuid(), pg_temp.ord('o3'), 'send_quote', '1.0.0', '{}')), '22023', 'D29 and a missing result');
select is(pg_temp.code('a_sales', format('select public.record_order_event(null, %L, %L, now(), null, null, null, %L, %L, %L)', pg_temp.ord('o3'), 'send_quote', '1.0.0', '{}', '{}')), '42501', 'D30 a missing event id is refused like a stranger');
select is(pg_temp.code('a_sales', format('select public.record_order_event(%L, %L, %L, now(), null, null, null, %L, %L, %L)', gen_random_uuid(), pg_temp.ord('o3'), 'send_quote', '1.0.0', '{"x":"' || chr(8203) || '"}', '{}')), '22023',
          'D30b a request with an invisible character is refused as invalid (text hygiene) before anything is compared');
select is(pg_temp.code('a_sales', format('select public.record_order_event(%L, %L, %L, now(), null, null, null, %L, %L, %L)', gen_random_uuid(), pg_temp.ord('o3'), 'send_quote', '1.0.0', '{}', '{"x":"' || chr(8203) || '"}')), '22023',
          'D30c and so is a result with one');
select is(pg_temp.st('o3'), 'quote_approved', 'D31 none of the refusals moved the order');
select is(pg_temp.nev('o3'), 1::bigint, 'D32 or wrote an event');

-- ============================================================================ E. the happy path to closed_paid; the ledger view; the cache equals the ledger
select is(pg_temp.rec('a_sales', 'o4', 'send_quote'), 'quote_sent', 'E1 send_quote -> quote_sent');
select is(pg_temp.rec('a_sales', 'o4', 'customer_accept'), 'accepted', 'E2 customer_accept -> accepted');
select is(pg_temp.rec('a_sales', 'o4', 'request_advance'), 'advance_requested', 'E3 request_advance -> advance_requested');
select is(pg_temp.rec('a_admin', 'o4', 'record_payment', 10000, 'p4a'), 'advance_requested', 'E4 a partial payment keeps the state (10000 of the 40000 advance)');
select is(pg_temp.rec('a_admin', 'o4', 'start_preparation'), 'ERR:SM232:ADVANCE_NOT_PAID', 'E5 preparation needs the advance (SM232 with the lifecycle''s code)');
select is(pg_temp.rec('a_owner', 'o4', 'start_preparation'), 'ERR:SM232:ADVANCE_NOT_PAID', 'E6 the Owner is no exception for preparation (only dispatch has the override)');
select is(pg_temp.rec('a_admin', 'o4', 'record_payment', 30000, 'p4b'), 'advance_paid', 'E7 the payment that meets the advance moves it to advance_paid');
select is(pg_temp.rec('a_sales', 'o4', 'start_preparation'), 'in_preparation', 'E8 start_preparation -> in_preparation');
select is(pg_temp.rec('a_sales', 'o4', 'dispatch'), 'dispatched', 'E9 dispatch (the advance is paid) -> dispatched');
select is(pg_temp.rec('a_sales', 'o4', 'deliver'), 'delivered', 'E10 deliver with a balance -> delivered');
select is(pg_temp.rec('a_admin', 'o4', 'record_payment', 60000, 'p4c'), 'closed_paid', 'E11 the final payment closes the order');
select is((select closed_at is not null from public.orders where id = pg_temp.ord('o4')), true, 'E12 closed_at is set');
select is((select string_agg(seq || ':' || type::text || ':' || new_state::text, ' ' order by seq) from public.order_events where order_id = pg_temp.ord('o4')),
          '1:created:quote_approved 2:send_quote:quote_sent 3:customer_accept:accepted 4:request_advance:advance_requested 5:record_payment:advance_requested 6:record_payment:advance_paid 7:start_preparation:in_preparation 8:dispatch:dispatched 9:deliver:delivered 10:record_payment:closed_paid',
          'E13 the ledger is the whole story, gapless');
select is((select paid_paise || '/' || refunded_paise || '/' || net_paise || '/' || balance_paise || '/' || event_count from public.order_ledger where order_id = pg_temp.ord('o4')), '100000/0/100000/0/10', 'E14 the ledger view: paid, refunded, net, balance, events');
select is(pg_temp.rec('a_owner', 'o4', 'send_quote'), 'ERR:SM235', 'E15 a closed order takes no event (SM235)');
select is(pg_temp.rec('a_admin', 'o4', 'record_payment', 1, 'p4z'), 'ERR:SM235', 'E16 not even a payment');
select is((select recorded_by from public.order_events where order_id = pg_temp.ord('o4') and seq = 6), tests.uid('a_admin'), 'E17 the recorder is the caller (server-owned)');
select is((select owner_approved_by from public.order_events where order_id = pg_temp.ord('o4') and seq = 6), null, 'E18 an ordinary payment records no owner approval');
select is((select engine_version || '/' || (canonical_hash ~ '^[0-9a-f]{64}$') from public.order_events where order_id = pg_temp.ord('o4') and seq = 6), '1.0.0/true', 'E19 an event records the version and the hash of its run');
select is((select canonical_hash from public.order_events where order_id = pg_temp.ord('o4') and seq = 6), app.order_request_hash('1.0.0', (select request_text from public.order_events where order_id = pg_temp.ord('o4') and seq = 6)),
          'E20 the stored hash is the hash of the stored request text (recomputed)');
select is((select (result_text::jsonb ->> 'new_state') from public.order_events where order_id = pg_temp.ord('o4') and seq = 6), 'advance_paid', 'E21 the stored result is the run''s result');
select is(tests.rows_as(tests.uid('a_sales'), format('select 1 from public.order_events where order_id = %L', pg_temp.ord('o4'))), 10::bigint, 'E22 Sales reads the ledger');
select is(tests.rows_as(tests.uid('a_viewer'), 'select 1 from public.order_events'), 0::bigint, 'E23 a Viewer reads no event');
select is(tests.rows_as(tests.uid('b_owner'), 'select 1 from public.orders'), 0::bigint, 'E24 tenant B sees no order of tenant A');
select is(tests.rows_as(tests.uid('b_owner'), 'select 1 from public.order_ledger'), 0::bigint, 'E25 nor its ledger view');
select is(tests.rows_as(tests.uid('a_viewer'), 'select 1 from public.order_ledger'), 0::bigint, 'E26 and a Viewer reads no ledger view');
select is(tests.rows_as(tests.uid('a_sales'), 'select 1 from public.order_ledger'), (select count(*) from public.orders where tenant_id = tests.tid('a')), 'E27 Sales reads it (decision 4: amounts included)');

select pg_temp.mkq('o9', 100000, 40000);  select pg_temp.mko('o9');
select pg_temp.rec('a_sales', 'o9', 'send_quote');  select pg_temp.rec('a_sales', 'o9', 'customer_accept');
select pg_temp.rec('a_admin', 'o9', 'record_payment', 40000, 'p9a');  select pg_temp.rec('a_sales', 'o9', 'start_preparation');
select is(pg_temp.rec('a_admin', 'o9', 'record_payment', 60000, 'p9b'), 'in_preparation', 'E28 paying in full before delivery does not close the order');
select is(pg_temp.rec('a_sales', 'o9', 'dispatch'), 'dispatched', 'E29 dispatched');
select is(pg_temp.rec('a_sales', 'o9', 'deliver'), 'closed_paid', 'E30 delivering a fully paid order closes it at once (dispatched -> closed_paid)');
select is((select closed_at is not null from public.orders where id = pg_temp.ord('o9')), true, 'E31 and it is closed');

-- ============================================================================ F. SM232 codes, the override, refunds, cancellations, decline
select is(pg_temp.rec('a_sales', 'o5', 'customer_accept'), 'ERR:SM232:ILLEGAL_TRANSITION', 'F1 accepting before sending is illegal (SM232, ILLEGAL_TRANSITION)');
select is(pg_temp.rec('a_sales', 'o5', 'expire'), 'ERR:SM232:QUOTE_NOT_EXPIRED', 'F2 expiring a quote that has not expired is refused (QUOTE_NOT_EXPIRED)');
select is(pg_temp.rec('a_sales', 'o5', 'send_quote'), 'quote_sent', 'F3 send_quote');
select is(pg_temp.rec('a_sales', 'o5', 'customer_decline', null, null, 'price'), 'declined', 'F4 a decline with a reason -> declined (Lost)');
select is((select closed_at is not null from public.orders where id = pg_temp.ord('o5')), true, 'F5 and closed');
select is((select lost_reason from public.order_ledger where order_id = pg_temp.ord('o5')), 'price', 'F6 the ledger view shows the lost reason');
select is((select reason_code::text from public.order_events where order_id = pg_temp.ord('o5') and type = 'customer_decline'), 'price', 'F7 stored on the decline event');
select is(pg_temp.rec('a_owner', 'o5', 'customer_accept'), 'ERR:SM235', 'F8 a lost order takes no event');
select pg_temp.mkq('o10', 100000, 40000);  select pg_temp.mko('o10');
select pg_temp.rec('a_admin', 'o10', 'cancel');
select is(pg_temp.rec('a_sales', 'o10', 'send_quote'), 'ERR:SM235', 'F8b a cancelled order takes no event (SM235)');

-- an order whose quote has expired (a privileged fixture: the function would refuse the creation)
select pg_temp.mkorder_priv('oe', 100000, 40000, pg_temp.today() - 1);
select is(pg_temp.rec('a_sales', 'oe', 'send_quote'), 'ERR:SM232:QUOTE_EXPIRED', 'F9 sending an expired quote is refused (QUOTE_EXPIRED)');
select is(pg_temp.rec('a_sales', 'oe', 'expire'), 'expired', 'F10 expiring it is allowed -> expired');
select is(pg_temp.rec('a_sales', 'oe', 'send_quote'), 'ERR:SM235', 'F10b an expired order takes no event (SM235)');
select is((select closed_at is not null from public.orders where id = pg_temp.ord('oe')), true, 'F11 and closed');
select pg_temp.mkorder_priv('oe2', 100000, 40000, pg_temp.today());
select is(pg_temp.rec('a_sales', 'oe2', 'expire'), 'ERR:SM232:QUOTE_NOT_EXPIRED', 'F12 a quote is valid through the last second of its day in India: not expirable today');
select is(pg_temp.rec('a_sales', 'oe2', 'send_quote'), 'quote_sent', 'F13 and still sendable today');

-- the override and the refund
select pg_temp.mkq('o6', 100000, 40000);  select pg_temp.mko('o6');
select pg_temp.rec('a_sales', 'o6', 'send_quote');  select pg_temp.rec('a_sales', 'o6', 'customer_accept');
select is(pg_temp.rec('a_admin', 'o6', 'record_payment', 40000, 'p6a'), 'advance_paid', 'F14 the advance is paid');
select is(pg_temp.rec('a_sales', 'o6', 'start_preparation'), 'in_preparation', 'F15 in preparation');
select is(pg_temp.rec('a_admin', 'o6', 'record_refund', 30000, 'r6a'), 'ERR:SM234', 'F16 an Admin cannot record the refund (SM234)');
select is(pg_temp.rec('a_sales', 'o6', 'record_refund', 30000, 'r6a'), 'ERR:42501', 'F17 nor Sales');
select is(pg_temp.at('aal1', 'a_owner', pg_temp.callsql('a_owner', pg_temp.ord('o6'), 'record_refund', 30000, tests.rid('r6a'))), 'SM306', 'F18 the Owner needs the second factor for it');
select is(pg_temp.rec('a_owner', 'o6', 'record_refund', 50000, 'r6x'), 'ERR:SM232:REFUND_EXCEEDS_PAID', 'F19 a refund above what was paid is refused (REFUND_EXCEEDS_PAID)');
select is(pg_temp.rec('a_owner', 'o6', 'record_refund', 30000, 'r6a'), 'in_preparation', 'F20 the Owner records the refund; later states never move backwards');
select is((select owner_approved_by from public.order_events where order_id = pg_temp.ord('o6') and type = 'record_refund'), tests.uid('a_owner'), 'F21 the refund records the Owner who approved it');
select is((select (result_text::jsonb -> 'flags' -> 'reasons' -> 0 ->> 'code') from public.order_events where order_id = pg_temp.ord('o6') and type = 'record_refund'), 'REFUND_REQUIRES_OWNER_APPROVAL', 'F22 and the flag the lifecycle raised');
select is((select paid_paise || '/' || refunded_paise || '/' || net_paise || '/' || balance_paise from public.order_ledger where order_id = pg_temp.ord('o6')), '40000/30000/10000/90000', 'F23 the ledger view nets the refund');
select is(pg_temp.rec('a_owner', 'o6', 'record_refund', 30000, 'p6a'), 'ERR:SM232:REFUND_EXCEEDS_PAID', 'F24 (a refund of 30000 more would exceed the 10000 that is left)');
select is(pg_temp.rec('a_owner', 'o6', 'record_refund', 10000, 'p6a'), 'in_preparation', 'F25 a refund id may equal a payment id: the namespaces are separate');
select is(pg_temp.rec('a_owner', 'o6', 'record_payment', 10000, 'p6b'), 'in_preparation', 'F26 pay again (the net is 0 after the refunds, so 10000 is room)');
select is(pg_temp.rec('a_admin', 'o6', 'dispatch'), 'ERR:SM232:ADVANCE_NOT_PAID', 'F27 an Admin cannot dispatch with the advance unpaid (net 10000 of 40000)');
select is(pg_temp.rec('a_sales', 'o6', 'dispatch'), 'ERR:SM232:ADVANCE_NOT_PAID', 'F28 nor Sales');
select is(pg_temp.at('aal1', 'a_owner', pg_temp.callsql('a_owner', pg_temp.ord('o6'), 'dispatch')), 'SM306', 'F29 the Owner''s override needs the second factor (it is actually used here)');
select is((select count(*) from public.order_events where order_id = pg_temp.ord('o6') and type = 'dispatch'), 0::bigint, 'F30 and wrote nothing');
select is(pg_temp.rec('a_owner', 'o6', 'dispatch'), 'dispatched', 'F31 the Owner (aal2) dispatches with an unpaid advance: the override');
select is((select owner_approved_by from public.order_events where order_id = pg_temp.ord('o6') and type = 'dispatch'), tests.uid('a_owner'), 'F32 the override records the Owner');
select is((select (result_text::jsonb -> 'flags' -> 'reasons' -> 0 ->> 'code') from public.order_events where order_id = pg_temp.ord('o6') and type = 'dispatch'), 'ADVANCE_OVERRIDE', 'F33 and its flag');
select is(pg_temp.rec('a_admin', 'o6', 'cancel'), 'ERR:SM232:ILLEGAL_TRANSITION', 'F34 after dispatch a cancellation is illegal');
select is(pg_temp.rec('a_owner', 'o6', 'cancel'), 'ERR:SM232:ILLEGAL_TRANSITION', 'F35 even for the Owner (the override covers dispatch only)');

-- the advance stepping back is a strict rule: a refund that leaves exactly the advance does not step back
select pg_temp.mkq('o11', 100000, 40000);  select pg_temp.mko('o11');
select pg_temp.rec('a_sales', 'o11', 'send_quote');  select pg_temp.rec('a_sales', 'o11', 'customer_accept');
select is(pg_temp.rec('a_admin', 'o11', 'record_payment', 45000, 'p11a'), 'advance_paid', 'F36a 45000 paid: advance_paid');
select is(pg_temp.rec('a_owner', 'o11', 'record_refund', 5000, 'r11a'), 'advance_paid', 'F36b a refund that leaves exactly the advance (40000) keeps advance_paid');
select is(pg_temp.rec('a_owner', 'o11', 'record_refund', 1, 'r11b'), 'advance_requested', 'F36c one paisa less steps back to advance_requested');

-- overpayment, duplicate ids, the advance stepping back, a cancellation with funds
select pg_temp.mkq('o7', 50000, 20000);  select pg_temp.mko('o7');
select pg_temp.rec('a_sales', 'o7', 'send_quote');  select pg_temp.rec('a_sales', 'o7', 'customer_accept');
select is(pg_temp.rec('a_admin', 'o7', 'record_payment', 50001, 'p7x'), 'ERR:SM232:OVERPAYMENT', 'F36 a payment above the total is refused (OVERPAYMENT)');
select is(pg_temp.rec('a_admin', 'o7', 'record_payment', 20000, 'p7a'), 'advance_paid', 'F37 the advance is paid');
select is(pg_temp.rec('a_admin', 'o7', 'record_payment', 10000, 'p7a'), 'ERR:SM232:DUPLICATE_PAYMENT_ID', 'F38 a payment id is used once (DUPLICATE_PAYMENT_ID)');
select is(pg_temp.rec('a_admin', 'o7', 'record_payment', 30001, 'p7b'), 'ERR:SM232:OVERPAYMENT', 'F39 the total includes what is paid already');
select is(pg_temp.rec('a_owner', 'o7', 'record_refund', 5000, 'r7a'), 'advance_requested', 'F40 a refund below the advance steps back to advance_requested');
select is(pg_temp.rec('a_owner', 'o7', 'record_refund', 5000, 'r7a'), 'ERR:SM232:DUPLICATE_REFUND_ID', 'F41 a refund id is used once (DUPLICATE_REFUND_ID)');
select is(pg_temp.rec('a_admin', 'o7', 'cancel'), 'ERR:SM234', 'F42 an Admin cannot cancel an order with money in it (SM234: review fix 2)');
select is(pg_temp.rec('a_sales', 'o7', 'cancel'), 'ERR:42501', 'F42b and Sales cannot cancel at all');
select is(pg_temp.at('aal1', 'a_admin', pg_temp.callsql('a_admin', pg_temp.ord('o7'), 'cancel')), 'SM306', 'F42c an Admin without the second factor is told about the factor first');
select is(pg_temp.at('aal1', 'a_owner', pg_temp.callsql('a_owner', pg_temp.ord('o7'), 'cancel')), 'SM306', 'F42d the Owner needs the second factor to cancel');
select is((select state::text from public.orders where id = pg_temp.ord('o7')), 'advance_requested', 'F42e none of the refusals moved the order');
select is(pg_temp.rec('a_owner', 'o7', 'cancel'), 'cancelled', 'F42f the Owner (aal2) cancels it');
select is((select (result_text::jsonb -> 'flags' -> 'reasons' -> 0 ->> 'code') from public.order_events where order_id = pg_temp.ord('o7') and type = 'cancel'), 'CANCELLATION_WITH_FUNDS', 'F43 flagged CANCELLATION_WITH_FUNDS');
select is((select owner_approved_by from public.order_events where order_id = pg_temp.ord('o7') and type = 'cancel'), tests.uid('a_owner'), 'F44 a cancellation with funds records the Owner who did it');
select is((select owner_approved_by from public.order_events where order_id = pg_temp.ord('o10') and type = 'cancel'), null, 'F44b a cancellation with NO money records no owner (an Admin may do it)');
select is((select closed_at is not null from public.orders where id = pg_temp.ord('o7')), true, 'F45 cancelled is closed');

-- ============================================================================ G. forged requests and results (SM238), replay and conflict
select pg_temp.mkq('o8', 100000, 40000);  select pg_temp.mko('o8');
select pg_temp.rec('a_sales', 'o8', 'send_quote');  select pg_temp.rec('a_sales', 'o8', 'customer_accept');
select pg_temp.rec('a_admin', 'o8', 'record_payment', 10000, 'p8a');
create function pg_temp.forged(p_user text, p_type text, p_amount bigint, p_ledger uuid, p_patch jsonb default '{}') returns text language plpgsql as $$
declare r jsonb := app.order_build(pg_temp.ord('o8'), p_type, p_amount, p_ledger, pg_temp.asof(), p_user = 'a_owner') || p_patch;
begin
  return pg_temp.code(p_user, pg_temp.callsql(p_user, pg_temp.ord('o8'), p_type, p_amount, p_ledger, null, null, r));
end $$;
select is(pg_temp.forged('a_admin', 'record_payment', 5000, tests.rid('p8b')), 'ok', 'G0 (the control) an honest payment is accepted');
select is(pg_temp.forged('a_admin', 'record_payment', 1000, tests.rid('p8c'), jsonb_build_object('order_total', 1)), 'SM238', 'G1 a forged total is refused (SM238)');
select is(pg_temp.forged('a_admin', 'record_payment', 1000, tests.rid('p8c'), jsonb_build_object('current_state', 'in_preparation')), 'SM238', 'G2 a forged state is refused');
select is(pg_temp.forged('a_admin', 'record_payment', 1000, tests.rid('p8c'), jsonb_build_object('payments', '[]'::jsonb)), 'SM238', 'G3 a forged (shorter) ledger is refused');
select is(pg_temp.forged('a_admin', 'record_payment', 1000, tests.rid('p8c'), jsonb_build_object('refunds', jsonb_build_array(jsonb_build_object('refund_id', tests.rid('rx')::text, 'amount', 5)))), 'SM238', 'G4 a forged refund in the ledger is refused');
select is(pg_temp.forged('a_admin', 'record_payment', 1000, tests.rid('p8c'), jsonb_build_object('policy', jsonb_build_object('advance_required', false, 'advance_amount', 40000, 'dispatch_requires_advance', true, 'cancel_allowed_until_state', 'in_preparation'))), 'SM238', 'G5 a forged policy is refused');
select is(pg_temp.forged('a_admin', 'record_payment', 1000, tests.rid('p8c'), jsonb_build_object('valid_until', '2099-01-01T00:00:00Z')), 'SM238', 'G6 a forged valid_until is refused');
select is(pg_temp.forged('a_admin', 'record_payment', 1000, tests.rid('p8c'), jsonb_build_object('flags', jsonb_build_object('owner_override', true))), 'SM238', 'G7 a forged owner_override is refused (it is derived from the role)');
select is(pg_temp.forged('a_admin', 'record_payment', 1000, tests.rid('p8c'), jsonb_build_object('extra', 1)), 'SM238', 'G8 an extra key is refused');
select is(pg_temp.forged('a_admin', 'record_payment', 1000, tests.rid('p8c'), jsonb_build_object('as_of', pg_temp.asof('-11 minutes'))), 'SM238', 'G9 an as_of more than ten minutes old is refused (a backdated request cannot dodge an expiry)');
select is(pg_temp.forged('a_admin', 'record_payment', 1000, tests.rid('p8c'), jsonb_build_object('as_of', pg_temp.asof('3 minutes'))), 'SM238', 'G10 an as_of in the future is refused');
select is(pg_temp.forged('a_admin', 'record_payment', 1000, tests.rid('p8c'), jsonb_build_object('as_of', '2026-10-06 06:00:00')), 'SM238', 'G11 a timestamp that is not the canonical text is refused');
select is(pg_temp.forged('a_admin', 'record_payment', 1000, tests.rid('p8c'), jsonb_build_object('as_of', pg_temp.asof('-9 minutes'))), 'ok', 'G12 an as_of within the window is accepted (nine minutes old)');
select is(pg_temp.forged('a_admin', 'record_payment', 1000, tests.rid('p8i'), jsonb_build_object('as_of', pg_temp.asof('90 seconds'))), 'ok', 'G12b and one a minute and a half ahead (clock slack of two minutes)');
select is(pg_temp.forged('a_admin', 'record_payment', 1000, tests.rid('p8j'), jsonb_build_object('as_of', to_char(now() at time zone 'UTC', 'YYYY-MM-DD HH24:MI:SS'))), 'SM238', 'G11b a timestamp inside the window but not in the canonical form (a space for the T, no Z) is refused');
select is(pg_temp.forged('a_admin', 'record_payment', 1000, tests.rid('p8j'), jsonb_build_object('as_of', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS".123Z"'))), 'SM238', 'G11c and so is one with fractional seconds');
select is(pg_temp.code('a_admin', pg_temp.callsql('a_admin', pg_temp.ord('o8'), 'record_payment', 1000, tests.rid('p8d'), null, null, app.order_build(pg_temp.ord('o8'), 'record_payment', 2000, tests.rid('p8d'), pg_temp.asof(), false))), 'SM238',
          'G13 the request''s amount must be the argument''s amount');
select is(pg_temp.code('a_admin', pg_temp.callsql('a_admin', pg_temp.ord('o8'), 'record_payment', 1000, tests.rid('p8d'), null, null, app.order_build(pg_temp.ord('o8'), 'record_payment', 1000, tests.rid('p8e'), pg_temp.asof(), false))), 'SM238',
          'G14 and the request''s ledger id the argument''s');
select is(pg_temp.code('a_admin', pg_temp.callsql('a_admin', pg_temp.ord('o8'), 'record_payment', 1000, tests.rid('p8d'), null, null, app.order_build(pg_temp.ord('o8'), 'send_quote', null, null, pg_temp.asof(), false))), 'SM238',
          'G15 and its event type the argument''s');
-- the result
create function pg_temp.forged_res(p_patch jsonb) returns text language plpgsql as $$
declare r jsonb := app.order_build(pg_temp.ord('o8'), 'record_payment', 1000, tests.rid('p8f'), pg_temp.asof(), false);
begin
  return pg_temp.code('a_admin', pg_temp.callsql('a_admin', pg_temp.ord('o8'), 'record_payment', 1000, tests.rid('p8f'), null, null, r, pg_temp.honest(r) || p_patch));
end $$;
select is(pg_temp.forged_res(jsonb_build_object('new_state', 'closed_paid')), 'SM238', 'G16 a forged new_state in the result is refused');
select is(pg_temp.forged_res(jsonb_build_object('paid_total', 99999)), 'SM238', 'G17 a forged paid_total is refused');
select is(pg_temp.forged_res(jsonb_build_object('balance_due', 0)), 'SM238', 'G18 a forged balance is refused');
select is(pg_temp.forged_res(jsonb_build_object('flags', jsonb_build_object('needs_owner_approval', true, 'reasons', jsonb_build_array(jsonb_build_object('code', 'ADVANCE_OVERRIDE'))))), 'SM238', 'G19 a flag the decision did not raise is refused');
select is(pg_temp.forged_res(jsonb_build_object('flags', jsonb_build_object('needs_owner_approval', true, 'reasons', '[]'::jsonb))), 'SM238', 'G20 needs_owner_approval must match the flags');
select is(pg_temp.forged_res(jsonb_build_object('canonical_hash', repeat('a', 64))), 'SM238', 'G21 a hash that is not the request''s is refused');
select is(pg_temp.forged_res(jsonb_build_object('engine_version', '0.9.0')), 'SM238', 'G22 a result of another version is refused');
select is(pg_temp.forged_res(jsonb_build_object('status', 'rejected')), 'SM238', 'G23 a result that says rejected for an event the database accepts is refused');
select is(pg_temp.forged_res('{}'), 'ok', 'G24 (the control) the honest result is accepted');
-- the flags must be the decision's flags, not merely consistent with needs_owner_approval: a refund (REFUND_REQUIRES_OWNER_APPROVAL) whose result names another code
create function pg_temp.forged_flag_code() returns text language plpgsql as $$
declare r jsonb := app.order_build(pg_temp.ord('o8'), 'record_refund', 100, tests.rid('r8z'), pg_temp.asof(), true);
begin
  return pg_temp.code('a_owner', pg_temp.callsql('a_owner', pg_temp.ord('o8'), 'record_refund', 100, tests.rid('r8z'), null, null, r,
    pg_temp.honest(r) || jsonb_build_object('flags', jsonb_build_object('needs_owner_approval', true, 'reasons', jsonb_build_array(jsonb_build_object('code', 'CANCELLATION_WITH_FUNDS'))))));
end $$;
select is(pg_temp.forged_flag_code(), 'SM238', 'G24b a result that names another flag code (with needs_owner_approval consistent) is refused');
-- an honest-looking OK result for an event the database refuses: the database'' own refusal wins
create function pg_temp.lie(p_type text, p_user text default 'a_admin') returns text language plpgsql as $$
declare r jsonb := app.order_build(pg_temp.ord('o8'), p_type, null, null, pg_temp.asof(), p_user = 'a_owner');
begin
  return pg_temp.err(p_user, pg_temp.callsql(p_user, pg_temp.ord('o8'), p_type, null, null, null, null, r,
    jsonb_build_object('status', 'ok', 'new_state', 'dispatched', 'paid_total', 16000, 'balance_due', 84000, 'allowed_next_events', '[]'::jsonb, 'flags', jsonb_build_object('needs_owner_approval', false, 'reasons', '[]'::jsonb),
                       'trace', '[]'::jsonb, 'engine_version', '1.0.0', 'canonical_hash', app.order_request_hash('1.0.0', r::text))));
end $$;
select is(split_part(pg_temp.lie('start_preparation'), '|', 1) || ':' || split_part(pg_temp.lie('start_preparation'), '|', 3), 'SM232:ADVANCE_NOT_PAID', 'G25 a forged OK result for a preparation the database refuses is refused with the database''s own code');
select is(split_part(pg_temp.lie('deliver'), '|', 1) || ':' || split_part(pg_temp.lie('deliver'), '|', 3), 'SM232:ILLEGAL_TRANSITION', 'G26 ... and for an illegal event');
-- replay and conflict
create temp table rp as select gen_random_uuid() as ev;
select is(pg_temp.j(pg_temp.sc('a_admin', pg_temp.callsql('a_admin', pg_temp.ord('o8'), 'record_payment', 2500, tests.rid('p8g'), null, (select ev from rp))), 'replayed'), 'false', 'G27 a payment is recorded');
select is(pg_temp.j(pg_temp.sc('a_admin', pg_temp.callsql('a_admin', pg_temp.ord('o8'), 'record_payment', 2500, tests.rid('p8g'), null, (select ev from rp))), 'replayed'), 'true', 'G28 the exact retry replays (the request is not even re-checked: the ledger has moved on)');
select is(pg_temp.j(pg_temp.sc('a_admin', pg_temp.callsql('a_admin', pg_temp.ord('o8'), 'record_payment', 2500, tests.rid('p8g'), null, (select ev from rp))), 'seq'), (select seq::text from public.order_events where id = (select ev from rp)), 'G29 and returns the same sequence number');
select is((select count(*) from public.order_events where id = (select ev from rp)), 1::bigint, 'G30 one row');
select is(pg_temp.code('a_admin', pg_temp.callsql('a_admin', pg_temp.ord('o8'), 'record_payment', 2501, tests.rid('p8g'), null, (select ev from rp))), '23505', 'G31 the same event id with another amount is the constant conflict');
select is(pg_temp.code('a_admin', pg_temp.callsql('a_admin', pg_temp.ord('o8'), 'record_payment', 2500, tests.rid('p8h'), null, (select ev from rp))), '23505', 'G32 ... or another ledger id');
select is(pg_temp.code('a_admin', pg_temp.callsql('a_admin', pg_temp.ord('o8'), 'send_quote', null, null, null, (select ev from rp))), '23505', 'G33 ... or another type');
select is(pg_temp.code('a_admin', pg_temp.callsql('a_admin', pg_temp.ord('o6'), 'record_payment', 2500, tests.rid('p8g'), null, (select ev from rp))), '23505', 'G34 ... or another order');
-- events that differ ONLY in their type or ONLY in their reason (same id, same time of occurrence, no amount, no ledger id)
create temp table rp2 as select gen_random_uuid() as ev, now() - interval '1 minute' as t;
select pg_temp.mkq('o12', 100000, 40000);  select pg_temp.mko('o12');
select is(pg_temp.j(pg_temp.sc('a_sales', pg_temp.callsql('a_sales', pg_temp.ord('o12'), 'send_quote', null, null, null, (select ev from rp2), null, null, '1.0.0', (select t from rp2))), 'replayed'), 'false', 'G34b an event recorded at a given time');
select is(pg_temp.code('a_sales', pg_temp.callsql('a_sales', pg_temp.ord('o12'), 'customer_accept', null, null, null, (select ev from rp2), app.order_build(pg_temp.ord('o12'), 'customer_accept', null, null, pg_temp.asof(), false), null, '1.0.0', (select t from rp2))), '23505',
          'G34c the same id and time with only another TYPE is the constant conflict');
select is(pg_temp.j(pg_temp.sc('a_sales', pg_temp.callsql('a_sales', pg_temp.ord('o12'), 'send_quote', null, null, null, (select ev from rp2), null, null, '1.0.0', (select t from rp2))), 'replayed'), 'true', 'G34d (control) the same call again replays');
create temp table rp3 as select gen_random_uuid() as ev, now() - interval '2 minutes' as t;
select pg_temp.mkq('o13', 100000, 40000);  select pg_temp.mko('o13');  select pg_temp.rec('a_sales', 'o13', 'send_quote');
select is(pg_temp.j(pg_temp.sc('a_sales', pg_temp.callsql('a_sales', pg_temp.ord('o13'), 'customer_decline', null, null, 'price', (select ev from rp3), null, null, '1.0.0', (select t from rp3))), 'state'), 'declined', 'G34e a decline with a reason');
select is(pg_temp.code('a_sales', pg_temp.callsql('a_sales', pg_temp.ord('o13'), 'customer_decline', null, null, 'timing', (select ev from rp3), null, null, '1.0.0', (select t from rp3))), '23505', 'G34f the same id and time with only another REASON is the constant conflict');
select is(pg_temp.j(pg_temp.sc('a_sales', pg_temp.callsql('a_sales', pg_temp.ord('o13'), 'customer_decline', null, null, 'price', (select ev from rp3), null, null, '1.0.0', (select t from rp3))), 'replayed'), 'true', 'G34g (control) the exact retry replays');
select is(pg_temp.code('a_admin', pg_temp.callsql('a_admin', pg_temp.ord('o8'), 'record_payment', 2500, tests.rid('p8g'), null, (select ev from rp), null, null, '1.0.0', now() - interval '1 day')), '23505', 'G35 ... or another time of occurrence');
select is(pg_temp.code('a_sales', pg_temp.callsql('a_sales', pg_temp.ord('o8'), 'record_payment', 2500, tests.rid('p8g'), null, (select ev from rp))), '42501', 'G36 a Sales user cannot probe the event (the role is refused first)');
select is(pg_temp.code('b_owner', pg_temp.callsql('b_owner', pg_temp.ord('o8'), 'record_payment', 2500, tests.rid('p8g'), null, (select ev from rp))), '42501', 'G37 nor another tenant');
select is(pg_temp.j(pg_temp.sc('a_admin', pg_temp.callsql('a_admin', pg_temp.ord('o7'), 'cancel', null, null, null, (select id from public.order_events where order_id = pg_temp.ord('o7') and type = 'cancel'))), 'replayed'), 'true', 'G38 a retry of the event that closed an order replays (before the closed-order refusal)');

-- ============================================================================ H. direct writes and the guard triggers
select is(tests.outcome_as(tests.uid('a_owner'), format('update public.orders set state = %L where id = %L', 'closed_paid', pg_temp.ord('o8'))), '42501', 'H1 a client cannot update an order');
select is(tests.outcome_as(tests.uid('a_owner'), format('insert into public.order_events (id, tenant_id, order_id, seq, type, new_state, occurred_at) values (%L, %L, %L, 99, %L, %L, now())', gen_random_uuid(), tests.tid('a'), pg_temp.ord('o8'), 'send_quote', 'quote_sent')), '42501', 'H2 a client cannot insert an event');
select is(tests.outcome_as(tests.uid('a_owner'), format('delete from public.orders where id = %L', pg_temp.ord('o8'))), '42501', 'H3 a client cannot delete an order');
select is(tests.outcome_as(tests.uid('a_owner'), format('insert into public.orders (id, tenant_id, order_no, quote_id, enquiry_id, requirement_id, lead_id, order_total_paise, advance_paise, valid_until, policy_version_id) values (%L, %L, 99, %L, %L, %L, %L, 1, 0, now(), %L)', gen_random_uuid(), tests.tid('a'), tests.rid('d1_quote'), tests.rid('d1_enq'), tests.rid('d1_req'), tests.rid('a_lead'), tests.rid('pol1'))), '42501', 'H4 a client cannot insert an order');
select is(tests.outcome_as(tests.uid('a_owner'), format('insert into public.order_policy_versions (tenant_id, version_no, effective_from, advance_required, dispatch_requires_advance, cancel_allowed_until_state, allow_zero_value_orders, content_sha256) values (%L, 9, now(), true, true, %L, false, repeat(%L, 64))', tests.tid('a'), 'in_preparation', 'a')), '42501', 'H5 a client cannot insert a policy version');
select is(pg_temp.priv(format('update public.orders set order_total_paise = 1 where id = %L', pg_temp.ord('o8'))), '42501', 'H6 an order''s content is immutable even for a privileged session');
select is(pg_temp.priv(format('update public.orders set quote_id = %L where id = %L', tests.rid('d1_quote'), pg_temp.ord('o8'))), '42501', 'H7 so is its quote');
select is(pg_temp.priv(format('update public.orders set state = %L where id = %L', 'closed_paid', pg_temp.ord('o8'))), '42501', 'H8 a state cannot move without an event that says so (an illegal move)');
select is(pg_temp.priv(format('update public.orders set state = %L where id = %L', 'in_preparation', pg_temp.ord('o8'))), '42501', 'H9 ... nor a legal move with no event behind it');
select is(pg_temp.priv(format('update public.orders set closed_at = now() where id = %L', pg_temp.ord('o8'))), '23514', 'H10 an open order cannot be marked closed (the state must be terminal)');
select is(pg_temp.priv(format('update public.orders set closed_at = null where id = %L', pg_temp.ord('o7'))), '42501', 'H11 nor a closed one reopened (closed_at moves once)');
select is(pg_temp.priv(format('update public.orders set closed_at = now() + interval %L where id = %L', '1 day', pg_temp.ord('o7'))), '42501', 'H12 closed_at moves once');
select is(pg_temp.priv(format('update public.orders set state = %L where id = %L', 'accepted', pg_temp.ord('o7'))), '42501', 'H13 a closed order cannot move');
select is(pg_temp.priv(format('delete from public.orders where id = %L', pg_temp.ord('o8'))), '42501', 'H14 an order is never deleted');
select is(pg_temp.priv('truncate public.orders, public.order_events'), '42501', 'H15 or truncated');
select is(pg_temp.priv(format('update public.order_events set amount_paise = 1 where order_id = %L', pg_temp.ord('o8'))), '42501', 'H16 an event is never updated');
select is(pg_temp.priv(format('delete from public.order_events where order_id = %L', pg_temp.ord('o8'))), '42501', 'H17 never deleted');
select is(pg_temp.priv('truncate public.order_events'), '42501', 'H18 never truncated');
select is(pg_temp.priv('truncate public.order_policy_versions, public.orders, public.order_events'), '42501', 'H19 a policy version is never truncated');
create function pg_temp.ins_ev(p_label text, p_seq int, p_type text, p_prior text, p_new text, p_amount bigint default null, p_ledger uuid default null, p_reason text default null) returns text language plpgsql as $$
begin
  insert into public.order_events (id, tenant_id, order_id, seq, type, prior_state, new_state, amount_paise, ledger_id, occurred_at, reason_code, engine_version, request_text, result_text, canonical_hash)
  values (gen_random_uuid(), tests.tid('a'), pg_temp.ord(p_label), p_seq, p_type::public.order_event_type, p_prior::public.order_state, p_new::public.order_state, p_amount, p_ledger, now(), p_reason::public.order_lost_reason,
          case when p_type = 'created' then null else '1.0.0' end, case when p_type = 'created' then null else '{}' end, case when p_type = 'created' then null else '{}' end, case when p_type = 'created' then null else repeat('a', 64) end);
  return 'ok';
exception when others then return sqlstate;
end $$;
select is(pg_temp.ins_ev('o8', (select max(seq) + 2 from public.order_events where order_id = pg_temp.ord('o8')), 'record_payment', 'accepted', 'accepted', 100, tests.rid('pgap')), '42501', 'H20 the ledger is gapless: a gap is refused (a LEGAL event, so the gap is what refuses it)');
select is(pg_temp.ins_ev('o8', (select max(seq) from public.order_events where order_id = pg_temp.ord('o8')), 'record_payment', 'accepted', 'accepted', 100, tests.rid('prep')), '42501', 'H21 ... and so is a repeated sequence number');
select is(pg_temp.ins_ev('o8', (select max(seq) + 1 from public.order_events where order_id = pg_temp.ord('o8')), 'record_payment', 'accepted', 'accepted', 100, tests.rid('pnext')), 'ok', 'H21b (control) the next sequence number with a legal event is accepted');
select is(pg_temp.ins_ev('o8', (select max(seq) + 1 from public.order_events where order_id = pg_temp.ord('o8')), 'send_quote', 'quote_sent', 'accepted'), '42501', 'H22 an event follows the state the ledger ended in (a wrong prior state is refused)');
select is(pg_temp.ins_ev('o8', (select max(seq) + 1 from public.order_events where order_id = pg_temp.ord('o8')), 'deliver', 'accepted', 'closed_paid'), '42501', 'H23 an event cannot make an illegal move');
select is(pg_temp.ins_ev('o8', (select max(seq) + 1 from public.order_events where order_id = pg_temp.ord('o8')), 'created', null, 'quote_approved'), '42501', 'H24 `created` is only ever the first event (the ledger guard refuses a second one: it does not follow the state the ledger ended in)');
select is(pg_temp.ins_ev('o8', (select max(seq) + 1 from public.order_events where order_id = pg_temp.ord('o8')), 'record_payment', 'accepted', 'accepted', 100, tests.rid('p8a')), '23505', 'H25 a payment id is unique per order (the unique index backs the lifecycle''s rule)');
select is(pg_temp.ins_ev('o8', (select max(seq) + 1 from public.order_events where order_id = pg_temp.ord('o8')), 'record_payment', 'accepted', 'accepted', 0, tests.rid('p8z')), '23514', 'H26 an amount is positive');
select is(pg_temp.ins_ev('o8', (select max(seq) + 1 from public.order_events where order_id = pg_temp.ord('o8')), 'record_payment', 'accepted', 'accepted', 1000000001, tests.rid('p8z')), '23514', 'H27 and within the lifecycle''s cap');
select is(pg_temp.ins_ev('o8', (select max(seq) + 1 from public.order_events where order_id = pg_temp.ord('o8')), 'record_payment', 'accepted', 'accepted', 100, null), '23514', 'H28 a payment carries its ledger id');
select is(pg_temp.ins_ev('oe2', 3, 'customer_accept', 'quote_sent', 'accepted', 100), '23514', 'H29 an event that is not money carries no amount (a legal move, so the table check is what refuses it)');
select is(pg_temp.ins_ev('oe2', 3, 'customer_decline', 'quote_sent', 'declined'), '23514', 'H30 a decline carries its reason (a table check)');
select is(pg_temp.ins_ev('oe2', 3, 'cancel', 'quote_sent', 'cancelled', null, null, 'price'), '23514', 'H31 and only a decline carries one');
select is(pg_temp.priv(format('insert into public.orders (id, tenant_id, order_no, quote_id, enquiry_id, requirement_id, lead_id, state, order_total_paise, advance_paise, valid_until, policy_version_id) values (%L, %L, 77, %L, %L, %L, %L, %L, 1, 0, now(), %L)',
          gen_random_uuid(), tests.tid('a'), tests.rid('d1_quote'), tests.rid('d1_enq'), tests.rid('d1_req'), tests.rid('a_lead'), 'accepted', tests.rid('pol1'))), '42501', 'H32 an order is born as quote_approved');
-- an order with no events at all (a privileged fixture) lets the table checks and the first-event rules be reached on their own
select pg_temp.mkq('bare', 100000, 40000);
insert into public.orders (id, tenant_id, order_no, quote_id, enquiry_id, requirement_id, lead_id, order_total_paise, advance_paise, valid_until, policy_version_id)
values (tests.rid('bare_order'), tests.tid('a'), (select max(order_no) + 1 from public.orders where tenant_id = tests.tid('a')), tests.rid('bare_quote'), tests.rid('bare_enq'), tests.rid('bare_req'), tests.rid('a_lead'), 100000, 40000, pg_temp.today() + 5, tests.rid('pol1'));
select is(pg_temp.ins_ev('bare', 1, 'created', null, 'accepted'), '42501', 'H35a `created` must leave the order in quote_approved');
select is(pg_temp.ins_ev('bare', 1, 'send_quote', 'quote_approved', 'quote_sent'), '23514', 'H35b the FIRST event must be `created` (a table check: type created iff sequence 1; this row has a prior state, so no other check refuses it)');
select is(pg_temp.ins_ev('bare', 1, 'created', 'quote_approved', 'quote_approved'), '23514', 'H35c `created` has no prior state (a table check)');
select is(pg_temp.priv(format('insert into public.order_events (id, tenant_id, order_id, seq, type, new_state, occurred_at, engine_version) values (%L, %L, %L, 1, %L, %L, now(), %L)', gen_random_uuid(), tests.tid('a'), pg_temp.ord('bare'), 'created', 'quote_approved', '1.0.0')),
          '23514', 'H35d `created` carries no lifecycle run (a table check)');
select is(pg_temp.priv(format('insert into public.order_events (id, tenant_id, order_id, seq, type, new_state, occurred_at, owner_approved_by) values (%L, %L, %L, 1, %L, %L, now(), %L)', gen_random_uuid(), tests.tid('a'), pg_temp.ord('bare'), 'created', 'quote_approved', tests.uid('a_owner'))),
          '23514', 'H35e an owner approval belongs only to a refund or a dispatch (a table check)');
select is(pg_temp.priv(format('insert into public.orders (id, tenant_id, order_no, quote_id, enquiry_id, requirement_id, lead_id, order_total_paise, advance_paise, valid_until, policy_version_id) values (%L, %L, 76, %L, %L, %L, %L, 1000000001, 0, now(), %L)',
          gen_random_uuid(), tests.tid('a'), tests.rid('d1_quote'), tests.rid('d1_enq'), tests.rid('d1_req'), tests.rid('a_lead'), tests.rid('pol1'))), '23514', 'H35h an order total above the lifecycle''s cap is refused by the table');
select is(pg_temp.priv(format('insert into public.orders (id, tenant_id, order_no, quote_id, enquiry_id, requirement_id, lead_id, order_total_paise, advance_paise, valid_until, policy_version_id, closed_at) values (%L, %L, 75, %L, %L, %L, %L, 1, 0, now(), %L, now())',
          gen_random_uuid(), tests.tid('a'), tests.rid('d1_quote'), tests.rid('d1_enq'), tests.rid('d1_req'), tests.rid('a_lead'), tests.rid('pol1'))), '42501', 'H35i an order is born OPEN: the insert guard refuses a closed one before the table check');
select is(pg_temp.priv(format('insert into public.orders (id, tenant_id, order_no, quote_id, enquiry_id, requirement_id, lead_id, order_total_paise, advance_paise, valid_until, policy_version_id) values (%L, %L, 1, %L, %L, %L, %L, 1, 0, now(), %L)',
          gen_random_uuid(), tests.tid('a'), tests.rid('d1_quote'), tests.rid('d1_enq'), tests.rid('d1_req'), tests.rid('a_lead'), tests.rid('pol1'))), '23505', 'H35j an order number is unique per tenant');
select is(pg_temp.priv(format('insert into public.orders (id, tenant_id, order_no, quote_id, enquiry_id, requirement_id, lead_id, order_total_paise, advance_paise, valid_until, policy_version_id) values (%L, %L, 78, %L, %L, %L, %L, 1, 0, now(), %L)',
          gen_random_uuid(), tests.tid('a'), tests.rid('o1_quote'), tests.rid('o1_enq'), tests.rid('o1_req'), tests.rid('a_lead'), tests.rid('pol1'))), '23505', 'H33 one order per quote, whatever the path');
select is(pg_temp.priv(format('insert into public.orders (id, tenant_id, order_no, quote_id, enquiry_id, requirement_id, lead_id, order_total_paise, advance_paise, valid_until, policy_version_id) values (%L, %L, 79, %L, %L, %L, %L, 1, 2, now(), %L)',
          gen_random_uuid(), tests.tid('a'), tests.rid('d1_quote'), tests.rid('d1_enq'), tests.rid('d1_req'), tests.rid('a_lead'), tests.rid('pol1'))), '23514', 'H34 an advance above the total is refused');
select is(pg_temp.priv(format('insert into public.orders (id, tenant_id, order_no, quote_id, enquiry_id, requirement_id, lead_id, order_total_paise, advance_paise, valid_until, policy_version_id) values (%L, %L, 80, %L, %L, %L, %L, 1, 0, now(), %L)',
          gen_random_uuid(), tests.tid('a'), tests.rid('b1_quote'), tests.rid('b1_enq'), tests.rid('b1_req'), tests.rid('a_lead'), tests.rid('pol1'))), '23503', 'H35 a quote of another tenant cannot be referenced (composite foreign key)');

select is(pg_temp.ins_ev('bare', 1, 'created', null, 'quote_approved'), 'ok', 'H35k (control) the first event `created` is accepted, so the bare order has its ledger like every other');
select is(pg_temp.priv(format('insert into public.order_events (id, tenant_id, order_id, seq, type, prior_state, new_state, occurred_at, engine_version, request_text, result_text, canonical_hash) values (%L, %L, %L, 2, %L, %L, %L, now(), %L, %L, %L, %L)',
          gen_random_uuid(), tests.tid('a'), pg_temp.ord('bare'), 'send_quote', 'quote_approved', 'quote_sent', '1.0.0', '{}', '{}', 'not-a-hash')), '23514', 'H35l a hash is 64 lower-case hex digits (a table check; a legal second event, so no other check refuses it)');
select is(pg_temp.priv(format('insert into public.order_events (id, tenant_id, order_id, seq, type, prior_state, new_state, occurred_at, engine_version, request_text, result_text, canonical_hash) values (%L, %L, %L, 2, %L, %L, %L, now(), %L, %L, %L, repeat(%L, 64))',
          gen_random_uuid(), tests.tid('a'), pg_temp.ord('bare'), 'send_quote', 'quote_approved', 'quote_sent', '1.0.0', '{"x":"' || chr(8203) || '"}', '{}', 'a')), '23514', 'H35m request text with an invisible character is refused by the table too (a legal second event)');

-- ============================================================================ I. SM237 through the real quote flow
-- the fixture price list (SKU-1) and quote policy are the ones in force; a second ORDER policy (no advance required) takes over from here on, so the real quotes (advance 0) can be ordered
select pg_temp.sc('a_owner', format($q$select public.create_order_policy_version(%L, %L, %L, '{"advance_required": false, "dispatch_requires_advance": false, "cancel_allowed_until_state": "in_preparation", "allow_zero_value_orders": false}'::jsonb)$q$,
       tests.rid('pol2'), tests.tid('a'), pg_temp.today()));
create function pg_temp.sc2(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return jsonb_build_object('error', sqlstate)::text; end $$;
create function pg_temp.field(p_enq text, p_line int, p_key text, p_code text default null, p_int bigint default null, p_basis text default null) returns text language sql as $$
  select pg_temp.sc2('a_owner', format('select public.add_requirement_field(%L, %L::smallint, %L, %L, %L::bigint, null, null, %L)', tests.rid(p_enq), p_line, p_key, p_code, p_int, p_basis)) $$;
create function pg_temp.rq(p_enq text) returns uuid language sql as $$ select id from public.requirements where enquiry_id = tests.rid(p_enq) and status in ('draft', 'confirmed') $$;
create function pg_temp.prod(p_sku text) returns uuid language sql as $$ select id from public.products where tenant_id = tests.tid('a') and sku = p_sku $$;
create function pg_temp.build(p_req uuid) returns jsonb language sql as $$
  select app.quote_build(tests.tid('a'), p_req, pg_temp.today(), 'new', app.quote_active_price_version(tests.tid('a'), pg_temp.today()), app.quote_active_policy_version(tests.tid('a'), pg_temp.today())) $$;
create function pg_temp.honest_quote(p_build jsonb) returns jsonb language sql as $$
  select (p_build -> 'core') || jsonb_build_object('status', 'draft', 'engine_version', '1.1.0', 'canonical_hash', app.quote_request_hash('1.1.0', (p_build -> 'request')::text), 'trace', '[]'::jsonb,
           'flags', jsonb_build_object('needs_owner_approval', jsonb_array_length(p_build -> 'flags') > 0,
                                       'reasons', (select coalesce(jsonb_agg(jsonb_build_object('code', c)), '[]'::jsonb) from jsonb_array_elements_text(p_build -> 'flags') c))) $$;
create function pg_temp.draft(p_id uuid, p_enq text) returns text language sql as $$
  select pg_temp.sc2('a_sales', format('select public.create_quote_draft(%L, %L, ''new'', ''TG'', ''1.1.0'', %L, %L)', p_id, pg_temp.rq(p_enq), (pg_temp.build(pg_temp.rq(p_enq)) -> 'request')::text,
         pg_temp.honest_quote(pg_temp.build(pg_temp.rq(p_enq)))::text)) $$;
create function pg_temp.approve_q(p_id uuid, p_user text default 'a_owner') returns text language sql as $$
  select pg_temp.sc2(p_user, format('select public.approve_quote(%L, %L)', p_id, (select canonical_hash from public.quotes where id = p_id))) $$;
create function pg_temp.withdraw_q(p_id uuid) returns text language sql as $$ select pg_temp.sc2('a_owner', format('select public.withdraw_approved_quote(%L, %L)', p_id, 'price_changed')) $$;
insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body)
select tests.rid(n), tests.tid('a'), tests.rid('a_lead'), 'email', now() - interval '1 hour', 'Synthetic enquiry ' || n from unnest(array['h1', 'h2', 'h3']) n;
select pg_temp.field(e, 1, 'saree_type', 'kanjivaram') from unnest(array['h1', 'h2', 'h3']) e;
select pg_temp.field(e, 1, 'quantity', null, 3, 'piece') from unnest(array['h1', 'h2', 'h3']) e;
select pg_temp.sc2('a_owner', format('select public.confirm_requirement(%L)', pg_temp.rq(e))) from unnest(array['h1', 'h2', 'h3']) e;
select pg_temp.sc2('a_sales', format('select public.pick_requirement_line_product(%L, 1::smallint, %L, 3, ''piece'', ''manual'', null)', pg_temp.rq(e), pg_temp.prod('SKU-1'))) from unnest(array['h1', 'h2', 'h3']) e;
create temp table q as select gen_random_uuid() as h1a, gen_random_uuid() as h1b, gen_random_uuid() as h2a, gen_random_uuid() as h3a, gen_random_uuid() as h3b, gen_random_uuid() as o_h1, gen_random_uuid() as o_h2;
select is(pg_temp.j(pg_temp.draft((select h1a from q), 'h1'), 'status'), 'draft', 'I1 a real quote draft (the full engine path) is created');
select is(pg_temp.j(pg_temp.approve_q((select h1a from q)), 'status'), 'approved', 'I2 and approved');
select is(pg_temp.j(pg_temp.sc2('a_owner', format('select public.create_order_from_quote(%L, %L)', (select o_h1 from q), (select h1a from q))), 'state'), 'quote_approved', 'I3 the order is created from the real approved quote');
select is((select o.order_total_paise = z.total_paise and o.advance_paise = z.advance_paise and o.valid_until = z.valid_until from public.orders o join public.quotes z on z.id = o.quote_id where o.id = (select o_h1 from q)), true,
          'I4 its figures are the real quote''s, field for field');
select is(pg_temp.j(pg_temp.withdraw_q((select h1a from q)), 'error'), 'SM237', 'I5 withdrawing the approved quote once an order exists is refused (SM237)');
select is((select status::text from public.quotes where id = (select h1a from q)), 'approved', 'I6 and the quote is still approved');
select is(pg_temp.j(pg_temp.draft((select h1b from q), 'h1'), 'status'), 'draft', 'I7 a newer draft for the same requirement can be made');
select is(pg_temp.j(pg_temp.approve_q((select h1b from q)), 'error'), 'SM237', 'I8 but approving it would silently replace an ordered quote: refused (SM237)');
select is((select string_agg(status::text, ',' order by quote_no) from public.quotes where requirement_id = pg_temp.rq('h1')), 'approved,draft', 'I9 the ordered quote stays approved and the draft stays a draft');
select is(pg_temp.j(pg_temp.approve_q((select h1b from q), 'a_admin'), 'error'), 'SM237', 'I10 for an Admin as well');
-- without an order the old behaviour holds
select is(pg_temp.j(pg_temp.draft((select h2a from q), 'h2'), 'status'), 'draft', 'I11 a quote without an order: drafted');
select is(pg_temp.j(pg_temp.approve_q((select h2a from q)), 'status'), 'approved', 'I12 approved');
select is(pg_temp.j(pg_temp.withdraw_q((select h2a from q)), 'withdrawn'), 'true', 'I13 and withdrawn as before (no order)');
select is(pg_temp.j(pg_temp.sc2('a_owner', format('select public.create_order_from_quote(%L, %L)', (select o_h2 from q), (select h2a from q))), 'error'), 'SM230', 'I14 a withdrawn quote cannot be ordered (SM230)');
select is(pg_temp.j(pg_temp.draft((select h3a from q), 'h3'), 'status'), 'draft', 'I15 another requirement: drafted');
select is(pg_temp.j(pg_temp.approve_q((select h3a from q)), 'status'), 'approved', 'I16 approved');
select is(pg_temp.j(pg_temp.draft((select h3b from q), 'h3'), 'status'), 'draft', 'I17 a newer draft');
select is(pg_temp.j(pg_temp.approve_q((select h3b from q)), 'status'), 'approved', 'I18 replaces the approved quote that has NO order (as before)');
select is((select status::text from public.quotes where id = (select h3a from q)), 'superseded', 'I19 which is superseded');
select is(pg_temp.j(pg_temp.sc2('a_owner', format('select public.create_order_from_quote(%L, %L)', gen_random_uuid(), (select h3a from q))), 'error'), 'SM230', 'I20 a superseded quote cannot be ordered');

-- ---------------------------------------------------------------------------------------------
-- review fix 3: SM237 holds only while the quote's order is NOT declined, expired or cancelled (a lost or cancelled deal does not block a new quote)
-- ---------------------------------------------------------------------------------------------
create function pg_temp.deal(p_enq text) returns void language plpgsql as $$
begin
  insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (tests.rid(p_enq), tests.tid('a'), tests.rid('a_lead'), 'email', now() - interval '1 hour', 'Synthetic enquiry ' || p_enq);
  perform pg_temp.field(p_enq, 1, 'saree_type', 'kanjivaram');
  perform pg_temp.field(p_enq, 1, 'quantity', null, 3, 'piece');
  perform pg_temp.sc2('a_owner', format('select public.confirm_requirement(%L)', pg_temp.rq(p_enq)));
  perform pg_temp.sc2('a_sales', format('select public.pick_requirement_line_product(%L, 1::smallint, %L, 3, ''piece'', ''manual'', null)', pg_temp.rq(p_enq), pg_temp.prod('SKU-1')));
  perform pg_temp.draft(tests.rid(p_enq || '_q1'), p_enq);
  perform pg_temp.approve_q(tests.rid(p_enq || '_q1'));
  perform pg_temp.sc2('a_owner', format('select public.create_order_from_quote(%L, %L)', tests.rid(p_enq || '_order'), tests.rid(p_enq || '_q1')));
end $$;
create function pg_temp.q2(p_enq text) returns uuid language sql as $$ select tests.rid(p_enq || '_q2') $$;
-- a declined order: a new quote for the same requirement can be approved, the old quote is superseded, the new order runs to closed_paid
select pg_temp.deal('d1');
select pg_temp.rec('a_sales', 'd1', 'send_quote');
select is(pg_temp.rec('a_sales', 'd1', 'customer_decline', null, null, 'price'), 'declined', 'I30 a deal is lost: the order is declined');
select is(pg_temp.j(pg_temp.draft(pg_temp.q2('d1'), 'd1'), 'status'), 'draft', 'I31 a new quote for the same requirement is drafted');
select is(pg_temp.j(pg_temp.approve_q(pg_temp.q2('d1')), 'status'), 'approved', 'I32 and APPROVED: the declined order no longer blocks it (it was SM237 before the review fix)');
select is((select status::text from public.quotes where id = tests.rid('d1_q1')), 'superseded', 'I33 the old quote is superseded');
select is((select state::text from public.orders where id = pg_temp.ord('d1')), 'declined', 'I34 and its order is untouched: still declined, still the record of the lost deal');
select is(pg_temp.j(pg_temp.sc2('a_owner', format('select public.create_order_from_quote(%L, %L)', tests.rid('d1b_order'), pg_temp.q2('d1'))), 'state'), 'quote_approved', 'I35 the new quote gets its own order');
select pg_temp.rec('a_sales', 'd1b', 'send_quote');  select pg_temp.rec('a_sales', 'd1b', 'customer_accept');  select pg_temp.rec('a_sales', 'd1b', 'start_preparation');  select pg_temp.rec('a_sales', 'd1b', 'dispatch');
select is(pg_temp.rec('a_sales', 'd1b', 'deliver'), 'delivered', 'I36 the new order runs through preparation, dispatch and delivery');
select is(pg_temp.rec('a_admin', 'd1b', 'record_payment', (select order_total_paise from public.orders where id = pg_temp.ord('d1b')), 'pd1b'), 'closed_paid', 'I37 and is paid in full: closed_paid');
select is(pg_temp.j(pg_temp.withdraw_q(pg_temp.q2('d1')), 'error'), 'SM237', 'I38 the new quote, now closed_paid, cannot be withdrawn');
-- a cancelled order: the same
select pg_temp.deal('c1');
select is(pg_temp.rec('a_admin', 'c1', 'cancel'), 'cancelled', 'I39 an order cancelled with no money in it');
select is(pg_temp.j(pg_temp.withdraw_q(tests.rid('c1_q1')), 'withdrawn'), 'true', 'I40 its quote CAN now be withdrawn');
select pg_temp.deal('c2');
select pg_temp.rec('a_admin', 'c2', 'cancel');
select is(pg_temp.j(pg_temp.draft(pg_temp.q2('c2'), 'c2'), 'status'), 'draft', 'I41 a new quote after a cancellation: drafted');
select is(pg_temp.j(pg_temp.approve_q(pg_temp.q2('c2')), 'status'), 'approved', 'I42 and approved (replacing the cancelled deal''s quote)');
-- an expired order (a privileged fixture): its quote can be withdrawn
select is(pg_temp.j(pg_temp.withdraw_q(tests.rid('oe_quote')), 'withdrawn'), 'true', 'I43 an expired order''s quote can be withdrawn');
-- accepted, in-flight and closed_paid orders still refuse, both ways
select pg_temp.deal('a1');  select pg_temp.rec('a_sales', 'a1', 'send_quote');  select pg_temp.rec('a_sales', 'a1', 'customer_accept');
select pg_temp.deal('p1');  select pg_temp.rec('a_sales', 'p1', 'send_quote');  select pg_temp.rec('a_sales', 'p1', 'customer_accept');  select pg_temp.rec('a_sales', 'p1', 'start_preparation');
select pg_temp.deal('z1');  select pg_temp.rec('a_sales', 'z1', 'send_quote');  select pg_temp.rec('a_sales', 'z1', 'customer_accept');  select pg_temp.rec('a_sales', 'z1', 'start_preparation');  select pg_temp.rec('a_sales', 'z1', 'dispatch');
select pg_temp.rec('a_admin', 'z1', 'record_payment', (select order_total_paise from public.orders where id = pg_temp.ord('z1')), 'pz1');
select is(pg_temp.rec('a_sales', 'z1', 'deliver'), 'closed_paid', 'I44 (setup) a closed_paid order');
select is(pg_temp.j(pg_temp.withdraw_q(tests.rid('a1_q1')), 'error'), 'SM237', 'I45 an ACCEPTED order''s quote cannot be withdrawn');
select is(pg_temp.j(pg_temp.withdraw_q(tests.rid('p1_q1')), 'error'), 'SM237', 'I46 nor an order in preparation');
select is(pg_temp.j(pg_temp.withdraw_q(tests.rid('z1_q1')), 'error'), 'SM237', 'I47 nor a closed_paid one');
select pg_temp.draft(pg_temp.q2('a1'), 'a1');  select pg_temp.draft(pg_temp.q2('p1'), 'p1');  select pg_temp.draft(pg_temp.q2('z1'), 'z1');
select is(pg_temp.j(pg_temp.approve_q(pg_temp.q2('a1')), 'error'), 'SM237', 'I48 a new quote cannot replace an ACCEPTED order''s quote');
select is(pg_temp.j(pg_temp.approve_q(pg_temp.q2('p1')), 'error'), 'SM237', 'I49 nor one in preparation');
select is(pg_temp.j(pg_temp.approve_q(pg_temp.q2('z1')), 'error'), 'SM237', 'I50 nor a closed_paid one');
select is((select string_agg(status::text, ',' order by quote_no) from public.quotes where requirement_id in (pg_temp.rq('a1'), pg_temp.rq('p1'), pg_temp.rq('z1'))), 'approved,approved,approved,draft,draft,draft', 'I51 the three ordered quotes are still approved and the new drafts are still drafts');

-- the refusals that need a policy of their own (each new policy is the latest one in force from here on)
create function pg_temp.policy(p_id text, p_adv boolean, p_disp boolean, p_zero boolean) returns text language sql as $$
  select pg_temp.sc('a_owner', format($q$select public.create_order_policy_version(%L, %L, %L, %L::jsonb)$q$, tests.rid(p_id), tests.tid('a'), pg_temp.today(),
         jsonb_build_object('advance_required', p_adv, 'dispatch_requires_advance', p_disp, 'cancel_allowed_until_state', 'in_preparation', 'allow_zero_value_orders', p_zero)::text)) $$;
select pg_temp.mkq('zz', 0, 0);
select is(pg_temp.code('a_owner', format('select public.create_order_from_quote(%L, %L)', tests.rid('zz_order'), tests.rid('zz_quote'))), 'SM233', 'I21 a zero-value order is refused by the zero-value rule on its own (policy 2 requires no advance)');
select is(pg_temp.j(pg_temp.policy('pol3', false, false, true), 'version_no'), '3', 'I22 a policy that allows zero-value orders');
select is(pg_temp.j(pg_temp.mko('zz'), 'state'), 'quote_approved', 'I23 ... and then the zero-value order is created');
select is((select order_total_paise || '/' || advance_paise from public.orders where id = pg_temp.ord('zz')), '0/0', 'I24 with a total of zero');
select pg_temp.mkq('na2', 100000, 0);  select pg_temp.mkq('na3', 100000, 0);  select pg_temp.mkq('na4', 100000, 40000);
select is(pg_temp.j(pg_temp.policy('pol4', true, false, false), 'version_no'), '4', 'I25 a policy that requires the advance for preparation only');
select is(pg_temp.code('a_owner', format('select public.create_order_from_quote(%L, %L)', tests.rid('na2_order'), tests.rid('na2_quote'))), 'SM233', 'I26 a quote with no advance cannot be ordered under it (SM233: advance_required alone is enough)');
select is(pg_temp.j(pg_temp.policy('pol5', false, true, false), 'version_no'), '5', 'I27 a policy that requires the advance for dispatch only');
select is(pg_temp.code('a_owner', format('select public.create_order_from_quote(%L, %L)', tests.rid('na3_order'), tests.rid('na3_quote'))), 'SM233', 'I28 a quote with no advance cannot be ordered under it either (dispatch_requires_advance alone is enough)');
select is(pg_temp.j(pg_temp.mko('na4'), 'state'), 'quote_approved', 'I29 a quote WITH an advance is ordered under it');

-- ============================================================================ J. app.order_stops_followups
insert into public.leads (id, tenant_id, company_id, contact_id)
select tests.rid(n), tests.tid('a'), tests.rid('a_company'), tests.rid('a_contact') from unnest(array['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8']) n;
select pg_temp.mkq('l1', 100000, 40000, null, 'approved', 'a', 'L1');  select pg_temp.mko('l1');
select is(app.order_stops_followups(tests.rid('L1')), null, 'J1 an order that is only approved does not stop follow-ups');
select pg_temp.rec('a_sales', 'l1', 'send_quote');
select is(app.order_stops_followups(tests.rid('L1')), null, 'J2 nor does a sent quote');
select pg_temp.rec('a_sales', 'l1', 'customer_accept');
select is(app.order_stops_followups(tests.rid('L1')), 'accepted', 'J3 an accepted order stops them (fulfilment, no cadence)');
select pg_temp.rec('a_sales', 'l1', 'request_advance');
select is(app.order_stops_followups(tests.rid('L1')), 'accepted', 'J4 and so does every state after acceptance');
select pg_temp.mkq('l2', 100000, 40000, null, 'approved', 'a', 'L2');  select pg_temp.mko('l2');
select pg_temp.rec('a_sales', 'l2', 'send_quote');  select pg_temp.rec('a_sales', 'l2', 'customer_decline', null, null, 'timing');
select is(app.order_stops_followups(tests.rid('L2')), 'declined', 'J5 a declined order stops them');
select pg_temp.mkq('l3', 100000, 40000, null, 'approved', 'a', 'L3');  select pg_temp.mko('l3');
select pg_temp.rec('a_admin', 'l3', 'cancel');
select is(app.order_stops_followups(tests.rid('L3')), 'cancelled', 'J6 a cancelled order stops them');
select pg_temp.mkorder_priv('l4x', 100000, 40000, pg_temp.today() - 1);
select pg_temp.rec('a_sales', 'l4x', 'expire');
select is(app.order_stops_followups(tests.rid('L4')), null, 'J7 a lead with no order is not stopped');
select is((select state::text from public.orders where id = pg_temp.ord('l4x')), 'expired', 'J8 (an expired order is a different lead''s: the helper is per lead)');

select pg_temp.mkq('l5', 100000, 40000, null, 'approved', 'a', 'L5');
update public.quotes set status = 'superseded', withdrawn_by = tests.uid('a_owner'), withdrawn_at = now(), withdraw_code = 'price_changed' where id = tests.rid('l5_quote');
select is(app.order_stops_followups(tests.rid('L5')), 'withdrawn', 'J10 a withdrawn approved quote with no approved one since stops them');
select pg_temp.mkq('l5b', 100000, 40000, null, 'approved', 'a', 'L5');
select is(app.order_stops_followups(tests.rid('L5')), null, 'J11 until the lead has an approved quote again');
select pg_temp.mkq('l7a', 100000, 40000, null, 'approved', 'a', 'L7');  select pg_temp.mko('l7a');
select pg_temp.mkq('l7b', 100000, 40000, null, 'approved', 'a', 'L7');  select pg_temp.mko('l7b');
select pg_temp.rec('a_sales', 'l7a', 'send_quote');  select pg_temp.rec('a_sales', 'l7a', 'customer_decline', null, null, 'other');
select pg_temp.rec('a_sales', 'l7b', 'send_quote');  select pg_temp.rec('a_sales', 'l7b', 'customer_accept');
select is(app.order_stops_followups(tests.rid('L7')), 'accepted', 'J12 with a declined and an accepted order the lead is in fulfilment (accepted wins)');
select is(app.order_stops_followups(gen_random_uuid()), null, 'J13 an unknown lead is not stopped');
select pg_temp.mkq('l8', 100000, 40000, null, 'approved', 'a', 'L8');  select pg_temp.mko('l8');
select pg_temp.rec('a_sales', 'l8', 'send_quote');  select pg_temp.rec('a_sales', 'l8', 'customer_accept');  select pg_temp.rec('a_admin', 'l8', 'record_payment', 40000, 'p-l8');
select pg_temp.rec('a_sales', 'l8', 'start_preparation');  select pg_temp.rec('a_sales', 'l8', 'dispatch');
select is(pg_temp.rec('a_sales', 'l8', 'deliver'), 'delivered', 'J13b an order that is delivered with a balance still due');
select is(app.order_stops_followups(tests.rid('L8')), 'accepted', 'J13c stops follow-ups too (fulfilment)');

-- review fix 3: the lead's LATEST order decides; a newer approved quote with no order yet means nothing stops
insert into public.leads (id, tenant_id, company_id, contact_id)
select tests.rid(n), tests.tid('a'), tests.rid('a_company'), tests.rid('a_contact') from unnest(array['M2', 'M3', 'M4', 'M5', 'M6', 'M7', 'M8']) n;
select pg_temp.mkq('m2a', 100000, 40000, null, 'approved', 'a', 'M2');  select pg_temp.mko('m2a');  select pg_temp.rec('a_sales', 'm2a', 'send_quote');  select pg_temp.rec('a_sales', 'm2a', 'customer_accept');
select pg_temp.mkq('m2b', 100000, 40000, null, 'approved', 'a', 'M2');  select pg_temp.mko('m2b');  select pg_temp.rec('a_sales', 'm2b', 'send_quote');  select pg_temp.rec('a_sales', 'm2b', 'customer_decline', null, null, 'timing');
select is(app.order_stops_followups(tests.rid('M2')), 'declined', 'J16 an older accepted order and a LATEST declined one: the latest decides (declined)');
select pg_temp.mkq('m3a', 100000, 40000, null, 'approved', 'a', 'M3');  select pg_temp.mko('m3a');  select pg_temp.rec('a_admin', 'm3a', 'cancel');
select is(app.order_stops_followups(tests.rid('M3')), 'cancelled', 'J17 a cancelled order stops them');
select pg_temp.mkq('m3b', 100000, 40000, null, 'approved', 'a', 'M3');  select pg_temp.mko('m3b');  select pg_temp.rec('a_sales', 'm3b', 'send_quote');
select is(app.order_stops_followups(tests.rid('M3')), null, 'J18 ... until a LATER order is only sent: the latest order decides, nothing stops');
select pg_temp.mkq('m4a', 100000, 40000, null, 'approved', 'a', 'M4');  select pg_temp.mko('m4a');  select pg_temp.rec('a_sales', 'm4a', 'send_quote');  select pg_temp.rec('a_sales', 'm4a', 'customer_decline', null, null, 'price');
select is(app.order_stops_followups(tests.rid('M4')), 'declined', 'J19 a declined order stops them');
select pg_temp.mkq('m4b', 100000, 40000, null, 'approved', 'a', 'M4');
select is(app.order_stops_followups(tests.rid('M4')), null, 'J20 a NEWER approved quote with no order yet: a new deal is being made, nothing stops');
select pg_temp.mko('m4b');
select is(app.order_stops_followups(tests.rid('M4')), null, 'J21 and once that quote has its (open) order, the latest order is open: nothing stops');
select pg_temp.mkq('m5a', 100000, 40000, null, 'approved', 'a', 'M5');  select pg_temp.mko('m5a');  select pg_temp.rec('a_sales', 'm5a', 'send_quote');  select pg_temp.rec('a_sales', 'm5a', 'customer_decline', null, null, 'price');
select pg_temp.mkq('m5b', 100000, 40000, null, 'approved', 'a', 'M5');
update public.quotes set status = 'superseded', withdrawn_by = tests.uid('a_owner'), withdrawn_at = now(), withdraw_code = 'price_changed' where id = tests.rid('m5b_quote');
select is(app.order_stops_followups(tests.rid('M5')), 'declined', 'J22 a newer quote that was WITHDRAWN again is no new deal: the declined order stops them');
select pg_temp.mkq('m7a', 100000, 40000, null, 'approved', 'a', 'M7');  select pg_temp.mko('m7a');  select pg_temp.rec('a_sales', 'm7a', 'send_quote');  select pg_temp.rec('a_sales', 'm7a', 'customer_accept');
select is(app.order_stops_followups(tests.rid('M7')), 'accepted', 'J23 an accepted order stops them');
select pg_temp.mkq('m7b', 100000, 40000, null, 'approved', 'a', 'M7');
select is(app.order_stops_followups(tests.rid('M7')), null, 'J24 ... unless a newer approved quote with no order exists (the reading of the review: nothing stops)');
select pg_temp.mkq('m8x', 100000, 40000, null, 'approved', 'a', 'M8');
select pg_temp.mkq('m8a', 100000, 40000, null, 'approved', 'a', 'M8');  select pg_temp.mko('m8a');  select pg_temp.rec('a_sales', 'm8a', 'send_quote');  select pg_temp.rec('a_sales', 'm8a', 'customer_accept');
select is(app.order_stops_followups(tests.rid('M8')), 'accepted', 'J25 an OLDER approved quote with no order does not count as a new deal');

select ok(not has_function_privilege('authenticated', 'app.order_stops_followups(uuid)', 'execute'), 'J14 it is a helper for definer functions, not callable by a client');
select is((select provolatile from pg_proc where oid = 'app.order_stops_followups(uuid)'::regprocedure), 's', 'J15 and it is read-only (STABLE): it takes no lock');

-- ============================================================================ K. invariants over EVERY order
select is((select count(*) from public.orders o where o.tenant_id in (tests.tid('a'), tests.tid('b')) and o.state is distinct from (select e.new_state from public.order_events e where e.order_id = o.id order by e.seq desc limit 1)), 0::bigint,
          'K1 the cache equals the ledger: every order''s state is the new state of its latest event');
select is((select count(*) from (select order_id, count(*) c, max(seq) m from public.order_events where tenant_id in (tests.tid('a'), tests.tid('b')) group by order_id having count(*) <> max(seq)) x), 0::bigint, 'K2 every ledger is gapless');
select is((select count(*) from public.orders o where o.tenant_id in (tests.tid('a'), tests.tid('b')) and not exists (select 1 from public.order_events e where e.order_id = o.id and e.seq = 1 and e.type = 'created')), 0::bigint, 'K3 every order starts with a created event');
select is((select count(*) from public.orders o where o.tenant_id in (tests.tid('a'), tests.tid('b')) and (o.state in ('closed_paid', 'declined', 'expired', 'cancelled')) <> (o.closed_at is not null)), 0::bigint, 'K4 an order is closed exactly when its state is terminal');
select is((select count(*) from public.order_ledger l join public.orders o on o.id = l.order_id where o.tenant_id in (tests.tid('a'), tests.tid('b')) and (l.balance_paise < 0 or l.net_paise < 0 or l.paid_paise > o.order_total_paise)), 0::bigint, 'K5 no order is overpaid and no balance is negative');
select is((select count(*) from public.orders o join public.quotes z on z.id = o.quote_id where o.tenant_id in (tests.tid('a'), tests.tid('b')) and z.status <> 'approved' and o.state not in ('declined', 'expired', 'cancelled') and o.id not in (select tests.rid(l || '_order') from unnest(array['oe', 'oe2', 'l4x']) l)), 0::bigint,
          'K8 every order made through the function has an approved quote (the privileged fixtures are the exceptions)');

select * from finish();
rollback;
