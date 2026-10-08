-- Manual-price quote, slice 1 (migration 20261029090000): the policy foundation.
--   A net days per customer kind    B GST (rate, date, per-line rounding)    C item types and their optional price range
--   D delivery_state (settled in slice 1: what a manual-price quote can and cannot skip)
-- SYNTHETIC numbers only. Every rate below is a placeholder, not the accountant's.
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

-- the policy payload (SYNTHETIC) and the call that publishes it
create function pg_temp.policy(p_over jsonb default '{}'::jsonb) returns jsonb language sql as $$
  select jsonb_build_object('discount_ceiling_bps', 0, 'shipping_flat_fee_paise', 0, 'validity_days', 15, 'new_advance_bps', 5000, 'repeat_advance_bps', 2500,
                            'new_net_days', 10, 'repeat_net_days', 45, 'gst_rate_bps', 500, 'seller_state', 'TS', 'repeat_credit_limit_paise', 1000000000) || p_over $$;
create function pg_temp.qp_sql(p_id uuid, p_tenant text, p_policy jsonb, p_eff date default null) returns text language sql as $$
  select format('select public.create_quote_policy_version(%L, %L, %L, %L::jsonb)', p_id, tests.tid(p_tenant), coalesce(p_eff, pg_temp.today()), p_policy::text) $$;
create function pg_temp.qp(p_user text, p_policy jsonb, p_id uuid default gen_random_uuid(), p_tenant text default 'a', p_eff date default null) returns text language sql as $$
  select pg_temp.code(p_user, pg_temp.qp_sql(p_id, p_tenant, p_policy, p_eff)) $$;
create function pg_temp.published(p_policy jsonb) returns uuid language plpgsql as $$
declare v_id uuid := gen_random_uuid(); r text;
begin
  r := pg_temp.sc('a_owner', pg_temp.qp_sql(v_id, 'a', p_policy));
  if (r::jsonb ->> 'version_id') is distinct from v_id::text then raise exception 'policy not published: %', r; end if;
  return v_id;
end $$;

-- ============================================================================ A. net days per customer kind
select is((select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'quote_policy_versions' and column_name = 'net_days'), 0::bigint,
          'A1 the single net_days column is gone');
select is((select string_agg(column_name || ':' || data_type || ':' || is_nullable, ',' order by column_name) from information_schema.columns
            where table_schema = 'public' and table_name = 'quote_policy_versions' and column_name in ('new_net_days', 'repeat_net_days')),
          'new_net_days:integer:NO,repeat_net_days:integer:NO', 'A2 new_net_days and repeat_net_days are integers and required');
select is((select count(*) from public.quote_policy_versions where tenant_id = tests.tid('a')), 1::bigint, 'A3 control: the seed made one policy version for tenant A (30 and 30 days)');
select is((select new_net_days || '|' || repeat_net_days from public.quote_policy_versions where tenant_id = tests.tid('a')), '30|30', 'A4 the seed carries 30 days for both kinds (exactly what the single field said)');

-- the backfill never touches the immutability trigger: it is still there, still enabled, still refusing an UPDATE
select is((select tgenabled::text from pg_trigger where tgrelid = 'public.quote_policy_versions'::regclass and tgname = 'quote_policy_versions_guard_immutable'), 'O',
          'A5 the immutability trigger on the policy table is intact and enabled');
select is(pg_temp.priv(format('update public.quote_policy_versions set new_net_days = 1 where tenant_id = %L', tests.tid('a'))),
          '42501|quote_policy_versions rows are immutable: archive the row and record a new one', 'A6 a policy row still cannot be updated (the new column included)');
-- the migration's backfill technique (a stored generated copy, then DROP EXPRESSION) keeps the stored values and fires no row trigger; proved here on the real table with the trigger enabled
alter table public.quote_policy_versions add column zz_probe integer generated always as (repeat_net_days) stored;
alter table public.quote_policy_versions alter column zz_probe drop expression;
select is((select count(*) from public.quote_policy_versions where zz_probe is distinct from repeat_net_days), 0::bigint, 'A7 DROP EXPRESSION kept every stored value, with the immutability trigger enabled (the migration''s backfill technique)');
alter table public.quote_policy_versions drop column zz_probe;

