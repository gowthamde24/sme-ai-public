-- A small daily allowance per workspace and feature (24 Nov 2026), for model-backed helpers that must not run away: first user "Describe the job" (30 a day per workspace).
-- The count is kept in the database so it holds across API instances. Tenant table outside the public schema: no client role has any privilege; public.daily_cap_take is the only door.
-- Rollback = drop schema daily_caps cascade and the function.

create schema daily_caps;
revoke all on schema daily_caps from public, anon, authenticated, service_role;

create table daily_caps.use (
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  feature   text not null check (feature in ('describe_job')),
  day       date not null,
  n         integer not null default 0 check (n >= 0),
  primary key (tenant_id, feature, day)
);
comment on table daily_caps.use is 'How many times a workspace used a model-backed helper today. Counts only; never any text.';
alter table daily_caps.use enable row level security;
alter table daily_caps.use force row level security;
revoke all on daily_caps.use from public, anon, authenticated, service_role;

-- takes one use if the day's allowance has room (Owner and Admin of the workspace); the day is India's day
create function public.daily_cap_take(p_tenant_id uuid, p_feature text, p_limit integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_day date := (now() at time zone 'Asia/Kolkata')::date;
  v_n integer;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_feature not in ('describe_job') or p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  insert into daily_caps.use (tenant_id, feature, day, n) values (p_tenant_id, p_feature, v_day, 1)
  on conflict (tenant_id, feature, day) do update set n = daily_caps.use.n + 1 where daily_caps.use.n < p_limit
  returning n into v_n;
  if v_n is null then
    return jsonb_build_object('ok', false, 'limit', p_limit);
  end if;
  delete from daily_caps.use where day < v_day - 7;
  return jsonb_build_object('ok', true, 'used', v_n, 'limit', p_limit);
end $$;
revoke all on function public.daily_cap_take(uuid, text, integer) from public, anon;
grant execute on function public.daily_cap_take(uuid, text, integer) to authenticated;
