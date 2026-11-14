-- Google Calendar sync (migration 20261231800000, appointment booking slice 4): the tables hold no token and no client can reach them; who may do what (any member reads the status; the Owner
-- connects with the second factor, changes the settings and disconnects; the Owner and an Admin sync now; only the scheduler account does the sync work); the one-time authorization; the
-- appointments that are due for a push and the back-off; the busy blocks (replaced as a set, nothing without "block busy") and app.calendar_busy_overlaps; the push channel; disconnect and
-- the erased workspace.
--   A catalog   B status   C connect   D the callback's steps   E settings and busy blocks   F appointments due   G channel   H disconnect and erasure
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select app.operator_register_scheduler('outsider@test.local');

create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.sch(p_sql text) returns text language sql as $$ select pg_temp.sc('outsider', p_sql) $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.a() returns uuid language sql as $$ select tests.tid('a') $$;
-- a visit straight into the table (the visits module's own rules are proved in its tests); the person is the base contact "Contact a"
create function pg_temp.visit(p_label text, p_start timestamptz, p_status text default 'booked') returns uuid language plpgsql as $$
begin
  insert into public.store_visits (id, tenant_id, lead_id, contact_id, company_id, visit_date, starts_at, ends_at, party_size, purpose, created_by, request_sha256)
  values (tests.rid(p_label), tests.tid('a'), tests.rid('a_lead'), tests.rid('a_contact'), tests.rid('a_company'), (p_start at time zone 'Asia/Kolkata')::date, p_start, p_start + interval '30 minutes', 2,
          'Saree trial', tests.uid('a_owner'), md5(p_label) || md5(p_label || 'x'));
  return tests.rid(p_label);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------- A catalog
select has_table('integrations', 'google_calendar_links', 'A: the link table');
select has_table('integrations', 'google_event_links', 'A: the event link table');
select has_table('integrations', 'google_calendar_states', 'A: the authorization table');
select has_table('public', 'calendar_busy', 'A: the busy blocks');
select is((select string_agg(c.relname, ',' order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where (n.nspname, c.relname) in (('integrations', 'google_calendar_links'), ('integrations', 'google_event_links'), ('integrations', 'google_calendar_states'), ('public', 'calendar_busy'))
              and c.relrowsecurity and c.relforcerowsecurity),
          'calendar_busy,google_calendar_links,google_calendar_states,google_event_links', 'A: RLS is enabled and FORCED on all four');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'integrations' and table_name like 'google_%' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
          0::bigint, 'A: no client role holds anything on the integrations tables');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name = 'calendar_busy' and grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')),
          0::bigint, 'A: no table-wide grant on calendar_busy');
select is((select string_agg(column_name, ',' order by column_name) from information_schema.column_privileges where table_schema = 'public' and table_name = 'calendar_busy' and grantee = 'authenticated'),
          'id,tenant_id', 'A: a client may see at most the ids of a busy block (never its times)');
select is((select count(*) from information_schema.columns where table_schema in ('integrations', 'public') and table_name in ('google_calendar_links', 'google_event_links', 'google_calendar_states', 'calendar_busy')
            and column_name ~ '(^|_)(token|secret|refresh_token|access_token|code_verifier|code)($|_)' and column_name not in ('secret_name', 'last_error_code')), 0::bigint, 'A: no column could hold a token');
select is((select p.provolatile::text || p.prosecdef::text || coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p where p.oid = 'app.calendar_busy_overlaps(uuid, timestamptz, timestamptz)'::regprocedure),
          'struesearch_path=""', 'A: app.calendar_busy_overlaps is STABLE, SECURITY DEFINER, search_path empty');
select ok(not has_function_privilege('authenticated', 'app.calendar_busy_overlaps(uuid, timestamptz, timestamptz)', 'execute')
          and not has_function_privilege('anon', 'app.calendar_busy_overlaps(uuid, timestamptz, timestamptz)', 'execute'), 'A: ...and no client calls it directly (the slot functions do)');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname like 'scheduler\_gcal\_%' and p.prosecdef and 'search_path=""' = any (p.proconfig)
              and has_function_privilege('authenticated', p.oid, 'execute') and not has_function_privilege('anon', p.oid, 'execute')), 14::bigint,
          'A: the fourteen scheduler_gcal_* functions are SECURITY DEFINER, search_path empty, callable when signed in (each checks for the scheduler account first), never by anon');
