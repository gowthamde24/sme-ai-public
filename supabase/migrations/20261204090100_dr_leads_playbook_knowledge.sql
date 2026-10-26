-- Job DR / A1 (night run 27 Oct 2026): the workspace's LEAD PLAYBOOK and its KNOWLEDGE BASE.
--
--   public.lead_playbooks          the Owner's edited version of the business type's template (goal, questions, objections, follow-ups, outcome reasons); no row = the template of the pack applies
--   public.knowledge_sources       what the Owner pasted or uploaded (text only is kept, never the file) to tell the assistant about the business
--   public.knowledge_facts         the facts drafted from a source (or written by hand): draft -> approved | rejected. THE ASSISTANT MAY ONLY STATE APPROVED FACTS. A price is a fact of kind `price`
--                                  and only the Owner with a second factor approves one; text that looks like a price can only be a `price` fact (the table refuses anything else)
--   public.lead_playbook_get / _save / _reset                          any member reads; the Owner (second factor) saves or resets
--   public.knowledge_source_add / _list / _text / _discard             Owner or Admin
--   public.knowledge_facts_draft_replace / knowledge_fact_add / _edit / _decide / knowledge_facts_list / knowledge_facts_approved
--
-- An edit of a fact sends it back to `draft` (an edit always needs approving again). Nothing is deleted by a client: the functions are the only writers.
-- SQLSTATEs: 22023 invalid, 42501 not allowed, 23503 not found, SM306 second factor needed, 53400 limit (too many sources or facts).

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. tables
-- ---------------------------------------------------------------------------------------------------------------------------------
create table public.lead_playbooks (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null unique references public.tenants (id) on delete restrict,
  playbook   jsonb not null check (jsonb_typeof(playbook) = 'object' and octet_length(playbook::text) <= 40000 and app.text_is_clean(playbook)),
  updated_by uuid not null,
  updated_at timestamptz not null default app.outbox_now()
);
comment on table public.lead_playbooks is 'Job DR / A1: the Owner''s edited lead playbook of a workspace (validated by the API against the template of the business type; the database keeps its size and cleanliness). Written only by lead_playbook_save.';
comment on column public.lead_playbooks.playbook is 'SAFE: the owner''s script for calls (questions, answers to objections, follow-up timings); the API refuses a price or a promise in it.';

create table public.knowledge_sources (
  id           uuid primary key,
  tenant_id    uuid not null references public.tenants (id) on delete restrict,
  kind         text not null check (kind in ('paste', 'file')),
  title        text not null check (char_length(title) between 1 and 120 and app.text_is_clean(title)),
  filename     text check (filename is null or (char_length(filename) between 1 and 200 and app.text_is_clean(filename))),
  content_type text check (content_type is null or content_type ~ '^[a-z0-9.+/-]{3,100}$'),
  text         text not null check (char_length(text) between 1 and 60000 and app.text_is_clean(text)),
  chars        integer not null check (chars between 1 and 60000),
  status       text not null default 'read' check (status in ('read', 'drafted', 'discarded')),
  created_by   uuid not null,
  created_at   timestamptz not null default app.outbox_now(),
  discarded_at timestamptz,
  unique (tenant_id, id),
  check ((status = 'discarded') = (discarded_at is not null))
);
create index knowledge_sources_tenant_idx on public.knowledge_sources (tenant_id, created_at desc, id);
comment on table public.knowledge_sources is 'Job DR / A1: text the Owner pasted or read from an uploaded brochure, price list or FAQ (the file itself is never stored). Business information the owner chose to give; erased with the workspace.';
comment on column public.knowledge_sources.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.knowledge_sources.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.knowledge_sources.content_type is 'SAFE: a media type. CLEAN-EXEMPT: pattern CHECK';
comment on column public.knowledge_sources.title is 'PII: a name the owner gave the source; may hold a business or person name. Erased with the workspace.';
comment on column public.knowledge_sources.filename is 'PII: the name of the uploaded file; may hold a name. Erased with the workspace.';
comment on column public.knowledge_sources.text is 'PII: text the owner supplied; may hold names, phone numbers or addresses of the business. Erased with the workspace.';

