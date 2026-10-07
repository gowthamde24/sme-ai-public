-- The follow-up due list's candidates (docs/plans/followups-due-candidates-plan.md, migration 20261028090000): public.followup_due_candidates, a READ-ONLY, role-first, security-definer list of the leads a
-- person might have to follow up, oldest last outbound touch first, with a keyset cursor. It is a SAFE SUPERSET of what the pinned engine would call due: it drops only leads that provably cannot be (no
-- outbound touch, archived, stopped by the database, or one of the blocker's four TERMINAL answers) and copies no cadence rule. NOTHING IS SENT; nothing is written.
--   A catalog (definer, stable, search_path, grants)   B the role matrix and the generic refusal   C parameters (22023)   D which leads are in, by construction (hand-labelled shapes and a generated grid)
--   E order   F paging (keyset, the scan cap, no gaps and no repeats)   G last channel and open draft   H no policy   I safety (nothing written)   J tenant isolation
-- Every key is a well-formed FAKE (md5 twice). All data is synthetic. The terminal answers are pinned to the real engine by tests/integration/test_followup_equivalence.py.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();
select tests.seed_t009();
select tests.seed_orders();
select tests.as_aal('aal2');

-- ---------------------------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------------------------
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
create function pg_temp.at(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform tests.as_aal(p_aal);
  r := tests.error_full_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
  perform tests.as_aal('aal2');
  if r = 'ok' then return 'ok'; end if;
  return split_part(r, '|', 1) || case when split_part(r, '|', 3) <> '' then ':' || split_part(r, '|', 3) else '' end;
end $$;
create function pg_temp.try(p_user text, p_sql text) returns text language sql as $$ select pg_temp.at('aal2', p_user, p_sql) $$;
create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.run(p_user text, p_sql text) returns void language plpgsql as $$
declare r text;
begin
  r := pg_temp.try(p_user, p_sql);
  if r <> 'ok' then raise exception 'fixture step failed (%): %', r, left(p_sql, 200); end if;
end $$;
create function pg_temp.today() returns date language sql as $$ select app.quote_today() $$;
create function pg_temp.noon_offset() returns integer language sql as $$
  select case when ((720 - (extract(hour from now() at time zone 'UTC')::int * 60 + extract(minute from now() at time zone 'UTC')::int) + 1440) % 1440) > 840
              then ((720 - (extract(hour from now() at time zone 'UTC')::int * 60 + extract(minute from now() at time zone 'UTC')::int) + 1440) % 1440) - 1440
              else ((720 - (extract(hour from now() at time zone 'UTC')::int * 60 + extract(minute from now() at time zone 'UTC')::int) + 1440) % 1440) end $$;
create function pg_temp.pol() returns text language sql as $$
  select jsonb_build_object('gap_days', '[1, 2]'::jsonb, 'max_touches', 3, 'quiet_hours', jsonb_build_object('start', '03:00', 'end', '04:00'), 'allowed_weekdays', '[0, 1, 2, 3, 4, 5, 6]'::jsonb,
                            'holidays', '[]'::jsonb, 'min_gap_hours', 0, 'recipient_utc_offset_minutes', pg_temp.noon_offset())::text $$;
-- a lead -> label table, so a result can be read as labels
create table pg_temp.lab (label text primary key, id uuid not null, expect_in boolean);
-- a keyed, consented lead (the gate is not what this file tests) with the given outbound touches (days ago, newest last), an optional reply, a status, a channel, an archive flag
create function pg_temp.mkl(p_label text, p_outs int[] default array[5], p_in_days int default null, p_status text default 'new', p_chan text default 'email', p_archived boolean default false,
                            p_expect boolean default null) returns void language plpgsql as $$
declare d int; n int := 0;
begin
  insert into public.contacts (id, tenant_id, company_id, full_name, email, phone)
  values (tests.rid(p_label || '_c'), tests.tid('a'), tests.rid('a_company'), 'Contact ' || p_label, p_label || '@example.test', '+00 9' || lpad((abs(hashtext(p_label)) % 100000)::text, 5, '0'));
  insert into public.leads (id, tenant_id, company_id, contact_id, status, created_at, archived_at)
  values (tests.rid(p_label), tests.tid('a'), tests.rid('a_company'), tests.rid(p_label || '_c'), p_status::public.lead_status, now() - interval '60 days', case when p_archived then now() end);
  perform pg_temp.run('a_owner', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid(p_label || '_c'),
            jsonb_build_object('version', 1, 'email', pg_temp.h(p_label || '_e'), 'phone', pg_temp.h(p_label || '_p'))));
  perform pg_temp.run('a_owner', format($q$select public.record_consent(%L, %L, 'email', 'granted', 'explicit_consent', 'web_form', %L)$q$, tests.tid('a'), tests.rid(p_label || '_c'), 'ref:' || p_label));
  perform pg_temp.run('a_owner', format($q$select public.record_consent(%L, %L, 'whatsapp', 'granted', 'explicit_consent', 'web_form', %L)$q$, tests.tid('a'), tests.rid(p_label || '_c'), 'refw:' || p_label));
  foreach d in array p_outs loop
    n := n + 1;
    insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at)
    values (tests.rid('t_' || p_label || '_' || n), tests.tid('a'), tests.rid(p_label), tests.rid(p_label || '_c'), 'out', p_chan::public.consent_channel, now() - make_interval(days => d));
  end loop;
  if p_in_days is not null then
    insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at)
    values (tests.rid('t_' || p_label || '_in'), tests.tid('a'), tests.rid(p_label), tests.rid(p_label || '_c'), 'in', 'email', now() - make_interval(days => p_in_days));
  end if;
  insert into pg_temp.lab values (p_label, tests.rid(p_label), p_expect);
