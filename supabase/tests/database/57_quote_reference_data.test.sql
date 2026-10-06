-- T009 part 1: the reference data a quote is computed from (migration 20261016090000).
--   A privileges    B who may publish (role first, then aal2)    C validation of the price list    D versions, dates, active lookups, hash
--   E immutability  F policy versions    G mapper config versions    H visibility (a Viewer reads none)    I audit    J the operator seed
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.err(p_user text, p_sql text) returns text language sql as $$ select tests.error_full_as(tests.uid(p_user), p_sql) $$;
create function pg_temp.code(p_user text, p_sql text) returns text language sql as $$ select split_part(tests.error_full_as(tests.uid(p_user), p_sql), '|', 1) $$;
create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return jsonb_build_object('error', sqlstate)::text; end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;

-- products of tenant A: the fixture product plus a few more; one of tenant B (foreign), one inactive, one archived
insert into public.products (id, tenant_id, sku, name, active, archived_at) values
  (tests.rid('a_p2'), tests.tid('a'), 'SKU-2', 'Product A2', true, null),
  (tests.rid('a_p3'), tests.tid('a'), 'SKU-3', 'Product A3', true, null),
  (tests.rid('a_inactive'), tests.tid('a'), 'SKU-OFF', 'Inactive', false, null),
  (tests.rid('a_archived'), tests.tid('a'), 'SKU-ARC', 'Archived', true, now());

create function pg_temp.item(p_product text, p_price bigint default 100000, p_moq int default 4, p_tax int default 500, p_breaks jsonb default null) returns jsonb language sql as $$
  select jsonb_build_object('product_id', tests.rid(p_product), 'unit_price_paise', p_price, 'minimum_order_quantity', p_moq, 'tax_bps', p_tax)
         || case when p_breaks is null then '{}'::jsonb else jsonb_build_object('breaks', p_breaks) end $$;
create function pg_temp.pv_sql(p_id uuid, p_tenant text, p_eff date, p_items jsonb) returns text language sql as $$
  select format('select public.create_price_list_version(%L, %L, %L, %L::jsonb)', p_id, tests.tid(p_tenant), p_eff, p_items::text) $$;
create function pg_temp.pv(p_user text, p_id uuid, p_tenant text, p_eff date, p_items jsonb) returns text language sql as $$
  select pg_temp.code(p_user, pg_temp.pv_sql(p_id, p_tenant, p_eff, p_items)) $$;
create function pg_temp.today() returns date language sql as $$ select app.quote_today() $$;

-- ============================================================================ A. privileges
select ok(not has_function_privilege('anon', 'public.create_price_list_version(uuid,uuid,date,jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.create_quote_policy_version(uuid,uuid,date,jsonb)', 'execute')
      and not has_function_privilege('anon', 'public.create_mapper_config_version(uuid,uuid,date,text,jsonb)', 'execute'), 'anon cannot execute the three create functions');
select ok(has_function_privilege('authenticated', 'public.create_price_list_version(uuid,uuid,date,jsonb)', 'execute'), 'authenticated may call the public create function (the role and aal2 are proven inside)');
select is((select string_agg(p.oid::regprocedure::text, ', ') from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname like 'quote\_%'
             and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), null,
          'no app.quote_* helper (the internal creators included) is executable by a client');
select ok(not has_function_privilege('authenticated', 'app.operator_seed_quote_reference_data(text)', 'execute')
      and not has_function_privilege('anon', 'app.operator_seed_quote_reference_data(text)', 'execute')
      and not has_function_privilege('service_role', 'app.operator_seed_quote_reference_data(text)', 'execute'), 'the operator seed is callable by no application role');
select is((select string_agg(t, ',' order by t) from unnest(array['price_lists', 'price_list_versions', 'price_list_items', 'price_list_breaks', 'quote_policy_versions', 'mapper_config_versions']) t
            where has_any_column_privilege('authenticated', format('public.%I', t)::regclass, 'INSERT') or has_any_column_privilege('authenticated', format('public.%I', t)::regclass, 'UPDATE')
               or has_table_privilege('authenticated', format('public.%I', t)::regclass, 'DELETE')), null, 'a client has no write privilege on any of the six tables');
select is(pg_temp.code('a_owner', 'select * from public.quote_engine_versions'), '42501', 'the engine-version allow-list is not readable by a client');
select is((select string_agg(version, ',') from public.quote_engine_versions), '1.1.0', 'the allow-list holds the one reviewed engine version');

-- ============================================================================ B. who may publish
create temp table ids as select gen_random_uuid() as v1, gen_random_uuid() as v2, gen_random_uuid() as v3, gen_random_uuid() as v4, gen_random_uuid() as vb, gen_random_uuid() as vx;
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.pv_sql((select v1 from ids), 'a', pg_temp.today(), jsonb_build_array(pg_temp.item('a_product', 100000, 4, 500, jsonb_build_array(jsonb_build_object('min_qty', 10, 'unit_price_paise', 90000)))))), 'version_no'), '1',
          'an Owner (aal2) publishes version 1');
