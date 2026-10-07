-- T010 part 2, commit 2b (migration 20261025090000): app.followup_blocker_inner follows the PINNED ENGINE's order of checks. The engine (packages/pure/followup_cadence, decide()) VALIDATES the whole
-- request first, and a history entry after as_of is a validation rejection (FUTURE_HISTORY), so it beats every rule, including the stop flags; then the rules run: suppression flags, a reply, won / lost,
-- the touch cap, no outbound touch, the gap and the calendar. This file pins that order on both sides of every boundary, and SAFETY: due-ness is unchanged and nobody gets a draft.
--   A the order, on hand-made requests (a flag or a reply or a close, each with a history entry after as_of, exactly at as_of and before it; every combination)
--   B the rules below the stops keep their place (the cap, the first touch, the gap)   C unreadable input is still `invalid`, first
--   D SAFETY through the real functions: create_followup_draft is refused in every case (which SM code), a suppressed contact still gets SM220 from the gate, a due lead is still due
-- All data is synthetic. The engine itself is pinned against these rules by tests/integration/test_followup_equivalence.py (1,949 cases, due-ness AND reason).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.as_aal('aal2');

create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
create function pg_temp.at(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform tests.as_aal(p_aal);
  r := tests.error_full_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
  perform tests.as_aal('aal2');
  if r = 'ok' then return 'ok'; end if;
  return split_part(r, '|', 1) || case when split_part(r, '|', 3) <> '' then ':' || split_part(r, '|', 3) else '' end;
end $$;
create function pg_temp.try(p_user text, p_sql text) returns text language sql as $$ select pg_temp.at('aal2', p_user, p_sql) $$;
create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.error_full_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql); end $$;
create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;
create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.run(p_user text, p_sql text) returns void language plpgsql as $$
declare r text;
begin
  r := pg_temp.try(p_user, p_sql);
  if r <> 'ok' then raise exception 'fixture step failed (%): %', r, left(p_sql, 200); end if;
