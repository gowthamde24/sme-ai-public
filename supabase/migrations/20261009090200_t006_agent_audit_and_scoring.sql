-- T006 / M1 (3 of 3): the audit tells the truth about agent writes, and unaccepted agent claims never reach a score (ADR 0013).
--
-- 1. audit_events gains agent_run_id; app.write_audit_event records actor_type = 'agent' (and the run) for content written
--    through the agent functions, keeping the starting human as actor_user_id ("on behalf of"). It trusts the run setting
--    only if that run exists in the SAME tenant and was started by the SAME actor: a stray or foreign value is ignored.
--    Manual writes stay 'user'; maintenance with no JWT stays 'system'.
--      Bookkeeping the agent functions do (run counters, the step ledger) is audited as the human who started the run: the
--      content an agent WROTE (evidence, links, claims) is what actor_type 'agent' marks.
-- 2. claim_reviews.created_at defaults to clock_timestamp(), so two reviews of one claim in one transaction still have a
--    strict order (the newest review decides).
-- 3. Two security_invoker views:
--      claims_effective     every claim with its review state (not_applicable / unreviewed / accepted / rejected) and its
--                           effective confidence (the HUMAN-assigned one for an accepted agent claim);
--      claims_for_scoring   what scoring reads: live manual and import claims, and agent claims only when their newest review
--                           is "accepted". The review queue AND the label snapshot read this one view (decision 5).

alter table public.audit_events add column agent_run_id uuid;
comment on column public.audit_events.agent_run_id is 'SAFE: the agent run an agent-written row belongs to (NULL otherwise); no foreign key: the trail outlives the run';

create or replace function app.write_audit_event(
  p_tenant_id   uuid,
  p_action      text,
  p_entity_type text,
  p_entity_id   uuid,
  p_old         jsonb,
  p_new         jsonb,
  p_metadata    jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_request_id text;
  v_run        uuid;
begin
  begin
    -- Client-supplied header: cap its length so it cannot bloat the audit table, and refuse
    -- invisible characters.
    v_request_id := left(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-request-id', 100);
    if not app.text_is_clean(v_request_id) then
      v_request_id := null;
    end if;
  exception when others then
    v_request_id := null;
  end;

  -- A delegated agent write: the agent functions name the run in a transaction-local setting. It counts only if that run exists
  -- in THIS tenant and was started by THIS actor.
  begin
    v_run := nullif(current_setting('app.agent_run_id', true), '')::uuid;
  exception when others then
    v_run := null;
  end;
  if v_run is not null and (v_uid is null or not exists (
       select 1 from public.agent_runs r where r.id = v_run and r.tenant_id = p_tenant_id and r.started_by = v_uid)) then
    v_run := null;
  end if;

  insert into public.audit_events (
    tenant_id, actor_user_id, actor_type, action, entity_type, entity_id,
    old_values, new_values, metadata, request_id, agent_run_id
  ) values (
    p_tenant_id,
    v_uid,
    case when v_run is not null then 'agent' when v_uid is null then 'system' else 'user' end,
    p_action,
    p_entity_type,
    p_entity_id,
    p_old,
    p_new,
    coalesce(p_metadata, '{}'::jsonb),
    v_request_id,
    v_run
  );
end;
$$;

alter table public.claim_reviews alter column created_at set default clock_timestamp();

create view public.claims_effective with (security_invoker = true) as
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
       -- the confidence a reader should use: the human's, for an accepted agent claim; otherwise the claim's own
       case when r.decision = 'accepted' then r.confidence else c.confidence end as confidence
  from public.claims c
  left join lateral (
    select x.decision, x.confidence, x.created_by, x.created_at
      from public.claim_reviews x
     where x.tenant_id = c.tenant_id and x.claim_id = c.id
     order by x.created_at desc, x.id desc
     limit 1) r on true;

create view public.claims_for_scoring with (security_invoker = true) as
select e.id, e.tenant_id, e.company_id, e.lead_id, e.predicate, e.value, e.confidence, e.created_via, e.created_at
  from public.claims_effective e
 where e.archived_at is null
   and (e.created_via <> 'agent' or e.review_state = 'accepted');

revoke all on public.claims_effective, public.claims_for_scoring from public, anon, authenticated;
grant select on public.claims_effective, public.claims_for_scoring to authenticated;
