-- ONE greeting (owner decision 13 Nov 2026, decided by C1; the owner can reverse): the Owner writes the greeting in Talk training only. A workspace that already has a Talk training document
-- and an old workspace-level opening line (workspace.opening_lines, no campaign) for a language that has NO greeting yet gets that line as its greeting. NEVER over an existing greeting.
-- Only a line that fits a greeting is copied (2 to 200 characters, no price or promise: the same rule the API checks on save, written here a little wider so that nothing doubtful is copied);
-- the rest stays where it is, still the fallback of the call's opening. The old table is kept as it is (nothing is deleted or locked: it stays readable for one release); a workspace with no Talk
-- training document is not given one here (a document would hide its pack's defaults): the API shows its old line in the greeting field instead (app/talk_training/routes.py).

with legacy as (
  select l.workspace_id, jsonb_object_agg(l.language, btrim(l.line)) as lines
    from workspace.opening_lines l
   where l.campaign_key = '00000000-0000-0000-0000-000000000000'
     and l.language in ('en', 'te', 'hi', 'kn', 'ta', 'ml', 'mr')
     and char_length(btrim(l.line)) between 2 and 200
     and btrim(l.line) !~* '₹|\yrs\.?\s?[0-9]|[0-9]\s?%|[0-9]+\s*(lakh|crore|rupees)|\y(guarantee|guaranteed|promise|promised|assure|assured|warranty)\y'
   group by l.workspace_id
)
update public.talk_training t
   set doc = jsonb_set(t.doc, '{greeting}', legacy.lines || coalesce(t.doc -> 'greeting', '{}'::jsonb), true)
  from legacy
 where legacy.workspace_id = t.tenant_id
   and jsonb_typeof(coalesce(t.doc -> 'greeting', '{}'::jsonb)) = 'object'
   and (legacy.lines || coalesce(t.doc -> 'greeting', '{}'::jsonb)) is distinct from coalesce(t.doc -> 'greeting', '{}'::jsonb);
