-- T009 part 3 (migration 20261017090000): code-point collation, the repeat-customer review flag, withdrawing an approved quote, TRUNCATE guards.
--   A collation   B REPEAT_CUSTOMER_CLAIMED   C withdraw_approved_quote   D the withdrawal record (table checks, guard trigger)   E TRUNCATE guards
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select app.operator_seed_quote_reference_data('tenant-a');

create function pg_temp.err(p_user text, p_sql text) returns text language sql as $$ select tests.error_full_as(tests.uid(p_user), p_sql) $$;
create function pg_temp.code(p_user text, p_sql text) returns text language sql as $$ select split_part(tests.error_full_as(tests.uid(p_user), p_sql), '|', 1) $$;
create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return jsonb_build_object('error', sqlstate)::text; end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;
create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate || '|' || sqlerrm; end $$;
create function pg_temp.today() returns date language sql as $$ select app.quote_today() $$;
create function pg_temp.prod(p_sku text) returns uuid language sql as $$ select id from public.products where tenant_id = tests.tid('a') and sku = p_sku $$;

insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body)
select tests.rid(n), tests.tid('a'), tests.rid('a_lead'), 'email', now() - interval '1 hour', 'Synthetic enquiry ' || n from unnest(array['c1', 'r1', 'w1', 'w2', 'w3', 'w4']) n;
create function pg_temp.field(p_enq text, p_line int, p_key text, p_code text default null, p_int bigint default null, p_basis text default null) returns text language sql as $$
  select pg_temp.sc('a_owner', format('select public.add_requirement_field(%L, %L::smallint, %L, %L, %L::bigint, null, null, %L)', tests.rid(p_enq), p_line, p_key, p_code, p_int, p_basis)) $$;
create function pg_temp.req(p_enq text) returns uuid language sql as $$ select id from public.requirements where enquiry_id = tests.rid(p_enq) and status in ('draft', 'confirmed') $$;
create function pg_temp.confirm(p_enq text) returns text language sql as $$ select pg_temp.sc('a_owner', format('select public.confirm_requirement(%L)', pg_temp.req(p_enq))) $$;
create function pg_temp.pick(p_user text, p_enq text, p_line int, p_sku text, p_qty int, p_unit text default 'piece') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.pick_requirement_line_product(%L, %L::smallint, %L, %L::integer, %L, ''manual'', null)', pg_temp.req(p_enq), p_line, pg_temp.prod(p_sku), p_qty, p_unit)) $$;
create function pg_temp.build(p_req uuid, p_kind text default 'new') returns jsonb language sql as $$
  select app.quote_build(tests.tid('a'), p_req, pg_temp.today(), p_kind, app.quote_active_price_version(tests.tid('a'), pg_temp.today()), app.quote_active_policy_version(tests.tid('a'), pg_temp.today())) $$;
create function pg_temp.honest(p_build jsonb, p_request jsonb) returns jsonb language sql as $$
  select (p_build -> 'core') || jsonb_build_object('status', 'draft', 'engine_version', '1.1.0', 'canonical_hash', app.quote_request_hash('1.1.0', p_request::text), 'trace', '[]'::jsonb,
           'flags', jsonb_build_object('needs_owner_approval', jsonb_array_length(p_build -> 'flags') > 0,
                                       'reasons', (select coalesce(jsonb_agg(jsonb_build_object('code', c)), '[]'::jsonb) from jsonb_array_elements_text(p_build -> 'flags') c))) $$;
create function pg_temp.create_quote(p_user text, p_id uuid, p_enq text, p_kind text default 'new', p_state text default 'TG') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.create_quote_draft(%L, %L, %L, %L, ''1.1.0'', %L, %L)', p_id, pg_temp.req(p_enq), p_kind, p_state,
         (pg_temp.build(pg_temp.req(p_enq), p_kind) -> 'request')::text, pg_temp.honest(pg_temp.build(pg_temp.req(p_enq), p_kind), pg_temp.build(pg_temp.req(p_enq), p_kind) -> 'request')::text)) $$;
create function pg_temp.approve_sql(p_quote uuid) returns text language sql as $$
  select format('select public.approve_quote(%L, %L)', p_quote, (select canonical_hash from public.quotes where id = p_quote)) $$;

