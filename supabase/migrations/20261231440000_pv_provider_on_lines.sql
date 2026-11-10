-- Job 3 phase A (the Plivo connector): the PROVIDER and the ACCOUNT of a phone line, and the provider names the call tables accept.
--
--   public.phone_numbers   + provider     which telephony provider the number is rented from: exotel (default: every line so far), plivo, vobiz
--                          + account_ref  the NAME of the Secret Manager secret that holds the account's credentials; null = the platform's own (main) account
--                          + external_ref the provider's own id of the account the number sits in (Plivo: the subaccount's Auth ID); null = the main account. An id, not a secret.
--   public.phone_calls.provider and integrations.webhook_events.provider accept plivo and vobiz (and exotel / sandbox / the old words as before)
--   public.phone_call_begin   accepts the same names; public.phone_line_find also returns provider, account_ref and external_ref (so a call that arrives on one provider's address for a number that belongs
--                             to another provider is refused).
-- ADR 0120 said the call path reads the account from the number's row, never from one global setting; this is that row. Nothing here stores a credential or a person's number.

alter table public.phone_numbers
  add column provider     text not null default 'exotel' check (provider in ('exotel', 'plivo', 'vobiz')),
  add column account_ref  text check (account_ref ~ '^[a-z0-9][a-z0-9-]{2,119}$'),
  add column external_ref text check (external_ref ~ '^[A-Za-z0-9_.-]{3,100}$');
comment on column public.phone_numbers.provider is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.phone_numbers.account_ref is 'SAFE: the name of a Secret Manager secret (never its value). CLEAN-EXEMPT: pattern CHECK, written by the operator only';
comment on column public.phone_numbers.external_ref is 'SAFE: the provider''s id of the account the number sits in (not a secret). CLEAN-EXEMPT: pattern CHECK, written by the operator only';

alter table public.phone_calls drop constraint phone_calls_provider_check;
alter table public.phone_calls add constraint phone_calls_provider_check check (provider in ('exotel', 'plivo', 'vobiz', 'sandbox'));

alter table integrations.webhook_events drop constraint webhook_events_provider_check;
alter table integrations.webhook_events add constraint webhook_events_provider_check check (provider in ('razorpay', 'cashfree', 'fake', 'exotel', 'plivo', 'vobiz'));

create or replace function public.phone_call_begin(p_tenant_id uuid, p_direction text, p_provider text, p_sandbox boolean default true, p_contact_id uuid default null, p_purpose text default null, p_language text default null,
                                                   p_task_id uuid default null, p_ai_disclosed boolean default false, p_refuse_reason text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead uuid;
  c      public.phone_calls;
begin
  if not app.phone_may_write(p_tenant_id) then
    perform app.phone_error('deny');
  end if;
  if p_direction is null or p_direction not in ('outbound', 'inbound') or p_provider is null or p_provider not in ('exotel', 'plivo', 'vobiz', 'sandbox') or p_sandbox is null or p_ai_disclosed is null then
    perform app.phone_error('invalid');
  end if;
  if p_contact_id is not null then
    select l.id into v_lead from public.leads l where l.tenant_id = p_tenant_id and l.contact_id = p_contact_id order by l.created_at desc limit 1;
    if not exists (select 1 from public.contacts x where x.tenant_id = p_tenant_id and x.id = p_contact_id) then
      perform app.phone_error('reference');
    end if;
  end if;
  begin
    insert into public.phone_calls (tenant_id, direction, state, refuse_reason, contact_id, lead_id, task_id, purpose, language, provider, sandbox, ai_disclosed, created_by, ended_at)
    values (p_tenant_id, p_direction, case when p_refuse_reason is null then 'queued' else 'refused' end, p_refuse_reason, p_contact_id, v_lead, p_task_id, p_purpose, p_language, p_provider, p_sandbox, p_ai_disclosed,
            auth.uid(), case when p_refuse_reason is null then null else app.outbox_now() end)
    returning * into c;
  exception when check_violation or foreign_key_violation then
    perform app.phone_error('invalid');
  end;
  return app.phone_call_json(c, false);
end;
$$;

create or replace function public.phone_line_find(p_number text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n public.phone_numbers;
  v_name text;
  v_assistant text;
begin
  if auth.uid() is null or not app.is_scheduler() then
    perform app.phone_error('deny');
  end if;
  select * into n from public.phone_numbers x where x.number = p_number;
  if not found then
    return null;
  end if;
  select t.name into v_name from public.tenants t where t.id = n.tenant_id;
  v_name := coalesce(nullif(btrim(n.spoken_business_name), ''), v_name);
  select a.assistant_name into v_assistant from public.assistant_settings a where a.tenant_id = n.tenant_id;
  return jsonb_build_object('tenant_id', n.tenant_id, 'line_id', n.id, 'inbound_on', n.inbound_on, 'business', v_name, 'assistant', v_assistant,
                            'provider', n.provider, 'account_ref', n.account_ref, 'external_ref', n.external_ref);
end;
$$;
