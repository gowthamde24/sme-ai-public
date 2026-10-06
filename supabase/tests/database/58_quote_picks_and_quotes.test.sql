-- T009 part 2: product picks, draft quotes, approval, rejection, immutability, visibility, and the SM212 discard block (migration 20261016090100).
-- The "engine" here is the database's own build (app.quote_build) wrapped as an honest engine result, so this file is hermetic; the property test in
-- tests/integration/test_quote_engine_equivalence.py proves the database's arithmetic equals the REAL engine on random inputs.
--   A privileges   B picks   C a draft quote   D verification refusals   E flags and owner approval   F one draft at a time   G approval
--   H rejection and withdrawal   I immutability   J visibility   K the discard block   L audit   M no oracle
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

-- requirements, built the real way (a person adds the fields, then confirms)
insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body)
select tests.rid(n), tests.tid('a'), tests.rid('a_lead'), 'email', now() - interval '1 hour', 'Synthetic enquiry ' || n
  from unnest(array['en1', 'en2', 'en3', 'en4', 'en5', 'en6', 'en7', 'en8', 'en9', 'en10', 'en11', 'en12', 'en13', 'en14', 'en15']) n;
create function pg_temp.field(p_enq text, p_line int, p_key text, p_code text default null, p_int bigint default null, p_text text default null, p_basis text default null, p_date date default null) returns text language sql as $$
  select pg_temp.sc('a_owner', format('select public.add_requirement_field(%L, %L::smallint, %L, %L, %L::bigint, %L::date, %L, %L)', tests.rid(p_enq), p_line, p_key, p_code, p_int, p_date, p_text, p_basis)) $$;
create function pg_temp.req(p_enq text) returns uuid language sql as $$ select id from public.requirements where enquiry_id = tests.rid(p_enq) and status in ('draft', 'confirmed') $$;
create function pg_temp.confirm(p_enq text) returns text language sql as $$ select pg_temp.sc('a_owner', format('select public.confirm_requirement(%L)', pg_temp.req(p_enq))) $$;

-- R1: 20 kanjivaram + 5 banarasi, delivery city
select pg_temp.field('en1', 1, 'saree_type', 'kanjivaram');
select pg_temp.field('en1', 1, 'quantity', null, 20, null, 'piece');
select pg_temp.field('en1', 2, 'saree_type', 'banarasi');
select pg_temp.field('en1', 2, 'quantity', null, 5, null, 'piece');
select pg_temp.field('en1', null, 'delivery_city', null, null, 'Hyderabad');
select is(pg_temp.j(pg_temp.confirm('en1'), 'status'), 'confirmed', 'R1 is a confirmed requirement');
-- R2: a DRAFT requirement (never confirmed)
select pg_temp.field('en2', 1, 'saree_type', 'kanjivaram');
select pg_temp.field('en2', 1, 'quantity', null, 4, null, 'piece');
-- R3: 3 kanjivaram (below the minimum order quantity of 4) and stated payment terms
select pg_temp.field('en3', 1, 'saree_type', 'kanjivaram');
select pg_temp.field('en3', 1, 'quantity', null, 3, null, 'piece');
select pg_temp.field('en3', null, 'payment_terms', 'advance_partial', 50, null, 'bps');
select pg_temp.confirm('en3');
-- R4: 12 paithani by the SET (the product is sold by the set, the customer wrote pieces): a person converts
select pg_temp.field('en4', 1, 'saree_type', 'paithani');
select pg_temp.field('en4', 1, 'quantity', null, 12, null, 'piece');
select pg_temp.confirm('en4');
-- R5 and R6: two more confirmed requirements for the flows below
select pg_temp.field('en5', 1, 'saree_type', 'banarasi');
select pg_temp.field('en5', 1, 'quantity', null, 6, null, 'piece');
select pg_temp.confirm('en5');
select pg_temp.field('en6', 1, 'saree_type', 'kanjivaram');
select pg_temp.field('en6', 1, 'quantity', null, 10, null, 'piece');
select pg_temp.confirm('en6');

insert into public.products (id, tenant_id, sku, name) values (tests.rid('a_unpriced'), tests.tid('a'), 'SKU-UNPRICED', 'Unpriced product');
create function pg_temp.pick_sql(p_enq text, p_line int, p_sku text, p_qty int, p_unit text default 'piece', p_source text default 'manual', p_hash text default null) returns text language sql as $$
  select format('select public.pick_requirement_line_product(%L, %L::smallint, %L, %L::integer, %L, %L, %L)', pg_temp.req(p_enq), p_line, pg_temp.prod(p_sku), p_qty, p_unit, p_source, p_hash) $$;
create function pg_temp.pick(p_user text, p_enq text, p_line int, p_sku text, p_qty int, p_unit text default 'piece') returns text language sql as $$
  select pg_temp.sc(p_user, pg_temp.pick_sql(p_enq, p_line, p_sku, p_qty, p_unit)) $$;

-- ============================================================================ A. privileges
select ok(not has_function_privilege('anon', 'public.pick_requirement_line_product(uuid,smallint,uuid,integer,text,text,text)', 'execute')
      and not has_function_privilege('anon', 'public.create_quote_draft(uuid,uuid,text,text,text,text,text)', 'execute')
      and not has_function_privilege('anon', 'public.approve_quote(uuid,text)', 'execute')
      and not has_function_privilege('anon', 'public.reject_quote(uuid,text)', 'execute'), 'anon cannot execute any of the four quote functions');
select is((select string_agg(t, ',' order by t) from unnest(array['requirement_line_picks', 'quotes', 'quote_lines']) t
            where has_any_column_privilege('authenticated', format('public.%I', t)::regclass, 'INSERT') or has_any_column_privilege('authenticated', format('public.%I', t)::regclass, 'UPDATE')
               or has_table_privilege('authenticated', format('public.%I', t)::regclass, 'DELETE')), null, 'a client has no write privilege on picks, quotes or quote lines');
select is((select string_agg(p.oid::regprocedure::text, ', ') from pg_proc p where p.pronamespace = 'app'::regnamespace and p.proname in ('quote_build', 'quote_round', 'quote_request_hash', 'quote_result_flags', 'quote_guard_update')
             and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), null, 'the internal build, rounding and hash helpers are executable by no client');

