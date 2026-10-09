-- Job AD / D3: public.today_summary(tenant) and public.agents_status(tenant): read-only, SECURITY INVOKER, role-aware, tenant-isolated.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();
select tests.seed_t009();
select tests.seed_orders();
select tests.seed_followups();

update public.companies set city = 'Hyderabad' where id = tests.rid('a_company');

-- tenant A: one draft quote waiting (quote 2), the fixture follow-up draft waiting, and a cancelled order that still holds 40,000 paise (50,000 paid, 10,000 refunded)
insert into public.quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, price_list_version_id, policy_version_id, engine_version, request_text,
                           result_text, canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, merchandise_net_paise, item_tax_paise,
                           shipping_net_paise, shipping_tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval)
values (tests.rid('a_quote_draft'), tests.tid('a'), 2, tests.rid('a_requirement'), tests.rid('a_enquiry'), tests.rid('a_lead'), 'draft',
        tests.rid('a_price_version'), tests.rid('a_policy_version'), '1.1.0', '{}', '{}', repeat('6', 64), 'new', 'TS', 'intra_state', current_date,
        current_date, current_date, 1000000, 50000, 0, 0, 1050000, 0, 1050000, false);

-- the order lifecycle is enforced by triggers (tested in 61); this fixture writes the finished picture the way a privileged fixture may, with them off
create function pg_temp.ev(p_id uuid, p_tenant uuid, p_order uuid, p_seq int, p_type public.order_event_type, p_prior public.order_state, p_new public.order_state,
                           p_amount bigint, p_at timestamptz) returns void language sql as $$
  insert into public.order_events (id, tenant_id, order_id, seq, type, prior_state, new_state, amount_paise, ledger_id, occurred_at, recorded_at,
                                   engine_version, request_text, result_text, canonical_hash)
  values (p_id, p_tenant, p_order, p_seq, p_type, p_prior, p_new, p_amount, case when p_amount is not null then gen_random_uuid() end, p_at, p_at,
          (select version from public.order_engine_versions order by version limit 1), '{}', '{}', repeat('8', 64))
$$;
set local session_replication_role = replica;
update public.orders set state = 'cancelled', closed_at = now() where id = tests.rid('a_order');
select pg_temp.ev(tests.rid('a_ev2'), tests.tid('a'), tests.rid('a_order'), 2, 'record_payment', 'quote_approved', 'advance_paid', 50000, now() + interval '1 minute');
select pg_temp.ev(tests.rid('a_ev3'), tests.tid('a'), tests.rid('a_order'), 3, 'record_refund', 'advance_paid', 'advance_paid', 10000, now() + interval '2 minutes');
select pg_temp.ev(tests.rid('a_ev4'), tests.tid('a'), tests.rid('a_order'), 4, 'cancel', 'advance_paid', 'cancelled', null, now() + interval '3 minutes');
set local session_replication_role = origin;

-- tenant B has its own waiting things; none of them may ever appear in A's answers
insert into public.quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, price_list_version_id, policy_version_id, engine_version, request_text,
                           result_text, canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, merchandise_net_paise, item_tax_paise,
                           shipping_net_paise, shipping_tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval)
values (tests.rid('b_quote_draft'), tests.tid('b'), 2, tests.rid('b_requirement'), tests.rid('b_enquiry'), tests.rid('b_lead'), 'draft',
        tests.rid('b_price_version'), tests.rid('b_policy_version'), '1.1.0', '{}', '{}', repeat('7', 64), 'new', 'TS', 'intra_state', current_date,
        current_date, current_date, 7000000, 0, 0, 0, 7000000, 0, 7000000, false);

