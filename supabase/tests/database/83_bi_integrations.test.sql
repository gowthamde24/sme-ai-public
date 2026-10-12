-- Job BI (ADR 0073): the accounting export, the spreadsheet import jobs and the stock import, the calendar feed and the policy acceptance (migrations 20261114090000 to 20261114090300).
--   A catalog: private tables, grants, who can execute what         B the accounting export: roles, second factor, window, audit, isolation, the data itself
--   C import jobs: roles, second factor, same-file rule, replay     D the stock import                  E the calendar feed: tokens, rotation, the anon read, privacy
--   F policy acceptance
-- THE CLOCK: the visits clock app.outbox_now() is replaced for this transaction. Default Monday 2026-10-05 14:00 IST; to run at another instant:
--   PGOPTIONS='-c tests.bi_pin=2026-10-05T23:30:00+05:30' psql ... < this file     (the calendar window and the India date of a sale must hold at 14:00 and at 23:30)
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();
select tests.seed_t009();
select tests.seed_orders();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
select pg_temp.pin(coalesce(nullif(current_setting('tests.bi_pin', true), ''), '2026-10-05T14:00:00+05:30')::timestamptz);
create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.exp(p_user text, p_tenant text, p_id text, p_format text, p_from text, p_to text, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.export_accounting_data(%L, %L, %L, %L, %L)$q$, tests.tid(p_tenant), tests.rid(p_id), p_format, p_from, p_to), p_aal) $$;
create function pg_temp.hash(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;

-- ---------------------------------------------------------------------------------------------
-- A. catalog
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'integrations' and c.relkind = 'r' and c.relname in ('import_jobs', 'calendar_tokens', 'policy_acceptances') and c.relrowsecurity and c.relforcerowsecurity), 3::bigint,
          'A: the three integration tables have row-level security on and forced');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'integrations' and table_name in ('import_jobs', 'calendar_tokens', 'policy_acceptances') and grantee in ('anon', 'authenticated', 'public', 'service_role')), 0::bigint,
          'A: no client role holds any privilege on an integration table');
select is((select count(*) from information_schema.schemata where schema_name = 'integrations' and (has_schema_privilege('anon', schema_name, 'usage') or has_schema_privilege('authenticated', schema_name, 'usage'))), 0::bigint,
          'A: no client role can even use the integrations schema');
select is((select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')), 'calendar_feed_read', 'A: the calendar read is the only public function anon can execute');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
            and p.proname in ('export_accounting_data', 'import_job_preview_save', 'import_job_get', 'import_job_list', 'import_job_begin', 'import_job_finish', 'catalogue_stock_list', 'catalogue_stock_apply',
                              'calendar_feed_create', 'calendar_feed_status', 'calendar_feed_revoke', 'calendar_feed_read', 'policy_accept', 'policy_acceptances_mine')
            and p.prosecdef and p.proconfig @> array['search_path=""']), 14::bigint, 'A: all fourteen are SECURITY DEFINER with an empty search_path');

