-- vb: the voice budget, our own spending cap on Cartesia (owner, 6 Nov 2026: Pro plan, 100,000 credits a month refreshing on the 29th, overages enabled at $65 per 1M, and Cartesia has no
-- spending cap of its own).
--   * a HARD daily limit of 20,000 Cartesia characters across all calls, and a HARD limit of 2,000 per call: a call reserves its allowance at the start (at most 2,000, at most what is left of the
--     day), speaks with Sarvam Bulbul once it is spent, and gives back what it did not use at the end. A reservation never given back (a crash) counts as spent: the cap errs on the safe side.
--   * the count is per day (India time) and per source: `call` (a phone call), `talk` (Live talk in the browser), `script` (renders made by local scripts, counted in by the operator).
--   * Today's "Needs you" in ONE workspace (the platform owner's, `notice_tenant`, set by the operator): the day at 80 and 100 percent of its limit, the month at 80 and 100 percent of the plan.
-- The numbers live in public.voice_budget (one row per engine). Nothing here sends anything or calls a provider.

create table public.voice_budget (
  engine          text primary key check (engine in ('cartesia')),
  daily_chars     integer not null check (daily_chars between 0 and 10000000),
  per_call_chars  integer not null check (per_call_chars between 0 and 1000000),
  monthly_credits integer not null check (monthly_credits between 0 and 1000000000),
  period_day      smallint not null check (period_day between 1 and 31),   -- the day of the month the plan's credits refresh (clamped to the month's length)
  notice_tenant   uuid references public.tenants (id) on delete set null,  -- the one workspace whose Today shows the warnings
  updated_at      timestamptz not null default now()
);
alter table public.voice_budget enable row level security;
alter table public.voice_budget force row level security;
revoke all on public.voice_budget from public, anon, authenticated, service_role;   -- no policies: read and written only by the functions below and by the operator
insert into public.voice_budget (engine, daily_chars, per_call_chars, monthly_credits, period_day) values ('cartesia', 20000, 2000, 100000, 29);

create table public.voice_usage_days (
  day    date not null,
  engine text not null check (engine in ('cartesia')),
  source text not null check (source in ('call', 'talk', 'script')),
  chars  bigint not null default 0 check (chars >= 0),
  primary key (day, engine, source)
);
alter table public.voice_usage_days enable row level security;
alter table public.voice_usage_days force row level security;
revoke all on public.voice_usage_days from public, anon, authenticated, service_role;

create table public.voice_budget_holds (
  id          uuid primary key default gen_random_uuid(),
  day         date not null,
  engine      text not null check (engine in ('cartesia')),
  source      text not null check (source in ('call', 'talk')),
  granted     integer not null check (granted >= 0),
  used        integer check (used is null or (used >= 0 and used <= granted)),
  holder      uuid not null,                       -- the signed-in principal that reserved (only it can give back)
  created_at  timestamptz not null default now(),
  released_at timestamptz
);
alter table public.voice_budget_holds enable row level security;
alter table public.voice_budget_holds force row level security;
revoke all on public.voice_budget_holds from public, anon, authenticated, service_role;
comment on column public.voice_budget.engine is 'SAFE: the voice engine. CLEAN-EXEMPT: closed CHECK list';
comment on column public.voice_usage_days.engine is 'SAFE: the voice engine. CLEAN-EXEMPT: closed CHECK list';
comment on column public.voice_usage_days.source is 'SAFE: call | talk | script. CLEAN-EXEMPT: closed CHECK list';
comment on column public.voice_budget_holds.engine is 'SAFE: the voice engine. CLEAN-EXEMPT: closed CHECK list';
comment on column public.voice_budget_holds.source is 'SAFE: call | talk. CLEAN-EXEMPT: closed CHECK list';
comment on column public.voice_budget_holds.holder is 'SAFE: the signed-in principal that reserved (a user id, no name); only it can give back';
create index voice_budget_holds_open on public.voice_budget_holds (holder, day) where released_at is null;

