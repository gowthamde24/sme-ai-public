-- GENERIC CROSS-TENANT + ROLE-MATRIX TEST.
-- Loops over tests.tenant_table_registry (the guard in 06 fails if a tenant-owned table is not
-- registered, so every table is covered automatically). For every table it asserts, with real
-- identities, BOTH the allowed and the denied outcome of select / insert / update / delete:
--   * cross-tenant: every role of tenant A against tenant B, and B against A
--   * within a tenant: every role against the role matrix (tests.role_matrix)
--   * anon and a user with no tenant
-- Outcomes come from tests.outcome_as: 'rows:<n>' or the SQLSTATE.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.make_pool_users(60);

create function pg_temp.render(p_template text, p_tenant uuid, p_id uuid, p_pool int) returns text
language sql as $$
  select format(
    p_template,
    p_tenant,
    p_id,
    tests.rid((case p_tenant when tests.tid('a') then 'a' else 'b' end) || '_company'),
    tests.rid((case p_tenant when tests.tid('a') then 'a' else 'b' end) || '_contact'),
    tests.pool_uid(p_pool)
  )
$$;

create function pg_temp.generic_checks() returns setof text
language plpgsql as $$
declare
  r        record;
  m        record;
  tenants  text[] := array['a', 'b'];
  roles    text[] := array['owner', 'admin', 'sales', 'viewer'];
  own      text;
  other    text;
  v_role   text;
  uid      uuid;
  pool     int := 0;
  rid      uuid;
  outc     text;
  who      text;
begin
  for r in select * from tests.tenant_table_registry order by table_name loop
    pool := 0;  -- each table starts a fresh run through the (60-user) pool; one table needs about 35
    -- Fixture rows, built privileged: one in each tenant.
    foreach own in array tenants loop
      pool := pool + 1;
      rid := gen_random_uuid();
      execute pg_temp.render(r.insert_sql, tests.tid(own), rid, pool);
    end loop;

    foreach own in array tenants loop
      other := case own when 'a' then 'b' else 'a' end;

      foreach v_role in array roles loop
        uid := tests.uid(own || '_' || v_role);
        who := r.table_name || ': ' || own || '_' || v_role;
        select * into m from tests.role_matrix where table_name = r.table_name and tests.role_matrix.role = v_role;

        -- ===== cross-tenant: nothing of the other tenant is visible or writable =====
        return next is(
          tests.outcome_as(uid, format('select 1 from public.%I where tenant_id = %L', r.table_name, tests.tid(other))),
          'rows:0', who || ' -> other tenant: DENY select');
        return next ok(
          tests.outcome_as(uid, format('update public.%I set %s where tenant_id = %L', r.table_name, r.update_set, tests.tid(other)))
            in ('rows:0', '42501'),
          who || ' -> other tenant: DENY update (0 rows or 42501)');
        return next ok(
          tests.outcome_as(uid, format('delete from public.%I where tenant_id = %L', r.table_name, tests.tid(other)))
            in ('rows:0', '42501'),
          who || ' -> other tenant: DENY delete (0 rows or 42501)');
        pool := pool + 1;
        return next is(
          tests.outcome_as(uid, pg_temp.render(r.insert_sql, tests.tid(other), gen_random_uuid(), pool)),
          '42501', who || ' -> other tenant: DENY insert');

        -- ===== within the tenant: exactly what the role matrix says =====
        outc := tests.outcome_as(uid, format('select 1 from public.%I where tenant_id = %L', r.table_name, tests.tid(own)));
        if m.can_select then
          return next ok(outc ~ '^rows:[1-9]', who || ': ALLOW select (' || outc || ')');
        else
          return next is(outc, 'rows:0', who || ': DENY select');
        end if;

        outc := tests.outcome_as(uid, format('update public.%I set %s where tenant_id = %L', r.table_name, r.update_set, tests.tid(own)));
        if m.can_update then
          return next ok(outc ~ '^rows:[1-9]', who || ': ALLOW update (' || outc || ')');
        else
          return next ok(outc in ('rows:0', '42501'), who || ': DENY update (' || outc || ')');
        end if;

        pool := pool + 1;
        outc := tests.outcome_as(uid, pg_temp.render(r.insert_sql, tests.tid(own), gen_random_uuid(), pool));
        if m.can_insert then
          return next is(outc, 'rows:1', who || ': ALLOW insert');
        else
          return next is(outc, '42501', who || ': DENY insert');
        end if;

        -- delete: a disposable row so the run is not destructive for later roles
        pool := pool + 1;
        rid := gen_random_uuid();
        execute pg_temp.render(r.insert_sql, tests.tid(own), rid, pool);
        outc := tests.outcome_as(uid, pg_temp.render(r.delete_sql, tests.tid(own), rid, pool));
        if m.can_delete then
          return next is(outc, 'rows:1', who || ': ALLOW delete');
        else
          return next ok(outc in ('rows:0', '42501'), who || ': DENY delete (' || outc || ')');
        end if;
      end loop;
    end loop;

    -- ===== anon: no privilege at all =====
    return next is(tests.outcome_as(null, format('select 1 from public.%I', r.table_name)), '42501', r.table_name || ': anon DENY select');
    return next is(tests.outcome_as(null, pg_temp.render(r.insert_sql, tests.tid('a'), gen_random_uuid(), 1)), '42501', r.table_name || ': anon DENY insert');
    return next is(tests.outcome_as(null, format('update public.%I set %s', r.table_name, r.update_set)), '42501', r.table_name || ': anon DENY update');
    return next is(tests.outcome_as(null, format('delete from public.%I', r.table_name)), '42501', r.table_name || ': anon DENY delete');

    -- ===== signed in but a member of nothing =====
    foreach own in array tenants loop
      return next is(
        tests.outcome_as(tests.uid('outsider'), format('select 1 from public.%I where tenant_id = %L', r.table_name, tests.tid(own))),
        'rows:0', r.table_name || ': outsider sees nothing of tenant ' || own);
      pool := pool + 1;
      return next is(
        tests.outcome_as(tests.uid('outsider'), pg_temp.render(r.insert_sql, tests.tid(own), gen_random_uuid(), pool)),
        '42501', r.table_name || ': outsider DENY insert into tenant ' || own);
    end loop;
  end loop;
end $$;

select * from pg_temp.generic_checks();

-- the registry is not vacuous
select cmp_ok((select count(*) from tests.tenant_table_registry), '>=', 8::bigint, 'registry covers the tenant-owned tables');

select * from finish();
rollback;
