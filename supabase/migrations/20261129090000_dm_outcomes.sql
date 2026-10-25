-- Job DM (C1 part, 25 Oct 2026), migration 1: OUTCOMES AS DATA.
--
--   After each call and each follow-up conversation the AI records an outcome: positive | negative | unclear, a category (interested, visit_booked, order_likely, not_interested, wrong_number, too_costly,
--   call_back_later) and a short reason. The owner can correct it. The web shows it on the customer's timeline and as today's totals ("[N] positive . [N] not interested").
--
--   public.outcomes                       one row per call or follow-up conversation (kind + source_id), written only by the functions below
--   public.outcome_record                 the AI (the registered channel account) or a person (Owner, Admin, Sales) records one; the same source twice changes nothing
--   public.outcome_correct                Owner or Admin corrects the outcome, the category or the reason; what the AI first said is kept
--   public.outcomes_list                  newest first, for one customer (the timeline) and/or one India day; keyset paging by (occurred_at, id)
--   public.outcomes_totals                per India day, zero-filled: positive, negative, unclear and a count per category
--   public.outcomes_for_lead              one customer page's outcomes (the lead's and its contact's), newest first
--
--   NO CHILD DATA: the table has no reference to a student; in an EDUCATION workspace the reason is never stored (null) and the web shows the category's fixed words instead. Outcomes concern the adult who
--   enquired or the adult we write to, never a pupil.
--   Not touched: the dues call results (public.call_list_items.outcome: paid, promised, call_later, wrong_number, stop) stay as they are; they answer a different question (did they pay).

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. the table
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.outcomes (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants (id) on delete restrict,
  contact_id       uuid not null,
  lead_id          uuid,
  kind             text not null check (kind in ('call', 'whatsapp_followup')),
  -- the call, or the customer's inbound message, this outcome is about: one outcome per source (the same source twice is one outcome)
  source_id        uuid not null,
  outcome          text not null check (outcome in ('positive', 'negative', 'unclear')),
  category         text check (category in ('interested', 'visit_booked', 'order_likely', 'not_interested', 'wrong_number', 'too_costly', 'call_back_later')),
  reason           text check (reason is null or (char_length(reason) between 2 and 200 and app.text_is_clean(reason))),
  recorded_by_kind text not null check (recorded_by_kind in ('ai', 'person')),
  recorded_by      uuid,
  -- what the AI said, kept when a person corrects it (null on a row a person made)
  ai_outcome       text check (ai_outcome in ('positive', 'negative', 'unclear')),
  ai_category      text check (ai_category in ('interested', 'visit_booked', 'order_likely', 'not_interested', 'wrong_number', 'too_costly', 'call_back_later')),
  occurred_at      timestamptz not null,
  recorded_at      timestamptz not null default app.outbox_now(),
  corrected_by     uuid,
  corrected_at     timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, kind, source_id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  -- the category belongs to its outcome: positive = interested | visit_booked | order_likely; negative = not_interested | wrong_number | too_costly; unclear = call_back_later or no category
  check (coalesce((outcome = 'positive' and category in ('interested', 'visit_booked', 'order_likely'))
                or (outcome = 'negative' and category in ('not_interested', 'wrong_number', 'too_costly'))
                or (outcome = 'unclear' and (category is null or category = 'call_back_later')), false)),
  check ((corrected_at is null) = (corrected_by is null)),
  check ((recorded_by_kind = 'ai') = (ai_outcome is not null))
);
create index outcomes_keyset_idx  on public.outcomes (tenant_id, occurred_at desc, id desc);
create index outcomes_contact_idx on public.outcomes (tenant_id, contact_id, occurred_at desc, id desc);
create index outcomes_lead_idx    on public.outcomes (tenant_id, lead_id) where lead_id is not null;
comment on column public.outcomes.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.outcomes.outcome is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.outcomes.category is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.outcomes.recorded_by_kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.outcomes.ai_outcome is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.outcomes.ai_category is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.outcomes.reason is 'PII: the AI''s (or a person''s) one line on why. Free text about an adult customer; never stored in an education workspace. Erased with the workspace and swept on a contact''s erasure.';

alter table public.outcomes enable row level security;
alter table public.outcomes force row level security;
revoke all on public.outcomes from public, anon, authenticated, service_role;
grant select on public.outcomes to authenticated;
create policy outcomes_select on public.outcomes for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales', 'viewer']::public.app_role[])))::uuid[]));
create trigger outcomes_forbid_tenant_id_change before update on public.outcomes for each row execute function app.forbid_tenant_id_change();
create trigger audit_outcomes after insert or update or delete on public.outcomes for each row execute function app.audit_row_change('outcome', 'reason');

