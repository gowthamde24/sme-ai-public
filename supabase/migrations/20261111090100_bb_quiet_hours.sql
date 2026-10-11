-- Job BB (ADR 0070), quiet hours per business. A new migration; earlier files are not edited.
--
-- Until now every business had the same quiet hours, 21:00 to 09:00 India time, written into the policy functions. The Owner may now move both ends, inside a narrow range so that a business cannot switch quiet hours off
-- by accident: the START between 19:00 and 23:00, the END between 07:00 and 10:00 (whole hours; the default stays 21 and 9). Changing them needs the Owner AND a second factor, like every outbox setting.
--
-- ONE rule, read in one place: `app.outbox_quiet_hours_of(tenant)` -> the two hours. The two helpers `app.outbox_in_quiet_hours(at, tenant)` and `app.outbox_next_open(at, tenant)` use it; the old one-argument helpers stay (the default 21 / 9) for anything not
-- tied to a business. The FIVE callers are replaced below as FULL COPIES in which only the helper calls differ (pinned by test_migration_copies_bb.py): the send policy (decide_content), the Owner's approval (outbox_decide), the release of a due
-- message (claim_due_core), and the two scheduler reminder checks. A message already scheduled for 09:00 under the old hours keeps its time until it is claimed; the claim re-checks against the hours in force then.
--
-- The evening reminder hour (9 to 20) is checked against the quiet START only when it is due, and a reminder is never queued inside quiet hours; so a business that sets its start at 19:00 and its evening reminder at 20:00 simply gets no evening
-- reminder (the heads-up still goes). The settings screen should say so. Not a hidden failure: the Owner chose both.

alter table public.outbox_settings
  add column quiet_start_hour smallint not null default 21 check (quiet_start_hour between 19 and 23),
  add column quiet_end_hour   smallint not null default 9  check (quiet_end_hour between 7 and 10);
comment on column public.outbox_settings.quiet_start_hour is 'SAFE: an hour of the day, India time. CLEAN-EXEMPT: smallint';
comment on column public.outbox_settings.quiet_end_hour is 'SAFE: an hour of the day, India time. CLEAN-EXEMPT: smallint';

-- the two hours of a business (the defaults when it has no settings row yet)
create function app.outbox_quiet_hours_of(p_tenant uuid, out o_start integer, out o_end integer) returns record
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  select s.quiet_start_hour, s.quiet_end_hour into o_start, o_end from public.outbox_settings s where s.tenant_id = p_tenant;
  o_start := coalesce(o_start, 21);
  o_end := coalesce(o_end, 9);
end;
$$;
revoke all on function app.outbox_quiet_hours_of(uuid) from public, anon, authenticated, service_role;

create function app.outbox_in_quiet_hours(p_at timestamptz, p_tenant uuid) returns boolean
language sql
stable
set search_path = ''
as $$
  select extract(hour from (p_at at time zone 'Asia/Kolkata')) >= q.o_start or extract(hour from (p_at at time zone 'Asia/Kolkata')) < q.o_end
    from app.outbox_quiet_hours_of(p_tenant) q
$$;
revoke all on function app.outbox_in_quiet_hours(timestamptz, uuid) from public, anon, authenticated, service_role;

create function app.outbox_next_open(p_at timestamptz, p_tenant uuid) returns timestamptz
language sql
stable
set search_path = ''
as $$
  select case
           when extract(hour from l) < q.o_end   then (date_trunc('day', l) + make_interval(hours => q.o_end)) at time zone 'Asia/Kolkata'
           when extract(hour from l) >= q.o_start then (date_trunc('day', l) + interval '1 day' + make_interval(hours => q.o_end)) at time zone 'Asia/Kolkata'
           else p_at
         end
    from (select p_at at time zone 'Asia/Kolkata' as l) x, app.outbox_quiet_hours_of(p_tenant) q
