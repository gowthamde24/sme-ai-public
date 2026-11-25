-- Shopify and WooCommerce (migration 20261231992340; docs/contracts/commerce-notify.md section B): the Owner's or Admin's connection (one per kind, closed choices, no key anywhere), the scheduler account's
-- webhook lookup, orders (idempotent, a cancelled order stays cancelled, the checkout it finished is recovered), checkouts (claimed when due, wiped when done), the phone's own-number order facts, isolation
-- between workspaces and the clean-up.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('x5@test.local');

create function pg_temp.q(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin
  perform tests.as_aal(p_aal);
  return tests.scalar_as(tests.uid(p_user), format(p_sql, tests.tid('a')));
exception when others then return 'ERR:' || sqlstate;
end $$;

-- ---- the connection
select is(pg_temp.q('a_owner', $q$select public.commerce_connect(%L, '00000000-0000-4000-8000-0000000000c1', 'shopify', 'demo-shop.myshopify.com', repeat('a', 64), 'abcd', null) ->> 'state'$q$), 'connected', 'A1 the Owner connects a store');
select is(pg_temp.q('a_admin', $q$select public.commerce_connect(%L, '00000000-0000-4000-8000-0000000000c2', 'woocommerce', 'shop.example.com', repeat('b', 64), 'wxyz', null) ->> 'kind'$q$), 'woocommerce', 'A2 an Admin may too');
select is(pg_temp.q('a_sales', $q$select public.commerce_connect(%L, '00000000-0000-4000-8000-0000000000c3', 'shopify', 'other-shop.myshopify.com', repeat('c', 64), 'abcd', null) ->> 'id'$q$), 'ERR:42501', 'A3 Sales may not');
select is(pg_temp.q('a_viewer', $q$select public.commerce_settings_set(%L, '00000000-0000-4000-8000-0000000000c1', '{"abandoned": true}')::text$q$), 'ERR:42501', 'A4 a Viewer may not change choices');
select is(pg_temp.q('a_owner', $q$select public.commerce_connect(%L, '00000000-0000-4000-8000-0000000000c9', 'magento', 'shop.example.com', repeat('d', 64), 'abcd', null) ->> 'id'$q$), 'ERR:22023', 'A5 only Shopify and WooCommerce');
select is(pg_temp.q('a_owner', $q$select public.commerce_connect(%L, '00000000-0000-4000-8000-0000000000c9', 'shopify', 'not a host', repeat('d', 64), 'abcd', null) ->> 'id'$q$), 'ERR:22023', 'A6 a store name is a plain host name');
select is(pg_temp.q('a_owner', $q$select public.commerce_connect(%L, '00000000-0000-4000-8000-0000000000c9', 'shopify', 'x-shop.myshopify.com', 'short', 'abcd', null) ->> 'id'$q$), 'ERR:22023', 'A7 the address hash is a sha256');
select is(pg_temp.q('a_owner', $q$select public.commerce_connect(%L, '00000000-0000-4000-8000-0000000000c5', 'shopify', 'new-shop.myshopify.com', repeat('e', 64), 'abcd', null) ->> 'id'$q$), '00000000-0000-4000-8000-0000000000c1', 'A8 a second connect of one kind replaces the store: still one connection');
select is(pg_temp.q('a_owner', $q$select count(*)::text from public.commerce_connections where tenant_id = %L$q$), '2', 'A9 two connections: Shopify and WooCommerce');
select is((select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'commerce_connections' and column_name ~ 'secret$|^secret$|token$|password|key'), '0', 'A10 no column holds a key (token_hash is the hash of our own address token, secret_last4 four characters)');
select is(pg_temp.q('a_owner', $q$select public.commerce_connections_list(%L) -> 0 ? 'token_hash'$q$), 'false', 'A11 the list never shows the address hash');

-- ---- choices: a closed set
select is(pg_temp.q('a_owner', $q$select public.commerce_settings_set(%L, '00000000-0000-4000-8000-0000000000c1', '{"abandoned": true, "abandoned_after_min": 30, "confirm_orders": "all"}') -> 'settings' ->> 'abandoned_after_min'$q$), '30', 'B1 choices are saved');
select is(pg_temp.q('a_owner', $q$select public.commerce_settings_set(%L, '00000000-0000-4000-8000-0000000000c1', '{"nope": 1}')::text$q$), 'ERR:22023', 'B2 an unknown key is refused');
select is(pg_temp.q('a_owner', $q$select public.commerce_settings_set(%L, '00000000-0000-4000-8000-0000000000c1', '{"abandoned_after_min": 5}')::text$q$), 'ERR:22023', 'B3 a wait under 15 minutes is refused');
select is(pg_temp.q('a_owner', $q$select public.commerce_settings_set(%L, '00000000-0000-4000-8000-0000000000c1', '{"confirm_orders": "sometimes"}')::text$q$), 'ERR:22023', 'B4 a closed word');
select is(pg_temp.q('a_owner', $q$select public.commerce_settings_set(%L, '00000000-0000-4000-8000-0000000000c1', '{"cod_words": ["a;drop table x"]}')::text$q$), 'ERR:22023', 'B5 a payment word is plain letters');
select is(pg_temp.q('a_owner', $q$select public.commerce_settings_set(%L, '00000000-0000-4000-8000-0000000000c1', '{"checkout_consent": true}') -> 'settings' ->> 'checkout_consent_by'$q$), tests.uid('a_owner')::text, 'B6 the checkout consent says who stated it ...');
select is(pg_temp.q('a_owner', $q$select (public.commerce_settings_set(%L, '00000000-0000-4000-8000-0000000000c1', '{"checkout_consent": false}') -> 'settings') ? 'checkout_consent_by'$q$), 'false', 'B7 ... and withdrawing it clears who and when');
select is(pg_temp.q('a_owner', $q$select coalesce(public.commerce_settings_set(%L, gen_random_uuid(), '{"abandoned": true}')::text, 'none')$q$), 'none', 'B8 no such connection');

-- ---- the receiver (scheduler account)
select is(pg_temp.q('x5', $q$select public.commerce_connection_by_token(repeat('e', 64)) ->> 'kind'$q$), 'shopify', 'C1 the connection behind an address');
select is(pg_temp.q('x5', $q$select coalesce(public.commerce_connection_by_token(repeat('z', 64))::text, 'none')$q$), 'none', 'C2 an unknown address');
select is(pg_temp.q('a_owner', $q$select public.commerce_connection_by_token(repeat('e', 64))::text$q$), 'ERR:42501', 'C3 a person cannot look an address up');

-- ---- orders
select is(pg_temp.q('x5', $q$select public.commerce_order_upsert(%L, '00000000-0000-4000-8000-0000000000c1', 'o1', '#1001', 'placed', 'cod', 129900, 'Silk saree x2', '', '+919800000001', now(), 'chk-1') ->> 'created'$q$), 'true', 'D1 a new order');
select is(pg_temp.q('x5', $q$select public.commerce_order_upsert(%L, '00000000-0000-4000-8000-0000000000c1', 'o1', '#1001', 'shipped', 'cod', 129900, '', 'AWB123', '+919800000001', now(), null) ->> 'created'$q$), 'false', 'D2 the same order again is an update');
select is(pg_temp.q('x5', $q$select count(*)::text from public.commerce_orders where tenant_id = %L$q$), '1', 'D3 one row');
select is(pg_temp.q('x5', $q$select public.commerce_order_upsert(%L, '00000000-0000-4000-8000-0000000000c1', 'o1', '#1001', 'cancelled', 'cod', 0, '', '', null, now(), null) ->> 'status'$q$), 'cancelled', 'D4 cancelled');
select is(pg_temp.q('x5', $q$select public.commerce_order_upsert(%L, '00000000-0000-4000-8000-0000000000c1', 'o1', '#1001', 'placed', 'cod', 0, '', '', null, now(), null) ->> 'status'$q$), 'cancelled', 'D5 a late "placed" event does not undo a cancellation');
select is(pg_temp.q('x5', $q$select public.commerce_order_upsert(%L, '00000000-0000-4000-8000-0000000000c1', 'o2', 'bad number!', 'placed', 'cod', 1, '', '', null, now(), null)::text$q$), 'ERR:22023', 'D6 a number with odd characters is refused');
select is(pg_temp.q('x5', $q$select public.commerce_order_upsert(%L, gen_random_uuid(), 'o3', '#3', 'placed', 'cod', 1, '', '', null, now(), null)::text$q$), 'ERR:23503', 'D7 an unknown connection');
select is(pg_temp.q('x5', $q$select public.commerce_order_lead_sent(%L, '00000000-0000-4000-8000-0000000000c1', 'o1')::text$q$), 'true', 'D8 the lead is marked sent once');
select is(pg_temp.q('x5', $q$select public.commerce_order_lead_sent(%L, '00000000-0000-4000-8000-0000000000c1', 'o1')::text$q$), 'false', 'D9 ... and not twice');
select is(pg_temp.q('a_owner', $q$select public.commerce_order_upsert(%L, '00000000-0000-4000-8000-0000000000c1', 'o4', '#4', 'placed', 'cod', 1, '', '', null, now(), null)::text$q$), 'ERR:42501', 'D10 only the scheduler account writes orders');

-- ---- facts for the phone: the caller's own orders
select is(pg_temp.q('x5', $q$select public.commerce_order_facts(%L, '+919800000001') -> 0 ->> 'number'$q$), '#1001', 'E1 the caller finds their order by their own number');
select is(pg_temp.q('x5', $q$select public.commerce_order_facts(%L, '+919800000099')::text$q$), '[]', 'E2 another number sees nothing');
select is(pg_temp.q('x5', $q$select public.commerce_order_facts(%L, 'not a number')::text$q$), '[]', 'E3 a bad number sees nothing');
select is(pg_temp.q('x5', $q$select (public.commerce_order_facts(%L, '+919800000001') -> 0) ? 'phone'$q$), 'false', 'E4 the facts carry no number, name or address');
select is(pg_temp.q('a_owner', $q$select public.commerce_order_facts(%L, '+919800000001')::text$q$), 'ERR:42501', 'E5 a person cannot read them');
select pg_temp.q('a_owner', $q$select public.commerce_settings_set(%L, '00000000-0000-4000-8000-0000000000c1', '{"share_status": false}')::text$q$);
select is(pg_temp.q('x5', $q$select public.commerce_order_facts(%L, '+919800000001')::text$q$), '[]', 'E6 the owner can turn the answers off');
select pg_temp.q('a_owner', $q$select public.commerce_settings_set(%L, '00000000-0000-4000-8000-0000000000c1', '{"share_status": true}')::text$q$);

-- ---- checkouts
select is(pg_temp.q('x5', $q$select public.commerce_checkout_upsert(%L, '00000000-0000-4000-8000-0000000000c1', 'chk-1', '+919800000002', 'Mina', 50000, 'Dupatta', false, 30) ->> 'status'$q$), 'pending', 'F1 a started checkout waits');
select is(pg_temp.q('x5', $q$select public.commerce_checkout_upsert(%L, '00000000-0000-4000-8000-0000000000c1', 'chk-2', '+919800000003', 'Ravi', 60000, 'Kurta', false, 5) ->> 'status'$q$), 'ERR:22023', 'F2 a wait under 15 minutes is refused');
select is(pg_temp.q('x5', $q$select count(*)::text from public.commerce_checkouts where tenant_id = %L and status = 'pending'$q$), '1', 'F3 one waiting');
select is(pg_temp.q('x5', $q$select jsonb_array_length(public.commerce_checkouts_claim(10))::text$q$), '0', 'F4 nothing is due yet');
update public.commerce_checkouts set due_at = now() - interval '1 minute';
select is(pg_temp.q('x5', $q$select (public.commerce_checkouts_claim(10) -> 0 ->> 'phone')$q$), '+919800000002', 'F5 a due checkout is claimed with the number it needs');
select is(pg_temp.q('x5', $q$select jsonb_array_length(public.commerce_checkouts_claim(10))::text$q$), '0', 'F6 ... and leased, not claimed twice');
select is(pg_temp.q('x5', $q$select public.commerce_checkout_finish((select id from public.commerce_checkouts where external_id = 'chk-1'), 'done')::text$q$), 'true', 'F7 done');
select is((select coalesce(phone, 'wiped') || '/' || coalesce(name, 'wiped') from public.commerce_checkouts where external_id = 'chk-1'), 'wiped/wiped', 'F8 the number and the name are wiped');
select is(pg_temp.q('x5', $q$select public.commerce_checkout_finish(gen_random_uuid(), 'sideways')::text$q$), 'ERR:22023', 'F9 a closed result');
select pg_temp.q('x5', $q$select public.commerce_checkout_upsert(%L, '00000000-0000-4000-8000-0000000000c1', 'chk-3', '+919800000004', 'Asha', 100, 'x', false, 20)::text$q$);
select pg_temp.q('x5', $q$select public.commerce_order_upsert(%L, '00000000-0000-4000-8000-0000000000c1', 'o5', '#5', 'placed', 'prepaid', 100, 'x', '', '+919800000004', now(), 'chk-3')::text$q$);
select is((select status || '/' || coalesce(phone, 'wiped') from public.commerce_checkouts where external_id = 'chk-3'), 'recovered/wiped', 'F10 an order that finishes the checkout cancels its call-back');

-- ---- state, disconnect, isolation
select is(pg_temp.q('a_owner', $q$select public.commerce_mark(%L, '00000000-0000-4000-8000-0000000000c1', 'problem', 'bad_credentials', false) ->> 'problem'$q$), 'bad_credentials', 'G1 a closed problem word');
select is(pg_temp.q('a_owner', $q$select public.commerce_mark(%L, '00000000-0000-4000-8000-0000000000c1', 'problem', 'the store said no', false) ->> 'problem'$q$), 'ERR:22023', 'G2 never the store''s own text');
select pg_temp.q('a_owner', $q$select public.commerce_mark(%L, '00000000-0000-4000-8000-0000000000c1', 'connected', null, true)::text$q$);
select is(pg_temp.q('b_owner', $q$select public.commerce_connections_list(%L)::text$q$), 'ERR:42501', 'G3 another workspace''s Owner sees nothing');
select is(pg_temp.q('b_owner', $q$select public.commerce_disconnect(%L, '00000000-0000-4000-8000-0000000000c1')::text$q$), 'ERR:42501', 'G4 nor disconnects it');
select is(pg_temp.q('a_owner', $q$select count(*)::text from public.commerce_orders where tenant_id = %L$q$), '2', 'G5 the Owner reads the orders (RLS)');
select is(pg_temp.q('a_sales', $q$select count(*)::text from public.commerce_orders where tenant_id = %L$q$), '2', 'G6 Sales reads orders ...');
select is(pg_temp.q('a_sales', $q$select count(*)::text from public.commerce_connections where tenant_id = %L$q$), '0', 'G7 ... but not the connections');
select is(pg_temp.q('a_owner', $q$insert into public.commerce_orders (tenant_id, connection_id, external_id, number) values (%L, '00000000-0000-4000-8000-0000000000c1', 'x', '#9')$q$), 'ERR:42501', 'G8 nobody writes an order directly');
select is(pg_temp.q('a_owner', $q$select public.commerce_disconnect(%L, '00000000-0000-4000-8000-0000000000c1')::text$q$), 'true', 'G9 disconnect');
select is(pg_temp.q('x5', $q$select coalesce(public.commerce_connection_by_token(repeat('e', 64))::text, 'none')$q$), 'none', 'G10 a disconnected store''s address is dead');
select is(pg_temp.q('x5', $q$select public.commerce_order_upsert(%L, '00000000-0000-4000-8000-0000000000c1', 'o9', '#9', 'placed', 'cod', 1, '', '', null, now(), null)::text$q$), 'ERR:23503', 'G11 and takes no more orders');
select is(pg_temp.q('x5', $q$select public.commerce_order_facts(%L, '+919800000001')::text$q$), '[]', 'G12 nor are its orders answered on the phone');

-- ---- the clean-up
update public.commerce_orders set created_at = now() - interval '181 days' where external_id = 'o5';
update public.commerce_checkouts set created_at = now() - interval '8 days' where external_id = 'chk-3';
select is(pg_temp.q('x5', $q$select public.commerce_purge()::text$q$), '{"orders": 1, "checkouts": 1}', 'H1 orders go after 180 days, checkouts after 7');
select is(pg_temp.q('a_owner', $q$select public.commerce_purge()::text$q$), 'ERR:42501', 'H2 only the worker cleans up');

select * from finish();
rollback;