select is(pg_temp.j(pg_temp.sc('a_admin', pg_temp.pv_sql((select v2 from ids), 'a', pg_temp.today(), jsonb_build_array(pg_temp.item('a_product'), pg_temp.item('a_p2', 250000, 1, 1200)))), 'version_no'), '2', 'an Admin publishes version 2');
select is(pg_temp.pv('a_sales', gen_random_uuid(), 'a', pg_temp.today(), jsonb_build_array(pg_temp.item('a_product'))), '42501', 'Sales cannot publish');
select is(pg_temp.pv('a_viewer', gen_random_uuid(), 'a', pg_temp.today(), jsonb_build_array(pg_temp.item('a_product'))), '42501', 'a Viewer cannot publish');
select is(pg_temp.err('b_owner', pg_temp.pv_sql(gen_random_uuid(), 'a', pg_temp.today(), jsonb_build_array(pg_temp.item('a_product')))),
          pg_temp.err('b_owner', format('select public.create_price_list_version(%L, %L, %L, %L::jsonb)', gen_random_uuid(), gen_random_uuid(), pg_temp.today(), jsonb_build_array(pg_temp.item('a_product'))::text)),
          'another tenant''s Owner and an unknown tenant id get the identical refusal');
select is(pg_temp.err('a_owner', pg_temp.pv_sql(gen_random_uuid(), 'a', pg_temp.today(), jsonb_build_array(pg_temp.item('a_product')))), 'ok', 'control: the Owner is allowed (so the refusals above are about the caller)');
select tests.as_aal('aal1');
select is(pg_temp.err('a_owner', pg_temp.pv_sql(gen_random_uuid(), 'a', pg_temp.today(), jsonb_build_array(pg_temp.item('a_product')))), 'SM306|a second factor is required for this action||||', 'an Owner at aal1 needs a second factor (SM306)');
select is(pg_temp.err('a_admin', pg_temp.pv_sql(gen_random_uuid(), 'a', pg_temp.today(), jsonb_build_array(pg_temp.item('a_product')))), 'SM306|a second factor is required for this action||||', 'an Admin at aal1 needs a second factor (SM306)');
select is(pg_temp.pv('a_sales', gen_random_uuid(), 'a', pg_temp.today(), jsonb_build_array(pg_temp.item('a_product'))), '42501', 'Sales at aal1 gets 42501, not SM306: the role is proven first, so SM306 is no oracle');
select is(pg_temp.pv('b_owner', gen_random_uuid(), 'a', pg_temp.today(), jsonb_build_array(pg_temp.item('a_product'))), '42501', 'a stranger at aal1 gets 42501 too');
select tests.as_aal('absent');
select is(pg_temp.pv('a_owner', gen_random_uuid(), 'a', pg_temp.today(), jsonb_build_array(pg_temp.item('a_product'))), 'SM306', 'a token with no aal claim is refused for the second factor');
select tests.as_aal('aal2');
select is((select count(*) from public.price_list_versions where tenant_id = tests.tid('a')), 3::bigint, 'the refused calls created nothing (3 versions: v1, v2 and the control)');
-- idempotency: the same id and content replays; other content under the id, or another tenant's id, is the same constant conflict
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.pv_sql((select v1 from ids), 'a', pg_temp.today(), jsonb_build_array(pg_temp.item('a_product', 100000, 4, 500, jsonb_build_array(jsonb_build_object('min_qty', 10, 'unit_price_paise', 90000)))))), 'replayed'), 'true', 'an exact retry replays');
select is(pg_temp.err('a_owner', pg_temp.pv_sql((select v1 from ids), 'a', pg_temp.today(), jsonb_build_array(pg_temp.item('a_product', 100001)))), '23505|record id already used||||', 'the same id with other content is a conflict with a constant message');
select is(pg_temp.err('b_owner', pg_temp.pv_sql((select v1 from ids), 'b', pg_temp.today(), jsonb_build_array(pg_temp.item('b_product')))), '23505|record id already used||||', 'another tenant''s Owner using this id gets the SAME conflict (no existence oracle)');