-- ---- today_summary: the Owner sees all three kinds
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.today_summary(%L) -> 'cards' ->> 'waiting')$$, tests.tid('a'))), '3', 'owner: three things wait (a quote, a follow-up draft, an order that holds money)');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.today_summary(%L) -> 'cards' ->> 'money_held_paise')$$, tests.tid('a'))), '40000', 'owner: money held is paid less refunded, on the closed order');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.today_summary(%L) -> 'cards' ->> 'orders_open')$$, tests.tid('a'))), '0', 'owner: the cancelled order is not open');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select string_agg(x ->> 'kind', ',' order by x ->> 'kind') from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') x$$, tests.tid('a'))),
  'followup_due,order_money_held,quote_approval', 'owner: the three kinds');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select x ->> 'customer' || '|' || coalesce(x ->> 'city', '-') || '|' || (x ->> 'agent') || '|' || (x ->> 'ref') || '|' || coalesce(x ->> 'amount_paise', '-')
  from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') x where x ->> 'kind' = 'quote_approval'$$, tests.tid('a'))),
  'Company a|Hyderabad|quote_writer|2|1050000', 'the quote item: customer, city, agent, quote number, total');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (x ->> 'agent') || '|' || (x ->> 'ref') || '|' || coalesce(x ->> 'amount_paise', '-')
  from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') x where x ->> 'kind' = 'followup_due'$$, tests.tid('a'))),
  'followup_desk|2|-', 'the follow-up item: agent, touch number, no amount');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (x ->> 'agent') || '|' || (x ->> 'ref') || '|' || (x ->> 'amount_paise')
  from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') x where x ->> 'kind' = 'order_money_held'$$, tests.tid('a'))),
  'order_desk|1|40000', 'the money-held item: agent, order number, the amount held');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select jsonb_array_length(public.today_summary(%L) -> 'recent')$$, tests.tid('a'))), '4', 'owner: the four order steps so far');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.today_summary(%L) -> 'recent' -> 0 ->> 'type') || '|' || (public.today_summary(%L) -> 'recent' -> 0 ->> 'order_no')$$, tests.tid('a'), tests.tid('a'))),
  'cancel|1', 'the newest step first');

-- ---- where "Open" goes
select is(tests.scalar_as(tests.uid('a_owner'), format($$select string_agg((x ->> 'kind') || '>' || (x -> 'target' ->> 'type') || ':' || (x -> 'target' ->> 'id'), ',' order by x ->> 'kind')
  from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') x$$, tests.tid('a'))),
  'followup_due>lead:' || tests.rid('a_lead') || ',order_money_held>order:' || tests.rid('a_order') || ',quote_approval>quote:' || tests.rid('a_quote_draft'),
  'each waiting item opens its quote, its lead or its order');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.today_summary(%L) -> 'recent' -> 0 -> 'order_id')::text$$, tests.tid('a'))), '"' || tests.rid('a_order') || '"', 'a recent step names its order');

-- ---- by role
select is(tests.scalar_as(tests.uid('a_admin'), format($$select string_agg(x ->> 'kind', ',' order by x ->> 'kind') from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') x$$, tests.tid('a'))),
  'followup_due,quote_approval', 'admin: approvals only (recording a refund is the Owner''s)');
select is(tests.scalar_as(tests.uid('a_admin'), format($$select (public.today_summary(%L) -> 'cards' ->> 'money_held_paise')$$, tests.tid('a'))), '40000', 'admin: still reads the money held card');
select is(tests.scalar_as(tests.uid('a_sales'), format($$select jsonb_array_length(public.today_summary(%L) -> 'needs_you')$$, tests.tid('a'))), '0', 'sales: nothing is waiting for them to approve');
select is(tests.scalar_as(tests.uid('a_sales'), format($$select (public.today_summary(%L) -> 'cards' ->> 'money_held_paise')$$, tests.tid('a'))), '40000', 'sales: reads the cards');
select is(tests.scalar_as(tests.uid('a_sales'), format($$select jsonb_array_length(public.today_summary(%L) -> 'recent')$$, tests.tid('a'))), '4', 'sales: reads the recent steps');
select is(tests.scalar_as(tests.uid('a_viewer'), format($$select (public.today_summary(%L) -> 'cards')::text$$, tests.tid('a'))),
  '{"waiting": 0, "orders_open": 0, "money_held_paise": 0}', 'viewer: all zero, no amount of any kind');
select is(tests.scalar_as(tests.uid('a_viewer'), format($$select (jsonb_array_length(public.today_summary(%L) -> 'needs_you') + jsonb_array_length(public.today_summary(%L) -> 'recent'))$$, tests.tid('a'), tests.tid('a'))),
  '0', 'viewer: nothing listed');

-- ---- tenants never mix
select is(tests.sqlstate_as(tests.uid('b_owner'), format($$select public.today_summary(%L)$$, tests.tid('a'))), '42501', 'DENY: another business''s owner cannot read this Today');
select is(tests.sqlstate_as(tests.uid('outsider'), format($$select public.today_summary(%L)$$, tests.tid('a'))), '42501', 'DENY: a stranger cannot');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$select public.today_summary(%L)$$, gen_random_uuid())), '42501', 'DENY: an unknown business answers the same way');
select is(tests.sqlstate_as(tests.uid('a_owner'), $$select public.today_summary(null)$$), '42501', 'DENY: no business');
select is(tests.sqlstate_as(null, format($$select public.today_summary(%L)$$, tests.tid('a'))), '42501', 'DENY: no identity');
select is(tests.scalar_as(tests.uid('b_owner'), format($$select (public.today_summary(%L) -> 'cards' ->> 'waiting')$$, tests.tid('b'))), '2',
  'B''s owner sees B''s own two waiting things (a quote and a follow-up draft)');