-- ============================================================================ B. picks
select is(pg_temp.j(pg_temp.pick('a_sales', 'en1', 1, 'SYN-KJ-RED-01', 20), 'replayed'), 'false', 'Sales picks the product of line 1');
select is(pg_temp.j(pg_temp.pick('a_sales', 'en1', 1, 'SYN-KJ-RED-01', 20), 'replayed'), 'true', 'an exact retry replays');
select is(pg_temp.j(pg_temp.pick('a_admin', 'en1', 2, 'SYN-BN-RED-01', 5), 'replayed'), 'false', 'an Admin picks line 2');
select is((select count(*) from public.requirement_line_picks where requirement_id = pg_temp.req('en1')), 2::bigint, 'one pick per line');
select is((select source::text || '|' || (suggestion_sha256 is null)::text || '|' || (decided_by = tests.uid('a_sales'))::text from public.requirement_line_picks where requirement_id = pg_temp.req('en1') and line_no = 1), 'manual|true|true', 'a manual pick records the person');
select is(pg_temp.pick('a_viewer', 'en1', 1, 'SYN-KJ-BLUE-01', 20), '{"error": "42501"}', 'a Viewer cannot pick');
select is(pg_temp.pick('b_owner', 'en1', 1, 'SYN-KJ-BLUE-01', 20), '{"error": "42501"}', 'another tenant''s Owner cannot pick');
select is(pg_temp.err('b_owner', pg_temp.pick_sql('en1', 1, 'SYN-KJ-BLUE-01', 20)), pg_temp.err('b_owner', format('select public.pick_requirement_line_product(%L, 1::smallint, %L, 20, ''piece'', ''manual'', null)', gen_random_uuid(), pg_temp.prod('SYN-KJ-BLUE-01'))), 'a foreign requirement and an unknown one: the identical refusal');
select is(pg_temp.err('a_sales', pg_temp.pick_sql('en2', 1, 'SYN-KJ-RED-01', 4)), 'SM213|requirement is not confirmed||||', 'a requirement that is not confirmed cannot be picked for (SM213)');
select is(pg_temp.pick('a_sales', 'en1', 3, 'SYN-KJ-RED-01', 5), '{"error": "23503"}', 'a line the requirement does not have: invalid reference');
select is(pg_temp.pick('a_sales', 'en1', 1, 'SYN-KJ-BLUE-01', 19), '{"error": "23514"}', 'nothing silently changes the customer''s quantity: the same unit needs the same count');
select is(pg_temp.pick('a_sales', 'en1', 0, 'SYN-KJ-RED-01', 20), '{"error": "22023"}', 'line 0: invalid');
select is(pg_temp.pick('a_sales', 'en1', 1, 'SYN-KJ-BLUE-01', 0), '{"error": "22023"}', 'quantity 0: invalid');
select is(pg_temp.pick('a_sales', 'en1', 1, 'SYN-KJ-BLUE-01', 10001), '{"error": "22023"}', 'quantity above 10,000: invalid');
select is(pg_temp.pick('a_sales', 'en1', 1, 'SYN-KJ-BLUE-01', 20, 'box'), '{"error": "22023"}', 'a unit that is not piece or set: invalid');
select is(pg_temp.pick('a_sales', 'en1', 1, 'SYN-KJ-BLUE-01', 20, 'set'), '{"error": "23514"}', 'the unit must be the one the price list sells the product in');
select is(pg_temp.sc('a_sales', format('select public.pick_requirement_line_product(%L, 1::smallint, %L, 20, ''piece'')', pg_temp.req('en1'), tests.rid('a_p2'))), '{"error": "23503"}', 'a product that is not on the active price list: invalid reference');
select is(pg_temp.sc('a_sales', format('select public.pick_requirement_line_product(%L, 1::smallint, %L, 20, ''piece'')', pg_temp.req('en1'), tests.rid('a_unpriced'))), '{"error": "23503"}', 'a product that EXISTS in the catalog but is not on the active price list: invalid reference (the foreign key alone would not refuse it)');
select is(pg_temp.sc('a_sales', format('select public.pick_requirement_line_product(%L, 1::smallint, %L, 20, ''piece'')', pg_temp.req('en1'), tests.rid('b_product'))), '{"error": "23503"}', 'another tenant''s product: the same invalid reference');
select is(pg_temp.sc('a_sales', format('select public.pick_requirement_line_product(%L, 1::smallint, %L, 20, ''piece'')', pg_temp.req('en1'), gen_random_uuid())), '{"error": "23503"}', 'an unknown product: the same');
select is(pg_temp.pick('a_sales', 'en1', 2, 'SYN-KJ-RED-01', 5), '{"error": "23514"}', 'the same product on two lines of one requirement: not allowed in v1');
select is(pg_temp.err('a_sales', pg_temp.pick_sql('en1', 2, 'SYN-BN-GOLD-01', 5, 'piece', 'mapper_suggestion', null)), '22023|invalid argument||||', 'a mapper suggestion needs the hash of the output it came from');
select is(pg_temp.err('a_sales', pg_temp.pick_sql('en1', 2, 'SYN-BN-GOLD-01', 5, 'piece', 'manual', repeat('a', 64))), '22023|invalid argument||||', 'a manual pick carries no suggestion hash');
select is(pg_temp.err('a_sales', pg_temp.pick_sql('en1', 2, 'SYN-BN-GOLD-01', 5, 'piece', 'mapper_suggestion', 'xyz')), '22023|invalid argument||||', 'a malformed suggestion hash: invalid');
select is(pg_temp.j(pg_temp.sc('a_sales', pg_temp.pick_sql('en1', 2, 'SYN-BN-GOLD-01', 5, 'piece', 'mapper_suggestion', repeat('a', 64))), 'replayed'), 'false', 'a person may accept a mapper suggestion: the pick records where it came from');
select is((select source::text || '|' || suggestion_sha256 from public.requirement_line_picks where requirement_id = pg_temp.req('en1') and line_no = 2), 'mapper_suggestion|' || repeat('a', 64), '...with the suggestion''s hash');
select is(pg_temp.j(pg_temp.pick('a_sales', 'en1', 2, 'SYN-BN-RED-01', 5), 'replayed'), 'false', 'a person may change a pick (back to the banarasi red)');
select is((select product_id from public.requirement_line_picks where requirement_id = pg_temp.req('en1') and line_no = 2), pg_temp.prod('SYN-BN-RED-01'), '...and the pick row was replaced in place');
select is(pg_temp.j(pg_temp.pick('a_sales', 'en4', 1, 'SYN-PT-SET-01', 4, 'set'), 'replayed'), 'false', 'a product sold by the set, for a requirement written in pieces: the person enters the converted count (4 sets for 12 pieces)');

-- ============================================================================ C. a draft quote
create function pg_temp.build(p_req uuid, p_kind text default 'new') returns jsonb language sql as $$
  select app.quote_build(tests.tid('a'), p_req, pg_temp.today(), p_kind, app.quote_active_price_version(tests.tid('a'), pg_temp.today()), app.quote_active_policy_version(tests.tid('a'), pg_temp.today())) $$;
-- the result an honest engine returns for a build, bound to the hash of THIS request text
create function pg_temp.honest(p_build jsonb, p_request jsonb) returns jsonb language sql as $$
  select (p_build -> 'core') || jsonb_build_object('status', 'draft', 'engine_version', '1.1.0', 'canonical_hash', app.quote_request_hash('1.1.0', p_request::text), 'trace', '[]'::jsonb,
           'flags', jsonb_build_object('needs_owner_approval', jsonb_array_length(p_build -> 'flags') > 0,
                                       'reasons', (select coalesce(jsonb_agg(jsonb_build_object('code', c)), '[]'::jsonb) from jsonb_array_elements_text(p_build -> 'flags') c))) $$;
create function pg_temp.cq_sql(p_id uuid, p_enq text, p_kind text, p_state text, p_request jsonb, p_result jsonb) returns text language sql as $$
  select format('select public.create_quote_draft(%L, %L, %L, %L, %L, %L, %L)', p_id, pg_temp.req(p_enq), p_kind, p_state, '1.1.0', p_request::text, p_result::text) $$;
