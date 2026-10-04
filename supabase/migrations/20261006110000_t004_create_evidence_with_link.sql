-- T004 / milestone 2: atomic create of an evidence row and its first link (ADR 0008 #11).
--
-- Why a function at all: a client that inserted the evidence and the link as two requests could
-- leave an evidence row nobody links to, and an unlinked row cannot be found when a person's data
-- has to be erased (docs/pre-pilot-checklist.md). One function = one transaction.
--
-- Why it is safe: SECURITY INVOKER with an empty search_path. It runs with the CALLER's privileges,
-- so row level security, the column grants, every CHECK and every trigger on evidence and
-- evidence_links apply exactly as if the caller had inserted the two rows themselves: a Viewer, a
-- member of another tenant, anon, a foreign target (composite foreign key), a forged provenance
-- column (there is no parameter for it, and the trigger sets created_by / created_via) all fail
-- the same way they fail on the tables. It cannot create claims, other link targets, archived rows
-- or stances: it has no parameter for them. An integration test proves it gives no power beyond
-- the tables' own policies.
--
-- SQLSTATEs (the API classifies by SQLSTATE only): the table rules (23514 / 23503 / 23505 / 22P02 /
-- 42501) plus 22023 for an argument the function itself refuses (a NULL id or an unsupported
-- target kind).

create function public.create_evidence_with_link(
  p_tenant_id    uuid,
  p_evidence_id  uuid,
  p_link_id      uuid,
  p_target_kind  text,
  p_target_id    uuid,
  p_kind         public.evidence_kind,
  p_provider     text,
  p_url          text        default null,
  p_reference    text        default null,
  p_snippet      text        default null,
  p_retrieved_at timestamptz default null,
  p_published_at timestamptz default null
) returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_tenant_id is null or p_evidence_id is null or p_link_id is null or p_target_id is null
     or p_kind is null or p_provider is null then
    raise exception 'missing required argument' using errcode = '22023';
  end if;
  if p_target_kind is null or p_target_kind not in ('company', 'lead') then
    raise exception 'unsupported target kind' using errcode = '22023';
  end if;

  insert into public.evidence
    (id, tenant_id, kind, provider, url, reference, snippet, retrieved_at, published_at)
  values
    (p_evidence_id, p_tenant_id, p_kind, p_provider, p_url, p_reference, p_snippet,
     coalesce(p_retrieved_at, now()), p_published_at);

  insert into public.evidence_links (id, tenant_id, evidence_id, company_id, lead_id)
  values (
    p_link_id, p_tenant_id, p_evidence_id,
    case when p_target_kind = 'company' then p_target_id end,
    case when p_target_kind = 'lead' then p_target_id end
  );

  return p_link_id;
end;
$$;

revoke all on function public.create_evidence_with_link(
  uuid, uuid, uuid, text, uuid, public.evidence_kind, text, text, text, text, timestamptz, timestamptz
) from public, anon;
grant execute on function public.create_evidence_with_link(
  uuid, uuid, uuid, text, uuid, public.evidence_kind, text, text, text, text, timestamptz, timestamptz
) to authenticated;