-- what an outcome IS never changes (which call, which customer, when); only the outcome, the category, the reason and the correction marks do. (An erasure may blank the reason.)
create function app.outcomes_immutable() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'outcomes are never deleted' using errcode = '42501';
  end if;
  if tg_op = 'TRUNCATE' then
    raise exception 'outcomes are never truncated' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.contact_id is distinct from old.contact_id or new.lead_id is distinct from old.lead_id or new.kind is distinct from old.kind
     or new.source_id is distinct from old.source_id or new.recorded_by_kind is distinct from old.recorded_by_kind or new.recorded_by is distinct from old.recorded_by
     or new.occurred_at is distinct from old.occurred_at or new.recorded_at is distinct from old.recorded_at then
    raise exception 'an outcome keeps its source, its customer and its time' using errcode = '42501';
  end if;
  -- what the AI said is kept as it was once a person has corrected it; before that the AI may refine its own word within the same conversation
  if old.corrected_at is not null and (new.ai_outcome is distinct from old.ai_outcome or new.ai_category is distinct from old.ai_category) then
    raise exception 'what the AI said is kept once a person has corrected it' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.outcomes_immutable() from public;
create trigger outcomes_immutable before update or delete on public.outcomes for each row execute function app.outcomes_immutable();
create trigger outcomes_no_truncate before truncate on public.outcomes for each statement execute function app.outcomes_immutable();

-- erasure (ADR 0014): the reason is free text. Erased with the workspace, and swept (the contact's e-mail, number and name taken out of it) when a contact is erased.
insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('outcomes', 'reason', 'tenant', 'tombstone', 'erased:1'),
  ('outcomes', 'reason', 'sweep',  'substring', 'erased:1');

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. helpers
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.outcome_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.outcome_error(text) from public;

create function app.outcome_json(o public.outcomes) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', o.id, 'contact_id', o.contact_id, 'lead_id', o.lead_id, 'kind', o.kind, 'source_id', o.source_id,
    'outcome', o.outcome, 'category', o.category, 'reason', o.reason,
    'recorded_by', o.recorded_by_kind, 'corrected', o.corrected_at is not null, 'corrected_at', o.corrected_at,
    'ai_outcome', o.ai_outcome, 'ai_category', o.ai_category,
    'occurred_at', o.occurred_at, 'recorded_at', o.recorded_at)
$$;
revoke all on function app.outcome_json(public.outcomes) from public, anon, authenticated, service_role;

-- an education workspace never stores the reason (no child data can slip in through a sentence); the web shows the category's fixed words
create function app.outcome_reason(p_tenant uuid, p_reason text) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when exists (select 1 from packs.workspace_pack w where w.tenant_id = p_tenant and w.pack_code = 'education') then null
              else nullif(btrim(coalesce(p_reason, '')), '') end