select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.qp_sql(gen_random_uuid(), 'a', pg_temp.policy())), 'version_no'), '2', 'A8 an Owner publishes a policy with 10 days for new and 45 for repeat customers');
select is((select new_net_days || '|' || repeat_net_days from public.quote_policy_versions where tenant_id = tests.tid('a') and version_no = 2), '10|45', 'A9 both values are stored as typed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"net_days": 30}')), '22023', 'A10 the old net_days key is no longer accepted');
select is(pg_temp.qp('a_owner', pg_temp.policy() - 'new_net_days'), '22023', 'A11 new_net_days is required');
select is(pg_temp.qp('a_owner', pg_temp.policy() - 'repeat_net_days'), '22023', 'A12 repeat_net_days is required');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"new_net_days": 181}')), '23514', 'A13 new net days above 180: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"repeat_net_days": 181}')), '23514', 'A14 repeat net days above 180: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"new_net_days": -1}')), '22023', 'A15 a negative number of days: invalid');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"repeat_net_days": 1.5}')), '22023', 'A16 a fractional number of days: invalid');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"new_net_days": "10"}')), '22023', 'A17 a string where an integer belongs: invalid');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"new_net_days": 0, "repeat_net_days": 180}')), 'ok', 'A18 the bounds 0 and 180 are allowed');
select is(pg_temp.qp('a_sales', pg_temp.policy()), '42501', 'A19 Sales cannot publish');
select is(pg_temp.qp('b_owner', pg_temp.policy()), '42501', 'A20 another tenant''s Owner cannot publish into tenant A');

-- the due date follows the customer kind: a real requirement, a pick, then the database's own build and a full draft + approval for each kind
insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body)
select tests.rid(n), tests.tid('a'), tests.rid('a_lead'), 'email', now() - interval '1 hour', 'Synthetic enquiry ' || n from unnest(array['n1', 'n2']) n;
create function pg_temp.field(p_enq text, p_line int, p_key text, p_code text default null, p_int bigint default null, p_basis text default null) returns text language sql as $$
  select pg_temp.sc('a_owner', format('select public.add_requirement_field(%L, %L::smallint, %L, %L, %L::bigint, null, null, %L)', tests.rid(p_enq), p_line, p_key, p_code, p_int, p_basis)) $$;
create function pg_temp.req(p_enq text) returns uuid language sql as $$ select id from public.requirements where enquiry_id = tests.rid(p_enq) and status in ('draft', 'confirmed') $$;
create function pg_temp.confirm(p_enq text) returns text language sql as $$ select pg_temp.sc('a_owner', format('select public.confirm_requirement(%L)', pg_temp.req(p_enq))) $$;
create function pg_temp.pick(p_enq text, p_line int, p_sku text, p_qty int) returns text language sql as $$
  select pg_temp.sc('a_sales', format('select public.pick_requirement_line_product(%L, %L::smallint, %L, %L::integer, ''piece'', ''manual'', null)', pg_temp.req(p_enq), p_line, pg_temp.prod(p_sku), p_qty)) $$;
create function pg_temp.build(p_req uuid, p_kind text) returns jsonb language sql as $$
  select app.quote_build(tests.tid('a'), p_req, pg_temp.today(), p_kind, app.quote_active_price_version(tests.tid('a'), pg_temp.today()), app.quote_active_policy_version(tests.tid('a'), pg_temp.today())) $$;
create function pg_temp.honest(p_build jsonb, p_request jsonb) returns jsonb language sql as $$
  select (p_build -> 'core') || jsonb_build_object('status', 'draft', 'engine_version', '1.1.0', 'canonical_hash', app.quote_request_hash('1.1.0', p_request::text), 'trace', '[]'::jsonb,
           'flags', jsonb_build_object('needs_owner_approval', jsonb_array_length(p_build -> 'flags') > 0,
                                       'reasons', (select coalesce(jsonb_agg(jsonb_build_object('code', c)), '[]'::jsonb) from jsonb_array_elements_text(p_build -> 'flags') c))) $$;
create function pg_temp.create_quote_sql(p_id uuid, p_enq text, p_kind text, p_state text default 'TG') returns text language sql as $$
  select format('select public.create_quote_draft(%L, %L, %L, %L, ''1.1.0'', %L, %L)', p_id, pg_temp.req(p_enq), p_kind, p_state,
         (pg_temp.build(pg_temp.req(p_enq), p_kind) -> 'request')::text, pg_temp.honest(pg_temp.build(pg_temp.req(p_enq), p_kind), pg_temp.build(pg_temp.req(p_enq), p_kind) -> 'request')::text) $$;
create function pg_temp.approve_sql(p_quote uuid) returns text language sql as $$
  select format('select public.approve_quote(%L, %L)', p_quote, (select canonical_hash from public.quotes where id = p_quote)) $$;
create temp table qids as select gen_random_uuid() as q_new, gen_random_uuid() as q_rep;