-- ---------------------------------------------------------------------------------------------
-- B. the accounting export
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.exp('a_owner', 'a', 'x1', 'csv', '2026-10-01', '2026-10-31')::jsonb ->> 'from', '2026-10-01', 'B: the Owner (second factor) gets the window back');
select is(pg_temp.exp('a_admin', 'a', 'x2', 'tally_zip', '2026-10-01', '2026-10-31') not like 'ERR:%', true, 'B: an Admin may export');
select is(pg_temp.exp('a_sales', 'a', 'x3', 'csv', '2026-10-01', '2026-10-31'), 'ERR:42501', 'B: Sales may not');
select is(pg_temp.exp('a_viewer', 'a', 'x4', 'csv', '2026-10-01', '2026-10-31'), 'ERR:42501', 'B: a Viewer may not');
select is(pg_temp.exp('b_owner', 'a', 'x5', 'csv', '2026-10-01', '2026-10-31'), 'ERR:42501', 'B: another business''s Owner may not');
select is(pg_temp.exp('anon', 'a', 'x6', 'csv', '2026-10-01', '2026-10-31'), 'ERR:42501', 'B: anon may not');
select is(pg_temp.exp('a_owner', 'a', 'x7', 'csv', '2026-10-01', '2026-10-31', 'aal1'), 'ERR:SM306', 'B: without a second factor the Owner is refused');
select is(pg_temp.exp('a_owner', 'a', 'x8', 'csv', '2026-10-31', '2026-10-01'), 'ERR:22023', 'B: to before from is invalid');
select is(pg_temp.exp('a_owner', 'a', 'x9', 'csv', '2025-01-01', '2026-10-01'), 'ERR:22023', 'B: more than 366 days is invalid');
select is(pg_temp.exp('a_owner', 'a', 'x1', 'pdf', '2026-10-01', '2026-10-31'), 'ERR:22023', 'B: an unknown format is invalid');
select is(pg_temp.sc('a_owner', format($q$select public.export_accounting_data(%L, null, 'csv', '2026-10-01', '2026-10-31')$q$, tests.tid('a'))), 'ERR:22023', 'B: an export needs its id');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'export.create'), 2::bigint, 'B: exactly the two allowed exports were audited, and none of the refused ones');
select is((select new_values ->> 'format' from public.audit_events where tenant_id = tests.tid('a') and action = 'export.create' and entity_id = tests.rid('x2')), 'tally_zip', 'B: the audit event names the format');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('b') and action = 'export.create'), 0::bigint, 'B: nothing was audited in the other business');
select is((select new_values::text !~* '(@|\+91|phone|email|contact)' from public.audit_events where entity_id = tests.rid('x1') and action = 'export.create'), true, 'B: the audit event holds no personal data');

-- a sale for each business: the seeded order is made accepted (the privileged fixture bypasses the lifecycle triggers for this one setup)
-- (the lifecycle triggers of orders and order_events are switched off for the fixture writes only, inside this transaction, and switched on again)
create function pg_temp.make_sale(p_t text, p_accepted timestamptz) returns void language plpgsql as $$
begin
  alter table public.orders disable trigger user;
  alter table public.order_events disable trigger user;
  update public.orders set state = 'accepted' where id = tests.rid(p_t || '_order');
  insert into public.order_events (id, tenant_id, order_id, seq, type, prior_state, new_state, occurred_at, engine_version, request_text, result_text, canonical_hash)
  values (tests.rid(p_t || '_ev_accept'), tests.tid(p_t), tests.rid(p_t || '_order'), 2, 'customer_accept', 'quote_sent', 'accepted', p_accepted, '1.0.0', 'fixture', 'fixture', repeat('a', 64));
  alter table public.orders enable trigger user;
  alter table public.order_events enable trigger user;