end $$;
-- an order in a state for a lead (the fixture of pgTAP 62)
create function pg_temp.mkorder(p_label text, p_lead text, p_state text) returns void language plpgsql as $$
begin
  insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body) values (tests.rid(p_label || '_enq'), tests.tid('a'), tests.rid(p_lead), 'email', now() - interval '1 hour', 'Synthetic enquiry ' || p_label);
  insert into public.requirements (id, tenant_id, enquiry_id) values (tests.rid(p_label || '_req'), tests.tid('a'), tests.rid(p_label || '_enq'));
  insert into public.quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, price_list_version_id, policy_version_id, engine_version, request_text, result_text,
                             canonical_hash, customer_kind, delivery_state, gst_supply, as_of, valid_until, due_date, merchandise_net_paise, item_tax_paise, shipping_net_paise,
                             shipping_tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval, approved_by, approved_at, approved_hash)
  values (tests.rid(p_label || '_quote'), tests.tid('a'), (select coalesce(max(quote_no), 0) + 1 from public.quotes where tenant_id = tests.tid('a')), tests.rid(p_label || '_req'),
          tests.rid(p_label || '_enq'), tests.rid(p_lead), 'approved', tests.rid('a_price_version'), tests.rid('a_policy_version'), '1.1.0', '{}', '{}', repeat('3', 64),
          'new', 'TS', 'intra_state', pg_temp.today(), pg_temp.today() + 10, pg_temp.today() + 30, 100000, 0, 0, 0, 100000, 40000, 60000, false, tests.uid('a_owner'), now(), repeat('5', 64));
  insert into public.orders (id, tenant_id, order_no, quote_id, enquiry_id, requirement_id, lead_id, order_total_paise, advance_paise, valid_until, policy_version_id)
  values (tests.rid(p_label || '_order'), tests.tid('a'), (select coalesce(max(order_no), 0) + 1 from public.orders where tenant_id = tests.tid('a')), tests.rid(p_label || '_quote'),
          tests.rid(p_label || '_enq'), tests.rid(p_label || '_req'), tests.rid(p_lead), 100000, 40000, pg_temp.today() + 10, tests.rid('a_order_policy'));
  insert into public.order_events (id, tenant_id, order_id, seq, type, prior_state, new_state, occurred_at)
  values (gen_random_uuid(), tests.tid('a'), tests.rid(p_label || '_order'), 1, 'created', null, 'quote_approved', now());
  if p_state <> 'quote_approved' then
    alter table public.orders disable trigger orders_guard_update;
    update public.orders set state = p_state::public.order_state, closed_at = case when p_state in ('declined', 'cancelled', 'expired', 'closed_paid') then now() end where id = tests.rid(p_label || '_order');
    alter table public.orders enable trigger orders_guard_update;
  end if;
end $$;
-- the candidates, as a user, as jsonb (null when the call failed)
create function pg_temp.cand(p_user text, p_after_at text default null, p_after_id text default null, p_limit int default 30, p_scan int default 300, p_tenant text default 'a') returns jsonb language plpgsql as $$
declare r text;
begin
  r := pg_temp.sc(p_user, format('select public.followup_due_candidates(%L, %L, %L, %s, %s)::text', tests.tid(p_tenant), p_after_at, p_after_id, coalesce(p_limit::text, 'null'), coalesce(p_scan::text, 'null')));
  if r like 'ERR:%' then return null; end if;
  return r::jsonb;
