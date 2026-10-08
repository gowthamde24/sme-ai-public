-- COMPOSITE FOREIGN KEYS: a row can never reference another tenant's row.
-- The database checks foreign keys WITHOUT applying RLS, so a plain `parent_id` FK would happily
-- accept a tenant B id from a tenant A row. These tests try exactly that, as the privileged
-- session user and as a tenant-A Owner, and require the SAME error for a foreign id as for an
-- id that does not exist (so the error cannot be used to probe other tenants).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_evidence();
select tests.seed_t005();
select tests.seed_agents();
select tests.seed_t008();
select tests.seed_t009();
select tests.seed_orders();
select tests.seed_followups();

-- privileged equivalent of tests.error_shape_as
create function pg_temp.err_shape(p_sql text) returns text
language plpgsql as $$
declare v_constraint text; v_table text;
begin
  begin
    execute p_sql;
    return 'ok';
  exception when others then
    get stacked diagnostics v_constraint = constraint_name, v_table = table_name;
    return sqlstate || ':' || coalesce(v_constraint, '') || ':' || coalesce(v_table, '');
  end;
end $$;

-- ===================== A. catalog-driven: EVERY two-column composite FK between tenant tables
-- Re-point the FK column of a tenant-A child row at (1) a tenant-B parent, (2) a nonexistent id.
create function pg_temp.fk_checks() returns setof text
language plpgsql as $$
declare
  k          record;
  reg        record;
  child_id   uuid;
  -- text, not uuid: a parent column can be a code (quote_lines.item_type_code -> item_types.code); format('%L') quotes either kind the same way
  foreign_v  text;
  missing_v  text := gen_random_uuid()::text;
  upd        text;
  p_foreign  text; p_missing text; o_foreign text; o_missing text;
  label      text;
  can_update boolean;
  immutable_row boolean;
begin
  for k in
    select c.conname, cr.relname as child, ac.attname as child_col, pr.relname as parent, ap.attname as parent_col
      from pg_constraint c
      join pg_class cr on cr.oid = c.conrelid
      join pg_namespace n on n.oid = cr.relnamespace and n.nspname = 'public'
      join pg_class pr on pr.oid = c.confrelid
      join pg_attribute ac on ac.attrelid = c.conrelid and ac.attnum = c.conkey[2]
      join pg_attribute ap on ap.attrelid = c.confrelid and ap.attnum = c.confkey[2]
     where c.contype = 'f' and cardinality(c.conkey) = 2
       and (select attname from pg_attribute where attrelid = c.conrelid and attnum = c.conkey[1]) = 'tenant_id'
       and (select attname from pg_attribute where attrelid = c.confrelid and attnum = c.confkey[1]) = 'tenant_id'
     order by cr.relname, c.conname
  loop
    label := k.child || '.' || k.child_col || ' -> ' || k.parent || '.' || k.parent_col;
    select * into reg from tests.tenant_table_registry where table_name = k.child;
    if not found then
      return next fail(label || ': child table is not in the registry');
      continue;
    end if;

    -- a child row in tenant A (privileged), and a real tenant-B value for the parent column
    child_id := gen_random_uuid();
    execute format(reg.insert_sql, tests.tid('a'), child_id, tests.rid('a_company'), tests.rid('a_contact'), tests.pool_uid(1));
    -- A tenant-B value that is NOT also a value of tenant A (the fixture user `dual` belongs to both
    -- tenants, so pointing at it would be a legitimate reference, not an attack).
    execute format(
      'select p.%1$I from public.%2$I p where p.tenant_id = %3$L
          and not exists (select 1 from public.%2$I q where q.tenant_id = %4$L and q.%1$I = p.%1$I) limit 1',
      k.parent_col, k.parent, tests.tid('b'), tests.tid('a')) into foreign_v;
    if foreign_v is null then
      return next fail(label || ': no tenant-B parent row to aim at');
      continue;
    end if;

    upd := format('update public.%I set %I = %%L where %s',
                  k.child, k.child_col,
                  case when k.child = 'consent_events' then format('id = %L', child_id) else format('id = %L', child_id) end);

    p_foreign := pg_temp.err_shape(format(upd, foreign_v));
    p_missing := pg_temp.err_shape(format(upd, missing_v));
    -- Append-only tables (the consent ledger) refuse ANY update before a foreign key is even
    -- consulted; their insert path is attacked in section B.
    -- T004 tables are immutable apart from archived_at (app.guard_immutable_record): the same.
    immutable_row := exists (select 1 from pg_trigger t join pg_proc fp on fp.oid = t.tgfoid
                              where t.tgrelid = format('public.%I', k.child)::regclass
                                and not t.tgisinternal
                                and fp.pronamespace = 'app'::regnamespace
                                and fp.proname in ('append_only', 'guard_immutable_record', 'quote_guard_update', 'order_guard_update',
                                                            'followup_drafts_guard_update', 'question_drafts_guard_update'));
    -- agent_runs.lead_id / enquiry_id: the fixture run already has a company target, so re-pointing lead_id trips the exactly-one-target
    -- CHECK (23514) before the foreign key; foreign and missing still fail identically (next assertion). The INSERT path of the
    -- same references is attacked in 30_agent_runs_schema.
    return next ok(p_foreign like (case when immutable_row then '42501:%'
                                        when k.child = 'agent_runs' and k.child_col in ('lead_id', 'enquiry_id') then '23514:%'
                                        else '23503:%' end),
                   label || ': privileged re-point at tenant B is refused (' || p_foreign || ')');
    return next is(p_foreign, p_missing, label || ': privileged, foreign id fails exactly like a nonexistent id');

    can_update := has_column_privilege('authenticated', format('public.%I', k.child)::regclass, k.child_col, 'UPDATE');
    o_foreign := tests.error_shape_as(tests.uid('a_owner'), format(upd, foreign_v));
    o_missing := tests.error_shape_as(tests.uid('a_owner'), format(upd, missing_v));
    if can_update and not immutable_row then
      return next ok(o_foreign like '23503:%', label || ': tenant-A owner re-point at tenant B -> 23503 (' || o_foreign || ')');
    else
      return next ok(o_foreign like '42501%', label || ': not writable by clients -> 42501 (' || o_foreign || ')');
    end if;
    return next is(o_foreign, o_missing, label || ': owner, foreign id fails exactly like a nonexistent id');
  end loop;