create function app.voice_day() returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

-- the start of the plan period that contains `p_day`: the period_day of this month (or of last month, if that day has not come yet), clamped to the month's last day
create function app.voice_period_start(p_day date, p_period_day smallint) returns date
language sql
immutable
set search_path = ''
as $$
  select case when p_day >= this_start then this_start else last_start end
    from (select least(date_trunc('month', p_day)::date + (p_period_day - 1), (date_trunc('month', p_day) + interval '1 month - 1 day')::date) as this_start,
                 least((date_trunc('month', p_day) - interval '1 month')::date + (p_period_day - 1), (date_trunc('month', p_day) - interval '1 day')::date) as last_start) s
$$;

-- reserve: the caller asks for up to `p_want` characters for one call or talk; it gets at most the per-call limit and at most what is left of the day (0 when nothing is left). Counted as spent at once.
create function public.voice_budget_reserve(p_engine text, p_want integer, p_source text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.voice_budget;
  v_day date := app.voice_day();
  v_used bigint;
  v_grant integer;
  v_open integer;
  v_hold uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  if p_source not in ('call', 'talk') or p_want is null or p_want < 0 then
    raise exception 'voice_budget_reserve: bad arguments' using errcode = '22023';
  end if;
  select * into b from public.voice_budget where engine = p_engine for update;   -- one reservation at a time: the day's total cannot be overrun by two calls at once
  if not found then
    raise exception 'voice_budget_reserve: unknown engine' using errcode = '22023';
  end if;
  -- one principal holds at most 5 open reservations (a phone line runs one call at a time; this only stops a runaway caller from locking the day away)
  select count(*) into v_open from public.voice_budget_holds where holder = auth.uid() and day = v_day and released_at is null;
  select coalesce(sum(chars), 0) into v_used from public.voice_usage_days where day = v_day and engine = p_engine;
  v_grant := case when v_open >= 5 then 0 else greatest(0, least(p_want, b.per_call_chars, b.daily_chars - v_used))::integer end;
  insert into public.voice_budget_holds (day, engine, source, granted, holder) values (v_day, p_engine, p_source, v_grant, auth.uid()) returning id into v_hold;
  insert into public.voice_usage_days (day, engine, source, chars) values (v_day, p_engine, p_source, v_grant)
    on conflict (day, engine, source) do update set chars = public.voice_usage_days.chars + excluded.chars;
  return jsonb_build_object('hold', v_hold, 'granted', v_grant, 'day_used', v_used + v_grant, 'day_limit', b.daily_chars, 'per_call', b.per_call_chars);
end;
$$;
revoke all on function public.voice_budget_reserve(text, integer, text) from public, anon;
grant execute on function public.voice_budget_reserve(text, integer, text) to authenticated;

-- release: the call is over; what it did not use goes back to the day. Only the principal that reserved can give back, once (a second call changes nothing).
create function public.voice_budget_release(p_hold uuid, p_used integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  h public.voice_budget_holds;
  v_used integer;
  v_day_used bigint;
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  select * into h from public.voice_budget_holds where id = p_hold and holder = auth.uid() for update;
  if not found then
    raise exception 'voice_budget_release: no such reservation' using errcode = 'P0002';
  end if;
  if h.released_at is null then
    v_used := least(h.granted, greatest(0, coalesce(p_used, h.granted)));
    update public.voice_budget_holds set used = v_used, released_at = now() where id = h.id;
    update public.voice_usage_days set chars = greatest(0, chars - (h.granted - v_used)) where day = h.day and engine = h.engine and source = h.source;
  end if;
  select coalesce(sum(chars), 0) into v_day_used from public.voice_usage_days where day = h.day and engine = h.engine;
  return jsonb_build_object('used', coalesce(v_used, h.used), 'granted', h.granted, 'day_used', v_day_used);
end;
$$;
revoke all on function public.voice_budget_release(uuid, integer) from public, anon;
grant execute on function public.voice_budget_release(uuid, integer) to authenticated;

-- the operator counts in characters spent outside the API (local renders: the landing clips, the stand-up audio). Not callable by any client.
create function app.voice_usage_add_script(p_day date, p_engine text, p_chars integer) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.voice_usage_days (day, engine, source, chars) values (p_day, p_engine, 'script', greatest(0, p_chars))
    on conflict (day, engine, source) do update set chars = public.voice_usage_days.chars + excluded.chars
$$;
revoke all on function app.voice_usage_add_script(date, text, integer) from public, anon, authenticated;

-- Today's "Needs you" for the platform owner's workspace only (Owner, Admin): the day at 80 / 100 percent of its limit, the month at 80 / 100 percent of the plan's credits
create function app.today_voice_budget_items(p_tenant uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  b public.voice_budget;
  v_day date := app.voice_day();
  v_start date;
  v_day_used bigint;
  v_month_used bigint;
  v_items jsonb := '[]'::jsonb;
  v_ref text;
begin
  if auth.uid() is null or not app.has_tenant_role(p_tenant, array['owner', 'admin']::public.app_role[]) then
    return '[]'::jsonb;
  end if;
  select * into b from public.voice_budget where engine = 'cartesia' and notice_tenant = p_tenant;
  if not found then
    return '[]'::jsonb;
  end if;
  v_start := app.voice_period_start(v_day, b.period_day);
  select coalesce(sum(chars), 0) into v_day_used from public.voice_usage_days where engine = b.engine and day = v_day;
  select coalesce(sum(chars), 0) into v_month_used from public.voice_usage_days where engine = b.engine and day >= v_start and day <= v_day;
  v_ref := case when b.daily_chars > 0 and v_day_used >= b.daily_chars then 'day_100' when v_day_used * 10 >= b.daily_chars::bigint * 8 and b.daily_chars > 0 then 'day_80' end;
  if v_ref is not null then
    v_items := v_items || jsonb_build_array(jsonb_build_object('kind', 'voice_credits', 'id', md5('voice:' || b.engine || ':' || v_ref || ':' || v_day::text)::uuid, 'ref', v_ref, 'at', now()));
  end if;
  v_ref := case when b.monthly_credits > 0 and v_month_used >= b.monthly_credits then 'month_100' when b.monthly_credits > 0 and v_month_used * 10 >= b.monthly_credits::bigint * 8 then 'month_80' end;
  if v_ref is not null then
    v_items := v_items || jsonb_build_array(jsonb_build_object('kind', 'voice_credits', 'id', md5('voice:' || b.engine || ':' || v_ref || ':' || v_start::text)::uuid, 'ref', v_ref, 'at', now()));
  end if;
  return v_items;
end;
$$;
revoke all on function app.today_voice_budget_items(uuid) from public;
grant execute on function app.today_voice_budget_items(uuid) to authenticated;   -- today_summary runs as the caller; this answers only the caller's own workspace, and only the notice workspace

do $do$
declare
  v_def text := pg_get_functiondef('public.today_summary(uuid)'::regprocedure);
  v_new text;
  v_anchor text := '  ), top as (';
begin
  if position(v_anchor in v_def) = 0 or position('voice_credits' in v_def) > 0 then
    raise exception 'vb_voice_budget: today_summary is not the one this migration expects';
  end if;
  v_new := replace(v_def, v_anchor, '    union all
    select u.kind, u.id, ''Voice credits''::text, null::text, ''followup_desk'', u.ref, null::bigint, u.at, ''billing'', p_tenant_id
      from jsonb_to_recordset(app.today_voice_budget_items(p_tenant_id)) as u(kind text, id uuid, ref text, at timestamptz)
' || v_anchor);
  execute v_new;
end
$do$;