$$;
revoke all on function app.outbox_next_open(timestamptz, uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the five callers, full copies with the tenant passed to the helpers
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function app.outbox_decide_content(
  p_tenant uuid, p_lead uuid, p_body text, p_category text, p_model_flagged boolean, p_uncertain boolean, p_now timestamptz
) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_flags   text[] := app.outbox_content_flags(p_body);
  v_inbound timestamptz;
  v_window  boolean;
  v_text_in text;
  v_reason  text;
begin
  select greatest(
           (select max(e.received_at) from public.enquiries e where e.tenant_id = p_tenant and e.lead_id = p_lead and e.channel = 'whatsapp' and e.received_at <= p_now),
           (select max(t.occurred_at) from public.lead_touches t where t.tenant_id = p_tenant and t.lead_id = p_lead and t.direction = 'in' and t.channel = 'whatsapp' and t.occurred_at <= p_now))
    into v_inbound;
  v_window := v_inbound is not null and v_inbound > p_now - interval '24 hours';
  -- a complaint in the customer's latest message makes the reply a person's call, whatever the reply says
  if v_window then
    select e.body into v_text_in from public.enquiries e
     where e.tenant_id = p_tenant and e.lead_id = p_lead and e.channel = 'whatsapp' and e.received_at <= p_now
     order by e.received_at desc, e.id desc limit 1;
    if 'complaint' = any (app.outbox_content_flags(v_text_in)) and not 'complaint' = any (v_flags) then
      v_flags := v_flags || 'complaint'::text;
    end if;
  end if;

  v_reason := case
    when 'money' = any (v_flags) then 'money'
    when 'commitment' = any (v_flags) then 'commitment'
    when 'complaint' = any (v_flags) then 'complaint'
    when p_model_flagged then 'model_flagged'
    when p_uncertain then 'uncertain'
    when p_category = 'other' then 'category_other'
    when p_category = 'reply_to_inbound' and not v_window then 'no_inbound_window'
    when not coalesce((select s.auto_send_enabled from public.outbox_settings s where s.tenant_id = p_tenant), false) then 'auto_off'
    else null
  end;
  if v_reason is not null then
    return jsonb_build_object('status', 'needs_approval', 'reason', v_reason, 'flags', to_jsonb(v_flags), 'scheduled_for', null);
  end if;
  if app.outbox_in_quiet_hours(p_now, p_tenant) then
    return jsonb_build_object('status', 'queued', 'reason', 'quiet_hours', 'flags', to_jsonb(v_flags), 'scheduled_for', app.outbox_next_open(p_now, p_tenant));
  end if;
  return jsonb_build_object('status', 'queued', 'reason', 'auto_allowed', 'flags', to_jsonb(v_flags), 'scheduled_for', p_now);
end;
$$;


create or replace function public.outbox_decide(p_tenant_id uuid, p_message_id uuid, p_decision text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_now  timestamptz := app.outbox_now();
  m      public.outbox_messages;
  c      public.contacts;
  v_hard text;
begin
  if v_uid is null or p_tenant_id is null or p_message_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    perform app.outbox_error('invalid');
  end if;
  if p_decision = 'approve' then
    perform app.require_aal2();
  end if;
  select * into m from public.outbox_messages x where x.id = p_message_id and x.tenant_id = p_tenant_id for update;
  if not found then
    perform app.outbox_error('reference');
  end if;
  if m.status <> 'needs_approval' then
    perform app.outbox_error('state');
  end if;
  if p_decision = 'reject' then
    update public.outbox_messages set status = 'blocked', reason = 'owner_rejected', decided_by = v_uid, decided_at = v_now, scheduled_for = null
     where id = m.id returning * into m;
    return app.outbox_row_json(m, false);
  end if;
  if m.contact_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('outbox:' || m.contact_id::text, 0));
    select * into c from public.contacts x where x.id = m.contact_id and x.tenant_id = p_tenant_id;
  end if;
  v_hard := case when c.id is null then 'no_contact' else app.outbox_hard_block(p_tenant_id, c, m.id, v_now) end;
  if v_hard is not null then
    update public.outbox_messages set status = 'blocked', reason = v_hard, decided_by = v_uid, decided_at = v_now, scheduled_for = null
     where id = m.id returning * into m;
    return app.outbox_row_json(m, false);
  end if;
  update public.outbox_messages
     set status = 'queued', reason = 'owner_approved', decided_by = v_uid, decided_at = v_now, scheduled_for = app.outbox_next_open(v_now, p_tenant_id)
   where id = m.id returning * into m;
  return app.outbox_row_json(m, false);
end;
$$;


create or replace function app.outbox_claim_due_core(p_tenant_id uuid, p_limit integer, p_approved_only boolean) returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_now  timestamptz := app.outbox_now();
  v_out  jsonb := '[]'::jsonb;
  r      public.outbox_messages;
  c      public.contacts;
  v_hard text;
begin
  if p_limit is null or p_limit not between 1 and 50 or p_approved_only is null then
    perform app.outbox_error('invalid');
  end if;
  if not app.outbox_switch_on() then
    return v_out;
  end if;
  for r in
    select * from public.outbox_messages x
     where x.tenant_id = p_tenant_id and x.status = 'queued' and (x.scheduled_for is null or x.scheduled_for <= v_now)
       and (not p_approved_only or x.reason = 'owner_approved')
       and (x.claimed_at is null or x.claimed_at < v_now - interval '2 minutes')
     order by x.created_at, x.id
     limit p_limit
     for update skip locked
  loop
    if app.outbox_in_quiet_hours(v_now, p_tenant_id) then
      update public.outbox_messages set scheduled_for = app.outbox_next_open(v_now, p_tenant_id) where id = r.id;
      continue;
    end if;
    perform pg_advisory_xact_lock(hashtextextended('outbox:' || coalesce(r.contact_id::text, r.id::text), 0));
    select * into c from public.contacts x where x.id = r.contact_id and x.tenant_id = p_tenant_id;
    v_hard := case when c.id is null then 'no_contact' else app.outbox_hard_block(p_tenant_id, c, r.id, v_now) end;
    if v_hard is not null then
      update public.outbox_messages set status = 'blocked', reason = v_hard, scheduled_for = null where id = r.id;
      continue;
    end if;
    update public.outbox_messages set claimed_at = v_now, attempts = attempts + 1 where id = r.id;
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', r.id, 'lead_id', r.lead_id, 'contact_id', r.contact_id, 'phone', c.phone, 'body', r.body, 'language', r.language,
      'media', coalesce((select jsonb_agg(jsonb_build_object('photo_id', ph.id, 'bucket', ph.bucket, 'path', ph.path, 'content_type', ph.content_type) order by md.position)
                           from public.outbox_message_media md join public.catalogue_photos ph on ph.tenant_id = md.tenant_id and ph.id = md.photo_id and ph.removed_at is null
                          where md.tenant_id = r.tenant_id and md.message_id = r.id), '[]'::jsonb)));
  end loop;
  return v_out;
