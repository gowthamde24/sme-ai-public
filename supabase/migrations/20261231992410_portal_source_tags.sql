-- Portal e-mails arrive by themselves and say WHICH portal (owner, 25 Nov 2026: "forwarded e-mail is not a good idea, it should be automatic"). Until now every lead that came through the lead e-mail address was tagged
-- `email_forward` and shown as "Forwarded e-mail", whatever portal sent it. The API now reads the portal from the mail (portals.py) and tells the intake; this migration lets the intake tag the arrival with it.
--
--   1. two more portal tags, `sulekha` and `tradeindia`: app.lead_tag_ok, and the two functions that list the written/digital sources (app.call_back_proof: an enquiry through a live source is a proof for a call-back;
--      app.outbox_active_conversation: a reply to an enquiry inside the night rule) get the same two words, so a Sulekha or TradeIndia enquiry is treated exactly like a JustDial one.
--   2. public.scheduler_lead_intake_live: a post to a lead e-mail address (kind email_forward) or to a web address (kind webhook, used by IndiaMART's Push API) may carry `tag` in its row; the arrival is tagged with it
--      when it is one of the portal tags below, else with the source's own tag as before. Nothing else in that function changes.
-- The patches replace text in the functions' current definitions and refuse (raise) when the text is not found or when a function this migration did not expect lists the portals.

do $patch$
declare
  r        record;
  v_def    text;
  v_new    text;
  v_found  text[] := '{}';
  v_expect constant text[] := array['app.call_back_proof', 'app.lead_tag_ok', 'app.outbox_active_conversation'];
begin
  for r in
    select n.nspname || '.' || p.proname as sig, p.oid
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname in ('app', 'public') and p.prokind = 'f' and p.prosrc like '%''magicbricks'', ''housing'',%' and p.prosrc not like '%''sulekha''%'
  loop
    v_found := v_found || r.sig;
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(v_def, $a$'magicbricks', 'housing',$a$, $a$'magicbricks', 'housing', 'sulekha', 'tradeindia',$a$);
    if v_new = v_def then
      raise exception 'portal tags: % was not changed', r.sig;
    end if;
    execute v_new;
  end loop;
  if (select array_agg(x order by x) from unnest(v_found) x) is distinct from (select array_agg(x order by x) from unnest(v_expect) x) then
    raise exception 'portal tags: the functions that list the portals are not the expected three: %', v_found;
  end if;
end
$patch$;

do $patch$
declare
  v_def text := pg_get_functiondef('public.scheduler_lead_intake_live(text, jsonb)'::regprocedure);
  v_old text := $q$v_result := app.lead_intake_core(s.tenant_id, null, s.tag, v_consent, p_rows, true);$q$;
  v_new text := $q$v_result := app.lead_intake_core(s.tenant_id, null,
    case when s.kind in ('email_forward', 'webhook') and (p_rows -> 0 ->> 'tag') in ('indiamart', 'justdial', '99acres', 'magicbricks', 'housing', 'sulekha', 'tradeindia') then p_rows -> 0 ->> 'tag' else s.tag end,
    v_consent, p_rows, true);$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'scheduler_lead_intake_live has changed: the portal tag patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end
$patch$;