-- an honest create (request and result from the database's own build)
create function pg_temp.create_quote(p_user text, p_id uuid, p_enq text, p_kind text default 'new', p_state text default 'TG') returns text language sql as $$
  select pg_temp.sc(p_user, pg_temp.cq_sql(p_id, p_enq, p_kind, p_state, pg_temp.build(pg_temp.req(p_enq), p_kind) -> 'request',
                                          pg_temp.honest(pg_temp.build(pg_temp.req(p_enq), p_kind), pg_temp.build(pg_temp.req(p_enq), p_kind) -> 'request'))) $$;
create function pg_temp.tamper(p_enq text, p_kind text, p_request_fn text, p_result_fn text) returns text language plpgsql as $$
declare b jsonb := pg_temp.build(pg_temp.req(p_enq), p_kind); rq jsonb := b -> 'request'; rs jsonb;
begin
  execute format('select %s', replace(p_request_fn, '$1', quote_literal(rq::text) || '::jsonb')) into rq;
  rs := pg_temp.honest(b, rq);
  execute format('select %s', replace(p_result_fn, '$1', quote_literal(rs::text) || '::jsonb')) into rs;
  return pg_temp.code('a_sales', pg_temp.cq_sql(gen_random_uuid(), p_enq, p_kind, 'TS', rq, rs));
end $$;
create temp table rids2 as select gen_random_uuid() as a1;
create temp table qids as select gen_random_uuid() as q1, gen_random_uuid() as q2, gen_random_uuid() as q3, gen_random_uuid() as q4, gen_random_uuid() as q5, gen_random_uuid() as q6, gen_random_uuid() as q7;

select is(pg_temp.j(pg_temp.create_quote('a_sales', (select q1 from qids), 'en1'), 'quote_no'), '1', 'Sales creates draft quote number 1 from the confirmed requirement and the picks');
select is((select status::text || '|' || needs_owner_approval::text || '|' || customer_kind::text || '|' || gst_supply::text || '|' || engine_version from public.quotes where id = (select q1 from qids)), 'draft|false|new|intra_state|1.1.0', 'a draft, no flags, intra-state (delivery state = seller state)');
-- hand-checked: 20 x 4,000.00 (the break at 10) + 5 x 3,100.00 = 95,500.00 net; GST at 5 % per line: 4,000.00 + 775.00; advance 50 % (the policy seed)
select is((select merchandise_net_paise || '|' || item_tax_paise || '|' || shipping_net_paise || '|' || shipping_tax_paise || '|' || total_paise || '|' || advance_paise || '|' || balance_paise from public.quotes where id = (select q1 from qids)),
          '9550000|477500|0|0|10027500|5013750|5013750', 'the figures are the database''s own recomputation (net 95,500.00; GST 4,775.00; total 100,275.00; advance half)');
select is((select string_agg(sku || ':' || qty || ':' || unit_price_applied_paise || ':' || coalesce(price_break_min_qty::text, '-') || ':' || tax_paise, ', ' order by line_no) from public.quote_lines where quote_id = (select q1 from qids)),
          'SYN-KJ-RED-01:20:400000:10:400000, SYN-BN-RED-01:5:310000:-:77500', 'two lines; the quantity break applies to the first only');
select is((select due_date - as_of || '|' || valid_until - as_of from public.quotes where id = (select q1 from qids)), '30|15', 'due 30 days and valid 15 days after the quote date (the seeded policy)');
select is((select canonical_hash from public.quotes where id = (select q1 from qids)), app.quote_request_hash('1.1.0', (select request_text from public.quotes where id = (select q1 from qids))), 'the stored hash is the hash of the stored request text');
select is((select count(*) from public.quote_lines where quote_id = (select q1 from qids)), 2::bigint, 'the lines were stored');
select is(pg_temp.j(pg_temp.create_quote('a_sales', (select q1 from qids), 'en1'), 'replayed'), 'true', 'an exact retry replays (nothing new is created)');
select is(pg_temp.err('a_sales', pg_temp.cq_sql((select q1 from qids), 'en1', 'repeat', 'TS', pg_temp.build(pg_temp.req('en1'), 'repeat') -> 'request', pg_temp.honest(pg_temp.build(pg_temp.req('en1'), 'repeat'), pg_temp.build(pg_temp.req('en1'), 'repeat') -> 'request'))), '23505|record id already used||||', 'the same id with other choices: the constant conflict');
select is(pg_temp.err('a_sales', pg_temp.cq_sql((select q1 from qids), 'en1', 'new', 'KA', pg_temp.build(pg_temp.req('en1')) -> 'request', pg_temp.honest(pg_temp.build(pg_temp.req('en1')), pg_temp.build(pg_temp.req('en1')) -> 'request'))), '23505|record id already used||||', 'the same id with another delivery state: the constant conflict (a retry must repeat the person''s choices)');
select is(pg_temp.err('a_sales', pg_temp.cq_sql(gen_random_uuid(), 'en2', 'new', 'TS', '{}'::jsonb, '{}'::jsonb)), 'SM213|requirement is not confirmed||||', 'a requirement that is not confirmed: SM213 (before anything is verified)');
select is(pg_temp.code('a_viewer', pg_temp.cq_sql(gen_random_uuid(), 'en1', 'new', 'TS', '{}'::jsonb, '{}'::jsonb)), '42501', 'a Viewer cannot create a draft');
select is(pg_temp.code('b_owner', pg_temp.cq_sql(gen_random_uuid(), 'en1', 'new', 'TS', '{}'::jsonb, '{}'::jsonb)), '42501', 'another tenant''s Owner cannot');
select is(pg_temp.err('b_owner', pg_temp.cq_sql(gen_random_uuid(), 'en1', 'new', 'TS', '{}'::jsonb, '{}'::jsonb)), pg_temp.err('b_owner', format('select public.create_quote_draft(%L, %L, ''new'', ''TS'', ''1.1.0'', ''{}'', ''{}'')', gen_random_uuid(), gen_random_uuid())), 'a foreign requirement and an unknown one: the identical refusal');
select is(pg_temp.code('a_sales', pg_temp.cq_sql(gen_random_uuid(), 'en1', 'new', 'ts', '{}'::jsonb, '{}'::jsonb)), '22023', 'a state code that is not two capital letters: invalid');
select is(pg_temp.code('a_sales', pg_temp.cq_sql(gen_random_uuid(), 'en1', 'guest', 'TS', '{}'::jsonb, '{}'::jsonb)), '22023', 'a customer kind that is not new or repeat: invalid');
select is(pg_temp.code('a_sales', format('select public.create_quote_draft(%L, %L, ''new'', ''TS'', ''1.1.0'', ''not json'', ''{}'')', gen_random_uuid(), pg_temp.req('en1'))), '22023', 'a request that is not JSON: invalid');
select is(pg_temp.code('a_sales', format('select public.create_quote_draft(%L, %L, ''new'', ''TS'', ''9.9.9'', %L, ''{}'')', gen_random_uuid(), pg_temp.req('en1'), (pg_temp.build(pg_temp.req('en1')) -> 'request')::text)), '23514', 'an engine version that is not on the allow-list: not allowed');

-- ============================================================================ D. the database does not trust the caller's numbers
select is(pg_temp.tamper('en1', 'new', '$1', $$$1 || '{"surprise": 1}'::jsonb$$), 'SM216', 'D1 an unknown key in the result: refused');
select is(pg_temp.tamper('en1', 'new', '$1', $$jsonb_set($1, '{totals,total}', to_jsonb(((($1) -> 'totals' ->> 'total')::bigint) - 1))$$), 'SM216', 'D2 a total one paisa lower: refused');
select is(pg_temp.tamper('en1', 'new', '$1', $$jsonb_set($1, '{totals,tax}', to_jsonb(((($1) -> 'totals' ->> 'tax')::bigint) + 1))$$), 'SM216', 'D3 a tax figure one paisa higher: refused');
select is(pg_temp.tamper('en1', 'new', '$1', $$jsonb_set($1, '{lines,0,tax}', to_jsonb(((($1) -> 'lines' -> 0 ->> 'tax')::bigint) - 1))$$), 'SM216', 'D4 a line''s tax one paisa lower: refused');
select is(pg_temp.tamper('en1', 'new', '$1', $$jsonb_set($1, '{lines,1,unit_price_applied}', '1'::jsonb)$$), 'SM216', 'D5 a line priced at one paisa: refused');
select is(pg_temp.tamper('en1', 'new', '$1', $$jsonb_set($1, '{payment_terms,advance_amount}', '0'::jsonb)$$), 'SM216', 'D6 an advance of zero: refused');
select is(pg_temp.tamper('en1', 'new', '$1', $$jsonb_set($1, '{payment_terms,due_date}', '"2099-01-01"'::jsonb)$$), 'SM216', 'D7 another due date: refused');
select is(pg_temp.tamper('en1', 'new', '$1', $$jsonb_set($1, '{valid_until}', '"2099-01-01"'::jsonb)$$), 'SM216', 'D8 another validity date: refused');
select is(pg_temp.tamper('en1', 'new', '$1', $$jsonb_set($1, '{lines,0,price_break_applied}', 'null'::jsonb)$$), 'SM216', 'D9 the quantity break not applied: refused');
select is(pg_temp.tamper('en1', 'new', '$1', $$jsonb_set($1, '{flags,needs_owner_approval}', 'true'::jsonb)$$), 'SM216', 'D10 an approval flag the database does not derive: refused');
select is(pg_temp.tamper('en1', 'new', '$1', $$jsonb_set($1, '{flags,reasons}', '[{"code": "CREDIT_LIMIT_EXCEEDED"}]'::jsonb)$$), 'SM216', 'D11 a flag the database does not derive: refused');
select is(pg_temp.tamper('en1', 'new', '$1', $$jsonb_set($1, '{canonical_hash}', to_jsonb(repeat('0', 64)))$$), 'SM216', 'D12 a result hash that is not the request''s hash: refused');
select is(pg_temp.tamper('en1', 'new', '$1', $$jsonb_set($1, '{status}', '"rejected"'::jsonb)$$), 'SM216', 'D13 a rejection is not a quote: refused');
select is(pg_temp.tamper('en1', 'new', '$1', $$jsonb_set($1, '{engine_version}', '"1.0.0"'::jsonb)$$), 'SM216', 'D14 a result from another engine version: refused');
select is(pg_temp.tamper('en1', 'new', $$jsonb_set($1, '{price_list,0,unit_price}', '1'::jsonb)$$, '$1'), 'SM216', 'D15 a request with a price that is not the price list''s: refused');
select is(pg_temp.tamper('en1', 'new', $$jsonb_set($1, '{order_lines,0,qty}', '21'::jsonb)$$, '$1'), 'SM216', 'D16 a request with another quantity than the pick: refused');
select is(pg_temp.tamper('en1', 'new', $$jsonb_set($1, '{price_list,0}', ($1 -> 'price_list' -> 0) || '{"cost": 5}'::jsonb)$$, '$1'), 'SM216', 'D17 a request that carries a cost: refused');
select is(pg_temp.tamper('en1', 'new', $$$1 || '{"order_lines": []}'::jsonb$$, '$1'), 'SM216', 'D18 a request with no lines: refused');
select is(pg_temp.tamper('en1', 'new', $$jsonb_set($1, '{policy,discount_ceiling_bps}', '5000'::jsonb)$$, '$1'), 'SM216', 'D19 a request whose policy is not the policy version''s (a discount ceiling): refused');
select is(pg_temp.tamper('en1', 'new', $$jsonb_set($1, '{policy,tax_mode}', '"inclusive"'::jsonb)$$, '$1'), 'SM216', 'D20 tax-inclusive mode: refused (v1 is exclusive only)');
select is(pg_temp.tamper('en1', 'new', $$jsonb_set($1, '{customer,kind}', '"repeat"'::jsonb)$$, '$1'), 'SM216', 'D21 a request whose customer kind is not the person''s choice: refused');
select is(pg_temp.tamper('en1', 'new', $$jsonb_set($1, '{order_lines,0,discount_bps}', '100'::jsonb)$$, '$1'), 'SM216', 'D22 a request that asks for a discount: refused');
select is(pg_temp.tamper('en1', 'new', $$jsonb_set($1, '{as_of}', to_jsonb((pg_temp.today() - 5)::text))$$, '$1'), 'SM215', 'D23 a date that is not today (India) or yesterday: stale (SM215)');
select is((select count(*) from public.quotes where requirement_id = pg_temp.req('en1')), 1::bigint, 'none of the refused calls created a quote (only quote 1)');
-- a request with a different TEXT but the same JSON must carry the engine's hash of THAT text (not a hash of another spelling)
select is(pg_temp.code('a_sales', format('select public.create_quote_draft(%L, %L, ''new'', ''TS'', ''1.1.0'', %L, %L)', gen_random_uuid(), pg_temp.req('en1'), (pg_temp.build(pg_temp.req('en1')) -> 'request')::text || ' ',
          pg_temp.honest(pg_temp.build(pg_temp.req('en1')), pg_temp.build(pg_temp.req('en1')) -> 'request')::text)), 'SM216', 'D24 the result''s hash is of ANOTHER spelling of the request text: refused (the hash binds the stored text)');
select is(pg_temp.err('a_sales', pg_temp.cq_sql(gen_random_uuid(), 'en3', 'new', 'TS', jsonb_build_object('as_of', pg_temp.today()::text), '{}'::jsonb)), 'SM217|quote input missing||||', 'D25 a line with no pick: SM217 (nothing is guessed)');

-- ============================================================================ E. flags and owner approval
select pg_temp.pick('a_sales', 'en3', 1, 'SYN-KJ-RED-01', 3);
select is(pg_temp.j(pg_temp.create_quote('a_sales', (select q2 from qids), 'en3'), 'needs_owner_approval'), 'true', 'E1 a quantity below the minimum order quantity: the draft needs the Owner');
select is((select engine_flags::text || '|' || review_flags::text from public.quotes where id = (select q2 from qids)), '{BELOW_MINIMUM_ORDER_QUANTITY}|{TERMS_REQUESTED_BY_CUSTOMER}', 'E2 the database derived BOTH: the engine flag and the customer''s stated terms');
select is(pg_temp.tamper('en3', 'new', '$1', $$jsonb_set($1, '{flags,reasons}', '[]'::jsonb)$$), 'SM216', 'E3 a result that hides the minimum-quantity flag: refused');
select is(pg_temp.tamper('en3', 'new', '$1', $$jsonb_set($1, '{flags,needs_owner_approval}', 'false'::jsonb)$$), 'SM216', 'E4 a result that clears the approval flag: refused');
select is(pg_temp.j(pg_temp.create_quote('a_sales', (select q3 from qids), 'en3', 'repeat'), 'needs_owner_approval'), 'true', 'E5 a repeat customer: needs the Owner (the repeat claim is never verified)');
select is((select engine_flags::text from public.quotes where id = (select q3 from qids)), '{BELOW_MINIMUM_ORDER_QUANTITY}', 'E6 the seeded credit limit (Rs 5,00,000) is not exceeded by a small repeat quote: only the minimum-quantity flag (the credit flag is covered by the rehearsal''s Q7)');
select is((select status::text from public.quotes where id = (select q2 from qids)), 'superseded', 'E7 the newer draft of the same requirement superseded the first (one draft at a time)');
select is((select count(*) from public.quotes where requirement_id = pg_temp.req('en3') and status = 'draft'), 1::bigint, 'E8 exactly one draft of that requirement');

-- ============================================================================ F. one draft at a time; numbers increase
select is(pg_temp.j(pg_temp.create_quote('a_sales', (select q4 from qids), 'en1', 'new', 'KA'), 'quote_no'), '4', 'F1 a new draft for R1 gets the next number');
select is((select status::text from public.quotes where id = (select q1 from qids)), 'superseded', 'F2 the first draft of R1 is superseded');
select is((select gst_supply::text from public.quotes where id = (select q4 from qids)), 'inter_state', 'F3 a delivery state other than the seller''s state: inter-state');
select is((select count(*) from public.quotes where tenant_id = tests.tid('a')), 4::bigint, 'F4 four quotes so far (numbers 1 to 4)');
select is((select string_agg(quote_no::text, ',' order by quote_no) from public.quotes where tenant_id = tests.tid('a')), '1,2,3,4', 'F5 numbers are consecutive and unique per tenant');

-- ============================================================================ G. approval
create function pg_temp.approve_sql(p_quote uuid, p_hash text default null) returns text language sql as $$
  select format('select public.approve_quote(%L, %L)', p_quote, coalesce(p_hash, (select canonical_hash from public.quotes where id = p_quote))) $$;
select is(pg_temp.code('a_sales', pg_temp.approve_sql((select q4 from qids))), '42501', 'G1 Sales cannot approve');
select is(pg_temp.code('a_viewer', pg_temp.approve_sql((select q4 from qids))), '42501', 'G2 a Viewer cannot approve');
select is(pg_temp.code('b_owner', pg_temp.approve_sql((select q4 from qids))), '42501', 'G3 another tenant''s Owner cannot approve');
select is(pg_temp.err('b_owner', pg_temp.approve_sql((select q4 from qids))), pg_temp.err('b_owner', pg_temp.approve_sql(gen_random_uuid(), repeat('a', 64))), 'G4 a foreign quote and an unknown one: the identical refusal');
select tests.as_aal('aal1');
select is(pg_temp.err('a_owner', pg_temp.approve_sql((select q4 from qids))), 'SM306|a second factor is required for this action||||', 'G5 an Owner at aal1 needs the second factor to approve');
select is(pg_temp.err('a_admin', pg_temp.approve_sql((select q4 from qids))), 'SM306|a second factor is required for this action||||', 'G6 an Admin at aal1 needs it too');
select is(pg_temp.code('a_sales', pg_temp.approve_sql((select q4 from qids))), '42501', 'G7 Sales at aal1 gets 42501, not SM306 (no oracle on the factor)');
select tests.as_aal('aal2');
select is(pg_temp.code('a_admin', pg_temp.approve_sql((select q4 from qids), repeat('0', 64))), 'SM216', 'G8 a recomputed hash that is not the quote''s: SM216');
select is(pg_temp.code('a_admin', pg_temp.approve_sql((select q4 from qids), 'nothex')), '22023', 'G9 a malformed hash: invalid');
select is(pg_temp.j(pg_temp.sc('a_admin', pg_temp.approve_sql((select q4 from qids))), 'status'), 'approved', 'G10 an Admin approves an unflagged draft');
select is((select approved_by::text || '|' || (approved_hash = canonical_hash)::text from public.quotes where id = (select q4 from qids)), tests.uid('a_admin')::text || '|true', 'G11 who approved, and the hash their recomputation produced');
select is(pg_temp.j(pg_temp.sc('a_admin', pg_temp.approve_sql((select q4 from qids))), 'replayed'), 'true', 'G12 an exact retry replays');
select is(pg_temp.code('a_owner', pg_temp.approve_sql((select q4 from qids))), 'SM214', 'G13 another approval of an approved quote: not a draft (SM214)');
select is(pg_temp.err('a_admin', pg_temp.approve_sql((select q3 from qids))), 'SM218|quote needs owner approval||||', 'G14 an Admin cannot approve a flagged quote: SM218');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.approve_sql((select q3 from qids))), 'status'), 'approved', 'G15 the Owner approves it');
-- a new draft of R1 after its approval: approving it supersedes the approved one
select is(pg_temp.j(pg_temp.create_quote('a_sales', (select q5 from qids), 'en1', 'new', 'TS'), 'quote_no'), '5', 'G16 a new draft of an approved requirement is allowed');
select is((select status::text from public.quotes where id = (select q4 from qids)), 'approved', 'G17 the approved quote stays approved while the new draft waits');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.approve_sql((select q5 from qids))), 'status'), 'approved', 'G18 approving the new draft...');
select is((select string_agg(quote_no || ':' || status::text, ',' order by quote_no) from public.quotes where requirement_id = pg_temp.req('en1')), '1:superseded,4:superseded,5:approved', 'G19 ...supersedes the earlier approval: one approved quote per requirement');
-- stale: a pick changed after the draft was made
select pg_temp.pick('a_sales', 'en5', 1, 'SYN-BN-RED-01', 6);
select is(pg_temp.j(pg_temp.create_quote('a_sales', (select q6 from qids), 'en5'), 'status'), 'draft', 'G20 a draft of R5');
select pg_temp.pick('a_sales', 'en5', 1, 'SYN-BN-GOLD-01', 6);
select is(pg_temp.err('a_owner', pg_temp.approve_sql((select q6 from qids))), 'SM215|quote is stale||||', 'G21 a pick changed after the draft: the draft is stale (SM215)');
select pg_temp.pick('a_sales', 'en5', 1, 'SYN-BN-RED-01', 6);
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.approve_sql((select q6 from qids))), 'status'), 'approved', 'G22 with the pick restored the same draft approves (the recomputation is the quote)');
-- expired: the clock moves past valid_until (a transaction-local mock of today, like pgTAP 49 does for the cost cap's day)
select pg_temp.pick('a_sales', 'en6', 1, 'SYN-KJ-BLUE-01', 10);
select is(pg_temp.j(pg_temp.create_quote('a_sales', (select q7 from qids), 'en6'), 'status'), 'draft', 'G23 a draft of R6');
create or replace function app.quote_today() returns date language sql stable set search_path = '' as $$ select date '2099-01-01' $$;
select is(pg_temp.err('a_owner', pg_temp.approve_sql((select q7 from qids))), 'SM215|quote is stale||||', 'G24 a quote past its validity date cannot be approved (SM215)');
create or replace function app.quote_today() returns date language sql stable set search_path = '' as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- (G25) the approval itself re-checks the requirement: a requirement discarded behind the function's back (a privileged update) blocks it
select is(pg_temp.j(pg_temp.create_quote('a_sales', (select a1 from rids2), 'en5'), 'status'), 'draft', 'G25 a draft of R5');
select is(pg_temp.priv(format('update public.requirements set status = ''discarded'', confirmed_by = null, confirmed_at = null where id = %L', pg_temp.req('en5'))), 'ok', '(a privileged discard, past the SM212 block)');
select is(pg_temp.err('a_owner', pg_temp.approve_sql((select a1 from rids2))), 'SM213|requirement is not confirmed||||', 'G26 a quote whose requirement is no longer confirmed cannot be approved (SM213)');

-- ============================================================================ H. rejection and withdrawal
create temp table rids as select gen_random_uuid() as a1, gen_random_uuid() as a2, gen_random_uuid() as a3;
select is(pg_temp.j(pg_temp.create_quote('a_admin', (select a1 from rids), 'en4'), 'status'), 'draft', 'H1 an Admin creates a draft of R4 (the set-priced product; a person converted the quantity)');
select is((select qty || ':' || sale_unit::text from public.quote_lines where quote_id = (select a1 from rids)), '4:set', 'H2 the line is in the product''s unit (4 sets)');
select is(pg_temp.code('a_viewer', format('select public.reject_quote(%L, ''other'')', (select q7 from qids))), '42501', 'H3 a Viewer cannot reject');
select is(pg_temp.code('b_owner', format('select public.reject_quote(%L, ''other'')', (select q7 from qids))), '42501', 'H4 another tenant''s Owner cannot');
select is(pg_temp.err('b_owner', format('select public.reject_quote(%L, ''other'')', (select q7 from qids))), pg_temp.err('b_owner', format('select public.reject_quote(%L, ''other'')', gen_random_uuid())), 'H5 a foreign quote and an unknown one: the identical refusal');
select is(pg_temp.code('a_sales', format('select public.reject_quote(%L, ''wrong_prices'')', (select q7 from qids))), '42501', 'H6 Sales may not reject (only withdraw their OWN draft)');
select is(pg_temp.code('a_sales', format('select public.reject_quote(%L, ''withdrawn'')', (select a1 from rids))), '42501', 'H7 Sales may not withdraw a draft someone else created');
select is(pg_temp.code('a_owner', format('select public.reject_quote(%L, ''nonsense'')', (select q7 from qids))), '22023', 'H8 a reject code that is not in the list: invalid');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.reject_quote(%L, ''wrong_prices'')', (select q7 from qids))), 'status'), 'rejected', 'H9 an Owner rejects a draft with a code');
select is((select reject_code::text || '|' || rejected_by::text from public.quotes where id = (select q7 from qids)), 'wrong_prices|' || tests.uid('a_owner')::text, 'H10 who rejected, and why');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.reject_quote(%L, ''wrong_prices'')', (select q7 from qids))), 'replayed'), 'true', 'H11 an exact retry replays');
select is(pg_temp.code('a_owner', format('select public.reject_quote(%L, ''duplicate'')', (select q7 from qids))), 'SM214', 'H12 rejecting a rejected quote with another code: not a draft (SM214)');
select is(pg_temp.code('a_admin', format('select public.reject_quote(%L, ''other'')', (select q4 from qids))), 'SM214', 'H13 an approved quote cannot be rejected (SM214)');
select is(pg_temp.j(pg_temp.create_quote('a_sales', (select a2 from rids), 'en6'), 'status'), 'draft', 'H14 Sales creates a draft of R6 (after the rejection)');
select is(pg_temp.j(pg_temp.sc('a_sales', format('select public.reject_quote(%L, ''withdrawn'')', (select a2 from rids))), 'status'), 'rejected', 'H15 Sales withdraws their own draft');
select is((select reject_code::text from public.quotes where id = (select a2 from rids)), 'withdrawn', 'H16 recorded as a withdrawal');
select is(pg_temp.j(pg_temp.create_quote('a_sales', (select a3 from rids), 'en6'), 'status'), 'draft', 'H17 a rejected draft does not block a new one');

-- ============================================================================ I. immutability (for every role, the migration owner included)
select is(pg_temp.priv(format('update public.quotes set total_paise = 1 where id = %L', (select q4 from qids))), '42501|quotes rows are immutable: record a new quote', 'I1 a quote''s figures cannot be changed');
select is(pg_temp.priv(format('update public.quotes set request_text = ''{}'' where id = %L', (select q4 from qids))), '42501|quotes rows are immutable: record a new quote', 'I2 a quote''s request cannot be changed');
select is(pg_temp.priv(format('update public.quotes set status = ''approved'', approved_by = %L, approved_at = now(), approved_hash = repeat(''1'', 64) where id = %L', tests.uid('a_owner'), (select q7 from qids))), '42501|a quote cannot move from rejected to approved', 'I3 a rejected quote cannot be approved');
select is(pg_temp.priv(format('update public.quotes set status = ''draft'' where id = %L', (select q5 from qids))), '42501|a quote cannot move from approved to draft', 'I4 an approved quote cannot go back to a draft');
select is(pg_temp.priv(format('update public.quotes set approved_by = %L where id = %L', tests.uid('a_admin'), (select q5 from qids))), '42501|a quote decision is recorded once', 'I5 who approved cannot be changed afterwards');
select is(pg_temp.priv(format('update public.quotes set rejected_by = %L where id = %L', tests.uid('a_admin'), (select q7 from qids))), '42501|a quote decision is recorded once', 'I5b who rejected cannot be changed afterwards');
select is(pg_temp.priv(format('update public.quotes set tenant_id = %L where id = %L', tests.tid('b'), (select q5 from qids))), '42501|tenant_id is immutable', 'I6 a quote cannot move to another tenant');
select is(pg_temp.priv(format('delete from public.quotes where id = %L', (select q5 from qids))), '42501|quotes rows are never deleted: record a new version', 'I7 a quote cannot be deleted');
select is(pg_temp.priv(format('delete from public.quote_lines where quote_id = %L', (select q5 from qids))), '42501|quote_lines rows are never deleted: record a new version', 'I8 a quote line cannot be deleted');
select is(pg_temp.priv(format('update public.quote_lines set qty = 1 where quote_id = %L', (select q5 from qids))), '42501|quote_lines rows are immutable: archive the row and record a new one', 'I9 a quote line cannot be changed');
select is(pg_temp.priv(format('delete from public.requirement_line_picks where requirement_id = %L', pg_temp.req('en1'))), '42501|requirement_line_picks rows are never deleted: record a new version', 'I10 a pick cannot be deleted (it is replaced by a new pick)');
select ok(pg_temp.priv(format('update public.quotes set total_paise = total_paise + 1, advance_paise = advance_paise + 1 where id = %L', (select q5 from qids))) like '42501|%', 'I11 even a consistent change of two figures is refused (content is frozen)');
select ok(pg_temp.priv(format($f$insert into public.quotes (tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, price_list_version_id, policy_version_id, engine_version, request_text, result_text, canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, merchandise_net_paise, item_tax_paise, shipping_net_paise, shipping_tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval)
        select tenant_id, 99, requirement_id, enquiry_id, lead_id, 'draft', price_list_version_id, policy_version_id, engine_version, request_text, result_text, canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, 1, 0, 0, 0, 2, 1, 1, false from public.quotes where id = %L$f$, (select q5 from qids))) like '23514|%', 'I12 the table refuses a total that is not the sum of its parts');
select ok(pg_temp.priv(format($f$insert into public.quotes (tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, price_list_version_id, policy_version_id, engine_version, request_text, result_text, canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, merchandise_net_paise, item_tax_paise, shipping_net_paise, shipping_tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval)
        select tenant_id, 98, requirement_id, enquiry_id, lead_id, 'draft', price_list_version_id, policy_version_id, engine_version, request_text, result_text, canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, 0, 0, 0, 0, 0, 0, 0, false from public.quotes where id = %L$f$, (select a3 from rids))) like '23505|%', 'I13 the table refuses a second draft of one requirement (a unique index)');
select ok(pg_temp.priv(format($f$insert into public.quotes (tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, price_list_version_id, policy_version_id, engine_version, request_text, result_text, canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, merchandise_net_paise, item_tax_paise, shipping_net_paise, shipping_tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval, approved_by, approved_at, approved_hash)
        select tenant_id, 97, requirement_id, enquiry_id, lead_id, 'approved', price_list_version_id, policy_version_id, engine_version, request_text, result_text, canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, 0, 0, 0, 0, 0, 0, 0, false, approved_by, approved_at, approved_hash from public.quotes where id = %L$f$, (select q5 from qids))) like '23505|%', 'I14 ...and a second approved quote of one requirement');

-- ============================================================================ J. visibility: a Viewer reads no price and no total
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
select is((select string_agg(t || ':' || (pg_temp.rows_seen('a_viewer', t) > 0)::text, ', ' order by t) from unnest(array['quotes', 'quote_lines', 'requirement_line_picks']) t),
          'quote_lines:false, quotes:false, requirement_line_picks:false', 'J1 a Viewer sees none of the quotes, lines or picks (owner decision 1)');
select is((select string_agg(t || ':' || (pg_temp.rows_seen('a_sales', t) > 0)::text, ', ' order by t) from unnest(array['quotes', 'quote_lines', 'requirement_line_picks']) t),
          'quote_lines:true, quotes:true, requirement_line_picks:true', 'J2 Sales reads all three');
select is((select string_agg(t || ':' || (pg_temp.rows_seen('a_admin', t) > 0)::text, ', ' order by t) from unnest(array['quotes', 'quote_lines', 'requirement_line_picks']) t),
          'quote_lines:true, quotes:true, requirement_line_picks:true', 'J3 an Admin reads all three');
select is(pg_temp.rows_seen('b_owner', 'quotes') + pg_temp.rows_seen('b_owner', 'quote_lines') + pg_temp.rows_seen('b_owner', 'requirement_line_picks'), 0::bigint, 'J4 another tenant''s Owner reads none of tenant A''s');
select is(pg_temp.rows_seen('outsider', 'quotes'), 0::bigint, 'J5 a signed-in stranger reads none');
select is(pg_temp.rows_seen('a_owner', 'quotes'), (select count(*) from public.quotes where tenant_id = tests.tid('a')), 'J6 an Owner reads exactly tenant A''s quotes');

-- ============================================================================ K. the discard block (owner decision 2: a draft AND an approved quote block it)
select is(pg_temp.err('a_sales', format('select public.discard_requirement(%L)', pg_temp.req('en1'))), 'SM212|a quote depends on this requirement||||', 'K1 a requirement with an APPROVED quote cannot be discarded (SM212)');
select is(pg_temp.err('a_sales', format('select public.discard_requirement(%L)', pg_temp.req('en4'))), 'SM212|a quote depends on this requirement||||', 'K2 a requirement with a DRAFT quote cannot be discarded either');
select is((select status::text from public.requirements where id = pg_temp.req('en4')), 'confirmed', 'K3 the refused discard changed nothing');
select is(pg_temp.code('a_viewer', format('select public.discard_requirement(%L)', pg_temp.req('en4'))), '42501', 'K4 a Viewer is still refused first (the role, not SM212)');
select is(pg_temp.err('b_owner', format('select public.discard_requirement(%L)', pg_temp.req('en4'))), pg_temp.err('b_owner', format('select public.discard_requirement(%L)', gen_random_uuid())), 'K5 a stranger learns nothing about quotes: the identical refusal');
select is(pg_temp.j(pg_temp.sc('a_admin', format('select public.reject_quote(%L, ''withdrawn'')', (select a1 from rids))), 'status'), 'rejected', 'K6 the Admin withdraws their draft of R4');
select is(pg_temp.j(pg_temp.sc('a_sales', format('select public.discard_requirement(%L)', pg_temp.req('en4'))), 'status'), 'discarded', 'K7 with no draft and no approved quote left, the requirement can be discarded');
select is(pg_temp.err('a_sales', format('select public.discard_requirement(%L)', pg_temp.req('en3'))), 'SM212|a quote depends on this requirement||||', 'K8 R3 (an approved quote) stays protected');
select is(pg_temp.code('a_sales', format('select public.discard_requirement(%L)', pg_temp.req('en6'))), 'SM212', 'K9 R6 (a live draft) stays protected');
select is((select string_agg(enquiry_id::text, ',' order by enquiry_id) from public.requirements where status = 'discarded' and tenant_id = tests.tid('a')), (select string_agg(x::text, ',' order by x) from (values (tests.rid('en4')), (tests.rid('en5'))) v(x)), 'K10 exactly R4 (by a person, after the withdrawal) and R5 (the privileged update of G25) are discarded: no other requirement was');
select is(pg_temp.j(pg_temp.sc('a_sales', format('select public.discard_requirement(%L)', (select id from public.requirements where enquiry_id = tests.rid('en4') and status = 'discarded'))), 'replayed'), 'true', 'K11 discarding it again replays');

-- ============================================================================ L. audit
select ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'quote' and actor_type = 'user' and actor_user_id = tests.uid('a_sales') and action like '%create%') >= 1, 'L1 creating a quote is audited as the person who did it');
select ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'quote' and actor_user_id = tests.uid('a_admin')) >= 1, 'L2 the Admin''s approval is audited');
select ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'requirement_line_pick' and actor_user_id = tests.uid('a_sales')) >= 1, 'L3 a pick is audited as the person who made it');
select ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'quote_line') >= 2, 'L4 quote lines are audited');

