-- Job EB part B (migration 20261218090000): the Sources page. The forwarding-address token that can be shown again (who may read and set it, only for the workspace's own e-mail source, unique everywhere) and the
-- numbers on the cards (arrivals of the last 7 days by source tag, the WhatsApp connection), owner and admin only.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.get(p_user text, p_tenant text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.lead_inbound_address_get(%L)::text$q$, tests.tid(p_tenant))) $$;
create function pg_temp.set(p_user text, p_tenant text, p_source text, p_token text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select (public.lead_inbound_address_set(%L, %L, %L) ->> 'token')$q$, tests.tid(p_tenant), tests.rid(p_source), p_token)) $$;

insert into public.lead_sources (id, tenant_id, kind, tag, label, token_hash, token_hint, created_by) values
  (tests.rid('a_mail'), tests.tid('a'), 'email_forward', 'webhook', 'Forwarded lead e-mails', repeat('a', 64), 'wxyz', tests.uid('a_owner')),
  (tests.rid('a_form'), tests.tid('a'), 'website_form', 'website_form', 'Website', repeat('b', 64), 'abcd', tests.uid('a_owner')),
  (tests.rid('b_mail'), tests.tid('b'), 'email_forward', 'webhook', 'Forwarded lead e-mails', repeat('c', 64), 'efgh', tests.uid('b_owner'));

-- ---- the address token
select is((pg_temp.get('a_owner', 'a')::jsonb) ->> 'token', null, 'before any address: no token');
select is(pg_temp.get('a_sales', 'a'), 'ERR:42501', 'DENY: Sales cannot read the address');
select is(pg_temp.get('a_viewer', 'a'), 'ERR:42501', 'DENY: a Viewer');
select is(pg_temp.get('b_owner', 'a'), 'ERR:42501', 'DENY: another business');
select is(pg_temp.set('a_owner', 'a', 'a_mail', 'abcdefghijklmnopqrstuvwx'), 'abcdefghijklmnopqrstuvwx', 'ALLOW: the owner records the token of the e-mail source');
select is((pg_temp.get('a_admin', 'a')::jsonb) ->> 'token', 'abcdefghijklmnopqrstuvwx', '...an Admin reads it back');
select is(pg_temp.set('a_owner', 'a', 'a_mail', '0123456789abcdefghijklmn'), '0123456789abcdefghijklmn', 'a rotation replaces it');
select is((pg_temp.get('a_owner', 'a')::jsonb) ->> 'token', '0123456789abcdefghijklmn', '...and only the new one is kept');
select isnt((pg_temp.get('a_owner', 'a')::jsonb) ->> 'rotated_at', null, '...with the time it was rotated');
select is((select count(*) from public.lead_inbound_addresses where tenant_id = tests.tid('a')), 1::bigint, 'one address per workspace');
select is(pg_temp.set('a_owner', 'a', 'a_form', 'zzzzzzzzzzzzzzzzzzzzzzzz'), 'ERR:22023', 'DENY: a source that is not the e-mail source');
select is(pg_temp.set('a_owner', 'a', 'b_mail', 'yyyyyyyyyyyyyyyyyyyyyyyy'), 'ERR:22023', 'DENY: another business''s source');
select is(pg_temp.set('a_owner', 'a', 'a_mail', 'SHORT'), 'ERR:22023', 'DENY: a token of the wrong shape');
select is(pg_temp.set('a_owner', 'a', 'a_mail', 'ABCDEFGHIJKLMNOPQRSTUVWX'), 'ERR:22023', 'DENY: capital letters (mail systems may change case)');
select is(pg_temp.set('a_sales', 'a', 'a_mail', 'xxxxxxxxxxxxxxxxxxxxxxxx'), 'ERR:42501', 'DENY: Sales cannot set it');
select is(pg_temp.set('anon', 'a', 'a_mail', 'xxxxxxxxxxxxxxxxxxxxxxxx'), 'ERR:42501', 'DENY: no identity');
select is(pg_temp.set('b_owner', 'b', 'b_mail', '0123456789abcdefghijklmn'), 'ERR:23505', 'a token already in use anywhere is refused (unique)');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$insert into public.lead_inbound_addresses (tenant_id, source_id, token) values (%L, %L, 'qqqqqqqqqqqqqqqqqqqqqqqq')$$, tests.tid('b'), tests.rid('b_mail'))), '42501', 'DENY: no client writes the table directly');
select is(tests.rows_as(tests.uid('a_owner'), 'select 1 from public.lead_inbound_addresses'), 1::bigint, 'the owner reads their own row');
select is(tests.rows_as(tests.uid('a_sales'), 'select 1 from public.lead_inbound_addresses'), 0::bigint, '...Sales reads none');
select is(tests.rows_as(tests.uid('b_owner'), 'select 1 from public.lead_inbound_addresses'), 0::bigint, '...and another business none');

