-- T010 part 2, commit 2b (owner decision on the divergence found by the equivalence gate, tests/integration/test_followup_equivalence.py): app.followup_blocker_inner follows the pinned engine's
-- ORDER of checks exactly. create or replace of that ONE function: same signature, same (absent) grants, set search_path = ''; the only change is where the future-history check sits.
--
-- The engine's order (packages/pure/followup_cadence/__init__.py, decide()):
--   1. _bounded: size and shape limits (OUT_OF_RANGE);   2. _validate: every field, type and range, ending with the history loop where an entry AFTER as_of is a rejection (FUTURE_HISTORY);
--   3. the rules, in this order: do_not_contact / opted_out / bounced (suppression), a reply (the replied flag or any inbound entry), won / lost, the touch cap, no outbound touch
--      (initial outreach), then the gap in days, the minimum gap and the calendar (weekday, holiday, quiet hours).
-- A rejection therefore beats every stop. The database used to check the flags, a reply and a close BEFORE the future-history rule and named those instead; due-ness always agreed, only the
-- NAME of the reason differed. Now the order here is: unreadable input ('invalid'), future history, suppressed, replied, closed, max_touches, initial_outreach, not_yet. Nothing else changes:
-- every request that is not due is still not due (create_followup_draft still refuses it with SM225), and the gate (SM220 / SM221) still runs before any of this.

create or replace function app.followup_blocker_inner(p_request jsonb) returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_lead    jsonb := p_request -> 'lead';
  v_pol     jsonb := p_request -> 'policy';
  v_as      timestamp := ((p_request ->> 'as_of')::timestamptz at time zone 'UTC');
  v_outs    timestamp[];
  v_n       integer;
  v_last    timestamp;
  v_gap     integer;
  v_off     integer := (p_request ->> 'recipient_utc_offset_minutes')::integer;
  v_local   timestamp;
  v_wd      integer;
  v_min     integer;
  v_qs      integer;
  v_qe      integer;
  v_quiet   boolean;
begin
  -- every input the rules read must be present; a missing value would make a comparison NULL (read as false), which must never mean "due"
  if p_request is null or v_lead is null or v_pol is null or v_as is null or v_off is null
     or (v_lead ->> 'do_not_contact') is null or (v_lead ->> 'opted_out') is null or (v_lead ->> 'replied') is null or (v_lead ->> 'bounced') is null
     or (v_lead ->> 'won') is null or (v_lead ->> 'lost') is null
     or (v_pol ->> 'max_touches') is null or (v_pol ->> 'min_gap_hours') is null or (v_pol -> 'quiet_hours' ->> 'start') is null or (v_pol -> 'quiet_hours' ->> 'end') is null
     or jsonb_typeof(p_request -> 'history') <> 'array' or jsonb_typeof(v_pol -> 'gap_days') <> 'array' or jsonb_typeof(v_pol -> 'allowed_weekdays') <> 'array'
     or jsonb_typeof(v_pol -> 'holidays') <> 'array' then
    return 'invalid';
  end if;
  -- the engine's own order (packages/pure/followup_cadence, decide()): it VALIDATES the whole request first, and a history entry after as_of is a validation REJECTION (FUTURE_HISTORY), so it
  -- beats every rule below, including the stop flags; only then the rules run in this order: do_not_contact / opted_out / bounced, a reply, won / lost, the touch cap, no outbound touch,
  -- the gap and the calendar (owner decision, commit 2b: the pinned engine is the contract, the database follows it)
  if exists (select 1 from jsonb_array_elements(p_request -> 'history') h where ((h ->> 'timestamp')::timestamptz at time zone 'UTC') > v_as) then
    return 'future_history';
  end if;
  if (v_lead ->> 'do_not_contact')::boolean or (v_lead ->> 'opted_out')::boolean or (v_lead ->> 'bounced')::boolean then
    return 'suppressed';
  end if;
  if (v_lead ->> 'replied')::boolean or exists (select 1 from jsonb_array_elements(p_request -> 'history') h where h ->> 'direction' = 'in') then
    return 'replied';
  end if;
  if (v_lead ->> 'won')::boolean or (v_lead ->> 'lost')::boolean then
    return 'closed';
  end if;
  select coalesce(array_agg((h ->> 'timestamp')::timestamptz at time zone 'UTC'), '{}') into v_outs
    from jsonb_array_elements(p_request -> 'history') h where h ->> 'direction' = 'out';
  v_n := cardinality(v_outs);
  if v_n >= (v_pol ->> 'max_touches')::integer then
    return 'max_touches';
  end if;
  if v_n = 0 then
    return 'initial_outreach';
  end if;
  select max(x) into v_last from unnest(v_outs) x;
  v_gap := (v_pol -> 'gap_days' ->> (v_n - 1))::integer;
  if v_gap is null then
    return 'invalid';
  end if;
  if v_as < v_last + v_gap * interval '1 day' or v_as < v_last + (v_pol ->> 'min_gap_hours')::integer * interval '1 hour' then
    return 'not_yet';
  end if;
  -- the recipient's local clock at as_of
  v_local := v_as + v_off * interval '1 minute';
  v_wd := extract(isodow from v_local)::integer - 1;
  if not exists (select 1 from jsonb_array_elements_text(v_pol -> 'allowed_weekdays') w where w::integer = v_wd)
     or (v_pol -> 'holidays') ? to_char(v_local, 'YYYY-MM-DD') then
    return 'not_yet';
  end if;
  v_min := extract(hour from v_local)::integer * 60 + extract(minute from v_local)::integer;
  v_qs := split_part(v_pol -> 'quiet_hours' ->> 'start', ':', 1)::integer * 60 + split_part(v_pol -> 'quiet_hours' ->> 'start', ':', 2)::integer;
  v_qe := split_part(v_pol -> 'quiet_hours' ->> 'end', ':', 1)::integer * 60 + split_part(v_pol -> 'quiet_hours' ->> 'end', ':', 2)::integer;
  v_quiet := case when v_qs < v_qe then v_min >= v_qs and v_min < v_qe else v_min >= v_qs or v_min < v_qe end;
  if v_quiet then
    return 'not_yet';
  end if;
  return null;
end;
$$;