end;
$$;


create or replace function app.scheduler_reminder_due(m public.store_visits, p_kind text, p_now timestamptz, p_set jsonb) returns boolean
language sql
stable
set search_path = ''
as $$
  select m.status = 'confirmed' and m.starts_at > p_now
     and not app.outbox_in_quiet_hours(p_now, m.tenant_id)
     and not exists (select 1 from public.visit_reminders r where r.tenant_id = m.tenant_id and r.visit_id = m.id and r.kind = p_kind and r.for_starts_at = m.starts_at)
     and case p_kind
       when 'evening_before' then
         (p_set ->> 'reminder_evening_enabled')::boolean
         and m.visit_date = (p_now at time zone 'Asia/Kolkata')::date + 1
         and extract(hour from p_now at time zone 'Asia/Kolkata') >= (p_set ->> 'reminder_evening_hour')::integer
         and not exists (select 1 from public.outbox_messages x
                          where x.tenant_id = m.tenant_id and x.id in (m.confirmation_message_id, m.reminder_message_id)
                            and x.created_at >= ((m.visit_date - 1) + make_interval(hours => (p_set ->> 'reminder_evening_hour')::integer)) at time zone 'Asia/Kolkata')
       when 'heads_up' then
         (p_set ->> 'reminder_heads_up_enabled')::boolean
         and m.starts_at > p_now + interval '30 minutes'
         and m.starts_at - make_interval(mins => (p_set ->> 'reminder_heads_up_minutes')::integer) <= p_now
         and not exists (select 1 from public.outbox_messages x
                          where x.tenant_id = m.tenant_id and x.id in (m.confirmation_message_id, m.reminder_message_id)
                            and x.created_at >= m.starts_at - make_interval(mins => (p_set ->> 'reminder_heads_up_minutes')::integer))
       else false
     end
$$;