end $$;

select * from pg_temp.fk_checks();
select cmp_ok(
  (select count(*) from pg_constraint c join pg_class cr on cr.oid = c.conrelid
    where c.contype = 'f' and cardinality(c.conkey) = 2 and cr.relnamespace = 'public'::regnamespace
      and (select attname from pg_attribute where attrelid = c.conrelid and attnum = c.conkey[1]) = 'tenant_id'
      and c.confrelid <> 'public.tenants'::regclass),
  '>=', 8::bigint, 'the catalog loop found the composite foreign keys (not vacuous)');

-- ===================== B. inserts: every reference kind, privileged and as a tenant-A owner
create function pg_temp.insert_attack(p_label text, p_sql text, p_expect text default '23503') returns setof text
language plpgsql as $$
declare a text; b text;
begin
  a := pg_temp.err_shape(p_sql);
  b := tests.error_shape_as(tests.uid('a_owner'), p_sql);
  return next ok(a like p_expect || '%', p_label || ' [privileged] -> ' || p_expect || ' (' || a || ')');
  return next ok(b like p_expect || '%', p_label || ' [tenant-A owner] -> ' || p_expect || ' (' || b || ')');
end $$;

-- contacts -> company of tenant B
select * from pg_temp.insert_attack('contact in A pointing at B company',
  format($$insert into public.contacts (tenant_id, company_id, full_name) values (%L, %L, 'X')$$, tests.tid('a'), tests.rid('b_company')));
-- leads
select * from pg_temp.insert_attack('lead in A pointing at B company',
  format($$insert into public.leads (tenant_id, company_id) values (%L, %L)$$, tests.tid('a'), tests.rid('b_company')));
select * from pg_temp.insert_attack('lead in A pointing at B contact (with an A company)',
  format($$insert into public.leads (tenant_id, company_id, contact_id) values (%L, %L, %L)$$, tests.tid('a'), tests.rid('a_company'), tests.rid('b_contact')));
select * from pg_temp.insert_attack('lead in A owned by a tenant-B user',
  format($$insert into public.leads (tenant_id, owner_user_id) values (%L, %L)$$, tests.tid('a'), tests.uid('b_owner')));
select * from pg_temp.insert_attack('lead in A owned by a user who is in no tenant',
  format($$insert into public.leads (tenant_id, owner_user_id) values (%L, %L)$$, tests.tid('a'), tests.uid('outsider')));
-- opportunities
select * from pg_temp.insert_attack('opportunity in A pointing at B company',
  format($$insert into public.opportunities (tenant_id, company_id, title) values (%L, %L, 'X')$$, tests.tid('a'), tests.rid('b_company')));
select * from pg_temp.insert_attack('opportunity in A pointing at B contact',
  format($$insert into public.opportunities (tenant_id, company_id, contact_id, title) values (%L, %L, %L, 'X')$$, tests.tid('a'), tests.rid('a_company'), tests.rid('b_contact')));
select * from pg_temp.insert_attack('opportunity in A pointing at B lead',
  format($$insert into public.opportunities (tenant_id, company_id, lead_id, title) values (%L, %L, %L, 'X')$$, tests.tid('a'), tests.rid('a_company'), tests.rid('b_lead')));
select * from pg_temp.insert_attack('opportunity in A owned by a tenant-B user',
  format($$insert into public.opportunities (tenant_id, company_id, owner_user_id, title) values (%L, %L, %L, 'X')$$, tests.tid('a'), tests.rid('a_company'), tests.uid('b_owner')));
-- consent ledger (privileged only: clients cannot insert at all)
select a.* from (select pg_temp.err_shape(format(
  $$insert into public.consent_events (tenant_id, contact_id, event_type, channel) values (%L, %L, 'withdrawn', 'email')$$,
  tests.tid('a'), tests.rid('b_contact'))) as shape) s,
  lateral (select ok(s.shape like '23503%', 'consent_event in A pointing at B contact [privileged] -> 23503 (' || s.shape || ')')) a;