end $$;
create function pg_temp.today() returns date language sql as $$ select app.quote_today() $$;
create function pg_temp.asof(p_shift interval default '0') returns text language sql as $$ select to_char((now() + p_shift) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;
create function pg_temp.noon_offset() returns integer language sql as $$
  select case when ((720 - (extract(hour from now() at time zone 'UTC')::int * 60 + extract(minute from now() at time zone 'UTC')::int) + 1440) % 1440) > 840
              then ((720 - (extract(hour from now() at time zone 'UTC')::int * 60 + extract(minute from now() at time zone 'UTC')::int) + 1440) % 1440) - 1440
              else ((720 - (extract(hour from now() at time zone 'UTC')::int * 60 + extract(minute from now() at time zone 'UTC')::int) + 1440) % 1440) end $$;
create function pg_temp.pol(p_gaps text default '[1, 2]', p_max int default 3, p_qs text default '03:00', p_qe text default '04:00', p_wd text default '[0, 1, 2, 3, 4, 5, 6]',
                            p_hol text default '[]', p_min int default 0, p_off int default null) returns text language sql as $$
  select jsonb_build_object('gap_days', p_gaps::jsonb, 'max_touches', p_max, 'quiet_hours', jsonb_build_object('start', p_qs, 'end', p_qe), 'allowed_weekdays', p_wd::jsonb,
                            'holidays', p_hol::jsonb, 'min_gap_hours', p_min, 'recipient_utc_offset_minutes', coalesce(p_off, pg_temp.noon_offset()))::text $$;
create function pg_temp.mkpol(p_label text, p_policy text default null, p_tenant text default 'a', p_from date default null, p_user text default 'a_owner') returns text language sql as $$
  select pg_temp.try(p_user, format('select public.create_followup_policy_version(%L, %L, %L, %L::jsonb)', tests.rid('pol_' || p_label), tests.tid(p_tenant),
                                    coalesce(p_from, pg_temp.today()), coalesce(p_policy, pg_temp.pol()))) $$;
create function pg_temp.polid(p_lead text) returns uuid language sql as $$ select app.followup_active_policy_version((select tenant_id from public.leads where id = tests.rid(p_lead)), pg_temp.today()) $$;
create function pg_temp.req(p_lead text, p_asof text default null) returns jsonb language sql as $$ select app.followup_build(tests.rid(p_lead), coalesce(p_asof, pg_temp.asof()), pg_temp.polid(p_lead)) $$;
create function pg_temp.res(p_req jsonb, p_ver text default '1.0.0', p_reqtext text default null) returns jsonb language sql as $$
  select jsonb_build_object('action', 'draft_followup', 'reason_code', 'eligible_now', 'terminal', false,
           'touch_number', (select count(*) + 1 from jsonb_array_elements(p_req -> 'history') h where h ->> 'direction' = 'out'), 'next_eligible_at', p_req ->> 'as_of',
           'engine_version', p_ver, 'canonical_hash', app.followup_request_hash(p_ver, coalesce(p_reqtext, p_req::text)), 'trace', '[]'::jsonb) $$;
create function pg_temp.cd(p_label text, p_lead text, p_channel text default 'email', p_req jsonb default null, p_res jsonb default null, p_ver text default '1.0.0', p_reqtext text default null)
returns text language plpgsql as $$
declare r jsonb := coalesce(p_req, pg_temp.req(p_lead));
begin
  return format('select public.create_followup_draft(%L, %L, %L, %L, %L, %L)', tests.rid('d_' || p_label), tests.rid(p_lead), p_channel, p_ver, coalesce(p_reqtext, r::text),
                coalesce(p_res, pg_temp.res(r, p_ver, p_reqtext))::text);
end $$;
create function pg_temp.mk(p_user text, p_label text, p_lead text, p_channel text default 'email') returns text language sql as $$
  select pg_temp.try(p_user, pg_temp.cd(p_label, p_lead, p_channel)) $$;
create function pg_temp.did(p_label text) returns uuid language sql as $$ select tests.rid('d_' || p_label) $$;
create function pg_temp.dst(p_label text) returns text language sql as $$ select status::text from public.followup_drafts where id = pg_temp.did(p_label) $$;
create function pg_temp.mklead(p_label text, p_keyed boolean default true, p_consent boolean default true, p_email boolean default true, p_status text default 'new') returns void language plpgsql as $$
begin
  insert into public.contacts (id, tenant_id, company_id, full_name, email, phone)
  values (tests.rid(p_label || '_c'), tests.tid('a'), tests.rid('a_company'), 'Contact ' || p_label, case when p_email then p_label || '@example.test' end,
          '+00 9' || lpad((abs(hashtext(p_label)) % 100000)::text, 5, '0'));
  insert into public.leads (id, tenant_id, company_id, contact_id, status, created_at) values (tests.rid(p_label), tests.tid('a'), tests.rid('a_company'), tests.rid(p_label || '_c'), p_status::public.lead_status, now() - interval '30 days');
  if p_keyed then
    perform pg_temp.run('a_owner', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid(p_label || '_c'),
            jsonb_build_object('version', 1, 'email', case when p_email then pg_temp.h(p_label || '_e') end, 'phone', pg_temp.h(p_label || '_p'))));
  end if;
  if p_consent then
    if p_email then
      perform pg_temp.run('a_owner', format($q$select public.record_consent(%L, %L, 'email', 'granted', 'explicit_consent', 'web_form', %L)$q$, tests.tid('a'), tests.rid(p_label || '_c'), 'ref:' || p_label));
    end if;
    perform pg_temp.run('a_owner', format($q$select public.record_consent(%L, %L, 'whatsapp', 'granted', 'explicit_consent', 'web_form', %L)$q$, tests.tid('a'), tests.rid(p_label || '_c'), 'refw:' || p_label));
  end if;