-- ============================================================================ A. collation: code point everywhere
insert into public.products (id, tenant_id, sku, name) values
  (tests.rid('p_a1d'), tests.tid('a'), 'A-1', 'Collation A-1'), (tests.rid('p_a1'), tests.tid('a'), 'A1', 'Collation A1'),
  (tests.rid('p_a2l'), tests.tid('a'), 'a-2', 'Collation a-2'), (tests.rid('p_b1'), tests.tid('a'), 'B 1', 'Collation B 1');
select ok((select datcollate from pg_database where datname = current_database()) = 'C'
          or (select array_agg(s order by s) from unnest(array['A-1', 'A1', 'a-2', 'B 1']) s) is distinct from array['A-1', 'A1', 'B 1', 'a-2'],
          'A0 (the test is meaningful) the database''s DEFAULT collation orders A-1, A1, a-2, B 1 differently from code point order (A-1, A1, B 1, a-2)');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.create_price_list_version(%L, %L, %L, %L::jsonb)', gen_random_uuid(), tests.tid('a'), pg_temp.today(),
          ((select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'sale_unit', i.sale_unit::text, 'unit_price_paise', i.unit_price_paise, 'minimum_order_quantity', i.minimum_order_quantity, 'tax_bps', i.tax_bps, 'breaks', '[]'::jsonb))
             from public.price_list_items i where i.version_id = app.quote_active_price_version(tests.tid('a'), pg_temp.today())) ||
          jsonb_build_array(
            jsonb_build_object('product_id', tests.rid('p_a2l'), 'unit_price_paise', 300000, 'minimum_order_quantity', 1, 'tax_bps', 500),
            jsonb_build_object('product_id', tests.rid('p_b1'), 'unit_price_paise', 250000, 'minimum_order_quantity', 1, 'tax_bps', 500),
            jsonb_build_object('product_id', tests.rid('p_a1'), 'unit_price_paise', 200000, 'minimum_order_quantity', 1, 'tax_bps', 500),
            jsonb_build_object('product_id', tests.rid('p_a1d'), 'unit_price_paise', 100000, 'minimum_order_quantity', 1, 'tax_bps', 500)))::text)), 'version_no'), '2',
          'A1 a price list whose skus sort differently by locale and by code point is published (items given in a shuffled order)');
select is((select string_agg(i ->> 'sku', ',') from jsonb_array_elements(app.quote_price_version_normalised(tests.tid('a'), app.quote_active_price_version(tests.tid('a'), pg_temp.today()))) i), 'A-1,A1,B 1,SYN-BN-GOLD-01,SYN-BN-RED-01,SYN-KJ-BLUE-01,SYN-KJ-RED-01,SYN-PT-GREEN-01,SYN-PT-SET-01,a-2',
          'A2 the normalised content is in CODE POINT order: A-1, A1, B 1, then SYN-..., and a-2 LAST (lower case sorts after upper case; a locale puts it near the start)');
select is((select v.content_sha256 from public.price_list_versions v where v.id = app.quote_active_price_version(tests.tid('a'), pg_temp.today())),
          app.quote_content_hash(app.quote_price_version_normalised(tests.tid('a'), app.quote_active_price_version(tests.tid('a'), pg_temp.today()))), 'A3 the stored content hash is the hash of the stored rows (recomputed)');
select pg_temp.field('c1', 1, 'saree_type', 'kanjivaram');  select pg_temp.field('c1', 1, 'quantity', null, 3, 'piece');
select pg_temp.field('c1', 2, 'saree_type', 'banarasi');    select pg_temp.field('c1', 2, 'quantity', null, 4, 'piece');
select pg_temp.field('c1', 3, 'saree_type', 'paithani');    select pg_temp.field('c1', 3, 'quantity', null, 5, 'piece');
select pg_temp.field('c1', 4, 'saree_type', 'chanderi');    select pg_temp.field('c1', 4, 'quantity', null, 6, 'piece');
select pg_temp.confirm('c1');
select pg_temp.pick('a_sales', 'c1', 1, 'a-2', 3);  select pg_temp.pick('a_sales', 'c1', 2, 'B 1', 4);
select pg_temp.pick('a_sales', 'c1', 3, 'A1', 5);   select pg_temp.pick('a_sales', 'c1', 4, 'A-1', 6);
select is((select string_agg(p ->> 'sku', ',') from jsonb_array_elements(pg_temp.build(pg_temp.req('c1')) -> 'request' -> 'price_list') p), 'A-1,A1,B 1,a-2',
          'A4 the request''s price list is in code point order (what the engine and the API produce)');