select ok(exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'calendar_busy' and indexdef like '%(tenant_id, starts_at, ends_at)%'), 'A: the busy blocks have the range index the slots use');

-- ---------------------------------------------------------------------------------------------------------------------------------- B status
select is(pg_temp.j(pg_temp.sc('a_viewer', format('select public.google_calendar_status(%L)', pg_temp.a())), 'status'), 'not_connected', 'B: any member reads the status: not connected');
select is(pg_temp.sc('b_owner', format('select public.google_calendar_status(%L)', pg_temp.a())), 'ERR:42501', 'B: another business''s Owner cannot');
select is(pg_temp.sc('outsider', format('select public.google_calendar_status(%L)', pg_temp.a())), 'ERR:42501', 'B: nor can the scheduler account (it is no member)');

-- ---------------------------------------------------------------------------------------------------------------------------------- C connect
select is(pg_temp.sc('a_admin', format('select public.google_calendar_connect_start(%L)', pg_temp.a())), 'ERR:42501', 'C: an Admin cannot connect');
select is(pg_temp.sc('a_sales', format('select public.google_calendar_connect_start(%L)', pg_temp.a())), 'ERR:42501', 'C: nor Sales');
select is(pg_temp.sc('a_owner', format('select public.google_calendar_connect_start(%L)', pg_temp.a()), 'aal1'), 'ERR:SM306', 'C: the Owner needs the second factor (SM306)');
create temp table st as select (pg_temp.sc('a_owner', format('select public.google_calendar_connect_start(%L)', pg_temp.a())))::jsonb as s;
select is((select s ->> 'member_id' from st), tests.uid('a_owner')::text, 'C: the Owner starts an authorization (the member is the caller)');
select ok((select (s ->> 'expires_at')::timestamptz between now() + interval '9 minutes' and now() + interval '11 minutes' from st), 'C: ...good for 10 minutes');
select pg_temp.sc('a_owner', format('select public.google_calendar_connect_start(%L)', pg_temp.a())) from generate_series(1, 4);
select is(pg_temp.sc('a_owner', format('select public.google_calendar_connect_start(%L)', pg_temp.a())), 'ERR:SM882', 'C: a sixth open authorization is refused (SM882)');

-- ---------------------------------------------------------------------------------------------------------------------------------- D the callback's steps (the scheduler account)
select is(pg_temp.sc('a_owner', format('select public.scheduler_gcal_state_use(%L, %L, %L)', (select s ->> 'nonce' from st), pg_temp.a(), tests.uid('a_owner'))), 'ERR:42501', 'D: only the scheduler account uses a state');
select is(pg_temp.sch(format('select public.scheduler_gcal_state_use(%L, %L, %L)', (select s ->> 'nonce' from st), tests.tid('b'), tests.uid('a_owner'))), 'ERR:SM882', 'D: a state for another business is refused');
select is(pg_temp.j(pg_temp.sch(format('select public.scheduler_gcal_state_use(%L, %L, %L)', (select s ->> 'nonce' from st), pg_temp.a(), tests.uid('a_owner'))), 'secret_name'),
          'sme-ws-' || pg_temp.a() || '-google_calendar', 'D: the state is used, and says where the secret goes');
select is(pg_temp.sch(format('select public.scheduler_gcal_state_use(%L, %L, %L)', (select s ->> 'nonce' from st), pg_temp.a(), tests.uid('a_owner'))), 'ERR:SM882', 'D: ...ONCE');
update integrations.google_calendar_states set expires_at = now() - interval '1 second' where used_at is null;
select is(pg_temp.sch(format('select public.scheduler_gcal_state_use(%L, %L, %L)', (select nonce from integrations.google_calendar_states where used_at is null limit 1), pg_temp.a(), tests.uid('a_owner'))),
          'ERR:SM882', 'D: an expired state is refused');
select is(pg_temp.sch(format('select public.scheduler_gcal_connected(%L, %L, %L)', pg_temp.a(), tests.uid('a_admin'), '0123456789abcdef')), 'ERR:42501', 'D: a link is made only for an Owner');
select is(pg_temp.sch(format('select public.scheduler_gcal_connected(%L, %L, %L)', pg_temp.a(), tests.uid('a_owner'), 'not-a-fingerprint')), 'ERR:22023', 'D: the fingerprint is 16 hex characters');
select is(pg_temp.j(pg_temp.sch(format('select public.scheduler_gcal_connected(%L, %L, %L)', pg_temp.a(), tests.uid('a_owner'), '0123456789abcdef')), 'status'), 'connected', 'D: connected');
select is((select kind || '|' || secret_name || '|' || coalesce(last4, '-') from public.workspace_secrets where tenant_id = pg_temp.a() and kind = 'google_calendar'),
          'google_calendar|sme-ws-' || pg_temp.a() || '-google_calendar|-', 'D: WHERE the token is, in the workspace-secrets registry (kind google_calendar); never the token');