end $$;
create function pg_temp.err(p_user text, p_after_at text default null, p_after_id text default null, p_limit text default '30', p_scan text default '300', p_tenant text default 'a') returns text language sql as $$
  select pg_temp.try(p_user, format('select public.followup_due_candidates(%L, %L, %L, %s, %s)', case when p_tenant = 'null' then null else tests.tid(p_tenant) end, p_after_at, p_after_id, p_limit, p_scan)) $$;
-- the labels of a result's items, in order
create function pg_temp.labels(p_result jsonb) returns text language sql as $$
  select coalesce(string_agg(l.label, ',' order by e.ord), '') from jsonb_array_elements(p_result -> 'items') with ordinality e(item, ord) join pg_temp.lab l on l.id = (e.item ->> 'lead_id')::uuid $$;

select is(pg_temp.try('a_owner', format($q$select public.create_followup_policy_version(%L, %L, %L, %L::jsonb)$q$, tests.rid('pol_c1'), tests.tid('a'), pg_temp.today(), pg_temp.pol())), 'ok', 'fixture: a follow-up policy is in force for workspace a');

-- ---------------------------------------------------------------------------------------------
-- A. catalog
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'followup_due_candidates'), 1::bigint, 'A1 exactly one function of that name (no overload to call by accident)');
select is((select p.prosecdef from pg_proc p where p.oid = 'public.followup_due_candidates(uuid, timestamptz, uuid, integer, integer)'::regprocedure), true, 'A2 it is SECURITY DEFINER (the caller needs the member role, not table grants)');
select is((select p.provolatile::text from pg_proc p where p.oid = 'public.followup_due_candidates(uuid, timestamptz, uuid, integer, integer)'::regprocedure), 's', 'A3 it is STABLE: a read, it writes nothing');
select is((select p.proconfig::text from pg_proc p where p.oid = 'public.followup_due_candidates(uuid, timestamptz, uuid, integer, integer)'::regprocedure), '{"search_path=\"\""}', 'A4 its search_path is empty');
select is(has_function_privilege('anon', 'public.followup_due_candidates(uuid, timestamptz, uuid, integer, integer)', 'execute'), false, 'A5 anon cannot execute it');
select is(has_function_privilege('authenticated', 'public.followup_due_candidates(uuid, timestamptz, uuid, integer, integer)', 'execute'), true, 'A6 a signed-in session can (the role is proven inside)');
select is((select count(*) from aclexplode((select p.proacl from pg_proc p where p.proname = 'followup_due_candidates')) a where a.grantee = 0), 0::bigint, 'A7 PUBLIC (grantee 0) has no execute');
select is((select pg_get_function_result(p.oid) from pg_proc p where p.proname = 'followup_due_candidates'), 'jsonb', 'A8 it returns one JSON document');