-- ============================================================================ M. a refusal before the role is proven is the same for everyone
select is(pg_temp.err('b_owner', format('select public.create_quote_draft(%L, %L, ''new'', ''TS'', ''1.1.0'', ''{}'', ''{}'')', gen_random_uuid(), pg_temp.req('en1'))),
          pg_temp.err('a_viewer', format('select public.create_quote_draft(%L, %L, ''new'', ''TS'', ''1.1.0'', ''{}'', ''{}'')', gen_random_uuid(), pg_temp.req('en1'))), 'M1 a stranger and a Viewer get the identical refusal to create a draft');
select is(pg_temp.err('a_sales', format('select public.approve_quote(%L, %L)', (select q5 from qids), repeat('a', 64))), pg_temp.err('a_viewer', format('select public.approve_quote(%L, %L)', (select q5 from qids), repeat('a', 64))), 'M2 Sales and a Viewer get the identical refusal to approve');
select is(pg_temp.err('b_owner', pg_temp.pick_sql('en1', 1, 'SYN-KJ-RED-01', 20)), pg_temp.err('a_viewer', pg_temp.pick_sql('en1', 1, 'SYN-KJ-RED-01', 20)), 'M3 a stranger and a Viewer get the identical refusal to pick');

-- ============================================================================ N. an archived enquiry, a newer price list or policy, and the policy's required inputs
-- N1: an archived enquiry takes no quote
select pg_temp.field('en7', 1, 'saree_type', 'kanjivaram');
select pg_temp.field('en7', 1, 'quantity', null, 8, null, 'piece');
select pg_temp.confirm('en7');
select pg_temp.pick('a_sales', 'en7', 1, 'SYN-KJ-RED-01', 8);
update public.enquiries set archived_at = now() where id = tests.rid('en7');
select is(pg_temp.code('a_sales', pg_temp.cq_sql(gen_random_uuid(), 'en7', 'new', 'TS', pg_temp.build(pg_temp.req('en7')) -> 'request', pg_temp.honest(pg_temp.build(pg_temp.req('en7')), pg_temp.build(pg_temp.req('en7')) -> 'request'))), '23503', 'N1 an archived enquiry takes no quote');
-- N2: a newer price list makes an open draft stale
select pg_temp.field('en8', 1, 'saree_type', 'kanjivaram');
select pg_temp.field('en8', 1, 'quantity', null, 8, null, 'piece');
select pg_temp.confirm('en8');
select pg_temp.pick('a_sales', 'en8', 1, 'SYN-KJ-RED-01', 8);
create temp table nids as select gen_random_uuid() as n1, gen_random_uuid() as n2, gen_random_uuid() as n3, gen_random_uuid() as n4;
select is(pg_temp.j(pg_temp.create_quote('a_sales', (select n1 from nids), 'en8'), 'status'), 'draft', 'N2 a draft of R8');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.create_price_list_version(%L, %L, %L, %L::jsonb)', gen_random_uuid(), tests.tid('a'), pg_temp.today(),
          jsonb_build_array(jsonb_build_object('product_id', pg_temp.prod('SYN-KJ-RED-01'), 'unit_price_paise', 410000, 'minimum_order_quantity', 4, 'tax_bps', 500, 'breaks', '[]'::jsonb), jsonb_build_object('product_id', pg_temp.prod('SYN-BN-RED-01'), 'unit_price_paise', 310000, 'minimum_order_quantity', 4, 'tax_bps', 500, 'breaks', '[]'::jsonb), jsonb_build_object('product_id', pg_temp.prod('SYN-BN-GOLD-01'), 'unit_price_paise', 310000, 'minimum_order_quantity', 4, 'tax_bps', 500, 'breaks', '[]'::jsonb), jsonb_build_object('product_id', pg_temp.prod('SYN-KJ-BLUE-01'), 'unit_price_paise', 410000, 'minimum_order_quantity', 4, 'tax_bps', 500, 'breaks', '[]'::jsonb), jsonb_build_object('product_id', pg_temp.prod('SYN-PT-GREEN-01'), 'unit_price_paise', 280000, 'minimum_order_quantity', 4, 'tax_bps', 500, 'breaks', '[]'::jsonb), jsonb_build_object('product_id', pg_temp.prod('SYN-PT-SET-01'), 'sale_unit', 'set', 'unit_price_paise', 280000, 'minimum_order_quantity', 4, 'tax_bps', 500, 'breaks', '[]'::jsonb))::text)), 'version_no'), '2', 'N3 the Owner publishes a newer price list version (effective today)');