-- ============================================================================ C. validation of the price list (an Owner at aal2)
create function pg_temp.bad(p_items jsonb) returns text language sql as $$ select pg_temp.pv('a_owner', gen_random_uuid(), 'a', pg_temp.today(), p_items) $$;
select is(pg_temp.bad(null), '22023', 'no items: invalid');
select is(pg_temp.bad('{}'::jsonb), '22023', 'items that are not an array: invalid');
select is(pg_temp.bad('[]'::jsonb), '22023', 'an empty list: invalid');
select is(pg_temp.bad((select jsonb_agg(pg_temp.item('a_product')) from generate_series(1, 1001))), '22023', '1,001 items: invalid (the engine and the table bound it at 1,000)');
select is(pg_temp.bad('[1]'::jsonb), '22023', 'an item that is not an object: invalid');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_product') || '{"cost": 5}')), '22023', 'an unknown key (a cost, a name, a discount) is refused');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_product') - 'tax_bps')), '22023', 'a missing tax rate: invalid');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_product') || '{"product_id": "not-a-uuid"}')), '22023', 'a product id that is not a uuid: invalid');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_product') || '{"unit_price_paise": "100000"}')), '22023', 'a price written as a string: invalid');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_product') || '{"unit_price_paise": 1000.5}')), '22023', 'a fractional price: invalid');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_product') || '{"unit_price_paise": -5}')), '22023', 'a negative price: invalid');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_product') || '{"breaks": "x"}')), '22023', 'breaks that are not an array: invalid');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_product') || '{"breaks": [{"min_qty": 10, "unit_price_paise": 9, "x": 1}]}')), '22023', 'a break with an unknown key: invalid');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_product', 100000, 1, 500, (select jsonb_agg(jsonb_build_object('min_qty', n + 1, 'unit_price_paise', 100000 - n)) from generate_series(1, 21) n)))), '22023', '21 breaks: invalid (20 at most)');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_product', 0))), '23514', 'a price of 0: not allowed');
select is(pg_temp.err('a_owner', pg_temp.pv_sql(gen_random_uuid(), 'a', pg_temp.today(), jsonb_build_array(pg_temp.item('a_product', 0)))), '23514|value not allowed||||', '...refused by the function (a fixed message), before the table CHECK could be reached');
select is(pg_temp.err('a_owner', pg_temp.pv_sql(gen_random_uuid(), 'a', pg_temp.today(), jsonb_build_array(pg_temp.item('a_product', 100000, 4, 10001)))), '23514|value not allowed||||', 'a tax rate above 10,000 bps: the function''s fixed message');
select is(pg_temp.err('a_owner', pg_temp.pv_sql(gen_random_uuid(), 'a', pg_temp.today(), jsonb_build_array(pg_temp.item('a_product', 100000, 10001)))), '23514|value not allowed||||', 'a minimum order quantity above 10,000: the function''s fixed message');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_product', 100000001))), '23514', 'a price above INR 1,000,000: not allowed');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_product', 100000, 0))), '23514', 'a minimum order quantity of 0: not allowed');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_product', 100000, 10001))), '23514', 'a minimum order quantity above 10,000: not allowed');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_product', 100000, 4, 10001))), '23514', 'a tax rate above 10,000 bps: not allowed');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_product'), pg_temp.item('a_product', 5))), '23514', 'the same product twice: not allowed');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_product') || '{"sale_unit": "box"}')), '23514', 'a sale unit that is not piece or set: not allowed');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_product', 100000, 4, 500, '[{"min_qty": 3, "unit_price_paise": 90000}]'::jsonb))), '23514', 'a break below the minimum order quantity: not allowed');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_product', 100000, 4, 500, '[{"min_qty": 10, "unit_price_paise": 90000}, {"min_qty": 10, "unit_price_paise": 80000}]'::jsonb))), '23514', 'breaks whose quantity does not increase: not allowed');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_product', 100000, 4, 500, '[{"min_qty": 10, "unit_price_paise": 90000}, {"min_qty": 20, "unit_price_paise": 95000}]'::jsonb))), '23514', 'a break price that goes UP: not allowed');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_product', 100000, 4, 500, '[{"min_qty": 10, "unit_price_paise": 100001}]'::jsonb))), '23514', 'a break price above the base price: not allowed');
select is(pg_temp.bad(jsonb_build_array(jsonb_build_object('product_id', gen_random_uuid(), 'unit_price_paise', 1000, 'minimum_order_quantity', 1, 'tax_bps', 0))), '23503', 'an unknown product: invalid reference');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('b_product'))), '23503', 'a product of another tenant: the same invalid reference as an unknown one');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_inactive'))), '23503', 'an inactive product: invalid reference');
select is(pg_temp.bad(jsonb_build_array(pg_temp.item('a_archived'))), '23503', 'an archived product: invalid reference');
select is(pg_temp.pv('a_owner', gen_random_uuid(), 'a', null, jsonb_build_array(pg_temp.item('a_product'))), '22023', 'no effective date: invalid');
select is(pg_temp.code('a_owner', format('select public.create_price_list_version(null, %L, %L, %L::jsonb)', tests.tid('a'), pg_temp.today(), jsonb_build_array(pg_temp.item('a_product'))::text)), '22023', 'no version id: invalid');

-- ============================================================================ D. versions, dates, active lookups, content hash
select is((select count(*) from public.price_list_versions where tenant_id = tests.tid('a')) >= 3, true, 'refused calls created no version (only the accepted ones exist)');
select is((select count(*) from public.price_lists where tenant_id = tests.tid('a')), 1::bigint, 'one price list per tenant: the first version created it, later ones reuse it');
select is((select count(*) from public.price_list_items i join ids on i.version_id = ids.v1), 1::bigint, 'version 1 has its one item');
select is((select count(*) from public.price_list_breaks b join public.price_list_items i on i.id = b.item_id join ids on i.version_id = ids.v1), 1::bigint, '...and its one break');
select is((select i.sku || '|' || i.name || '|' || i.sale_unit::text from public.price_list_items i join ids on i.version_id = ids.v2 where i.product_id = tests.rid('a_p2')), 'SKU-2|Product A2|piece', 'the item snapshots the product sku and name; the sale unit defaults to piece');
select is((select v.content_sha256 from public.price_list_versions v join ids on v.id = ids.v1), app.quote_content_hash(app.quote_price_version_normalised(tests.tid('a'), (select v1 from ids))), 'the stored content hash is the hash of the stored rows');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.pv_sql((select v1 from ids), 'a', pg_temp.today(), jsonb_build_array(pg_temp.item('a_product', 100000, 4, 500, jsonb_build_array(jsonb_build_object('min_qty', 10, 'unit_price_paise', 90000)))))), 'content_sha256'),
          (select v.content_sha256 from public.price_list_versions v join ids on v.id = ids.v1), 'a replay returns the same hash');
