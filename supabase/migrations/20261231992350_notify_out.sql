-- Notifications out (docs/contracts/commerce-notify.md section C): a workspace's Slack, Telegram and Microsoft Teams channels, and one delivery row per message with retries.
--   public.notify_channels     ONE per workspace and kind (slack, telegram, teams). The secret (a webhook address, or a bot token and a chat id) is NEVER in the database: it lives in the workspace-secrets
--                              store (`sme-ws-<workspace>-conn-<kind>`, app/connector_vault.py). The database keeps only the Owner's own label, the last four characters, the events the Owner chose, the
--                              fields the Owner allowed in a message (closed lists) and the channel's health. Written only by the notify_channel_* functions (Owner or Admin).
--   public.notify_deliveries   one row per event per channel: the event, WHAT it is about (a lead, a missed call, an outcome: an id, no personal data is copied) and where it stands. The text is built when it is
--                              sent from notify_event_data(), which returns only the fields the Owner allowed (the name, the phone shown as its first three digits and X's, the outcome word, the reason). An erased person leaves nothing.
-- Events are queued by triggers on leads, integrations.missed_calls and outcomes, and by the worker's low-balance scan, ONLY for a channel that asked for that event. A failure to queue never fails the lead,
-- the call or the outcome. The worker claims due rows (notify_deliveries_claim: at most 20 messages a minute and 300 an hour per channel, over that a message is dropped as rate_limited; more than 5 new-lead
-- messages a minute are collapsed into one "N more new leads" message), sends them through the API's guarded client, and tells the database the result (notify_delivery_record). A message is tried once and
-- again after 1 minute, 5 minutes and 30 minutes (the API's schedule); then it is failed and the channel shows a Problem with a closed reason.
-- Nothing is queued or sent unless the API runs with NOTIFY_OUT=on (the kill switch: the routes answer 404 and the worker sends nothing).

create table public.notify_channels (
  id                      uuid primary key default gen_random_uuid(),
  tenant_id               uuid not null references public.tenants (id),
  kind                    text not null check (kind in ('slack', 'telegram', 'teams')),
  label                   text not null default '' check (char_length(label) <= 60 and app.text_is_clean(label)),
  last4                   text not null default '' check (last4 ~ '^[A-Za-z0-9]{0,4}$'),
  events                  text[] not null default '{}' check (events <@ array['new_lead', 'missed_call', 'call_outcome', 'low_balance']),
  events_chosen           boolean not null default false,
  fields                  text[] not null default array['name', 'phone_masked', 'outcome'] check (fields <@ array['name', 'phone_masked', 'outcome', 'reason']),
  language                text not null default 'en' check (language in ('en', 'te', 'hi', 'kn')),
  test_passed_at          timestamptz,
  last_sent_at            timestamptz,
  last_attempt_at         timestamptz,
  problem_reason          text check (problem_reason in ('bad_address', 'rejected', 'rate_limited', 'timeout', 'refused', 'tls', 'server', 'blocked', 'no_secret', 'redirect')),
  low_balance_notified_at timestamptz,
  created_by              uuid not null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, kind)
);
comment on table public.notify_channels is 'A workspace''s Slack, Telegram or Teams channel. Written only by notify_channel_put / _delete / _test_result (Owner or Admin). The address or token is NOT stored here (Secret Manager).';
comment on column public.notify_channels.kind is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';
comment on column public.notify_channels.label is 'SAFE: a name the Owner gives the connection (for example a channel name); no personal data is asked for. Shown to the Owner and Admin and read by every member on the card.';
comment on column public.notify_channels.last4 is 'SAFE: the last four characters of the address or token, to tell two connections apart. CLEAN-EXEMPT: strict anchored pattern';
comment on column public.notify_channels.events is 'SAFE: the events the Owner chose. CLEAN-EXEMPT: closed CHECK list';
comment on column public.notify_channels.fields is 'SAFE: the fields the Owner allowed in a message. CLEAN-EXEMPT: closed CHECK list';
comment on column public.notify_channels.language is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';
comment on column public.notify_channels.problem_reason is 'SAFE: a closed word for what went wrong (never the other side''s text). CLEAN-EXEMPT: closed CHECK list';
alter table public.notify_channels enable row level security;
alter table public.notify_channels force row level security;
revoke all on public.notify_channels from public, anon, authenticated, service_role;
create trigger notify_channels_forbid_tenant_id_change before update on public.notify_channels for each row execute function app.forbid_tenant_id_change();
create trigger audit_notify_channels after insert or update or delete on public.notify_channels for each row execute function app.audit_row_change('notify_channel', '');
grant select on public.notify_channels to authenticated;
create policy notify_channels_select on public.notify_channels for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create index notify_channels_tenant on public.notify_channels (tenant_id, created_at desc, id desc);

create table public.notify_deliveries (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants (id),
  channel_id      uuid not null,
  event           text not null check (event in ('new_lead', 'missed_call', 'call_outcome', 'low_balance', 'new_lead_summary')),
  subject_kind    text not null check (subject_kind in ('lead', 'missed_call', 'outcome', 'balance', 'summary')),
  subject_id      uuid,
  more            integer not null default 0 check (more between 0 and 100000),
  status          text not null default 'pending' check (status in ('pending', 'retrying', 'sent', 'failed', 'rate_limited', 'collapsed', 'skipped')),
  attempts        integer not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default app.outbox_now(),
  claimed_until   timestamptz,
  last_error      text check (last_error in ('bad_address', 'rejected', 'rate_limited', 'timeout', 'refused', 'tls', 'server', 'blocked', 'no_secret', 'redirect')),
  created_at      timestamptz not null default now(),
  sent_at         timestamptz,
  foreign key (tenant_id, channel_id) references public.notify_channels (tenant_id, id),
  check ((status = 'sent') = (sent_at is not null))
);
comment on table public.notify_deliveries is 'One notification: which event, about which row (an id), and where it stands. No text and no personal data: the text is built when it is sent. Kept 30 days.';
comment on column public.notify_deliveries.event is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';
comment on column public.notify_deliveries.subject_kind is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';
comment on column public.notify_deliveries.status is 'SAFE: closed list. CLEAN-EXEMPT: closed CHECK list';
comment on column public.notify_deliveries.last_error is 'SAFE: a closed word for what went wrong (never the other side''s text). CLEAN-EXEMPT: closed CHECK list';
alter table public.notify_deliveries enable row level security;
alter table public.notify_deliveries force row level security;
revoke all on public.notify_deliveries from public, anon, authenticated, service_role;
create trigger notify_deliveries_forbid_tenant_id_change before update on public.notify_deliveries for each row execute function app.forbid_tenant_id_change();
create trigger audit_notify_deliveries after insert or update or delete on public.notify_deliveries for each row execute function app.audit_row_change('notify_delivery', '');
grant select on public.notify_deliveries to authenticated;
create policy notify_deliveries_select on public.notify_deliveries for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create index notify_deliveries_log on public.notify_deliveries (tenant_id, channel_id, created_at desc, id desc);
create index notify_deliveries_due on public.notify_deliveries (tenant_id, next_attempt_at) where status in ('pending', 'retrying');

-- ---------------------------------------------------------------------------------------------------------------- the phone as a message may show it
-- First three digits then X's ("+91 987XXXXXXX"). A number that is too short to be one shows nothing.
create function app.notify_mask_phone(p text) returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  d text := regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g');
begin
  if char_length(d) < 7 then
    return null;
  elsif d like '91%' and char_length(d) = 12 then
    return '+91 ' || substr(d, 3, 3) || 'XXXXXXX';
  end if;
  return substr(d, 1, 3) || repeat('X', least(char_length(d) - 3, 9));
end;
$$;
revoke all on function app.notify_mask_phone(text) from public;

-- a free sentence of the system's own (an outcome's reason) with every long run of digits and every e-mail address taken out, cut to 140 characters
create function app.notify_scrub(p text) returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[^[:space:]]+@[^[:space:]]+', '', 'g'), '[0-9][0-9 ()+.-]{4,}[0-9]', '', 'g')), 140), '')
$$;
revoke all on function app.notify_scrub(text) from public;

