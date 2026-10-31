-- Job OR (migration 20261224150000): the live activity feed. A catalog and roles  B only what is happening now  C who, and who may see it  D one workspace only
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal1'); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.feed(p_user text, p_tenant text default 'a') returns jsonb language sql as $$
  select case when r like 'ERR:%' then jsonb_build_array(r) else r::jsonb end from (select pg_temp.sc(p_user, format($q$select public.assistant_activity(%L)::text$q$, tests.tid(p_tenant))) as r) x $$;

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'assistant_activity' and p.prosecdef and p.proconfig @> array['search_path=""']
            and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')), 1::bigint, 'A1: SECURITY DEFINER, empty search_path, not for anon');
select is(pg_temp.feed('a_owner'), '[]'::jsonb, 'B1: nothing is happening: an empty list (the screen says "All caught up")');

-- the AI lead reader read the lead just now
insert into public.lead_profiles (tenant_id, lead_id, ai_read_at, ai_reads, ai_read_messages) values (tests.tid('a'), tests.rid('a_lead'), now() - interval '5 seconds', 1, 1);
select is(jsonb_array_length(pg_temp.feed('a_owner')), 1, 'B2: a lead read a few seconds ago is one item');
select is(pg_temp.feed('a_owner') -> 0 ->> 'type', 'lead_read', 'B3: ...of type lead_read');
select is(pg_temp.feed('a_owner') -> 0 ->> 'target_kind', 'lead', 'B4: ...that links to the lead');
select is(pg_temp.feed('a_owner') -> 0 ->> 'target_id', tests.rid('a_lead')::text, 'B5: ...by its id');
select ok((pg_temp.feed('a_owner') -> 0 ->> 'elapsed_s')::int between 4 and 20, 'B6: with the seconds it has been going');
select ok(not (pg_temp.feed('a_owner') -> 0 ? 'body') and not (pg_temp.feed('a_owner') -> 0 ? 'text') and not (pg_temp.feed('a_owner') -> 0 ? 'message'), 'B7: no message content in an item');
update public.lead_profiles set ai_read_at = now() - interval '2 minutes' where lead_id = tests.rid('a_lead');
select is(pg_temp.feed('a_owner'), '[]'::jsonb, 'B8: a read older than a minute is no longer "now"');
update public.lead_profiles set ai_read_at = now() - interval '5 seconds' where lead_id = tests.rid('a_lead');

select is(pg_temp.feed('a_owner') -> 0 ->> 'name', 'Contact a', 'C1: the Owner is told who');
select is(pg_temp.feed('a_sales') -> 0 ->> 'name', 'Contact a', 'C2: so is Sales');
select is(pg_temp.feed('a_viewer') -> 0 ->> 'name', null, 'C3: a Viewer sees the work, not the person');
select is(pg_temp.feed('a_viewer') -> 0 ->> 'phone', null, 'C4: nor the number');

select is(pg_temp.feed('b_owner', 'b'), '[]'::jsonb, 'D1: another workspace sees none of it');
select is(pg_temp.feed('a_owner', 'b'), '["ERR:42501"]'::jsonb, 'D2: nor can a member of one ask about the other');
select is(pg_temp.feed('anon'), '["ERR:42501"]'::jsonb, 'D3: anon is nobody');
select * from finish();
rollback;