update public.products set name = 'Renamed later' where id = tests.rid('a_p2');
select is((select i.name from public.price_list_items i join ids on i.version_id = ids.v2 where i.product_id = tests.rid('a_p2')), 'Product A2', 'a later rename of the product does not change a published version');
select is(pg_temp.pv('a_owner', gen_random_uuid(), 'a', pg_temp.today() - 1, jsonb_build_array(pg_temp.item('a_product'))), '23514', 'a version effective in the past: not allowed (no retroactive history)');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.pv_sql((select v3 from ids), 'a', pg_temp.today() + 10, jsonb_build_array(pg_temp.item('a_product', 120000)))), 'version_no'), '4', 'a version effective in the future is allowed (scheduled): the control above was number 3');
select is(pg_temp.pv('a_owner', gen_random_uuid(), 'a', pg_temp.today() + 5, jsonb_build_array(pg_temp.item('a_product'))), '23514', 'a version effective BEFORE the latest existing one: not allowed');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.pv_sql((select v4 from ids), 'a', pg_temp.today() + 10, jsonb_build_array(pg_temp.item('a_product', 130000)))), 'version_no'), '5', 'a version effective on the same day as the latest is allowed (the higher number wins)');
select is(app.quote_active_price_version(tests.tid('a'), pg_temp.today() - 1), null, 'nothing is active before the first version');
select is(app.quote_active_price_version(tests.tid('a'), pg_temp.today()), (select id from public.price_list_versions where tenant_id = tests.tid('a') and version_no = 3), 'today: the latest version effective today (the control, number 3), not the scheduled ones');
select is(app.quote_active_price_version(tests.tid('a'), pg_temp.today() + 9), (select id from public.price_list_versions where tenant_id = tests.tid('a') and version_no = 3), 'the day before the scheduled versions: still number 3');
select is(app.quote_active_price_version(tests.tid('a'), pg_temp.today() + 10), (select id from public.price_list_versions where tenant_id = tests.tid('a') and version_no = 5), 'on the scheduled day: the higher version number of the two');
select is(app.quote_active_price_version(tests.tid('b'), pg_temp.today()), null, 'another tenant has no active version of its own yet (nothing leaks across tenants)');
select is(pg_temp.pv('b_owner', gen_random_uuid(), 'b', pg_temp.today() - 1, jsonb_build_array(pg_temp.item('b_product'))), '23514', 'a tenant''s FIRST version may not be effective in the past either (there is no earlier version to compare with: only the "not before today" rule protects it)');
select is(pg_temp.pv('a_owner', gen_random_uuid(), 'a', pg_temp.today() + 10, jsonb_build_array(pg_temp.item('a_product', 100000, 4, 500, '[{"min_qty": 4, "unit_price_paise": 95000}]'::jsonb))), 'ok', 'a break exactly AT the minimum order quantity is valid (only a break below it is refused)');

-- ============================================================================ E. immutability (even for the migration owner)
select is(pg_temp.code('a_owner', 'select 1'), 'ok', 'control for the error helper');
create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate || '|' || sqlerrm; end $$;
select is(pg_temp.priv(format('update public.price_list_items set unit_price_paise = 1 where tenant_id = %L', tests.tid('a'))), '42501|price_list_items rows are immutable: archive the row and record a new one', 'a price item cannot be updated');
select is(pg_temp.priv(format('update public.price_list_breaks set unit_price_paise = 1 where tenant_id = %L', tests.tid('a'))), '42501|price_list_breaks rows are immutable: archive the row and record a new one', 'a break cannot be updated');
select is(pg_temp.priv(format('update public.price_list_versions set effective_from = effective_from + 1 where tenant_id = %L', tests.tid('a'))), '42501|price_list_versions rows are immutable: archive the row and record a new one', 'a version cannot be re-dated');
select is(pg_temp.priv(format('update public.price_lists set name = ''x'' where tenant_id = %L', tests.tid('a'))), '42501|price_lists rows are immutable: archive the row and record a new one', 'a price list cannot be renamed');
select is(pg_temp.priv(format('update public.quote_policy_versions set net_days = 1 where tenant_id = %L', tests.tid('a'))), 'ok', 'control: the policy table has no rows of tenant A yet, so nothing is updated');
select is(pg_temp.priv(format('delete from public.price_list_versions where tenant_id = %L', tests.tid('a'))), '42501|price_list_versions rows are never deleted: record a new version', 'a version cannot be deleted');
select is(pg_temp.priv(format('delete from public.price_list_items where tenant_id = %L', tests.tid('a'))), '42501|price_list_items rows are never deleted: record a new version', 'an item cannot be deleted');
select is(pg_temp.priv(format('delete from public.price_list_breaks where tenant_id = %L', tests.tid('a'))), '42501|price_list_breaks rows are never deleted: record a new version', 'a break cannot be deleted');
select is(pg_temp.priv(format('delete from public.price_lists where tenant_id = %L', tests.tid('a'))), '42501|price_lists rows are never deleted: record a new version', 'a price list cannot be deleted');