-- the policy in force from here: 10 days (new) and 45 days (repeat); a large repeat credit limit so no engine flag appears
select pg_temp.field('n1', 1, 'saree_type', 'kanjivaram');  select pg_temp.field('n1', 1, 'quantity', null, 12, 'piece');
select pg_temp.confirm('n1');
select pg_temp.pick('n1', 1, 'SYN-KJ-RED-01', 12);
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.qp_sql(gen_random_uuid(), 'a', pg_temp.policy('{"new_net_days": 12, "repeat_net_days": 47}'))), 'version_no'), '4',
          'A21 the policy in force for the due-date checks: 12 days for new, 47 for repeat');
select is(pg_temp.build(pg_temp.req('n1'), 'new') -> 'request' -> 'policy' -> 'payment_terms' ->> 'net_days', '12', 'A22 the request for a NEW customer carries the new-customer days');
select is(pg_temp.build(pg_temp.req('n1'), 'repeat') -> 'request' -> 'policy' -> 'payment_terms' ->> 'net_days', '47', 'A23 the request for a REPEAT customer carries the repeat-customer days');
select is(pg_temp.build(pg_temp.req('n1'), 'new') ->> 'due_date', (pg_temp.today() + 12)::text, 'A24 the balance falls due on the quote date plus 12 days (new)');
select is(pg_temp.build(pg_temp.req('n1'), 'repeat') ->> 'due_date', (pg_temp.today() + 47)::text, 'A25 ...and plus 47 days (repeat)');
select is(pg_temp.build(pg_temp.req('n1'), 'new') -> 'core' -> 'payment_terms' ->> 'due_date', (pg_temp.today() + 12)::text, 'A26 the engine-side figure the database compares against is the same date');
select is(pg_temp.j(pg_temp.sc('a_sales', pg_temp.create_quote_sql((select q_new from qids), 'n1', 'new')), 'status'), 'draft', 'A27 a draft for a new customer is accepted (the request equals the database''s byte for byte)');
select is((select due_date - as_of from public.quotes where id = (select q_new from qids)), 12, 'A28 the stored due date is 12 days after the quote date');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.approve_sql((select q_new from qids))), 'status'), 'approved', 'A29 the approval''s rebuild reproduces it');
-- a requirement of its own for the repeat customer
select pg_temp.field('n2', 1, 'saree_type', 'kanjivaram');  select pg_temp.field('n2', 1, 'quantity', null, 12, 'piece');
select pg_temp.confirm('n2');
select pg_temp.pick('n2', 1, 'SYN-KJ-RED-01', 12);
select is(pg_temp.j(pg_temp.sc('a_sales', pg_temp.create_quote_sql((select q_rep from qids), 'n2', 'repeat')), 'status'), 'draft', 'A31 a draft for a repeat customer is accepted');
select is((select due_date - as_of from public.quotes where id = (select q_rep from qids)), 47, 'A32 the stored due date is 47 days after the quote date');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.approve_sql((select q_rep from qids))), 'status'), 'approved', 'A33 the Owner approves it (a repeat customer is the Owner''s call) and the rebuild reproduces it');
select is((select request_text::jsonb -> 'policy' -> 'payment_terms' ->> 'net_days' from public.quotes where id = (select q_rep from qids)), '47', 'A34 the stored request says 47');
-- a request built with the OTHER kind's days is not the database's own: refused
select is(pg_temp.code('a_sales', replace(pg_temp.create_quote_sql(gen_random_uuid(), 'n2', 'repeat'), '"net_days": 47', '"net_days": 12')), 'SM216', 'A35 a repeat request carrying the new-customer days is refused (SM216)');

-- ============================================================================ B. GST
select is((select gst_rate_bps || '|' || gst_effective_from::text || '|' || shipping_tax_bps from public.quote_policy_versions where tenant_id = tests.tid('a') and version_no = 2),
          '500|' || pg_temp.today()::text || '|500', 'B1 a rate of 5 % (500 bps) sent explicitly, from the version''s own date when none is given, and the shipping tax follows the goods rate (slice 2: the rate itself is required, pgTAP 68)');
select is((select count(*) from public.quote_policy_versions where tenant_id = tests.tid('a') and version_no = 1 and gst_rate_bps = 500 and gst_effective_from = effective_from and shipping_tax_bps = 0), 1::bigint,
          'B2 the seeded (older) version got the default rate and its own date; its stored shipping tax of 0 is untouched');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.qp_sql(gen_random_uuid(), 'a', pg_temp.policy('{"shipping_tax_bps": 0}'))), 'version_no'), '5', 'B3 a caller that still sends shipping_tax_bps keeps it (list-price quotes)');
