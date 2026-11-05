-- The sidebar's counts (migration 20261231130000): one read, each field by the caller's role; NULL = not for you; a non-member is refused.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.open_gate('a');

create function pg_temp.q(p_user text, p_sql text) returns text language plpgsql as $$
begin
  return tests.scalar_as(tests.uid(p_user), format(p_sql, tests.tid('a')));
exception when others then return 'ERR:' || sqlstate;
end $$;

select ok(pg_temp.q('a_owner', $q$select public.nav_counts(%L)::text$q$) like '{%', 'A1 the Owner reads the counts');
select is(pg_temp.q('a_owner', $q$select (select count(*) from jsonb_object_keys(public.nav_counts(%L)))::text$q$), '13', 'A2 the thirteen fields of the contract');
select is(pg_temp.q('b_owner', format($q$select public.nav_counts(%L)::text$q$, tests.tid('a'))), 'ERR:42501', 'A3 another workspace''s Owner: refused');
select is(pg_temp.q('outsider', $q$select public.nav_counts(%L)::text$q$), 'ERR:42501', 'A4 a non-member: refused');

select ok(pg_temp.q('a_owner', $q$select (public.nav_counts(%L) -> 'ai_usage' ->> 'period')$q$) = 'month', 'B1 the Owner sees the AI month');
select ok(pg_temp.q('a_admin', $q$select (public.nav_counts(%L) -> 'call_minutes')::text$q$) <> 'null', 'B2 an Admin sees the call minutes');
select is(pg_temp.q('a_sales', $q$select jsonb_build_array(n -> 'ai_usage', n -> 'call_minutes', n -> 'quotes_waiting')::text from public.nav_counts(%L) n$q$), '[null, null, null]', 'B3 Sales: no money, no minutes, no quotes');
select is(pg_temp.q('a_viewer', $q$select jsonb_build_array(n -> 'new_leads', n -> 'live_calls', n -> 'unread_chats', n -> 'followups_due', n -> 'prospects_needing_owner')::text from public.nav_counts(%L) n$q$),
          '[null, null, null, null, null]', 'B4 a Viewer: none of the work counts');
select ok(pg_temp.q('a_viewer', $q$select (public.nav_counts(%L) ->> 'needs_you')$q$) ~ '^[0-9]+$' and pg_temp.q('a_viewer', $q$select (public.nav_counts(%L) ->> 'plan')$q$) is not null,
          'B5 a Viewer still gets Today''s number and the plan');

select is(pg_temp.q('a_owner', $q$select (public.nav_counts(%L) ->> 'needs_you')$q$), pg_temp.q('a_owner', $q$select public.today_summary(%L) -> 'cards' ->> 'waiting'$q$), 'C1 needs_you is Today''s own number');
select ok((pg_temp.q('a_owner', $q$select (public.nav_counts(%L) ->> 'new_leads')$q$))::int >= 0, 'C2 new leads: a number for the Owner');
select is(pg_temp.q('a_owner', $q$select (public.nav_counts(%L) ->> 'live_calls')$q$), '0', 'C3 no call in progress');

select * from finish();
rollback;
