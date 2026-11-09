-- vb fix (6 Nov 2026): the DAILY limit (20,000 Cartesia characters across all calls) counts calls and Live talk only. Characters counted in by the operator (`script`: local renders, or the
-- gap to the Cartesia dashboard) count towards the MONTH only. Before this, seeding the month's 97,672 characters on 6 Nov made that day look 'over the limit', so every call that day would
-- have been given 0 Cartesia characters (Sarvam only) and Needs you would have said the day's limit was reached. Same functions, same grants; one condition each.

create or replace function public.voice_budget_reserve(p_engine text, p_want integer, p_source text) returns jsonb
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
  select coalesce(sum(chars), 0) into v_used from public.voice_usage_days where day = v_day and engine = p_engine and source <> 'script';   -- the day's limit is for calls and talk only
  v_grant := case when v_open >= 5 then 0 else greatest(0, least(p_want, b.per_call_chars, b.daily_chars - v_used))::integer end;
  insert into public.voice_budget_holds (day, engine, source, granted, holder) values (v_day, p_engine, p_source, v_grant, auth.uid()) returning id into v_hold;
  insert into public.voice_usage_days (day, engine, source, chars) values (v_day, p_engine, p_source, v_grant)
    on conflict (day, engine, source) do update set chars = public.voice_usage_days.chars + excluded.chars;
  return jsonb_build_object('hold', v_hold, 'granted', v_grant, 'day_used', v_used + v_grant, 'day_limit', b.daily_chars, 'per_call', b.per_call_chars);
end;
$$;

create or replace function public.voice_budget_release(p_hold uuid, p_used integer) returns jsonb
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
  select coalesce(sum(chars), 0) into v_day_used from public.voice_usage_days where day = h.day and engine = h.engine and source <> 'script';
  return jsonb_build_object('used', coalesce(v_used, h.used), 'granted', h.granted, 'day_used', v_day_used);
end;
$$;

create or replace function app.today_voice_budget_items(p_tenant uuid) returns jsonb
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
  select coalesce(sum(chars), 0) into v_day_used from public.voice_usage_days where engine = b.engine and day = v_day and source <> 'script';   -- the month counts everything
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