select is((select shipping_tax_bps from public.quote_policy_versions where tenant_id = tests.tid('a') and version_no = 5), 0, 'B4 ...as typed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"gst_rate_bps": 0}')), 'ok', 'B5 a 0 % rate is allowed (zero-rated)');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"gst_rate_bps": 2800}')), 'ok', 'B6 28 % (2800 bps) is allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"gst_rate_bps": 2801}')), '23514', 'B7 above 28 %: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"gst_rate_bps": -1}')), '22023', 'B8 a negative rate: invalid');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"gst_rate_bps": 5.5}')), '22023', 'B9 a fractional rate: invalid (no floats)');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"gst_rate_bps": "500"}')), '22023', 'B10 a string rate: invalid');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"gst_effective_from": "2026-12-31"}')), 'ok', 'B11 a real date is accepted');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"gst_effective_from": "2026-02-30"}')), '23514', 'B12 a date that does not exist (30 February): not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"gst_effective_from": "2026-13-01"}')), '23514', 'B13 month 13: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"gst_effective_from": "2026-2-3"}')), '23514', 'B14 a date not written YYYY-MM-DD: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"gst_effective_from": "01/10/2026"}')), '23514', 'B15 a day-first date: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"gst_effective_from": "1999-12-31"}')), '23514', 'B16 a date before 2000: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"gst_effective_from": 20261001}')), '22023', 'B17 a number where a date belongs: invalid');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"gst_effective_from": "not-a-date"}')), '23514', 'B18 text of the right length that is not a date: not allowed');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"tax_rate": 500}')), '22023', 'B19 an unknown key is still refused');
-- replay and conflict: the GST fields are part of the version''s identity
create temp table gids as select gen_random_uuid() as g1;
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.qp_sql((select g1 from gids), 'a', pg_temp.policy('{"gst_rate_bps": 1200}'))), 'replayed'), 'false', 'B20 a version with a 12 % rate (SYNTHETIC) is published');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.qp_sql((select g1 from gids), 'a', pg_temp.policy('{"gst_rate_bps": 1200}'))), 'replayed'), 'true', 'B21 an exact retry replays');
select is(pg_temp.code('a_owner', pg_temp.qp_sql((select g1 from gids), 'a', pg_temp.policy('{"gst_rate_bps": 1800}'))), '23505', 'B22 the same id with another rate: the constant conflict');
select isnt((select content_sha256 from public.quote_policy_versions where id = (select g1 from gids)),
            (select content_sha256 from public.quote_policy_versions where tenant_id = tests.tid('a') and version_no = 2), 'B23 two policies that differ only in the rate have different content hashes');
-- an edit is impossible; a rate change is a new version
select is(pg_temp.priv(format('update public.quote_policy_versions set gst_rate_bps = 1800 where id = %L', (select g1 from gids))),
          '42501|quote_policy_versions rows are immutable: archive the row and record a new one', 'B24 the rate of a published version cannot be edited');
