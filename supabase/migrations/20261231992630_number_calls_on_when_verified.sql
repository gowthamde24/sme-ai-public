-- Verify first, then buy (planner, 26 Nov 2026): when the workspace's own VoiceLink client is ALREADY verified, a number it buys is attached with calls ON (it is ready the moment it is routed). While the business is not verified
-- the number is still attached with calls OFF and shows `kyc_pending` (buy first, verify after: the second path). Only the attach function changes.
do $patch$
declare
  v_def text := pg_get_functiondef('public.number_claim_attach(uuid)'::regprocedure);
  v_old text := $q$values (r.tenant_id, r.number, 'VoiceLink', false, 'voicelink') returning * into n;$q$;
  v_new text := $q$values (r.tenant_id, r.number, 'VoiceLink', exists (select 1 from telephony.business_clients b where b.tenant_id = r.tenant_id and b.state = 'verified'), 'voicelink') returning * into n;$q$;
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'number_claim_attach has changed: the calls-on patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end $patch$;