end $$;
create function pg_temp.mkdue(p_label text, p_outs int default 1) returns void language plpgsql as $$
begin
  perform pg_temp.mklead(p_label);
  for n in 1 .. p_outs loop
    perform pg_temp.run('a_sales', format('select public.record_touch(%L, %L, ''out'', ''email'', %L)', tests.rid('t_' || p_label || '_' || n), tests.rid(p_label), (now() - make_interval(days => 6 - n))::text));
  end loop;
end $$;
create function pg_temp.bl(p_asof text default '2026-10-07T06:30:00Z', p_hist text default '[{"timestamp": "2026-10-02T06:30:00Z", "channel": "email", "direction": "out", "outcome": "recorded_sent"}]',
                           p_flags text default '{}', p_gaps text default '[1, 2]', p_max int default 3, p_min int default 0, p_wd text default '[0, 1, 2, 3, 4]', p_hol text default '[]',
                           p_qs text default '21:00', p_qe text default '09:00', p_off int default 330) returns text language sql as $$
  select app.followup_blocker(jsonb_build_object('as_of', p_asof, 'recipient_utc_offset_minutes', p_off,
           'lead', jsonb_build_object('do_not_contact', false, 'opted_out', false, 'replied', false, 'bounced', false, 'won', false, 'lost', false) || p_flags::jsonb,
           'history', p_hist::jsonb,
           'policy', jsonb_build_object('gap_days', p_gaps::jsonb, 'max_touches', p_max, 'quiet_hours', jsonb_build_object('start', p_qs, 'end', p_qe), 'allowed_weekdays', p_wd::jsonb,
                                        'holidays', p_hol::jsonb, 'min_gap_hours', p_min))) $$;
create function pg_temp.o(p_ts text) returns text language sql as $$ select format('{"timestamp": "%s", "channel": "email", "direction": "out", "outcome": "recorded_sent"}', p_ts) $$;
create function pg_temp.i(p_ts text) returns text language sql as $$ select format('{"timestamp": "%s", "channel": "email", "direction": "in", "outcome": "recorded_reply"}', p_ts) $$;
create function pg_temp.gate(p_lead text, p_channel text default 'email', p_user text default 'a_sales') returns jsonb language sql as $$ select pg_temp.sc(p_user, format('select public.followup_gate(%L, %L)', tests.rid(p_lead), p_channel))::jsonb $$;

-- ============================================================================ A. the order
-- as_of 2026-10-07T06:30:00Z; one outbound touch five days before (so the lead is due unless something says otherwise); the entry under test is 'after', 'at' or 'before' as_of
create function pg_temp.when_(p_rel text) returns text language sql as $$ select case p_rel when 'after' then '2026-10-07T06:30:01Z' when 'at' then '2026-10-07T06:30:00Z' else '2026-10-07T06:29:59Z' end $$;
create function pg_temp.hist(p_dir text, p_rel text) returns text language sql as $$
  select '[' || pg_temp.o('2026-10-02T06:30:00Z') || ',' || case p_dir when 'out' then pg_temp.o(pg_temp.when_(p_rel)) else pg_temp.i(pg_temp.when_(p_rel)) end || ']' $$;
-- every stop, the entry's relation to as_of, the expected reason
create temp table order_cases (stop text, flags text, dir text, own text);
insert into order_cases values
  ('do_not_contact', '{"do_not_contact": true}', 'out', 'suppressed'), ('opted_out', '{"opted_out": true}', 'out', 'suppressed'), ('bounced', '{"bounced": true}', 'out', 'suppressed'),
  ('replied flag', '{"replied": true}', 'out', 'replied'), ('inbound entry', '{}', 'in', 'replied'),
  ('won', '{"won": true}', 'out', 'closed'), ('lost', '{"lost": true}', 'out', 'closed');
