-- The same-number lookup of the Lead Desk uses an index (migration 20261231985200): the expression index exists, and the duplicate lookup still finds the older lead.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select is((select count(*)::int from pg_indexes where schemaname = 'public' and indexname = 'contacts_phone_norm_idx'), 1, 'A1 the index exists');
select is((select indexdef like '%app.phone_norm(phone)%' from pg_indexes where schemaname = 'public' and indexname = 'contacts_phone_norm_idx'), true, 'A2 on the normalised number');
select * from finish();
rollback;