-- ---------------------------------------------------------------------------------------------
-- fixtures for D to G (workspace a). Labels say what the lead is.
-- ---------------------------------------------------------------------------------------------
-- IN: a due lead, a lead touched now ("not yet"), a lead whose history lies after as_of (future_history stays in), a lead with an order that is only approved, a phone-only history
select pg_temp.mkl('in_due',      array[5],  p_expect => true);
select pg_temp.mkl('in_notyet',   array[0],  p_expect => true);
select pg_temp.mkl('in_two',      array[9, 6], p_expect => true);
select pg_temp.mkl('in_phone',    array[7],  p_chan => 'phone', p_expect => true);
select pg_temp.mkl('in_future',   array[5],  p_expect => true);
insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at, recorded_at)
values (tests.rid('t_in_future_fut'), tests.tid('a'), tests.rid('in_future'), tests.rid('in_future_c'), 'out', 'email', now() + interval '1 day', now() + interval '2 days');
select pg_temp.mkl('in_order',    array[5],  p_expect => true);   select pg_temp.mkorder('in_order', 'in_order', 'quote_approved');
-- OUT: no outbound touch; archived; a reply; the touch limit; lost; won; each suppression reason; each stopping order state
select pg_temp.mkl('out_none',    array[]::int[], p_expect => false);
select pg_temp.mkl('out_replyonly', array[]::int[], p_in_days => 2, p_expect => false);
select pg_temp.mkl('out_archived', array[5], p_archived => true, p_expect => false);
select pg_temp.mkl('out_replied', array[5], p_in_days => 2, p_expect => false);
select pg_temp.mkl('out_limit',   array[10, 8, 6], p_expect => false);
select pg_temp.mkl('out_lost',    array[5], p_status => 'disqualified', p_expect => false);
select pg_temp.mkl('out_won',     array[5], p_expect => false);
insert into public.opportunities (id, tenant_id, company_id, contact_id, lead_id, title, status, closed_at) values (tests.rid('out_won_opp'), tests.tid('a'), tests.rid('a_company'), tests.rid('out_won_c'), tests.rid('out_won'), 'Synthetic won deal', 'won', now());
select pg_temp.mkl('out_optout',  array[5], p_expect => false);   select pg_temp.run('a_owner', format($q$select public.suppress_contact(%L, %L, 'opted_out', 'other', 'ref:o')$q$, tests.tid('a'), tests.rid('out_optout_c')));
select pg_temp.mkl('out_manual',  array[5], p_expect => false);   select pg_temp.run('a_owner', format($q$select public.suppress_contact(%L, %L, 'manual', 'other', 'ref:m')$q$, tests.tid('a'), tests.rid('out_manual_c')));
select pg_temp.mkl('out_bounced', array[5], p_expect => false);  select pg_temp.run('a_owner', format($q$select public.suppress_contact(%L, %L, 'bounced', 'other', 'ref:b')$q$, tests.tid('a'), tests.rid('out_bounced_c')));
select pg_temp.mkl('out_accepted', array[5], p_expect => false);  select pg_temp.mkorder('out_accepted', 'out_accepted', 'accepted');
select pg_temp.mkl('out_declined', array[5], p_expect => false);  select pg_temp.mkorder('out_declined', 'out_declined', 'declined');
select pg_temp.mkl('out_cancelled', array[5], p_expect => false); select pg_temp.mkorder('out_cancelled', 'out_cancelled', 'cancelled');
-- a generated grid: outbound touches 1 to 3 x a reply x lost x opted out x archived; the expectation is written by CONSTRUCTION (a lead is in only when none of the five things holds)
do $$
declare n int; r int; l int; o int; a int; lbl text; ok boolean;
begin
  for n in 1 .. 3 loop for r in 0 .. 1 loop for l in 0 .. 1 loop for o in 0 .. 1 loop for a in 0 .. 1 loop
    lbl := format('g%s%s%s%s%s', n, r, l, o, a);
    ok := n < 3 and r = 0 and l = 0 and o = 0 and a = 0;
    perform pg_temp.mkl(lbl, array(select 12 - 3 * k from generate_series(1, n) k), case when r = 1 then 2 end, case when l = 1 then 'disqualified' else 'new' end, 'email', a = 1, ok);
    if o = 1 then
      perform pg_temp.run('a_owner', format($q$select public.suppress_contact(%L, %L, 'opted_out', 'other', 'ref:g')$q$, tests.tid('a'), tests.rid(lbl || '_c')));
    end if;
  end loop; end loop; end loop; end loop; end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- B. the role matrix: Owner, Admin and Sales read; nobody else; one generic refusal
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err('a_owner'), 'ok', 'B1 the Owner reads the candidates');
select is(pg_temp.err('a_admin'), 'ok', 'B2 an Admin does');
select is(pg_temp.err('a_sales'), 'ok', 'B3 Sales does');
select is(pg_temp.err('a_viewer'), '42501', 'B4 a Viewer is refused (42501)');
select is(pg_temp.err('b_owner'), '42501', 'B5 the Owner of ANOTHER workspace is refused with the same 42501');
select is(pg_temp.err('anon'), '42501', 'B6 anon is refused with the same 42501');
select is(pg_temp.err('a_owner', p_tenant => 'null'), '42501', 'B7 a null workspace is the same refusal');
select is(pg_temp.try('a_sales', format('select public.followup_due_candidates(%L, null, null, 30, 300)', gen_random_uuid())), '42501', 'B8 a workspace that does not exist is the same refusal (no oracle)');
select is(pg_temp.try('a_viewer', format('select public.followup_due_candidates(%L, null, null, 0, 300)', tests.tid('a'))), '42501', 'B9 the role is proven BEFORE the parameters: a Viewer with a bad limit gets 42501, not 22023');
select is(pg_temp.err('a_owner', p_tenant => 'b'), '42501', 'B10 a member of workspace a asking for workspace b is refused');

-- ---------------------------------------------------------------------------------------------
-- C. parameters (22023); both edges accepted
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.err('a_sales', p_limit => '0'), '22023', 'C1 limit 0');
select is(pg_temp.err('a_sales', p_limit => '51'), '22023', 'C2 limit 51');
select is(pg_temp.err('a_sales', p_limit => 'null'), '22023', 'C3 a null limit');
select is(pg_temp.err('a_sales', p_scan => '0'), '22023', 'C4 scan cap 0');
select is(pg_temp.err('a_sales', p_scan => '1001'), '22023', 'C5 scan cap 1001');
select is(pg_temp.err('a_sales', p_scan => 'null'), '22023', 'C6 a null scan cap');
select is(pg_temp.err('a_sales', p_after_at => '2026-01-01T00:00:00Z'), '22023', 'C7 a cursor with only its time');
select is(pg_temp.err('a_sales', p_after_id => '00000000-0000-0000-0000-000000000001'), '22023', 'C8 a cursor with only its id');
select is(pg_temp.err('a_sales', p_limit => '1', p_scan => '1'), 'ok', 'C9 limit 1 and scan cap 1 are accepted');
select is(pg_temp.err('a_sales', p_limit => '50', p_scan => '1000'), 'ok', 'C10 limit 50 and scan cap 1000 are accepted');
select is(pg_temp.err('a_sales', p_after_at => '2026-01-01T00:00:00Z', p_after_id => '00000000-0000-0000-0000-000000000001'), 'ok', 'C11 a whole cursor is accepted');