select is(tests.scalar_as(tests.uid('b_owner'), format($$select (public.today_summary(%L))::text like '%%Hyderabad%%'$$, tests.tid('b'))), 'false', 'and none of A''s city, names or amounts');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.today_summary(%L))::text like '%%7000000%%'$$, tests.tid('a'))), 'false', 'A never sees B''s quote total');
select is(tests.scalar_as(tests.uid('dual'), format($$select (public.today_summary(%L) -> 'cards' ->> 'waiting')$$, tests.tid('b'))), '0', 'a person who owns A and is only a viewer in B gets B''s answer as a viewer: nothing waits');
select is(tests.scalar_as(tests.uid('dual'), format($$select (public.today_summary(%L) -> 'cards' ->> 'waiting')$$, tests.tid('a'))), '3', 'and A''s as an owner');

-- ---- the list is capped at 20 and the count is the whole count
insert into public.followup_drafts (id, tenant_id, lead_id, contact_id, touch_number, channel, template_code, body, policy_version_id, engine_version, request_text, result_text,
                                    canonical_hash, state_hash, as_of, created_at)
select gen_random_uuid(), tests.tid('a'), tests.rid('a_lead'), tests.rid('a_contact'), n, 'email', 'followup_gentle', 'Synthetic fixture draft body text',
       tests.rid('a_followup_policy'), '1.0.0', '{}', '{}', repeat('1', 64), repeat('2', 64), now(), now() - (n || ' minutes')::interval
  from generate_series(3, 26) n;
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.today_summary(%L) -> 'cards' ->> 'waiting')$$, tests.tid('a'))), '27', 'waiting counts all of them (3 + 24 more drafts)');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select jsonb_array_length(public.today_summary(%L) -> 'needs_you')$$, tests.tid('a'))), '20', 'the list shows the newest twenty');

-- ---- more than five steps: only the newest five
set local session_replication_role = replica;
select pg_temp.ev(gen_random_uuid(), tests.tid('a'), tests.rid('a_order'), 4 + n, 'cancel', 'cancelled', 'cancelled', null, now() + ((10 + n) || ' minutes')::interval) from generate_series(1, 4) n;
set local session_replication_role = origin;
select is(tests.scalar_as(tests.uid('a_owner'), format($$select jsonb_array_length(public.today_summary(%L) -> 'recent')$$, tests.tid('a'))), '5', 'at most five recent steps');

-- ---- an empty business
select is(tests.scalar_as(tests.uid('b_owner'), format($$select (public.today_summary(%L) -> 'cards' ->> 'orders_open')$$, tests.tid('b'))), '1', 'B has one open order');

