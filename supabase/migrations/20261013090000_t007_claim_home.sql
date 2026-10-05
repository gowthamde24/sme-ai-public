-- T007 M2 / 2: THE CLAIM HOME (closes the T006 review-fix-2 gap, ADR 0013).
--
-- A claim about a LEAD used to be stored with lead_id and no company_id, but every score reader looks claims up by company_id,
-- so an accepted claim about a lead could not reach that lead's score. The attributes agents propose (buyer_type, order_scale,
-- size_band, operating_status) are attributes of the COMPANY, and the CSV import already stores them as company claims.
--
--   1. agent_write_claim stores a claim of a lead-target run on the LEAD'S COMPANY (company_id = leads.company_id, resolved
--      inside the database from the run row after agent_open_run has proved ownership; nothing comes from the caller). A lead
--      with no company cannot receive a claim (the generic 'reference' refusal).
--   2. The lead stays recorded as provenance: the new column claims.source_lead_id. It can only be set on an agent claim
--      whose company_id is set (a CHECK, so a client cannot forge it: a client's claims are 'manual'), it is immutable like the
--      rest of the row (guard_immutable_record compares the whole row), and the composite foreign key keeps it in the tenant.
--      The run's own lead_id (agent_runs) is unchanged.
--   3. Old rows are NOT rewritten. Both shapes are read by two derived columns on claims_effective:
--        home_company_id  coalesce(claims.company_id, the company of claims.lead_id)   (where a score looks)
--        about_lead_id    coalesce(claims.lead_id, claims.source_lead_id)              (what a lead page lists)
--      A claim has exactly one home, so nothing is counted twice. claims_for_scoring now exposes home_company_id AS company_id,
--      so the existing readers (by company_id) see old lead-target claims and new company-home claims alike.
--   4. evidence_for_scoring is unchanged on purpose: the evidence a lead run writes is still linked to the LEAD (evidence_links
--      carries lead_id), it counts only through an accepted claim that cites it, and one link is one row.

alter table public.claims add column source_lead_id uuid;
alter table public.claims add constraint claims_source_lead_fk
  foreign key (tenant_id, source_lead_id) references public.leads (tenant_id, id);
alter table public.claims add constraint claims_source_lead_agent_chk
  check (source_lead_id is null or (created_via = 'agent' and company_id is not null and lead_id is null));
create index claims_source_lead_idx on public.claims (tenant_id, source_lead_id) where source_lead_id is not null;
comment on column public.claims.source_lead_id is 'SAFE: the lead whose agent run proposed this claim about its company (provenance only); a uuid, set only by agent_write_claim';

create or replace function public.agent_write_claim(
  p_run_id       uuid,
  p_step_key     text,
  p_predicate    text,
  p_value        text,
  p_evidence_ids uuid[],
  p_stance       public.evidence_stance default 'supports'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r         public.agent_runs;
  d         public.agent_definitions;
  v_sha     text;
  v_replay  jsonb;
  v_claim   uuid;
  v_ev      uuid;
  v_ids     uuid[];
  v_company uuid;
begin
  r := app.agent_open_run(p_run_id);
  if p_step_key is null or p_predicate is null or p_value is null or p_stance is null
     or p_evidence_ids is null or cardinality(p_evidence_ids) not between 1 and 5 or array_position(p_evidence_ids, null) is not null then
    perform app.agent_state_error('invalid');
  end if;
  select array_agg(distinct x order by x) into v_ids from unnest(p_evidence_ids) x;
  v_sha := app.agent_args_sha(jsonb_build_object('predicate', p_predicate, 'value', p_value, 'evidence', to_jsonb(v_ids), 'stance', p_stance));
  v_replay := app.agent_step_replay(r, p_step_key, 'agent_write_claim', v_sha);
  if v_replay is not null then
    return v_replay;
  end if;

  select * into d from public.agent_definitions a where a.agent_name = r.agent_name;
  if not found or p_predicate <> all (d.allowed_predicates) or p_stance <> all (d.allowed_stances) then
    perform app.agent_state_error('value');
  end if;
  -- THE HOME: a company run writes about its company; a lead run writes about the lead's company. The tenant is the run's own.
  v_company := coalesce(r.company_id,
                        (select l.company_id from public.leads l where l.tenant_id = r.tenant_id and l.id = r.lead_id));
  if v_company is null then
    perform app.agent_state_error('reference');
  end if;
  -- every evidence id must be a row THIS run wrote, in this tenant (anything else looks like a missing id)
  if (select count(*) from public.evidence e where e.tenant_id = r.tenant_id and e.agent_run_id = r.id and e.id = any (v_ids))
     <> cardinality(v_ids) then
    perform app.agent_state_error('reference');
  end if;
  perform app.agent_charge_write(r);

  v_claim := app.agent_derived_id(r.id, p_step_key, 'claim');
  perform set_config('app.created_via', 'agent', true);
  perform set_config('app.agent_run_id', r.id::text, true);
  insert into public.claims (id, tenant_id, company_id, lead_id, source_lead_id, predicate, value, confidence)
  values (v_claim, r.tenant_id, v_company, null, r.lead_id, p_predicate, p_value, 'unverified');
  foreach v_ev in array v_ids loop
    insert into public.evidence_links (id, tenant_id, evidence_id, claim_id, stance)
    values (app.agent_derived_id(r.id, p_step_key, 'link:' || v_ev::text), r.tenant_id, v_ev, v_claim, p_stance);
  end loop;
  perform set_config('app.created_via', '', true);
  perform set_config('app.agent_run_id', '', true);

  insert into public.agent_run_steps (tenant_id, run_id, started_by, step_key, kind, tool_name, status, args_sha256, result_ref)
  values (r.tenant_id, r.id, r.started_by, p_step_key, 'write', 'agent_write_claim', 'ok', v_sha, jsonb_build_object('claim_id', v_claim));
  return jsonb_build_object('claim_id', v_claim, 'replayed', false);
end;
$$;

-- The two derived columns are appended (a view may only grow at the end); the existing columns keep their meaning.
create or replace view public.claims_effective with (security_invoker = true) as
select c.id, c.tenant_id, c.company_id, c.lead_id, c.predicate, c.value,
       c.confidence as claim_confidence,
       c.created_via, c.agent_run_id, c.created_by, c.created_at, c.archived_at,
       r.decision   as review_decision,
       r.confidence as review_confidence,
       r.created_by as reviewed_by,
       r.created_at as reviewed_at,
       case when c.created_via <> 'agent' then 'not_applicable'
            when r.decision is null then 'unreviewed'
            else r.decision::text end as review_state,
       case when r.decision = 'accepted' then r.confidence else c.confidence end as confidence,
       coalesce(c.company_id, l.company_id)  as home_company_id,
       coalesce(c.lead_id, c.source_lead_id) as about_lead_id
  from public.claims c
  left join public.leads l on l.tenant_id = c.tenant_id and l.id = c.lead_id
  left join lateral (
    select x.decision, x.confidence, x.created_by, x.created_at
      from public.claim_reviews x
     where x.tenant_id = c.tenant_id and x.claim_id = c.id
     order by x.created_at desc, x.id desc
     limit 1) r on true;

create or replace view public.claims_for_scoring with (security_invoker = true) as
select e.id, e.tenant_id, e.home_company_id as company_id, e.lead_id, e.predicate, e.value, e.confidence, e.created_via, e.created_at
  from public.claims_effective e
 where e.archived_at is null
   and (e.created_via <> 'agent' or e.review_state = 'accepted');