-- the rate in force on the quote date: one version, its date
create temp table fids as select gen_random_uuid() as f1;
select pg_temp.sc('a_owner', pg_temp.qp_sql((select f1 from fids), 'a', pg_temp.policy(('{"gst_rate_bps": 1200, "gst_effective_from": "' || (pg_temp.today() + 5)::text || '"}')::jsonb)));
select is(app.quote_gst_bps_on(tests.tid('a'), (select f1 from fids), pg_temp.today()), null, 'B25 before its date the version has no rate in force (the caller refuses; nothing is guessed)');
select is(app.quote_gst_bps_on(tests.tid('a'), (select f1 from fids), pg_temp.today() + 4), null, 'B26 the day before: still none');
select is(app.quote_gst_bps_on(tests.tid('a'), (select f1 from fids), pg_temp.today() + 5), 1200, 'B27 on its date the rate is in force');
select is(app.quote_gst_bps_on(tests.tid('a'), (select f1 from fids), pg_temp.today() + 400), 1200, 'B28 and after it');
select is(app.quote_gst_bps_on(tests.tid('b'), (select f1 from fids), pg_temp.today() + 5), null, 'B29 another tenant''s id gets nothing (the lookup is by tenant AND version)');
-- tax is rounded per line to the paisa, half up, in integer minor units
select is(app.quote_gst_paise(1050, 500), 53::bigint, 'B30 5 % of 1050 paise is 52.5: half up gives 53');
select is(app.quote_gst_paise(1049, 500), 52::bigint, 'B31 5 % of 1049 paise is 52.45: gives 52');
select is(app.quote_gst_paise(10, 500), 1::bigint, 'B32 5 % of 10 paise is exactly 0.5: half up gives 1');
select is(app.quote_gst_paise(9, 500), 0::bigint, 'B33 5 % of 9 paise is 0.45: gives 0');
select is(app.quote_gst_paise(0, 500), 0::bigint, 'B34 nothing to tax');
select is(app.quote_gst_paise(100000000, 2800), 28000000::bigint, 'B35 the largest price at the largest rate is exact');
select is(app.quote_gst_paise(250000, 0), 0::bigint, 'B36 a 0 % rate');
select is(pg_temp.priv('select app.quote_gst_paise(-1, 500)'), '22023|invalid argument', 'B37 a negative amount is refused');
select is(pg_temp.priv('select app.quote_gst_paise(100, 2801)'), '22023|invalid argument', 'B38 a rate above the bound is refused');
select is((select prorettype::regtype::text || '|' || pg_get_function_identity_arguments(oid) from pg_proc where oid = 'app.quote_gst_paise(bigint,integer)'::regprocedure), 'bigint|p_net_paise bigint, p_bps integer', 'B39 integer minor units in and out: no floating-point type in the signature');
-- the rate used is stored on each line (already true for list lines; a manual line stores the same column)
select is((select is_nullable || ':' || data_type from information_schema.columns where table_schema = 'public' and table_name = 'quote_lines' and column_name = 'tax_bps'), 'NO:integer', 'B40 every quote line stores the rate used, as an integer, and it is required');
select is((select string_agg(tax_bps::text, ',') from public.quote_lines where quote_id = (select q_new from qids)), '500', 'B41 the line of the approved quote above stored its own rate (the price-list item''s, unchanged)');
select is((select count(*) from public.quote_lines l join public.quotes q on q.id = l.quote_id where q.id = (select q_new from qids) and l.tax_bps <> 500), 0::bigint, 'B42 a policy rate (12 %) published later changed no existing quote line');
select is(pg_temp.priv(format('update public.quote_lines set tax_bps = 1200 where quote_id = %L', (select q_new from qids))) like '42501|%', true, 'B43 and a quote line cannot be edited');

-- ============================================================================ C. item types and their optional price range
select ok(not has_function_privilege('anon', 'public.save_item_type(uuid,text,text,integer,boolean,bigint,bigint)', 'execute')
      and has_function_privilege('authenticated', 'public.save_item_type(uuid,text,text,integer,boolean,bigint,bigint)', 'execute'), 'C1 anon cannot call save_item_type; the role and the second factor are proven inside');
select ok(not has_any_column_privilege('authenticated', 'public.item_types', 'INSERT') and not has_any_column_privilege('authenticated', 'public.item_types', 'UPDATE')
      and not has_table_privilege('authenticated', 'public.item_types', 'DELETE') and not has_table_privilege('authenticated', 'public.item_types', 'TRUNCATE')
      and has_table_privilege('authenticated', 'public.item_types', 'SELECT') and not has_table_privilege('anon', 'public.item_types', 'SELECT'), 'C2 a client can only SELECT item_types; anon nothing');
