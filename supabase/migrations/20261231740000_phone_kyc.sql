-- In-app KYC for a business's phone number (owner decision 14 Nov 2026): "reseller" at Plivo = one subaccount per business + that business's own compliance application (ONE of: GST certificate,
-- Certificate of Incorporation, Udyam). Stack19 files the application for the business through Plivo's Compliance API (`data.subaccount`), the document passing through our server in memory ONLY: it is never
-- stored, never logged. This table keeps only what is needed to show progress: which kind of document was used, the subaccount's Auth ID, the application's id and Plivo's status words.
-- The status here is for SHOWING ONLY: before any number is rented the operator tool asks Plivo for the application's status again (app/telephony/plivo_onboarding.py), so a wrong word in this table can
-- never rent a number or place a call.
create table public.phone_kyc (
  id               uuid primary key,
  tenant_id        uuid not null references public.tenants (id) on delete restrict,
  doc_kind         text not null check (doc_kind in ('gst', 'coi', 'udyam')),
  plivo_subaccount text check (plivo_subaccount ~ '^[A-Za-z0-9]{6,40}$'),
  compliance_id    text check (compliance_id ~ '^[A-Za-z0-9-]{8,100}$'),
  status           text not null default 'preparing' check (status in ('preparing', 'submitted', 'accepted', 'rejected', 'suspended', 'expired', 'failed')),
  rejection_reason text check (rejection_reason is null or (char_length(rejection_reason) between 1 and 300 and app.text_is_clean(rejection_reason))),
  created_by       uuid not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  checked_at       timestamptz,
  unique (tenant_id, id)
);
comment on column public.phone_kyc.doc_kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.phone_kyc.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.phone_kyc.plivo_subaccount is 'SAFE: the provider''s subaccount id, an opaque token. CLEAN-EXEMPT: charset-limited CHECK';
comment on column public.phone_kyc.compliance_id is 'SAFE: the provider''s application id, an opaque token. CLEAN-EXEMPT: charset-limited CHECK';
comment on column public.phone_kyc.rejection_reason is 'SAFE: the provider''s short reason for a rejection, in its words (about the business''s own document, never a customer''s data); shown to the Owner and Admin only.';
comment on column public.phone_kyc.created_by is 'SAFE: a user id. CLEAN-EXEMPT: uuid';
-- one live application per business at a time (a rejected or expired one makes room for the next)
create unique index phone_kyc_one_live on public.phone_kyc (tenant_id) where status in ('preparing', 'submitted', 'accepted');
create index phone_kyc_keyset_idx on public.phone_kyc (tenant_id, created_at, id);
create trigger phone_kyc_forbid_tenant_id_change before update on public.phone_kyc for each row execute function app.forbid_tenant_id_change();
create trigger phone_kyc_set_updated_at before update on public.phone_kyc for each row execute function app.set_updated_at();
create trigger audit_phone_kyc after insert or update or delete on public.phone_kyc for each row execute function app.audit_row_change('phone_kyc', 'rejection_reason');
alter table public.phone_kyc enable row level security;
alter table public.phone_kyc force row level security;
revoke all on public.phone_kyc from public, anon, authenticated;
grant select on public.phone_kyc to authenticated;
create policy phone_kyc_select on public.phone_kyc for select to authenticated using (tenant_id = any (((select app.my_tenant_ids()))::uuid[]));
-- the business's latest application (any member reads; Owner and Admin see the reason)
create function public.phone_kyc_get(p_tenant_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
declare k public.phone_kyc;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into k from public.phone_kyc x where x.tenant_id = p_tenant_id order by x.created_at desc, x.id desc limit 1;
  if not found then
    return jsonb_build_object('id', null);
  end if;
  return jsonb_build_object('id', k.id, 'doc_kind', k.doc_kind, 'status', k.status, 'plivo_subaccount', k.plivo_subaccount, 'compliance_id', k.compliance_id,
                            'rejection_reason', case when app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then k.rejection_reason end,
                            'created_at', k.created_at, 'updated_at', k.updated_at, 'checked_at', k.checked_at);
end $$;

-- begin or change the application's record (the Owner, second factor). The caller's id makes a retry safe. Moving to a later state only: preparing -> submitted -> accepted | rejected | suspended | expired.
create function public.phone_kyc_save(p_tenant_id uuid, p_id uuid, p_doc_kind text, p_subaccount text, p_compliance_id text, p_status text, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_uid uuid := auth.uid();
  k     public.phone_kyc;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform app.require_aal2();
  if p_id is null or p_doc_kind not in ('gst', 'coi', 'udyam') or p_status not in ('preparing', 'submitted', 'accepted', 'rejected', 'suspended', 'expired', 'failed')
     or (v_reason is not null and (char_length(v_reason) > 300 or not app.text_is_clean(v_reason)))
     or (p_subaccount is not null and p_subaccount !~ '^[A-Za-z0-9]{6,40}$') or (p_compliance_id is not null and p_compliance_id !~ '^[A-Za-z0-9-]{8,100}$') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  select * into k from public.phone_kyc x where x.id = p_id for update;
  if found then
    if k.tenant_id <> p_tenant_id then
      raise exception 'id already used for other content' using errcode = '23505';
    end if;
    if k.status in ('rejected', 'expired', 'failed') and p_status <> k.status then
      raise exception 'closed' using errcode = 'SM501';
    end if;
    -- never backwards: a retry that says "preparing" again leaves a submitted application as it is
    if (case k.status when 'preparing' then 0 when 'submitted' then 1 else 2 end) > (case p_status when 'preparing' then 0 when 'submitted' then 1 else 2 end) then
      return jsonb_build_object('id', k.id, 'doc_kind', k.doc_kind, 'status', k.status, 'plivo_subaccount', k.plivo_subaccount, 'compliance_id', k.compliance_id, 'rejection_reason', k.rejection_reason,
                                'created_at', k.created_at, 'updated_at', k.updated_at, 'checked_at', k.checked_at);
    end if;
    update public.phone_kyc set status = p_status, plivo_subaccount = coalesce(p_subaccount, plivo_subaccount), compliance_id = coalesce(p_compliance_id, compliance_id), rejection_reason = v_reason,
                                checked_at = now() where id = p_id returning * into k;
  else
    -- a new application: an older one that is rejected, expired or failed has made room (the unique index lets only one live one stand)
    insert into public.phone_kyc (id, tenant_id, doc_kind, plivo_subaccount, compliance_id, status, rejection_reason, created_by, checked_at)
    values (p_id, p_tenant_id, p_doc_kind, p_subaccount, p_compliance_id, p_status, v_reason, v_uid, now()) returning * into k;
  end if;
  return jsonb_build_object('id', k.id, 'doc_kind', k.doc_kind, 'status', k.status, 'plivo_subaccount', k.plivo_subaccount, 'compliance_id', k.compliance_id, 'rejection_reason', k.rejection_reason,
                            'created_at', k.created_at, 'updated_at', k.updated_at, 'checked_at', k.checked_at);
end $$;
revoke all on function public.phone_kyc_get(uuid), public.phone_kyc_save(uuid, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.phone_kyc_get(uuid), public.phone_kyc_save(uuid, uuid, text, text, text, text, text) to authenticated;