$$;
revoke all on function app.outcome_reason(uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. record (the AI or a person) and correct (Owner, Admin)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.outcome_record(
  p_tenant_id uuid, p_contact_id uuid, p_lead_id uuid, p_kind text, p_source_id uuid, p_outcome text, p_category text, p_reason text, p_occurred_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_ai     boolean := app.is_channel_agent();
  v_now    timestamptz := app.outbox_now();
  v_reason text;
  o        public.outcomes;
begin
  if v_uid is null or p_tenant_id is null or (not v_ai and not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[])) then
    perform app.outcome_error('deny');
  end if;
  if p_contact_id is null or p_source_id is null or p_kind is null or p_kind not in ('call', 'whatsapp_followup') or p_outcome is null or p_outcome not in ('positive', 'negative', 'unclear')
     or (p_category is not null and p_category not in ('interested', 'visit_booked', 'order_likely', 'not_interested', 'wrong_number', 'too_costly', 'call_back_later'))
     or p_occurred_at is null or p_occurred_at > v_now + interval '5 minutes' or p_occurred_at < v_now - interval '30 days'
     or (p_reason is not null and (char_length(btrim(p_reason)) not between 2 and 200 or not app.text_is_clean(p_reason)))
     or not coalesce((p_outcome = 'positive' and p_category in ('interested', 'visit_booked', 'order_likely'))
                   or (p_outcome = 'negative' and p_category in ('not_interested', 'wrong_number', 'too_costly'))
                   or (p_outcome = 'unclear' and (p_category is null or p_category = 'call_back_later')), false) then
    perform app.outcome_error('invalid');
  end if;
  if not exists (select 1 from public.contacts c where c.tenant_id = p_tenant_id and c.id = p_contact_id and c.erased_at is null)
     or (p_lead_id is not null and not exists (select 1 from public.leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id)) then
    perform app.outcome_error('reference');
  end if;
  -- the AI records the outcome of a follow-up conversation only when we actually wrote to this customer in the last 14 days (their reply to something we sent)
  if v_ai and p_kind = 'whatsapp_followup' and not exists (
       select 1 from public.outbox_messages m
        where m.tenant_id = p_tenant_id and m.contact_id = p_contact_id and m.status = 'sent' and m.category <> 'reply_to_inbound' and m.sent_at >= v_now - interval '14 days') then
    perform app.outcome_error('invalid');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('outcome:' || p_tenant_id::text || ':' || p_kind || ':' || p_source_id::text, 0));
  select * into o from public.outcomes x where x.tenant_id = p_tenant_id and x.kind = p_kind and x.source_id = p_source_id;
  if found then
    return app.outcome_json(o) || jsonb_build_object('replayed', true);   -- the same source twice is one outcome; a person's correction is never overwritten
  end if;
  v_reason := app.outcome_reason(p_tenant_id, p_reason);
  -- one outcome per customer per conversation (24 hours): when the AI records and the conversation has one already, a later REPLY can only turn the AI's own unclear or positive word into a negative one;
  -- a person's outcome and a person's correction are never overwritten
  if v_ai and p_kind = 'whatsapp_followup' then
    select * into o from public.outcomes x
     where x.tenant_id = p_tenant_id and x.contact_id = p_contact_id and x.kind = 'whatsapp_followup'
       and x.occurred_at >= p_occurred_at - interval '24 hours' and x.occurred_at <= p_occurred_at
     order by x.occurred_at desc, x.id desc limit 1;
    if found then
      if p_outcome = 'negative' and o.outcome <> 'negative' and o.recorded_by_kind = 'ai' and o.corrected_at is null then
        update public.outcomes set outcome = p_outcome, category = p_category, reason = v_reason, ai_outcome = p_outcome, ai_category = p_category
         where tenant_id = p_tenant_id and id = o.id returning * into o;
        return app.outcome_json(o) || jsonb_build_object('replayed', false);
      end if;
      return app.outcome_json(o) || jsonb_build_object('replayed', true);
    end if;
  end if;
  insert into public.outcomes (tenant_id, contact_id, lead_id, kind, source_id, outcome, category, reason, recorded_by_kind, recorded_by, ai_outcome, ai_category, occurred_at, recorded_at)
  values (p_tenant_id, p_contact_id, p_lead_id, p_kind, p_source_id, p_outcome, p_category, v_reason, case when v_ai then 'ai' else 'person' end, v_uid,
          case when v_ai then p_outcome end, case when v_ai then p_category end, p_occurred_at, v_now)
  returning * into o;
  return app.outcome_json(o) || jsonb_build_object('replayed', false);
end;
$$;
revoke all on function public.outcome_record(uuid, uuid, uuid, text, uuid, text, text, text, timestamptz) from public, anon;
grant execute on function public.outcome_record(uuid, uuid, uuid, text, uuid, text, text, text, timestamptz) to authenticated;