select is((select string_agg(p ->> 'sku', ',') from jsonb_array_elements(pg_temp.build(pg_temp.req('c1')) -> 'request' -> 'order_lines') p), 'a-2,B 1,A1,A-1',
          'A5 the order lines stay in REQUIREMENT line order (a different order from the price list)');
create temp table ids as select gen_random_uuid() as c1, gen_random_uuid() as r1, gen_random_uuid() as r2, gen_random_uuid() as w1, gen_random_uuid() as w2, gen_random_uuid() as w3, gen_random_uuid() as w4;
select is(pg_temp.j(pg_temp.create_quote('a_sales', (select c1 from ids), 'c1'), 'status'), 'draft', 'A6 a request in code point order is accepted by create_quote_draft (the request equals the database''s byte for byte)');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.approve_sql((select c1 from ids))), 'status'), 'approved', 'A7 and the approval''s rebuild from the stored text and picks reproduces it');
select is((select string_agg(sku, ',' order by line_no) from public.quote_lines where quote_id = (select c1 from ids)), 'a-2,B 1,A1,A-1', 'A8 the quote lines follow the requirement lines');
select is((select request_text::jsonb -> 'price_list' -> 0 ->> 'sku' from public.quotes where id = (select c1 from ids)), 'A-1', 'A9 the stored request starts with the code-point-first sku');

-- ============================================================================ B. REPEAT_CUSTOMER_CLAIMED
select pg_temp.field('r1', 1, 'saree_type', 'kanjivaram');  select pg_temp.field('r1', 1, 'quantity', null, 12, 'piece');
select pg_temp.confirm('r1');
select pg_temp.pick('a_sales', 'r1', 1, 'SYN-KJ-RED-01', 12);
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.create_quote_policy_version(%L, %L, %L, %L::jsonb)', gen_random_uuid(), tests.tid('a'), pg_temp.today(),
          '{"discount_ceiling_bps": 0, "shipping_flat_fee_paise": 0, "shipping_tax_bps": 0, "validity_days": 15, "new_advance_bps": 5000, "repeat_advance_bps": 2500, "net_days": 30, "seller_state": "TS", "repeat_credit_limit_paise": 1000000000}')), 'version_no'), '2',
          'B1 a policy with a repeat credit limit that no balance reaches (so no ENGINE flag can appear for a repeat customer)');
select is(pg_temp.j(pg_temp.create_quote('a_sales', (select r1 from ids), 'r1', 'new'), 'needs_owner_approval'), 'false', 'B2 a NEW customer: no review flag, no approval needed');
select is((select review_flags::text || '|' || engine_flags::text from public.quotes where id = (select r1 from ids)), '{}|{}', 'B3 no flags at all');
select is(pg_temp.j(pg_temp.create_quote('a_sales', (select r2 from ids), 'r1', 'repeat'), 'needs_owner_approval'), 'true', 'B4 a REPEAT customer: the Owner decides (the kind is a person''s claim)');
select is((select review_flags::text || '|' || engine_flags::text from public.quotes where id = (select r2 from ids)), '{REPEAT_CUSTOMER_CLAIMED}|{}', 'B5 the database derived the review flag; the engine raised nothing');
select is((select needs_owner_approval from public.quotes where id = (select r2 from ids)), true, 'B6 stored needs_owner_approval is true although the ENGINE result says false (the database does not copy it)');
select is(pg_temp.err('a_admin', pg_temp.approve_sql((select r2 from ids))), 'SM218|quote needs owner approval||||', 'B7 an Admin cannot approve it (SM218)');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.approve_sql((select r2 from ids))), 'status'), 'approved', 'B8 the Owner can');
select is(pg_temp.code('a_sales', format('select public.create_quote_draft(%L, %L, ''repeat'', ''TS'', ''1.1.0'', %L, %L)', gen_random_uuid(), pg_temp.req('r1'),
          (pg_temp.build(pg_temp.req('r1'), 'repeat') -> 'request')::text,
          (pg_temp.honest(pg_temp.build(pg_temp.req('r1'), 'repeat'), pg_temp.build(pg_temp.req('r1'), 'repeat') -> 'request') || '{"flags": {"needs_owner_approval": true, "reasons": []}}'::jsonb)::text)), 'SM216',
          'B9 a result that claims an approval flag the ENGINE does not raise is refused (the engine''s flag is not the database''s review flag)');