select ok((select relrowsecurity and relforcerowsecurity from pg_class where oid = 'public.item_types'::regclass), 'C3 row level security is enabled and forced');
create function pg_temp.save_sql(p_tenant text, p_code text, p_name text default 'Item type X', p_pos int default 1, p_active text default 'true', p_min text default 'null', p_max text default 'null') returns text language sql as $$
  select format('select public.save_item_type(%L, %L, %L, %L, %s, %s, %s)', tests.tid(p_tenant), p_code, p_name, p_pos, p_active, p_min, p_max) $$;
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.save_sql('a', '01', 'Item type one', 1, 'true', '150000', '1000000')), 'created'), 'true', 'C5 an Owner creates an item type with a range (SYNTHETIC: INR 1,500 to INR 10,000)');
select is((select name || '|' || position || '|' || active || '|' || min_price_paise || '|' || max_price_paise from public.item_types where tenant_id = tests.tid('a') and code = '01'), 'Item type one|1|true|150000|1000000', 'C6 stored as given, in minor units');
select is(pg_temp.j(pg_temp.sc('a_admin', pg_temp.save_sql('a', '01', 'Item type one (renamed)', 1, 'true', '200000', '900000')), 'created'), 'false', 'C7 an Admin changes it');
select is((select name || '|' || min_price_paise || '|' || max_price_paise from public.item_types where tenant_id = tests.tid('a') and code = '01'), 'Item type one (renamed)|200000|900000', 'C8 the change is stored');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.save_sql('a', '01', 'Item type one (renamed)', 1, 'true', '200000', '900000')), 'created'), 'false', 'C9 an exact retry changes nothing and creates nothing');
select is((select count(*) from public.item_types where tenant_id = tests.tid('a') and code = '01'), 1::bigint, 'C10 still one row for the code');
select is(pg_temp.j(pg_temp.sc('a_owner', pg_temp.save_sql('a', '02', 'Item type two')), 'created'), 'true', 'C11 a type with no range at all (both bounds empty) is allowed');
select is((select min_price_paise is null and max_price_paise is null from public.item_types where tenant_id = tests.tid('a') and code = '02'), true, 'C12 both bounds are null');
select is(pg_temp.code('a_owner', pg_temp.save_sql('a', '03', 'Only a floor', 1, 'true', '5000')), 'ok', 'C13 only a lowest price');
select is(pg_temp.code('a_owner', pg_temp.save_sql('a', '04', 'Only a ceiling', 1, 'true', 'null', '5000')), 'ok', 'C14 only a highest price');
select is(pg_temp.code('a_owner', pg_temp.save_sql('a', '05', 'Equal bounds', 1, 'true', '5000', '5000')), 'ok', 'C15 lowest = highest is allowed');
select is(pg_temp.code('a_owner', pg_temp.save_sql('a', '06', 'Inverted', 1, 'true', '6000', '5000')), '23514', 'C16 lowest above highest: not allowed');
select is(pg_temp.code('a_owner', pg_temp.save_sql('a', '06', 'Zero floor', 1, 'true', '0')), '23514', 'C17 a lowest price of 0: not allowed');
select is(pg_temp.code('a_owner', pg_temp.save_sql('a', '06', 'Too big', 1, 'true', 'null', '100000001')), '23514', 'C18 a highest price above INR 1,000,000: not allowed');
select is(pg_temp.code('a_owner', pg_temp.save_sql('a', '06', 'Negative', 1, 'true', '-5')), '23514', 'C19 a negative lowest price: not allowed');
select is(pg_temp.code('a_owner', pg_temp.save_sql('a', '', 'No code')), '22023', 'C20 an empty code: invalid');
select is(pg_temp.code('a_owner', pg_temp.save_sql('a', 'a b', 'Space in code')), '22023', 'C21 a code with a space: invalid');
select is(pg_temp.code('a_owner', pg_temp.save_sql('a', repeat('x', 21), 'Long code')), '22023', 'C22 a code of 21 characters: invalid');
select is(pg_temp.code('a_owner', pg_temp.save_sql('a', '07', '   ')), '22023', 'C23 a blank name: invalid');
select is(pg_temp.code('a_owner', pg_temp.save_sql('a', '07', repeat('n', 201))), '22023', 'C24 a name of 201 characters: invalid');
select is(pg_temp.code('a_owner', pg_temp.save_sql('a', '07', 'Zero' || chr(8203) || 'width')), '22023', 'C25 a name with an invisible character: invalid');
select is(pg_temp.code('a_owner', pg_temp.save_sql('a', '07', 'Negative position', -1)), '22023', 'C26 a negative position: invalid');
select is(pg_temp.code('a_owner', pg_temp.save_sql('a', '07', 'No active flag', 1, 'null')), '22023', 'C27 an empty active flag: invalid');
select is((select count(*) from public.item_types where tenant_id = tests.tid('a') and code in ('06', '07')), 0::bigint, 'C28 none of the refused calls left a row');
select is(pg_temp.code('a_sales', pg_temp.save_sql('a', '08')), '42501', 'C29 Sales cannot save an item type');
select is(pg_temp.code('a_viewer', pg_temp.save_sql('a', '08')), '42501', 'C30 a Viewer cannot');
select is(pg_temp.code('b_owner', pg_temp.save_sql('a', '08')), '42501', 'C31 another tenant''s Owner cannot write into tenant A');
select is(pg_temp.err('b_owner', pg_temp.save_sql('a', '08')), pg_temp.err('b_owner', format('select public.save_item_type(%L, ''08'', ''Item type X'', 1, true, null, null)', gen_random_uuid())), 'C32 a foreign tenant and an unknown tenant id get the identical refusal');
select is((select count(*) from public.item_types where code = '08'), 0::bigint, 'C33 and nothing was written');
select tests.as_aal('aal1');
select is(pg_temp.err('a_owner', pg_temp.save_sql('a', '08')), 'SM306|a second factor is required for this action||||', 'C34 an Owner at aal1 needs the second factor');
select is(pg_temp.code('a_sales', pg_temp.save_sql('a', '08')), '42501', 'C35 ...and Sales at aal1 is refused before that (no oracle)');
select tests.as_aal('aal2');
-- no direct write by a client, whatever the role
select is(pg_temp.code('a_owner', format('insert into public.item_types (tenant_id, code, name) values (%L, ''09'', ''Direct'')', tests.tid('a'))), '42501', 'C36 an Owner cannot insert a row directly (only the function writes)');
select is(pg_temp.code('a_owner', format('update public.item_types set min_price_paise = 1 where tenant_id = %L', tests.tid('a'))), '42501', 'C37 nor update one directly');
select is(pg_temp.code('a_admin', format('delete from public.item_types where tenant_id = %L', tests.tid('a'))), '42501', 'C38 nor delete one');
select is(pg_temp.code('a_sales', format('update public.item_types set min_price_paise = 1 where tenant_id = %L', tests.tid('a'))), '42501', 'C39 Sales cannot update directly either');
-- reading: Owner / Admin / Sales of the tenant only
create function pg_temp.rows_seen(p_user text, p_tenant text) returns bigint language plpgsql as $$
declare v bigint; v_tenant uuid := tests.tid(p_tenant);
begin
  perform tests.set_identity(tests.uid(p_user));
  execute format('select count(*) from public.item_types where tenant_id = %L', v_tenant) into v;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  return v;
