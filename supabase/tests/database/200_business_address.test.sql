-- The shop's street address (Settings > About my business): a street line, the area and a PIN code next to the town and phone. Read by any member, saved by the Owner.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin
  perform tests.as_aal('aal2');
  return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.bget(p_user text, p_tenant text default 'a') returns text language sql as $$ select pg_temp.val(p_user, format('select public.workspace_business_get(%L)::text', tests.tid(p_tenant))) $$;
create function pg_temp.bset(p_user text, p_patch text, p_tenant text default 'a') returns text language sql as $$ select pg_temp.val(p_user, format('select public.workspace_business_set(%L, %L::jsonb)::text', tests.tid(p_tenant), p_patch)) $$;

select is(pg_temp.j(pg_temp.bget('a_owner'), 'address_line'), null, 'A1: no address yet');
select is(pg_temp.j(pg_temp.bset('a_owner', '{"address_line":"12-4-56, Gandhi Road","area":"Dharmavaram","pincode":"515671"}'), 'address_line'), '12-4-56, Gandhi Road', 'A2: the Owner saves a street line');
select is(pg_temp.j(pg_temp.bget('a_owner'), 'area'), 'Dharmavaram', 'A3: and the area');
select is(pg_temp.j(pg_temp.bget('a_owner'), 'pincode'), '515671', 'A4: and the PIN code');
select is(pg_temp.j(pg_temp.bget('a_viewer'), 'address_line'), '12-4-56, Gandhi Road', 'A5: any member reads it');
select is(pg_temp.bget('b_owner', 'a'), 'ERR:42501', 'A6: another business reads nothing of ours');
select is(pg_temp.bget('anon'), 'ERR:42501', 'A7: nor anon');
select is(pg_temp.j(pg_temp.bget('b_owner', 'b'), 'address_line'), null, 'A8: business B has its own, empty address');

select is(pg_temp.bset('a_admin', '{"area":"Changed"}'), 'ERR:42501', 'B1: an Admin cannot save it (like the town and phone: the Owner only)');
select is(pg_temp.bset('a_sales', '{"area":"Changed"}'), 'ERR:42501', 'B2: nor Sales');
select is(pg_temp.bset('b_owner', '{"area":"Changed"}', 'a'), 'ERR:42501', 'B3: nor another business''s Owner');
select is(pg_temp.bset('anon', '{"area":"Changed"}'), 'ERR:42501', 'B4: nor anon');
select is(pg_temp.j(pg_temp.bget('a_owner'), 'area'), 'Dharmavaram', 'B5: nothing changed');

select is(pg_temp.bset('a_owner', '{"pincode":"12345"}'), 'ERR:22023', 'C1: five digits is not a PIN code');
select is(pg_temp.bset('a_owner', '{"pincode":"012345"}'), 'ERR:22023', 'C2: a PIN code does not start with 0');
select is(pg_temp.bset('a_owner', '{"pincode":"51567A"}'), 'ERR:22023', 'C3: nor has letters');
select is(pg_temp.bset('a_owner', '{"address_line":"ab"}'), 'ERR:22023', 'C4: a street line of two characters is too short');
select is(pg_temp.bset('a_owner', format('{"address_line":"%s"}', repeat('x', 161))), 'ERR:22023', 'C5: and over 160 is too long');
select is(pg_temp.bset('a_owner', E'{"area":"Gandhi\\u200bRoad"}'), 'ERR:22023', 'C6: invisible characters are refused (the same hygiene as every free-text field)');
select is(pg_temp.bset('a_owner', '{"area":5}'), 'ERR:22023', 'C7: it must be text');
select is(pg_temp.bset('a_owner', '{"street":"x"}'), 'ERR:22023', 'C8: an unknown field is still refused');
select is(pg_temp.j(pg_temp.bget('a_owner'), 'pincode'), '515671', 'C9: after all the refusals the address is as it was');

select is(pg_temp.j(pg_temp.bset('a_owner', '{"pincode":null}'), 'pincode'), null, 'D1: null clears the PIN code');
select is(pg_temp.j(pg_temp.bget('a_owner'), 'address_line'), '12-4-56, Gandhi Road', 'D2: the other fields stay');
select is(pg_temp.j(pg_temp.bset('a_owner', '{"address_line":"  Shop 7, Main Bazaar  "}'), 'address_line'), 'Shop 7, Main Bazaar', 'D3: spaces around it are trimmed');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'workspace.business_saved' and new_values -> 'changed' ? 'address_line'), 2::bigint, 'D4: each save is in the audit trail, saying which field changed (not the address itself)');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'workspace.business_saved' and new_values::text like '%Gandhi%'), 0::bigint, 'D5: the address text is NOT copied into the audit trail');

select is(pg_temp.j(pg_temp.bset('a_owner', '{"city":"Dharmavaram","phone":"+91 98765 43210"}'), 'city'), 'Dharmavaram', 'E1: the older fields still save');
select is(pg_temp.j(pg_temp.bget('a_owner'), 'address_line'), 'Shop 7, Main Bazaar', 'E2: without touching the address');

select * from finish();
rollback;
