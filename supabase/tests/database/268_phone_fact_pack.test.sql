-- The phone assistant's fact pack (migration 20261231988600): only the scheduler account reads it; it holds one workspace's notes, hours, catalogue and price list and nothing of another's.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');

create function pg_temp.w(p_sql text, p_user text default 'outsider') returns text language plpgsql as $$
begin return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'phone_fact_pack'
            and p.prosecdef and p.proconfig @> array['search_path=""'] and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')), 1::bigint,
          'A1: a SECURITY DEFINER function with an empty search_path, for authenticated callers only');
select is(pg_temp.w(format($q$select public.phone_fact_pack(%L)::text$q$, tests.tid('a')), 'a_owner'), 'ERR:42501', 'A2: a workspace owner cannot read it');
select is(pg_temp.w(format($q$select public.phone_fact_pack(%L)::text$q$, tests.tid('a')), 'a_owner') like 'ERR:%', true, 'A3: nor any member');

-- rows for two workspaces (the triggers that audit the owner's writes are skipped: this is test data)
set local session_replication_role = replica;
insert into public.assistant_context_versions (tenant_id, version, notes, change) values (tests.tid('a'), 1, 'We sell silk sarees. Payment by UPI.', 'added 2 lines'), (tests.tid('b'), 1, 'Tenant B only: wholesale cotton.', 'added 1 line');
reset session_replication_role;

select is(pg_temp.w(format($q$select (public.phone_fact_pack(%L)) ->> 'notes'$q$, tests.tid('a'))), 'We sell silk sarees. Payment by UPI.', 'B1: the scheduler reads workspace A''s notes');
select is(pg_temp.w(format($q$select (public.phone_fact_pack(%L)) ->> 'notes'$q$, tests.tid('b'))), 'Tenant B only: wholesale cotton.', 'B2: and B''s own for B, never A''s in B''s pack');
select is(pg_temp.w(format($q$select jsonb_typeof((public.phone_fact_pack(%L)) -> 'prices') || ',' || jsonb_typeof((public.phone_fact_pack(%L)) -> 'catalogue') || ',' || jsonb_typeof((public.phone_fact_pack(%L)) -> 'faqs')$q$, tests.tid('a'), tests.tid('a'), tests.tid('a'))), 'array,array,array', 'B3: without a price list, a catalogue or FAQs the lists are empty arrays');
select is(pg_temp.w(format($q$select jsonb_array_length((public.phone_fact_pack(%L)) -> 'prices')::text$q$, tests.tid('a'))), '0', 'B4: no price list: no amount can be said');
select is(pg_temp.w($q$select public.phone_fact_pack(null)::text$q$), 'ERR:42501', 'B5: no workspace is a refusal');

-- C. what the phone assistant knows, as counts for the owner (migration 988900): any member reads it, another workspace's member does not
select is(pg_temp.w(format($q$select (public.phone_assistant_knows(%L))::text$q$, tests.tid('a')), 'a_owner') like '%"price_rows": 0%', true, 'C1: a member reads the counts (no price list: 0 rows)');
select is(pg_temp.w(format($q$select (public.phone_assistant_knows(%L) ->> 'notes_lines')$q$, tests.tid('a')), 'a_owner'), '1', 'C2: the notes count their non-empty lines');
select is(pg_temp.w(format($q$select public.phone_assistant_knows(%L)::text$q$, tests.tid('a')), 'b_owner'), 'ERR:42501', 'C3: another workspace''s member cannot read it');
select is(pg_temp.w(format($q$select jsonb_typeof((public.phone_fact_pack(%L)) -> 'holidays')$q$, tests.tid('a'))), 'array', 'C4: the pack carries the holidays list (empty when the owner set none)');

select * from finish();
rollback;