end $$;
select is(pg_temp.rows_seen('a_owner', 'a') > 0 and pg_temp.rows_seen('a_admin', 'a') > 0 and pg_temp.rows_seen('a_sales', 'a') > 0, true, 'C40 Owner, Admin and Sales of tenant A read tenant A''s item types');
select is(pg_temp.rows_seen('a_viewer', 'a'), 0::bigint, 'C41 a Viewer reads none (a price range is pricing information, like the price list)');
select is(pg_temp.rows_seen('b_owner', 'a'), 0::bigint, 'C42 cross-tenant: tenant B''s Owner reads none of tenant A''s');
select pg_temp.sc('b_owner', pg_temp.save_sql('b', '01', 'Tenant B type', 1, 'true', '100', '200'));
select is(pg_temp.rows_seen('a_owner', 'b'), 0::bigint, 'C43 cross-tenant: tenant A''s Owner reads none of tenant B''s');
select is((select count(*) from public.item_types where code = '01'), 2::bigint, 'C44 the same code can exist in two tenants');
-- the row's own guards (as the migration owner: they hold for every role)
select is(pg_temp.priv(format('update public.item_types set code = ''99'' where tenant_id = %L and code = ''01''', tests.tid('a'))), '42501|the code of an item type never changes', 'C45 the code never changes');
select isnt(pg_temp.priv(format('update public.item_types set tenant_id = %L where tenant_id = %L and code = ''01''', tests.tid('b'), tests.tid('a'))), 'ok', 'C46 the tenant never changes');
select is(pg_temp.priv(format('delete from public.item_types where tenant_id = %L', tests.tid('a'))), '42501|item_types rows are never deleted: record a new version', 'C47 a row is never deleted');
select is(pg_temp.priv('truncate public.item_types cascade'), '42501|item_types is never truncated: record a new version', 'C48 nor truncated');
select is(pg_temp.priv(format('update public.item_types set min_price_paise = 900, max_price_paise = 800 where tenant_id = %L and code = ''01''', tests.tid('a'))) like '23514|%', true, 'C49 the table itself refuses a lowest price above the highest');
select is(pg_temp.priv(format('insert into public.item_types (tenant_id, code, name) values (%L, ''01'', ''Duplicate'')', tests.tid('a'))) like '23505|%', true, 'C50 a code is unique per tenant');
select is(pg_temp.priv(format('insert into public.item_types (tenant_id, code, name) values (%L, ''X1'', %L)', tests.tid('a'), 'Bad' || chr(8238) || 'name')) like '23514|%', true, 'C51 the table itself refuses an invisible character in a name');
-- the range check a later slice calls
select is(app.price_outside_range(100, 200, 300), true, 'C52 below the lowest: outside');
select is(app.price_outside_range(200, 200, 300), false, 'C53 exactly the lowest: inside');
select is(app.price_outside_range(300, 200, 300), false, 'C54 exactly the highest: inside');
select is(app.price_outside_range(301, 200, 300), true, 'C55 one paisa above the highest: outside');
select is(app.price_outside_range(250, 200, 300), false, 'C56 inside');
select is(app.price_outside_range(100, null, null), false, 'C57 no range at all: never outside');
select is(app.price_outside_range(100, null, 50), true, 'C58 only a ceiling: above it is outside');
select is(app.price_outside_range(100, 150, null), true, 'C59 only a floor: below it is outside');
select is(pg_temp.priv('select app.price_outside_range(null, 1, 2)'), '22023|invalid argument', 'C60 a missing price is refused, not treated as inside');
select is(pg_temp.priv('select app.price_outside_range(0, 1, 2)'), '22023|invalid argument', 'C61 a price of 0 is refused');
select is(app.item_type_price_outside_range(tests.tid('a'), '01', 199999), true, 'C62 by type: INR 1,999.99 is below the renamed type''s INR 2,000 floor');
select is(app.item_type_price_outside_range(tests.tid('a'), '01', 200000), false, 'C63 by type: INR 2,000 is inside');
select is(app.item_type_price_outside_range(tests.tid('a'), '01', 900001), true, 'C64 by type: above the ceiling');
select is(app.item_type_price_outside_range(tests.tid('a'), '02', 99999999), false, 'C65 a type with no range never refuses');
select is(pg_temp.priv(format('select app.item_type_price_outside_range(%L, ''ZZ'', 100)', tests.tid('a'))), '23503|invalid reference', 'C66 an unknown code is "invalid reference" (nothing is guessed)');
select is(pg_temp.priv(format('select app.item_type_price_outside_range(%L, ''01'', 5000)', tests.tid('b'))), 'ok', 'C67 control: tenant B''s own code 01 (range 100 to 200) answers for tenant B');
select is(app.item_type_price_outside_range(tests.tid('b'), '01', 5000), true, 'C68 ...with tenant B''s range, not tenant A''s');
select ok(not has_function_privilege('authenticated', 'app.price_outside_range(bigint,bigint,bigint)', 'execute') and not has_function_privilege('authenticated', 'app.item_type_price_outside_range(uuid,text,bigint)', 'execute')
      and not has_function_privilege('authenticated', 'app.quote_gst_paise(bigint,integer)', 'execute') and not has_function_privilege('authenticated', 'app.quote_gst_bps_on(uuid,uuid,date)', 'execute'), 'C69 none of the new app.* helpers is callable by a client');