select is(pg_temp.err('a_owner', pg_temp.approve_sql((select n1 from nids))), 'SM215|quote is stale||||', 'N4 a draft made on the OLD price list cannot be approved (SM215): re-create it');
select is(pg_temp.j(pg_temp.create_quote('a_sales', (select n2 from nids), 'en8'), 'status'), 'draft', 'N5 a new draft is made on the new price list');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.approve_sql((select n2 from nids))), 'status'), 'approved', 'N6 and it approves');
select is((select 410000 * 8 = merchandise_net_paise from public.quotes where id = (select n2 from nids)), true, 'N7 the new draft uses the new price (8 x 4,100.00)');
-- N7b: a price list that changes a product's unit after the pick (the pick said 'set'; the newer list sells it by the piece)
select pg_temp.field('en15', 1, 'saree_type', 'paithani');
select pg_temp.field('en15', 1, 'quantity', null, 12, null, 'piece');
select pg_temp.confirm('en15');
select is(pg_temp.j(pg_temp.pick('a_sales', 'en15', 1, 'SYN-PT-SET-01', 4, 'set'), 'replayed'), 'false', 'N7b a person picks the set-priced product for R15 (4 sets)');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.create_price_list_version(%L, %L, %L, %L::jsonb)', gen_random_uuid(), tests.tid('a'), pg_temp.today(),
          (select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'sale_unit', case when i.sku = 'SYN-PT-SET-01' then 'piece' else i.sale_unit::text end, 'unit_price_paise', i.unit_price_paise, 'minimum_order_quantity', i.minimum_order_quantity, 'tax_bps', i.tax_bps, 'breaks', '[]'::jsonb))
             from public.price_list_items i where i.version_id = app.quote_active_price_version(tests.tid('a'), pg_temp.today()))::text)), 'version_no'), '3', 'N7c the newest price list sells that product by the PIECE');