-- ---- the numbers on the cards
insert into public.lead_arrivals (tenant_id, lead_id, contact_id, source_tag, kind, received_at) values
  (tests.tid('a'), tests.rid('a_lead'), tests.rid('a_contact'), 'website_form', 'first', now() - interval '1 day'),
  (tests.tid('a'), tests.rid('a_lead'), tests.rid('a_contact'), 'website_form', 'repeat', now() - interval '2 days'),
  (tests.tid('a'), tests.rid('a_lead'), tests.rid('a_contact'), 'website_form', 'repeat', now() - interval '3 days'),
  (tests.tid('a'), tests.rid('a_lead'), tests.rid('a_contact'), 'website_form', 'repeat', now() - interval '10 days'),
  (tests.tid('a'), tests.rid('a_lead'), tests.rid('a_contact'), 'justdial', 'repeat', now() - interval '9 days');
create function pg_temp.stats(p_user text, p_tenant text) returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.lead_source_cards_stats(%L)::text$q$, tests.tid(p_tenant))) $$;
select is(((pg_temp.stats('a_owner', 'a')::jsonb) -> 'by_tag' -> 'website_form' ->> 'received_7d')::int, 3, 'three arrivals in the last 7 days by the website tag (the 10-day-old one is not counted)');
select isnt((pg_temp.stats('a_owner', 'a')::jsonb) -> 'by_tag' -> 'website_form' ->> 'last_at', null, '...and the last one is known');
select is(((pg_temp.stats('a_admin', 'a')::jsonb) -> 'by_tag' -> 'justdial' ->> 'received_7d')::int, 0, 'an old arrival counts as 0 this week but is still known');
select is((pg_temp.stats('a_owner', 'a')::jsonb) -> 'by_tag' -> 'whatsapp', null, 'a tag with no arrivals is simply absent');
select is((pg_temp.stats('a_owner', 'a')::jsonb) -> 'whatsapp', 'null'::jsonb, 'no WhatsApp account: nothing');
select is(((pg_temp.stats('a_owner', 'a')::jsonb) -> 'sheets' ->> 'total')::int, 0, 'no sheets yet');
select is(((pg_temp.stats('a_owner', 'a')::jsonb) -> 'imports' ->> 'received_7d')::int, 0, 'no imports yet');
insert into integrations.whatsapp_accounts (tenant_id, waba_id, phone_number_id, token_ref, status) values (tests.tid('a'), '123456789', '987654321', 'sme-whatsapp-token', 'active');
select is((pg_temp.stats('a_owner', 'a')::jsonb) -> 'whatsapp' ->> 'status', 'active', 'a connected WhatsApp account shows');
select is((pg_temp.stats('b_owner', 'b')::jsonb) -> 'by_tag', '{}'::jsonb, 'another business has its own (empty) numbers');
select is(pg_temp.stats('a_sales', 'a'), 'ERR:42501', 'DENY: Sales');
select is(pg_temp.stats('b_owner', 'a'), 'ERR:42501', 'DENY: another business reads nothing of mine');
select is(pg_temp.stats('anon', 'a'), 'ERR:42501', 'DENY: no identity');

select * from finish();
rollback;
