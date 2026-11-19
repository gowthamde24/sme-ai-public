-- How a number was connected (planner, 19 Nov 2026): `onboarding` is "coexistence" when the shop kept its WhatsApp Business app on the number (Meta's app-onboarding path) and "cloud_api" otherwise,
-- and `onboarded_at` is when the number was first connected. The web shows "Also on your WhatsApp Business app"; features that coexistence does not support can be switched off by it.

create or replace function app.wa_account_json(a integrations.whatsapp_accounts) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('configured', true, 'waba_id', a.waba_id, 'phone_number_id', a.phone_number_id, 'display_phone', a.display_phone, 'coexistence', a.coexistence,
                            'onboarding', case when a.coexistence then 'coexistence' else 'cloud_api' end, 'onboarded_at', a.created_at,
                            'token_ref', a.token_ref, 'status', a.status, 'updated_at', a.updated_at)
$$;