-- ============================================================================ F. policy versions
create function pg_temp.policy(p_over jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object('discount_ceiling_bps', 0, 'shipping_flat_fee_paise', 0, 'shipping_tax_bps', 0, 'validity_days', 15, 'new_advance_bps', 5000,
                            'repeat_advance_bps', 2500, 'net_days', 30, 'seller_state', 'TS') || p_over $$;
create function pg_temp.qp_sql(p_id uuid, p_tenant text, p_eff date, p_policy jsonb) returns text language sql as $$
  select format('select public.create_quote_policy_version(%L, %L, %L, %L::jsonb)', p_id, tests.tid(p_tenant), p_eff, p_policy::text) $$;
create function pg_temp.qp(p_user text, p_policy jsonb, p_id uuid default gen_random_uuid(), p_tenant text default 'a', p_eff date default null) returns text language sql as $$
  select pg_temp.code(p_user, pg_temp.qp_sql(p_id, p_tenant, coalesce(p_eff, pg_temp.today()), p_policy)) $$;
create temp table pids as select gen_random_uuid() as p1;
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.qp_sql((select p1 from pids), 'a', pg_temp.today(), pg_temp.policy())), 'version_no'), '1', 'an Owner publishes policy version 1 (optional keys omitted)');
select is((select tax_mode::text || '|' || rounding_mode::text || '|' || repeat_credit_limit_paise || '|' || array_to_string(required_inputs, ',') || '|' || coalesce(shipping_free_above_paise::text, 'null')
             from public.quote_policy_versions v join pids on v.id = pids.p1), 'exclusive|half_up|0|delivery_state|null', 'the defaults: tax exclusive, half-up rounding, credit limit 0, delivery state required, no free-shipping threshold');
