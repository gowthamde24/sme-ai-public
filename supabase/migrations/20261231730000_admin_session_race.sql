-- Admin console: the first sign-in's two parallel calls (/v1/admin/me and /v1/admin/overview) both created the session row; the second one failed with a duplicate key (409 on staging, 14 Nov 2026,
-- the owner's first session). The row is now created with ON CONFLICT: the same staff member's session is simply touched.
create or replace function admin.staff_check(p_roles text[]) returns admin.staff language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_sid   text;
  v_s     admin.sessions;
begin
  if auth.uid() is null then
    raise exception 'not staff' using errcode = 'SM941';
  end if;
  select * into v_staff from admin.staff s where s.user_id = auth.uid() and s.active;
  if not found then
    raise exception 'not staff' using errcode = 'SM941';
  end if;
  -- ALWAYS a second factor (aal2), even where an ordinary account without one would pass
  if coalesce(auth.jwt() ->> 'aal', '') <> 'aal2' then
    raise exception 'a second factor is required' using errcode = 'SM942';
  end if;
  if p_roles is null or not (v_staff.role = any (p_roles)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_sid := nullif(auth.jwt() ->> 'session_id', '');
  if v_sid is null then
    raise exception 'session ended' using errcode = 'SM943';
  end if;
  select * into v_s from admin.sessions x where x.session_id = v_sid for update;
  if not found then
    -- the first two calls of a new sign-in often arrive together (/me and /overview): the loser of the race must not fail with a duplicate key
    insert into admin.sessions (session_id, staff_id) values (v_sid, v_staff.user_id) on conflict (session_id) do update set last_seen_at = now() where admin.sessions.staff_id = excluded.staff_id;
  elsif v_s.staff_id <> v_staff.user_id or v_s.last_seen_at < now() - interval '30 minutes' then
    raise exception 'session ended' using errcode = 'SM943';
  else
    update admin.sessions set last_seen_at = now() where session_id = v_sid;
  end if;
  return v_staff;
end $$;
