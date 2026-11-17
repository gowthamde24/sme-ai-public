-- A repeat enquiry is a new enquiry (owner, 17 Nov 2026). The owner sent a test lead from the Website form with a number that was already a customer: the lead was merged silently (a quiet "repeat" arrival), nothing reopened,
-- nothing on Today, no standing rule fired. A customer who enquires AGAIN is a hot lead. Now, for a LIVE source (a form, a webhook, Meta, IndiaMART, a portal mail; never a pasted or uploaded list):
--   * a submission from a known contact is a new arrival of kind `again` on that contact's lead; a lead the shop had closed (Lost) is reopened (New); the lead's updated_at moves;
--   * it fires the source's standing rule like a new lead does (the same limits, consent, quiet hours, calling hours, caps; one rule item per arrival; no second ladder while an earlier item of the same lead is still open);
--   * Today's "needs you" shows it ("enquired_again") until a person acts (the lead leaves New, or an owner message goes out), for three days at most;
--   * silent only for a TRUE duplicate: the same lead, the same source, the same words (ignoring case, spaces and punctuation; or both empty) within 10 minutes (a double submit). It is not stored and is logged with the
--     closed reason `duplicate_within_10_min` (it counts as `already_imported`, as the old same-day duplicate did). The old "same words the same day" rule is gone: a customer asking the same thing an hour later is a new enquiry.
-- A row that carries the source's own external id (Meta's leadgen id, IndiaMART's query id) is still a duplicate only by that id.

-- ------------------------------------------------------------------------------------------------------------------------------
-- 1. the arrival kind `again`; one rule item per arrival
-- ------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select c.conname from pg_constraint c where c.conrelid = 'public.lead_arrivals'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%first%repeat%' loop
    execute format('alter table public.lead_arrivals drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.lead_arrivals add constraint lead_arrivals_kind_check check (kind in ('first', 'repeat', 'again'));
comment on column public.lead_arrivals.kind is 'SAFE: a closed word (first: the lead was created by this arrival; again: a known contact enquired again through a live source; repeat: a known contact on a pasted or uploaded list). CLEAN-EXEMPT: closed CHECK list';

drop index public.outreach_items_rule_lead;
create unique index outreach_items_rule_lead on public.outreach_items (rule_id, lead_id, arrival_at) where rule_id is not null;

-- the words of two messages, ignoring case, spaces and punctuation (both empty counts as the same)
create function app.lead_words_same(p_a text, p_b text) returns boolean
language sql
immutable
set search_path = ''
as $$
  select btrim(regexp_replace(lower(coalesce(p_a, '')), '[^[:alnum:]]+', ' ', 'g')) = btrim(regexp_replace(lower(coalesce(p_b, '')), '[^[:alnum:]]+', ' ', 'g'))
$$;
revoke all on function app.lead_words_same(text, text) from public, anon, authenticated, service_role;

-- ------------------------------------------------------------------------------------------------------------------------------
-- 2. the intake: an arrival of a known contact through a live source
-- ------------------------------------------------------------------------------------------------------------------------------
do $patch$
declare
  v_def  text := pg_get_functiondef('app.lead_intake_core(uuid, uuid, text, uuid, jsonb, boolean)'::regprocedure);
  v_old0 text := $q$v_merged integer := 0;$q$;
  v_new0 text := $q$v_again integer := 0; v_merged integer := 0;$q$;
  v_old1 text := $q$      if v_ext is null and p_live then
        v_ext := 'h:' || left(encode(sha256(convert_to(coalesce(app.phone_norm(v_phone), v_email, '') || '|' || coalesce(v_msg, '') || '|' || to_char(app.outbox_now(), 'YYYY-MM-DD'), 'UTF8')), 'hex'), 24);
      end if;
$q$;
  v_new1 text := $q$      -- (a live row without an id of its own is no longer a duplicate for the whole day: only the 10-minute rule below, for a known contact)
$q$;
  v_old2 text := $q$        v_lead := app.contact_lead(p_tenant, v_contact.id, p_tag);
        v_outcome := 'merged';
      else$q$;
  v_new2 text := $q$        v_lead := app.contact_lead(p_tenant, v_contact.id, p_tag);
        v_outcome := 'merged';
        if p_live and exists (select 1 from public.lead_arrivals a
                               where a.tenant_id = p_tenant and a.lead_id = v_lead and a.source_tag = p_tag and a.kind in ('first', 'again')
                                 and a.received_at > v_when - interval '10 minutes' and a.received_at <= v_when + interval '10 minutes' and app.lead_words_same(a.message, v_msg)) then
          v_outcome := 'duplicate_item'; v_reason := 'duplicate_within_10_min';   -- a double submit: stored once
          raise exception 'row refused' using errcode = 'SM101';
        end if;
      else$q$;
  v_old3 text := $q$case when v_outcome = 'created' then 'first' else 'repeat' end, v_msg, v_when);$q$;
  v_new3 text := $q$case when v_outcome = 'created' then 'first' when p_live then 'again' else 'repeat' end, v_msg, v_when);
      if v_outcome = 'merged' and p_live then
        -- a customer who enquires again is a lead again: a closed (Lost) lead is reopened
        update public.leads set status = case when status = 'disqualified' then 'new' else status end, updated_at = now() where tenant_id = p_tenant and id = v_lead;
      end if;$q$;
  v_old4 text := $q$    elsif v_outcome = 'merged' then v_merged := v_merged + 1;$q$;
  v_new4 text := $q$    elsif v_outcome = 'merged' then v_merged := v_merged + 1; v_again := v_again + case when p_live then 1 else 0 end;$q$;
  v_old5 text := $q$elsif v_outcome = 'duplicate_item' then v_dup_item := v_dup_item + 1; v_reason := 'already_imported';$q$;
  v_new5 text := $q$elsif v_outcome = 'duplicate_item' then v_dup_item := v_dup_item + 1; v_reason := coalesce(v_reason, 'already_imported');$q$;
  v_old6 text := $q$    'problems', v_problems, 'outcomes', v_out);$q$;
  v_new6 text := $q$    'problems', v_problems, 'outcomes', v_out, 'again', v_again);$q$;