select is((select pg_temp.bl(p_hist => pg_temp.hist(c.dir, 'after'), p_flags => c.flags, p_max => 9, p_gaps => '[0,0,0,0,0,0,0,0]') from order_cases c where c.stop = 'do_not_contact'), 'future_history', 'A1 a suppressed lead (do_not_contact) with a history entry AFTER as_of: future_history, as the engine says');
select is((select pg_temp.bl(p_hist => pg_temp.hist(c.dir, 'after'), p_flags => c.flags, p_max => 9, p_gaps => '[0,0,0,0,0,0,0,0]') from order_cases c where c.stop = 'opted_out'), 'future_history', 'A2 ... opted_out');
select is((select pg_temp.bl(p_hist => pg_temp.hist(c.dir, 'after'), p_flags => c.flags, p_max => 9, p_gaps => '[0,0,0,0,0,0,0,0]') from order_cases c where c.stop = 'bounced'), 'future_history', 'A3 ... bounced');
select is((select pg_temp.bl(p_hist => pg_temp.hist(c.dir, 'after'), p_flags => c.flags, p_max => 9, p_gaps => '[0,0,0,0,0,0,0,0]') from order_cases c where c.stop = 'replied flag'), 'future_history', 'A4 a replied lead (the flag) with a future entry: future_history');
select is((select pg_temp.bl(p_hist => pg_temp.hist(c.dir, 'after'), p_flags => c.flags, p_max => 9, p_gaps => '[0,0,0,0,0,0,0,0]') from order_cases c where c.stop = 'inbound entry'), 'future_history', 'A5 a reply that is ITSELF after as_of: future_history');
select is((select pg_temp.bl(p_hist => pg_temp.hist(c.dir, 'after'), p_flags => c.flags, p_max => 9, p_gaps => '[0,0,0,0,0,0,0,0]') from order_cases c where c.stop = 'won'), 'future_history', 'A6 a closed lead (won) with a future entry: future_history');
select is((select pg_temp.bl(p_hist => pg_temp.hist(c.dir, 'after'), p_flags => c.flags, p_max => 9, p_gaps => '[0,0,0,0,0,0,0,0]') from order_cases c where c.stop = 'lost'), 'future_history', 'A7 ... lost');
-- exactly at as_of and before it: the stop's own reason (the entry is not in the future)
select is((select string_agg(c.stop || '=' || pg_temp.bl(p_hist => pg_temp.hist(c.dir, 'at'), p_flags => c.flags, p_max => 9, p_gaps => '[0,0,0,0,0,0,0,0]'), ', ' order by c.stop) from order_cases c),
          'bounced=suppressed, do_not_contact=suppressed, inbound entry=replied, lost=closed, opted_out=suppressed, replied flag=replied, won=closed', 'A8 an entry EXACTLY at as_of is not in the future: every stop names its own reason');
select is((select string_agg(c.stop || '=' || pg_temp.bl(p_hist => pg_temp.hist(c.dir, 'before'), p_flags => c.flags, p_max => 9, p_gaps => '[0,0,0,0,0,0,0,0]'), ', ' order by c.stop) from order_cases c),
          'bounced=suppressed, do_not_contact=suppressed, inbound entry=replied, lost=closed, opted_out=suppressed, replied flag=replied, won=closed', 'A9 an entry one second BEFORE as_of: the same');