-- ---------------------------------------------------------------------------------------------
-- D. which leads are in
-- ---------------------------------------------------------------------------------------------
create temp table pg_temp.walk as select pg_temp.cand('a_sales', null, null, 50, 1000) as res;
select is((select (res ->> 'policy_in_force')::boolean from pg_temp.walk), true, 'D0 a policy is in force');
select is((select count(*) from jsonb_array_elements((select res from pg_temp.walk) -> 'items') i join pg_temp.lab l on l.id = (i ->> 'lead_id')::uuid where l.expect_in is false), 0::bigint, 'D1 no lead that provably cannot be due is returned');
select is((select string_agg(l.label, ',' order by l.label) from pg_temp.lab l where l.expect_in is true and l.id not in (select (i ->> 'lead_id')::uuid from jsonb_array_elements((select res from pg_temp.walk) -> 'items') i)), null, 'D2 every lead that could be due IS returned (the superset property, by construction)');
select is(pg_temp.labels((select res from pg_temp.walk)) ~ '(^|,)in_due(,|$)', true, 'D3 a due lead is in');
select is(pg_temp.labels((select res from pg_temp.walk)) ~ '(^|,)in_notyet(,|$)', true, 'D4 a lead touched just now ("not yet") is in: the engine says wait, the list does not decide');
select is(pg_temp.labels((select res from pg_temp.walk)) ~ '(^|,)in_future(,|$)', true, 'D5 a lead with a touch after as_of is in (future_history is not terminal)');
select is(pg_temp.labels((select res from pg_temp.walk)) ~ '(^|,)in_phone(,|$)', true, 'D6 a lead whose only outbound touches are calls is in');
select is(pg_temp.labels((select res from pg_temp.walk)) ~ '(^|,)in_order(,|$)', true, 'D7 an order that only has an approved quote does not stop follow-ups');
select is((select string_agg(x, ',' order by x) from (select unnest(array['out_none','out_replyonly','out_archived','out_replied','out_limit','out_lost','out_won','out_optout','out_manual','out_bounced','out_accepted','out_declined','out_cancelled']) x) t where pg_temp.labels((select res from pg_temp.walk)) ~ ('(^|,)' || x || '(,|$)')), null, 'D8 none of the thirteen leads that cannot be due is returned');
select is((select count(*) from pg_temp.lab where label like 'g%'), 48::bigint, 'D9 the generated grid has 48 leads');
select is((select count(*) from pg_temp.lab where label like 'g%' and expect_in), 2::bigint, 'D10 ... and exactly two of them can be due (one or two touches, nothing else)');
select is((select count(*) from jsonb_array_elements((select res from pg_temp.walk) -> 'items') i join pg_temp.lab l on l.id = (i ->> 'lead_id')::uuid where l.label like 'g%' and l.expect_in), 2::bigint, 'D11 the grid: both are returned');
select is((select count(*) from jsonb_array_elements((select res from pg_temp.walk) -> 'items') i join pg_temp.lab l on l.id = (i ->> 'lead_id')::uuid where l.label like 'g%'), 2::bigint, 'D12 ... and nothing else of the grid');
-- the superset property against the database's own mirror, over EVERY lead of the workspace: a lead whose blocker is not terminal, not stopped and not archived and that has an outbound touch is in the result
select is((select count(*) from public.leads l
            where l.tenant_id = tests.tid('a') and l.archived_at is null and exists (select 1 from public.lead_touches t where t.lead_id = l.id and t.direction = 'out')
              and app.followup_stopped(l.id) is null
              and coalesce(app.followup_blocker(app.followup_build(l.id, to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), app.followup_active_policy_version(l.tenant_id, pg_temp.today()))), '-') <> all (array['suppressed','replied','closed','max_touches'])
              and l.id not in (select (i ->> 'lead_id')::uuid from jsonb_array_elements((select res from pg_temp.walk) -> 'items') i)), 0::bigint,
          'D13 the superset property over every lead of the workspace: nobody the blocker leaves in is missing');