end $$;
select pg_temp.make_sale('a', '2026-10-05 23:45+05:30');
select pg_temp.make_sale('b', '2026-10-05 10:00+05:30');
select is(jsonb_array_length(pg_temp.exp('a_owner', 'a', 'x1', 'csv', '2026-10-05', '2026-10-05')::jsonb -> 'orders'), 1, 'B: a sale at 23:45 India time belongs to that India day');
select is(jsonb_array_length(pg_temp.exp('a_owner', 'a', 'x1', 'csv', '2026-10-04', '2026-10-04')::jsonb -> 'orders'), 0, 'B: and not to the day before (even though 23:45 IST is the same UTC date)');
select is(jsonb_array_length(pg_temp.exp('a_owner', 'a', 'x1', 'csv', '2026-10-06', '2026-10-06')::jsonb -> 'orders'), 0, 'B: nor to the day after');
select is(pg_temp.exp('a_owner', 'a', 'x1', 'csv', '2026-10-05', '2026-10-05')::jsonb -> 'orders' -> 0 ->> 'party', 'Company a', 'B: the party is the company name');
select is(pg_temp.exp('a_owner', 'a', 'x1', 'csv', '2026-10-05', '2026-10-05')::jsonb -> 'orders' -> 0 ->> 'accepted_on', '2026-10-05', 'B: the sale date is the India date of the accept event');
select is((pg_temp.exp('a_owner', 'a', 'x1', 'csv', '2026-10-05', '2026-10-05')::jsonb -> 'orders' -> 0)::text !~* '(contact|@|phone)', true, 'B: no contact person, e-mail or phone is in the export');
select is(pg_temp.exp('a_owner', 'a', 'x1', 'csv', '2026-10-05', '2026-10-05')::text !~ tests.rid('b_order')::text, true, 'B: the other business''s sale is not in business a''s export');
select is(jsonb_array_length(pg_temp.exp('b_owner', 'b', 'x1', 'csv', '2026-10-05', '2026-10-05')::jsonb -> 'orders'), 1, 'B: and business b sees its own');
-- a lost order is not a sale
alter table public.orders disable trigger user;
update public.orders set state = 'cancelled', closed_at = now() where id = tests.rid('b_order');
alter table public.orders enable trigger user;
select is(jsonb_array_length(pg_temp.exp('b_owner', 'b', 'x1', 'csv', '2026-10-05', '2026-10-05')::jsonb -> 'orders'), 0, 'B: a cancelled order is not a sale');
-- a payment, dated by its own India day, for any order
alter table public.order_events disable trigger user;
insert into public.order_events (id, tenant_id, order_id, seq, type, prior_state, new_state, amount_paise, ledger_id, occurred_at, engine_version, request_text, result_text, canonical_hash)
values (tests.rid('a_ev_pay'), tests.tid('a'), tests.rid('a_order'), 3, 'record_payment', 'accepted', 'accepted', 150000, tests.rid('a_ledger'), '2026-10-06 00:20+05:30', '1.0.0', 'fixture', 'fixture', repeat('a', 64));
alter table public.order_events enable trigger user;
select is(jsonb_array_length(pg_temp.exp('a_owner', 'a', 'x1', 'csv', '2026-10-06', '2026-10-06')::jsonb -> 'payments'), 1, 'B: a payment at 00:20 India time is on the NEXT India day');
select is(jsonb_array_length(pg_temp.exp('a_owner', 'a', 'x1', 'csv', '2026-10-05', '2026-10-05')::jsonb -> 'payments'), 0, 'B: and not on the day before');
select is(pg_temp.exp('a_owner', 'a', 'x1', 'csv', '2026-10-06', '2026-10-06')::jsonb -> 'payments' -> 0 ->> 'kind', 'payment', 'B: the payment is marked as money in');
select is((pg_temp.exp('a_owner', 'a', 'x1', 'csv', '2026-10-06', '2026-10-06')::jsonb -> 'payments' -> 0 ->> 'amount_paise')::bigint, 150000::bigint, 'B: its amount is in paise');

-- ---------------------------------------------------------------------------------------------
-- C. import jobs
-- ---------------------------------------------------------------------------------------------
create function pg_temp.prev(p_user text, p_tenant text, p_job text, p_kind text, p_file text, p_map text default 'm1', p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.import_job_preview_save(%L, %L, %L, %L, %L::jsonb, %L, 3, '{"rows":3}'::jsonb, '[{"line":4,"code":"formula_like","field":"phone"}]'::jsonb)$q$,
                              tests.tid(p_tenant), tests.rid(p_job), p_kind, pg_temp.hash(p_file), jsonb_build_object('company_name', 0, 'contact_phone', 3), pg_temp.hash(p_map)), p_aal) $$;
