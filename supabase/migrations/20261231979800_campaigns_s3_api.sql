-- Campaigns S3 (owner-approved plan docs/plans/textiles-campaigns-marketing.md): what the API needs on top of S1 (marketing consent) and S2 (the `offer` kind).
--   * public.marketing_consent_list(...)               who has said yes to offers, who has not been asked, who withdrew: a page of customers, searchable by name, with the counts. Owner, Admin, Sales.
--   * public.campaign_recipients_add_consented(...)    an offer's list built from the customers who GAVE marketing consent (everyone, or those whose name contains the words typed); the date is the occasion's day.
--   * app.campaign_offer_counts                        now also carries the estimated Meta cost (the marketing message rate of the rate card, before GST), for the approval screen.
--   * public.marketing_consent_set                     a customer who said STOP is refused with the contact-suppressed code SM002 (the API has a fixed sentence for it), not a generic 55000.

-- ------------------------------------------------------------------------------------------------------------------------------
-- 1. the refusal for a customer who said STOP
-- ------------------------------------------------------------------------------------------------------------------------------
do $patch$
declare
  v_def text := pg_get_functiondef('public.marketing_consent_set(uuid, uuid, text)'::regprocedure);
  v_old text := $q$raise exception 'this customer asked us to stop' using errcode = '55000';$q$;
  v_new text := $q$raise exception 'this customer asked us to stop' using errcode = 'SM002';$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'marketing_consent_set has changed: the refusal patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