-- ============================================================================ C. withdraw_approved_quote
create function pg_temp.withdraw_sql(p_quote uuid, p_code text default 'price_changed') returns text language sql as $$ select format('select public.withdraw_approved_quote(%L, %L)', p_quote, p_code) $$;
select pg_temp.field('w1', 1, 'saree_type', 'kanjivaram');  select pg_temp.field('w1', 1, 'quantity', null, 12, 'piece');
select pg_temp.confirm('w1');
select pg_temp.pick('a_sales', 'w1', 1, 'SYN-KJ-RED-01', 12);
select is(pg_temp.j(pg_temp.create_quote('a_sales', (select w1 from ids), 'w1', 'new'), 'status'), 'draft', 'C1 a draft of W1 (a new customer: no flags)');
select is(pg_temp.err('a_owner', pg_temp.withdraw_sql((select w1 from ids))), 'SM214|quote is not a draft||||', 'C2 a DRAFT cannot be withdrawn (SM214): only an approved quote can');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.approve_sql((select w1 from ids))), 'status'), 'approved', 'C3 approved');
select is(pg_temp.code('a_sales', pg_temp.withdraw_sql((select w1 from ids))), '42501', 'C4 Sales cannot withdraw');
select is(pg_temp.code('a_viewer', pg_temp.withdraw_sql((select w1 from ids))), '42501', 'C5 a Viewer cannot');
select is(pg_temp.code('b_owner', pg_temp.withdraw_sql((select w1 from ids))), '42501', 'C6 another tenant''s Owner cannot');
select is(pg_temp.err('b_owner', pg_temp.withdraw_sql((select w1 from ids))), pg_temp.err('b_owner', pg_temp.withdraw_sql(gen_random_uuid())), 'C7 a foreign quote and an unknown one: the identical refusal');
select tests.as_aal('aal1');
select is(pg_temp.err('a_owner', pg_temp.withdraw_sql((select w1 from ids))), 'SM306|a second factor is required for this action||||', 'C8 an Owner at aal1 needs the second factor');
select is(pg_temp.err('a_admin', pg_temp.withdraw_sql((select w1 from ids))), 'SM306|a second factor is required for this action||||', 'C9 an Admin at aal1 too');
select is(pg_temp.code('a_sales', pg_temp.withdraw_sql((select w1 from ids))), '42501', 'C10 Sales at aal1: 42501 (the role is proven first, so SM306 is no oracle)');
select tests.as_aal('aal2');
select is(pg_temp.code('a_owner', pg_temp.withdraw_sql((select w1 from ids), 'nonsense')), '22023', 'C11 a reason that is not in the list: invalid');
select is(pg_temp.err('a_owner', pg_temp.withdraw_sql((select w1 from ids), null)), '22023|invalid argument||||', 'C12 no reason: invalid');
select is(pg_temp.err('a_admin', pg_temp.approve_sql((select w1 from ids))) like 'SM214%', true, 'C12b (control) an approved quote cannot be approved again by another approver (the same approver replays)');
select is(pg_temp.err('a_admin', format('select public.discard_requirement(%L)', pg_temp.req('w1'))), 'SM212|a quote depends on this requirement||||', 'C13 while the quote is approved, the requirement cannot be discarded');
select is(pg_temp.j(pg_temp.sc('a_admin', pg_temp.withdraw_sql((select w1 from ids), 'customer_cancelled')), 'replayed'), 'false', 'C14 an Admin withdraws it');
select is((select status::text || '|' || withdrawn_by::text || '|' || withdraw_code::text || '|' || (withdrawn_at is not null)::text || '|' || (approved_at is not null)::text from public.quotes where id = (select w1 from ids)),
          'superseded|' || tests.uid('a_admin')::text || '|customer_cancelled|true|true', 'C15 recorded: superseded, who, why, when; the approval record is kept');
