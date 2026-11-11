-- Waitlist: removal on request (owner decision 11 Nov 2026). A person who joined the public waitlist can ask to be removed (the grievance form, kind=erasure);
-- the OPERATOR runs this one call, which deletes the entry by the e-mail address or phone number the person gave and records THAT a removal happened (when, how many), never who.
--   select app.operator_delete_waitlist_entry('person@example.com');     -- or the phone number, any punctuation: '+91 98765 43210'
-- It returns how many entries were removed (0 or 1). Only the operator (a login with no request identity) can run it; no client role can.

create table privacy.waitlist_removals (
  id         bigint generated always as identity primary key,
  removed_at timestamptz not null default app.outbox_now(),
  entries    integer not null check (entries >= 0)
);
alter table privacy.waitlist_removals enable row level security;
alter table privacy.waitlist_removals force row level security;
revoke all on privacy.waitlist_removals from public, anon, authenticated, service_role;
comment on table privacy.waitlist_removals is 'Waitlist removals on request: when an operator removed an entry and how many. No personal data (never who).';
comment on column privacy.waitlist_removals.removed_at is 'SAFE: a time.';
comment on column privacy.waitlist_removals.entries is 'SAFE: a count.';

create function app.operator_delete_waitlist_entry(p_contact text) returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_contact, ''))), '');
  v_digits text := regexp_replace(coalesce(p_contact, ''), '[^0-9]', '', 'g');
  v_phone text := case when v_digits = '' then null else (case when btrim(coalesce(p_contact, '')) like '+%' then '+' else '' end) || v_digits end;
  v_n integer;
begin
  if auth.uid() is not null then
    raise exception 'operator only' using errcode = '42501';
  end if;
  if v_email is null then
    raise exception 'a contact is needed' using errcode = '22023';
  end if;
  -- the key is the lower-case e-mail, else the phone with the digits (and a leading + when the person gave one), exactly as public.waitlist_join stored it
  delete from privacy.waitlist_entries w
   where w.contact_key = v_email
      or (v_phone is not null and (w.contact_key = v_phone or w.contact_key = '+' || v_digits or w.contact_key = v_digits));
  get diagnostics v_n = row_count;
  insert into privacy.waitlist_removals (entries) values (v_n);
  return v_n;
end;
$$;
revoke all on function app.operator_delete_waitlist_entry(text) from public, anon, authenticated, service_role;
comment on function app.operator_delete_waitlist_entry(text) is 'Operator only: removes the waitlist entry of an e-mail address or phone number and logs that a removal happened (no personal data). Returns the number removed.';
