-- Owner, 14 Nov 2026: "switch OFF quiet hours on STAGING only so I can test WhatsApp and calls at any time; real sends still only to the sandbox/test numbers. Production keeps quiet hours (21:00-09:00 IST)."
--
-- ONE platform flag, `testing_open_hours`, OFF everywhere by default. Each Supabase project has its OWN platform_flags table, so the flag is environment-scoped by construction: it is set ON by hand in the
-- STAGING project only (docs/ops/staging.md) and nobody sets it in production. While it is ON, the three rules that close the clock open:
--   * the quiet hours of messages (app.outbox_in_quiet_hours, both forms) -> never "in quiet hours"; app.outbox_next_open -> now
--   * the calling hours (app.outreach_in_hours) -> always inside; app.outreach_slot -> now
-- Everything else stays exactly as it was: consent, STOP, the per-customer limit, the WhatsApp 24-hour window, the kill switches, and the sandbox fence on who can really be reached
-- (WHATSAPP_ALLOWED_RECIPIENTS, the Plivo sandbox list). Only the CLOCK is open. Only the migration role can write platform_flags (no policy, no grant).

alter table public.platform_flags drop constraint platform_flags_key_check;
alter table public.platform_flags add constraint platform_flags_key_check
  check (key in ('agents_enabled', 'selftest_enabled', 'research_enabled', 'requirement_enabled', 'assistant_enabled', 'outbox_enabled', 'billing_enforced', 'lapse_erasure', 'testing_open_hours'));
insert into public.platform_flags (key, enabled) values ('testing_open_hours', false);

create function app.testing_open_hours() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select f.enabled from public.platform_flags f where f.key = 'testing_open_hours'), false)
$$;
revoke all on function app.testing_open_hours() from public, anon, authenticated, service_role;

-- the old one-argument helpers were immutable (a fixed 21 / 9); they now read a flag, so they are stable
create or replace function app.outbox_in_quiet_hours(p_at timestamptz) returns boolean
language sql
stable
set search_path = ''
as $$
  select not app.testing_open_hours() and (extract(hour from (p_at at time zone 'Asia/Kolkata')) >= 21 or extract(hour from (p_at at time zone 'Asia/Kolkata')) < 9)
$$;

create or replace function app.outbox_next_open(p_at timestamptz) returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
           when app.testing_open_hours() then p_at
           when extract(hour from l) < 9  then (date_trunc('day', l) + interval '9 hours') at time zone 'Asia/Kolkata'
           when extract(hour from l) >= 21 then (date_trunc('day', l) + interval '1 day 9 hours') at time zone 'Asia/Kolkata'
           else p_at
         end
    from (select p_at at time zone 'Asia/Kolkata' as l) x
$$;

create or replace function app.outbox_in_quiet_hours(p_at timestamptz, p_tenant uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select not app.testing_open_hours()
         and (extract(hour from (p_at at time zone 'Asia/Kolkata')) >= q.o_start or extract(hour from (p_at at time zone 'Asia/Kolkata')) < q.o_end)
    from app.outbox_quiet_hours_of(p_tenant) q
$$;

create or replace function app.outbox_next_open(p_at timestamptz, p_tenant uuid) returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
           when app.testing_open_hours() then p_at
           when extract(hour from l) < q.o_end   then (date_trunc('day', l) + make_interval(hours => q.o_end)) at time zone 'Asia/Kolkata'
           when extract(hour from l) >= q.o_start then (date_trunc('day', l) + interval '1 day' + make_interval(hours => q.o_end)) at time zone 'Asia/Kolkata'
           else p_at
         end
    from (select p_at at time zone 'Asia/Kolkata' as l) x, app.outbox_quiet_hours_of(p_tenant) q
$$;

create or replace function app.outreach_in_hours(p_tenant uuid, p_at timestamptz) returns boolean
language plpgsql
stable
set search_path = ''
as $$
declare
  h jsonb := app.outreach_hours(p_tenant);
  l timestamp := p_at at time zone 'Asia/Kolkata';
  m integer := extract(hour from l)::integer * 60 + extract(minute from l)::integer;
begin
  if app.testing_open_hours() then
    return true;
  end if;
  return (h -> 'days') @> to_jsonb(extract(isodow from l)::integer)
     and not (h -> 'holidays') @> to_jsonb(to_char(l, 'YYYY-MM-DD'))
     and m >= (h ->> 'from_minute')::integer and m < (h ->> 'to_minute')::integer;
end;
$$;

create or replace function app.outreach_slot(p_tenant uuid, p_from timestamptz) returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  h jsonb := app.outreach_hours(p_tenant);
  l timestamp := p_from at time zone 'Asia/Kolkata';
  d timestamp;
  v_start timestamp;
  v_end timestamp;
  v_cand timestamp;
  i integer;
begin
  if app.testing_open_hours() then
    return p_from;
  end if;
  for i in 0..30 loop
    d := date_trunc('day', l) + make_interval(days => i);
    if (h -> 'days') @> to_jsonb(extract(isodow from d)::integer) and not (h -> 'holidays') @> to_jsonb(to_char(d, 'YYYY-MM-DD')) then
      v_start := d + make_interval(mins => (h ->> 'from_minute')::integer);
      v_end := d + make_interval(mins => (h ->> 'to_minute')::integer);
      v_cand := case when i = 0 then greatest(v_start, l) else v_start end;
      if v_cand < v_end then
        return v_cand at time zone 'Asia/Kolkata';
      end if;
    end if;
  end loop;
  return p_from + interval '1 day';
end;
$$;
