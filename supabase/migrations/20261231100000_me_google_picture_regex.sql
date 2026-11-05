-- My profile showed "Not available yet" for every person who signed in with Google and has a Google photo (owner bug, 5 Nov 2026).
-- app.google_picture_of (migration 20261211090100) checked the photo address with a regex whose repeat count was {1,500}; Postgres allows at most 255
-- ("invalid repetition count(s)", SQLSTATE 2201B). The regex is only compiled when the photo is not null, so people without a photo (the demo accounts)
-- were fine and every Google user's my_profile_get, my_profile_set and people_profiles failed (the API answered 502).
-- Same rule as before: a Google address only (never another host), at most 500 characters after the host; the length is now checked on its own.
create or replace function app.google_picture_of(p_user uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when char_length(pic) <= 540 and pic ~ '^https://[a-z0-9-]+\.googleusercontent\.com/[A-Za-z0-9._~:/?#@!$&''()*+,;=%-]+$' then pic end
    from (select coalesce(u.raw_user_meta_data ->> 'picture', u.raw_user_meta_data ->> 'avatar_url') as pic from auth.users u where u.id = p_user) x
$$;
revoke all on function app.google_picture_of(uuid) from public;