select is(pg_temp.j(pg_temp.sc('a_admin', pg_temp.withdraw_sql((select w1 from ids), 'customer_cancelled')), 'replayed'), 'true', 'C16 an exact retry replays');
select is(pg_temp.err('a_admin', pg_temp.withdraw_sql((select w1 from ids), 'other')), 'SM214|quote is not a draft||||', 'C17 another reason after the fact: SM214 (it is recorded once)');
select is(pg_temp.err('a_owner', pg_temp.withdraw_sql((select w1 from ids), 'customer_cancelled')), 'SM214|quote is not a draft||||', 'C18 another person repeating it: SM214 (a replay is for the same person only)');
select is(pg_temp.err('a_owner', pg_temp.approve_sql((select w1 from ids))), 'SM214|quote is not a draft||||', 'C19 a withdrawn quote cannot be approved again');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'quote' and actor_user_id = tests.uid('a_admin') and entity_id = (select w1 from ids)), 1::bigint, 'C20 the withdrawal is audited as the person who did it');
select is(pg_temp.j(pg_temp.sc('a_sales', format('select public.discard_requirement(%L)', pg_temp.req('w1'))), 'status'), 'discarded', 'C21 after the withdrawal the requirement CAN be discarded again (SM212 no longer applies)');
-- a new draft works again after a withdrawal (a second requirement)
select pg_temp.field('w2', 1, 'saree_type', 'banarasi');  select pg_temp.field('w2', 1, 'quantity', null, 8, 'piece');
select pg_temp.confirm('w2');
select pg_temp.pick('a_sales', 'w2', 1, 'SYN-BN-RED-01', 8);
select pg_temp.create_quote('a_sales', (select w2 from ids), 'w2', 'new');
select pg_temp.sc('a_owner', pg_temp.approve_sql((select w2 from ids)));
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.withdraw_sql((select w2 from ids))), 'status'), 'superseded', 'C22 W2 approved, then withdrawn');
select is(pg_temp.j(pg_temp.create_quote('a_sales', (select w3 from ids), 'w2', 'new'), 'status'), 'draft', 'C23 a NEW draft of the same requirement works again');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.approve_sql((select w3 from ids))), 'status'), 'approved', 'C24 and approves (the one-approved index is free after the withdrawal)');
-- a quote replaced by a NEWER approval is superseded without a withdrawal, and cannot be withdrawn
select pg_temp.create_quote('a_sales', (select w4 from ids), 'w2', 'new');
select pg_temp.sc('a_owner', pg_temp.approve_sql((select w4 from ids)));
select is((select string_agg(status::text || ':' || (withdrawn_at is not null)::text, ',' order by created_at) from public.quotes where requirement_id = pg_temp.req('w2')), 'superseded:true,superseded:false,approved:false', 'C25 W2: the withdrawn one, the one replaced by W4, and the approved W4: told apart by withdrawn_at');
select is(pg_temp.err('a_owner', pg_temp.withdraw_sql((select w3 from ids))), 'SM214|quote is not a draft||||', 'C26 a quote that was REPLACED (not approved any more) cannot be withdrawn');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.withdraw_sql((select w4 from ids), 'entered_in_error')), 'status'), 'superseded', 'C27 the current approved quote can');

-- ============================================================================ D. the withdrawal record is protected (the guard trigger and the table checks)
select is(pg_temp.priv(format('update public.quotes set withdrawn_by = %L where id = %L', tests.uid('a_owner'), (select w1 from ids))), '42501|a quote decision is recorded once', 'D1 who withdrew cannot be changed');
select is(pg_temp.priv(format('update public.quotes set withdraw_code = ''other'' where id = %L', (select w1 from ids))), '42501|a quote decision is recorded once', 'D2 why cannot be changed');
select is(pg_temp.priv(format('update public.quotes set withdrawn_by = null, withdrawn_at = null, withdraw_code = null where id = %L', (select w1 from ids))), '42501|a quote decision is recorded once', 'D3 a withdrawal cannot be undone');
select is(pg_temp.priv(format('update public.quotes set withdrawn_by = %L, withdrawn_at = now(), withdraw_code = ''other'' where id = %L', tests.uid('a_owner'), (select r1 from ids))), '42501|a quote decision is recorded once', 'D4 a DRAFT cannot be given a withdrawal');
select is(pg_temp.priv(format('update public.quotes set status = ''superseded'', withdrawn_by = %L, withdrawn_at = now(), withdraw_code = ''other'' where id = %L', tests.uid('a_owner'), (select w3 from ids))), '42501|a quote decision is recorded once', 'D5 a quote already superseded by a newer approval cannot be given one');
select is(pg_temp.priv(format('update public.quotes set total_paise = total_paise where id = %L', (select w1 from ids))), 'ok', 'D6 (control) a no-op update of a withdrawn quote is not refused: nothing changed');
select ok(pg_temp.priv(format($f$insert into public.quotes (tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, price_list_version_id, policy_version_id, engine_version, request_text, result_text, canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, merchandise_net_paise, item_tax_paise, shipping_net_paise, shipping_tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval, withdrawn_by, withdrawn_at, withdraw_code)
        select tenant_id, 96, requirement_id, enquiry_id, lead_id, 'rejected', price_list_version_id, policy_version_id, engine_version, request_text, result_text, canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, 0, 0, 0, 0, 0, 0, 0, false, %L, now(), 'other' from public.quotes where id = %L$f$, tests.uid('a_owner'), (select w1 from ids))) like '23514|%', 'D7 the table refuses a withdrawal on a quote that is not superseded');
