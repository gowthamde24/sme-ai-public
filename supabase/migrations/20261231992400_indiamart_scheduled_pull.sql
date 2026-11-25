-- IndiaMART scheduled pull (connectors plan, C1 item 5; 25 Nov 2026). Until now a business pulled its IndiaMART leads by pressing a button. The worker now does it by itself for every business that saved its OWN key (Secret Manager,
-- kind indiamart_key) and has an active IndiaMART source, once the real-data gate of that business is open. The worker switch is INDIAMART_PULL (off by default); this migration only gives it the database side.
--
--   * integrations.pull_state gets `key_state` (ok | expired) and `key_state_at`: what the last attempt learned about the key. IndiaMART keys last 7 days; a key IndiaMART refuses (or a saved key that cannot be found) is `expired`,
--     and the worker leaves it alone (one look every 6 hours) until a NEW key is saved (public.workspace_secrets.set_at is newer than key_state_at), so a refused key is never hammered (a key is blocked for 15 minutes after more than 5 calls a minute).
--   * public.scheduler_indiamart_links   which businesses are due now (at most p_limit), with where their key is kept (the NAME in Secret Manager, never the key) and their consent confirmation
--   * public.scheduler_indiamart_begin   the window to ask for (from five minutes before the end of the last good pull, else the last 24 hours, never beyond 7 days) and the stamp of this attempt; a second attempt inside 5 minutes gets `too_soon`
--   * public.scheduler_indiamart_apply   the buyers through the same intake core as every source (consent, DND mark, opt-outs, the real-data gate; the same buyer twice = one lead, by IndiaMART's own query id), then the window moves on
--   * public.scheduler_indiamart_key_state   the worker's word on the key
--   * public.indiamart_pull_status       what the Lead sources card shows (Owner, Admin): the key state and the last pull. A key pasted after the state was written reads as ok at once.
-- The functions answer 42501 to anyone but the registered worker account (app.is_scheduler()); no key and no lead text is stored or logged here. SQLSTATEs as in app.connector_error.

alter table integrations.pull_state
  add column key_state    text check (key_state in ('ok', 'expired')),
  add column key_state_at timestamptz;
comment on column integrations.pull_state.key_state is 'SAFE: a closed word (ok | expired), what the last scheduled attempt learned about the workspace''s own IndiaMART key. CLEAN-EXEMPT: closed CHECK list';
comment on column integrations.pull_state.key_state_at is 'SAFE: when key_state was written.';

create function app.indiamart_scheduler_gate() returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_scheduler() then
    perform app.connector_error('deny');
  end if;
end;
$$;
revoke all on function app.indiamart_scheduler_gate() from public, anon, authenticated, service_role;

-- the businesses that are due: an active IndiaMART source, a saved own key, real data allowed, not erased, last tried more than 15 minutes ago, and (when the key was refused) a new key or the 6 hour look
create function public.scheduler_indiamart_links(p_limit integer default 5) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.indiamart_scheduler_gate();
  if p_limit is null or p_limit not between 1 and 50 then
    perform app.connector_error('invalid');
  end if;
  return coalesce((select jsonb_agg(x.j order by x.at, x.tenant_id) from (
    select s.tenant_id, coalesce(p.last_attempt_at, '-infinity'::timestamptz) as at,
           jsonb_build_object(
             'tenant_id', s.tenant_id,
             'secret_name', w.secret_name,
             'consent_id', (select k.id from public.lead_consents k where k.tenant_id = s.tenant_id and k.source_id = s.id order by k.confirmed_at desc, k.id limit 1)) as j
      from public.lead_sources s
      join public.workspace_secrets w on w.tenant_id = s.tenant_id and w.kind = 'indiamart_key'
      left join integrations.pull_state p on p.tenant_id = s.tenant_id and p.source = 'indiamart'
     where s.kind = 'indiamart' and s.status = 'active'
       and app.real_data_gate_open(s.tenant_id)
       and not exists (select 1 from public.erasure_requests e where e.tenant_id = s.tenant_id and e.scope = 'tenant' and e.status = 'executed')
       and (p.last_attempt_at is null or p.last_attempt_at < app.outbox_now() - interval '15 minutes')
       and (p.key_state is distinct from 'expired' or w.set_at > p.key_state_at or p.key_state_at < app.outbox_now() - interval '6 hours')
     order by coalesce(p.last_attempt_at, '-infinity'::timestamptz), s.tenant_id
     limit p_limit) x), '[]'::jsonb);
end;
$$;

create function public.scheduler_indiamart_begin(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now   timestamptz := app.outbox_now();
  s       integrations.pull_state;
  v_start timestamptz;
begin
  perform app.indiamart_scheduler_gate();
  if p_tenant_id is null then
    perform app.connector_error('invalid');
  end if;
  if not exists (select 1 from public.lead_sources x where x.tenant_id = p_tenant_id and x.kind = 'indiamart' and x.status = 'active') then
    return jsonb_build_object('status', 'off');
  end if;
  insert into integrations.pull_state (tenant_id, source) values (p_tenant_id, 'indiamart') on conflict do nothing;
  select * into s from integrations.pull_state x where x.tenant_id = p_tenant_id and x.source = 'indiamart' for update;
  if s.last_attempt_at is not null and s.last_attempt_at > v_now - interval '5 minutes' then
    return jsonb_build_object('status', 'too_soon');
  end if;
  v_start := greatest(coalesce(s.last_end - interval '5 minutes', v_now - interval '24 hours'), v_now - interval '7 days');
  update integrations.pull_state set last_attempt_at = v_now where tenant_id = p_tenant_id and source = 'indiamart';
  return jsonb_build_object('status', 'ok', 'start', v_start, 'end', v_now);
end;
$$;

-- the buyers of one window. The window moves on unless a buyer was refused for a reason a later try can fix (`blocked`: the real-data gate closed meanwhile); a buyer IndiaMART sent with a number we cannot read is counted as invalid and not asked for again.
create function public.scheduler_indiamart_apply(p_tenant_id uuid, p_rows jsonb, p_end timestamptz, p_fetched integer) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source  uuid;
  v_consent uuid;
  v_result  jsonb;
  v_counts  jsonb := jsonb_build_object('ready', 0, 'duplicates_merged', 0, 'already_imported', 0, 'invalid', 0, 'dnd', 0, 'no_consent', 0, 'blocked', 0);
  v_sha     text;
begin
  perform app.indiamart_scheduler_gate();
  if p_tenant_id is null or p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 or octet_length(p_rows::text) > 1048576
     or p_end is null or p_end > app.outbox_now() + interval '1 minute' or p_fetched is null or p_fetched not between 0 and 100000 then
    perform app.connector_error('invalid');
  end if;
  select s.id into v_source from public.lead_sources s where s.tenant_id = p_tenant_id and s.kind = 'indiamart' and s.status = 'active' limit 1;
  if v_source is null then
    return jsonb_build_object('status', 'off');
  end if;
  select k.id into v_consent from public.lead_consents k where k.tenant_id = p_tenant_id and k.source_id = v_source order by k.confirmed_at desc, k.id limit 1;
  perform pg_advisory_xact_lock(hashtextextended('lead_intake:' || p_tenant_id::text, 0));
  if jsonb_array_length(p_rows) > 0 then
    v_result := app.lead_intake_core(p_tenant_id, null, 'indiamart', v_consent, p_rows, false);
    v_counts := v_result -> 'counts';
    v_sha := encode(sha256(convert_to(p_rows::text || 'indiamart' || coalesce(v_consent::text, ''), 'UTF8')), 'hex');
    insert into public.lead_intakes (id, tenant_id, import_id, part, kind, source_tag, consent_id, content_sha, rows_read, counts, problems, created_by)
    values (gen_random_uuid(), p_tenant_id, md5('indiamart-pull:' || p_tenant_id::text || ':' || p_end::text)::uuid, 1, 'indiamart', 'indiamart', v_consent, v_sha, jsonb_array_length(p_rows), v_counts, v_result -> 'problems', auth.uid())
    on conflict (tenant_id, import_id, part) do nothing;
  end if;
  if coalesce((v_counts ->> 'blocked')::integer, 0) = 0 then
    update integrations.pull_state set last_end = greatest(coalesce(last_end, p_end), p_end), last_count = p_fetched where tenant_id = p_tenant_id and source = 'indiamart';
  end if;
  update integrations.pull_state set key_state = 'ok', key_state_at = app.outbox_now() where tenant_id = p_tenant_id and source = 'indiamart';
  return jsonb_build_object('status', 'done', 'counts', v_counts);
end;
$$;

create function public.scheduler_indiamart_key_state(p_tenant_id uuid, p_state text) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.indiamart_scheduler_gate();
  if p_tenant_id is null or p_state is null or p_state not in ('ok', 'expired') then
    perform app.connector_error('invalid');
  end if;
  update integrations.pull_state set key_state = p_state, key_state_at = app.outbox_now() where tenant_id = p_tenant_id and source = 'indiamart';
  return found;
end;
$$;

create function public.indiamart_pull_status(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s integrations.pull_state;
  w public.workspace_secrets;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.connector_error('deny');
  end if;
  select * into s from integrations.pull_state x where x.tenant_id = p_tenant_id and x.source = 'indiamart';
  select * into w from public.workspace_secrets y where y.tenant_id = p_tenant_id and y.kind = 'indiamart_key';
  return jsonb_build_object(
    'key_state', case when s.key_state is null or w.id is null then null when s.key_state = 'expired' and w.set_at > s.key_state_at then 'ok' else s.key_state end,
    'key_state_at', s.key_state_at, 'last_end', s.last_end, 'last_count', s.last_count, 'last_attempt_at', s.last_attempt_at);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.scheduler_indiamart_links(integer)', 'public.scheduler_indiamart_begin(uuid)', 'public.scheduler_indiamart_apply(uuid, jsonb, timestamptz, integer)',
                           'public.scheduler_indiamart_key_state(uuid, text)', 'public.indiamart_pull_status(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