-- ---------------------------------------------------------------------------------------------------------------- queueing (triggers)
-- One delivery per channel that asked for the event. Cheap when the workspace has none; never fails the row that caused it.
create function app.notify_enqueue(p_tenant uuid, p_event text, p_kind text, p_subject uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.notify_channels c where c.tenant_id = p_tenant and p_event = any (c.events)) then
    return;
  end if;
  begin
    insert into public.notify_deliveries (tenant_id, channel_id, event, subject_kind, subject_id, next_attempt_at)
    select c.tenant_id, c.id, p_event, p_kind, p_subject, app.outbox_now()
      from public.notify_channels c where c.tenant_id = p_tenant and p_event = any (c.events);
  exception when others then
    raise warning 'notify enqueue skipped (%)', sqlstate;
  end;
end;
$$;
revoke all on function app.notify_enqueue(uuid, text, text, uuid) from public;

create function app.notify_trg_lead() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not coalesce(new.is_test, false) then
    perform app.notify_enqueue(new.tenant_id, 'new_lead', 'lead', new.id);
  end if;
  return new;
end;
$$;
revoke all on function app.notify_trg_lead() from public;
create trigger notify_lead_created after insert on public.leads for each row execute function app.notify_trg_lead();

create function app.notify_trg_missed() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.notify_enqueue(new.tenant_id, 'missed_call', 'missed_call', new.id);
  return new;
