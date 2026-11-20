-- The AI line the outbox appends to the assistant's FIRST message to a customer follows the business's setting "Say 'AI assistant' when greeting" (migration 20261231987400, and the campaign and trip texts of 20261231987500) AND, per job, the job's own override
-- (`say_ai_by_job` in the same Talk training document: `on` or `off`; a job with no word follows the business). A message belongs to a job by its category: a follow-up message is the follow-ups job's, a visit message is the
-- store-visits job's; every other category follows the business setting. The honest answer when a customer asks is not a setting and is not touched here.
create function app.outbox_mention_ai(p_tenant uuid, p_category text) returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select case t.doc -> 'say_ai_by_job' ->> (case p_category when 'followup' then 'followups' when 'visit' then 'store_visits' end)
                   when 'on' then true when 'off' then false end
       from public.talk_training t
      where t.tenant_id = p_tenant and jsonb_typeof(t.doc -> 'say_ai_by_job') = 'object'),
    app.outbox_mention_ai(p_tenant))
$$;
revoke all on function app.outbox_mention_ai(uuid, text) from public, anon, authenticated, service_role;

-- the one place the line is added (app.outbox_submit_core, migration 20261214090200) asks with the message's category
do $patch$
declare
  v_def text := pg_get_functiondef('app.outbox_submit_core(uuid, uuid, uuid, uuid, text, text, text, text, text, boolean, boolean, uuid[], boolean, text)'::regprocedure);
  v_new text := replace(v_def, 'app.outbox_mention_ai(p_tenant_id)', 'app.outbox_mention_ai(p_tenant_id, p_category)');
begin
  if v_new = v_def then
    raise exception 'outbox_submit_core has changed: the mention_ai call was not found';
  end if;
  execute v_new;
end
$patch$;
