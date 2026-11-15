-- Meta consent AT ARRIVAL (owner decision, 15 Nov 2026) and the unparsed-mail purge.
-- 1. The consent logic of scheduler_lead_meta_consent becomes an internal function; the live door calls it in the SAME transaction as the lead, so a ticked v2 lead is stored with its consent
--    and the intake line says ready (not no_consent). The older worker door stays (it is idempotent) for a replay of an old lead.
create function app.meta_consent_apply(p_tenant uuid, p_item jsonb) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ext      text := left(btrim(coalesce(p_item ->> 'leadgen_id', '')), 30);
  v_form     text := left(btrim(coalesce(p_item ->> 'form_id', '')), 30);
  v_lead     uuid;
  v_contact  public.contacts;
  v_ticked   boolean;
  v_ref      text;
  v_channel  public.consent_channel;
  v_current  public.consent_status;
  v_new      integer;
begin
  if v_ext !~ '^[0-9]{1,30}$' or v_form !~ '^[0-9]{1,30}$' then
    return 'skip';
  end if;
  select i.lead_id into v_lead from integrations.lead_items i where i.tenant_id = p_tenant and i.source_tag = 'meta_lead_ads' and i.external_id = v_ext;
  if v_lead is null then
    return 'skip';
  end if;
  select k.* into v_contact from public.leads l join public.contacts k on k.tenant_id = l.tenant_id and k.id = l.contact_id where l.tenant_id = p_tenant and l.id = v_lead;
  if not found then
    return 'skip';
  end if;
  v_ticked := case when jsonb_typeof(p_item -> 'ticked') = 'boolean' then (p_item ->> 'ticked')::boolean else null end;
  insert into public.lead_consent_evidence (tenant_id, lead_id, contact_id, source_tag, form_id, leadgen_id, disclaimer_text, checkbox_key, ticked)
  values (p_tenant, v_lead, v_contact.id, 'meta_lead_ads', v_form, v_ext, app.lead_clean_text(p_item ->> 'disclaimer', 800),
          case when coalesce(p_item ->> 'checkbox_key', '') ~ '^[A-Za-z0-9_.-]{1,60}$' then p_item ->> 'checkbox_key' else null end, v_ticked)
  on conflict (tenant_id, source_tag, leadgen_id) do nothing;
  get diagnostics v_new = row_count;
  if v_new = 0 then
    return 'replay';
  end if;
  if v_ticked is true and v_contact.suppressed_at is null and v_contact.erased_at is null then
    v_ref := 'meta_form:' || v_form || '-' || v_ext;
    foreach v_channel in array array['phone', 'whatsapp']::public.consent_channel[] loop
      v_current := case v_channel when 'phone' then v_contact.phone_consent else v_contact.whatsapp_consent end;
      continue when v_current = 'granted';
      if v_channel = 'phone' then
        update public.contacts set phone_consent = 'granted' where id = v_contact.id;
      else
        update public.contacts set whatsapp_consent = 'granted' where id = v_contact.id;
      end if;
      insert into public.consent_events (tenant_id, contact_id, event_type, channel, basis, evidence_type, evidence_ref, recorded_by)
      values (p_tenant, v_contact.id, 'granted', v_channel, 'explicit_consent', 'web_form', v_ref, null);
    end loop;
    return 'granted';
  end if;
  return 'ask';
end;
$$;
revoke all on function app.meta_consent_apply(uuid, jsonb) from public, anon, authenticated;

-- 2. the live door, with the consent applied in the same call (the rest of the function is unchanged)
create or replace function public.scheduler_lead_intake_live(p_token_hash text, p_rows jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.lead_sources;
  v_bucket timestamptz := date_trunc('minute', app.outbox_now());
  v_hits integer;
  v_result jsonb;
  v_consent uuid;
  v_day integer;
  v_item jsonb;
  v_granted integer := 0;
  v_no_consent integer;
begin
  if not app.is_scheduler() then
    perform app.lead_error('deny');
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' or p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) not between 1 and 20 or octet_length(p_rows::text) > 65536 then
    perform app.lead_error('invalid');
  end if;
  select * into s from public.lead_sources x where x.token_hash = p_token_hash and x.status = 'active' for update;
  if not found then
    return jsonb_build_object('status', 'unknown');
  end if;
  insert into integrations.lead_source_hits (source_id, bucket, n) values (s.id, v_bucket, 1)
  on conflict (source_id, bucket) do update set n = integrations.lead_source_hits.n + 1 returning n into v_hits;
  delete from integrations.lead_source_hits where bucket < v_bucket - interval '1 day';
  select coalesce(sum(h.n), 0)::int into v_day from integrations.lead_source_hits h where h.source_id = s.id and h.bucket > v_bucket - interval '1 day';
  if v_hits > 60 or v_day > 2000 then
    return jsonb_build_object('status', 'rate');
  end if;
  select c.id into v_consent from public.lead_consents c where c.tenant_id = s.tenant_id and c.source_id = s.id order by c.confirmed_at desc, c.id limit 1;
  perform pg_advisory_xact_lock(hashtextextended('lead_intake:' || s.tenant_id::text, 0));
  v_result := app.lead_intake_core(s.tenant_id, null, s.tag, v_consent, p_rows, true);
  -- Meta lead forms (owner decision, 15 Nov 2026): a row that carries the form's consent evidence is stored WITH its consent in this same transaction: a ticked required box grants phone and WhatsApp
  -- consent and the arrival counts as `ready` (not `no_consent`); an unticked box or no box leaves the lead `no_consent` (ask first).
  if s.kind = 'meta_lead_ads' then
    for v_item in select e from jsonb_array_elements(p_rows) e where jsonb_typeof(e -> 'consent') = 'object' loop
      if app.meta_consent_apply(s.tenant_id, (v_item -> 'consent') || jsonb_build_object('leadgen_id', v_item ->> 'external_id')) = 'granted' then
        v_granted := v_granted + 1;
      end if;
    end loop;
    if v_granted > 0 then
      v_no_consent := coalesce((v_result -> 'counts' ->> 'no_consent')::int, 0);
      v_result := jsonb_set(v_result, '{counts,no_consent}', to_jsonb(greatest(v_no_consent - v_granted, 0)));
    end if;
  end if;
  update public.lead_sources set last_received_at = app.outbox_now(), received_count = received_count + coalesce((v_result -> 'counts' ->> 'ready')::int, 0) + coalesce((v_result -> 'counts' ->> 'duplicates_merged')::int, 0)
   where id = s.id;
  return jsonb_build_object('status', 'received', 'counts', v_result -> 'counts');
end;
$$;

-- 3. the unparsed-mail purge (owner, 15 Nov 2026: the raw e-mail does not stay): a mail the reader could not understand is kept for the owner to see for 14 days, then its words are removed (the row stays as a count)
create function public.ops_lead_unparsed_purge(p_days integer default 14) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare v_n integer;
begin
  perform ops.system_only();
  if p_days is null or p_days not between 1 and 90 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  update public.lead_unparsed set discarded_at = app.outbox_now(), subject = null, body = 'discarded' where discarded_at is null and received_at < app.outbox_now() - make_interval(days => p_days);
  get diagnostics v_n = row_count;
  return jsonb_build_object('purged', v_n);
end $$;
revoke all on function public.ops_lead_unparsed_purge(integer) from public, anon;
grant execute on function public.ops_lead_unparsed_purge(integer) to authenticated;