create or replace function public.scheduler_due_reminders(p_tenant_id uuid, p_limit integer default 50) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := app.outbox_now();
  v_set jsonb;
begin
  if not app.is_scheduler() or p_tenant_id is null then
    perform app.scheduler_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    perform app.scheduler_error('invalid');
  end if;
  if not app.scheduler_tenant_on(p_tenant_id) or app.outbox_in_quiet_hours(v_now, p_tenant_id) then
    return '[]'::jsonb;
  end if;
  v_set := app.scheduler_settings_json(p_tenant_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object('visit_id', z.id, 'kind', z.kind, 'starts_at', z.starts_at, 'language', z.language) order by z.starts_at, z.id, z.kind)
      from (
        select v.id, k.kind, v.starts_at,
               coalesce((select x.language from public.outbox_messages x where x.tenant_id = v.tenant_id and x.id = v.confirmation_message_id), 'en') as language
          from public.store_visits v
         cross join (values ('evening_before'), ('heads_up')) k (kind)
         where v.tenant_id = p_tenant_id and v.status = 'confirmed' and v.starts_at > v_now and v.visit_date between (v_now at time zone 'Asia/Kolkata')::date and (v_now at time zone 'Asia/Kolkata')::date + 1
           and app.scheduler_reminder_due(v, k.kind, v_now, v_set)
         order by v.starts_at, v.id, k.kind
         limit p_limit
      ) z
  ), '[]'::jsonb);
end;
$$;


-- ---------------------------------------------------------------------------------------------------------------------------------
-- the setting: the Owner with a second factor. The two hours are optional (null = leave as they are).
-- ---------------------------------------------------------------------------------------------------------------------------------
drop function public.outbox_set_settings(uuid, boolean, integer);
create function public.outbox_set_settings(p_tenant_id uuid, p_auto_send_enabled boolean, p_per_customer_daily_limit integer, p_quiet_start integer default null, p_quiet_end integer default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  s     public.outbox_settings;
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  perform app.require_aal2();
  if p_auto_send_enabled is null or p_per_customer_daily_limit is null or p_per_customer_daily_limit not between 1 and 20
     or (p_quiet_start is not null and p_quiet_start not between 19 and 23) or (p_quiet_end is not null and p_quiet_end not between 7 and 10) then
    perform app.outbox_error('invalid');
  end if;
  insert into public.outbox_settings (tenant_id, auto_send_enabled, per_customer_daily_limit, quiet_start_hour, quiet_end_hour, updated_by)
  values (p_tenant_id, p_auto_send_enabled, p_per_customer_daily_limit, coalesce(p_quiet_start, 21), coalesce(p_quiet_end, 9), v_uid)
  on conflict (tenant_id) do update
    set auto_send_enabled = excluded.auto_send_enabled, per_customer_daily_limit = excluded.per_customer_daily_limit,
        quiet_start_hour = coalesce(p_quiet_start, public.outbox_settings.quiet_start_hour), quiet_end_hour = coalesce(p_quiet_end, public.outbox_settings.quiet_end_hour),
        updated_by = v_uid, updated_at = now()
  returning * into s;
  return jsonb_build_object('auto_send_enabled', s.auto_send_enabled, 'per_customer_daily_limit', s.per_customer_daily_limit,
                            'quiet_hours_start', s.quiet_start_hour, 'quiet_hours_end', s.quiet_end_hour);
end;
$$;
revoke all on function public.outbox_set_settings(uuid, boolean, integer, integer, integer) from public, anon;
grant execute on function public.outbox_set_settings(uuid, boolean, integer, integer, integer) to authenticated;

create or replace function public.outbox_settings_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.outbox_error('deny');
  end if;
  return jsonb_build_object(
    'platform_switch_on', app.outbox_switch_on(),
    'auto_send_enabled', coalesce((select s.auto_send_enabled from public.outbox_settings s where s.tenant_id = p_tenant_id), false),
    'per_customer_daily_limit', app.outbox_limit(p_tenant_id),
    'quiet_hours_start', (select q.o_start from app.outbox_quiet_hours_of(p_tenant_id) q),
    'quiet_hours_end', (select q.o_end from app.outbox_quiet_hours_of(p_tenant_id) q));
end;
$$;
