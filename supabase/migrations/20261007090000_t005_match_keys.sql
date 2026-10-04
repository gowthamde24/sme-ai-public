-- T005 / milestone 1: matching keys for de-duplication (ADR 0010).
--
--   app.match_key(text)      the comparison key of a name or a city:
--                              NFKC normalise -> lower() -> drop ZWNJ / ZWJ -> collapse blanks -> trim.
--                            The Python side (app.leads.keys, milestone 2) performs the SAME steps with
--                            unicodedata.normalize('NFKC') and str.lower() (NOT casefold). ZWNJ / ZWJ stay legal
--                            in STORED text (Indic and Persian scripts need them); they are ignored for MATCHING only.
--   app.website_host(text)   the host of a website value, lower case, without "www." and a trailing dot; NULL when
--                            the value has no usable ASCII / punycode host.
--   app.is_shared_host(text) hosts that many unrelated businesses share (social pages, marketplaces, site builders):
--                            such a host never identifies one business.
--
-- IMMUTABLE is justified for the two expression indexes below because normalize() is IMMUTABLE and lower() uses the
-- database default collation (ICU, en_US.UTF-8), which is fixed for the life of the database. Measured over EVERY Unicode
-- code point, SQL and Python agree except for the 63 code points assigned after PostgreSQL 17's Unicode tables
-- (a de-duplication miss for those, never a false merge). A PostgreSQL / ICU upgrade that changes Unicode data, or a
-- restore into a database with another collation, needs REINDEX of the two indexes (docs/pre-pilot-checklist.md).
--
-- match_key and website_host are EXECUTE-able by authenticated because an expression index is evaluated as the
-- role that inserts the row (checked: without the grant an insert fails with "permission denied for function").

create function app.match_key(p text) returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case when p is null then null else
    btrim(
      regexp_replace(
        replace(replace(lower(normalize(p, nfkc)), U&'\200C', ''), U&'\200D', ''),
        '[ \t\r\n\f\v]+', ' ', 'g'),
      E' \t\r\n\f\v')
  end
$$;

create function app.website_host(p text) returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case
    when h ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' and h !~ '\.\.' and h !~ '(^|\.)-' and h !~ '-(\.|$)' then h
  end
  from (
    select regexp_replace(
             regexp_replace(
               lower(substring(
                 regexp_replace(regexp_replace(btrim(p), '^[A-Za-z][A-Za-z0-9+.-]*://', ''), '^//', '')
                 from '^(?:[^/?#@]*@)?([^/?#:]+)')),
               '\.$', ''),
             '^www\.(?=.*\.)', '') as h
  ) s
$$;

create function app.is_shared_host(p text) returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select coalesce(exists (
    select 1
      from unnest(array[
        'facebook.com', 'fb.com', 'instagram.com', 'linktr.ee', 'wa.me', 'whatsapp.com', 'youtube.com', 'youtu.be',
        'twitter.com', 'x.com', 'linkedin.com', 'google.com', 'goo.gl', 'business.site', 'blogspot.com',
        'wordpress.com', 'wixsite.com', 'weebly.com', 'godaddysites.com', 'squarespace.com', 'myshopify.com',
        'amazon.in', 'amazon.com', 'flipkart.com', 'indiamart.com', 'justdial.com', 'tradeindia.com', 'etsy.com',
        'ebay.com', 'github.io', 'netlify.app', 'vercel.app', 'pages.dev'
      ]) s
     where p = s or right(p, length(s) + 1) = '.' || s), false)
$$;

revoke all on function app.match_key(text) from public, anon;
revoke all on function app.website_host(text) from public, anon;
revoke all on function app.is_shared_host(text) from public, anon, authenticated;
grant execute on function app.match_key(text) to authenticated;
grant execute on function app.website_host(text) to authenticated;

-- Matching access paths for the import function.
create index companies_tenant_match_key_idx on public.companies (tenant_id, app.match_key(name));
create index companies_tenant_website_host_idx on public.companies (tenant_id, app.website_host(website)) where website is not null;

-- The newest non-archived claim per (company, predicate): how the scoring engine reads the attributes
-- buyer_type, size_band, operating_status and order_scale (ADR 0010).
create index claims_company_predicate_newest_idx
  on public.claims (tenant_id, company_id, predicate, created_at desc, id desc)
  where company_id is not null and archived_at is null;
