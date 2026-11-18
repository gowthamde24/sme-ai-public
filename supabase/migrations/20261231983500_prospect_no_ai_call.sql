-- A Lead Finder prospect is NEVER called by the AI (owner decision, 18 Nov 2026): Lead Finder finds and shows prospects (fit score, reason, contact details) and the owner reaches out personally.
-- An AI call to someone who never asked is a promotional call (TRAI's August 2024 directions: disconnection and blacklisting of the number, up to two years).
-- Proof of request (#834) already refuses these in live mode; this makes it impossible in every mode and at the database, so a future code path cannot bypass it:
--   * app.contact_is_prospect(tenant, contact): the contact is a Lead Finder prospect (a prospect's lead, or a prospect with the same phone number) that has NOT since made a real request
--     (app.call_back_proof: a form, a lead ad, a portal e-mail, a message or a call the person made, in the last 30 days). A prospect who enquires becomes a normal lead: the proof clears it.
--   * app.prospect_number_blocked(tenant, number): the same for a bare number (a prospect that was never made a lead).
--   * a task row, an outreach item (rule, batch, list) or a call row for such a contact is made as skipped / refused with the closed word `prospect_no_ai_call`; nothing is ever queued for it.
--   * public.prospect_no_ai_call(tenant, number): what the call path asks before it places a call.

create function app.phone_tail(p text) returns text
language sql
immutable
set search_path = ''
as $$
  select case when length(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g')) >= 10 then right(regexp_replace(p, '[^0-9]', '', 'g'), 10) else '' end
$$;
revoke all on function app.phone_tail(text) from public, anon, authenticated, service_role;

create function app.contact_is_prospect(p_tenant uuid, p_contact uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1
             from public.prospects z
             join public.contacts c on c.tenant_id = z.tenant_id and c.id = p_contact
            where z.tenant_id = p_tenant
              and (exists (select 1 from public.leads l where l.tenant_id = z.tenant_id and l.id = z.lead_id and l.contact_id = p_contact)
                   or (app.phone_tail(z.phone_key) <> '' and app.phone_tail(z.phone_key) = app.phone_tail(c.phone))))
     and app.call_back_proof(p_tenant, p_contact, 30) is null
$$;
revoke all on function app.contact_is_prospect(uuid, uuid) from public, anon, authenticated, service_role;

create function app.prospect_number_blocked(p_tenant uuid, p_number text) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.phone_tail(p_number) <> ''
     and exists (select 1 from public.prospects z where z.tenant_id = p_tenant and app.phone_tail(z.phone_key) = app.phone_tail(p_number))
     and not exists (select 1 from public.contacts c where c.tenant_id = p_tenant and app.phone_tail(c.phone) = app.phone_tail(p_number)
                       and app.call_back_proof(p_tenant, c.id, 30) is not null)
$$;
revoke all on function app.prospect_number_blocked(uuid, text) from public, anon, authenticated, service_role;

-- what the call path asks (the Owner or Admin of the workspace, or the phone server)
create function public.prospect_no_ai_call(p_tenant_id uuid, p_number text) returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not (app.is_scheduler() or app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[])) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return app.prospect_number_blocked(p_tenant_id, p_number);
end;
$$;
revoke all on function public.prospect_no_ai_call(uuid, text) from public, anon;
grant execute on function public.prospect_no_ai_call(uuid, text) to authenticated;
comment on function public.prospect_no_ai_call(uuid, text) is 'True when the number belongs to a Lead Finder prospect that has not made a request: the AI never calls it. Owner, Admin, the phone server.';

-- the closed word, in the three lists that name why nobody was called
do $$
declare
  x record;
  c record;
  v_old text;
begin
  for x in select * from (values ('public.phone_calls'::regclass, 'no_proof_of_request'), ('public.outreach_items'::regclass, 'no_channel'), ('public.task_contacts'::regclass, 'promotional_call_off')) as t(rel, word) loop
    v_old := quote_literal(x.word) || '::text';
    for c in select k.conname, pg_get_constraintdef(k.oid) as d from pg_constraint k where k.conrelid = x.rel and k.contype = 'c' and pg_get_constraintdef(k.oid) like '%' || v_old || '%' loop
      execute format('alter table %s drop constraint %I', x.rel, c.conname);
      execute format('alter table %s add constraint %I %s', x.rel, c.conname, replace(c.d, v_old, v_old || ', ''prospect_no_ai_call''::text'));
    end loop;
  end loop;
end;
$$;

-- a task never queues a prospect: the person is skipped, with the word
create function app.task_contacts_no_prospect() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('waiting', 'excluded', 'in_progress') and app.contact_is_prospect(new.tenant_id, new.contact_id) then
    new.status := 'skipped';
    new.skip_reason := 'prospect_no_ai_call';
  end if;
  return new;
end;
$$;
create trigger task_contacts_no_prospect before insert or update of contact_id, status on public.task_contacts for each row execute function app.task_contacts_no_prospect();

-- a rule, a batch or a list never queues a prospect: the item is made as skipped, with the word, and nothing is due
create function app.outreach_items_no_prospect() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('planned', 'waiting') and app.contact_is_prospect(new.tenant_id, new.contact_id) then
    new.status := 'skipped';
    new.reason := 'prospect_no_ai_call';
    new.next_action := null; new.next_at := null; new.then_action := null; new.then_at := null;
  end if;
  return new;
end;
$$;
create trigger outreach_items_no_prospect before insert or update of contact_id, status on public.outreach_items for each row execute function app.outreach_items_no_prospect();

-- a call row for a prospect's contact is only ever a refused one
create function app.phone_calls_no_prospect() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.direction = 'outbound' and new.refuse_reason is null and new.contact_id is not null and app.contact_is_prospect(new.tenant_id, new.contact_id) then
    raise exception 'a prospect is never called by the AI' using errcode = 'SM975';
  end if;
  return new;
end;
$$;
create trigger phone_calls_no_prospect before insert on public.phone_calls for each row execute function app.phone_calls_no_prospect();