select is(pg_temp.err('a_sales', pg_temp.cq_sql(gen_random_uuid(), 'en15', 'new', 'TS', jsonb_build_object('as_of', pg_temp.today()::text), '{}'::jsonb)), 'SM217|quote input missing||||', 'N7d the pick (a unit the list no longer sells) cannot be quoted: SM217; a person picks again');
-- N8: a newer POLICY version makes an open draft stale too
select pg_temp.field('en9', 1, 'saree_type', 'banarasi');
select pg_temp.field('en9', 1, 'quantity', null, 6, null, 'piece');
select pg_temp.confirm('en9');
select pg_temp.pick('a_sales', 'en9', 1, 'SYN-BN-RED-01', 6);
select is(pg_temp.j(pg_temp.create_quote('a_sales', (select n3 from nids), 'en9'), 'status'), 'draft', 'N8 a draft of R9');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.create_quote_policy_version(%L, %L, %L, %L::jsonb)', gen_random_uuid(), tests.tid('a'), pg_temp.today(),
          '{"discount_ceiling_bps": 0, "shipping_flat_fee_paise": 0, "shipping_tax_bps": 0, "validity_days": 20, "new_advance_bps": 5000, "repeat_advance_bps": 2500, "net_days": 30, "seller_state": "TS", "required_inputs": ["delivery_state", "delivery_city", "payment_terms", "deadline"]}')), 'version_no'), '2', 'N9 the Owner publishes a newer policy (it requires the city, the payment terms and a deadline too)');