begin
  if position(v_old0 in v_def) = 0 or position(v_old1 in v_def) = 0 or position(v_old2 in v_def) = 0 or position(v_old3 in v_def) = 0 or position(v_old4 in v_def) = 0 or position(v_old5 in v_def) = 0 or position(v_old6 in v_def) = 0 then
    raise exception 'lead_intake_core has changed: the repeat-enquiry patch no longer fits';
  end if;
  execute replace(replace(replace(replace(replace(replace(replace(v_def, v_old0, v_new0), v_old1, v_new1), v_old2, v_new2), v_old3, v_new3), v_old4, v_new4), v_old5, v_new5), v_old6, v_new6);
end;
$patch$;

-- the worker's live intake tells the API how many were enquiries AGAIN (so the rule runs now, not at the next tick) and why a row was not stored
do $patch$
declare
  v_def text := pg_get_functiondef('public.scheduler_lead_intake_live(text, jsonb)'::regprocedure);
  v_old text := $q$return jsonb_build_object('status', 'received', 'counts', v_result -> 'counts');$q$;
  v_new text := $q$return jsonb_build_object('status', 'received', 'counts', v_result -> 'counts', 'again', coalesce((v_result ->> 'again')::int, 0), 'problems', v_result -> 'problems');$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'scheduler_lead_intake_live has changed: the repeat-enquiry patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

