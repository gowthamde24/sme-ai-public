-- Review fixes (owner review of T010 part 1 and the order conversion database, 2026-10-07). ONE migration, create or replace of the LATEST definitions plus the lines named
-- here (tests/test_migration_copies.py pins every copy). The earlier migrations are untouched.
--   1. app.contacts_sync_suppression_keys   lifting a contact lifts a shared key only when no OTHER non-erased contact still holds it while suppressed

-- ---------------------------------------------------------------------------------------------
-- 1. shared keys
-- ---------------------------------------------------------------------------------------------
create or replace function app.contacts_sync_suppression_keys() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k suppression.contact_keys;
begin
  select * into k from suppression.contact_keys where tenant_id = new.tenant_id and contact_id = new.id;
  if not found then
    return new;
  end if;
  if new.suppressed_at is not null then
    if k.email_hmac is not null then
      perform app.suppression_key_add(new.tenant_id, 'email', k.email_hmac, k.key_version, new.suppression_reason::text, new.id, auth.uid());
    end if;
    if k.phone_hmac is not null then
      perform app.suppression_key_add(new.tenant_id, 'phone', k.phone_hmac, k.key_version, new.suppression_reason::text, new.id, auth.uid());
    end if;
  else
    if k.email_hmac is not null then
      -- review fix (steps 1): a key is lifted only when no OTHER non-erased contact of the tenant still holds it while suppressed. The per-key lock (the one
      -- suppression_key_lift takes) comes first, so two contacts lifted at once see each other's committed lift and the last one lifts the key.
      perform pg_advisory_xact_lock(hashtextextended('suppression_key:' || new.tenant_id::text || ':email:' || k.email_hmac, 0));
      if not exists (select 1 from suppression.contact_keys k2 join public.contacts c2 on c2.tenant_id = k2.tenant_id and c2.id = k2.contact_id
                      where k2.tenant_id = new.tenant_id and k2.contact_id <> new.id and k2.email_hmac = k.email_hmac and c2.erased_at is null and c2.suppressed_at is not null)
         -- ... and a key whose current suppression came from an ERASURE stays suppressed (a person erased by right is never re-contacted through a shared number)
         and not exists (select 1 from (select e.event, e.reason from suppression.key_events e where e.tenant_id = new.tenant_id and e.kind = 'email' and e.key_hmac = k.email_hmac
                                         order by e.seq desc limit 1) l where l.event = 'suppressed' and l.reason = 'erased') then
        perform app.suppression_key_lift(new.tenant_id, 'email', k.email_hmac, k.key_version, new.id, auth.uid());
      end if;
    end if;
    if k.phone_hmac is not null then
      -- review fix (steps 1): a key is lifted only when no OTHER non-erased contact of the tenant still holds it while suppressed. The per-key lock (the one
      -- suppression_key_lift takes) comes first, so two contacts lifted at once see each other's committed lift and the last one lifts the key.
      perform pg_advisory_xact_lock(hashtextextended('suppression_key:' || new.tenant_id::text || ':phone:' || k.phone_hmac, 0));
      if not exists (select 1 from suppression.contact_keys k2 join public.contacts c2 on c2.tenant_id = k2.tenant_id and c2.id = k2.contact_id
                      where k2.tenant_id = new.tenant_id and k2.contact_id <> new.id and k2.phone_hmac = k.phone_hmac and c2.erased_at is null and c2.suppressed_at is not null)
         -- ... and a key whose current suppression came from an ERASURE stays suppressed (a person erased by right is never re-contacted through a shared number)
         and not exists (select 1 from (select e.event, e.reason from suppression.key_events e where e.tenant_id = new.tenant_id and e.kind = 'phone' and e.key_hmac = k.phone_hmac
                                         order by e.seq desc limit 1) l where l.event = 'suppressed' and l.reason = 'erased') then
        perform app.suppression_key_lift(new.tenant_id, 'phone', k.phone_hmac, k.key_version, new.id, auth.uid());
      end if;
    end if;
  end if;
  return new;
end;
$$;