select is(pg_temp.j(pg_temp.sc('a_admin', pg_temp.qp_sql(gen_random_uuid(), 'a', pg_temp.today(), pg_temp.policy('{"shipping_free_above_paise": 500000, "rounding_mode": "half_even", "required_inputs": ["deadline", "delivery_state"], "repeat_credit_limit_paise": 100000}'))), 'version_no'), '2', 'an Admin publishes version 2 with the optional keys');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.qp_sql((select p1 from pids), 'a', pg_temp.today(), pg_temp.policy())), 'replayed'), 'true', 'a retry replays');
select is(pg_temp.err('a_owner', pg_temp.qp_sql((select p1 from pids), 'a', pg_temp.today(), pg_temp.policy('{"net_days": 31}'))), '23505|record id already used||||', 'the same id with another policy: a constant conflict');
select is(pg_temp.err('b_owner', pg_temp.qp_sql((select p1 from pids), 'b', pg_temp.today(), pg_temp.policy())), '23505|record id already used||||', 'another tenant''s Owner with IDENTICAL content and tenant A''s version id gets the constant conflict, not a replay of A''s version');
select is(pg_temp.qp('a_sales', pg_temp.policy()), '42501', 'Sales cannot publish a policy');
select is(pg_temp.qp('a_viewer', pg_temp.policy()), '42501', 'a Viewer cannot publish a policy');
select is(pg_temp.qp('b_owner', pg_temp.policy()), '42501', 'another tenant''s Owner cannot');
select tests.as_aal('aal1');
select is(pg_temp.qp('a_owner', pg_temp.policy()), 'SM306', 'an Owner at aal1 needs a second factor for a policy');
select is(pg_temp.qp('a_sales', pg_temp.policy()), '42501', '...and Sales at aal1 is refused before that (no oracle)');
select tests.as_aal('aal2');
select is(pg_temp.qp('a_owner', pg_temp.policy() || '{"price": 1}'), '22023', 'an unknown key: invalid');
select is(pg_temp.qp('a_owner', pg_temp.policy() - 'net_days'), '22023', 'a missing key: invalid');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"net_days": "30"}')), '22023', 'a string where an integer belongs: invalid');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"validity_days": 0}')), '23514', 'validity of 0 days: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"validity_days": 366}')), '23514', 'validity above 365 days: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"net_days": 181}')), '23514', 'net days above 180: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"new_advance_bps": 10001}')), '23514', 'an advance above 100 %: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"discount_ceiling_bps": 10001}')), '23514', 'a discount ceiling above 100 %: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"shipping_flat_fee_paise": 100000001}')), '23514', 'freight above INR 1,000,000: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"repeat_credit_limit_paise": 1000000001}')), '23514', 'a credit limit above INR 10,000,000: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"tax_mode": "inclusive"}')), '23514', 'tax-inclusive mode is not offered in v1');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"rounding_mode": "up"}')), '23514', 'an unknown rounding mode: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"seller_state": "ts"}')), '23514', 'a state code that is not two capital letters: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"seller_state": "TSX"}')), '23514', 'a three-letter state code: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"required_inputs": ["deadline"]}')), '23514', 'the delivery state is always required (owner decision 6)');
select is(pg_temp.err('a_owner', pg_temp.qp_sql(gen_random_uuid(), 'a', pg_temp.today(), pg_temp.policy('{"required_inputs": ["deadline"]}'))), '23514|value not allowed||||', '...refused by the function itself (the table CHECK is the second line)');
select is(pg_temp.err('a_owner', pg_temp.qp_sql(gen_random_uuid(), 'a', pg_temp.today(), pg_temp.policy('{"net_days": 181}'))), '23514|value not allowed||||', 'net days above 180: the function''s fixed message');
select is(pg_temp.err('a_owner', pg_temp.qp_sql(gen_random_uuid(), 'a', pg_temp.today(), pg_temp.policy('{"seller_state": "ts"}'))), '23514|value not allowed||||', 'a bad state code: the function''s fixed message');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"required_inputs": ["delivery_state", "delivery_state"]}')), '23514', 'a repeated required input: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"required_inputs": ["delivery_state", "colour"]}')), '23514', 'an unknown required input: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"required_inputs": ["delivery_state", "delivery_city", "payment_terms", "deadline", "deadline"]}')), '22023', 'five required inputs: invalid');
select is(pg_temp.qp('a_owner', pg_temp.policy(), gen_random_uuid(), 'a', pg_temp.today() - 1), '23514', 'a policy effective in the past: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"net_days": 45}'), gen_random_uuid(), 'a', pg_temp.today() + 3), 'ok', 'a scheduled policy version is allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"net_days": 46}'), gen_random_uuid(), 'a', pg_temp.today() + 2), '23514', 'one effective before the latest existing policy: not allowed');
select is(app.quote_active_policy_version(tests.tid('a'), pg_temp.today()), (select id from public.quote_policy_versions where tenant_id = tests.tid('a') and version_no = 2), 'the active policy today is the latest effective today');
select is(app.quote_active_policy_version(tests.tid('a'), pg_temp.today() + 3), (select id from public.quote_policy_versions where tenant_id = tests.tid('a') and version_no = 3), 'on the scheduled day the scheduled policy is active');
select is(pg_temp.priv(format('update public.quote_policy_versions set net_days = 1 where tenant_id = %L', tests.tid('a'))), '42501|quote_policy_versions rows are immutable: archive the row and record a new one', 'a policy cannot be updated');
select is(pg_temp.priv(format('delete from public.quote_policy_versions where tenant_id = %L', tests.tid('a'))), '42501|quote_policy_versions rows are never deleted: record a new version', 'a policy cannot be deleted');
select is(pg_temp.priv(format('insert into public.quote_policy_versions (tenant_id, version_no, effective_from, discount_ceiling_bps, shipping_flat_fee_paise, shipping_tax_bps, validity_days, new_advance_bps, repeat_advance_bps, net_days, seller_state, required_inputs, content_sha256) values (%L, 99, current_date, 0, 0, 0, 15, 0, 0, 30, ''TS'', array[''deadline'']::public.quote_input_key[], repeat(''1'', 64))', tests.tid('a'))) like '23514|%', true, 'the table itself also refuses a policy without the delivery state');

-- ============================================================================ G. mapper config versions
create function pg_temp.mc_sql(p_id uuid, p_tenant text, p_eff date, p_unit text, p_config jsonb) returns text language sql as $$
  select format('select public.create_mapper_config_version(%L, %L, %L, %L, %L::jsonb)', p_id, tests.tid(p_tenant), p_eff, p_unit, p_config::text) $$;
create function pg_temp.mc(p_user text, p_config jsonb, p_unit text default 'piece', p_id uuid default gen_random_uuid(), p_tenant text default 'a') returns text language sql as $$
  select pg_temp.code(p_user, pg_temp.mc_sql(p_id, p_tenant, pg_temp.today(), p_unit, p_config)) $$;