-- ===================== C. same error whether the id belongs to another tenant or does not exist
select is(
  pg_temp.err_shape(format($$insert into public.leads (tenant_id, company_id) values (%L, %L)$$, tests.tid('a'), tests.rid('b_company'))),
  pg_temp.err_shape(format($$insert into public.leads (tenant_id, company_id) values (%L, %L)$$, tests.tid('a'), gen_random_uuid())),
  'lead: foreign company id and nonexistent company id are indistinguishable');
select is(
  tests.error_shape_as(tests.uid('a_owner'), format($$insert into public.opportunities (tenant_id, company_id, title) values (%L, %L, 'X')$$, tests.tid('a'), tests.rid('b_company'))),
  tests.error_shape_as(tests.uid('a_owner'), format($$insert into public.opportunities (tenant_id, company_id, title) values (%L, %L, 'X')$$, tests.tid('a'), gen_random_uuid())),
  'opportunity: foreign company id and nonexistent company id are indistinguishable (as a tenant owner)');

-- ===================== D. "the contact belongs to THE SAME company" (three-column key)
-- Two companies in tenant A; the contact belongs to company one.
insert into public.companies (id, tenant_id, name) values (tests.rid('a_company2'), tests.tid('a'), 'Company A2');
insert into public.contacts (id, tenant_id, company_id, full_name) values (tests.rid('a_contact2'), tests.tid('a'), tests.rid('a_company2'), 'Belongs to A2');
insert into public.contacts (id, tenant_id, full_name) values (tests.rid('a_contact_free'), tests.tid('a'), 'No company');

select * from pg_temp.insert_attack('lead: contact of company A2 attached to company A',
  format($$insert into public.leads (tenant_id, company_id, contact_id) values (%L, %L, %L)$$, tests.tid('a'), tests.rid('a_company'), tests.rid('a_contact2')));
select * from pg_temp.insert_attack('opportunity: contact of company A2 attached to company A',
  format($$insert into public.opportunities (tenant_id, company_id, contact_id, title) values (%L, %L, %L, 'X')$$, tests.tid('a'), tests.rid('a_company'), tests.rid('a_contact2')));
select * from pg_temp.insert_attack('lead: a contact with no company cannot be attached to a company',
  format($$insert into public.leads (tenant_id, company_id, contact_id) values (%L, %L, %L)$$, tests.tid('a'), tests.rid('a_company'), tests.rid('a_contact_free')));
select * from pg_temp.insert_attack('lead: a contact without a company is refused (check)',
  format($$insert into public.leads (tenant_id, contact_id) values (%L, %L)$$, tests.tid('a'), tests.rid('a_contact')), '23514');
select * from pg_temp.insert_attack('opportunity: a contact with no company cannot be attached',
  format($$insert into public.opportunities (tenant_id, company_id, contact_id, title) values (%L, %L, %L, 'X')$$, tests.tid('a'), tests.rid('a_company'), tests.rid('a_contact_free')));
select is(pg_temp.err_shape(format(
  $$insert into public.leads (tenant_id, company_id, contact_id) values (%L, %L, %L)$$, tests.tid('a'), tests.rid('a_company2'), tests.rid('a_contact2'))),
  'ok', 'ALLOW: the contact''s own company is accepted');
select is(pg_temp.err_shape(format(
  $$insert into public.opportunities (tenant_id, company_id, contact_id, title) values (%L, %L, %L, 'ok')$$, tests.tid('a'), tests.rid('a_company2'), tests.rid('a_contact2'))),
  'ok', 'ALLOW: opportunity with the contact''s own company');

-- ===================== E. re-parenting cannot break an existing link (NO ACTION, never cascade)
select is(pg_temp.err_shape(format($$update public.contacts set company_id = %L where id = %L$$, tests.rid('a_company'), tests.rid('a_contact2'))),
  '23503:' || (select conname from pg_constraint where conrelid = 'public.leads'::regclass and cardinality(conkey) = 3) || ':leads',
  'moving a contact to another company while a lead still links company+contact is refused');
select is(pg_temp.err_shape(format($$delete from public.companies where id = %L$$, tests.rid('a_company2'))) like '23503:%', true,
  'a referenced company cannot be removed (no cascade)');

-- ===================== F. removing a member un-assigns; it never touches tenant_id
insert into public.leads (id, tenant_id, owner_user_id) values (tests.rid('a_lead_owned'), tests.tid('a'), tests.uid('a_sales'));
delete from public.memberships where tenant_id = tests.tid('a') and user_id = tests.uid('a_sales');
select is((select owner_user_id from public.leads where id = tests.rid('a_lead_owned')), null,
  'removing the owner''s membership nulls owner_user_id');
select is((select tenant_id from public.leads where id = tests.rid('a_lead_owned')), tests.tid('a'),
  '... and leaves tenant_id untouched');

select * from finish();
rollback;
