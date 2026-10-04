-- T006 review fixes 2 (owner review of M2).
--
--   1  public.evidence_for_scoring: what the evidence-quality factor of the ICP score reads, for the review queue AND the label
--      snapshot. Evidence written by an agent counts only when a claim whose NEWEST review is 'accepted' cites it with stance
--      'supports'; manual and imported evidence counts as before. (Claims are covered by claims_for_scoring.)
--   2  review_claim locks the claim row FOR NO KEY UPDATE instead of FOR UPDATE: concurrent reviews still serialise (the lock
--      conflicts with itself) but an insert that merely REFERENCES the claim (a link citing it) is no longer blocked.

create view public.evidence_for_scoring with (security_invoker = true) as
select l.id as link_id, l.tenant_id, l.lead_id, l.company_id, l.created_at, e.kind, e.url
  from public.evidence_links l
  join public.evidence e on e.tenant_id = l.tenant_id and e.id = l.evidence_id
 where l.archived_at is null
   and l.claim_id is null
   and (
        (e.created_via <> 'agent' and l.created_via <> 'agent')
        or exists (
             select 1
               from public.evidence_links cl
               join public.claims_effective c on c.tenant_id = cl.tenant_id and c.id = cl.claim_id
              where cl.tenant_id = e.tenant_id and cl.evidence_id = e.id
                and cl.stance = 'supports' and cl.archived_at is null
                and c.archived_at is null and c.review_state = 'accepted')
       );

revoke all on public.evidence_for_scoring from public, anon, authenticated;
grant select on public.evidence_for_scoring to authenticated;

create or replace function public.review_claim(
  p_review_id   uuid,
  p_claim_id    uuid,
  p_decision    public.claim_review_decision,
  p_confidence  public.claim_confidence    default null,
  p_reason_code public.claim_review_reason default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  c      public.claims;
  e      public.claim_reviews;
  v_self boolean;
begin
  if v_uid is null or p_review_id is null or p_claim_id is null then
    perform app.agent_deny();
  end if;
  -- the tenant comes from the CLAIM; an unknown claim and another tenant's claim are the same refusal
  select * into c from public.claims x where x.id = p_claim_id;
  if not found or not app.has_tenant_role(c.tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.agent_deny();
  end if;
  -- the caller is an Owner / Admin of the claim's tenant: now take the lock and re-read (reviews of one claim serialise)
  select * into c from public.claims x where x.id = p_claim_id for no key update;
  if not found then
    perform app.agent_deny();
  end if;

  -- an exact retry by the same reviewer is a replay
  select * into e from public.claim_reviews x where x.id = p_review_id;
  if found and e.tenant_id = c.tenant_id and e.claim_id = c.id and e.created_by = v_uid and e.decision = p_decision
     and e.confidence is not distinct from p_confidence and e.reason_code is not distinct from p_reason_code then
    return jsonb_build_object('review_id', e.id, 'replayed', true, 'self_review', e.self_review);
  end if;

  if p_decision is null
     or (p_decision = 'accepted' and (p_confidence is null or p_confidence not in ('low', 'medium', 'high') or p_reason_code is not null))
     or (p_decision = 'rejected' and (p_reason_code is null or p_confidence is not null)) then
    perform app.agent_state_error('invalid');
  end if;
  if c.created_via <> 'agent' or c.archived_at is not null then
    perform app.agent_state_error('value');
  end if;
  -- "medium" and "high" mean the evidence supports the claim: at least one live supporting link
  if p_decision = 'accepted' and p_confidence in ('medium', 'high')
     and not exists (select 1 from public.evidence_links l
                      where l.tenant_id = c.tenant_id and l.claim_id = c.id and l.stance = 'supports' and l.archived_at is null) then
    perform app.agent_state_error('value');
  end if;

  v_self := exists (select 1 from public.agent_runs r where r.tenant_id = c.tenant_id and r.id = c.agent_run_id and r.started_by = v_uid);
  -- a review is ALWAYS a human, manual record, whatever the settings held before
  perform set_config('app.created_via', 'manual', true);
  begin
    insert into public.claim_reviews (id, tenant_id, claim_id, decision, confidence, reason_code, self_review)
    values (p_review_id, c.tenant_id, c.id, p_decision, p_confidence, p_reason_code, v_self);
  exception when unique_violation then
    raise exception 'review id already used' using errcode = '23505', constraint = 'claim_reviews_pkey', table = 'claim_reviews', schema = 'public';
  end;
  perform set_config('app.created_via', '', true);
  return jsonb_build_object('review_id', p_review_id, 'replayed', false, 'self_review', v_self);
end;
$$;