create temp table mids as select gen_random_uuid() as m1;
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.mc_sql((select m1 from mids), 'a', pg_temp.today(), 'piece', '{"saree_type_to_categories": {"kanjivaram": ["kanjivaram", "kanchipuram"]}, "colour_to_values": {"red": ["red"]}}'::jsonb)), 'version_no'), '1', 'an Owner publishes mapper config version 1 (the default sale unit is part of it)');
select is((select default_sale_unit::text from public.mapper_config_versions v join mids on v.id = mids.m1), 'piece', 'the default sale unit is stored');
select is(pg_temp.j(pg_temp.sc('a_admin', pg_temp.mc_sql(gen_random_uuid(), 'a', pg_temp.today(), 'set', '{}'::jsonb)), 'version_no'), '2', 'an Admin publishes version 2 with the default sale unit set; an empty config is allowed');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.mc_sql((select m1 from mids), 'a', pg_temp.today(), 'piece', '{"saree_type_to_categories": {"kanjivaram": ["kanjivaram", "kanchipuram"]}, "colour_to_values": {"red": ["red"]}}'::jsonb)), 'replayed'), 'true', 'a retry replays');
select is(pg_temp.err('a_owner', pg_temp.mc_sql((select m1 from mids), 'a', pg_temp.today(), 'piece', '{}'::jsonb)), '23505|record id already used||||', 'the same id with another config: a constant conflict');
select is(pg_temp.err('b_owner', pg_temp.mc_sql((select m1 from mids), 'b', pg_temp.today(), 'piece', '{"saree_type_to_categories": {"kanjivaram": ["kanjivaram", "kanchipuram"]}, "colour_to_values": {"red": ["red"]}}'::jsonb)), '23505|record id already used||||', 'another tenant''s Owner with IDENTICAL content and tenant A''s version id gets the constant conflict');
select is(pg_temp.mc('a_sales', '{}'), '42501', 'Sales cannot publish a mapper config');
select is(pg_temp.mc('a_viewer', '{}'), '42501', 'a Viewer cannot');
select is(pg_temp.mc('b_owner', '{}'), '42501', 'another tenant''s Owner cannot');
select tests.as_aal('aal1');
select is(pg_temp.mc('a_owner', '{}'), 'SM306', 'an Owner at aal1 needs a second factor');
select is(pg_temp.mc('a_sales', '{}'), '42501', '...and Sales at aal1 is refused before that');
select tests.as_aal('aal2');
select is(pg_temp.mc('a_owner', '{}', 'box'), '23514', 'a default sale unit that is not piece or set: not allowed');
select is(pg_temp.mc('a_owner', '[]'::jsonb), '22023', 'a config that is not an object: invalid');
select is(pg_temp.mc('a_owner', '{"prices": {}}'), '22023', 'an unknown top-level key: invalid');
select is(pg_temp.mc('a_owner', '{"colour_to_values": []}'), '22023', 'a map that is not an object: invalid');
select is(pg_temp.mc('a_owner', '{"colour_to_values": {"Red": ["red"]}}'), '22023', 'a code that is not a lower-case word: invalid');
select is(pg_temp.mc('a_owner', '{"colour_to_values": {"red": []}}'), '22023', 'a code with no comparison strings: invalid');
select is(pg_temp.mc('a_owner', '{"colour_to_values": {"red": "red"}}'), '22023', 'comparison strings that are not an array: invalid');
select is(pg_temp.mc('a_owner', '{"colour_to_values": {"red": ["  "]}}'), '23514', 'a blank comparison string: not allowed');
select is(pg_temp.mc('a_owner', '{"colour_to_values": {"red": [1]}}'), '23514', 'a comparison value that is not a string: not allowed');
select is(pg_temp.mc('a_owner', jsonb_build_object('colour_to_values', jsonb_build_object('red', (select jsonb_agg('v' || n) from generate_series(1, 101) n)))), '22023', '101 comparison strings for a code: invalid');
select is(pg_temp.mc('a_owner', jsonb_build_object('colour_to_values', (select jsonb_object_agg('c' || n, jsonb_build_array('x')) from generate_series(1, 501) n))), '22023', '501 codes in a map: invalid');
select is(pg_temp.mc('a_owner', jsonb_build_object('colour_to_values', jsonb_build_object('red', jsonb_build_array(repeat('x', 201))))), '23514', 'a comparison string of 201 characters: not allowed');
select is(pg_temp.mc('a_owner', jsonb_build_object('colour_to_values', (select jsonb_object_agg('c' || n, (select jsonb_agg(repeat('y', 200)) from generate_series(1, 20))) from generate_series(1, 6) n))), '23514', 'a config above 16 KB: not allowed');
select is(pg_temp.mc('a_owner', jsonb_build_object('colour_to_values', jsonb_build_object('red', jsonb_build_array('re' || chr(8203) || 'd')))), '23514', 'an invisible character (a zero-width space) in a vocabulary word: not allowed');
select is(pg_temp.priv(format('update public.mapper_config_versions set default_sale_unit = ''set'' where tenant_id = %L', tests.tid('a'))), '42501|mapper_config_versions rows are immutable: archive the row and record a new one', 'a mapper config cannot be updated');
select is(pg_temp.priv(format('delete from public.mapper_config_versions where tenant_id = %L', tests.tid('a'))), '42501|mapper_config_versions rows are never deleted: record a new version', 'a mapper config cannot be deleted');
select is(app.quote_active_mapper_version(tests.tid('a'), pg_temp.today()), (select id from public.mapper_config_versions where tenant_id = tests.tid('a') and version_no = 2), 'the active mapper config today: the latest version');

-- ============================================================================ H. visibility: a Viewer reads none of it; a stranger reads none of tenant A's
select pg_temp.sc('b_owner', pg_temp.pv_sql(gen_random_uuid(), 'b', pg_temp.today(), jsonb_build_array(pg_temp.item('b_product'))));
create function pg_temp.rows_seen(p_user text, p_table text) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform tests.set_identity(tests.uid(p_user));
  execute format('select count(*) from public.%I', p_table) into v;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;
