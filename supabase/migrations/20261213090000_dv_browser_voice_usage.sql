-- Job DV follow-up: the browser voice's daily caps, kept in the database so two API instances (and a restart) share one count.
--
--   workspace.browser_voice_days    one row per (workspace, India day): seconds of talking time, characters sent to the voice engines, sessions opened. Numbers only: no audio, no words.
--   public.browser_voice_usage_get  any member: today's numbers
--   public.browser_voice_usage_add  Owner, Admin or Sales (the people who may talk to the assistant): adds to today's numbers; each call is bounded (a session reports every few seconds), so one call cannot
--                                   fill the day by itself; the day is India's (Asia/Kolkata) and is decided HERE, not by the caller. Rows older than 40 days are removed on the way.
-- No second factor (talking is not a sensitive change). SQLSTATEs: 42501 deny, 22023 invalid.

create table workspace.browser_voice_days (
  workspace_id uuid not null references public.tenants (id) on delete restrict,
  day          date not null,
  seconds      integer not null default 0 check (seconds >= 0),
  tts_chars    integer not null default 0 check (tts_chars >= 0),
  sessions     integer not null default 0 check (sessions >= 0),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, day)
);
alter table workspace.browser_voice_days enable row level security;
alter table workspace.browser_voice_days force row level security;
revoke all on workspace.browser_voice_days from public, anon, authenticated, service_role;

create function app.browser_voice_today() returns date
language sql
stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
revoke all on function app.browser_voice_today() from public;

create function app.browser_voice_json(p_tenant uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('day', app.browser_voice_today(),
    'seconds', coalesce((select d.seconds from workspace.browser_voice_days d where d.workspace_id = p_tenant and d.day = app.browser_voice_today()), 0),
    'tts_chars', coalesce((select d.tts_chars from workspace.browser_voice_days d where d.workspace_id = p_tenant and d.day = app.browser_voice_today()), 0),
    'sessions', coalesce((select d.sessions from workspace.browser_voice_days d where d.workspace_id = p_tenant and d.day = app.browser_voice_today()), 0))
$$;
revoke all on function app.browser_voice_json(uuid) from public;

create function public.browser_voice_usage_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.workspace_error('deny');
  end if;
  return app.browser_voice_json(p_tenant_id);
end;
$$;
revoke all on function public.browser_voice_usage_get(uuid) from public, anon;
grant execute on function public.browser_voice_usage_get(uuid) to authenticated;

create function public.browser_voice_usage_add(p_tenant_id uuid, p_seconds integer, p_chars integer, p_sessions integer default 0) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.workspace_error('deny');
  end if;
  if p_seconds is null or p_chars is null or p_sessions is null or p_seconds not between 0 and 600 or p_chars not between 0 and 6000 or p_sessions not between 0 and 1 then
    perform app.workspace_error('invalid');
  end if;
  insert into workspace.browser_voice_days as d (workspace_id, day, seconds, tts_chars, sessions, updated_at)
  values (p_tenant_id, app.browser_voice_today(), p_seconds, p_chars, p_sessions, now())
  on conflict (workspace_id, day) do update
    set seconds = d.seconds + excluded.seconds, tts_chars = d.tts_chars + excluded.tts_chars, sessions = d.sessions + excluded.sessions, updated_at = excluded.updated_at;
  delete from workspace.browser_voice_days where workspace_id = p_tenant_id and day < app.browser_voice_today() - 40;
  return app.browser_voice_json(p_tenant_id);
end;
$$;
revoke all on function public.browser_voice_usage_add(uuid, integer, integer, integer) from public, anon;
grant execute on function public.browser_voice_usage_add(uuid, integer, integer, integer) to authenticated;
