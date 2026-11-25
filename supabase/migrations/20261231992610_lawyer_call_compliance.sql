-- The lawyer's written opinion of 25 Nov 2026 (TRAI + DPDP; reports/lawyer-opinion-actions.md, planner's decisions of 26 Nov), the database half:
--   * real outbound is allowed per workspace only with (1) the workspace's OWN KYC-verified number (Model B) and an accepted, dated "how you will use this number" statement (telephony.number_usage_acks), and
--     (2) a KNOWN lead: a digital enquiry within 7 days (3 months for an application-type lead: the gate decides from `enquiry_age_days`) or a registered consent id. A list or a business's own statement never counts.
--   * consent has a SOURCE: app.phone_consent_source says digital_enquiry, registered_consent (a Consent Registrar id, kept as evidence `registrar:<id>`) or business_statement.
--   * the enquiry age is read here (the newest written/digital enquiry up to 92 days) and judged in the gate, which knows the purpose.
--   * complaints: public.call_complaints is the per-workspace tracker (a complaint made to the business or passed on by the telecom provider); the gate pauses outbound at 5 in 10 days, Today warns at 3.
--   * abandoned calls: app.abandoned_call_stats counts outbound calls a person answered that ended without a human taking over; the staff console alarms above 3% in 24 hours (needs 20 answered calls).
--   * the call row may hold the four new refusal words.
-- Nothing is switched on: live calls stay behind OUTBOUND_REAL (API, off) and LIVE confirmed, exactly as before.

-- 1. the usage statement of a number ("How you will use this number")
create table telephony.number_usage_acks (
  tenant_id   uuid primary key references public.tenants (id),
  accepted_at timestamptz not null default now(),
  accepted_by uuid not null,
  version     text not null check (version ~ '^[a-z0-9._-]{1,30}$')
);
comment on table telephony.number_usage_acks is 'The Owner accepted the statement of how this workspace will use its own number (only people who asked, platform hours, automatic do-not-call). One row per workspace; the date and the person are the record. No personal data beyond the user id.';
comment on column telephony.number_usage_acks.version is 'SAFE: the version label of the statement text. CLEAN-EXEMPT: strict pattern CHECK';
alter table telephony.number_usage_acks enable row level security;
alter table telephony.number_usage_acks force row level security;
revoke all on telephony.number_usage_acks from public, anon, authenticated, service_role;