-- audit
select ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'item_type' and actor_type = 'user' and actor_user_id = tests.uid('a_owner')) >= 1, 'C70 creating an item type is audited as the person who did it');
select ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'item_type' and action = 'item_type.update' and actor_user_id = tests.uid('a_admin')) = 1, 'C71 a real change is audited once, as the Admin; the exact retry added nothing');

-- ============================================================================ D. delivery_state: what a manual-price quote can and cannot skip (settled in slice 1)
select is((select string_agg(attname || ':' || attnotnull::text, ',' order by attname) from pg_attribute
            where attrelid = 'public.quotes'::regclass and attname in ('delivery_state', 'gst_supply') and not attisdropped), 'delivery_state:false,gst_supply:false',
          'D1 (slice 2 changed this) the columns are nullable now, but only the manual kind may leave them empty: the table CHECK quotes_pricing_kind_check keeps them required for the list kind (pgTAP 68)');
select is(pg_temp.err('a_sales', format('select public.create_quote_draft(%L, %L, ''new'', null, ''1.1.0'', ''{}'', ''{}'')', gen_random_uuid(), pg_temp.req('n1'))), '22023|invalid argument||||',
          'D2 the draft function refuses a missing delivery state before anything else');
select is(pg_temp.qp('a_owner', pg_temp.policy('{"required_inputs": ["deadline"]}')), '23514', 'D3 a policy that does not require the delivery state is refused (the list-price rule is unchanged)');
select is(pg_temp.priv(format('insert into public.quote_policy_versions (tenant_id, version_no, effective_from, discount_ceiling_bps, shipping_flat_fee_paise, shipping_tax_bps, validity_days, new_advance_bps, repeat_advance_bps, new_net_days, repeat_net_days, gst_rate_bps, gst_effective_from, seller_state, required_inputs, content_sha256) values (%L, 99, current_date, 0, 0, 0, 15, 0, 0, 30, 30, 500, current_date, ''TS'', array[''deadline'']::public.quote_input_key[], repeat(''1'', 64))', tests.tid('a'))) like '23514|%', true,
          'D4 ...and the table itself refuses it too');
select is((select pg_get_function_identity_arguments('app.quote_build'::regproc)), 'p_tenant uuid, p_requirement uuid, p_as_of date, p_kind text, p_price_version uuid, p_policy_version uuid',
          'D5 the database''s own build takes NO delivery state: no figure of a quote can depend on it');
select is((pg_temp.build(pg_temp.req('n1'), 'new') -> 'request')::text !~ 'state', true, 'D6 ...and the request handed to the engine contains no state at all');
select is((select gst_supply::text from public.quotes where id = (select q_new from qids)) || '|' || (select gst_supply::text from public.quotes where id = (select q_rep from qids)), 'inter_state|inter_state',
          'D7 the only thing the state changes is gst_supply (intra or inter state), a label that the quote view shows and no amount uses (the delivery state was TG, the seller state is TS)');

select * from finish();
rollback;
