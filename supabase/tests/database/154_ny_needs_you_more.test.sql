-- Today's "Needs you" gains three kinds (migration 20261228100000): a draft material quote, a draft campaign, a school's overdue fees (a count and a total, no name). Owner and Admin only.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.er_plant('a');

create function pg_temp.kinds(p_user text) returns text language plpgsql as $$
begin
  perform tests.as_aal('aal2');
  return tests.scalar_as(tests.uid(p_user), format($q$select coalesce(string_agg(x ->> 'kind', ',' order by x ->> 'kind'), '') from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') x$q$, tests.tid('a')));
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.item(p_user text, p_kind text, p_key text) returns text language plpgsql as $$
begin
  perform tests.as_aal('aal2');
  return tests.scalar_as(tests.uid(p_user), format($q$select x %s from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') x where x ->> 'kind' = %L limit 1$q$, p_key, tests.tid('a'), p_kind));
exception when others then return 'ERR:' || sqlstate;
end $$;

-- the planted material quote (number 1) was turned down; a second one, a DRAFT, waits
select tests.cn_guards_off();
insert into public.material_quotes (id, tenant_id, quote_no, requirement_id, enquiry_id, lead_id, status, policy_version_id, engine_version, request_text, result_text, canonical_hash, as_of, valid_until, trips,
                                    material_paise, transport_paise, handling_paise, laying_paise, tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval)
select tests.rid('a_ny_mq'), tenant_id, 2, requirement_id, enquiry_id, lead_id, 'draft', policy_version_id, engine_version, request_text, result_text, repeat('7', 64), as_of, valid_until, trips,
       4000000, 0, 0, 0, 200000, 4200000, 0, 4200000, false
  from public.material_quotes where id = tests.rid('a_er_mq');
select ok(pg_temp.kinds('a_owner') like '%material_quote_approval%', 'A1 a draft material quote is on the Owner''s Needs you');
select is(pg_temp.item('a_owner', 'material_quote_approval', $$->> 'ref'$$), '2', 'A2 with its quote number (the turned-down number 1 is not there)');
select is(pg_temp.item('a_owner', 'material_quote_approval', $$->> 'amount_paise'$$), '4200000', 'A3 and its total');
select is(pg_temp.item('a_owner', 'material_quote_approval', $$-> 'target' ->> 'type'$$), 'material_quote', 'A4 pointing at the materials quote');
select ok(pg_temp.kinds('a_admin') like '%material_quote_approval%', 'A5 an Admin sees it too');
select ok(pg_temp.kinds('a_sales') not like '%material_quote_approval%', 'A6 Sales is not asked');

-- B: a draft campaign (a reminder) waits for the OK
select ok(pg_temp.kinds('a_owner') like '%campaign_approval%', 'B1 a draft campaign is on Needs you');
select is(pg_temp.item('a_owner', 'campaign_approval', $$->> 'ref'$$), 'payment_due', 'B2 with its kind');
select ok(pg_temp.kinds('a_sales') not like '%campaign_approval%', 'B3 Sales is not asked');
select ok(pg_temp.kinds('b_owner') = 'ERR:42501' or pg_temp.kinds('b_owner') not like '%campaign_approval%', 'B4 another workspace''s owner sees none of it');

-- C: a school's overdue fees: one row, a count and a total (the dues themselves are pgTAP 106's; here they are a stand-in, so only the row is tested)
create or replace function app.edu_student_dues(p_tenant uuid, p_as_of date)
returns table (student_id uuid, programme_id uuid, group_id uuid, contact_id uuid, account_id uuid, due_paise bigint, pending_paise bigint, oldest_due date)
language sql stable security definer set search_path = '' as $f$
  select gen_random_uuid(), null::uuid, null::uuid, null::uuid, gen_random_uuid(), 9000::bigint, v.p, date '2026-10-01' from (values (5000::bigint), (2500::bigint), (0::bigint)) v(p) where p_tenant is not null
$f$;
select ok(pg_temp.kinds('a_owner') not like '%fees_overdue%', 'C1 a business without the fees module has no fees row');
select tests.cp_pack('a', 'education');
select ok(pg_temp.kinds('a_owner') like '%fees_overdue%', 'C2 a school has one');
select is(pg_temp.item('a_owner', 'fees_overdue', $$->> 'ref'$$), '2', 'C3 how many students owe (the one with nothing pending is not counted)');
select is(pg_temp.item('a_owner', 'fees_overdue', $$->> 'amount_paise'$$), '7500', 'C4 the total pending');
select is(pg_temp.item('a_owner', 'fees_overdue', $$->> 'customer'$$), null, 'C5 no child''s name');
select ok(pg_temp.kinds('a_sales') not like '%fees_overdue%', 'C6 Sales is not asked');
select is(tests.scalar_as(tests.uid('b_owner'), format($q$select (select students from app.today_fees_overdue(%L))::text$q$, tests.tid('a'))), '0', 'C7 the helper answers nothing for another workspace''s owner');
select is((select count(*) from jsonb_array_elements(tests.scalar_as(tests.uid('a_owner'), format($q$select public.today_summary(%L)::text$q$, tests.tid('a')))::jsonb -> 'needs_you') x where x ->> 'kind' = 'fees_overdue'), 1::bigint, 'C8 exactly one fees row');

select * from finish();
rollback;