end;
$$;
revoke all on function app.notify_trg_missed() from public;
create trigger notify_missed_call after insert on integrations.missed_calls for each row execute function app.notify_trg_missed();

create function app.notify_trg_outcome() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind = 'call' then
    perform app.notify_enqueue(new.tenant_id, 'call_outcome', 'outcome', new.id);
  end if;
  return new;
end;
$$;
revoke all on function app.notify_trg_outcome() from public;
create trigger notify_outcome_recorded after insert on public.outcomes for each row execute function app.notify_trg_outcome();

-- ---------------------------------------------------------------------------------------------------------------- what a message may say (built when it is sent)
-- ONLY the fields the Owner allowed, each in its closed shape: `name` (the contact's name as stored, 60 characters), `phone_masked` (app.notify_mask_phone; a caller who is not a contact shows only
-- "XXXXXXX" and the last four digits), `outcome` (the outcome and category words) and `reason` (the outcome's sentence with digit runs and e-mail addresses taken out). Never a full number, an address, a
-- transcript or an amount. {gone: true} when what it was about is gone.
create function app.notify_event_data(p_event text, p_kind text, p_subject uuid, p_tenant uuid, p_fields text[]) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l public.leads;
  m integrations.missed_calls;
  o public.outcomes;
  c public.contacts;
  v_contact uuid;
  v jsonb := '{}'::jsonb;
begin
  if p_kind in ('balance', 'summary') then
    return v;
  end if;
  if p_kind = 'lead' then
    select * into l from public.leads x where x.tenant_id = p_tenant and x.id = p_subject;
    if not found then
      return jsonb_build_object('gone', true);
    end if;
    v_contact := l.contact_id;
  elsif p_kind = 'missed_call' then
    select * into m from integrations.missed_calls x where x.tenant_id = p_tenant and x.id = p_subject;
    if not found then
      return jsonb_build_object('gone', true);
    end if;
    select l2.contact_id into v_contact from public.leads l2 where l2.tenant_id = p_tenant and l2.id = m.lead_id;
    v_contact := coalesce(v_contact, m.contact_id);
  elsif p_kind = 'outcome' then
    select * into o from public.outcomes x where x.tenant_id = p_tenant and x.id = p_subject;
    if not found then
      return jsonb_build_object('gone', true);
    end if;
    select l2.contact_id into v_contact from public.leads l2 where l2.tenant_id = p_tenant and l2.id = o.lead_id;
    v_contact := coalesce(v_contact, o.contact_id);
  else
    return jsonb_build_object('gone', true);
  end if;
  if v_contact is not null then
    select * into c from public.contacts x where x.tenant_id = p_tenant and x.id = v_contact;
  end if;
  if 'name' = any (p_fields) and c.id is not null and nullif(btrim(c.full_name), '') is not null then
    v := v || jsonb_build_object('name', left(btrim(c.full_name), 60));
  end if;
  if 'phone_masked' = any (p_fields) then
    if c.id is not null and app.notify_mask_phone(c.phone) is not null then
      v := v || jsonb_build_object('phone_masked', app.notify_mask_phone(c.phone));
    elsif p_kind = 'missed_call' and m.caller_last4 ~ '^[0-9]{4}$' then
      v := v || jsonb_build_object('phone_masked', 'XXXXXXX' || m.caller_last4);
    end if;
  end if;
  if p_kind = 'outcome' then
    if 'outcome' = any (p_fields) then
      v := v || jsonb_build_object('outcome', o.outcome, 'category', o.category);
    end if;
    if 'reason' = any (p_fields) and app.notify_scrub(o.reason) is not null then
      v := v || jsonb_build_object('reason', app.notify_scrub(o.reason));
    end if;
  end if;
  return v;
end;
$$;
revoke all on function app.notify_event_data(text, text, uuid, uuid, text[]) from public;

-- ---------------------------------------------------------------------------------------------------------------- the channel as shown (no address, no token: only the last four)
create function app.notify_channel_json(c public.notify_channels) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('kind', c.kind, 'state', 'connected', 'label', c.label, 'last4', c.last4, 'events', to_jsonb(c.events), 'fields', to_jsonb(c.fields), 'language', c.language,
                            'test_passed', c.test_passed_at is not null,
                            'health', jsonb_build_object('status', case when c.problem_reason is not null then 'problem' when c.last_sent_at is null then 'never_sent' else 'ok' end,
                                                         'reason', c.problem_reason, 'last_sent_at', c.last_sent_at),
                            'counts_24h', jsonb_build_object(
                               'sent', (select count(*) from public.notify_deliveries d where d.tenant_id = c.tenant_id and d.channel_id = c.id and d.status = 'sent' and d.created_at > now() - interval '24 hours'),
                               'failed', (select count(*) from public.notify_deliveries d where d.tenant_id = c.tenant_id and d.channel_id = c.id and d.status = 'failed' and d.created_at > now() - interval '24 hours'),
                               'rate_limited', (select count(*) from public.notify_deliveries d where d.tenant_id = c.tenant_id and d.channel_id = c.id and d.status in ('rate_limited', 'collapsed') and d.created_at > now() - interval '24 hours')))
$$;
revoke all on function app.notify_channel_json(public.notify_channels) from public;

-- ---------------------------------------------------------------------------------------------------------------- Connectors (any member reads the state; Owner and Admin change it)
create function public.notify_channels_list(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(app.notify_channel_json(c) order by c.kind) from public.notify_channels c where c.tenant_id = p_tenant_id), '[]'::jsonb);
end;
$$;