create function pg_temp.begin(p_user text, p_tenant text, p_job text, p_file text, p_map text default 'm1', p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.import_job_begin(%L, %L, %L, %L)$q$, tests.tid(p_tenant), tests.rid(p_job), pg_temp.hash(p_file), pg_temp.hash(p_map)), p_aal) $$;
create function pg_temp.fin(p_user text, p_tenant text, p_job text, p_status text default 'completed', p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.import_job_finish(%L, %L, %L, '{"created":2,"skipped_duplicate":1}'::jsonb, '[]'::jsonb)$q$, tests.tid(p_tenant), tests.rid(p_job), p_status), p_aal) $$;

select is(pg_temp.prev('a_owner', 'a', 'job1', 'customers', 'f1')::jsonb ->> 'status', 'previewed', 'C: the Owner records a preview');
select is(pg_temp.prev('a_admin', 'a', 'job2', 'stock', 'f2')::jsonb ->> 'kind', 'stock', 'C: an Admin may too');
select is(pg_temp.prev('a_sales', 'a', 'job3', 'customers', 'f3'), 'ERR:42501', 'C: Sales may not');
select is(pg_temp.prev('b_owner', 'a', 'job3', 'customers', 'f3'), 'ERR:42501', 'C: another business may not');
select is(pg_temp.prev('a_owner', 'a', 'job3', 'orders', 'f3'), 'ERR:22023', 'C: an unknown kind is invalid');
select is(pg_temp.prev('a_owner', 'a', 'job1', 'customers', 'f1b')::jsonb ->> 'file_sha256', pg_temp.hash('f1b'), 'C: a previewed job can be previewed again (another mapping, another file)');
select is(pg_temp.prev('a_owner', 'a', 'job1', 'stock', 'f1b'), 'ERR:22023', 'C: a job keeps its kind');
select is(pg_temp.sc('a_owner', format($q$select public.import_job_get(%L, %L)$q$, tests.tid('a'), tests.rid('job1')))::jsonb ->> 'rows_total', '3', 'C: the Owner reads the job');
select is(pg_temp.sc('b_owner', format($q$select public.import_job_get(%L, %L)$q$, tests.tid('b'), tests.rid('job1'))), 'ERR:23503', 'C: another business cannot see the job even through its own id');
select is(jsonb_array_length(pg_temp.sc('a_owner', format($q$select public.import_job_list(%L, 20)$q$, tests.tid('a')))::jsonb), 2, 'C: the list holds the business''s two jobs');
select is(jsonb_array_length(pg_temp.sc('b_owner', format($q$select public.import_job_list(%L, 20)$q$, tests.tid('b')))::jsonb), 0, 'C: and none of them is in the other business''s list');
select is(pg_temp.begin('a_owner', 'a', 'job1', 'f1b', 'm1', 'aal1'), 'ERR:SM306', 'C: running a job needs a second factor');
select is(pg_temp.begin('a_owner', 'a', 'job1', 'OTHER', 'm1'), 'ERR:SM603', 'C: another file than the preview is refused');
select is(pg_temp.begin('a_owner', 'a', 'job1', 'f1b', 'OTHER'), 'ERR:SM603', 'C: another mapping than the preview is refused');
select is(pg_temp.begin('a_sales', 'a', 'job1', 'f1b'), 'ERR:42501', 'C: Sales may not run it');
select is(pg_temp.begin('a_owner', 'a', 'job1', 'f1b')::jsonb ->> 'replay', 'false', 'C: the same file and mapping may run');
select is(pg_temp.fin('a_owner', 'a', 'job1', 'completed', 'aal1'), 'ERR:SM306', 'C: closing a job needs a second factor');
select is(pg_temp.fin('a_owner', 'a', 'job1', 'nonsense'), 'ERR:22023', 'C: an unknown final status is invalid');
select is(pg_temp.fin('a_owner', 'a', 'job1')::jsonb ->> 'status', 'completed', 'C: the job is closed with its counts');
select is(pg_temp.begin('a_owner', 'a', 'job1', 'f1b')::jsonb ->> 'replay', 'true', 'C: a completed job replays: it is not run twice');
select is(pg_temp.fin('a_owner', 'a', 'job1', 'failed')::jsonb ->> 'status', 'completed', 'C: and its first result stands');
select is(pg_temp.prev('a_owner', 'a', 'job1', 'customers', 'f9')::jsonb ->> 'file_sha256', pg_temp.hash('f1b'), 'C: a completed job cannot be re-previewed into something else');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action in ('import.start', 'import.completed')), 2::bigint, 'C: the start and the end of the run are audited');
select is((select new_values::text !~* '(@|phone|email)' from public.audit_events where action = 'import.completed' limit 1), true, 'C: the import audit event holds counts only');
select is(pg_temp.priv('update integrations.import_jobs set mapping = ''{"x": 1}''::jsonb where id = ' || quote_literal(tests.rid('job2')) || ' and false'), 'ok', 'C: (the table is writable only by the owner role; clients have no grant)');
select is(pg_temp.sc('a_owner', 'select count(*) from integrations.import_jobs'), 'ERR:42501', 'C: a client cannot read the table directly');