select ok(pg_temp.priv(format($f$insert into public.quotes (tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, price_list_version_id, policy_version_id, engine_version, request_text, result_text, canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, merchandise_net_paise, item_tax_paise, shipping_net_paise, shipping_tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval, withdrawn_by)
        select tenant_id, 95, requirement_id, enquiry_id, lead_id, 'rejected', price_list_version_id, policy_version_id, engine_version, request_text, result_text, canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, 0, 0, 0, 0, 0, 0, 0, false, %L from public.quotes where id = %L$f$, tests.uid('a_owner'), (select w1 from ids))) like '23514|%', 'D8 the table refuses a half-recorded withdrawal (who without when and why)');

-- ============================================================================ E. TRUNCATE is refused for every role, on every quote table
-- a plain TRUNCATE of a table that others reference is refused by PostgreSQL itself (0A000) before any trigger; TRUNCATE ... CASCADE reaches the trigger, and a leaf table's trigger fires directly
select is((select string_agg(t || ':' || (pg_temp.priv('truncate public.' || t) ~ '^(42501|0A000)')::text, ' | ' order by t) from unnest(array['price_lists', 'price_list_versions', 'price_list_items', 'price_list_breaks', 'quote_policy_versions', 'mapper_config_versions', 'requirement_line_picks', 'quotes', 'quote_lines']) t),
          (select string_agg(t || ':true', ' | ' order by t) from unnest(array['price_lists', 'price_list_versions', 'price_list_items', 'price_list_breaks', 'quote_policy_versions', 'mapper_config_versions', 'requirement_line_picks', 'quotes', 'quote_lines']) t),
          'E1 a plain TRUNCATE of any of the nine quote tables is refused');
select is((select string_agg(t || ':' || pg_temp.priv('truncate public.' || t || ' cascade'), ' | ' order by t) from unnest(array['price_lists', 'price_list_versions', 'price_list_items', 'price_list_breaks', 'quote_policy_versions', 'mapper_config_versions', 'requirement_line_picks', 'quotes', 'quote_lines']) t) ~ '42501\|[a-z_]+ is never truncated', true,
          'E1b TRUNCATE ... CASCADE reaches the guard trigger: refused with 42501 even for the migration owner');
select is((select count(*) from public.quotes where tenant_id = tests.tid('a')) > 0 and (select count(*) from public.price_list_items where tenant_id = tests.tid('a')) > 0, true, 'E1c nothing was truncated');
select is((select bool_and(pg_temp.priv('truncate public.' || t || ' cascade') like '42501|%') from unnest(array['price_lists', 'price_list_versions', 'price_list_items', 'price_list_breaks', 'quote_policy_versions', 'mapper_config_versions', 'requirement_line_picks', 'quotes', 'quote_lines']) t), true, 'E1d every one of the nine, with CASCADE, is refused by OUR guard (42501)');
select ok(not has_table_privilege('authenticated', 'public.quotes', 'TRUNCATE') and not has_table_privilege('authenticated', 'public.quote_lines', 'TRUNCATE'), 'E2 clients hold no TRUNCATE privilege either');

select * from finish();
rollback;