select is((select write_events::text || block_busy::text || calendar_id from integrations.google_calendar_links where tenant_id = pg_temp.a()), 'truefalseprimary', 'D: writing on, blocking off, the primary calendar');
select is(pg_temp.j(pg_temp.sc('a_viewer', format('select public.google_calendar_status(%L)', pg_temp.a())), 'status'), 'connected', 'D: every member sees it connected');
select ok(exists (select 1 from public.audit_events where tenant_id = pg_temp.a() and action = 'google_calendar.connect'), 'D: the connect is audited');

-- ---------------------------------------------------------------------------------------------------------------------------------- E settings and busy blocks
select is(pg_temp.sc('a_admin', format('select public.google_calendar_settings_set(%L, true, true)', pg_temp.a())), 'ERR:42501', 'E: an Admin cannot change the settings');
select is(pg_temp.sc('a_owner', format('select public.google_calendar_settings_set(%L, null, true)', pg_temp.a())), 'ERR:22023', 'E: both switches are needed');
select is(pg_temp.sch(format($q$select public.scheduler_gcal_busy_replace(%L, '[{"start": "2030-01-01T10:00:00Z", "end": "2030-01-01T11:00:00Z"}]')$q$, pg_temp.a())) is not null, true, 'E: a refresh while blocking is off...');
select is((select count(*) from public.calendar_busy where tenant_id = pg_temp.a()), 0::bigint, 'E: ...keeps NO busy block');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.google_calendar_settings_set(%L, true, true)', pg_temp.a())), 'block_busy'), 'true', 'E: the Owner turns blocking on');
select is(pg_temp.sch(format($q$select public.scheduler_gcal_busy_replace(%L, '[{"start": "2030-01-01T10:00:00Z", "end": "2030-01-01T09:00:00Z"}]')$q$, pg_temp.a())), 'ERR:22023', 'E: an end before its start is refused');
select is(pg_temp.sch(format($q$select public.scheduler_gcal_busy_replace(%L, '[{"start": "nonsense", "end": "2030-01-01T09:00:00Z"}]')$q$, pg_temp.a())), 'ERR:22023', 'E: a non-time is refused');
select is(pg_temp.sc('a_owner', format($q$select public.scheduler_gcal_busy_replace(%L, '[]')$q$, pg_temp.a())), 'ERR:42501', 'E: only the scheduler account replaces busy blocks');
select is(pg_temp.j(pg_temp.sch(format($q$select public.scheduler_gcal_busy_replace(%L, '[{"start": "2030-01-01T10:00:00Z", "end": "2030-01-01T11:00:00Z"}, {"start": "2030-01-02T10:00:00Z", "end": "2030-01-02T12:00:00Z"}]')$q$, pg_temp.a())), 'blocks'),
          '2', 'E: the set is stored');
select is(app.calendar_busy_overlaps(pg_temp.a(), '2030-01-01T10:30:00Z', '2030-01-01T11:00:00Z'), true, 'E: overlaps: a slot inside a busy block');
select is(app.calendar_busy_overlaps(pg_temp.a(), '2030-01-01T11:00:00Z', '2030-01-01T11:30:00Z'), false, 'E: overlaps: a slot that starts as the block ends is free');
select is(app.calendar_busy_overlaps(pg_temp.a(), '2030-01-01T09:30:00Z', '2030-01-01T10:00:00Z'), false, 'E: overlaps: a slot that ends as the block starts is free');
select is(app.calendar_busy_overlaps(tests.tid('b'), '2030-01-01T10:30:00Z', '2030-01-01T11:00:00Z'), false, 'E: overlaps: another business is not blocked');
select is(app.calendar_busy_overlaps(pg_temp.a(), null, '2030-01-01T11:00:00Z'), false, 'E: overlaps: no time, no block');
create temp table kept as select id from public.calendar_busy where tenant_id = pg_temp.a() and starts_at = '2030-01-01T10:00:00Z';
select is(pg_temp.j(pg_temp.sch(format($q$select public.scheduler_gcal_busy_replace(%L, '[{"start": "2030-01-01T10:00:00Z", "end": "2030-01-01T11:00:00Z"}, {"start": "2030-01-03T08:00:00Z", "end": "2030-01-03T09:00:00Z"}]')$q$, pg_temp.a())), 'removed'),
          '1', 'E: the WHOLE set is replaced (a block that is gone is removed)...');
