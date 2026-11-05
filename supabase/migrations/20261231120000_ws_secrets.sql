-- A workspace's own keys (owner decision, 5 Nov 2026): Google Secret Manager, ONE secret per workspace and kind, named sme-ws-<workspace id>-<kind> (the sme-ws- prefix is what the conditional
-- IAM bindings allow: the API creates and writes them, the API and the worker read them; docs/contracts/assistant-tools.md section 2, the `secret` card).
-- The database NEVER holds a key: only the secret's name, the last four characters and a fingerprint (an HMAC made by the API, to tell "the same key again" without the key).
-- The secure card: the assistant opens a request (Owner only, good for 15 minutes, once); the key itself goes from the card straight to the API's POST /assistant/secrets/{request_id}, never through a chat
-- turn, a model, a log or an audit row.

create table public.workspace_secrets (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  kind        text not null check (kind in ('indiamart_key')),
  secret_name text not null check (secret_name ~ '^sme-ws-[0-9a-f-]{36}-[a-z_]{3,30}$'),
  last4       text check (last4 is null or last4 ~ '^[A-Za-z0-9]{1,4}$'),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{16}$'),
  set_by      uuid not null,
  set_at      timestamptz not null default now(),
  unique (tenant_id, kind)
);
comment on table public.workspace_secrets is 'A workspace''s own key: WHERE it is (the Secret Manager name), never the key. Written only by workspace_secret_record (Owner).';
comment on column public.workspace_secrets.kind is 'SAFE: a closed word (indiamart_key). CLEAN-EXEMPT: check constraint';
comment on column public.workspace_secrets.secret_name is 'SAFE: the Secret Manager name sme-ws-<workspace>-<kind>, no key. CLEAN-EXEMPT: check constraint';
comment on column public.workspace_secrets.last4 is 'SAFE: at most the last four characters of the key (what the card shows). CLEAN-EXEMPT: check constraint';
comment on column public.workspace_secrets.fingerprint is 'SAFE: 16 hex characters of an HMAC made by the API, not reversible. CLEAN-EXEMPT: check constraint';
comment on column public.workspace_secrets.set_by is 'SAFE: the id of the Owner who saved it. CLEAN-EXEMPT: uuid';

create table public.secret_requests (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id),
  kind        text not null check (kind in ('indiamart_key')),
  requested_by uuid not null,
  message_id  uuid,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '15 minutes',
  used_at     timestamptz
);
comment on table public.secret_requests is 'The secure card''s request: good for 15 minutes and once, for the Owner who asked. Holds no key.';
comment on column public.secret_requests.kind is 'SAFE: a closed word. CLEAN-EXEMPT: check constraint';
comment on column public.secret_requests.requested_by is 'SAFE: the id of the Owner the card is for. CLEAN-EXEMPT: uuid';
comment on column public.secret_requests.message_id is 'SAFE: the chat reply that showed the card. CLEAN-EXEMPT: uuid';
create index secret_requests_tenant_idx on public.secret_requests (tenant_id, created_at desc, id);

do $$
declare
  t text;