create function public.number_usage_ack_accept(p_tenant_id uuid, p_version text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare r telephony.number_usage_acks;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform app.require_aal2();
  if p_version is null or p_version !~ '^[a-z0-9._-]{1,30}$' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  insert into telephony.number_usage_acks (tenant_id, accepted_by, version) values (p_tenant_id, auth.uid(), p_version)
  on conflict (tenant_id) do update set version = excluded.version, accepted_by = excluded.accepted_by, accepted_at = now()
  returning * into r;
  return jsonb_build_object('accepted', true, 'accepted_at', r.accepted_at, 'version', r.version);
end $$;
revoke all on function public.number_usage_ack_accept(uuid, text) from public, anon;
grant execute on function public.number_usage_ack_accept(uuid, text) to authenticated;

create function public.number_usage_ack_get(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare r telephony.number_usage_acks;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into r from telephony.number_usage_acks a where a.tenant_id = p_tenant_id;
  return case when r.tenant_id is null then jsonb_build_object('accepted', false) else jsonb_build_object('accepted', true, 'accepted_at', r.accepted_at, 'version', r.version) end;
end $$;
revoke all on function public.number_usage_ack_get(uuid) from public, anon;
grant execute on function public.number_usage_ack_get(uuid) to authenticated;

-- 2. where a contact's phone consent came from
create function app.phone_consent_source(p_tenant uuid, p_contact uuid) returns text
language sql stable security definer set search_path = '' as
$$
  select case
           when e.evidence_ref like 'registrar:%' then 'registered_consent'
           when e.evidence_type in ('web_form', 'email_reply') then 'digital_enquiry'
           else 'business_statement' end
    from public.consent_events e
   where e.tenant_id = p_tenant and e.contact_id = p_contact and e.channel = 'phone' and e.event_type = 'granted'
     and not exists (select 1 from public.consent_events w where w.tenant_id = e.tenant_id and w.contact_id = e.contact_id and w.channel = 'phone' and w.event_type = 'withdrawn' and w.created_at > e.created_at)
   order by e.created_at desc limit 1
$$;
revoke all on function app.phone_consent_source(uuid, uuid) from public, anon, authenticated, service_role;

-- 3. the age, in days, of the newest written/digital enquiry of a contact (up to 92 days; the same sources as app.call_back_proof, no purchase); null when there is none
create function app.digital_enquiry_age_days(p_tenant uuid, p_contact uuid) returns numeric
language sql stable security definer set search_path = '' as
$$
  select round(extract(epoch from (app.outbox_now() - max(p.at))) / 86400.0, 2)
    from (
      select a.received_at as at from public.lead_arrivals a
       where a.tenant_id = p_tenant and a.contact_id = p_contact and a.kind in ('first', 'again')
         and a.source_tag in ('website_form', 'meta_lead_ads', 'google_ads', 'indiamart', 'justdial', '99acres', 'magicbricks', 'housing', 'email_forward', 'click_to_whatsapp')
      union all
      select l.created_at from public.leads l
       where l.tenant_id = p_tenant and l.contact_id = p_contact
         and l.source in ('website_form', 'meta_lead_ads', 'google_ads', 'indiamart', 'justdial', '99acres', 'magicbricks', 'housing', 'email_forward', 'click_to_whatsapp')
      union all
      select e.received_at from public.enquiries e
       where e.tenant_id = p_tenant and e.contact_id = p_contact and e.channel = 'whatsapp' and e.lead_id is not null
    ) p
   where p.at > app.outbox_now() - interval '92 days'
$$;
revoke all on function app.digital_enquiry_age_days(uuid, uuid) from public, anon, authenticated, service_role;

-- 4. complaints: the per-workspace tracker
create table public.call_complaints (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references public.tenants (id),
  kind       text not null check (kind in ('to_business', 'telecom_provider', 'regulator')),
  call_id    uuid references public.phone_calls (id),
  noted_by   uuid not null,
  created_at timestamptz not null default now()
);
comment on table public.call_complaints is 'A complaint about the workspace''s outbound calls: made to the business, passed on by the telecom provider or made to the regulator. No name, no number, no text: the kind and, when known, the call. The gate pauses outbound calls at 5 in 10 days.';
comment on column public.call_complaints.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
create index call_complaints_recent on public.call_complaints (tenant_id, created_at desc);
alter table public.call_complaints enable row level security;
alter table public.call_complaints force row level security;
revoke all on public.call_complaints from public, anon, authenticated, service_role;
grant select on public.call_complaints to authenticated;
create policy call_complaints_select on public.call_complaints for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create trigger call_complaints_forbid_tenant_id_change before update on public.call_complaints for each row execute function app.forbid_tenant_id_change();

create function public.call_complaint_record(p_tenant_id uuid, p_kind text, p_call_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare r public.call_complaints; v_n integer;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('to_business', 'telecom_provider', 'regulator') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if p_call_id is not null and not exists (select 1 from public.phone_calls c where c.id = p_call_id and c.tenant_id = p_tenant_id) then
    raise exception 'not found' using errcode = '23503';
  end if;
  insert into public.call_complaints (tenant_id, kind, call_id, noted_by) values (p_tenant_id, p_kind, p_call_id, auth.uid()) returning * into r;
  v_n := app.call_complaints_count(p_tenant_id, 10);
  return jsonb_build_object('id', r.id, 'complaints_10d', v_n, 'warn', v_n >= 3, 'paused', v_n >= 5);
end $$;
revoke all on function public.call_complaint_record(uuid, text, uuid) from public, anon;

create function app.call_complaints_count(p_tenant uuid, p_days integer default 10) returns integer
language sql stable security definer set search_path = '' as
$$ select count(*)::int from public.call_complaints c where c.tenant_id = p_tenant and c.created_at > app.outbox_now() - make_interval(days => greatest(coalesce(p_days, 10), 1)) $$;
revoke all on function app.call_complaints_count(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.call_complaint_record(uuid, text, uuid) to authenticated;

-- 5. abandoned calls: outbound calls a person answered that ended without a human taking over
create function app.abandoned_call_stats(p_tenant uuid default null, p_hours integer default 24) returns jsonb
language sql stable security definer set search_path = '' as
$$
  select jsonb_build_object('answered', count(*), 'abandoned', count(*) filter (where c.end_reason is distinct from 'handover' and c.handled_by is null), 'hours', greatest(coalesce(p_hours, 24), 1))
    from public.phone_calls c
   where c.direction = 'outbound' and not c.simulated and not c.sandbox and c.answered_at is not null
     and c.end_reason is distinct from 'voicemail'
     and (p_tenant is null or c.tenant_id = p_tenant)
     and c.created_at > app.outbox_now() - make_interval(hours => greatest(coalesce(p_hours, 24), 1))
$$;
revoke all on function app.abandoned_call_stats(uuid, integer) from public, anon, authenticated, service_role;

-- 6. the call row may hold the new refusal words
do $patch$
declare r record;
begin
  for r in select c.conname, pg_get_constraintdef(c.oid) d from pg_constraint c where c.conrelid = 'public.phone_calls'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%complaints_pause%' loop
    if position($q$'enquiry_too_old'$q$ in r.d) = 0 then
      execute format('alter table public.phone_calls drop constraint %I', r.conname);
      execute format('alter table public.phone_calls add constraint %I %s', r.conname,
                     replace(r.d, $q$'complaints_pause'$q$, $q$'complaints_pause', 'enquiry_too_old', 'outbound_not_real', 'no_own_number', 'usage_not_accepted'$q$));
    end if;
  end loop;
end $patch$;

-- 7. the facts of a call gain what the gate needs
do $patch$
declare
  v_def text := pg_get_functiondef('public.call_facts(uuid,uuid,text)'::regprocedure);
  v_old text := $q$'proof', v_proof is not null,$q$;
  v_new text := $q$'proof', v_proof is not null,
    'enquiry_age_days', case when v_contact.id is null then null else app.digital_enquiry_age_days(p_tenant_id, v_contact.id) end,
    'consent_source', case when v_contact.id is null then null else app.phone_consent_source(p_tenant_id, v_contact.id) end,
    'registered_consent', coalesce(v_contact.id is not null and v_contact.phone_consent = 'granted' and app.phone_consent_source(p_tenant_id, v_contact.id) = 'registered_consent', false),
    'own_number_verified', exists (select 1 from telephony.business_clients b where b.tenant_id = p_tenant_id and b.state = 'verified'),
    'usage_ack', exists (select 1 from telephony.number_usage_acks a where a.tenant_id = p_tenant_id),
    'logged_complaints_10d', app.call_complaints_count(p_tenant_id, 10),$q$;
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'call_facts has changed: the lawyer-opinion patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end $patch$;

-- 8. staff: the abandoned-call rate and the workspaces with complaints
create function public.admin_abandoned_calls(p_hours integer default 24) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_all jsonb;
begin
  v_staff := admin.staff_check(array['owner', 'support', 'finance']);
  perform admin.log(v_staff.user_id, 'list', null, null, null, null, 'business', null, false);
  v_all := app.abandoned_call_stats(null, p_hours);
  return jsonb_build_object('hours', (v_all ->> 'hours')::int, 'answered', (v_all ->> 'answered')::int, 'abandoned', (v_all ->> 'abandoned')::int,
    'rate_percent', case when (v_all ->> 'answered')::int = 0 then 0 else round(100.0 * (v_all ->> 'abandoned')::int / (v_all ->> 'answered')::int, 1) end,
    'alarm', (v_all ->> 'answered')::int >= 20 and (v_all ->> 'abandoned')::numeric > 0.03 * (v_all ->> 'answered')::numeric,
    'by_business', coalesce((select jsonb_agg(jsonb_build_object('tenant_id', x.tenant_id, 'business_name', x.name, 'answered', x.answered, 'abandoned', x.abandoned) order by x.abandoned desc)
                               from (select t.id as tenant_id, t.name, (s ->> 'answered')::int as answered, (s ->> 'abandoned')::int as abandoned
                                       from public.tenants t cross join lateral app.abandoned_call_stats(t.id, p_hours) s
                                      where t.archived_at is null and (s ->> 'answered')::int > 0 order by (s ->> 'abandoned')::int desc limit 10) x), '[]'::jsonb),
    'complaints', coalesce((select jsonb_agg(jsonb_build_object('tenant_id', c.tenant_id, 'business_name', t.name, 'complaints_10d', c.n, 'paused', c.n >= 5) order by c.n desc)
                              from (select tenant_id, count(*)::int as n from public.call_complaints where created_at > app.outbox_now() - interval '10 days' group by 1 having count(*) >= 3) c
                              join public.tenants t on t.id = c.tenant_id), '[]'::jsonb));
end $$;
revoke all on function public.admin_abandoned_calls(integer) from public, anon;
grant execute on function public.admin_abandoned_calls(integer) to authenticated;

do $patch$
declare
  v_def text := pg_get_functiondef('admin.computed_alerts(text)'::regprocedure);
  v_old text := E'     where p_role in (''owner'', ''support'') and k.n > 0\n  ) x';
  v_new text := E'     where p_role in (''owner'', ''support'') and k.n > 0\n    union all\n'
    || E'    select 6, jsonb_build_object(''id'', md5(''abandoned_calls'')::uuid, ''kind'', ''abandoned_calls'', ''severity'', ''warn'', ''title'', ''Too many answered calls ended without a person'',\n'
    || E'             ''detail'', a.abandoned || '' of '' || a.answered || '' answered outgoing calls in the last 24 hours ended without a human taking over (above 3 percent). The telecom rules count these as abandoned calls.'',\n'
    || E'             ''created_at'', app.outbox_now(), ''acknowledged'', false)\n'
    || E'      from (select (s ->> ''answered'')::int as answered, (s ->> ''abandoned'')::int as abandoned from app.abandoned_call_stats(null, 24) s) a\n'
    || E'     where p_role in (''owner'', ''support'') and a.answered >= 20 and a.abandoned > 0.03 * a.answered\n'
    || E'    union all\n'
    || E'    select 7, jsonb_build_object(''id'', md5(''complaints_paused'')::uuid, ''kind'', ''complaints_paused'', ''severity'', ''warn'', ''title'', ''Businesses with calling complaints'',\n'
    || E'             ''detail'', w.n || '' business(es) have 3 or more calling complaints in 10 days; at 5 their outgoing calls are paused by themselves.'',\n'
    || E'             ''created_at'', app.outbox_now(), ''acknowledged'', false)\n'
    || E'      from (select count(*) as n from (select tenant_id from public.call_complaints where created_at > app.outbox_now() - interval ''10 days'' group by tenant_id having count(*) >= 3) q) w\n'
    || E'     where p_role in (''owner'', ''support'') and w.n > 0\n  ) x';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'computed_alerts has changed: the abandoned-call alarm no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end $patch$;
