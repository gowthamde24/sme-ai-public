-- Who changed an item last, and putting the last price change back (migration 20261231990400).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.at(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

insert into public.catalogue_items (id, tenant_id, name, fabric, colours, price_band, price_paise, created_by) values (tests.rid('u1'), tests.tid('a'), 'Undo saree', 'soft_silk', array['red'], '5k_10k', 100000, tests.uid('a_owner'));
select is(pg_temp.at('a_owner', format($q$select public.catalogue_price_undo(%L, %L)::text$q$, tests.tid('a'), tests.rid('u1'))), 'ERR:SM851', 'A1: nothing to undo before any price change');
update public.catalogue_items set price_paise = 120000, updated_by = tests.uid('a_owner'), updated_at = now() where id = tests.rid('u1');
select is(pg_temp.at('a_admin', format($q$select public.catalogue_price_undo(%L, %L)::text$q$, tests.tid('a'), tests.rid('u1'))), 'ERR:42501', 'B1: an Admin cannot undo a price');
select is(pg_temp.at('b_owner', format($q$select public.catalogue_price_undo(%L, %L)::text$q$, tests.tid('a'), tests.rid('u1'))), 'ERR:42501', 'B2: nor another workspace''s Owner');
select is(pg_temp.at('a_owner', format($q$select (public.catalogue_price_undo(%L, %L)) ->> 'price_paise'$q$, tests.tid('a'), tests.rid('u1'))), '100000', 'C1: the Owner puts the old price back');
select is((select price_paise from public.catalogue_items where id = tests.rid('u1')), 100000::bigint, 'C2: it is the item''s price now');
select is(pg_temp.at('a_owner', format($q$select public.catalogue_price_undo(%L, %L)::text$q$, tests.tid('a'), tests.rid('u1'))), 'ERR:SM851', 'C3: pressing it again is refused (an undo is not undone)');
select is((select count(*) from public.audit_events where entity_id = tests.rid('u1') and action = 'catalogue_item.price_undo')::int, 1, 'C4: the undo has its own audit row');
update public.catalogue_items set price_paise = 90000, updated_by = tests.uid('a_owner'), updated_at = now() where id = tests.rid('u1');
select is(pg_temp.at('a_owner', format($q$select (public.catalogue_price_undo(%L, %L)) ->> 'price_paise'$q$, tests.tid('a'), tests.rid('u1'))), '100000', 'D1: after a NEW price change the undo works again (back to the price before it)');
set local session_replication_role = replica;
update public.audit_events set created_at = now() - interval '31 days' where entity_id = tests.rid('u1');
reset session_replication_role;
update public.catalogue_items set price_paise = 80000, updated_by = tests.uid('a_owner'), updated_at = now() where id = tests.rid('u1');
set local session_replication_role = replica;
update public.audit_events set created_at = now() - interval '31 days' where entity_id = tests.rid('u1') and action = 'catalogue_item.update';
reset session_replication_role;
select is(pg_temp.at('a_owner', format($q$select public.catalogue_price_undo(%L, %L)::text$q$, tests.tid('a'), tests.rid('u1'))), 'ERR:SM851', 'E1: a price change older than 30 days cannot be undone');
select is(pg_temp.at('a_viewer', format($q$select (public.catalogue_get(%L, %L)) ? 'updated_by_name'$q$, tests.tid('a'), tests.rid('u1'))), 'true', 'F1: the item reader carries updated_by_name');
select is(pg_temp.at('a_viewer', format($q$select (public.catalogue_get(%L, %L)) ->> 'updated_by_name'$q$, tests.tid('a'), tests.rid('u1'))) = (select display_name from public.users where id = tests.uid('a_owner')), true, 'F2: and it is the display name of a member of that business');

select * from finish();
rollback;