begin
  foreach t in array array['workspace_secrets', 'secret_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('create trigger %I before update on public.%I for each row execute function app.forbid_tenant_id_change()', t || '_forbid_tenant_id_change', t);
  end loop;
end $$;
-- the Owner and an Admin may read WHERE their key is (never the fingerprint: no column grant); the Owner may read the workspace's card requests (they hold no key). Writes: only the functions below
grant select (id, tenant_id, kind, secret_name, last4, set_by, set_at) on public.workspace_secrets to authenticated;
grant select on public.secret_requests to authenticated;
create policy workspace_secrets_select on public.workspace_secrets for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create policy secret_requests_select on public.secret_requests for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner']::public.app_role[])))::uuid[]));
create trigger audit_workspace_secrets after insert or update or delete on public.workspace_secrets for each row execute function app.audit_row_change('workspace_secret', '');
create trigger audit_secret_requests after insert or update or delete on public.secret_requests for each row execute function app.audit_row_change('secret_request', '');

-- the secure card asks: Owner only; at most 5 open requests a workspace (the rest wait 15 minutes)
create function public.secret_request_open(p_tenant_id uuid, p_kind text, p_message_id uuid default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.secret_requests;
begin
  perform app.aw_gate(p_tenant_id, array['owner']::public.app_role[]);
  if p_kind is null or p_kind not in ('indiamart_key') then
    perform app.aw_error('invalid');
  end if;
  if (select count(*) from public.secret_requests x where x.tenant_id = p_tenant_id and x.used_at is null and x.expires_at > now()) >= 5 then
    perform app.aw_error('state');
  end if;
  insert into public.secret_requests (tenant_id, kind, requested_by, message_id) values (p_tenant_id, p_kind, auth.uid(), p_message_id) returning * into r;
  return jsonb_build_object('request_id', r.id, 'kind', r.kind, 'expires_at', r.expires_at,
                            'saved', (select jsonb_build_object('last4', s.last4, 'set_at', s.set_at) from public.workspace_secrets s where s.tenant_id = p_tenant_id and s.kind = p_kind));
end;
$$;

-- the key arrives: the request must be the caller's own, open and unused; it is used up HERE (before Secret Manager is written: a second try needs a new card)
create function public.secret_request_use(p_tenant_id uuid, p_request_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.secret_requests;
begin
  perform app.aw_gate(p_tenant_id, array['owner']::public.app_role[]);
  select * into r from public.secret_requests x where x.id = p_request_id and x.tenant_id = p_tenant_id for update;
  if not found or r.requested_by <> auth.uid() then
    perform app.aw_error('reference');
  end if;
  if r.used_at is not null then
    perform app.aw_error('state');
  end if;
  if r.expires_at <= now() then
    perform app.aw_error('expired');
  end if;
  update public.secret_requests set used_at = now() where id = r.id;
  return jsonb_build_object('kind', r.kind, 'secret_name', 'sme-ws-' || p_tenant_id::text || '-' || replace(r.kind, '_key', ''));
end;
$$;

-- where the key is, once Secret Manager has it (Owner)
create function public.workspace_secret_record(p_tenant_id uuid, p_kind text, p_secret_name text, p_last4 text, p_fingerprint text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.aw_gate(p_tenant_id, array['owner']::public.app_role[]);
  if p_kind is null or p_kind not in ('indiamart_key') or p_secret_name is distinct from ('sme-ws-' || p_tenant_id::text || '-' || replace(p_kind, '_key', '')) then
    perform app.aw_error('invalid');
  end if;
  insert into public.workspace_secrets (tenant_id, kind, secret_name, last4, fingerprint, set_by)
  values (p_tenant_id, p_kind, p_secret_name, p_last4, p_fingerprint, auth.uid())
  on conflict (tenant_id, kind) do update set secret_name = excluded.secret_name, last4 = excluded.last4, fingerprint = excluded.fingerprint, set_by = excluded.set_by, set_at = now();
  return jsonb_build_object('kind', p_kind, 'last4', p_last4);
end;
$$;

-- where it is, for the pull and the screens (Owner, Admin): the name and the last four, never the key
create function public.workspace_secret_get(p_tenant_id uuid, p_kind text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.aw_gate(p_tenant_id, array['owner', 'admin']::public.app_role[]);
  return (select jsonb_build_object('kind', s.kind, 'secret_name', s.secret_name, 'last4', s.last4, 'set_at', s.set_at)
            from public.workspace_secrets s where s.tenant_id = p_tenant_id and s.kind = p_kind);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.secret_request_open(uuid, text, uuid)', 'public.secret_request_use(uuid, uuid)', 'public.workspace_secret_record(uuid, text, text, text, text)',
                           'public.workspace_secret_get(uuid, text)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