-- ---------------------------------------------------------------------------------------------
-- D. the stock import
-- ---------------------------------------------------------------------------------------------
insert into public.catalogue_items (id, tenant_id, name, fabric, colours, price_band, stock_status, active, created_by)
values (tests.rid('a_item1'), tests.tid('a'), 'Maroon Kanchi pattu', 'kanchi_pattu', array['maroon'], '25k_50k', 'in_stock', false, tests.uid('a_owner')),
       (tests.rid('a_item2'), tests.tid('a'), 'Green Dharmavaram', 'dharmavaram_silk', array['green'], '10k_25k', 'few_left', false, tests.uid('a_owner')),
       (tests.rid('b_item1'), tests.tid('b'), 'Business b saree', 'soft_silk', array['red'], 'under_5k', 'in_stock', false, tests.uid('b_owner'));
select is(jsonb_array_length(pg_temp.sc('a_owner', format($q$select public.catalogue_stock_list(%L)$q$, tests.tid('a')))::jsonb), 2, 'D: the list holds this business''s two items');
select is(pg_temp.sc('a_sales', format($q$select public.catalogue_stock_list(%L)$q$, tests.tid('a'))), 'ERR:42501', 'D: Sales may not list them for an import');
select is(pg_temp.sc('b_owner', format($q$select public.catalogue_stock_list(%L)$q$, tests.tid('a'))), 'ERR:42501', 'D: nor may another business');
create function pg_temp.apply(p_user text, p_job text, p_changes jsonb, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.catalogue_stock_apply(%L, %L, %L::jsonb)$q$, tests.tid('a'), tests.rid(p_job), p_changes), p_aal) $$;
select is(pg_temp.apply('a_owner', 'job1', '[]'), 'ERR:SM602', 'D: a job that is not a previewed stock job cannot apply');
select is(pg_temp.prev('a_owner', 'a', 'job4', 'stock', 'stockfile')::jsonb ->> 'kind', 'stock', 'D: a stock job is previewed');
select is(pg_temp.apply('a_owner', 'job4', jsonb_build_array(jsonb_build_object('id', tests.rid('a_item1'), 'stock_status', 'few_left')), 'aal1'), 'ERR:SM306', 'D: applying needs a second factor');
select is(pg_temp.apply('a_sales', 'job4', jsonb_build_array(jsonb_build_object('id', tests.rid('a_item1'), 'stock_status', 'few_left'))), 'ERR:42501', 'D: Sales may not apply');
select is(pg_temp.apply('a_owner', 'job4', jsonb_build_array(jsonb_build_object('id', tests.rid('a_item1'), 'stock_status', 'sold_out'))), 'ERR:22023', 'D: an unknown stock status is invalid');
select is(pg_temp.apply('a_owner', 'job4', jsonb_build_array(jsonb_build_object('id', 'not-a-uuid', 'stock_status', 'in_stock'))), 'ERR:22023', 'D: a bad id is invalid');
select is((select stock_status from public.catalogue_items where id = tests.rid('a_item1')), 'in_stock', 'D: nothing changed after the refusals');
select is(pg_temp.apply('a_owner', 'job4', jsonb_build_array(
            jsonb_build_object('id', tests.rid('a_item1'), 'stock_status', 'few_left'),
            jsonb_build_object('id', tests.rid('a_item2'), 'stock_status', 'few_left'),
            jsonb_build_object('id', tests.rid('b_item1'), 'stock_status', 'made_to_order'),
            jsonb_build_object('id', gen_random_uuid(), 'stock_status', 'in_stock')))::jsonb::text,
          '{"missing": 2, "updated": 1, "unchanged": 1}', 'D: one changed, one already so, and two that are not this business''s are only counted as missing');