create table public.knowledge_facts (
  id         uuid primary key,
  tenant_id  uuid not null references public.tenants (id) on delete restrict,
  source_id  uuid,
  kind       text not null check (kind in ('price', 'offer', 'product_service', 'location', 'hours', 'policy', 'faq', 'contact', 'other')),
  text       text not null check (char_length(text) between 3 and 500 and app.text_is_clean(text) and text !~* '(https?://|www\.)'),
  status     text not null default 'draft' check (status in ('draft', 'approved', 'rejected')),
  edited     boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default app.outbox_now(),
  decided_by uuid,
  decided_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, source_id) references public.knowledge_sources (tenant_id, id),
  check ((status = 'draft') = (decided_at is null)),
  -- text that looks like a price can only be a fact of kind `price`, so the stricter approval always applies to it
  check (kind = 'price' or text !~* '(₹|\mrs\.?\s?[0-9]|[0-9]\s?(rupees|lakh|crore)\M|\mrupees\M)')
);
create index knowledge_facts_source_idx on public.knowledge_facts (tenant_id, source_id);
create index knowledge_facts_tenant_idx on public.knowledge_facts (tenant_id, status, created_at desc, id);
comment on table public.knowledge_facts is 'Job DR / A1: facts about the business the assistant may state once the Owner approved them (draft -> approved | rejected). A price is a fact of kind price; only the Owner with a second factor approves one.';
comment on column public.knowledge_facts.kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.knowledge_facts.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.knowledge_facts.text is 'PII: a fact in the owner''s words; may hold a business address or phone number. Erased with the workspace.';

do $$
declare
  t text;
begin
  foreach t in array array['lead_playbooks', 'knowledge_sources', 'knowledge_facts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', t);
    execute format('grant select on public.%I to authenticated', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]))$p$, t || '_select', t);
    execute format('create trigger %I before update on public.%I for each row execute function app.forbid_tenant_id_change()', t || '_forbid_tenant_id_change', t);
  end loop;
end $$;
create trigger audit_lead_playbooks after insert or update or delete on public.lead_playbooks for each row execute function app.audit_row_change('lead_playbook', '');
create trigger audit_knowledge_sources after insert or update or delete on public.knowledge_sources for each row execute function app.audit_row_change('knowledge_source', 'title,filename,text');
create trigger audit_knowledge_facts after insert or update or delete on public.knowledge_facts for each row execute function app.audit_row_change('knowledge_fact', 'text');

insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('knowledge_sources', 'title',    'tenant', 'tombstone', 'erased:1'),
  ('knowledge_sources', 'filename', 'tenant', 'null',      'erased:1'),
  ('knowledge_sources', 'text',     'tenant', 'tombstone', 'erased:1'),
  ('knowledge_facts',   'text',     'tenant', 'tombstone', 'erased:1'),
  ('knowledge_sources', 'title',    'sweep',  'substring', 'erased:1'),
  ('knowledge_sources', 'filename', 'sweep',  'substring', 'erased:1'),
  ('knowledge_sources', 'text',     'sweep',  'substring', 'erased:1'),
  ('knowledge_facts',   'text',     'sweep',  'substring', 'erased:1');

create function app.knowledge_error(p_kind text) returns void
language plpgsql
set search_path = ''
as $$
begin
  case p_kind
    when 'invalid'   then raise exception 'invalid input' using errcode = '22023';
    when 'reference' then raise exception 'not found' using errcode = '23503';
    when 'limit'     then raise exception 'too many' using errcode = '53400';
    else raise exception 'not allowed' using errcode = '42501';
  end case;
