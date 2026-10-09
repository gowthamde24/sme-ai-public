-- T007 M3b: owner review of the daily cost cap.
--   A the run counts the CHARGE   B agent_release_cost (provably not billed)   C the ONE rule for open reservations + the Owner's summary
--   D evidence URLs: http / https only, ports 80 / 443   E the host rule: the website host or its www. twin, no other subdomain
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_agents();
update public.agent_limits set limit_value = 100 where limit_key in ('max_concurrent_runs', 'max_runs_per_hour');
update public.companies set website = 'https://saree-house.test/' where id = tests.rid('a_company');

create function pg_temp.sc(p_uid uuid, p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(p_uid, p_sql);
exception when others then return jsonb_build_object('error', sqlstate)::text; end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;
create function pg_temp.err(p_user text, p_sql text) returns text language sql as $$ select tests.error_full_as(case when p_user is null then null else tests.uid(p_user) end, p_sql) $$;
create function pg_temp.rsv(p_run uuid, p_key text, p_in bigint, p_out bigint) returns text language sql as $$
  select format('select public.agent_reserve_cost(%L, %L, ''fake-selftest'', %s, %s)', p_run, p_key, p_in, p_out) $$;
create function pg_temp.use(p_run uuid, p_key text, p_in bigint, p_out bigint, p_cost bigint) returns text language sql as $$
  select format('select public.agent_record_usage(%L, %L, %s, %s, %s)', p_run, p_key, p_in, p_out, p_cost) $$;
create function pg_temp.rel(p_run uuid, p_key text, p_reason text) returns text language sql as $$
  select format('select public.agent_release_cost(%L, %L, %L)', p_run, p_key, p_reason) $$;
create function pg_temp.newrun(p_name text, p_agent text default 'selftest', p_max_cost bigint default 250000) returns uuid language plpgsql as $$
begin
  insert into public.agent_runs (id, tenant_id, started_by, agent_name, agent_version, company_id, expires_at, input_sha256, max_cost_micros)
  values (tests.rid(p_name), tests.tid('a'), tests.uid('a_sales'), p_agent, 'v1', tests.rid('a_company'), now() + interval '15 minutes', repeat('1', 64), p_max_cost);
  return tests.rid(p_name);
end $$;
create function pg_temp.set_day(p date) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.agent_utc_today() returns date language sql stable security definer set search_path = '''' as $b$ select date %L $b$', p::text);
end $fn$;
create function pg_temp.spent(p_tenant text default 'a') returns numeric language sql as $$ select app.agent_day_spend(tests.tid(p_tenant), app.agent_utc_today()) $$;

-- ============================================================================ A. the run counts the CHARGE, not what the runtime reported
select pg_temp.newrun('c_run', 'selftest', 1000);
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('c_run'), 'usage-1', 400, 0)), 'reserved_micros'), '400', 'reserve 400');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.use(tests.rid('c_run'), 'usage-1', 400, 0, 0)), 'replayed'), 'false', 'the runtime reports cost 0 for 400 real tokens');
select is((select cost_micros_used from public.agent_runs where id = tests.rid('c_run')), 400::bigint, 'the run counts the CHARGE (400), not the reported 0');
select is((select cost_micros from public.agent_run_steps where run_id = tests.rid('c_run') and step_key = 'usage-1'), 400::bigint, '...and so does the usage step');
select is((select settled_micros::text || '/' || outcome from public.agent_cost_reservations where run_id = tests.rid('c_run') and step_key = 'usage-1'), '400/used', '...the reservation settled at the charge, outcome "used"');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('c_run'), 'usage-2', 700, 0)), 'granted'), 'true', 'a second call is reserved');
select is(pg_temp.err('a_sales', pg_temp.use(tests.rid('c_run'), 'usage-2', 700, 0, 0)), 'SM203|agent run budget exhausted||||', 'reported 0 for 700 real tokens still trips the run''s cost budget (400 + 700 > 1000): SM203');
select is((select cost_micros_used from public.agent_runs where id = tests.rid('c_run')), 400::bigint, '...and nothing was added');
select is((select settled_micros is null from public.agent_cost_reservations where run_id = tests.rid('c_run') and step_key = 'usage-2'), true, '...the reservation stays OPEN (worst case counted)');

-- ============================================================================ B. agent_release_cost: provably not billed, settled at ZERO
select pg_temp.newrun('r_run');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('r_run'), 'usage-1', 10, 10)), 'reserved_micros'), '20', 'reserve a call');
select is(pg_temp.spent(), 1120::numeric, '400 settled + 700 open + 20 open = 1,120 counted today');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rel(tests.rid('r_run'), 'usage-1', 'rate_limited')), 'released'), 'true', 'the provider answered 429 (never processed): released');
select is((select settled_micros::text || '/' || outcome from public.agent_cost_reservations where run_id = tests.rid('r_run') and step_key = 'usage-1'), '0/not_billed', '...settled at ZERO, outcome "not_billed"');
select is(pg_temp.spent(), 1100::numeric, '...so the day no longer counts it');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and action = 'agent_cost.released' and entity_id = tests.rid('r_run') and new_values ->> 'reason' = 'rate_limited'), 1::bigint, '...and the release is audited with its reason');
select is(pg_temp.j(pg_temp.sc(tests.uid('a_sales'), pg_temp.rel(tests.rid('r_run'), 'usage-1', 'rate_limited')), 'replayed'), 'true', 'releasing again is a replay');
select is(pg_temp.err('a_sales', pg_temp.use(tests.rid('r_run'), 'usage-1', 10, 10, 0)), '23503|invalid reference||||', 'a released reservation cannot be settled again');
select is(pg_temp.err('a_sales', pg_temp.rel(tests.rid('r_run'), 'usage-1', 'timeout')), '22023|invalid argument||||', 'only the closed reasons: "timeout" is not provably unbilled (22023)');
select is(pg_temp.err('a_sales', pg_temp.rel(tests.rid('r_run'), 'usage-1', 'unavailable')), '22023|invalid argument||||', '...nor "unavailable"');
select is(pg_temp.err('a_sales', pg_temp.rel(tests.rid('r_run'), 'nope', 'rejected')), '23503|invalid reference||||', 'an unknown step key: 23503');
select is(pg_temp.err('a_sales', pg_temp.rel(tests.rid('c_run'), 'usage-1', 'rejected')), '23503|invalid reference||||', 'a reservation already settled at REAL usage cannot be released (23503)');
select is(pg_temp.err('a_admin', pg_temp.rel(tests.rid('r_run'), 'usage-1', 'rejected')), '42501|agent action not permitted||||', 'another member cannot release on the starter''s run');
select is(pg_temp.err('b_sales', pg_temp.rel(tests.rid('r_run'), 'usage-1', 'rejected')), '42501|agent action not permitted||||', 'a user of another tenant: identical');
select is(pg_temp.err(null, pg_temp.rel(tests.rid('r_run'), 'usage-1', 'rejected')), '42501|permission denied for function agent_release_cost||||', 'anon: no EXECUTE');
select pg_temp.newrun('t_run');
select pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('t_run'), 'usage-1', 100, 0));
update public.agent_runs set status = 'cancelled', cancel_requested_at = now(), cancelled_by = tests.uid('a_owner'), finished_at = now(), error_code = 'cancelled' where id = tests.rid('t_run');
select is(pg_temp.err('a_sales', pg_temp.rel(tests.rid('t_run'), 'usage-1', 'rejected')), 'SM201|agent run is not running||||', 'a TERMINAL run cannot release: its open reservations follow the one rule (below)');

-- ============================================================================ C. the ONE rule: an unsettled reservation stays OPEN, at its worst case, until its UTC day ends
select is((select settled_micros is null from public.agent_cost_reservations where run_id = tests.rid('t_run') and step_key = 'usage-1'), true, 'the cancelled run''s reservation is still OPEN');
select is(pg_temp.spent(), 1200::numeric, '...and still counts (1,100 + 100): an interrupted call may have been billed');
select pg_temp.newrun('e_run');
select pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('e_run'), 'usage-1', 50, 0));
update public.agent_runs set status = 'expired', finished_at = now(), error_code = 'expired', expires_at = now() - interval '1 minute', created_at = now() - interval '1 hour' where id = tests.rid('e_run');
select pg_temp.newrun('k_run');
select pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('k_run'), 'usage-1', 30, 0));
update public.agent_runs set status = 'killed', finished_at = now(), error_code = 'killed' where id = tests.rid('k_run');
select pg_temp.newrun('f_run');
select pg_temp.sc(tests.uid('a_sales'), pg_temp.rsv(tests.rid('f_run'), 'usage-1', 20, 0));
update public.agent_runs set status = 'failed', finished_at = now(), error_code = 'model_failed' where id = tests.rid('f_run');
select is(pg_temp.spent(), 1300::numeric, 'expired (50), killed (30) and failed (20) runs keep their open reservations counted too: ONE rule for every terminal state');
-- the Owner's / Admin's summary: settled vs open, the open ones with their run's status
create function pg_temp.summary(p_user text) returns text language sql as $$ select pg_temp.sc(tests.uid(p_user), format('select public.agent_cost_summary(%L)', tests.tid('a'))) $$;
select is(pg_temp.j(pg_temp.summary('a_owner'), 'settled_micros'), '400', 'summary: settled today = 400');
select is(pg_temp.j(pg_temp.summary('a_owner'), 'open_micros'), '900', '...open (worst case) = 700 + 100 + 50 + 30 + 20 = 900');
select is(pg_temp.j(pg_temp.summary('a_owner'), 'cap_micros'), '2000000', '...and the cap');
select is(pg_temp.j(pg_temp.summary('a_owner'), 'day'), app.agent_utc_today()::text, '...for today (India)');
select is((select string_agg(o ->> 'run_status', ',' order by o ->> 'run_status') from jsonb_array_elements((pg_temp.summary('a_owner'))::jsonb -> 'open') o), 'cancelled,expired,failed,killed,running', '...each open reservation with its run''s status (the running one is c_run''s usage-2)');
select is(jsonb_array_length((pg_temp.summary('a_admin'))::jsonb -> 'open'), 5, 'an Admin reads it too');
select is(pg_temp.j(pg_temp.summary('a_sales'), 'error'), '42501', 'Sales cannot');
select is(pg_temp.j(pg_temp.summary('a_viewer'), 'error'), '42501', 'a Viewer cannot');
select is(pg_temp.j(pg_temp.summary('outsider'), 'error'), '42501', 'an outsider cannot');
select is(pg_temp.j(pg_temp.summary('b_owner'), 'error'), '42501', 'the Owner of ANOTHER tenant cannot read this tenant''s');
select is(pg_temp.err(null, format('select public.agent_cost_summary(%L)', tests.tid('a'))), '42501|permission denied for function agent_cost_summary||||', 'anon: no EXECUTE');
select is(pg_temp.j(pg_temp.sc(tests.uid('b_owner'), format('select public.agent_cost_summary(%L)', tests.tid('b'))), 'open_micros'), '0', 'tenant B''s own summary holds none of tenant A''s reservations');
-- the day ends: yesterday's open reservations stop counting at Indian midnight (job AF: the cap's day is the Asia/Kolkata day)
select pg_temp.set_day((now() at time zone 'Asia/Kolkata')::date + 1);
select is(pg_temp.spent(), 0::numeric, 'after Indian midnight the open reservations of the day before no longer count');
select is(pg_temp.j(pg_temp.summary('a_owner'), 'open_micros'), '0', '...and the summary of the new day starts empty');
select pg_temp.set_day((now() at time zone 'Asia/Kolkata')::date);

-- ============================================================================ D. evidence URLs: http / https only; ports 80 / 443
select app.operator_enable_research('tenant-a');
select pg_temp.newrun('w_run', 'research');
create function pg_temp.web(p_step text, p_url text) returns text language sql as $$
  select pg_temp.err('a_sales', format('select public.agent_write_evidence(%L, %L, ''web_page''::public.evidence_kind, %L, null, ''We sell silk sarees in bulk.'')', tests.rid('w_run'), p_step, p_url)) $$;
create function pg_temp.webok(p_step text, p_url text) returns text language sql as $$
  select pg_temp.j(pg_temp.sc(tests.uid('a_sales'), format('select public.agent_write_evidence(%L, %L, ''web_page''::public.evidence_kind, %L, null, ''We sell silk sarees in bulk.'')', tests.rid('w_run'), p_step, p_url)), 'replayed') $$;
select is(pg_temp.web('d1', 'javascript:alert(1)'), '23514|value not allowed||||', 'javascript: refused with the clean value error');
select is(pg_temp.web('d2', 'data:text/html,<script>x</script>'), '23514|value not allowed||||', 'data: refused');
select is(pg_temp.web('d3', 'ftp://saree-house.test/x'), '23514|value not allowed||||', 'ftp:// refused (website_host() strips any scheme, so the host rule alone would pass it)');
select is(pg_temp.web('d4', 'FTP://saree-house.test/x'), '23514|value not allowed||||', 'FTP:// refused');
select is(pg_temp.web('d5', 'file://saree-house.test/etc/passwd'), '23514|value not allowed||||', 'file:// refused');
select is(pg_temp.web('d6', 'gopher://saree-house.test/x'), '23514|value not allowed||||', 'any other scheme refused');
select is(pg_temp.web('d7', '//saree-house.test/x'), '23514|value not allowed||||', 'a scheme-relative URL refused');
select is(pg_temp.web('d8', 'saree-house.test/x'), '23514|value not allowed||||', 'a URL with no scheme refused');
select is(pg_temp.web('d9', ' https://saree-house.test/x'), '23514|value not allowed||||', 'leading whitespace refused');
select is(pg_temp.webok('d10', 'HTTP://saree-house.test/x'), 'false', 'mixed-case HTTP:// is accepted (a scheme is case-insensitive)');
select is(pg_temp.webok('d11', 'HtTpS://SAREE-HOUSE.test/y'), 'false', 'HtTpS:// and an upper-case host are accepted');
select is(pg_temp.webok('d12', 'https://saree-house.test:443/z'), 'false', 'port 443 is accepted');
select is(pg_temp.webok('d13', 'http://saree-house.test:80/z'), 'false', 'port 80 is accepted');
select is(pg_temp.web('d14', 'https://saree-house.test:8443/x'), '23514|value not allowed||||', 'any other port is refused (the fetcher only ever uses 80 and 443)');
select is(pg_temp.web('d16', 'https://saree-house.test:@x'), '23514|value not allowed||||', 'a malformed authority is refused');
-- '@', backslash, whitespace and control characters, anywhere in the URL (https://user@host:443/ passes the scheme, port and host rules)
select is(pg_temp.web('e1', 'https://user@saree-house.test:443/'), '23514|value not allowed||||', 'userinfo (https://user@host:443/) is refused with the clean error');
select is(pg_temp.web('e2', 'https://user:pass@saree-house.test/'), '23514|value not allowed||||', '...user:pass@ too');
select is(pg_temp.web('e3', 'https://saree-house.test/a@b'), '23514|value not allowed||||', 'an @ in the PATH is refused too');
select is(pg_temp.web('e4', 'https://saree-house.test/?x=a@b'), '23514|value not allowed||||', '...and in a query');
select is(pg_temp.web('e5', 'https://saree-house.test\\@evil.test/'), '23514|value not allowed||||', 'a backslash (read as a slash by browsers) is refused');
select is(pg_temp.web('e6', 'https://saree-house.test/a\\b'), '23514|value not allowed||||', '...in the path too');
select is(pg_temp.web('e7', 'https://saree-house.test/a b'), '23514|value not allowed||||', 'a space is refused');
select is(pg_temp.web('e8', 'https://saree-house.test/a' || chr(9) || 'b'), '23514|value not allowed||||', 'a tab is refused');
select is(pg_temp.web('e9', 'https://saree-house.test/a' || chr(10) || 'b'), '23514|value not allowed||||', 'a newline is refused');
select is(pg_temp.web('e10', 'https://saree-house.test/a' || chr(13) || 'b'), '23514|value not allowed||||', 'a carriage return is refused');
select is(pg_temp.web('e11', 'https://saree-house.test/a' || chr(1) || 'b'), '23514|value not allowed||||', 'a control character (U+0001) is refused');
select is(pg_temp.web('e12', 'https://saree-house.test/a' || chr(127) || 'b'), '23514|value not allowed||||', 'DEL (U+007F) is refused');
select is(pg_temp.web('e13', 'https://saree-house.test/a' || chr(11) || 'b'), '23514|value not allowed||||', 'a vertical tab is refused');
select is(pg_temp.web('e14', 'https://saree-house.test/a' || chr(160) || 'b'), '23514|value not allowed||||', 'a no-break space (Unicode whitespace) is refused');
select is(pg_temp.web('e15', 'https://saree-house.test/a%40b') like '23514%', false, 'a percent-ENCODED @ (%40) is data, not userinfo: allowed');
select is((select count(*) from public.evidence where agent_run_id = tests.rid('w_run')), 5::bigint, 'only the accepted URLs were written (the four above and the %40 path), none of the refused ones');
select throws_ok($$insert into public.evidence (id, tenant_id, kind, provider, url) values (gen_random_uuid(), (select tenant_id from public.agent_runs limit 1), 'web_page', 'manual', 'ftp://saree-house.test/x')$$, '23514', null, 'the table CHECK (evidence_url_check) is still the second layer');
select throws_ok($$insert into public.evidence (id, tenant_id, kind, provider, url) values (gen_random_uuid(), (select tenant_id from public.agent_runs limit 1), 'web_page', 'manual', 'javascript:alert(1)')$$, '23514', null, '...for javascript: too');

-- ============================================================================ E. the host rule: the company's website host or its www. twin, nothing else
create function pg_temp.host_ok(p_site text, p_url text) returns boolean language plpgsql as $$
begin
  update public.companies set website = p_site where id = tests.rid('a_company');
  return pg_temp.err('a_sales', format('select public.agent_write_evidence(%L, %L, ''web_page''::public.evidence_kind, %L, null, ''We sell silk sarees in bulk.'')', tests.rid('w_run'), 'h-' || md5(p_site || p_url), p_url)) not like '23514%';
end $$;
select is(pg_temp.host_ok('https://saree-house.test/', 'https://saree-house.test/a'), true, 'site host = url host: accepted');
select is(pg_temp.host_ok('https://saree-house.test/', 'https://www.saree-house.test/a'), true, 'the www. twin of the site: accepted');
select is(pg_temp.host_ok('https://www.saree-house.test/', 'https://saree-house.test/a'), true, 'a www. site, the bare host: accepted');
select is(pg_temp.host_ok('https://saree-house.test/', 'https://SAREE-HOUSE.TEST/a'), true, 'case does not matter');
select is(pg_temp.host_ok('https://saree-house.test/', 'https://blog.saree-house.test/a'), false, 'another SUBDOMAIN is refused (the runtime refuses it too)');
select is(pg_temp.host_ok('https://saree-house.test/', 'https://api.saree-house.test/a'), false, '...any subdomain');
select is(pg_temp.host_ok('https://saree-house.test/', 'https://www.blog.saree-house.test/a'), false, '...even behind www.');
select is(pg_temp.host_ok('https://saree-house.test/', 'https://www.www.saree-house.test/a'), false, 'only ONE www. is the twin');
select is(pg_temp.host_ok('https://saree-house.test/', 'https://saree-house.test.evil.test/a'), false, 'the site as a prefix of another host: refused');
select is(pg_temp.host_ok('https://saree-house.test/', 'https://evilsaree-house.test/a'), false, '...and as a suffix');
select is(pg_temp.host_ok('https://blog.saree-house.test/', 'https://saree-house.test/a'), false, 'a site that IS a subdomain does not open its parent');
select is(pg_temp.host_ok('https://blog.saree-house.test/', 'https://blog.saree-house.test/a'), true, 'but its own host is fine');

select * from finish();
rollback;