-- the same boundary one second at a time, for the three stop families, on both sides
select is(pg_temp.bl(p_hist => '[' || pg_temp.o('2026-10-02T06:30:00Z') || ',' || pg_temp.o('2026-10-07T06:30:01Z') || ']', p_flags => '{"do_not_contact": true}', p_max => 9, p_gaps => '[0,0,0,0,0,0,0,0]'), 'future_history', 'A10 +1 s: future_history');
select is(pg_temp.bl(p_hist => '[' || pg_temp.o('2026-10-02T06:30:00Z') || ',' || pg_temp.o('2026-10-07T06:30:00Z') || ']', p_flags => '{"do_not_contact": true}', p_max => 9, p_gaps => '[0,0,0,0,0,0,0,0]'), 'suppressed', 'A11 +0 s: suppressed');
select is(pg_temp.bl(p_hist => '[' || pg_temp.o('2026-10-02T06:30:00Z') || ',' || pg_temp.o('2026-10-07T06:29:59Z') || ']', p_flags => '{"do_not_contact": true}', p_max => 9, p_gaps => '[0,0,0,0,0,0,0,0]'), 'suppressed', 'A12 -1 s: suppressed');
-- every combination of the six flags with a future entry is future_history; with none of them the lead is not blocked by a flag
select is((select count(*) from (select pg_temp.bl(p_hist => pg_temp.hist('out', 'after'),
             p_flags => jsonb_build_object('do_not_contact', (n & 1) > 0, 'opted_out', (n & 2) > 0, 'replied', (n & 4) > 0, 'bounced', (n & 8) > 0, 'won', (n & 16) > 0, 'lost', (n & 32) > 0)::text,
             p_max => 9, p_gaps => '[0,0,0,0,0,0,0,0]') r from generate_series(0, 63) n) x where r = 'future_history'), 64::bigint, 'A13 all 64 combinations of the six flags, with an entry after as_of: future_history every time');
select is((select count(*) from (select pg_temp.bl(p_hist => pg_temp.hist('out', 'at'),
             p_flags => jsonb_build_object('do_not_contact', (n & 1) > 0, 'opted_out', (n & 2) > 0, 'replied', (n & 4) > 0, 'bounced', (n & 8) > 0, 'won', (n & 16) > 0, 'lost', (n & 32) > 0)::text,
             p_max => 9, p_gaps => '[0,0,0,0,0,0,0,0]') r from generate_series(1, 63) n) x where r in ('suppressed', 'replied', 'closed')), 63::bigint, 'A14 and with the entry AT as_of, the 63 combinations that have a flag name a stop (never future_history)');
select is(pg_temp.bl(p_hist => pg_temp.hist('out', 'at'), p_max => 9, p_gaps => '[0,0,0,0,0,0,0,0]'), null, 'A15 no flag and an entry at as_of: the lead is DUE (due-ness unchanged)');
-- the order of the stops among themselves is the engine's: suppression, then a reply, then a close
select is(pg_temp.bl(p_hist => pg_temp.hist('out', 'before'), p_flags => '{"do_not_contact": true, "replied": true, "won": true}', p_max => 9, p_gaps => '[0,0,0,0,0,0,0,0]'), 'suppressed', 'A16 suppression wins over a reply and a close');
select is(pg_temp.bl(p_hist => pg_temp.hist('out', 'before'), p_flags => '{"replied": true, "won": true}', p_max => 9, p_gaps => '[0,0,0,0,0,0,0,0]'), 'replied', 'A17 a reply wins over a close');

-- ============================================================================ B. the rules below the stops keep their place
select is(pg_temp.bl(p_hist => '[' || pg_temp.o('2026-10-05T06:30:00Z') || ',' || pg_temp.o('2026-10-06T06:30:00Z') || ',' || pg_temp.o('2026-10-07T06:30:01Z') || ']', p_max => 3), 'future_history', 'B1 a future entry beats the touch cap (3 outbound entries under a limit of 3, one of them after as_of)');
select is(pg_temp.bl(p_hist => '[' || pg_temp.o('2026-10-05T06:30:00Z') || ',' || pg_temp.o('2026-10-06T06:30:00Z') || ',' || pg_temp.o('2026-10-07T06:30:00Z') || ']', p_max => 3), 'max_touches', 'B2 the same three, the last exactly at as_of: the cap');
select is(pg_temp.bl(p_hist => '[' || pg_temp.o('2026-10-07T06:30:01Z') || ']'), 'future_history', 'B3 a future entry as the only touch beats initial_outreach');
select is(pg_temp.bl(p_hist => '[]'), 'initial_outreach', 'B4 no touch at all: initial_outreach');
select is(pg_temp.bl(p_hist => pg_temp.hist('out', 'after'), p_gaps => '[99, 99]'), 'future_history', 'B5 a future entry beats the gap (not_yet)');
select is(pg_temp.bl(p_hist => '[' || pg_temp.o('2026-10-07T06:30:00Z') || ']', p_gaps => '[1, 1]'), 'not_yet', 'B6 an entry at as_of with a one-day gap: not_yet');
select is(pg_temp.bl(), null, 'B7 the base request is DUE');
select is(pg_temp.bl(p_asof => '2026-10-10T06:30:00Z', p_wd => '[0, 1, 2, 3, 4]'), 'not_yet', 'B8 the calendar rules are where they were (a Saturday)');