select is((select string_agg(t || ':' || (pg_temp.rows_seen('a_viewer', t) > 0)::text, ', ' order by t) from unnest(array['price_lists', 'price_list_versions', 'price_list_items', 'price_list_breaks', 'quote_policy_versions', 'mapper_config_versions']) t),
          'mapper_config_versions:false, price_list_breaks:false, price_list_items:false, price_list_versions:false, price_lists:false, quote_policy_versions:false', 'a Viewer sees NO row of any of the six tables (owner decision 1)');
select is((select string_agg(t || ':' || (pg_temp.rows_seen('a_sales', t) > 0)::text, ', ' order by t) from unnest(array['price_lists', 'price_list_versions', 'price_list_items', 'price_list_breaks', 'quote_policy_versions', 'mapper_config_versions']) t),
          'mapper_config_versions:true, price_list_breaks:true, price_list_items:true, price_list_versions:true, price_lists:true, quote_policy_versions:true', 'Sales reads all six');
select is((select string_agg(t || ':' || (pg_temp.rows_seen('a_admin', t) > 0)::text, ', ' order by t) from unnest(array['price_lists', 'price_list_versions', 'price_list_items', 'price_list_breaks', 'quote_policy_versions', 'mapper_config_versions']) t),
          'mapper_config_versions:true, price_list_breaks:true, price_list_items:true, price_list_versions:true, price_lists:true, quote_policy_versions:true', 'an Admin reads all six');
select is(pg_temp.rows_seen('a_owner', 'price_list_versions'), (select count(*) from public.price_list_versions where tenant_id = tests.tid('a')), 'an Owner sees exactly tenant A''s versions');
select is(pg_temp.rows_seen('b_owner', 'price_list_versions'), (select count(*) from public.price_list_versions where tenant_id = tests.tid('b')), 'tenant B''s Owner sees exactly tenant B''s versions, none of A''s');
select is(pg_temp.rows_seen('b_owner', 'quote_policy_versions'), 0::bigint, 'tenant B has no policy and sees none of A''s');
select is(pg_temp.rows_seen('outsider', 'price_list_items'), 0::bigint, 'a signed-in stranger sees nothing');

-- ============================================================================ I. audit
select ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'price_list_version' and actor_type = 'user' and actor_user_id = tests.uid('a_owner')) >= 1,
          'publishing a price list version is audited as the person who did it');
select ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type in ('price_list_item', 'price_list_break', 'quote_policy_version', 'mapper_config_version')) >= 4, 'items, breaks, policies and mapper configs are audited too');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action like '%update%' and entity_type in ('price_list', 'price_list_version', 'price_list_item', 'price_list_break', 'quote_policy_version', 'mapper_config_version')), 0::bigint, 'no update was ever recorded: nothing changed');

-- ============================================================================ J. the operator seed (synthetic data; idempotent)
insert into public.tenants (id, name, slug) values (tests.tid('seeded'), 'Tenant Seed', 'tenant-seed');
select is((app.operator_seed_quote_reference_data('tenant-seed') -> 'created')::text, '["price_list_version", "quote_policy_version", "mapper_config_version"]', 'the seed creates a price list version, a policy version and a mapper config version');
select is((select count(*) from public.products where tenant_id = tests.tid('seeded') and name like 'SYNTHETIC %'), 6::bigint, 'six products, every one named SYNTHETIC');
select is((select count(*) from public.price_list_items i join public.price_list_versions v on v.id = i.version_id where v.tenant_id = tests.tid('seeded')), 6::bigint, 'the price list prices all six');
select is((select count(*) from public.price_list_items i where i.tenant_id = tests.tid('seeded') and i.sale_unit = 'set'), 1::bigint, 'one of them is sold by the set');
select is((app.operator_seed_quote_reference_data('tenant-seed') -> 'created')::text, '[]', 'a second run creates nothing (idempotent)');
select is((select count(*) from public.price_list_versions where tenant_id = tests.tid('seeded')) + (select count(*) from public.quote_policy_versions where tenant_id = tests.tid('seeded')) + (select count(*) from public.mapper_config_versions where tenant_id = tests.tid('seeded')), 3::bigint, '...three versions in all');
select is(app.quote_active_price_version(tests.tid('seeded'), pg_temp.today()) is not null and app.quote_active_policy_version(tests.tid('seeded'), pg_temp.today()) is not null and app.quote_active_mapper_version(tests.tid('seeded'), pg_temp.today()) is not null, true, 'the seeded versions are active today');
select is((select v.content_sha256 from public.price_list_versions v where v.tenant_id = tests.tid('seeded')), app.quote_content_hash(app.quote_price_version_normalised(tests.tid('seeded'), (select id from public.price_list_versions where tenant_id = tests.tid('seeded')))), 'the seeded version''s hash is the hash of its rows');
select throws_ok($$select app.operator_seed_quote_reference_data('no-such-tenant')$$, 'P0002', null, 'an unknown tenant slug is refused');

select * from finish();
rollback;