select is(pg_temp.err('a_owner', pg_temp.approve_sql((select n3 from nids))), 'SM215|quote is stale||||', 'N10 a draft made under the OLD policy cannot be approved (SM215)');
-- N11a / N11b: each optional required input on its own
select pg_temp.field('en13', 1, 'saree_type', 'kanjivaram');
select pg_temp.field('en13', 1, 'quantity', null, 8, null, 'piece');
select pg_temp.field('en13', null, 'payment_terms', 'net_days', 30, null, 'days');
select pg_temp.field('en13', null, 'deadline', null, null, null, null, current_date + 30);
select pg_temp.confirm('en13');
select pg_temp.pick('a_sales', 'en13', 1, 'SYN-KJ-RED-01', 8);
select is(pg_temp.err('a_sales', pg_temp.cq_sql(gen_random_uuid(), 'en13', 'new', 'TS', pg_temp.build(pg_temp.req('en13')) -> 'request', pg_temp.honest(pg_temp.build(pg_temp.req('en13')), pg_temp.build(pg_temp.req('en13')) -> 'request'))), 'SM217|quote input missing||||', 'N11a the policy requires the delivery CITY: payment terms and a deadline are there, the city is not: SM217');
select pg_temp.field('en14', 1, 'saree_type', 'kanjivaram');
select pg_temp.field('en14', 1, 'quantity', null, 8, null, 'piece');
select pg_temp.field('en14', null, 'delivery_city', null, null, 'Pune');
select pg_temp.field('en14', null, 'deadline', null, null, null, null, current_date + 30);
select pg_temp.confirm('en14');
select pg_temp.pick('a_sales', 'en14', 1, 'SYN-KJ-RED-01', 8);
select is(pg_temp.err('a_sales', pg_temp.cq_sql(gen_random_uuid(), 'en14', 'new', 'TS', pg_temp.build(pg_temp.req('en14')) -> 'request', pg_temp.honest(pg_temp.build(pg_temp.req('en14')), pg_temp.build(pg_temp.req('en14')) -> 'request'))), 'SM217|quote input missing||||', 'N11b the policy requires the PAYMENT TERMS: the city and the deadline are there, the terms are not: SM217');
-- N11: the policy's required inputs: the city, the payment terms and the deadline
select pg_temp.field('en10', 1, 'saree_type', 'kanjivaram');
select pg_temp.field('en10', 1, 'quantity', null, 8, null, 'piece');
select pg_temp.field('en10', null, 'delivery_city', null, null, 'Pune');
select pg_temp.confirm('en10');
select pg_temp.pick('a_sales', 'en10', 1, 'SYN-KJ-RED-01', 8);
select is(pg_temp.err('a_sales', pg_temp.cq_sql(gen_random_uuid(), 'en10', 'new', 'TS', pg_temp.build(pg_temp.req('en10')) -> 'request', pg_temp.honest(pg_temp.build(pg_temp.req('en10')), pg_temp.build(pg_temp.req('en10')) -> 'request'))), 'SM217|quote input missing||||', 'N11 the policy requires payment terms and a deadline: a requirement without them cannot be quoted (SM217)');
select pg_temp.field('en11', 1, 'saree_type', 'kanjivaram');
select pg_temp.field('en11', 1, 'quantity', null, 8, null, 'piece');
select pg_temp.field('en11', null, 'delivery_city', null, null, 'Pune');
select pg_temp.field('en11', null, 'payment_terms', 'net_days', 30, null, 'days');
select pg_temp.confirm('en11');
select pg_temp.pick('a_sales', 'en11', 1, 'SYN-KJ-RED-01', 8);
select is(pg_temp.code('a_sales', pg_temp.cq_sql(gen_random_uuid(), 'en11', 'new', 'TS', pg_temp.build(pg_temp.req('en11')) -> 'request', pg_temp.honest(pg_temp.build(pg_temp.req('en11')), pg_temp.build(pg_temp.req('en11')) -> 'request'))), 'SM217', 'N12 ...and the deadline is still missing: SM217');
select pg_temp.field('en12', 1, 'saree_type', 'kanjivaram');
select pg_temp.field('en12', 1, 'quantity', null, 8, null, 'piece');
select pg_temp.field('en12', null, 'delivery_city', null, null, 'Pune');
select pg_temp.field('en12', null, 'payment_terms', 'net_days', 30, null, 'days');
select pg_temp.field('en12', null, 'deadline', null, null, null, null, current_date + 30);
select pg_temp.confirm('en12');
select pg_temp.pick('a_sales', 'en12', 1, 'SYN-KJ-RED-01', 8);
select is(pg_temp.err('a_sales', pg_temp.cq_sql(gen_random_uuid(), 'en12', 'new', 'TS', pg_temp.build(pg_temp.req('en12')) -> 'request', pg_temp.honest(pg_temp.build(pg_temp.req('en12')), pg_temp.build(pg_temp.req('en12')) -> 'request'))) , 'ok', 'N13 with the city, the payment terms and the deadline present the same quote is accepted');
select is((select review_flags::text from public.quotes where requirement_id = pg_temp.req('en12') and status = 'draft'), '{TERMS_REQUESTED_BY_CUSTOMER}', 'N14 stated payment terms raise the review flag (the Owner decides)');

select * from finish();
rollback;
