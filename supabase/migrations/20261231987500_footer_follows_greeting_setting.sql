-- The AI sentence that WE append (campaign messages, trip updates, the campaign preview) follows the business's setting "Say 'AI assistant' when greeting" (owner decision 20 Nov 2026; planner 21 Nov: default OFF
-- drops "This message is from the business's AI assistant."). The STOP wording is untouched: it lives in the templates and the consent ask, which keep their approved text. The assistant's own first message
-- already followed the setting (migration 20261231987400). A customer who ASKS whether it is an AI always gets the truthful answer (the assistant's code, not a setting).
do $patch$
declare
  v_def text;
  v_new text;
begin
  -- the campaign runner's submit
  v_def := pg_get_functiondef('app.campaign_submit(uuid, uuid, uuid, uuid, text, text, boolean)'::regprocedure);
  if position('    v_disc := app.outbox_disclosure(p_language);' in v_def) = 0 then
    raise exception 'the campaign submit is not the one this migration expects';
  end if;
  v_new := replace(v_def, '    v_disc := app.outbox_disclosure(p_language);', '    v_disc := case when app.outbox_mention_ai(p_tenant) then app.outbox_disclosure(p_language) end;');
  execute v_new;

  -- a trip update
  v_def := pg_get_functiondef('public.trip_update_submit(uuid, uuid, uuid, text, text)'::regprocedure);
  if position('  v_disc := app.outbox_disclosure(p_language);' in v_def) = 0 then
    raise exception 'the trip update submit is not the one this migration expects';
  end if;
  v_new := replace(v_def, '  v_disc := app.outbox_disclosure(p_language);', '  v_disc := case when app.outbox_mention_ai(p_tenant_id) then app.outbox_disclosure(p_language) end;');
  execute v_new;

  -- the campaign preview shows the line only when a message would carry it ('' otherwise)
  v_def := pg_get_functiondef('public.campaign_preview(uuid, uuid)'::regprocedure);
  if position($q$'disclosure', app.outbox_disclosure(c.language),$q$ in v_def) = 0 then
    raise exception 'the campaign preview is not the one this migration expects';
  end if;
  v_new := replace(v_def, $q$'disclosure', app.outbox_disclosure(c.language),$q$, $q$'disclosure', case when app.outbox_mention_ai(c.tenant_id) then app.outbox_disclosure(c.language) else '' end,$q$);
  execute v_new;
end
$patch$;
