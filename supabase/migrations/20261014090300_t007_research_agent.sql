-- T007 M2 / 4: the RESEARCH agent's database half (ADR 0013, docs/plans/t007-research-agent.md).
--
--   * platform flag 'research_enabled' (OFF) and the definition 'research': the four predicates the ICP profile reads, all three stances,
--     evidence kind web_page only, ceilings per run, allowed for NO tenant until the operator names one (app.operator_enable_research).
--     max_input_tokens is 120,000 here (the plan said 40,000): the cost-cap reservation bounds one call's input by the BYTES it sends
--     (a token is at least one byte), and up to five 8,000-character pages are re-sent every turn; 40,000 would refuse the later turns.
--     The money ceiling stays max_cost_micros = 150,000 per run.
--   * agent_definitions.claim_value_pattern: a closed value shape (a lowercase slug) checked by agent_write_claim for this agent.
--   * agent_write_evidence: a web_page row needs a quote of at most 300 characters and a URL on the run target's OWN website host, with no
--     query string or fragment (the host comes from the company row, never from the caller).

alter table public.platform_flags drop constraint platform_flags_key_check;
alter table public.platform_flags add constraint platform_flags_key_check
  check (key in ('agents_enabled', 'selftest_enabled', 'research_enabled'));
insert into public.platform_flags (key, enabled) values ('research_enabled', false);

alter table public.agent_definitions add column claim_value_pattern text
  check (claim_value_pattern is null or char_length(claim_value_pattern) <= 100);

insert into public.agent_definitions
  (agent_name, allowed_predicates, allowed_evidence_kinds, max_writes, max_tool_calls, max_input_tokens, max_output_tokens, max_cost_micros,
   requires_flag, allowed_tenants, claim_value_pattern)
values
  ('research', array['buyer_type', 'order_scale', 'size_band', 'operating_status'], array['web_page']::public.evidence_kind[],
   7, 14, 120000, 4000, 150000, 'research_enabled', '{}'::uuid[], '^[a-z][a-z0-9_]{1,39}$');

-- the LOCAL operator switch for the research agent (like operator_enable_selftest): callable by no application role
create function app.operator_enable_research(p_tenant_slug text) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid;
begin
  select t.id into v_tenant from public.tenants t where t.slug = p_tenant_slug;
  if v_tenant is null then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;
  update public.platform_flags set enabled = true where key in ('agents_enabled', 'research_enabled');
  update public.agent_definitions d
     set allowed_tenants = (select coalesce(array_agg(distinct x), '{}'::uuid[]) from unnest(coalesce(d.allowed_tenants, '{}'::uuid[]) || v_tenant) x)
   where d.agent_name = 'research';
  insert into public.tenant_agent_settings (tenant_id, enabled) values (v_tenant, true)
  on conflict (tenant_id) do update set enabled = true, updated_at = now();
end;
$$;
revoke all on function app.operator_enable_research(text) from public, anon, authenticated, service_role;

create or replace function public.agent_write_evidence(p_run_id uuid, p_step_key text, p_kind evidence_kind, p_url text DEFAULT NULL::text, p_reference text DEFAULT NULL::text, p_snippet text DEFAULT NULL::text, p_published_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r         public.agent_runs;
  v_sha     text;
  v_replay  jsonb;
  v_evid    uuid;
  v_link    uuid;
  v_ref     text;
  v_company uuid;
  v_host    text;
begin
  r := app.agent_open_run(p_run_id);
  if p_step_key is null or p_kind is null then
    perform app.agent_state_error('invalid');
  end if;
  -- the agent's definition names the kinds it may write (the run is proven the caller's by now)
  if not exists (select 1 from public.agent_definitions d where d.agent_name = r.agent_name and p_kind = any (d.allowed_evidence_kinds)) then
    perform app.agent_state_error('value');
  end if;
  -- WEB evidence: a quote (at most 300 characters) and a URL on the run target's OWN website. The host is decided HERE, from the
  -- company the run is about, never by the caller; a query string or a fragment cannot carry data out.
  if p_kind = 'web_page' then
    v_company := coalesce(r.company_id, (select l.company_id from public.leads l where l.tenant_id = r.tenant_id and l.id = r.lead_id));
    v_host := app.website_host((select c.website from public.companies c where c.tenant_id = r.tenant_id and c.id = v_company));
    if v_host is null or p_url is null or p_url ~ '[?#]' or app.website_host(p_url) is distinct from v_host
       or p_snippet is null or char_length(p_snippet) > 300 then
      perform app.agent_state_error('value');
    end if;
  end if;
  v_sha := app.agent_args_sha(jsonb_build_object('kind', p_kind, 'url', p_url, 'reference', p_reference,
                                                  'snippet', p_snippet, 'published_at', p_published_at));
  v_replay := app.agent_step_replay(r, p_step_key, 'agent_write_evidence', v_sha);
  if v_replay is not null then
    return v_replay;
  end if;
  perform app.agent_charge_write(r);

  v_evid := app.agent_derived_id(r.id, p_step_key, 'evidence');
  v_link := app.agent_derived_id(r.id, p_step_key, 'link');
  -- a source needs a url or a reference (table CHECK): a note defaults to a pointer at the run that wrote it
  v_ref := case when p_url is null and p_reference is null then 'run:' || r.id::text else p_reference end;

  perform set_config('app.created_via', 'agent', true);
  perform set_config('app.agent_run_id', r.id::text, true);
  insert into public.evidence (id, tenant_id, kind, provider, url, reference, snippet, published_at)
  values (v_evid, r.tenant_id, p_kind, 'agent.' || r.agent_name, p_url, v_ref, p_snippet, p_published_at);
  insert into public.evidence_links (id, tenant_id, evidence_id, company_id, lead_id)
  values (v_link, r.tenant_id, v_evid, r.company_id, r.lead_id);
  perform set_config('app.created_via', '', true);
  perform set_config('app.agent_run_id', '', true);

  insert into public.agent_run_steps (tenant_id, run_id, started_by, step_key, kind, tool_name, status, args_sha256, result_ref)
  values (r.tenant_id, r.id, r.started_by, p_step_key, 'write', 'agent_write_evidence', 'ok', v_sha,
          jsonb_build_object('evidence_id', v_evid, 'link_id', v_link));
  return jsonb_build_object('evidence_id', v_evid, 'link_id', v_link, 'replayed', false);
end;
$function$;

create or replace function public.agent_write_claim(p_run_id uuid, p_step_key text, p_predicate text, p_value text, p_evidence_ids uuid[], p_stance evidence_stance DEFAULT 'supports'::evidence_stance)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- a closed value shape for agents that propose scored attributes (a slug, never free text)
  if d.claim_value_pattern is not null and p_value !~ d.claim_value_pattern then
    perform app.agent_state_error('value');
  end if;
  -- THE HOME: a company run writes about its company; a lead run writes about the lead's company. The tenant is the run's own.
  v_company := coalesce(r.company_id,
                        (select l.company_id from public.leads l where l.tenant_id = r.tenant_id and l.id = r.lead_id));
  if v_company is null then
    perform app.agent_state_error('reference');
  end if;
  -- a run that names BOTH a company and a lead (the run table forbids it today; this does not rely on that) must name a lead OF that
  -- company, or the claim would be stored on one company with another's lead as its provenance
  if r.company_id is not null and r.lead_id is not null
     and (select l.company_id from public.leads l where l.tenant_id = r.tenant_id and l.id = r.lead_id) is distinct from r.company_id then
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
$function$;