select is((select stock_status from public.catalogue_items where id = tests.rid('a_item1')), 'few_left', 'D: the listed item changed');
select is((select stock_status from public.catalogue_items where id = tests.rid('b_item1')), 'in_stock', 'D: the other business''s item was not touched');
select is((select name from public.catalogue_items where id = tests.rid('a_item1')), 'Maroon Kanchi pattu', 'D: nothing but the stock status changed');

-- ---------------------------------------------------------------------------------------------
-- E. the calendar feed
-- ---------------------------------------------------------------------------------------------
create function pg_temp.visit(p_id text, p_contact text, p_starts timestamptz, p_status text default 'booked', p_tenant text default 'a') returns void language plpgsql as $$
begin
  -- a visit starts booked (the guard); the other states are reached by the legal moves
  insert into public.store_visits (id, tenant_id, lead_id, contact_id, company_id, visit_date, starts_at, ends_at, request_sha256, created_by, party_size, purpose, note)
  values (tests.rid(p_id), tests.tid(p_tenant), tests.rid(p_tenant || '_lead'), tests.rid(p_contact), tests.rid(p_tenant || '_company'), (p_starts at time zone 'Asia/Kolkata')::date, p_starts, p_starts + interval '30 minutes',
          repeat('a', 64), tests.uid(p_tenant || '_owner'), 3, 'secret purpose', 'secret note');
  if p_status = 'arrived' or p_status = 'completed' then
    update public.store_visits set status = 'arrived', arrived_at = now() where id = tests.rid(p_id);
  end if;
  if p_status = 'completed' then
    update public.store_visits set status = 'completed', outcome = 'will_return', closed_at = now() where id = tests.rid(p_id);
  end if;
  if p_status = 'cancelled' then
    update public.store_visits set status = 'cancelled', closed_at = now() where id = tests.rid(p_id);
  end if;
end $$;
update public.contacts set full_name = 'Ravi Kumar Reddy', phone = '+00 90000 11111' where id = tests.rid('a_contact');
insert into public.contacts (id, tenant_id, company_id, full_name) values (tests.rid('a_c2'), tests.tid('a'), tests.rid('a_company'), 'Lakshmi'), (tests.rid('a_c3'), tests.tid('a'), tests.rid('a_company'), 'Zed Qxjv');
select pg_temp.visit('cv1', 'a_contact', app.outbox_now() + interval '3 hours');
select pg_temp.visit('cv2', 'a_c2',      app.outbox_now() + interval '2 days');
select pg_temp.visit('cv3', 'a_contact', app.outbox_now() - interval '1 hour', 'arrived');
select pg_temp.visit('cv4', 'a_contact', app.outbox_now() - interval '5 hours', 'booked');           -- too long ago
select pg_temp.visit('cv5', 'a_contact', app.outbox_now() + interval '1 day', 'cancelled');           -- not open
select pg_temp.visit('cv6', 'a_contact', app.outbox_now() + interval '100 days');                     -- beyond 90 days
select pg_temp.visit('cv7', 'a_contact', app.outbox_now() + interval '3 days', 'completed');          -- not open
select pg_temp.visit('bv1', 'b_contact', app.outbox_now() + interval '3 hours', 'booked', 'b');