-- ============================================================================ C. unreadable input is still `invalid`, and first
select is(pg_temp.bl(p_hist => pg_temp.hist('out', 'after'), p_flags => '{"won": null}'), 'invalid', 'C1 a null flag with a future entry: invalid (unreadable input beats everything)');
select is(pg_temp.bl(p_hist => pg_temp.hist('out', 'after'), p_asof => 'garbage'), 'invalid', 'C2 an as_of that is not a time: invalid');
select is(app.followup_blocker('{}'::jsonb), 'invalid', 'C3 an empty request: invalid');
select is(app.followup_blocker(null), 'invalid', 'C4 a null request: invalid');
select is((select pg_temp.bl(p_hist => '{}')), 'invalid', 'C5 a history that is not a list: invalid');

-- ============================================================================ D. SAFETY through the real functions
select is(pg_temp.mkpol('p1'), 'ok', 'D0 (the benign policy of tenant a: noon clock, quiet 03:00-04:00, gaps 1 and 2 days, every weekday)');
-- every lead below is keyed and consented; its touches are planted the way only the operator can (the functions bound the time), at 'after' / 'at' / 'before' as_of
create function pg_temp.plant(p_lead text, p_dir text, p_rel text) returns void language plpgsql as $$
begin
  insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at, recorded_at)
  select gen_random_uuid(), tenant_id, id, contact_id, p_dir::public.touch_direction, 'email',
         case p_rel when 'after' then now() + interval '1 second' when 'at' then now() else now() - interval '1 second' end,
         case p_rel when 'after' then now() + interval '2 seconds' else now() end
    from public.leads where id = tests.rid(p_lead);
end $$;
-- a lead that is due (one outbound touch five days ago) with a stop and an entry in the given relation to as_of
create function pg_temp.mkstop(p_label text, p_stop text, p_rel text) returns void language plpgsql as $$
begin
  perform pg_temp.mkdue(p_label);
  if p_stop = 'replied' then
    perform pg_temp.plant(p_label, 'in', p_rel);
  else
    perform pg_temp.plant(p_label, 'out', p_rel);
    if p_stop = 'closed' then
      update public.leads set status = 'disqualified' where id = tests.rid(p_label);
    elsif p_stop = 'won' then
      insert into public.opportunities (tenant_id, company_id, contact_id, lead_id, title, status)
      select tenant_id, company_id, contact_id, id, 'Synthetic won deal', 'won' from public.leads where id = tests.rid(p_label);
    elsif p_stop = 'suppressed' then
      perform pg_temp.run('a_sales', format($q$select public.suppress_contact(%L, %L, 'opted_out', 'other', 'ref:sf')$q$, tests.tid('a'), tests.rid(p_label || '_c')));
    end if;
  end if;