-- ------------------------------------------------------------------------------------------------------------------------------
-- 3. the standing rule also takes an arrival `again` (one item per arrival; none while an earlier item of the same lead is still open)
-- ------------------------------------------------------------------------------------------------------------------------------
do $patch$
declare
  v_def  text := pg_get_functiondef('public.scheduler_outreach_scan(integer)'::regprocedure);
  v_old1 text := $q$  l       public.leads;
  c       public.contacts;$q$;
  v_new1 text := $q$  l       public.leads;
  a       public.lead_arrivals;
  c       public.contacts;$q$;
  v_old2 text := $q$    update public.outreach_rules set last_scan_at = v_last where id = r.id;$q$;
  v_new2 text := $q$    for a in select x.* from public.lead_arrivals x where x.tenant_id = r.tenant_id and x.source_tag = r.source and x.kind = 'again' and x.received_at >= r.last_scan_at and x.received_at >= r.approved_at
                order by x.received_at, x.id limit p_limit loop
      v_last := greatest(v_last, a.received_at);
      select * into l from public.leads x where x.tenant_id = r.tenant_id and x.id = a.lead_id and x.archived_at is null and x.contact_id is not null;
      if not found then
        continue;
      end if;
      if exists (select 1 from public.outreach_items i where i.rule_id = r.id and i.lead_id = l.id and (i.arrival_at = a.received_at or i.status in ('planned', 'waiting', 'waiting_for_minutes'))) then
        continue;   -- this arrival has its item, or an earlier item of the lead is still open (no second ladder)
      end if;
      select * into c from public.contacts x where x.tenant_id = r.tenant_id and x.id = l.contact_id;
      v_skip := app.outreach_skip(c, case when r.channel = 'whatsapp' or r.action in ('whatsapp_first', 'whatsapp_then_call') then 'whatsapp' else r.channel end);
      if v_skip is not null then
        insert into public.outreach_items (tenant_id, rule_id, contact_id, lead_id, status, reason, arrival_at) values (r.tenant_id, r.id, c.id, l.id, 'skipped', v_skip, a.received_at);
        continue;
      end if;
      select * into s from app.outreach_rule_step(r, greatest(a.received_at, v_now));
      insert into public.outreach_items (tenant_id, rule_id, contact_id, lead_id, status, next_action, next_at, then_action, then_at, arrival_at)
      values (r.tenant_id, r.id, c.id, l.id, 'waiting', s.next_action, s.next_at, s.then_action, s.then_at, a.received_at);
      v_added := v_added + 1;
    end loop;
    update public.outreach_rules set last_scan_at = v_last where id = r.id;$q$;
begin
  if position(v_old1 in v_def) = 0 or position(v_old2 in v_def) = 0 then
    raise exception 'scheduler_outreach_scan has changed: the repeat-enquiry patch no longer fits';
  end if;
  execute replace(replace(v_def, v_old1, v_new1), v_old2, v_new2);
end;
$patch$;

-- ------------------------------------------------------------------------------------------------------------------------------
-- 4. Today: "enquired again" until a person acts
-- ------------------------------------------------------------------------------------------------------------------------------
-- Today's function runs as the caller, who cannot read the arrivals: a definer helper answers the caller's own workspace (the role is proved inside, the same rule as the hot-lead line)
create function app.today_enquired_again(p_tenant uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'enquired_again', 'id', a.id, 'customer', c.full_name, 'ref', a.source_tag, 'at', a.received_at, 'lead_id', a.lead_id) order by a.received_at desc), '[]'::jsonb)
    from public.lead_arrivals a
    join public.contacts c on c.tenant_id = a.tenant_id and c.id = a.contact_id
    join public.leads l on l.tenant_id = a.tenant_id and l.id = a.lead_id
   where auth.uid() is not null and a.tenant_id = p_tenant and app.has_tenant_role(p_tenant, array['owner', 'admin', 'sales']::public.app_role[])
     and a.kind = 'again' and a.received_at > app.outbox_now() - interval '3 days' and l.status = 'new' and l.archived_at is null
     and (app.has_tenant_role(p_tenant, array['owner', 'admin']::public.app_role[]) or l.owner_user_id = auth.uid())
     and a.received_at = (select max(x.received_at) from public.lead_arrivals x where x.tenant_id = a.tenant_id and x.lead_id = a.lead_id and x.kind = 'again')
     and not exists (select 1 from public.outbox_messages m where m.tenant_id = a.tenant_id and m.lead_id = a.lead_id and m.source = 'owner' and m.created_at >= a.received_at)
$$;
revoke all on function app.today_enquired_again(uuid) from public;
grant execute on function app.today_enquired_again(uuid) to authenticated;

do $patch$
declare
  v_def text := pg_get_functiondef('public.today_summary(uuid)'::regprocedure);
  v_old text := $q$    select 'hot_lead_waiting', h.id, c.full_name,$q$;
  v_new text := $q$    select u.kind, u.id, u.customer, null::text, 'followup_desk', u.ref, null::bigint, u.at, 'lead', u.lead_id
      from jsonb_to_recordset(app.today_enquired_again(p_tenant_id)) as u(kind text, id uuid, customer text, ref text, at timestamptz, lead_id uuid)
     where v_reader
    union all
    select 'hot_lead_waiting', h.id, c.full_name,$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'today_summary has changed: the enquired-again patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;
