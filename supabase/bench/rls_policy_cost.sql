-- RLS policy cost benchmark (T003 / ADR 0004). Re-runnable; changes nothing: everything happens
-- in one transaction that is rolled back. Run against the LOCAL stack only:
--
--   make bench-rls                                   # defaults: 300 tenants x 400 rows = 120k
--   psql "$DB" -v tenants=1000 -v rows_per_tenant=500 -f supabase/bench/rls_policy_cost.sql
--
-- Compares, on identical data and for a caller who belongs to 1 tenant ("u1") or 5 tenants ("u5"):
--   A  the T002 pattern:   (select app.<fn>(tenant_id))    one call per ROW of the table
--   B  the shipped pattern: tenant_id = any (((select app.my_tenant_ids()))::uuid[])   one call per STATEMENT
-- B uses the real app.my_* helpers from migration 20261005090000, so this measures what ships.
-- Numbers are the best of 3 runs for reads (warm cache); writes run once.

\set ON_ERROR_STOP on
\if :{?tenants} \else \set tenants 300 \endif
\if :{?rows_per_tenant} \else \set rows_per_tenant 400 \endif
\if :{?people} \else \set people 50000 \endif
\pset pager off
\set QUIET on

begin;
select set_config('bench.tenants', :'tenants', true) as _ \gset

-- ---------------------------------------------------------------- tenants, users, memberships
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
select md5('bench-u'||i)::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
       'bench'||i||'@x.test', now(), now()
from generate_series(1, 400) i;
insert into public.tenants (id, name, slug)
select md5('bench-t'||i)::uuid, 'Bench '||i, 'bench-'||lpad(i::text, 6, '0') from generate_series(1, :tenants) i;
-- 1 owner + 3 sales per tenant from the user pool
insert into public.memberships (tenant_id, user_id, role)
select md5('bench-t'||i)::uuid, md5('bench-u'||(10 + (i % 300)))::uuid, 'owner' from generate_series(1, :tenants) i;
insert into public.memberships (tenant_id, user_id, role)
select md5('bench-t'||i)::uuid, md5('bench-u'||(311 + ((i*7+k) % 80)))::uuid, 'sales'
from generate_series(1, :tenants) i, generate_series(1, 3) k;
-- u1: member of tenant 1 only. u5: member of tenants 1..5.
insert into public.memberships (tenant_id, user_id, role) values (md5('bench-t1')::uuid, md5('bench-u1')::uuid, 'sales');
insert into public.memberships (tenant_id, user_id, role)
select md5('bench-t'||i)::uuid, md5('bench-u2')::uuid, 'sales' from generate_series(1, 5) i;

-- --------------------------------------------- the T002 pattern, kept here as the baseline (A)
create function app.bench_is_member(p_tenant uuid) returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = auth.uid()) $$;
create function app.bench_has_role(p_tenant uuid, p_roles public.app_role[]) returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.role = any (p_roles)) $$;
create function app.bench_shares(p_user uuid) returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.memberships a join public.memberships b on b.tenant_id = a.tenant_id where a.user_id = auth.uid() and b.user_id = p_user) $$;
grant execute on function app.bench_is_member(uuid), app.bench_has_role(uuid, public.app_role[]), app.bench_shares(uuid) to authenticated;

-- ------------------------------------------------------------------------------ parent + child
create table public.bench_seed as
select md5('p'||i)::uuid as id, md5('bench-t'||(1 + (i % :tenants)))::uuid as tenant_id, 'name '||i as name,
       now() - (i || ' seconds')::interval as created_at
from generate_series(1, :tenants * :rows_per_tenant) i;

