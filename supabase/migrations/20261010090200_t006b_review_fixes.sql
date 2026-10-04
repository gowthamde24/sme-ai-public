-- T006b review fixes (owner review of M1, ADR 0014): two sweep patterns missed common written forms.
--
--   phone  A stored "+91 98765 43210" did not match "919876543210" (wa.me/919876543210) or "09876543210": the pattern demanded no digit
--          before the last ten digits, and an attached country prefix is a digit. Now an optional attached prefix (+91 / 91 / 0, with
--          optional separators) is allowed AFTER the not-preceded-by-a-digit rule, which therefore applies to the start of the whole
--          match. The prefix is replaced with the number ("call +91 98765 43210" becomes "call erased-1"). "119876543210",
--          "987654321012" and "9876543211" are still left alone. Known limit: non-ASCII numerals (Telugu, Devanagari) are not matched.
--   host   An optional "www." in front of the host, so https://www.example.com/x is swept for host example.com. A subdomain or a longer
--          host is still a different host.
create or replace function app.erasure_phone_pattern(p_phone text) returns text
language sql
immutable
set search_path = ''
as $$
  select case when length(d) < 7 then null
              else '(?<![0-9])(?:(?:\+?91|0)[ ._()-]{0,2})?'
                   || array_to_string(regexp_split_to_array(right(d, 10), ''), '[ ._()-]{0,2}')
                   || '(?![0-9])' end
    from (select regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g') as d) s
$$;

create or replace function app.erasure_host_pattern(p_website text) returns text
language sql
immutable
set search_path = ''
as $$
  select case when h is null or app.is_shared_host(h) then null
              else '(?<![A-Za-z0-9.-])(?:www\.)?' || app.erasure_regex_escape(h) || '(?![A-Za-z0-9_-]|\.[A-Za-z0-9])' end
    from (select app.website_host(p_website) as h) s
$$;

-- Scale (measured on the local stack, see scripts/scale_erasure.py): a workspace-wide erasure costs about 0.3 ms per row, so 51,000 rows
-- across the sweep columns take about 16 s. The `authenticated` role (and the PostgREST `authenticator`) have statement_timeout = 8s, which
-- would cut it off at roughly 25,000 rows, roll everything back and leave the request pending (nothing half-done, but never finishing).
-- A function-level setting applies to this call only and is honoured for the running statement (measured). 300 s covers about 900,000 rows;
-- only the Owner can call the function and only one erasure runs per workspace at a time. A larger workspace is run by the operator.
alter function public.execute_erasure(uuid, boolean) set statement_timeout = '300s';
