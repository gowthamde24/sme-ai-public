-- Job OR (owner decision, 31 Oct 2026): the AI lead reader runs by itself on WhatsApp leads.
-- The first inbound WhatsApp message of a NEW lead is read at once by the worker (a light, fast model); a later message is read again only while the key fields (need, quantity) are still empty. The model fills
-- need / quantity / area / city / budget / timeline / urgency / language with LOW confidence (the "?" the Lead Desk shows for a guess, as for an e-mailed lead); an owner-fixed field is never touched and a
-- field the rules already filled with better than low confidence is left alone.
--   * it reads only what is sent here: leads of a workspace whose real-data gate is OPEN, that is not a school (children's details never go to a model), whose agents' switch is on;
--   * a workspace may have at most `app.lead_reader_daily_cap()` reads a (India) day (200 on staging);
--   * a lead is read at most five times; the words are the customer's WhatsApp messages (app.lead_words), which cannot hold a phone number or an e-mail address.
--   workspace.lead_read_days   one row per (workspace, India day): how many reads. Numbers only.
--   public.lead_profiles       three new counters: messages seen at the last read, when, and how many reads.
--   public.scheduler_lead_reads_pending / scheduler_lead_read_apply   the worker's two calls (the scheduler account only).

create table workspace.lead_read_days (
  workspace_id uuid not null references public.tenants (id) on delete restrict,
  day          date not null,
  reads        integer not null default 0 check (reads >= 0),
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, day)
);
alter table workspace.lead_read_days enable row level security;
alter table workspace.lead_read_days force row level security;
revoke all on workspace.lead_read_days from public, anon, authenticated, service_role;
comment on table workspace.lead_read_days is 'Job OR: how many times the AI lead reader read a lead of this workspace on an India day (the daily cap). Numbers only.';

alter table public.lead_profiles
  add column ai_read_messages integer not null default 0 check (ai_read_messages >= 0),
  add column ai_read_at timestamptz,
  add column ai_reads smallint not null default 0 check (ai_reads between 0 and 5);
comment on column public.lead_profiles.ai_read_messages is 'SAFE: how many WhatsApp messages the AI lead reader had seen at its last read. CLEAN-EXEMPT: integer';
comment on column public.lead_profiles.ai_read_at is 'SAFE: when the AI lead reader last read this lead. CLEAN-EXEMPT: timestamp';
comment on column public.lead_profiles.ai_reads is 'SAFE: how many times the AI lead reader read this lead (at most 5). CLEAN-EXEMPT: integer';

create function app.lead_reader_daily_cap() returns integer
language sql
immutable
set search_path = ''
as $$ select 200 $$;
revoke all on function app.lead_reader_daily_cap() from public;

