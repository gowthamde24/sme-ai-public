-- Speed to lead, first touch in seconds (owner decisions, 15 Nov 2026):
--   1. a standing rule may say 0 minutes: "immediately", the call is due the moment the lead is stored (was 1 to 120);
--   2. a test lead (public.leads.is_test: the Test buttons of the cards, and now the leads Meta's Testing Tool and test leads make) is left out of the speed-to-lead report;
--   3. the live door marks a Meta row that says it is a test (`is_test: true`: a +00 test number, Meta's "<test lead: ...>" placeholders, Meta's test e-mail addresses).
-- A test lead with a +00 number can never reach a real dialer (it is not a dialable number); the staging FAKE dialer may place a pretend call for it so the whole chain can be timed.
do $patch$
declare
  v_def text;
  v_new text;
  r     record;
begin
  for r in select c.conname from pg_constraint c where c.conrelid = 'public.outreach_rules'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%within_minutes%' loop
    execute format('alter table public.outreach_rules drop constraint %I', r.conname);
  end loop;
  alter table public.outreach_rules add constraint outreach_rules_within_minutes_check check (within_minutes between 0 and 120);
  comment on column public.outreach_rules.within_minutes is 'SAFE: minutes after the lead is stored; 0 = immediately. CLEAN-EXEMPT: numeric CHECK';

  v_def := pg_get_functiondef('public.outreach_rule_save(uuid, jsonb)'::regprocedure);
  v_new := replace(v_def, 'v_within not between 1 and 120', 'v_within not between 0 and 120');
  if v_new = v_def then raise exception 'outreach_rule_save: the within check was not found'; end if;
  execute v_new;

  v_def := pg_get_functiondef('public.outreach_report(uuid, date, date)'::regprocedure);
  v_new := replace(v_def, $a$where l.tenant_id = p_tenant_id and l.archived_at is null and (l.created_at at time zone 'Asia/Kolkata')::date between v_from and v_to$a$,
                          $a$where l.tenant_id = p_tenant_id and l.archived_at is null and not l.is_test and (l.created_at at time zone 'Asia/Kolkata')::date between v_from and v_to$a$);
  if v_new = v_def then raise exception 'outreach_report: the lead selection was not found'; end if;
  execute v_new;

  v_def := pg_get_functiondef('public.scheduler_lead_intake_live(text, jsonb)'::regprocedure);
  v_new := replace(v_def, E'  if s.kind = ''meta_lead_ads'' then\n    for v_item in',
                          E'  if s.kind = ''meta_lead_ads'' then\n    update public.leads l set is_test = true from integrations.lead_items i, jsonb_array_elements(p_rows) e\n     where i.tenant_id = s.tenant_id and i.source_tag = ''meta_lead_ads'' and i.external_id = e ->> ''external_id'' and (e ->> ''is_test'') = ''true'' and l.tenant_id = i.tenant_id and l.id = i.lead_id;\n    for v_item in');
  if v_new = v_def then raise exception 'scheduler_lead_intake_live: the meta block was not found'; end if;
  execute v_new;
end
$patch$;