create function public.outcome_correct(p_tenant_id uuid, p_id uuid, p_outcome text, p_category text, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  o     public.outcomes;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outcome_error('deny');
  end if;
  if p_id is null or p_outcome is null or p_outcome not in ('positive', 'negative', 'unclear')
     or (p_category is not null and p_category not in ('interested', 'visit_booked', 'order_likely', 'not_interested', 'wrong_number', 'too_costly', 'call_back_later'))
     or (p_reason is not null and (char_length(btrim(p_reason)) not between 2 and 200 or not app.text_is_clean(p_reason)))
     or not coalesce((p_outcome = 'positive' and p_category in ('interested', 'visit_booked', 'order_likely'))
                   or (p_outcome = 'negative' and p_category in ('not_interested', 'wrong_number', 'too_costly'))
                   or (p_outcome = 'unclear' and (p_category is null or p_category = 'call_back_later')), false) then
    perform app.outcome_error('invalid');
  end if;
  select * into o from public.outcomes x where x.tenant_id = p_tenant_id and x.id = p_id for update;
  if not found then
    perform app.outcome_error('reference');
  end if;
  update public.outcomes set outcome = p_outcome, category = p_category, reason = app.outcome_reason(p_tenant_id, p_reason), corrected_by = v_uid, corrected_at = app.outbox_now()
   where tenant_id = p_tenant_id and id = p_id returning * into o;
  return app.outcome_json(o);
end;
$$;
revoke all on function public.outcome_correct(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.outcome_correct(uuid, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. reading: the timeline of a customer, the list of a day, the totals
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.outcomes_list(p_tenant_id uuid, p_contact_id uuid, p_day date, p_limit integer, p_before_at timestamptz, p_before_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    perform app.outcome_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 100 or (p_before_at is null) <> (p_before_id is null) then
    perform app.outcome_error('invalid');
  end if;
  select coalesce(jsonb_agg(app.outcome_json(x) order by x.occurred_at desc, x.id desc), '[]'::jsonb) into v_rows from (
    select o.* from public.outcomes o
     where o.tenant_id = p_tenant_id
       and (p_contact_id is null or o.contact_id = p_contact_id)
       and (p_day is null or (o.occurred_at at time zone 'Asia/Kolkata')::date = p_day)
       and (p_before_at is null or (o.occurred_at, o.id) < (p_before_at, p_before_id))
     order by o.occurred_at desc, o.id desc
     limit p_limit + 1) x;
  return jsonb_build_object(
    'items', (select coalesce(jsonb_agg(e.value order by e.ord), '[]'::jsonb) from jsonb_array_elements(v_rows) with ordinality as e(value, ord) where e.ord <= p_limit),
    'has_more', jsonb_array_length(v_rows) > p_limit);
end;
$$;
revoke all on function public.outcomes_list(uuid, uuid, date, integer, timestamptz, uuid) from public, anon;
grant execute on function public.outcomes_list(uuid, uuid, date, integer, timestamptz, uuid) to authenticated;

-- per India day, zero-filled, at most 92 days: {from_day, to_day, days: [{day, positive, negative, unclear, by_category: {...}}], total: {...}}
create function public.outcomes_totals(p_tenant_id uuid, p_from date, p_to date) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (app.outbox_now() at time zone 'Asia/Kolkata')::date;
  v_from  date := coalesce(p_from, v_today);
  v_to    date := coalesce(p_to, coalesce(p_from, v_today));
  v_days  jsonb;
  v_total jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    perform app.outcome_error('deny');
  end if;
  if v_to < v_from or v_to - v_from > 91 then
    perform app.outcome_error('invalid');
  end if;
  with d as (select g::date as day from generate_series(v_from, v_to, interval '1 day') g),
       c as (select (o.occurred_at at time zone 'Asia/Kolkata')::date as day, o.outcome, o.category
               from public.outcomes o
              where o.tenant_id = p_tenant_id and (o.occurred_at at time zone 'Asia/Kolkata')::date between v_from and v_to)
  select jsonb_agg(jsonb_build_object(
           'day', d.day,
           'positive', (select count(*) from c where c.day = d.day and c.outcome = 'positive'),
           'negative', (select count(*) from c where c.day = d.day and c.outcome = 'negative'),
           'unclear',  (select count(*) from c where c.day = d.day and c.outcome = 'unclear'),
           'by_category', jsonb_build_object(
             'interested',     (select count(*) from c where c.day = d.day and c.category = 'interested'),
             'visit_booked',   (select count(*) from c where c.day = d.day and c.category = 'visit_booked'),
             'order_likely',   (select count(*) from c where c.day = d.day and c.category = 'order_likely'),
             'not_interested', (select count(*) from c where c.day = d.day and c.category = 'not_interested'),
             'wrong_number',   (select count(*) from c where c.day = d.day and c.category = 'wrong_number'),
             'too_costly',     (select count(*) from c where c.day = d.day and c.category = 'too_costly'),
             'call_back_later',(select count(*) from c where c.day = d.day and c.category = 'call_back_later'))) order by d.day)
    into v_days from d;
  select jsonb_build_object(
           'positive', coalesce(sum((e ->> 'positive')::int), 0), 'negative', coalesce(sum((e ->> 'negative')::int), 0), 'unclear', coalesce(sum((e ->> 'unclear')::int), 0))
    into v_total from jsonb_array_elements(v_days) e;
  return jsonb_build_object('from_day', v_from, 'to_day', v_to, 'days', v_days, 'total', v_total);
end;
$$;
revoke all on function public.outcomes_totals(uuid, date, date) from public, anon;
grant execute on function public.outcomes_totals(uuid, date, date) to authenticated;

-- one customer's outcomes by LEAD (the customer page is a lead's): the outcomes of the lead and of its contact, newest first (Owner, Admin, Sales)
create function public.outcomes_for_lead(p_tenant_id uuid, p_lead_id uuid, p_limit integer) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_contact uuid;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.outcome_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 100 then
    perform app.outcome_error('invalid');
  end if;
  select l.contact_id into v_contact from public.leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id;
  if not found then
    perform app.outcome_error('reference');
  end if;
  return coalesce((
    select jsonb_agg(app.outcome_json(x) order by x.occurred_at desc, x.id desc)
      from (select o.* from public.outcomes o
             where o.tenant_id = p_tenant_id and (o.lead_id = p_lead_id or (v_contact is not null and o.contact_id = v_contact))
             order by o.occurred_at desc, o.id desc limit p_limit) x), '[]'::jsonb);
end;
$$;
revoke all on function public.outcomes_for_lead(uuid, uuid, integer) from public, anon;
grant execute on function public.outcomes_for_lead(uuid, uuid, integer) to authenticated;