create function pg_temp.mk(p_user text, p_tenant text, p_hash text) returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.calendar_feed_create(%L, %L)$q$, tests.tid(p_tenant), p_hash)) $$;
create function pg_temp.feed(p_hash text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform tests.set_identity(null);   -- anon: a calendar app has no sign-in
  v := public.calendar_feed_read(p_hash);
  reset role;
  return v;
end $$;
select is(pg_temp.mk('a_viewer', 'a', pg_temp.hash('t-viewer'))::jsonb ->> 'active', 'true', 'E: any member (even a Viewer) can make a feed');
select is(pg_temp.mk('b_owner', 'a', pg_temp.hash('t-x')), 'ERR:42501', 'E: a person from another business cannot');
select is(pg_temp.mk('a_viewer', 'a', 'not-a-hash'), 'ERR:22023', 'E: only a SHA-256 hash is accepted');
select is(pg_temp.mk('anon', 'a', pg_temp.hash('t-x')), 'ERR:42501', 'E: anon cannot make one');
select is(pg_temp.sc('a_viewer', format($q$select public.calendar_feed_status(%L)$q$, tests.tid('a')))::jsonb ->> 'active', 'true', 'E: the status says it is active');
select is(pg_temp.sc('a_viewer', format($q$select public.calendar_feed_status(%L)$q$, tests.tid('a')))::text !~ pg_temp.hash('t-viewer'), true, 'E: the status never carries the token or its hash');
select is(pg_temp.sc('a_sales', format($q$select public.calendar_feed_status(%L)$q$, tests.tid('a')))::jsonb ->> 'active', 'false', 'E: another member of the same business has no feed of their own yet');
select is(pg_temp.mk('a_owner', 'a', pg_temp.hash('t-owner'))::jsonb ->> 'active', 'true', 'E: the Owner makes theirs');
select is(pg_temp.feed(pg_temp.hash('t-viewer')) is not null, true, 'E: the viewer''s feed still works (feeds are per member)');
select is(pg_temp.feed(pg_temp.hash('t-nobody')) is null, true, 'E: an unknown token answers null');
select is(pg_temp.feed('zzz') is null, true, 'E: so does a malformed one');
select is(jsonb_array_length(pg_temp.feed(pg_temp.hash('t-owner')) -> 'events'), 3, 'E: three upcoming visits: 3 hours ahead, 2 days ahead and the one that arrived an hour ago');
select is((select string_agg(e ->> 'label', ',' order by e ->> 'starts_at') from jsonb_array_elements(pg_temp.feed(pg_temp.hash('t-owner')) -> 'events') e), 'Ravi R.,Ravi R.,Lakshmi', 'E: first name and last initial only (one name stays whole)');
select is(pg_temp.feed(pg_temp.hash('t-owner'))::text !~* '(secret|purpose|note|9000|@|company a|11111|phone)', true, 'E: no purpose, note, phone, e-mail or company in the feed');
select is(pg_temp.feed(pg_temp.hash('t-owner'))::text !~ tests.rid('bv1')::text, true, 'E: the other business''s visit is not in it');
select is(jsonb_array_length(pg_temp.feed(pg_temp.hash('t-owner')) -> 'events') = (select count(*) from public.store_visits where tenant_id = tests.tid('a') and status in ('booked', 'confirmed', 'arrived')
                                                                                      and starts_at >= app.outbox_now() - interval '2 hours' and starts_at < app.outbox_now() + interval '90 days'), true, 'E: the window is exactly two hours back to 90 days ahead, open visits only');
alter table public.contacts disable trigger user;   -- (the erasure function is the only writer of erased_at; the fixture writes it directly, inside this transaction)
update public.contacts set erased_at = now(), full_name = 'erased:1' where id = tests.rid('a_c2');
alter table public.contacts enable trigger user;
select is((select string_agg(e ->> 'label', ',' order by e ->> 'starts_at') from jsonb_array_elements(pg_temp.feed(pg_temp.hash('t-owner')) -> 'events') e), 'Ravi R.,Ravi R.,Customer', 'E: an erased person is "Customer"');
select is(pg_temp.mk('a_owner', 'a', pg_temp.hash('t-owner2'))::jsonb ->> 'active', 'true', 'E: rotating makes a new feed');
select is(pg_temp.feed(pg_temp.hash('t-owner')) is null, true, 'E: and the old address stops working at once');
select is(pg_temp.feed(pg_temp.hash('t-owner2')) is not null, true, 'E: the new one works');
select is(pg_temp.sc('a_owner', format($q$select public.calendar_feed_revoke(%L)$q$, tests.tid('a')))::jsonb ->> 'revoked', '1', 'E: revoking says what it revoked');
select is(pg_temp.feed(pg_temp.hash('t-owner2')) is null, true, 'E: a revoked address answers null');
select is(pg_temp.sc('a_owner', format($q$select public.calendar_feed_revoke(%L)$q$, tests.tid('a')))::jsonb ->> 'revoked', '0', 'E: revoking twice is harmless');
select is((select count(*) from integrations.calendar_tokens where tenant_id = tests.tid('a') and user_id = tests.uid('a_owner') and revoked_at is null), 0::bigint, 'E: the member has no active token left');
select is((select count(*) from integrations.calendar_tokens where token_sha256 = pg_temp.hash('t-owner')), 1::bigint, 'E: only hashes are stored (a token never is)');
delete from public.memberships where tenant_id = tests.tid('a') and user_id = tests.uid('a_viewer');   -- (a fixture write: the viewer leaves the business)
select is(pg_temp.feed(pg_temp.hash('t-viewer')) is null, true, 'E: a feed stops when its member leaves the business');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action like 'calendar_feed.%'), 4::bigint, 'E: making (three times, a rotation included) and revoking (once; the second time revoked nothing) are audited');

