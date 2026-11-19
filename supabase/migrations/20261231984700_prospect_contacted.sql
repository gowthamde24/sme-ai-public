-- Lead Finder v1.0, "Mark as contacted" (owner, 19 Nov 2026): the owner reaches a prospect personally (a call from their own phone, a visit) and says so: who, when, a short note.
-- The prospect moves to the state `contacted`; it NEVER enters a call queue. And a prospect can never be the recipient of ANY outbox (WhatsApp) message either: the message is made as blocked
-- (`no_opt_in`) and nothing is sent. A prospect who really enquires has a proof of request (app.call_back_proof) and is a normal lead again, so the guard lets a reply through then.

alter table public.prospects add column contacted_by uuid, add column contact_note text check (contact_note is null or (char_length(contact_note) <= 500 and app.text_is_clean(contact_note)));
comment on column public.prospects.contacted_by is 'SAFE: the member (user id) who marked the business as contacted. CLEAN-EXEMPT: an id';
comment on column public.prospects.contact_note is 'PII: the owner''s own short note when marking a business as contacted (what was said, what is next). Written by the owner, at most 500 characters; erased with the workspace.';

-- the note is personal data: erased with the workspace, and never audited by value
insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('prospects', 'contact_note', 'tenant', 'null',      'erased:1'),
  ('prospects', 'contact_note', 'sweep',  'substring', 'erased:1');
drop trigger audit_prospects on public.prospects;
create trigger audit_prospects after insert or update or delete on public.prospects for each row execute function app.audit_row_change('prospect', 'name,name_key,area,phone,phone_key,source_label,qualification,contact_note');

create or replace function app.lf_prospect_json(x public.prospects) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', x.id, 'search_id', x.search_id, 'name', x.name, 'category', x.category, 'area', x.area, 'lat', x.lat, 'lng', x.lng, 'phone', x.phone, 'website', x.website,
    'rating', x.rating, 'review_count', x.review_count, 'source', x.source, 'source_label', x.source_label, 'place_id', x.place_id, 'fetched_at', x.fetched_at, 'status', x.status,
    'decision_reason', x.decision_reason, 'fit_score', x.fit, 'fit_reason', x.fit_reason, 'stock_match', x.stock_match, 'owner_approved', x.owner_approved, 'suppressed', x.suppressed,
    'ask_after', x.ask_after, 'last_contacted_at', x.last_contacted_at, 'lead_id', x.lead_id, 'qualification', x.qualification, 'created_at', x.created_at, 'updated_at', x.updated_at,
    'contacted_by', (select u.display_name from public.users u where u.id = x.contacted_by), 'contact_note', x.contact_note)
$$;

-- the owner (or Admin, or Sales) says: "I contacted this business" (idempotent: again = a new time and note)
create function public.prospect_mark_contacted(p_tenant_id uuid, p_id uuid, p_contacted_at timestamptz default null, p_note text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  x public.prospects;
  v_at timestamptz;
  v_note text;
begin
  perform app.lf_gate(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]);
  v_at := coalesce(p_contacted_at, now());
  v_note := nullif(btrim(coalesce(p_note, '')), '');
  if v_at > now() + interval '5 minutes' or v_at < now() - interval '60 days'
     or (v_note is not null and (char_length(v_note) > 500 or not app.text_is_clean(v_note))) then
    perform app.lf_error('invalid');
  end if;
  select * into x from public.prospects z where z.tenant_id = p_tenant_id and z.id = p_id for update;
  if not found then
    perform app.lf_error('reference');
  end if;
  if x.suppressed or x.status = 'not_interested' then
    perform app.lf_error('state');
  end if;
  update public.prospects z
     set status = 'contacted', last_contacted_at = least(v_at, now()), contacted_by = auth.uid(), contact_note = coalesce(v_note, z.contact_note),
         owner_approved = false, ask_after = null, decision_reason = 'contacted_recently'
   where z.id = x.id returning * into x;
  return app.lf_prospect_json(x);
end;
$$;
revoke all on function public.prospect_mark_contacted(uuid, uuid, timestamptz, text) from public, anon;
grant execute on function public.prospect_mark_contacted(uuid, uuid, timestamptz, text) to authenticated;

-- a prospect is never the recipient of a WhatsApp message from the outbox (replies to someone who wrote to us have a proof of request and pass)
create function app.outbox_messages_no_prospect() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('queued', 'needs_approval') and new.contact_id is not null and app.contact_is_prospect(new.tenant_id, new.contact_id) then
    new.status := 'blocked';
    new.reason := 'no_opt_in';
    new.scheduled_for := null;
  end if;
  return new;
end;
$$;
create trigger outbox_messages_no_prospect before insert or update of contact_id, status on public.outbox_messages for each row execute function app.outbox_messages_no_prospect();