select is((select count(*) from public.calendar_busy b join kept k on k.id = b.id), 1::bigint, 'E: ...an unchanged block is not rewritten');
select is(app.calendar_busy_overlaps(pg_temp.a(), '2030-01-02T10:30:00Z', '2030-01-02T11:00:00Z'), false, 'E: the removed block no longer blocks');
select is(tests.outcome_as(tests.uid('a_owner'), format('select starts_at from public.calendar_busy where tenant_id = %L', pg_temp.a())), '42501', 'E: the Owner cannot read the busy times directly');
select is(tests.outcome_as(tests.uid('a_owner'), format('select id from public.calendar_busy where tenant_id = %L', pg_temp.a())), 'rows:2', 'E: ...only that they exist');
select is(tests.outcome_as(tests.uid('a_sales'), format('select id from public.calendar_busy where tenant_id = %L', pg_temp.a())), 'rows:0', 'E: Sales sees nothing');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.google_calendar_settings_set(%L, true, false)', pg_temp.a())), 'block_busy'), 'false', 'E: blocking off...');
select is((select count(*) from public.calendar_busy where tenant_id = pg_temp.a()), 0::bigint, 'E: ...drops every busy block at once');
select pg_temp.sc('a_owner', format('select public.google_calendar_settings_set(%L, true, true)', pg_temp.a()));

-- ---------------------------------------------------------------------------------------------------------------------------------- F appointments due for a push
select pg_temp.visit('v1', now() + interval '2 days');
select pg_temp.visit('v_past', now() - interval '2 days');
select is((select string_agg(e ->> 'visit_id', ',') from jsonb_array_elements((pg_temp.sch(format('select public.scheduler_gcal_visits_due(%L)', pg_temp.a())))::jsonb) e), tests.rid('v1')::text,
          'F: a new upcoming appointment is due (a past one never written is not)');
select is((select e ->> 'person_name' from jsonb_array_elements((pg_temp.sch(format('select public.scheduler_gcal_visits_due(%L)', pg_temp.a())))::jsonb) e), 'Contact a', 'F: ...with the person (the API shortens it)');
select is(pg_temp.sc('a_owner', format('select public.scheduler_gcal_visits_due(%L)', pg_temp.a())), 'ERR:42501', 'F: only the scheduler account lists them');
select is(pg_temp.sch(format('select public.scheduler_gcal_event_done(%L, %L, %L, %L, %L, %L)', pg_temp.a(), tests.rid('v1'), 'NOT-OURS', 'written', repeat('a', 64), now())), 'ERR:22023', 'F: an event id is ours in shape');
select is(pg_temp.j(pg_temp.sch(format('select public.scheduler_gcal_event_done(%L, %L, %L, %L, %L, %L)', pg_temp.a(), tests.rid('v1'), 's19' || replace(tests.rid('v1')::text, '-', ''), 'written', repeat('a', 64),
          (select updated_at from public.store_visits where id = tests.rid('v1')))), 'state'), 'written', 'F: a push went through');
