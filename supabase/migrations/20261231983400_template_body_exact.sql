-- What we store is what the customer received (owner, 18 Nov 2026). A standing rule's WhatsApp step and an offer campaign go to Meta as an approved TEMPLATE: the customer gets the template's own
-- words, so the outbox must store exactly those words. Until now campaign_submit also appended the one-line "this message is from the business's AI assistant" to the first message of a customer, so the
-- record showed a sentence the customer never got (wrong for the chat history and for any later "what did we send"). Now:
--   * app.campaign_submit takes `p_template` (default false): a template send stores the filled template text and nothing more;
--   * a free-form message (a money reminder inside the 24 hours) keeps the line as before.
do $patch$
declare
  v_def text := pg_get_functiondef('app.campaign_submit(uuid, uuid, uuid, uuid, text, text)'::regprocedure);
  v_new text;
  v_old2 text := E'  if v_contact.id is not null then\n    v_disc := app.outbox_disclosure(p_language);';
begin
  -- pg_get_functiondef prints the header its own way (upper case, several lines): the header is matched by its arguments, the body by its text
  if position('p_body text, p_language text)' in v_def) = 0 or position(v_old2 in v_def) = 0 then
    raise exception 'campaign_submit has changed: the template-body patch no longer fits';
  end if;
  v_new := replace(replace(v_def, 'p_body text, p_language text)', 'p_body text, p_language text, p_template boolean default false)'),
                   v_old2, E'  if v_contact.id is not null and not coalesce(p_template, false) then   -- a template send stores exactly the template''s words\n    v_disc := app.outbox_disclosure(p_language);');
  execute v_new;
end;
$patch$;
drop function app.campaign_submit(uuid, uuid, uuid, uuid, text, text);
revoke all on function app.campaign_submit(uuid, uuid, uuid, uuid, text, text, boolean) from public, anon, authenticated, service_role;

-- the callers that send a template
do $patch$
declare
  v_def text := pg_get_functiondef('public.scheduler_outreach_run(integer)'::regprocedure);
  v_old text := 'app.campaign_submit((o ->> ''approved_by'')::uuid, v_mid, i.tenant_id, i.lead_id, v_tbody, v_lang)';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'scheduler_outreach_run has changed: the template-body patch no longer fits';
  end if;
  execute replace(v_def, v_old, 'app.campaign_submit((o ->> ''approved_by'')::uuid, v_mid, i.tenant_id, i.lead_id, v_tbody, v_lang, true)');
end;
$patch$;

do $patch$
declare
  v_def text := pg_get_functiondef('app.campaign_step_run(uuid, public.campaign_steps)'::regprocedure);
  v_old text := 'c.offer_label), c.language)';
begin
  if position(v_old in v_def) = 0 then
    raise exception 'campaign_step_run has changed: the template-body patch no longer fits';
  end if;
  execute replace(v_def, v_old, 'c.offer_label), c.language, c.kind = ''offer'')');   -- an offer is only ever sent as an approved marketing template
end;
$patch$;