-- ---- agents_status
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.agents_status(%L) ->> 'agents_enabled')$$, tests.tid('a'))), 'false', 'agents are off until the workspace switches them on');
insert into public.tenant_agent_settings (tenant_id, enabled) values (tests.tid('a'), true);
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.agents_status(%L) ->> 'agents_enabled')$$, tests.tid('a'))), 'true', 'and then they are on');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.agents_status(%L) -> 'researcher' ->> 'running')$$, tests.tid('a'))), 'false', 'no research run yet');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.agents_status(%L) -> 'quote_writer' ->> 'last_no')$$, tests.tid('a'))), '2', 'the newest quote');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.agents_status(%L) -> 'order_desk' ->> 'last_type')$$, tests.tid('a'))), 'cancel', 'the newest order step');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.agents_status(%L) -> 'followup_desk' ->> 'last_touch')$$, tests.tid('a'))), '2', 'the newest follow-up draft (the one made first, with no newer created_at than the fixture)');

insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, lead_id, status, expires_at, input_sha256)
values (tests.rid('a_run_running'), tests.tid('a'), tests.uid('a_owner'), 'research', '1', tests.rid('a_lead'), 'running', now() + interval '10 minutes', repeat('a', 64));
insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, enquiry_id, status, created_at, finished_at, expires_at, input_sha256)
select tests.rid('a_run_done'), tests.tid('a'), tests.uid('a_owner'), 'requirement', '1', tests.rid('a_enquiry'), 'succeeded', now() - interval '2 hours', now() - interval '1 hour', now() + interval '1 hour', repeat('b', 64)
 where exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agent_runs' and column_name = 'enquiry_id');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.agents_status(%L) -> 'researcher' ->> 'running')$$, tests.tid('a'))), 'true', 'a research run in flight is "running"');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.agents_status(%L) -> 'requirement_analyst' ->> 'last_status')$$, tests.tid('a'))), 'succeeded', 'the requirement run that finished');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.agents_status(%L) -> 'requirement_analyst' ->> 'running')$$, tests.tid('a'))), 'false', 'and it is not running');
update public.agent_runs set expires_at = now() - interval '1 minute', created_at = now() - interval '20 minutes' where id = tests.rid('a_run_running');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.agents_status(%L) -> 'researcher' ->> 'running')$$, tests.tid('a'))), 'false', 'a run past its time is not "running"');

-- a Sales member reads only their OWN runs (the table's own rule), so the owner's run is invisible to them
update public.agent_runs set expires_at = now() + interval '10 minutes', created_at = now() where id = tests.rid('a_run_running');
select is(tests.scalar_as(tests.uid('a_sales'), format($$select (public.agents_status(%L) -> 'researcher' ->> 'running')$$, tests.tid('a'))), 'false', 'sales do not see the owner''s run');

-- ---- agents_status: tenants never mix, and refusals
select is(tests.scalar_as(tests.uid('b_owner'), format($$select (public.agents_status(%L) -> 'researcher' ->> 'running')$$, tests.tid('b'))), 'false', 'B does not see A''s run');
select is(tests.scalar_as(tests.uid('b_owner'), format($$select (public.agents_status(%L) -> 'quote_writer' ->> 'last_no')$$, tests.tid('b'))), '2', 'B sees B''s own newest quote');
select is(tests.sqlstate_as(tests.uid('b_owner'), format($$select public.agents_status(%L)$$, tests.tid('a'))), '42501', 'DENY: another business''s owner');
select is(tests.sqlstate_as(tests.uid('outsider'), format($$select public.agents_status(%L)$$, tests.tid('a'))), '42501', 'DENY: a stranger');
select is(tests.sqlstate_as(null, format($$select public.agents_status(%L)$$, tests.tid('a'))), '42501', 'DENY: no identity');

-- ---- both are read-only invoker functions that anon cannot call
select is((select count(*) from pg_proc p where p.oid in ('public.today_summary(uuid)'::regprocedure, 'public.agents_status(uuid)'::regprocedure) and (p.prosecdef or p.provolatile <> 's')),
  0::bigint, 'both are STABLE and SECURITY INVOKER');
select is(has_function_privilege('anon', 'public.today_summary(uuid)', 'execute'), false, 'anon cannot execute today_summary');
select is(has_function_privilege('anon', 'public.agents_status(uuid)', 'execute'), false, 'anon cannot execute agents_status');
select is(has_function_privilege('authenticated', 'public.today_summary(uuid)', 'execute'), true, 'a signed-in person can');

select * from finish();
rollback;
