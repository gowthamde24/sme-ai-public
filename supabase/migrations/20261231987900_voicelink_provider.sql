-- VoiceLink as a telephony provider (24 Nov 2026; reports/voicelink-adapter-notes.md). Widens the closed provider lists to accept 'voicelink' and nothing else:
--   public.phone_numbers.provider, public.phone_calls.provider, integrations.webhook_events.provider (CHECK lists) and the two functions that repeat the list
--   (public.phone_call_begin, public.phone_line_for_tenant; patched by text replace of their own definition so nothing else in them can drift).
-- No data changes, no new column, no credential. Every existing row and every existing provider word behaves exactly as before.

alter table public.phone_numbers drop constraint phone_numbers_provider_check;
alter table public.phone_numbers add constraint phone_numbers_provider_check check (provider in ('exotel', 'plivo', 'vobiz', 'voicelink'));

alter table public.phone_calls drop constraint phone_calls_provider_check;
alter table public.phone_calls add constraint phone_calls_provider_check check (provider in ('exotel', 'plivo', 'vobiz', 'voicelink', 'sandbox'));

alter table integrations.webhook_events drop constraint webhook_events_provider_check;
alter table integrations.webhook_events add constraint webhook_events_provider_check check (provider in ('razorpay', 'cashfree', 'fake', 'exotel', 'plivo', 'vobiz', 'voicelink'));

do $patch$
declare
  v_def text;
begin
  select pg_get_functiondef('public.phone_call_begin(uuid,text,text,boolean,uuid,text,text,uuid,boolean,text)'::regprocedure) into v_def;
  if position($$('exotel', 'plivo', 'vobiz', 'sandbox')$$ in v_def) = 0 then raise exception 'phone_call_begin: the provider list was not found'; end if;
  execute replace(v_def, $$('exotel', 'plivo', 'vobiz', 'sandbox')$$, $$('exotel', 'plivo', 'vobiz', 'voicelink', 'sandbox')$$);

  select pg_get_functiondef('public.phone_line_for_tenant(uuid,text)'::regprocedure) into v_def;
  if position($$('exotel', 'plivo', 'vobiz')$$ in v_def) = 0 then raise exception 'phone_line_for_tenant: the provider list was not found'; end if;
  execute replace(v_def, $$('exotel', 'plivo', 'vobiz')$$, $$('exotel', 'plivo', 'vobiz', 'voicelink')$$);
end
$patch$;
