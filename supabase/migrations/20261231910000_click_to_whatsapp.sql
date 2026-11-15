-- Track D slice (owner, 15 Nov 2026): CLICK-TO-WHATSAPP ADS. Someone taps an Instagram/Facebook ad that opens WhatsApp and writes to the business: the WhatsApp Cloud API delivers the message with a `referral`
-- (source_type "ad", the ad's id and headline, a click id). The message already becomes a lead through wa_ingest_inbound; this adds the SOURCE of that lead: an arrival tagged `click_to_whatsapp` (what the Sources
-- cards count) and the ad's headline as the lead's campaign. One arrival per lead and day (a chat is one ad tap, not one arrival per message). The channel principal calls it, with the ad's id, headline and click id
-- only (never the message). Consent basis stays "enquired": a reply about their enquiry, no promotions.

create or replace function app.lead_tag_ok(p text) returns boolean
language sql
immutable
set search_path = ''
as $$ select p = any (array['indiamart', 'justdial', '99acres', 'magicbricks', 'housing', 'meta_lead_ads', 'website_form', 'webhook', 'email_forward', 'excel_upload', 'google_sheet', 'pasted_list', 'vcard', 'lead_finder', 'missed_calls', 'google_ads', 'click_to_whatsapp']) $$;

create function public.wa_ad_referral(p_tenant_id uuid, p_lead_id uuid, p_ad_id text, p_headline text, p_click_id text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact uuid;
  v_arrivals integer;
  v_headline text := nullif(left(regexp_replace(coalesce(p_headline, ''), '[[:cntrl:]]', ' ', 'g'), 120), '');
begin
  if not app.is_channel_agent() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_lead_id is null or (p_ad_id is not null and p_ad_id !~ '^[A-Za-z0-9_.:-]{1,64}$') or (p_click_id is not null and p_click_id !~ '^[A-Za-z0-9_.:-]{1,200}$') then
    raise exception 'invalid' using errcode = '22023';
  end if;
  select l.contact_id into v_contact from public.leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id;
  if v_contact is null then
    return jsonb_build_object('outcome', 'no_lead');
  end if;
  if exists (select 1 from public.lead_arrivals a where a.tenant_id = p_tenant_id and a.lead_id = p_lead_id and a.source_tag = 'click_to_whatsapp' and a.received_at > app.outbox_now() - interval '1 day') then
    return jsonb_build_object('outcome', 'duplicate');
  end if;
  select count(*)::integer into v_arrivals from public.lead_arrivals a where a.tenant_id = p_tenant_id and a.lead_id = p_lead_id;
  insert into public.lead_arrivals (tenant_id, lead_id, contact_id, source_tag, kind, message)
  values (p_tenant_id, p_lead_id, v_contact, 'click_to_whatsapp', case when v_arrivals = 0 then 'first' else 'repeat' end,
          case when v_headline is not null and app.text_is_clean(v_headline) then 'Instagram/Facebook ad: ' || v_headline else 'Instagram/Facebook ad' end);
  if v_headline is not null and app.text_is_clean(v_headline) and not app.text_has_contact(v_headline) then
    update public.lead_profiles set campaign = v_headline where tenant_id = p_tenant_id and lead_id = p_lead_id and campaign is null;
  end if;
  return jsonb_build_object('outcome', 'recorded');
end;
$$;
revoke all on function public.wa_ad_referral(uuid, uuid, text, text, text) from public, anon;
grant execute on function public.wa_ad_referral(uuid, uuid, text, text, text) to authenticated;