-- ---------------------------------------------------------------------------------------------
-- E. order: the oldest last outbound touch first, ties by lead id; a back-dated touch orders by its own time
-- ---------------------------------------------------------------------------------------------
select pg_temp.mkl('o_old',  array[30, 29]);   -- last touch 29 days ago
select pg_temp.mkl('o_mid',  array[20]);       -- 20 days ago
select pg_temp.mkl('o_new',  array[1]);        -- 1 day ago
select pg_temp.mkl('o_tie1', array[15]);
select pg_temp.mkl('o_tie2', array[15]);
select is((select array_agg(x order by ord) from (select (e.item ->> 'lead_id')::uuid x, e.ord from jsonb_array_elements(pg_temp.cand('a_sales', null, null, 50, 1000) -> 'items') with ordinality e(item, ord)
                                                  where (e.item ->> 'lead_id')::uuid in (select id from pg_temp.lab where label in ('o_old', 'o_mid', 'o_new'))) q),
          array[tests.rid('o_old'), tests.rid('o_mid'), tests.rid('o_new')], 'E1 oldest last touch first (29 days, 20 days, 1 day)');
select is((select (e.item ->> 'lead_id')::uuid = least(tests.rid('o_tie1'), tests.rid('o_tie2')) from jsonb_array_elements(pg_temp.cand('a_sales', null, null, 50, 1000) -> 'items') with ordinality e(item, ord)
            where (e.item ->> 'lead_id')::uuid in (tests.rid('o_tie1'), tests.rid('o_tie2')) order by e.ord limit 1), true, 'E2 two leads with the same last touch are ordered by lead id');
select is((select (e.item ->> 'last_outbound_at')::timestamptz from jsonb_array_elements(pg_temp.cand('a_sales', null, null, 50, 1000) -> 'items') e(item) where (e.item ->> 'lead_id')::uuid = tests.rid('o_old')), now() - interval '29 days', 'E3 the last touch is the MAXIMUM of the outbound touches (29 days ago, not 30)');
-- a back-dated touch orders by the time it HAPPENED, not by when it was recorded: o_bd happened 25 days ago but was recorded just now; o_rec happened 21 days ago and was recorded then
select pg_temp.mkl('o_bd',  array[]::int[]);
select pg_temp.mkl('o_rec', array[]::int[]);
insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at, recorded_at)
values (tests.rid('t_o_bd'), tests.tid('a'), tests.rid('o_bd'), tests.rid('o_bd_c'), 'out', 'email', now() - interval '25 days', now()),
       (tests.rid('t_o_rec'), tests.tid('a'), tests.rid('o_rec'), tests.rid('o_rec_c'), 'out', 'email', now() - interval '21 days', now() - interval '21 days');
select is((select array_agg(x order by ord) from (select (e.item ->> 'lead_id')::uuid x, e.ord from jsonb_array_elements(pg_temp.cand('a_sales', null, null, 50, 1000) -> 'items') with ordinality e(item, ord)
                                                  where (e.item ->> 'lead_id')::uuid in (tests.rid('o_bd'), tests.rid('o_rec'))) q),
          array[tests.rid('o_bd'), tests.rid('o_rec')], 'E4 a back-dated touch orders by when it happened (25 days ago), not by when it was recorded');

-- ---------------------------------------------------------------------------------------------
-- F. paging: keyset, no gaps and no repeats, the scan cap, the end
-- ---------------------------------------------------------------------------------------------
create function pg_temp.walk_all(p_limit int, p_scan int) returns text language plpgsql as $$
declare res jsonb; acc text := ''; at text; id text; n int := 0;
begin
  loop
    res := pg_temp.cand('a_sales', at, id, p_limit, p_scan);
    acc := acc || case when acc = '' then '' else ',' end || pg_temp.labels(res);
    exit when res -> 'next_cursor' is null or res -> 'next_cursor' = 'null'::jsonb;
    at := res -> 'next_cursor' ->> 'at';
    id := res -> 'next_cursor' ->> 'id';
    n := n + 1;
    if n > 500 then raise exception 'the walk does not end'; end if;
  end loop;
  return trim(both ',' from regexp_replace(acc, ',{2,}', ',', 'g'));