select is(jsonb_array_length((pg_temp.sch(format('select public.scheduler_gcal_visits_due(%L)', pg_temp.a())))::jsonb), 0, 'F: ...and is not due again');
select is((select e ->> 'events_due' from jsonb_array_elements((pg_temp.sch('select public.scheduler_gcal_links()'))::jsonb) e where e ->> 'tenant_id' = pg_temp.a()::text), 'false', 'F: nothing due: the worker does not even ask Google for a token');
update integrations.google_event_links set visit_updated_at = visit_updated_at - interval '1 minute', pushed_at = pushed_at - interval '1 minute';   -- time passes (one transaction has one now())
update public.store_visits set status = 'confirmed', confirmed_at = now() where id = tests.rid('v1');
select is(jsonb_array_length((pg_temp.sch(format('select public.scheduler_gcal_visits_due(%L)', pg_temp.a())))::jsonb), 1, 'F: a change of the appointment makes it due (its updated_at is newer than the push)');
select is(pg_temp.j(pg_temp.sch(format('select public.scheduler_gcal_event_failed(%L, %L, %L, %L)', pg_temp.a(), tests.rid('v1'), 's19' || replace(tests.rid('v1')::text, '-', ''), 'unavailable')), 'attempts'), '1', 'F: a failed push...');
select is(jsonb_array_length((pg_temp.sch(format('select public.scheduler_gcal_visits_due(%L)', pg_temp.a())))::jsonb), 0, 'F: ...waits for its back-off');
select is(pg_temp.j(pg_temp.sch(format('select public.scheduler_gcal_event_failed(%L, %L, %L, %L)', pg_temp.a(), tests.rid('v1'), 's19' || replace(tests.rid('v1')::text, '-', ''), 'unavailable')), 'attempts'), '2', 'F: attempts are counted');
select ok((select next_attempt_at > now() + interval '3 minutes' from integrations.google_event_links where visit_id = tests.rid('v1')), 'F: ...and the wait doubles');
select is(pg_temp.j(pg_temp.sc('a_admin', format('select public.google_calendar_sync_now(%L)', pg_temp.a())), 'requested'), 'true', 'F: an Admin asks for a sync now');
select is(jsonb_array_length((pg_temp.sch(format('select public.scheduler_gcal_visits_due(%L)', pg_temp.a())))::jsonb), 1, 'F: ...which retries the failed push at once');
select is(pg_temp.sc('a_sales', format('select public.google_calendar_sync_now(%L)', pg_temp.a())), 'ERR:42501', 'F: Sales cannot');
select is((select e ->> 'current' from jsonb_array_elements((pg_temp.sch(format('select public.scheduler_gcal_own_events(%L)', pg_temp.a())))::jsonb) e), 'false', 'F: our event with a failed push is not current (the worker reads it from Google)');
select pg_temp.sc('a_owner', format('select public.google_calendar_settings_set(%L, false, true)', pg_temp.a()));
select is(jsonb_array_length((pg_temp.sch(format('select public.scheduler_gcal_visits_due(%L)', pg_temp.a())))::jsonb), 0, 'F: writing off: nothing is due');
select pg_temp.sc('a_owner', format('select public.google_calendar_settings_set(%L, true, true)', pg_temp.a()));
update integrations.google_calendar_links set busy_refreshed_at = now() - interval '31 minutes' where tenant_id = pg_temp.a();
select is((select e ->> 'busy_due' from jsonb_array_elements((pg_temp.sch('select public.scheduler_gcal_links()'))::jsonb) e where e ->> 'tenant_id' = pg_temp.a()::text), 'true', 'F: the link lists busy work due');
select is((select count(*) from jsonb_array_elements((pg_temp.sch('select public.scheduler_gcal_links()'))::jsonb) e where e ? 'refresh_token' or e ? 'channel_token'), 0::bigint, 'F: the worker''s list holds no token');

-- ---------------------------------------------------------------------------------------------------------------------------------- G channel and the revoked token
select is(pg_temp.j(pg_temp.sch(format('select public.scheduler_gcal_channel_set(%L, %L, %L, %L)', pg_temp.a(), '11111111-1111-4111-8111-111111111111', 'res-1', now() + interval '7 days')), 'stop_channel'), null, 'G: a first channel replaces nothing');
select is(pg_temp.j(pg_temp.sch(format('select public.scheduler_gcal_channel_set(%L, %L, %L, %L)', pg_temp.a(), '22222222-2222-4222-8222-222222222222', 'res-2', now() + interval '7 days')), 'stop_channel'),
          '{"channel_id": "11111111-1111-4111-8111-111111111111", "channel_resource_id": "res-1"}', 'G: a renewal hands back the old channel to stop');
