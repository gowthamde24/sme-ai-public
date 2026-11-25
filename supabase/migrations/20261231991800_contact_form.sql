-- "Talk to us" on the public pages (25 Nov 2026; API switch CONTACT_FORM, off by default): a person leaves their details and we ring or write back. One table, one public door, one worker mark, one staff read.
--   * `public.contact_submit` (open to the public key, like the waitlist's): validates, takes the terms and privacy versions the person agreed to, refuses a repeat from the same contact within 10 minutes (answers "duplicate"
--     with the first reference) and stops at 500 a day for the whole platform ("busy"). Nothing is read back to the caller but a reference.
--   * `public.scheduler_contact_due` / `scheduler_contact_mark`: the worker e-mails the hello inbox that a message arrived (never WHO: the details are read by staff in the admin console), once per message.
--   * `public.admin_contact_requests`: owner and support staff read the messages (and the read is written to the staff log).
-- Personal data (name, phone, e-mail): kept 12 months, then removed (the purge below runs on every new message). Rollback = drop the table and the four functions.

create table privacy.contact_requests (
  id            uuid primary key default gen_random_uuid(),
  reference     text not null unique check (reference ~ '^TQ-[0-9A-F]{8}$'),
  name          text not null check (char_length(name) between 1 and 120 and app.text_is_clean(name)),
  phone         text check (phone is null or phone ~ '^\+?[0-9][0-9 ()-]{5,24}$'),
  email         text check (email is null or (char_length(email) between 5 and 200 and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  business_kind text check (business_kind is null or (char_length(business_kind) between 1 and 80 and app.text_is_clean(business_kind))),
  good_time     text check (good_time is null or (char_length(good_time) between 1 and 80 and app.text_is_clean(good_time))),
  sells         text check (sells is null or (char_length(sells) between 1 and 300 and app.text_is_clean(sells))),
  terms_version text not null check (terms_version ~ '^[A-Za-z0-9._-]{1,20}$'),
  notice_version text not null check (notice_version ~ '^[A-Za-z0-9._-]{1,20}$'),
  created_at    timestamptz not null default now(),
  notified_at   timestamptz,
  check (phone is not null or email is not null)
);
comment on column privacy.contact_requests.name is 'PII: a person''s name from the public form. Removed after 12 months. CLEAN-EXEMPT: length CHECK and app.text_is_clean';
comment on column privacy.contact_requests.phone is 'PII: a phone number from the public form. Removed after 12 months. CLEAN-EXEMPT: strict pattern CHECK';
comment on column privacy.contact_requests.email is 'PII: an e-mail address from the public form. Removed after 12 months. CLEAN-EXEMPT: pattern CHECK';
comment on column privacy.contact_requests.sells is 'SAFE: what the person says they sell (a short phrase). CLEAN-EXEMPT: length CHECK and app.text_is_clean';
create index contact_requests_created_idx on privacy.contact_requests (created_at);
alter table privacy.contact_requests enable row level security;
alter table privacy.contact_requests force row level security;
revoke all on privacy.contact_requests from public, anon, authenticated, service_role;

create function public.contact_submit(p_name text, p_phone text, p_email text, p_business_kind text, p_good_time text, p_sells text, p_terms_version text, p_notice_version text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := nullif(btrim(coalesce(p_phone, '')), '');
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_first privacy.contact_requests;
  v_ref text;
begin
  if p_name is null or btrim(p_name) = '' or (v_phone is null and v_email is null) or p_terms_version is null or p_notice_version is null then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  delete from privacy.contact_requests where created_at < now() - interval '12 months';
  select * into v_first from privacy.contact_requests c
   where c.created_at > now() - interval '10 minutes' and ((v_email is not null and c.email = v_email) or (v_phone is not null and c.phone = v_phone)) order by c.created_at limit 1;
  if found then
    return jsonb_build_object('status', 'duplicate', 'reference', v_first.reference);
  end if;
  if (select count(*) from privacy.contact_requests c where c.created_at > now() - interval '1 day') >= 500 then
    return jsonb_build_object('status', 'busy');
  end if;
  v_ref := 'TQ-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  insert into privacy.contact_requests (reference, name, phone, email, business_kind, good_time, sells, terms_version, notice_version)
  values (v_ref, btrim(p_name), v_phone, v_email, nullif(btrim(coalesce(p_business_kind, '')), ''), nullif(btrim(coalesce(p_good_time, '')), ''), nullif(btrim(coalesce(p_sells, '')), ''), p_terms_version, p_notice_version);
  return jsonb_build_object('status', 'received', 'reference', v_ref);
end $$;
revoke all on function public.contact_submit(text, text, text, text, text, text, text, text) from public;
grant execute on function public.contact_submit(text, text, text, text, text, text, text, text) to anon, authenticated;

create function public.scheduler_contact_due(p_limit integer default 20) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from (
    select c.id, c.reference, c.business_kind, c.good_time, c.created_at from privacy.contact_requests c where c.notified_at is null order by c.created_at limit least(greatest(coalesce(p_limit, 20), 1), 100)) x), '[]'::jsonb);
end $$;
revoke all on function public.scheduler_contact_due(integer) from public, anon;
grant execute on function public.scheduler_contact_due(integer) to authenticated;

create function public.scheduler_contact_mark(p_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update privacy.contact_requests set notified_at = now() where id = p_id and notified_at is null;
end $$;
revoke all on function public.scheduler_contact_mark(uuid) from public, anon;
grant execute on function public.scheduler_contact_mark(uuid) to authenticated;

create function public.admin_contact_requests(p_limit integer default 50) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_staff admin.staff;
begin
  v_staff := admin.staff_check(array['owner', 'support']);
  perform admin.log(v_staff.user_id, 'list', null, null, null, null, 'business', null, false);
  return jsonb_build_object('items', coalesce((select jsonb_agg(jsonb_build_object('reference', x.reference, 'name', x.name, 'phone', x.phone, 'email', x.email, 'business_kind', x.business_kind, 'good_time', x.good_time,
                                                                                    'sells', x.sells, 'terms_version', x.terms_version, 'created_at', x.created_at) order by x.created_at desc)
                                               from (select * from privacy.contact_requests c order by c.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) x), '[]'::jsonb));
end $$;
revoke all on function public.admin_contact_requests(integer) from public, anon;
grant execute on function public.admin_contact_requests(integer) to authenticated;