-- may the reader look at this workspace's leads at all (and has it room today)?
create function app.lead_reader_allowed(p_tenant uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.real_data_gate_open(p_tenant) and not app.task_is_school(p_tenant) and app.agent_switches_on(p_tenant, 'assistant')
     and coalesce((select d.reads from workspace.lead_read_days d where d.workspace_id = p_tenant and d.day = (now() at time zone 'Asia/Kolkata')::date), 0) < app.lead_reader_daily_cap()
$$;
revoke all on function app.lead_reader_allowed(uuid) from public;

create function app.lead_usable_messages(p_tenant uuid, p_lead uuid) returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer from public.enquiries e
   where e.tenant_id = p_tenant and e.lead_id = p_lead and e.channel = 'whatsapp' and e.body !~ '^\[[^\]]{1,40}\]$'
$$;
revoke all on function app.lead_usable_messages(uuid, uuid) from public;

create function public.scheduler_lead_reads_pending(p_limit integer default 3) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out jsonb := '[]'::jsonb;
  r     record;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 10 then
    perform app.scheduler_error('invalid');
  end if;
  for r in
    select l.tenant_id, l.id as lead_id, app.lead_words(l.tenant_id, l.id) as words, app.lead_usable_messages(l.tenant_id, l.id) as messages
      from public.leads l
      left join public.lead_profiles p on p.tenant_id = l.tenant_id and p.lead_id = l.id
     where l.source = 'whatsapp' and l.archived_at is null
       and exists (select 1 from public.enquiries e where e.tenant_id = l.tenant_id and e.lead_id = l.id and e.channel = 'whatsapp' and e.received_at > now() - interval '24 hours')
       and app.lead_usable_messages(l.tenant_id, l.id) > coalesce(p.ai_read_messages, 0)
       and coalesce(p.ai_reads, 0) < 5
       -- a NEW lead is read at its first message; a later message only while the key fields are still empty
       and (coalesce(p.ai_read_messages, 0) = 0 or p.need is null or p.quantity is null)
       and not (coalesce(p.fixed, '{}'::text[]) @> array['need', 'quantity'])
       and app.lead_reader_allowed(l.tenant_id)
     order by l.created_at desc, l.id desc
     limit p_limit
  loop
    continue when r.words is null;
    v_out := v_out || jsonb_build_array(jsonb_build_object('tenant_id', r.tenant_id, 'lead_id', r.lead_id, 'text', left(r.words, 1000), 'messages', r.messages));
  end loop;
  return v_out;
end;
$$;
revoke all on function public.scheduler_lead_reads_pending(integer) from public, anon;
grant execute on function public.scheduler_lead_reads_pending(integer) to authenticated;
comment on function public.scheduler_lead_reads_pending(integer) is 'Job OR: the WhatsApp leads the AI lead reader should read now (scheduler account only). PII: what customers wrote.';

create function public.scheduler_lead_read_apply(p_tenant_id uuid, p_lead_id uuid, p_fields jsonb, p_confidence jsonb, p_messages integer) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p      public.lead_profiles;
  k      text;
  v_ok   text[] := '{}';
  v_conf jsonb;
  v_day  date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  if p_tenant_id is null or p_lead_id is null or p_fields is null or jsonb_typeof(p_fields) <> 'object' or p_confidence is null or jsonb_typeof(p_confidence) <> 'object'
     or p_messages is null or p_messages not between 1 and 100000 then
    perform app.scheduler_error('invalid');
  end if;
  if not exists (select 1 from public.leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id and l.source = 'whatsapp') then
    perform app.scheduler_error('reference');
  end if;
  if not app.lead_reader_allowed(p_tenant_id) then
    return 'skipped';
  end if;
  insert into public.lead_profiles (tenant_id, lead_id) values (p_tenant_id, p_lead_id) on conflict (tenant_id, lead_id) do nothing;
  select * into p from public.lead_profiles x where x.tenant_id = p_tenant_id and x.lead_id = p_lead_id for update;
  if p.ai_reads >= 5 then
    return 'skipped';
  end if;
  v_conf := p.confidence;
  for k in select jsonb_object_keys(p_fields) loop
    if k not in ('need', 'quantity', 'area', 'city', 'budget', 'timeline', 'urgency', 'language') or k = any (p.fixed) or p_confidence ->> k <> 'low' then
      continue;
    end if;
    -- only an empty field, or one the rules guessed with low confidence: never better than that
    if (case k when 'need' then p.need when 'quantity' then p.quantity when 'area' then p.area when 'city' then p.city when 'budget' then p.budget
                when 'timeline' then p.timeline when 'urgency' then p.urgency else p.language end) is not null and coalesce(p.confidence ->> k, 'low') <> 'low' then
      continue;
    end if;
    v_conf := v_conf || jsonb_build_object(k, 'low');
    v_ok := array_append(v_ok, k);
  end loop;
  update public.lead_profiles x set
      need = case when 'need' = any (v_ok) then p_fields ->> 'need' else x.need end,
      quantity = case when 'quantity' = any (v_ok) then p_fields ->> 'quantity' else x.quantity end,
      area = case when 'area' = any (v_ok) then p_fields ->> 'area' else x.area end,
      city = case when 'city' = any (v_ok) then p_fields ->> 'city' else x.city end,
      budget = case when 'budget' = any (v_ok) then p_fields ->> 'budget' else x.budget end,
      timeline = case when 'timeline' = any (v_ok) then p_fields ->> 'timeline' else x.timeline end,
      urgency = case when 'urgency' = any (v_ok) then p_fields ->> 'urgency' else x.urgency end,
      language = case when 'language' = any (v_ok) then p_fields ->> 'language' else x.language end,
      confidence = v_conf,
      normalised_by = case when cardinality(v_ok) > 0 then 'ai' else x.normalised_by end,
      normalised_at = case when cardinality(v_ok) > 0 then now() else x.normalised_at end,
      ai_read_messages = p_messages, ai_read_at = now(), ai_reads = x.ai_reads + 1, updated_at = now()
    where x.tenant_id = p_tenant_id and x.lead_id = p_lead_id;
  insert into workspace.lead_read_days as d (workspace_id, day, reads) values (p_tenant_id, v_day, 1)
    on conflict (workspace_id, day) do update set reads = d.reads + 1, updated_at = now();
  delete from workspace.lead_read_days where workspace_id = p_tenant_id and day < v_day - 40;
  return case when cardinality(v_ok) > 0 then 'applied' else 'nothing' end;
exception when check_violation then
  -- a value the profile's own rules refuse (a phone number, a link): the read counts, nothing is written
  update public.lead_profiles x set ai_read_messages = p_messages, ai_read_at = now(), ai_reads = least(x.ai_reads + 1, 5) where x.tenant_id = p_tenant_id and x.lead_id = p_lead_id;
  insert into workspace.lead_read_days as d (workspace_id, day, reads) values (p_tenant_id, v_day, 1)
    on conflict (workspace_id, day) do update set reads = d.reads + 1, updated_at = now();
  return 'nothing';
end;
$$;
revoke all on function public.scheduler_lead_read_apply(uuid, uuid, jsonb, jsonb, integer) from public, anon;
grant execute on function public.scheduler_lead_read_apply(uuid, uuid, jsonb, jsonb, integer) to authenticated;
comment on function public.scheduler_lead_read_apply(uuid, uuid, jsonb, jsonb, integer) is 'Job OR: store the AI lead reader''s low-confidence fields on a WhatsApp lead (scheduler account only; owner-fixed fields and better guesses are kept; counts the read against the day''s cap).';