end $$;
select pg_temp.mkstop('sf_rep_a', 'replied', 'after');   select pg_temp.mkstop('sf_rep_t', 'replied', 'at');   select pg_temp.mkstop('sf_rep_b', 'replied', 'before');
select pg_temp.mkstop('sf_cl_a', 'closed', 'after');     select pg_temp.mkstop('sf_cl_t', 'closed', 'at');     select pg_temp.mkstop('sf_cl_b', 'closed', 'before');
select pg_temp.mkstop('sf_won_a', 'won', 'after');       select pg_temp.mkstop('sf_won_t', 'won', 'at');       select pg_temp.mkstop('sf_won_b', 'won', 'before');
select pg_temp.mkstop('sf_sup_a', 'suppressed', 'after'); select pg_temp.mkstop('sf_sup_t', 'suppressed', 'at'); select pg_temp.mkstop('sf_sup_b', 'suppressed', 'before');
select is(pg_temp.mk('a_sales', 'd1', 'sf_rep_a'), 'SM225:future_history', 'D1 a replied lead whose reply lies after as_of: no draft, SM225 future_history');
select is(pg_temp.mk('a_sales', 'd2', 'sf_rep_t'), 'SM225:replied', 'D2 ... at as_of: no draft, SM225 replied');
select is(pg_temp.mk('a_sales', 'd3', 'sf_rep_b'), 'SM225:replied', 'D3 ... before as_of: no draft, SM225 replied');
select is(pg_temp.mk('a_sales', 'd4', 'sf_cl_a'), 'SM225:future_history', 'D4 a lost lead with a touch after as_of: no draft, SM225 future_history');
select is(pg_temp.mk('a_sales', 'd5', 'sf_cl_t'), 'SM225:closed', 'D5 ... at as_of: SM225 closed');
select is(pg_temp.mk('a_sales', 'd6', 'sf_cl_b'), 'SM225:closed', 'D6 ... before as_of: SM225 closed');
select is(pg_temp.mk('a_sales', 'd7', 'sf_won_a'), 'SM225:future_history', 'D7 a won lead with a touch after as_of: no draft, SM225 future_history');
select is(pg_temp.mk('a_sales', 'd8', 'sf_won_t'), 'SM225:closed', 'D8 ... at as_of: SM225 closed');
select is(pg_temp.mk('a_sales', 'd9', 'sf_won_b'), 'SM225:closed', 'D9 ... before as_of: SM225 closed');
select is(pg_temp.mk('a_sales', 'd10', 'sf_sup_a'), 'SM220:contact', 'D10 a SUPPRESSED contact with a touch after as_of: still SM220 from the gate (the gate runs before any of this)');
select is(pg_temp.mk('a_sales', 'd11', 'sf_sup_t'), 'SM220:contact', 'D11 ... at as_of: SM220');
select is(pg_temp.mk('a_sales', 'd12', 'sf_sup_b'), 'SM220:contact', 'D12 ... before as_of: SM220');
select is((select count(*) from public.followup_drafts where lead_id in (select tests.rid(l) from unnest(array['sf_rep_a', 'sf_rep_t', 'sf_rep_b', 'sf_cl_a', 'sf_cl_t', 'sf_cl_b', 'sf_won_a', 'sf_won_t', 'sf_won_b', 'sf_sup_a', 'sf_sup_t', 'sf_sup_b']) l)),
          0::bigint, 'D13 SAFETY: no draft was written for any of the twelve leads');
select is(pg_temp.gate('sf_sup_a') ->> 'blocked', 'contact', 'D14 the read still says contact for the suppressed lead');
select pg_temp.mkdue('sf_ok');
select is(pg_temp.mk('a_sales', 'd15', 'sf_ok'), 'ok', 'D15 due-ness is unchanged: a plain due lead still gets its draft');
select pg_temp.mkdue('sf_fut');   select pg_temp.plant('sf_fut', 'out', 'after');
select is(pg_temp.mk('a_sales', 'd16', 'sf_fut'), 'SM225:future_history', 'D16 a lead with only a future touch (no stop) is refused with future_history, as before');
-- the forged result cannot get around it: even with the engine's honest "draft" answer nothing is created (the database decides first)
select is(pg_temp.try('a_sales', pg_temp.cd('d17', 'sf_rep_a', 'email', null, pg_temp.res(pg_temp.req('sf_rep_a')))), 'SM225:future_history', 'D17 a result that claims a draft for a stopped lead is still refused (SM225): the database decides, not the result');
select is((select count(*) from public.followup_drafts where lead_id = tests.rid('sf_rep_a')), 0::bigint, 'D18 nothing written');

select * from finish();