end $$;
select is(pg_temp.walk_all(50, 1000), pg_temp.walk_all(7, 1000), 'F1 a walk in pages of 7 returns exactly what one big page returns, in the same order');
select is(pg_temp.walk_all(50, 1000), pg_temp.walk_all(5, 4), 'F2 ... and so does a walk with a scan cap of 4 (a short page keeps going while a cursor is given)');
select is((select count(*) from (select unnest(string_to_array(pg_temp.walk_all(5, 4), ',')) x) q), (select count(distinct x) from (select unnest(string_to_array(pg_temp.walk_all(5, 4), ',')) x) q), 'F3 no lead appears twice in a walk');
select is(pg_temp.cand('a_sales', null, null, 3, 1000) -> 'next_cursor' is not null and pg_temp.cand('a_sales', null, null, 3, 1000) -> 'next_cursor' <> 'null'::jsonb, true, 'F4 a page that stopped at its limit gives a cursor');
select is(pg_temp.cand('a_sales', null, null, 50, 1000) ->> 'next_cursor', null, 'F5 the last page has no cursor');
select is(jsonb_array_length(pg_temp.cand('a_sales', null, null, 2, 1000) -> 'items'), 2, 'F6 the limit is honoured (2 of many)');
select is(jsonb_array_length(pg_temp.cand('a_sales', '2200-01-01T00:00:00Z', '00000000-0000-0000-0000-000000000000', 30, 300) -> 'items'), 0, 'F7 a cursor beyond the end returns an empty page');
select is(pg_temp.cand('a_sales', '2200-01-01T00:00:00Z', '00000000-0000-0000-0000-000000000000', 30, 300) ->> 'next_cursor', null, 'F8 ... with no cursor');
-- the scan cap: five terminal leads come first (the oldest last touches); a cap of 3 examines three of them, returns nothing and gives a cursor
select pg_temp.mkl('s1', array[400], p_in_days => 399); select pg_temp.mkl('s2', array[399], p_in_days => 398); select pg_temp.mkl('s3', array[398], p_in_days => 397);
select pg_temp.mkl('s4', array[397], p_in_days => 396); select pg_temp.mkl('s5', array[396], p_in_days => 395);
select is(jsonb_array_length(pg_temp.cand('a_sales', null, null, 30, 3) -> 'items'), 0, 'F9 a scan cap of 3 over five terminal leads: no candidate');
select is(pg_temp.cand('a_sales', null, null, 30, 3) -> 'next_cursor' is not null and pg_temp.cand('a_sales', null, null, 30, 3) -> 'next_cursor' <> 'null'::jsonb, true, 'F10 ... but a cursor, so the caller can go on');
select is((pg_temp.cand('a_sales', null, null, 30, 3) -> 'next_cursor' ->> 'id')::uuid, tests.rid('s3'), 'F11 the cursor is the last lead EXAMINED (the third), not the first one left unread');
select is(left(pg_temp.labels(pg_temp.cand('a_sales', (pg_temp.cand('a_sales', null, null, 30, 3) -> 'next_cursor' ->> 'at'), (pg_temp.cand('a_sales', null, null, 30, 3) -> 'next_cursor' ->> 'id'), 30, 1000)), 5), 'o_old', 'F12 the next page starts after the cursor: s4 and s5 are terminal and skipped, then the oldest real candidate (o_old) is first');
select is(pg_temp.err('a_sales', p_limit => '30', p_scan => '5'), 'ok', 'F13 a cap equal to the terminal run is fine');
-- a forged cursor from another workspace's lead id finds nothing of theirs
select is(pg_temp.labels(pg_temp.cand('a_sales', '2000-01-01T00:00:00Z', tests.rid('b_lead')::text, 50, 1000)) ~ 'b_', false, 'F14 a cursor made of another workspace''s lead id returns none of that workspace''s leads');

-- ---------------------------------------------------------------------------------------------
-- G. the last e-mail or WhatsApp channel and the open draft
-- ---------------------------------------------------------------------------------------------
select pg_temp.mkl('c_mix', array[9], p_chan => 'whatsapp');
insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at) values (tests.rid('t_c_mix_p'), tests.tid('a'), tests.rid('c_mix'), tests.rid('c_mix_c'), 'out', 'phone', now() - interval '7 days');
create function pg_temp.item(p_label text, p_key text) returns text language sql as $$
  select e.item ->> p_key from jsonb_array_elements(pg_temp.cand('a_sales', null, null, 50, 1000) -> 'items') e(item) where (e.item ->> 'lead_id')::uuid = tests.rid(p_label) $$;
