-- "How I talk to customers" (owner decision, 5 Nov 2026; job calls-like-a-pro part 3; docs/contracts/talk-training.md): the Owner trains how the assistant speaks on calls. ONE document per
-- workspace: the greeting, how to address people (no "sir / madam" unless set), what to ask, what NEVER to say, objections and answers, and 3 to 5 example answers as style. The API validates the
-- shape (app/talk_training); the database keeps it, checks its size and that its text is clean, and decides who: the Owner saves (second factor), the Owner and an Admin read, the scheduler account
-- reads it for a call. The never-say list is a HARD rule enforced by code on every spoken line, not left to the model.

create table public.talk_training (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null unique references public.tenants (id),
  doc        jsonb not null check (jsonb_typeof(doc) = 'object' and octet_length(doc::text) <= 20000 and app.text_is_clean(doc)),
  updated_by uuid not null,
  updated_at timestamptz not null default now()
);
comment on table public.talk_training is 'How the assistant talks to this business''s customers on calls (the Owner''s training). Written only by talk_training_save (Owner, second factor).';
comment on column public.talk_training.doc is 'SAFE: the Owner''s own wording about how to talk (greeting, questions, never-say phrases, objections, example answers); no customer data (checked by app.text_is_clean).';
comment on column public.talk_training.updated_by is 'SAFE: the id of the Owner who saved it. CLEAN-EXEMPT: uuid';

alter table public.talk_training enable row level security;
alter table public.talk_training force row level security;
revoke all on public.talk_training from public, anon, authenticated, service_role;
create trigger talk_training_forbid_tenant_id_change before update on public.talk_training for each row execute function app.forbid_tenant_id_change();
grant select on public.talk_training to authenticated;
create policy talk_training_select on public.talk_training for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create trigger audit_talk_training after insert or update or delete on public.talk_training for each row execute function app.audit_row_change('talk_training', '');

create function public.talk_training_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return (select jsonb_build_object('doc', t.doc, 'updated_at', t.updated_at) from public.talk_training t where t.tenant_id = p_tenant_id);
end;
$$;

create function public.talk_training_save(p_tenant_id uuid, p_doc jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform app.require_aal2();
  if p_doc is null or jsonb_typeof(p_doc) <> 'object' or octet_length(p_doc::text) > 20000 or not app.text_is_clean(p_doc) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  insert into public.talk_training (tenant_id, doc, updated_by) values (p_tenant_id, p_doc, auth.uid())
  on conflict (tenant_id) do update set doc = excluded.doc, updated_by = excluded.updated_by, updated_at = now();
  return (select jsonb_build_object('doc', t.doc, 'updated_at', t.updated_at) from public.talk_training t where t.tenant_id = p_tenant_id);
end;
$$;

-- back to the defaults (Owner, second factor)
create function public.talk_training_reset(p_tenant_id uuid) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform app.require_aal2();
  delete from public.talk_training where tenant_id = p_tenant_id;
end;
$$;

-- for a call: the scheduler account (the phone line runs as it) reads the workspace's training
create function public.talk_training_for_call(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return (select t.doc from public.talk_training t where t.tenant_id = p_tenant_id);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array['public.talk_training_get(uuid)', 'public.talk_training_save(uuid, jsonb)', 'public.talk_training_reset(uuid)', 'public.talk_training_for_call(uuid)'] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
