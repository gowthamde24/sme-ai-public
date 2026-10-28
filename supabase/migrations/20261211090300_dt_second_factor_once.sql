-- Job DT (ADR 0115, owner correction of 28 Oct): THE SECOND FACTOR IS ASKED ONCE PER SIGN-IN SESSION, NEVER ON A TIMER.
-- The earlier migration (20261211090100) also asked for a sign-in within 10 minutes; the owner decided against any window. Now app.require_aal2() and the client-write trigger on memberships and tenants mean exactly:
--   a person who TURNED A SECOND FACTOR ON (a verified authenticator in auth.mfa_factors) must have entered it in this session (the token says aal2, and a session that entered the code stays aal2 until it ends);
--   a person who did not is never asked.
-- The sentence and SQLSTATE (SM306) are unchanged. The sign-in time helper is gone; the status function no longer reports a window.

create or replace function app.require_aal2() returns void
language plpgsql
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' and app.second_factor_on(auth.uid()) then
    raise exception 'a second factor is required for this action' using errcode = 'SM306';
  end if;
end;
$$;

create or replace function app.guard_aal2_client_write() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- security INVOKER on purpose: current_user is the role running the statement
  if current_user in ('authenticated', 'anon') and coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' and app.my_second_factor_on() then
    raise exception 'a second factor is required for this action' using errcode = 'SM306';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

drop function public.account_security_get();
create function public.account_security_get() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_provider text;
begin
  if auth.uid() is null then
    perform app.workspace_error('deny');
  end if;
  select coalesce(u.raw_app_meta_data ->> 'provider', 'email') into v_provider from auth.users u where u.id = auth.uid();
  return jsonb_build_object(
    'second_factor_on', app.second_factor_on(auth.uid()),
    'provider', case when v_provider in ('google', 'facebook') then v_provider else 'email' end);
end;
$$;
revoke all on function public.account_security_get() from public, anon;
grant execute on function public.account_security_get() to authenticated;

drop function app.last_signin_at();
