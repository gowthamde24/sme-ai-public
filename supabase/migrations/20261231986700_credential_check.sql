-- The WhatsApp platform token's expiry is READ from Meta once a day instead of typed in by hand (planner, 20 Nov 2026; Customer Zero code list item 1): the worker asks Meta's debug_token for the day the token
-- stops working and writes it here, so the existing credential-deadline alerts (one "warn" alert from 14 days before, one "over" alert on the day, e-mailed to the owner and shown in the staff console) fire
-- on the REAL date, also when someone renews the token to another date. Platform data; nothing in it is a credential: a key word, a sentence, a date.
--   * ops.credential_deadlines gets two times: when the date was last read successfully (checked_at) and when a read was last tried (attempted_at), so a day has one successful read and a failing read is tried again after
--     the retry gap, not every minute;
--   * ops_credential_check_due says whether a read is due; ops_credential_check_attempt marks a try; ops_credential_deadline_set writes what Meta said (a token that never expires is the year 2100: it never warns).

alter table ops.credential_deadlines add column checked_at timestamptz;
alter table ops.credential_deadlines add column attempted_at timestamptz;
comment on column ops.credential_deadlines.checked_at is 'SAFE: a time. CLEAN-EXEMPT: a time';
comment on column ops.credential_deadlines.attempted_at is 'SAFE: a time. CLEAN-EXEMPT: a time';

create function public.ops_credential_check_due(p_key text, p_hours integer default 24, p_retry_minutes integer default 60) returns boolean language plpgsql stable security definer set search_path = '' as
$$
declare
  c ops.credential_deadlines;
begin
  perform ops.system_only();
  if p_key is null or p_key !~ '^[a-z0-9_.-]{3,60}$' or p_hours is null or p_hours not between 1 and 720 or p_retry_minutes is null or p_retry_minutes not between 1 and 1440 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  select * into c from ops.credential_deadlines d where d.key = p_key;
  if not found then
    return true;
  end if;
  return (c.checked_at is null or c.checked_at <= now() - make_interval(hours => p_hours))
     and (c.attempted_at is null or c.attempted_at <= now() - make_interval(mins => p_retry_minutes));
end $$;
revoke all on function public.ops_credential_check_due(text, integer, integer) from public, anon;
grant execute on function public.ops_credential_check_due(text, integer, integer) to authenticated;

-- a try is marked BEFORE the read (a crash or a refusal does not make the next tick try again at once); the first try makes the row, with the year 2100 until Meta has answered
create function public.ops_credential_check_attempt(p_key text, p_label text) returns void language plpgsql security definer set search_path = '' as
$$
begin
  perform ops.system_only();
  if p_key is null or p_key !~ '^[a-z0-9_.-]{3,60}$' or p_label is null or char_length(p_label) not between 3 and 120 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  insert into ops.credential_deadlines (key, label, expires_at, what_to_do, attempted_at)
  values (p_key, p_label, timestamptz '2100-01-01', 'Not read yet.', now())
  on conflict (key) do update set attempted_at = now();
end $$;
revoke all on function public.ops_credential_check_attempt(text, text) from public, anon;
grant execute on function public.ops_credential_check_attempt(text, text) to authenticated;

-- what Meta said: the day it stops (null = it never does: year 2100). A date that moves makes a new alert key (the key holds the date), so a renewed token starts clean.
create function public.ops_credential_deadline_set(p_key text, p_label text, p_expires_at timestamptz, p_warn_days integer, p_what_to_do text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_at timestamptz := coalesce(p_expires_at, timestamptz '2100-01-01');
begin
  perform ops.system_only();
  if p_key is null or p_key !~ '^[a-z0-9_.-]{3,60}$' or p_label is null or char_length(p_label) not between 3 and 120 or p_warn_days is null or p_warn_days not between 1 and 90
     or p_what_to_do is null or char_length(p_what_to_do) not between 3 and 300 or v_at < timestamptz '2020-01-01' or v_at > timestamptz '2100-01-01' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  insert into ops.credential_deadlines (key, label, expires_at, warn_days, what_to_do, checked_at, attempted_at)
  values (p_key, p_label, v_at, p_warn_days, p_what_to_do, now(), now())
  on conflict (key) do update set label = excluded.label, expires_at = excluded.expires_at, warn_days = excluded.warn_days, what_to_do = excluded.what_to_do, checked_at = now(), attempted_at = now();
  return jsonb_build_object('expires_at', v_at, 'never', v_at = timestamptz '2100-01-01');
end $$;
revoke all on function public.ops_credential_deadline_set(text, text, timestamptz, integer, text) from public, anon;
grant execute on function public.ops_credential_deadline_set(text, text, timestamptz, integer, text) to authenticated;