do $$
declare p text;
begin
  foreach p in array array['a', 'b'] loop
    execute format('create table public.%1$s_parent (id uuid primary key, tenant_id uuid not null references public.tenants(id), name text, created_at timestamptz not null, unique (tenant_id, id))', p);
    execute format('create table public.%1$s_child (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, parent_id uuid not null, note text, foreign key (tenant_id, parent_id) references public.%1$s_parent (tenant_id, id))', p);
    execute format('insert into public.%1$s_parent select * from public.bench_seed', p);
    execute format('insert into public.%1$s_child (tenant_id, parent_id, note) select tenant_id, id, ''n'' from public.%1$s_parent', p);
    execute format('create index %1$s_parent_tc on public.%1$s_parent (tenant_id, created_at desc)', p);
    execute format('create index %1$s_child_tp on public.%1$s_child (tenant_id, parent_id)', p);
    execute format('alter table public.%1$s_parent enable row level security; alter table public.%1$s_parent force row level security', p);
    execute format('alter table public.%1$s_child enable row level security; alter table public.%1$s_child force row level security', p);
    execute format('grant select, insert, update on public.%1$s_parent, public.%1$s_child to authenticated', p);
  end loop;
end $$;

create policy sel on public.a_parent for select to authenticated using ((select app.bench_is_member(tenant_id)));
create policy sel on public.a_child  for select to authenticated using ((select app.bench_is_member(tenant_id)));
create policy ins on public.a_parent for insert to authenticated with check ((select app.bench_has_role(tenant_id, array['owner','admin','sales']::public.app_role[])));
create policy upd on public.a_parent for update to authenticated
  using ((select app.bench_has_role(tenant_id, array['owner','admin','sales']::public.app_role[])))
  with check ((select app.bench_has_role(tenant_id, array['owner','admin','sales']::public.app_role[])));

