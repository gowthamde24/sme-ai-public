-- Job EB part A (migration 20261217090000): the owner's notes, versioned. Who may read and write, the version check, the same words again, the history, erasure-only edits, and the scheduler's read.
begin;
select no_plan();
select tests.seed_two_tenants();

create function pg_temp.save(p_user text, p_tenant text, p_notes text, p_expected int, p_change text default null) returns text language sql as $$
  select tests.sqlstate_as(tests.uid(p_user), format($q$select public.assistant_context_save(%L, %L, %s, %L)$q$, tests.tid(p_tenant), p_notes, p_expected, p_change)) $$;
create function pg_temp.saved(p_user text, p_tenant text, p_notes text, p_expected int, p_change text default null) returns jsonb language sql as $$
  select tests.scalar_as(tests.uid(p_user), format($q$select public.assistant_context_save(%L, %L, %s, %L)$q$, tests.tid(p_tenant), p_notes, p_expected, p_change))::jsonb $$;
create function pg_temp.get(p_user text, p_tenant text) returns jsonb language sql as $$
  select tests.scalar_as(tests.uid(p_user), format($q$select public.assistant_context_get(%L)$q$, tests.tid(p_tenant)))::jsonb $$;

-- before the first save: version 0, empty
select is(pg_temp.get('a_owner', 'a') ->> 'version', '0', 'before the first save: version 0');
select is(pg_temp.get('a_viewer', 'a') ->> 'notes', '', '...and empty (any member may read)');
select is(pg_temp.save('a_owner', 'a', '', 0), 'ok', 'an empty save at version 0 is fine');
select is((select count(*) from public.assistant_context_versions), 0::bigint, '...and makes no version');

-- who may write
select is(pg_temp.save('a_sales', 'a', 'x', 0), '42501', 'DENY: Sales');
select is(pg_temp.save('a_viewer', 'a', 'x', 0), '42501', 'DENY: a Viewer');
select is(pg_temp.save('b_owner', 'a', 'x', 0), '42501', 'DENY: the owner of another business');
select is(tests.sqlstate_as(null, format($$select public.assistant_context_save(%L, 'x', 0, null)$$, tests.tid('a'))), '42501', 'DENY: no identity');
select is(pg_temp.save('a_owner', 'a', repeat('x', 20001), 0), '22023', 'DENY: over 20,000 characters');
select is(pg_temp.save('a_owner', 'a', E'bad\u0001text', 0), '22023', 'DENY: a control character');

-- the first save, then the version check
select is(pg_temp.saved('a_owner', 'a', E'We sell sarees.\nDelivery in Guntur is free.', 0, 'added 2 lines') ->> 'version', '1', 'ALLOW: the owner saves version 1');
select is(pg_temp.get('a_admin', 'a') ->> 'notes', E'We sell sarees.\nDelivery in Guntur is free.', 'an Admin reads it');
select is(pg_temp.get('a_owner', 'a') -> 'updated_by' ->> 'id', tests.uid('a_owner')::text, '...and sees who saved it');
select is(pg_temp.get('a_owner', 'a') ->> 'change', 'added 2 lines', '...and what changed');
select is(pg_temp.save('a_admin', 'a', 'Admin text', 0), 'SM971', 'a save from an old version is refused (SM971)');
select is(pg_temp.saved('a_admin', 'a', E'We sell sarees.\nDelivery in Guntur is free.\nOpen 9 to 7.', 1, 'added 1 line') ->> 'version', '2', 'ALLOW: an Admin saves on top of the latest');
select is(pg_temp.saved('a_owner', 'a', E'We sell sarees.\nDelivery in Guntur is free.\nOpen 9 to 7.', 2) ->> 'version', '2', 'the same words again change nothing (still version 2)');
select is((select count(*) from public.assistant_context_versions where tenant_id = tests.tid('a')), 2::bigint, '...no third row');
select is(pg_temp.save('a_owner', 'a', 'again', 1), 'SM971', 'a stale expected version is refused even for the owner');
select is(pg_temp.save('a_owner', 'a', 'again', 5), 'SM971', '...and a version from the future too');

-- the history
select is(jsonb_array_length(tests.scalar_as(tests.uid('a_sales'), format($$select public.assistant_context_versions_list(%L, 20) -> 'items'$$, tests.tid('a')))::jsonb), 2, 'the history lists both versions (Sales may read)');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select public.assistant_context_versions_list(%L, 20) -> 'items' -> 0 ->> 'version'$$, tests.tid('a'))), '2', '...newest first');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select (public.assistant_context_versions_list(%L, 20) -> 'items' -> 0) ? 'notes'$$, tests.tid('a'))), 'false', '...without the text (a version is read on its own)');
select is(tests.scalar_as(tests.uid('a_owner'), format($$select public.assistant_context_version_get(%L, 1) ->> 'notes'$$, tests.tid('a'))), E'We sell sarees.\nDelivery in Guntur is free.', 'one old version is readable in full');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$select public.assistant_context_version_get(%L, 9)$$, tests.tid('a'))), 'P0002', 'an unknown version: P0002');
select is(tests.sqlstate_as(tests.uid('b_owner'), format($$select public.assistant_context_versions_list(%L, 20)$$, tests.tid('a'))), '42501', 'DENY: another business reads nothing');
select is(pg_temp.get('b_owner', 'b') ->> 'version', '0', 'and has its own, separate notes');

-- append-only
select is(tests.sqlstate_as(tests.uid('a_owner'), $$update public.assistant_context_versions set notes = 'edited'$$), '42501', 'DENY: no client edits a version');
select is(tests.sqlstate_as(tests.uid('a_owner'), $$delete from public.assistant_context_versions$$), '42501', 'DENY: no client deletes a version');
select throws_ok($$update public.assistant_context_versions set notes = 'edited'$$, '42501', null, 'even privileged: a version does not change outside an erasure');
select throws_ok($$delete from public.assistant_context_versions$$, '42501', null, '...and is never deleted');
select lives_ok($$update public.assistant_context_versions set notes = notes$$, 'a self-assignment is harmless');

-- the scheduler reads the notes of the workspace it answers for, nobody else does
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$select public.scheduler_assistant_context(%L)$$, tests.tid('a'))), '42501', 'DENY: a member cannot use the scheduler read');

select * from finish();
rollback;