-- Connect or change one channel. A new secret (p_last4 not null) makes the channel untested again: its events stay as chosen (none until the first Test passes, unless the Owner chose some).
-- p_events null = leave as is; p_fields null = leave as is. The secret itself was written by the API to Secret Manager before this call.
create function public.notify_channel_put(p_tenant_id uuid, p_kind text, p_label text, p_last4 text, p_events text[], p_fields text[], p_language text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.notify_channels;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  begin
    insert into public.notify_channels as c (tenant_id, kind, label, last4, events, events_chosen, fields, language, created_by)
    values (p_tenant_id, p_kind, coalesce(p_label, ''), coalesce(p_last4, ''), coalesce((select array_agg(distinct s order by s) from unnest(p_events) s), '{}'), p_events is not null,
            coalesce((select array_agg(distinct s order by s) from unnest(p_fields) s), array['name', 'phone_masked', 'outcome']), coalesce(p_language, 'en'), auth.uid())
    on conflict (tenant_id, kind) do update set
      label = coalesce(p_label, c.label),
      last4 = coalesce(p_last4, c.last4),
      events = coalesce((select array_agg(distinct s order by s) from unnest(p_events) s), case when p_events is not null then '{}'::text[] end, c.events),
      events_chosen = c.events_chosen or p_events is not null,
      fields = coalesce((select array_agg(distinct s order by s) from unnest(p_fields) s), c.fields),
      language = coalesce(p_language, c.language),
      test_passed_at = case when p_last4 is not null then null else c.test_passed_at end,
      problem_reason = case when p_last4 is not null then null else c.problem_reason end,
      updated_at = now()
    returning * into v;
  exception when invalid_text_representation or check_violation or not_null_violation then
    raise exception 'invalid input' using errcode = '22023';
  end;
  return app.notify_channel_json(v);
end;
$$;

-- the channel and its log go (the API then removes the secret). false: no such channel
create function public.notify_channel_delete(p_tenant_id uuid, p_kind text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from public.notify_deliveries d where d.tenant_id = p_tenant_id and d.channel_id in (select c.id from public.notify_channels c where c.tenant_id = p_tenant_id and c.kind = p_kind);
  delete from public.notify_channels c where c.tenant_id = p_tenant_id and c.kind = p_kind;
  return found;
end;
$$;

-- What the API's Test message found (it sends the one fixed line itself, at once). A pass records the time and, the first time and when the Owner has chosen no events, switches the four events on.
-- null: no such channel
create function public.notify_channel_test_result(p_tenant_id uuid, p_kind text, p_ok boolean, p_reason text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.notify_channels;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_ok is null or (p_reason is not null and p_reason not in ('bad_address', 'rejected', 'rate_limited', 'timeout', 'refused', 'tls', 'server', 'blocked', 'no_secret', 'redirect')) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if p_ok then
    update public.notify_channels c set test_passed_at = now(), last_sent_at = now(), last_attempt_at = now(), problem_reason = null,
           events = case when c.events_chosen then c.events else array['call_outcome', 'low_balance', 'missed_call', 'new_lead'] end, updated_at = now()
     where c.tenant_id = p_tenant_id and c.kind = p_kind returning * into v;
  else
    update public.notify_channels c set last_attempt_at = now(), problem_reason = coalesce(p_reason, 'rejected'), updated_at = now()
     where c.tenant_id = p_tenant_id and c.kind = p_kind returning * into v;
  end if;
  return case when v.id is null then null else app.notify_channel_json(v) end;
end;
$$;

-- ---------------------------------------------------------------------------------------------------------------- the worker (the registered scheduler account)
-- Due deliveries, leased for 3 minutes (a crashed worker's rows come back), each with the text's data built from the live rows. Per channel at most 20 messages a minute and 300 an hour: a message over that
-- is closed as rate_limited. A new-lead message beyond the 5th in a minute is closed as collapsed and counted into ONE new_lead_summary message ("N more new leads", sent on the next tick). A row about
-- something that is gone is closed as skipped.
create function public.notify_deliveries_claim(p_limit integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now    timestamptz := app.outbox_now();
  r        record;
  v_counts jsonb := '{}'::jsonb;
  v_more   jsonb := '{}'::jsonb;
  v_out    jsonb := '[]'::jsonb;
  v_c      jsonb;
  v_key    text;
  v_data   jsonb;
  k        text;
  n        integer;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    perform app.scheduler_error('invalid');
  end if;
  for r in
    select d.id, d.tenant_id, d.channel_id, d.event, d.subject_kind, d.subject_id, d.attempts, d.more, d.created_at, c.kind as channel_kind, c.fields, c.language
      from public.notify_deliveries d
      join public.notify_channels c on c.tenant_id = d.tenant_id and c.id = d.channel_id
     where d.status in ('pending', 'retrying') and d.next_attempt_at <= v_now and (d.claimed_until is null or d.claimed_until < v_now)
     order by d.next_attempt_at, d.id
     limit p_limit
       for update of d skip locked
  loop
    v_key := r.channel_id::text;
    v_c := v_counts -> v_key;
    if v_c is null then
      v_c := jsonb_build_object(
        'm', (select count(*) from public.notify_deliveries x where x.channel_id = r.channel_id and x.status = 'sent' and x.sent_at > v_now - interval '1 minute'),
        'h', (select count(*) from public.notify_deliveries x where x.channel_id = r.channel_id and x.status = 'sent' and x.sent_at > v_now - interval '1 hour'),
        'l', (select count(*) from public.notify_deliveries x where x.channel_id = r.channel_id and x.status = 'sent' and x.event = 'new_lead' and x.sent_at > v_now - interval '1 minute'));
    end if;
    if (v_c ->> 'm')::integer >= 20 or (v_c ->> 'h')::integer >= 300 then
      update public.notify_deliveries set status = 'rate_limited', last_error = 'rate_limited', claimed_until = null where id = r.id;
      continue;
    end if;
    if r.event = 'new_lead' and (v_c ->> 'l')::integer >= 5 then
      update public.notify_deliveries set status = 'collapsed', claimed_until = null where id = r.id;
      v_more := jsonb_set(v_more, array[v_key], to_jsonb(coalesce((v_more ->> v_key)::integer, 0) + 1), true);
      continue;
    end if;
    v_data := app.notify_event_data(r.event, r.subject_kind, r.subject_id, r.tenant_id, r.fields);
    if v_data ? 'gone' then
      update public.notify_deliveries set status = 'skipped', claimed_until = null where id = r.id;
      continue;
    end if;
    update public.notify_deliveries set claimed_until = v_now + interval '3 minutes' where id = r.id;
    v_counts := jsonb_set(v_counts, array[v_key], jsonb_build_object('m', (v_c ->> 'm')::integer + 1, 'h', (v_c ->> 'h')::integer + 1,
                                                                   'l', (v_c ->> 'l')::integer + case when r.event = 'new_lead' then 1 else 0 end), true);
    v_out := v_out || jsonb_build_array(jsonb_build_object('id', r.id, 'tenant_id', r.tenant_id, 'channel_id', r.channel_id, 'kind', r.channel_kind, 'event', r.event, 'attempts', r.attempts,
                                                           'language', r.language, 'more', r.more, 'created_at', r.created_at, 'data', v_data));
  end loop;
  for k, n in select e.key, e.value::integer from jsonb_each_text(v_more) e loop
    update public.notify_deliveries d set more = least(d.more + n, 100000)
     where d.channel_id = k::uuid and d.event = 'new_lead_summary' and d.status in ('pending', 'retrying') and d.claimed_until is null;
    if not found then
      insert into public.notify_deliveries (tenant_id, channel_id, event, subject_kind, more, next_attempt_at)
      select c.tenant_id, c.id, 'new_lead_summary', 'summary', least(n, 100000), v_now from public.notify_channels c where c.id = k::uuid;
    end if;
  end loop;
  return v_out;
end;
$$;

-- The result of one attempt. ok: sent. Not ok with p_retry_in_s: retry then (1 s to 24 h). Not ok without it: failed (the channel shows the Problem). Answers {state}. A row that is not waiting any more
-- (already recorded, or its channel removed) answers gone.
create function public.notify_delivery_record(p_id uuid, p_ok boolean, p_reason text, p_retry_in_s integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.notify_deliveries;
  v_now timestamptz := app.outbox_now();
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  if p_ok is null or (p_retry_in_s is not null and p_retry_in_s not between 1 and 86400)
     or (p_reason is not null and p_reason not in ('bad_address', 'rejected', 'rate_limited', 'timeout', 'refused', 'tls', 'server', 'blocked', 'no_secret', 'redirect')) then
    perform app.scheduler_error('invalid');
  end if;
  select * into d from public.notify_deliveries x where x.id = p_id for update;
  if not found or d.status not in ('pending', 'retrying') then
    return jsonb_build_object('state', 'gone');
  end if;
  if p_ok then
    update public.notify_deliveries set status = 'sent', attempts = d.attempts + 1, sent_at = v_now, claimed_until = null, last_error = null where id = d.id;
    update public.notify_channels set last_sent_at = v_now, last_attempt_at = v_now, problem_reason = null where tenant_id = d.tenant_id and id = d.channel_id;
    return jsonb_build_object('state', 'sent');
  end if;
  if p_retry_in_s is not null then
    update public.notify_deliveries set status = 'retrying', attempts = d.attempts + 1, next_attempt_at = v_now + make_interval(secs => p_retry_in_s), claimed_until = null,
           last_error = coalesce(p_reason, 'rejected') where id = d.id;
    update public.notify_channels set last_attempt_at = v_now where tenant_id = d.tenant_id and id = d.channel_id;
    return jsonb_build_object('state', 'retrying');
  end if;
  update public.notify_deliveries set status = 'failed', attempts = d.attempts + 1, claimed_until = null, last_error = coalesce(p_reason, 'rejected') where id = d.id;
  update public.notify_channels set last_attempt_at = v_now, problem_reason = coalesce(p_reason, 'rejected') where tenant_id = d.tenant_id and id = d.channel_id;
  return jsonb_build_object('state', 'failed');
end;
$$;

-- The low-balance event (the balance is a state, not an event): for each channel that asked for it, ONE message when the workspace becomes low (pricing.is_low, the same test as Today's
-- "balance is low" item), and again only after it has been topped up and run low once more. Answers how many were queued.
create function public.notify_scan_low_balance() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.notify_channels;
  v_low boolean;
  v_n integer := 0;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  for c in select * from public.notify_channels x where 'low_balance' = any (x.events) loop
    begin
      v_low := pricing.is_low(c.tenant_id);
    exception when others then
      v_low := null;
    end;
    if v_low is true and c.low_balance_notified_at is null then
      insert into public.notify_deliveries (tenant_id, channel_id, event, subject_kind, next_attempt_at) values (c.tenant_id, c.id, 'low_balance', 'balance', app.outbox_now());
      update public.notify_channels set low_balance_notified_at = now() where id = c.id;
      v_n := v_n + 1;
    elsif v_low is false and c.low_balance_notified_at is not null then
      update public.notify_channels set low_balance_notified_at = null where id = c.id;
    end if;
  end loop;
  return jsonb_build_object('queued', v_n);
end;
$$;

-- the log is kept 30 days
create function public.notify_purge() returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  delete from public.notify_deliveries d where d.created_at < now() - interval '30 days';
  get diagnostics v_n = row_count;
  return jsonb_build_object('deliveries', v_n);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.notify_channels_list(uuid)', 'public.notify_channel_put(uuid, text, text, text, text[], text[], text)', 'public.notify_channel_delete(uuid, text)',
                           'public.notify_channel_test_result(uuid, text, boolean, text)', 'public.notify_deliveries_claim(integer)', 'public.notify_delivery_record(uuid, boolean, text, integer)',
                           'public.notify_scan_low_balance()', 'public.notify_purge()'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
