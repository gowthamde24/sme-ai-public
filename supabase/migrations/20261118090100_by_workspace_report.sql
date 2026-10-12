-- Job BY (ADR 0077), part 2 of 3: THE SHOP'S BASICS and THE WEEKLY REPORT.
--
--   workspace.profiles                  the business's town and the languages it works in (the shop NAME is the workspace's own name)
--   public.workspace_profile_get/save   any member reads; Owner and Admin save (the name too); says what the setup wizard still lacks
--   public.weekly_report                one call, one India week (Monday to Sunday): visits, messages, how fast the shop answered, the sarees it sent most, the AI allowance used
--
-- SQLSTATEs: 42501 deny, 22023 invalid.

create schema workspace;
revoke all on schema workspace from public, anon, authenticated, service_role;

create table workspace.profiles (
  tenant_id  uuid primary key references public.tenants (id) on delete restrict,
  town       text check (char_length(btrim(town)) between 2 and 80 and app.text_is_clean(town)),
  languages  text[] not null default '{}' check (languages <@ array['en', 'te', 'hi', 'kn', 'ta']::text[] and cardinality(languages) <= 5),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table workspace.profiles enable row level security;
alter table workspace.profiles force row level security;
revoke all on workspace.profiles from public, anon, authenticated, service_role;

create function app.workspace_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid' then raise exception 'invalid input' using errcode = '22023';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.workspace_error(text) from public;

create function app.workspace_profile_json(p_tenant uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'name', t.name, 'town', p.town, 'languages', to_jsonb(coalesce(p.languages, '{}'::text[])),
    'setup_complete', p.town is not null and cardinality(coalesce(p.languages, '{}'::text[])) > 0,
    'missing', (select coalesce(jsonb_agg(x), '[]'::jsonb) from unnest(array[case when p.town is null then 'town' end, case when cardinality(coalesce(p.languages, '{}'::text[])) = 0 then 'languages' end]) x where x is not null),
    'updated_at', p.updated_at)
  from public.tenants t left join workspace.profiles p on p.tenant_id = t.id where t.id = p_tenant
$$;
revoke all on function app.workspace_profile_json(uuid) from public;

create function public.workspace_profile_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.workspace_error('deny');
  end if;
  return app.workspace_profile_json(p_tenant_id);
end;
$$;
revoke all on function public.workspace_profile_get(uuid) from public, anon;
grant execute on function public.workspace_profile_get(uuid) to authenticated;

-- Each field is optional: a missing field is left as it is. The languages are a set (duplicates are folded), at least one when given.
create function public.workspace_profile_save(p_tenant_id uuid, p_name text default null, p_town text default null, p_languages text[] default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_town text := nullif(btrim(coalesce(p_town, '')), '');
  v_langs text[];
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.workspace_error('deny');
  end if;
  if p_name is not null and (v_name is null or char_length(v_name) > 120 or not app.text_is_clean(v_name)) then
    perform app.workspace_error('invalid');
  end if;
  if p_town is not null and v_town is null then
    perform app.workspace_error('invalid');
  end if;
  if p_languages is not null then
    select coalesce(array_agg(distinct l order by l), '{}') into v_langs from unnest(p_languages) l;
    if cardinality(v_langs) = 0 then
      perform app.workspace_error('invalid');
    end if;
  end if;
  begin
    if v_name is not null then
      update public.tenants set name = v_name where id = p_tenant_id;
    end if;
    insert into workspace.profiles as x (tenant_id, town, languages, updated_by, updated_at)
    values (p_tenant_id, v_town, coalesce(v_langs, '{}'), auth.uid(), now())
    on conflict (tenant_id) do update
      set town = coalesce(excluded.town, x.town), languages = coalesce(v_langs, x.languages), updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  exception when check_violation then
    perform app.workspace_error('invalid');
  end;
  perform app.write_audit_event(p_tenant_id, 'workspace.profile_saved', 'workspace', p_tenant_id, null,
    jsonb_build_object('name', p_name is not null, 'town', p_town is not null, 'languages', p_languages is not null));
  return app.workspace_profile_json(p_tenant_id);
end;
$$;
revoke all on function public.workspace_profile_save(uuid, text, text, text[]) from public, anon;
grant execute on function public.workspace_profile_save(uuid, text, text, text[]) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the weekly report
-- ---------------------------------------------------------------------------------------------------------------------------------
-- Monday 00:00 India time of the week that contains `p_instant`
create function app.india_week_start(p_instant timestamptz) returns date
language sql
immutable
set search_path = ''
as $$ select (p_instant at time zone 'Asia/Kolkata')::date - (extract(isodow from (p_instant at time zone 'Asia/Kolkata'))::integer - 1) $$;
revoke all on function app.india_week_start(timestamptz) from public;

-- p_week_start: a Monday (India date); null = this week. Not in the future, at most 104 weeks back. Owner and Admin.
create function public.weekly_report(p_tenant_id uuid, p_week_start date default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_this date := app.india_week_start(now());
  v_start date := coalesce(p_week_start, v_this);
  v_from timestamptz;
  v_to timestamptz;
  v_visits jsonb;
  v_messages jsonb;
  v_response jsonb;
  v_top jsonb;
  v_usage integer;
  v_current boolean;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.workspace_error('deny');
  end if;
  if extract(isodow from v_start) <> 1 or v_start > v_this or v_start < v_this - 728 then
    perform app.workspace_error('invalid');
  end if;
  v_current := v_start = v_this;
  v_from := (v_start::timestamp) at time zone 'Asia/Kolkata';
  v_to := ((v_start + 7)::timestamp) at time zone 'Asia/Kolkata';

  -- visits that were SCHEDULED for the week (by the visit's own India date), and what became of them
  select jsonb_build_object(
           'booked', count(*) filter (where v.status <> 'cancelled'),
           'arrived', count(*) filter (where v.arrived_at is not null),
           'bought', count(*) filter (where v.outcome = 'bought'),
           'will_return', count(*) filter (where v.outcome = 'will_return'),
           'not_interested', count(*) filter (where v.outcome = 'not_interested'),
           'no_show', count(*) filter (where v.status = 'no_show'),
           'cancelled', count(*) filter (where v.status = 'cancelled'))
    into v_visits
    from public.store_visits v where v.tenant_id = p_tenant_id and v.starts_at >= v_from and v.starts_at < v_to;

  -- messages: what went out in the week, what was made in it and still waits (a person to approve it, or its time), and what was stopped
  select jsonb_build_object(
           'sent', count(*) filter (where m.status = 'sent' and m.sent_at >= v_from and m.sent_at < v_to),
           'failed', count(*) filter (where m.status = 'failed' and m.created_at >= v_from and m.created_at < v_to),
           'waiting', count(*) filter (where m.status in ('needs_approval', 'queued') and m.created_at >= v_from and m.created_at < v_to),
           'blocked', count(*) filter (where m.status = 'blocked' and m.created_at >= v_from and m.created_at < v_to))
    into v_messages
    from public.outbox_messages m where m.tenant_id = p_tenant_id;

  -- how long a customer waited for the first answer: for each customer message that is the FIRST since our last message, the time to our next SENT message
  with firsts as (
    select e.id, e.lead_id, e.received_at,
           (select min(m.sent_at) from public.outbox_messages m where m.tenant_id = e.tenant_id and m.lead_id = e.lead_id and m.status = 'sent' and m.sent_at > e.received_at) as answered_at
      from public.enquiries e
     where e.tenant_id = p_tenant_id and e.channel = 'whatsapp' and e.received_at >= v_from and e.received_at < v_to
       and not exists (select 1 from public.enquiries e2
                        where e2.tenant_id = e.tenant_id and e2.lead_id = e.lead_id and e2.channel = 'whatsapp' and e2.received_at < e.received_at
                          and e2.received_at >= coalesce((select max(m.sent_at) from public.outbox_messages m where m.tenant_id = e.tenant_id and m.lead_id = e.lead_id and m.status = 'sent' and m.sent_at < e.received_at), '-infinity'::timestamptz))
  )
  select jsonb_build_object(
           'asked', count(*),
           'answered', count(*) filter (where f.answered_at is not null),
           'unanswered', count(*) filter (where f.answered_at is null),
           'median_seconds', (percentile_cont(0.5) within group (order by extract(epoch from (f.answered_at - f.received_at))) filter (where f.answered_at is not null))::bigint)
    into v_response from firsts f;

  -- the sarees whose photos went out most this week
  select coalesce(jsonb_agg(jsonb_build_object('item_id', t.item_id, 'name', t.name, 'sent', t.n) order by t.n desc, t.name, t.item_id), '[]'::jsonb) into v_top from (
    select ci.id as item_id, ci.name, count(*) as n
      from public.outbox_messages m
      join public.outbox_message_media md on md.tenant_id = m.tenant_id and md.message_id = m.id
      join public.catalogue_photos ph on ph.tenant_id = md.tenant_id and ph.id = md.photo_id
      join public.catalogue_items ci on ci.tenant_id = ph.tenant_id and ci.id = ph.item_id
     where m.tenant_id = p_tenant_id and m.status = 'sent' and m.sent_at >= v_from and m.sent_at < v_to
     group by ci.id, ci.name
     order by n desc, ci.name, ci.id
     limit 5) t;

  -- the AI allowance used: the allowance's own week (ai_usage_week); only the current week has one
  if v_current then
    v_usage := (public.ai_usage_week(p_tenant_id) ->> 'week_percent')::integer;
  end if;

  return jsonb_build_object(
    'week_start', v_start, 'week_end', v_start + 6, 'timezone', 'Asia/Kolkata', 'current', v_current,
    'visits', v_visits, 'messages', v_messages, 'response', v_response, 'top_sarees', v_top, 'ai_usage_percent', v_usage);
end;
$$;
revoke all on function public.weekly_report(uuid, date) from public, anon;
grant execute on function public.weekly_report(uuid, date) to authenticated;