end;
$$;
revoke all on function app.knowledge_error(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. the playbook
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.lead_playbook_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.lead_playbooks;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    perform app.knowledge_error('deny');
  end if;
  select * into p from public.lead_playbooks x where x.tenant_id = p_tenant_id;
  return jsonb_build_object('saved', found, 'playbook', case when found then p.playbook else null end, 'updated_at', case when found then p.updated_at else null end,
                            'pack_code', (select w.pack_code from packs.workspace_pack w where w.tenant_id = p_tenant_id));
end;
$$;
revoke all on function public.lead_playbook_get(uuid) from public, anon;
grant execute on function public.lead_playbook_get(uuid) to authenticated;

create function public.lead_playbook_save(p_tenant_id uuid, p_playbook jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.knowledge_error('deny');
  end if;
  perform app.require_aal2();
  if p_playbook is null or jsonb_typeof(p_playbook) <> 'object' or octet_length(p_playbook::text) > 40000 or not app.text_is_clean(p_playbook) then
    perform app.knowledge_error('invalid');
  end if;
  insert into public.lead_playbooks (tenant_id, playbook, updated_by) values (p_tenant_id, p_playbook, auth.uid())
  on conflict (tenant_id) do update set playbook = excluded.playbook, updated_by = excluded.updated_by, updated_at = app.outbox_now();
  return public.lead_playbook_get(p_tenant_id);
end;
$$;
revoke all on function public.lead_playbook_save(uuid, jsonb) from public, anon;
grant execute on function public.lead_playbook_save(uuid, jsonb) to authenticated;

create function public.lead_playbook_reset(p_tenant_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.knowledge_error('deny');
  end if;
  perform app.require_aal2();
  delete from public.lead_playbooks where tenant_id = p_tenant_id;
  return public.lead_playbook_get(p_tenant_id);
end;
$$;
revoke all on function public.lead_playbook_reset(uuid) from public, anon;
grant execute on function public.lead_playbook_reset(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. the sources
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.knowledge_source_json(s public.knowledge_sources) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', s.id, 'title', s.title, 'kind', s.kind, 'filename', s.filename, 'content_type', s.content_type, 'chars', s.chars, 'status', s.status, 'created_at', s.created_at,
    'facts', jsonb_build_object(
      'draft',    (select count(*) from public.knowledge_facts f where f.tenant_id = s.tenant_id and f.source_id = s.id and f.status = 'draft'),
      'approved', (select count(*) from public.knowledge_facts f where f.tenant_id = s.tenant_id and f.source_id = s.id and f.status = 'approved'),
      'rejected', (select count(*) from public.knowledge_facts f where f.tenant_id = s.tenant_id and f.source_id = s.id and f.status = 'rejected')))
$$;
revoke all on function app.knowledge_source_json(public.knowledge_sources) from public, anon, authenticated, service_role;

create function public.knowledge_source_add(p_tenant_id uuid, p_id uuid, p_kind text, p_title text, p_filename text, p_content_type text, p_text text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.knowledge_sources;
  v_title text := btrim(coalesce(p_title, ''));
  v_text text := btrim(coalesce(p_text, ''));
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.knowledge_error('deny');
  end if;
  if p_id is null or p_kind is null or p_kind not in ('paste', 'file') or char_length(v_title) not between 1 and 120 or char_length(v_text) not between 1 and 60000
     or not app.text_is_clean(v_title) or not app.text_is_clean(v_text) or (p_kind = 'file' and (p_filename is null or p_content_type is null)) then
    perform app.knowledge_error('invalid');
  end if;
  select * into s from public.knowledge_sources x where x.id = p_id;
  if found then
    if s.tenant_id <> p_tenant_id then
      perform app.knowledge_error('invalid');
    end if;
    return app.knowledge_source_json(s);   -- a retry
  end if;
  if (select count(*) from public.knowledge_sources x where x.tenant_id = p_tenant_id and x.status <> 'discarded') >= 50 then
    perform app.knowledge_error('limit');
  end if;
  insert into public.knowledge_sources (id, tenant_id, kind, title, filename, content_type, text, chars, created_by)
  values (p_id, p_tenant_id, p_kind, v_title, case when p_kind = 'file' then left(p_filename, 200) end, case when p_kind = 'file' then p_content_type end, v_text, char_length(v_text), auth.uid())
  returning * into s;
  return app.knowledge_source_json(s);
end;
$$;
revoke all on function public.knowledge_source_add(uuid, uuid, text, text, text, text, text) from public, anon;
grant execute on function public.knowledge_source_add(uuid, uuid, text, text, text, text, text) to authenticated;

create function public.knowledge_sources_list(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.knowledge_error('deny');
  end if;
  return coalesce((select jsonb_agg(app.knowledge_source_json(s) order by s.created_at desc, s.id) from public.knowledge_sources s where s.tenant_id = p_tenant_id and s.status <> 'discarded'), '[]'::jsonb);
end;
$$;
revoke all on function public.knowledge_sources_list(uuid) from public, anon;
grant execute on function public.knowledge_sources_list(uuid) to authenticated;

-- the text of one source (the API sends it to the model as UNTRUSTED data)
create function public.knowledge_source_text(p_tenant_id uuid, p_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.knowledge_sources;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.knowledge_error('deny');
  end if;
  select * into s from public.knowledge_sources x where x.tenant_id = p_tenant_id and x.id = p_id and x.status <> 'discarded';
  if not found then
    perform app.knowledge_error('reference');
  end if;
  return jsonb_build_object('id', s.id, 'title', s.title, 'text', s.text);
end;
$$;
revoke all on function public.knowledge_source_text(uuid, uuid) from public, anon;
grant execute on function public.knowledge_source_text(uuid, uuid) to authenticated;

create function public.knowledge_source_discard(p_tenant_id uuid, p_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.knowledge_sources;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.knowledge_error('deny');
  end if;
  select * into s from public.knowledge_sources x where x.tenant_id = p_tenant_id and x.id = p_id for update;
  if not found then
    perform app.knowledge_error('reference');
  end if;
  if s.status <> 'discarded' then
    delete from public.knowledge_facts f where f.tenant_id = p_tenant_id and f.source_id = p_id and f.status = 'draft';   -- the undecided drafts go with it; approved and rejected facts stay
    update public.knowledge_sources set status = 'discarded', discarded_at = app.outbox_now() where id = p_id returning * into s;
  end if;
  return app.knowledge_source_json(s);
end;
$$;
revoke all on function public.knowledge_source_discard(uuid, uuid) from public, anon;
grant execute on function public.knowledge_source_discard(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. the facts
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.knowledge_fact_json(f public.knowledge_facts, p_me uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', f.id, 'kind', f.kind, 'text', f.text, 'status', f.status, 'edited', f.edited, 'source_id', f.source_id, 'created_at', f.created_at,
                            'decided_at', f.decided_at, 'decided_by_you', f.decided_by is not null and f.decided_by = p_me)
$$;
revoke all on function app.knowledge_fact_json(public.knowledge_facts, uuid) from public, anon, authenticated, service_role;

-- the model's draft: replaces the source's still-undecided drafts, keeps what was decided. p_facts = [{"id": uuid, "kind": "...", "text": "..."}]
create function public.knowledge_facts_draft_replace(p_tenant_id uuid, p_source_id uuid, p_facts jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s public.knowledge_sources;
  e jsonb;
  v_kind text;
  v_text text;
  v_out jsonb := '[]'::jsonb;
  f public.knowledge_facts;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.knowledge_error('deny');
  end if;
  if p_facts is null or jsonb_typeof(p_facts) <> 'array' or jsonb_array_length(p_facts) > 40 then
    perform app.knowledge_error('invalid');
  end if;
  select * into s from public.knowledge_sources x where x.tenant_id = p_tenant_id and x.id = p_source_id and x.status <> 'discarded' for update;
  if not found then
    perform app.knowledge_error('reference');
  end if;
  delete from public.knowledge_facts x where x.tenant_id = p_tenant_id and x.source_id = p_source_id and x.status = 'draft';
  for e in select * from jsonb_array_elements(p_facts) loop
    v_kind := e ->> 'kind';
    v_text := btrim(coalesce(e ->> 'text', ''));
    if (e ->> 'id') is null or v_kind is null or char_length(v_text) not between 3 and 500 then
      perform app.knowledge_error('invalid');
    end if;
    insert into public.knowledge_facts (id, tenant_id, source_id, kind, text, created_by) values ((e ->> 'id')::uuid, p_tenant_id, p_source_id, v_kind, v_text, auth.uid()) returning * into f;
    v_out := v_out || jsonb_build_array(app.knowledge_fact_json(f, auth.uid()));
  end loop;
  update public.knowledge_sources set status = 'drafted' where id = p_source_id;
  return v_out;
end;
$$;
revoke all on function public.knowledge_facts_draft_replace(uuid, uuid, jsonb) from public, anon;
grant execute on function public.knowledge_facts_draft_replace(uuid, uuid, jsonb) to authenticated;

create function public.knowledge_fact_add(p_tenant_id uuid, p_id uuid, p_kind text, p_text text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.knowledge_facts;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.knowledge_error('deny');
  end if;
  if p_id is null or p_kind is null or char_length(btrim(coalesce(p_text, ''))) not between 3 and 500 then
    perform app.knowledge_error('invalid');
  end if;
  select * into f from public.knowledge_facts x where x.id = p_id;
  if found then
    if f.tenant_id <> p_tenant_id then
      perform app.knowledge_error('invalid');
    end if;
    return app.knowledge_fact_json(f, auth.uid());
  end if;
  if (select count(*) from public.knowledge_facts x where x.tenant_id = p_tenant_id and x.status <> 'rejected') >= 500 then
    perform app.knowledge_error('limit');
  end if;
  insert into public.knowledge_facts (id, tenant_id, kind, text, created_by) values (p_id, p_tenant_id, p_kind, btrim(p_text), auth.uid()) returning * into f;
  return app.knowledge_fact_json(f, auth.uid());
end;
$$;
revoke all on function public.knowledge_fact_add(uuid, uuid, text, text) from public, anon;
grant execute on function public.knowledge_fact_add(uuid, uuid, text, text) to authenticated;

create function public.knowledge_fact_edit(p_tenant_id uuid, p_id uuid, p_text text, p_kind text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.knowledge_facts;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.knowledge_error('deny');
  end if;
  if char_length(btrim(coalesce(p_text, ''))) not between 3 and 500 then
    perform app.knowledge_error('invalid');
  end if;
  select * into f from public.knowledge_facts x where x.tenant_id = p_tenant_id and x.id = p_id for update;
  if not found then
    perform app.knowledge_error('reference');
  end if;
  update public.knowledge_facts set text = btrim(p_text), kind = coalesce(p_kind, kind), status = 'draft', edited = true, decided_by = null, decided_at = null where id = p_id returning * into f;
  return app.knowledge_fact_json(f, auth.uid());
end;
$$;
revoke all on function public.knowledge_fact_edit(uuid, uuid, text, text) from public, anon;
grant execute on function public.knowledge_fact_edit(uuid, uuid, text, text) to authenticated;

create function public.knowledge_fact_decide(p_tenant_id uuid, p_id uuid, p_decision text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  f public.knowledge_facts;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.knowledge_error('deny');
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    perform app.knowledge_error('invalid');
  end if;
  select * into f from public.knowledge_facts x where x.tenant_id = p_tenant_id and x.id = p_id for update;
  if not found then
    perform app.knowledge_error('reference');
  end if;
  if p_decision = 'approve' and f.kind = 'price' then
    -- a price the assistant may state is the Owner's decision, with the second factor
    if not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
      perform app.knowledge_error('deny');
    end if;
    perform app.require_aal2();
  end if;
  update public.knowledge_facts set status = case when p_decision = 'approve' then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = app.outbox_now() where id = p_id returning * into f;
  return app.knowledge_fact_json(f, auth.uid());
end;
$$;
revoke all on function public.knowledge_fact_decide(uuid, uuid, text) from public, anon;
grant execute on function public.knowledge_fact_decide(uuid, uuid, text) to authenticated;

-- Owner and Admin see every fact; Sales and Viewer only the approved ones (the facts the assistant may state)
create function public.knowledge_facts_list(p_tenant_id uuid, p_status text default null, p_source_id uuid default null, p_limit integer default 50, p_after_at timestamptz default null, p_after_id uuid default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_manager boolean;
  v_rows jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    perform app.knowledge_error('deny');
  end if;
  if p_limit is null or p_limit not between 1 and 100 or (p_status is not null and p_status not in ('draft', 'approved', 'rejected')) then
    perform app.knowledge_error('invalid');
  end if;
  v_manager := app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]);
  select coalesce(jsonb_agg(app.knowledge_fact_json(f, auth.uid()) order by f.created_at desc, f.id desc), '[]'::jsonb) into v_rows from (
    select * from public.knowledge_facts x
     where x.tenant_id = p_tenant_id and (v_manager or x.status = 'approved') and (p_status is null or x.status = p_status) and (p_source_id is null or x.source_id = p_source_id)
       and (p_after_at is null or (x.created_at, x.id) < (p_after_at, p_after_id))
     order by x.created_at desc, x.id desc limit p_limit) f;
  return v_rows;
end;
$$;
revoke all on function public.knowledge_facts_list(uuid, text, uuid, integer, timestamptz, uuid) from public, anon;
grant execute on function public.knowledge_facts_list(uuid, text, uuid, integer, timestamptz, uuid) to authenticated;

-- what the assistant may state: the approved facts, compactly (every member: a Sales person's draft uses them)
create function public.knowledge_facts_approved(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    perform app.knowledge_error('deny');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('kind', f.kind, 'text', f.text) order by f.decided_at, f.id) from (
           select * from public.knowledge_facts x where x.tenant_id = p_tenant_id and x.status = 'approved' order by x.decided_at, x.id limit 200) f), '[]'::jsonb);
end;
$$;
revoke all on function public.knowledge_facts_approved(uuid) from public, anon;
grant execute on function public.knowledge_facts_approved(uuid) to authenticated;