-- ------------------------------------------------------------------------------------------------------------------------------
-- 2. the consent list (a page of customers, by name) with the counts of the whole book
-- ------------------------------------------------------------------------------------------------------------------------------
create function public.marketing_consent_list(p_tenant_id uuid, p_q text default null, p_state text default null, p_limit integer default 50, p_after_name text default null, p_after_id uuid default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q     text := lower(btrim(coalesce(p_q, '')));
  v_items jsonb;
  v_count integer;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    raise exception 'your role cannot read marketing consent' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or char_length(v_q) > 60 or (p_state is not null and p_state not in ('unknown', 'granted', 'withdrawn'))
     or (p_after_name is null) <> (p_after_id is null) then
    raise exception 'invalid marketing consent list request' using errcode = '22023';
  end if;
  with page as (
    select c.id, c.full_name, c.phone, c.marketing_consent, c.marketing_consent_at, c.marketing_consent_via, c.marketing_consent_by, c.marketing_consent_note,
           (c.suppressed_at is not null or c.whatsapp_consent = 'withdrawn') as stopped
      from public.contacts c
     where c.tenant_id = p_tenant_id and c.erased_at is null
       and (p_state is null or c.marketing_consent = p_state)
       and (v_q = '' or position(v_q in lower(coalesce(c.full_name, ''))) > 0)
       and (p_after_id is null or (lower(coalesce(c.full_name, '')), c.id) > (lower(p_after_name), p_after_id))
     order by lower(coalesce(c.full_name, '')), c.id
     limit p_limit + 1)
  select coalesce(jsonb_agg(jsonb_build_object('contact_id', p.id, 'name', p.full_name, 'phone', p.phone, 'state', p.marketing_consent, 'at', p.marketing_consent_at,
                                               'via', p.marketing_consent_via, 'by', p.marketing_consent_by, 'note', p.marketing_consent_note, 'stopped', p.stopped)
                           order by lower(coalesce(p.full_name, '')), p.id), '[]'::jsonb),
         count(*)
    into v_items, v_count
    from (select * from page order by lower(coalesce(full_name, '')), id limit p_limit) p;
  return jsonb_build_object(
    'items', v_items,
    'has_more', (select count(*) from public.contacts c
                  where c.tenant_id = p_tenant_id and c.erased_at is null and (p_state is null or c.marketing_consent = p_state)
                    and (v_q = '' or position(v_q in lower(coalesce(c.full_name, ''))) > 0)
                    and (p_after_id is null or (lower(coalesce(c.full_name, '')), c.id) > (lower(p_after_name), p_after_id))) > v_count,
    'counts', (select jsonb_build_object('granted', count(*) filter (where c.marketing_consent = 'granted'), 'unknown', count(*) filter (where c.marketing_consent = 'unknown'),
                                         'withdrawn', count(*) filter (where c.marketing_consent = 'withdrawn'))
                 from public.contacts c where c.tenant_id = p_tenant_id and c.erased_at is null));
end;
$$;
revoke all on function public.marketing_consent_list(uuid, text, text, integer, text, uuid) from public, anon;
grant execute on function public.marketing_consent_list(uuid, text, text, integer, text, uuid) to authenticated;

-- ------------------------------------------------------------------------------------------------------------------------------
-- 3. an offer's list from the customers who said yes (the same people the approval screen counts as "will receive")
-- ------------------------------------------------------------------------------------------------------------------------------
create function public.campaign_recipients_add_consented(p_tenant_id uuid, p_campaign_id uuid, p_due_date date, p_q text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_q       text := lower(btrim(coalesce(p_q, '')));
  c         public.campaigns;
  k         record;
  v_lead    uuid;
  v_added   integer := 0;
  v_skipped jsonb := '[]'::jsonb;
  v_n       integer := 0;
  v_have    integer;
begin
  if v_uid is null or p_tenant_id is null or p_campaign_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.campaign_error('deny');
  end if;
  perform app.require_module(p_tenant_id, 'campaigns');
  if p_due_date is null or p_due_date not between date '2020-01-01' and date '2100-12-31' or char_length(v_q) > 60 then
    perform app.campaign_error('invalid');
  end if;
  select * into c from public.campaigns x where x.tenant_id = p_tenant_id and x.id = p_campaign_id for update;
  if not found then
    perform app.campaign_error('reference');
  end if;
  if c.kind <> 'offer' then
    perform app.campaign_error('invalid');   -- a consented list is for offers only
  end if;
  perform app.campaign_reset(p_tenant_id, p_campaign_id, 'list_changed');
  select count(*) into v_have from public.campaign_recipients r where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id;
  for k in
    select ct.id from public.contacts ct
     where ct.tenant_id = p_tenant_id and ct.erased_at is null and ct.suppressed_at is null and ct.whatsapp_consent <> 'withdrawn' and ct.marketing_consent = 'granted' and ct.phone is not null
       and (v_q = '' or position(v_q in lower(coalesce(ct.full_name, ''))) > 0)
     order by lower(coalesce(ct.full_name, '')), ct.id
  loop
    v_n := v_n + 1;
    if v_have + v_added >= 5000 then
      v_skipped := v_skipped || jsonb_build_object('row', v_n, 'reason', 'list_full');
      continue;
    end if;
    v_lead := app.campaign_lead_for(p_tenant_id, k.id);
    if v_lead is null then
      v_skipped := v_skipped || jsonb_build_object('row', v_n, 'reason', 'no_lead');
      continue;
    end if;
    begin
      insert into public.campaign_recipients (tenant_id, campaign_id, contact_id, lead_id, due_date, row_hash, created_by)
      values (p_tenant_id, p_campaign_id, k.id, v_lead, p_due_date, encode(sha256(convert_to(concat_ws('|', k.id, p_due_date, '', '', ''), 'UTF8')), 'hex'), v_uid);
      v_added := v_added + 1;
    exception when unique_violation then
      v_skipped := v_skipped || jsonb_build_object('row', v_n, 'reason', 'duplicate');
    end;
  end loop;
  return jsonb_build_object('added', v_added, 'skipped', v_skipped,
                            'recipients', (select count(*) from public.campaign_recipients r where r.tenant_id = p_tenant_id and r.campaign_id = p_campaign_id));
end;
$$;
revoke all on function public.campaign_recipients_add_consented(uuid, uuid, date, text) from public, anon;
grant execute on function public.campaign_recipients_add_consented(uuid, uuid, date, text) to authenticated;

-- ------------------------------------------------------------------------------------------------------------------------------
-- 4. the estimated cost on the approval screen: the marketing message rate of the rate card (an ESTIMATE until Meta's invoice replaces it), before GST.
--    An offer sends one message per step to each customer who will receive it (the weekly cap can only lower that), so this is the most it can cost.
-- ------------------------------------------------------------------------------------------------------------------------------
create or replace function app.campaign_offer_counts(p_tenant uuid, p_campaign uuid) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with n as (
    select count(*) as recipients,
           count(*) filter (where k.marketing_consent = 'granted' and k.suppressed_at is null and k.whatsapp_consent <> 'withdrawn' and k.phone is not null) as will_receive,
           count(*) filter (where k.suppressed_at is not null or k.whatsapp_consent = 'withdrawn') as stopped,
           count(*) filter (where k.suppressed_at is null and k.whatsapp_consent <> 'withdrawn' and k.marketing_consent = 'withdrawn') as marketing_withdrawn,
           count(*) filter (where k.suppressed_at is null and k.whatsapp_consent <> 'withdrawn' and k.marketing_consent = 'unknown') as no_marketing_consent,
           count(*) filter (where k.suppressed_at is null and k.whatsapp_consent <> 'withdrawn' and k.marketing_consent = 'granted' and k.phone is null) as no_whatsapp
      from public.campaign_recipients r join public.contacts k on k.tenant_id = r.tenant_id and k.id = r.contact_id
     where r.tenant_id = p_tenant and r.campaign_id = p_campaign),
  rate as (
    select pr.cost_micro_paise, pr.rate_source
      from ops.provider_rates pr
     where pr.provider = 'meta' and pr.unit = 'message_marketing' and pr.valid_from <= now()
     order by pr.valid_from desc limit 1),
  st as (select greatest(coalesce(jsonb_array_length(c.steps), 0), 1) as steps from public.campaigns c where c.tenant_id = p_tenant and c.id = p_campaign)
  select jsonb_build_object(
    'recipients', n.recipients,
    'will_receive', n.will_receive,
    'left_out', jsonb_build_object('stopped', n.stopped, 'marketing_withdrawn', n.marketing_withdrawn, 'no_marketing_consent', n.no_marketing_consent, 'no_whatsapp', n.no_whatsapp),
    'cost', jsonb_build_object(
      'messages_at_most', n.will_receive * st.steps,
      'paise_each', (select ceil(r.cost_micro_paise / 1000000.0)::bigint from rate r),
      'paise_at_most', (select ceil(n.will_receive * st.steps * r.cost_micro_paise / 1000000.0)::bigint from rate r),
      'rate_source', (select r.rate_source from rate r),
      'before_gst', true))
    from n cross join st
$$;
revoke all on function app.campaign_offer_counts(uuid, uuid) from public, anon, authenticated, service_role;