select is(pg_temp.j(pg_temp.sch('select public.scheduler_gcal_channel_lookup(''22222222-2222-4222-8222-222222222222'')'), 'tenant_id'), pg_temp.a()::text, 'G: a notification''s channel names its business');
select is(pg_temp.sch('select public.scheduler_gcal_channel_lookup(''11111111-1111-4111-8111-111111111111'')'), null, 'G: the old channel names none');
select is(pg_temp.j(pg_temp.sch(format('select public.scheduler_gcal_busy_request(%L)', pg_temp.a())), 'requested'), 'true', 'G: a verified notification asks for a refresh');
select is(pg_temp.j(pg_temp.sch(format('select public.scheduler_gcal_link_failed(%L, %L, %L, true)', pg_temp.a(), 'token', 'revoked')), 'status'), 'needs_reconnect', 'G: a revoked token: needs_reconnect');
select is((select count(*) from jsonb_array_elements((pg_temp.sch('select public.scheduler_gcal_links()'))::jsonb) e
            where e ->> 'tenant_id' = pg_temp.a()::text and ((e ->> 'busy_due')::boolean or (e ->> 'channel_due')::boolean or (e ->> 'events_due')::boolean)), 0::bigint, 'G: ...and no work is due for it any more (never a loop)');
select is(jsonb_array_length((pg_temp.sch(format('select public.scheduler_gcal_visits_due(%L)', pg_temp.a())))::jsonb), 0, 'G: ...not even a push');
select is(pg_temp.j(pg_temp.sc('a_viewer', format('select public.google_calendar_status(%L)', pg_temp.a())), 'last_error_code'), 'revoked', 'G: the status says why');
select is(pg_temp.sch(format('select public.scheduler_gcal_link_failed(%L, %L, %L, false)', pg_temp.a(), 'nonsense', 'x')), 'ERR:22023', 'G: closed words only');

-- ---------------------------------------------------------------------------------------------------------------------------------- H disconnect and erasure
select is(pg_temp.sc('a_admin', format('select public.google_calendar_disconnect(%L)', pg_temp.a())), 'ERR:42501', 'H: an Admin cannot disconnect');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.google_calendar_ref(%L)', pg_temp.a())), 'secret_name'), 'sme-ws-' || pg_temp.a() || '-google_calendar', 'H: the API learns where the secret is (never the secret)');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.google_calendar_disconnect(%L)', pg_temp.a())), 'disconnected'), 'true', 'H: the Owner disconnects');
select is((select count(*) from integrations.google_calendar_links where tenant_id = pg_temp.a()) + (select count(*) from integrations.google_event_links where tenant_id = pg_temp.a())
          + (select count(*) from public.calendar_busy where tenant_id = pg_temp.a()) + (select count(*) from public.workspace_secrets where tenant_id = pg_temp.a() and kind = 'google_calendar')
          + (select count(*) from integrations.google_calendar_states where tenant_id = pg_temp.a()), 0::bigint, 'H: the link, the event links, the busy blocks, the authorizations and the secret''s row are gone');
select is((select count(*) from public.store_visits where tenant_id = pg_temp.a()), 2::bigint, 'H: the appointments themselves are untouched');
select ok(exists (select 1 from public.audit_events where tenant_id = pg_temp.a() and action = 'google_calendar.disconnect'), 'H: the disconnect is audited');
select is(pg_temp.sc('a_owner', format('select public.google_calendar_sync_now(%L)', pg_temp.a())), 'ERR:SM881', 'H: nothing to sync (SM881)');
-- the erased workspace: the worker's list says so, and the worker's disconnect forgets it
select pg_temp.sch(format('select public.scheduler_gcal_connected(%L, %L, %L)', pg_temp.a(), tests.uid('a_owner'), '0123456789abcdef'));
select is((select e ->> 'erase' from jsonb_array_elements((pg_temp.sch('select public.scheduler_gcal_links()'))::jsonb) e where e ->> 'tenant_id' = pg_temp.a()::text), 'false', 'H: not erased');
insert into public.erasure_requests (id, tenant_id, scope, subject_id, status, requested_by, execute_after, executed_at)
values (gen_random_uuid(), pg_temp.a(), 'tenant', null, 'executed', tests.uid('a_owner'), now(), now() + interval '1 second');
select is((select e ->> 'erase' from jsonb_array_elements((pg_temp.sch('select public.scheduler_gcal_links()'))::jsonb) e where e ->> 'tenant_id' = pg_temp.a()::text), 'true', 'H: an erasure after the link: erase');
select is(pg_temp.j(pg_temp.sch(format('select public.scheduler_gcal_disconnect(%L)', pg_temp.a())), 'disconnected'), 'true', 'H: the worker disconnects it');
select is(pg_temp.sc('a_owner', format('select public.scheduler_gcal_disconnect(%L)', pg_temp.a())), 'ERR:42501', 'H: only the scheduler account may');

select * from finish();
rollback;
