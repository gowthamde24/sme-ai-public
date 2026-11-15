-- Track D slice 2 (owner, 15 Nov 2026): two more sources that reach us by a secret address, like the website form: MISSED CALLS (the phone company calls the address with the caller's number when a call to the business
-- number is missed) and GOOGLE ADS lead forms (the form's webhook). Same door, same hash-only secret; a kind and a tag each. The Test button of ANY card goes through public.lead_source_test_lead: the Owner or Admin
-- sends one test row through the source's real intake (no secret needed: the secret is only shown once) and the lead is marked is_test.

alter table public.lead_sources drop constraint lead_sources_kind_check;
alter table public.lead_sources add constraint lead_sources_kind_check check (kind in ('website_form', 'webhook', 'email_forward', 'meta_lead_ads', 'indiamart', 'missed_calls', 'google_ads'));

create or replace function app.lead_tag_ok(p text) returns boolean
language sql
immutable
set search_path = ''
as $$ select p = any (array['indiamart', 'justdial', '99acres', 'magicbricks', 'housing', 'meta_lead_ads', 'website_form', 'webhook', 'email_forward', 'excel_upload', 'google_sheet', 'pasted_list', 'vcard', 'lead_finder', 'missed_calls', 'google_ads']) $$;

do $patch$
declare
  v_def text := pg_get_functiondef('public.lead_source_create(uuid, uuid, text, text, text, text, text, uuid, jsonb, bigint)'::regprocedure);
  v_new text;
begin
  v_new := replace(v_def, $a$p_kind not in ('website_form', 'webhook', 'email_forward', 'meta_lead_ads', 'indiamart')$a$, $a$p_kind not in ('website_form', 'webhook', 'email_forward', 'meta_lead_ads', 'indiamart', 'missed_calls', 'google_ads')$a$);
  if v_new = v_def then raise exception 'lead_source_create: kind list not found'; end if;
  execute v_new;
end
$patch$;

create function public.lead_source_test_lead(p_tenant_id uuid, p_kind text, p_row jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.lead_sources;
  v_phone text := p_row ->> 'phone';
  v_lead uuid;
  v_result jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('website_form', 'missed_calls', 'google_ads', 'meta_lead_ads', 'email_forward') or p_row is null or jsonb_typeof(p_row) <> 'object'
     or v_phone is null or v_phone !~ '^\+00 99999 [0-9]{5}$' then
    raise exception 'invalid' using errcode = '22023';
  end if;
  select * into s from public.lead_sources x where x.tenant_id = p_tenant_id and x.kind = p_kind and x.status = 'active' order by x.created_at desc limit 1;
  if not found then
    return jsonb_build_object('status', 'unknown', 'lead_id', null);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('lead_intake:' || p_tenant_id::text, 0));
  v_result := app.lead_intake_core(p_tenant_id, null, s.tag, null, jsonb_build_array(p_row), true);
  select l.id into v_lead
    from public.leads l join public.contacts k on k.tenant_id = l.tenant_id and k.id = l.contact_id
   where l.tenant_id = p_tenant_id and app.phone_norm(k.phone) = app.phone_norm(v_phone) and l.created_at > now() - interval '10 minutes'
   order by l.created_at desc limit 1;
  if v_lead is not null then
    update public.leads set is_test = true where tenant_id = p_tenant_id and id = v_lead;
  end if;
  return jsonb_build_object('status', 'received', 'lead_id', v_lead);
end;
$$;
revoke all on function public.lead_source_test_lead(uuid, text, jsonb) from public, anon;
grant execute on function public.lead_source_test_lead(uuid, text, jsonb) to authenticated;