select is(pg_temp.item('c_mix', 'last_outbound_channel'), 'whatsapp', 'G1 the channel is the latest e-mail or WhatsApp touch: a newer phone call is not a draft channel');
select is(pg_temp.item('in_phone', 'last_outbound_channel'), null, 'G2 a lead whose outbound touches are all calls has no channel');
select is(pg_temp.item('in_due', 'last_outbound_channel'), 'email', 'G3 an e-mail touch gives e-mail');
select is(pg_temp.item('in_due', 'open_draft_id'), null, 'G4 no draft: no open draft');
-- an open draft (written the way a privileged fixture may; its fingerprint is the real one so it can be approved)
insert into public.followup_drafts (id, tenant_id, lead_id, contact_id, touch_number, channel, template_code, body, policy_version_id, engine_version, request_text, result_text, canonical_hash, state_hash, as_of)
values (tests.rid('d_in_due'), tests.tid('a'), tests.rid('in_due'), tests.rid('in_due_c'), 2, 'whatsapp', 'followup_gentle', 'Synthetic fixture draft body text', tests.rid('pol_c1'), '1.0.0', '{}', '{}', repeat('1', 64),
        app.followup_state_hash(tests.rid('in_due'), tests.rid('in_due_c'), 'whatsapp', tests.rid('pol_c1')), now());
select is(pg_temp.item('in_due', 'open_draft_id'), tests.rid('d_in_due')::text, 'G5 a waiting draft is named');
select is(pg_temp.item('in_due', 'open_draft_channel'), 'whatsapp', 'G6 ... with its channel');
select is(pg_temp.try('a_owner', format('select public.approve_followup_draft(%L, %L)', tests.rid('d_in_due'), (select state_hash from public.followup_drafts where id = tests.rid('d_in_due')))), 'ok', 'fixture: the draft is approved');
select is(pg_temp.item('in_due', 'open_draft_id'), tests.rid('d_in_due')::text, 'G7 an APPROVED draft is still open');
select is(pg_temp.try('a_owner', format('select public.discard_followup_draft(%L)', tests.rid('d_in_due'))), 'ok', 'fixture: the draft is discarded');
select is(pg_temp.item('in_due', 'open_draft_id'), null, 'G8 a discarded draft is not open');

-- ---------------------------------------------------------------------------------------------
-- H. no policy in force
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from public.followup_policy_versions where tenant_id = tests.tid('b')), 0::bigint, 'H0 workspace b has no follow-up policy');
select is(pg_temp.cand('b_owner', p_tenant => 'b'), '{"items": [], "next_cursor": null, "policy_in_force": false}'::jsonb, 'H1 with no policy: an empty list, no cursor, policy_in_force false');

-- ---------------------------------------------------------------------------------------------
-- I. safety: nothing is written
-- ---------------------------------------------------------------------------------------------
create temp table pg_temp.before_counts as select (select count(*) from public.lead_touches) t, (select count(*) from public.followup_drafts) d, (select count(*) from public.leads) l, (select count(*) from public.audit_events) a;
select pg_temp.cand('a_owner', null, null, 50, 1000);
select pg_temp.cand('a_sales', null, null, 5, 5);
select is((select (t, d, l, a) from pg_temp.before_counts), (select ((select count(*) from public.lead_touches), (select count(*) from public.followup_drafts), (select count(*) from public.leads), (select count(*) from public.audit_events))), 'I1 two calls changed no touch, draft, lead or audit row');

-- ---------------------------------------------------------------------------------------------
-- J. tenant isolation
-- ---------------------------------------------------------------------------------------------
insert into public.leads (id, tenant_id, company_id, status, created_at) values (tests.rid('bb_lead'), tests.tid('b'), tests.rid('b_company'), 'new', now() - interval '60 days');
insert into public.lead_touches (id, tenant_id, lead_id, direction, channel, occurred_at) values (tests.rid('t_bb'), tests.tid('b'), tests.rid('bb_lead'), 'out', 'email', now() - interval '3 days');
select is(exists (select 1 from jsonb_array_elements(pg_temp.cand('a_sales', null, null, 50, 1000) -> 'items') e(item) where (e.item ->> 'lead_id')::uuid = tests.rid('bb_lead')), false, 'J1 workspace a never sees workspace b''s lead');
select pg_temp.run('b_owner', format($q$select public.create_followup_policy_version(%L, %L, %L, %L::jsonb)$q$, tests.rid('pol_b1'), tests.tid('b'), pg_temp.today(), pg_temp.pol()));
select is(exists (select 1 from jsonb_array_elements(pg_temp.cand('b_owner', null, null, 50, 1000, 'b') -> 'items') e(item) where (e.item ->> 'lead_id')::uuid = tests.rid('bb_lead')), true, 'J2 workspace b sees its own lead once it has a policy');
select is((select count(*) from jsonb_array_elements(pg_temp.cand('b_owner', null, null, 50, 1000, 'b') -> 'items') e(item) join pg_temp.lab l on l.id = (e.item ->> 'lead_id')::uuid), 0::bigint, 'J3 ... and none of workspace a''s leads');

select * from finish();
rollback;