create policy sel on public.b_parent for select to authenticated using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]));
create policy sel on public.b_child  for select to authenticated using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]));
create policy ins on public.b_parent for insert to authenticated
  with check (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner','admin','sales']::public.app_role[])))::uuid[]));
create policy upd on public.b_parent for update to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner','admin','sales']::public.app_role[])))::uuid[]))
  with check (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner','admin','sales']::public.app_role[])))::uuid[]));

-- ---------------------------------------------------------------- users-table (co-member) case
create table public.bench_people as
select md5('bench-u'||i)::uuid as id from generate_series(1, 400) i
union all
select md5('extra'||i)::uuid from generate_series(1, :people) i;
alter table public.bench_people add primary key (id);
alter table public.bench_people enable row level security;
alter table public.bench_people force row level security;
grant select on public.bench_people to authenticated;
-- A: per-row sharing check.  B: co-member list once per statement.
create policy a_sel on public.bench_people for select to authenticated
  using (id = (select auth.uid()) or (select app.bench_shares(id)));

analyze public.a_parent; analyze public.b_parent; analyze public.a_child; analyze public.b_child;
analyze public.bench_people; analyze public.memberships;

select format('%s tenants, %s parent rows (+ same in child), %s memberships, %s people',
              (select count(*) from public.tenants where slug like 'bench-%'),
              (select count(*) from public.a_parent), (select count(*) from public.memberships),
              (select count(*) from public.bench_people)) as dataset \gset
\echo
\echo Dataset: :dataset
\echo
\echo 'pattern A = per-row helper (T002)    pattern B = once-per-statement tenant list (shipped)'
\echo 'caller owns ~rows_per_tenant rows; "u5" belongs to 5 tenants. milliseconds, lower is better.'
\echo

do $$
declare
  reads text[][] := array[
    ['count(*) whole table',        'select count(*) from public.{p}_parent'],
    ['list 50 newest, one tenant',  'select id from public.{p}_parent where tenant_id = md5(''bench-t1'')::uuid order by created_at desc limit 50'],
    ['primary-key lookup',          'select * from public.{p}_parent where id = md5(''p''||(select current_setting(''bench.tenants'')::int))::uuid'],
    ['parent-child join count',     'select count(*) from public.{p}_parent p join public.{p}_child c on c.tenant_id = p.tenant_id and c.parent_id = p.id']
  ];
  writes text[][] := array[
    ['insert 2000 rows',            'insert into public.{p}_parent select md5(''{u}-{p}-''||i)::uuid, md5(''bench-t1'')::uuid, ''x'', now() from generate_series(1,2000) i'],
    ['update all rows in tenant',   'update public.{p}_parent set name = ''y'' where tenant_id = md5(''bench-t1'')::uuid']
  ];
  who text[] := array['u1', 'u5'];
  u text; p text; i int; run int; q text; line text; ms numeric; best numeric; ra numeric; rb numeric;
begin
  foreach u in array who loop
    perform set_config('request.jwt.claims', json_build_object('sub', md5('bench-u' || case u when 'u1' then '1' else '2' end)::uuid, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', md5('bench-u' || case u when 'u1' then '1' else '2' end)::uuid::text, true);
    perform set_config('role', 'authenticated', true);

    for i in 1 .. array_length(reads, 1) loop
      foreach p in array array['a', 'b'] loop
        q := replace(replace(reads[i][2], '{p}', p), '{u}', u);
        best := null;
        for run in 1 .. 3 loop
          for line in execute 'explain (analyze, costs off, summary on) ' || q loop
            if line like 'Execution Time:%' then ms := substring(line from '[0-9.]+')::numeric; end if;
          end loop;
          best := least(coalesce(best, ms), ms);
        end loop;
        if p = 'a' then ra := best; else rb := best; end if;
      end loop;
      raise notice '%', format('%-4s %-28s  A %10s   B %10s   (%sx)', u, reads[i][1], to_char(ra, 'FM999990.00'), to_char(rb, 'FM999990.00'), round(ra / greatest(rb, 0.01)));
    end loop;

    for i in 1 .. array_length(writes, 1) loop
      foreach p in array array['a', 'b'] loop
        q := replace(replace(writes[i][2], '{p}', p), '{u}', u);
        for line in execute 'explain (analyze, costs off, summary on) ' || q loop
          if line like 'Execution Time:%' then ms := substring(line from '[0-9.]+')::numeric; end if;
        end loop;
        if p = 'a' then ra := ms; else rb := ms; end if;
      end loop;
      raise notice '%', format('%-4s %-28s  A %10s   B %10s   (%sx)', u, writes[i][1], to_char(ra, 'FM999990.00'), to_char(rb, 'FM999990.00'), round(ra / greatest(rb, 0.01)));
    end loop;

    -- users-table case (A first, then B after swapping the policy)
    ra := null;
    for run in 1 .. 3 loop
      for line in execute 'explain (analyze, costs off, summary on) select count(*) from public.bench_people' loop
        if line like 'Execution Time:%' then ms := substring(line from '[0-9.]+')::numeric; end if;
      end loop;
      ra := least(coalesce(ra, ms), ms);
    end loop;
    perform set_config('role', 'postgres', true);
    drop policy a_sel on public.bench_people;
    create policy b_sel on public.bench_people for select to authenticated
      using (id = (select auth.uid()) or id = any (((select app.my_co_member_ids()))::uuid[]));
    perform set_config('role', 'authenticated', true);
    best := null;
    for run in 1 .. 3 loop
      for line in execute 'explain (analyze, costs off, summary on) select count(*) from public.bench_people' loop
        if line like 'Execution Time:%' then ms := substring(line from '[0-9.]+')::numeric; end if;
      end loop;
      best := least(coalesce(best, ms), ms);
    end loop;
    raise notice '%', format('%-4s %-28s  A %10s   B %10s   (%sx)', u, 'users: count(*) co-members', to_char(ra, 'FM999990.00'), to_char(best, 'FM999990.00'), round(ra / greatest(best, 0.01)));
    -- restore A for the next caller
    perform set_config('role', 'postgres', true);
    drop policy b_sel on public.bench_people;
    create policy a_sel on public.bench_people for select to authenticated
      using (id = (select auth.uid()) or (select app.bench_shares(id)));
    ra := null;
  end loop;
  perform set_config('role', 'postgres', true);
end $$;

rollback;