-- ---------------------------------------------------------------------------------------------
-- F. policy acceptance
-- ---------------------------------------------------------------------------------------------
create function pg_temp.acc(p_user text, p_terms text, p_privacy text, p_via text default 'setup') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.policy_accept(%L, %L, %L)$q$, p_terms, p_privacy, p_via)) $$;
select is(jsonb_array_length(pg_temp.acc('a_sales', '2026-10-01', '2026-10-01')::jsonb), 2, 'F: a person records both versions');
select is(jsonb_array_length(pg_temp.acc('a_sales', '2026-10-01', '2026-10-01')::jsonb), 2, 'F: recording again is harmless (no second row)');
select is(jsonb_array_length(pg_temp.acc('a_sales', '2026-11-01', null)::jsonb), 3, 'F: a later terms version is a new row');
select is(pg_temp.acc('anon', '2026-10-01', null), 'ERR:42501', 'F: anon cannot');
select is(pg_temp.acc('a_sales', null, null), 'ERR:22023', 'F: at least one version is needed');
select is(pg_temp.acc('a_sales', 'x y', null), 'ERR:22023', 'F: a version is a plain label');
select is(pg_temp.acc('a_sales', '2026-10-01', null, 'hack'), 'ERR:22023', 'F: the way it was given is a closed list');
select is(jsonb_array_length(pg_temp.sc('b_sales', 'select public.policy_acceptances_mine()')::jsonb), 0, 'F: another person sees none of these rows');
select is((pg_temp.sc('a_sales', 'select public.policy_acceptances_mine()')::jsonb -> 0 ->> 'accepted_at') is not null, true, 'F: each row carries the time it was recorded');
select is(pg_temp.sc('a_sales', 'select count(*) from integrations.policy_acceptances'), 'ERR:42501', 'F: the table cannot be read directly');

select * from finish();
rollback;
