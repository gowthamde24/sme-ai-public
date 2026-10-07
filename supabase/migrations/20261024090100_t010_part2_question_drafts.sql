-- T010 part 2, migration 2 of 2 (ADR 0018 decision 6: "persisted question drafts and their approval state belong to the T010 integration"; plan section 2.2 and decision 10):
-- PERSISTED QUESTION DRAFTS. The clarifying questions of a requirement (missing, low-certainty and conflicting fields) are derived by the API from closed templates (app/requirements/questions.py)
-- and stored here with an approval state, for a person to copy. NOTHING IS SENT. No model.
--
--   question_drafts                 one ACTIVE (draft or approved) question per (tenant, requirement, question code, line); draft -> approved, or discarded
--   public.persist_question_drafts  Owner / Admin / Sales, any assurance level: SYNCS the stored questions with the set the API derived (a changed text supersedes, a resolved question is discarded)
--   public.decide_question_draft    Owner / Admin / Sales: approve or discard one
--
-- What the database proves, and what it cannot: it proves the tenant, the role, the state machine, one active question per (requirement, code, line), and that every text is capped,
-- hygienic, and holds NO contact data (app.text_has_contact), a code from the closed list and a line 0..5. It cannot re-derive the TEXT from the requirement's fields (that is the API's
-- closed-template code): the text is the API's word within those caps, a person reads it before approving, and nothing leaves the system. The option-A limit applies (a member who talks to
-- PostgREST directly could store another closed-looking text); no customer text can reach it from the API (the templates echo closed vocabulary, a whole number and a date only).
--
-- Lock order: the REQUIREMENT row, then the question rows of that requirement (one lock, no parent above it taken here). SQLSTATEs: the part 2 family (app.followup_error): SM223 detail closed
-- (the requirement is not open, or the question is closed), 42501 before the role is proven, 22023 / 23514 / 23503 / 23505 as for the other functions.

create type public.question_draft_status as enum ('draft', 'approved', 'discarded');
-- why a question was discarded: a person did, or the system did (the flag was resolved, or the question text changed)
create type public.question_discard_code as enum ('person', 'resolved', 'superseded');

create table public.question_drafts (
  id              uuid primary key,
  tenant_id       uuid not null references public.tenants (id) on delete restrict,
  requirement_id  uuid not null,
  -- 0 = the whole enquiry; 1..5 = a requirement line
  line_no         smallint not null default 0 check (line_no between 0 and 5),
  question_code   text not null check (question_code ~ '^(missing|conflicting|confirm)_(saree_type|fabric|colour|quantity|budget|deadline|delivery_city|payment_terms)$'),
  question_text   text not null check (char_length(question_text) between 8 and 300 and app.text_is_clean(question_text) and not app.text_has_contact(question_text)),
  status          public.question_draft_status not null default 'draft',
  created_by      uuid,
  created_via     public.record_origin not null default 'manual',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  decided_by      uuid,
  decided_at      timestamptz,
  discard_code    public.question_discard_code,
  unique (tenant_id, id),
  foreign key (tenant_id, requirement_id) references public.requirements (tenant_id, id),
  check ((status = 'draft') = (decided_at is null)),
  check ((status = 'discarded') = (discard_code is not null))
);
create unique index question_drafts_one_active_key on public.question_drafts (tenant_id, requirement_id, question_code, line_no) where status in ('draft', 'approved');
create index question_drafts_requirement_idx on public.question_drafts (tenant_id, requirement_id, created_at);
create index question_drafts_keyset_idx      on public.question_drafts (tenant_id, created_at, id);
comment on column public.question_drafts.question_code is 'SAFE: a closed question code. CLEAN-EXEMPT: strict anchored pattern';
comment on column public.question_drafts.question_text is 'SAFE: a closed-template question that echoes closed vocabulary, a whole number or a date only (never a customer''s words, a name, a link or an amount); text_is_clean-guarded and refused when it holds contact data';

create function app.question_drafts_guard_insert() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'draft' or new.decided_at is not null or new.discard_code is not null then
    raise exception 'a question draft starts as a draft' using errcode = '42501';
  end if;
  return new;
end;
$$;

create function app.question_drafts_guard_update() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'status' - 'decided_by' - 'decided_at' - 'discard_code' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'decided_by' - 'decided_at' - 'discard_code' - 'updated_at') then
    raise exception 'question drafts are immutable: approve or discard them' using errcode = '42501';
  end if;
  if old.status = 'discarded' and (new.status is distinct from old.status or new.decided_at is distinct from old.decided_at) then
    raise exception 'a discarded question draft stays discarded' using errcode = '42501';
  end if;
  if new.status is distinct from old.status
     and not ((old.status = 'draft' and new.status in ('approved', 'discarded')) or (old.status = 'approved' and new.status = 'discarded')) then
    raise exception 'a question draft cannot move from % to %', old.status, new.status using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function app.question_drafts_guard_insert(), app.question_drafts_guard_update() from public;

create trigger question_drafts_forbid_tenant_id_change before update on public.question_drafts for each row execute function app.forbid_tenant_id_change();
create trigger question_drafts_set_created_meta        before insert or update on public.question_drafts for each row execute function app.set_created_meta();
create trigger question_drafts_set_updated_at          before update on public.question_drafts for each row execute function app.set_updated_at();
create trigger question_drafts_guard_insert            before insert on public.question_drafts for each row execute function app.question_drafts_guard_insert();
create trigger question_drafts_guard_update            before update on public.question_drafts for each row execute function app.question_drafts_guard_update();
create trigger question_drafts_forbid_delete           before delete on public.question_drafts for each row execute function app.followup_forbid_delete();
create trigger question_drafts_no_truncate             before truncate on public.question_drafts for each statement execute function app.followup_forbid_truncate();
create trigger audit_question_drafts                   after insert or update or delete on public.question_drafts for each row execute function app.audit_row_change('question_draft');

alter table public.question_drafts enable row level security;
alter table public.question_drafts force row level security;
revoke all on public.question_drafts from public, anon, authenticated;
create policy question_drafts_select on public.question_drafts for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));
grant select on public.question_drafts to authenticated;

-- ---------------------------------------------------------------------------------------------
-- public.persist_question_drafts: SYNC the stored questions of a requirement with the set the API derived. p_items is an array of {id, code, line, text}:
--   an active question with the same (code, line) and the same text is kept; with another text it is superseded and a new draft is stored; one that is no longer in the set is discarded
--   as resolved. A true retry (the same set) changes nothing. The ids are the caller's (new rows only).
-- ---------------------------------------------------------------------------------------------
create function public.persist_question_drafts(p_requirement_id uuid, p_items jsonb) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  q         public.requirements;
  v_item    jsonb;
  v_id      uuid;
  v_code    text;
  v_line    smallint;
  v_text    text;
  v_seen    text[] := '{}';
  v_key     text;
  v_cur     public.question_drafts;
  v_changed integer := 0;
  v_n       integer;
begin
  if v_uid is null or p_requirement_id is null then
    perform app.followup_deny();
  end if;
  select * into q from public.requirements x where x.id = p_requirement_id;
  if not found or not app.has_tenant_role(q.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.followup_deny();
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 40 then
    perform app.followup_error('invalid');
  end if;
  -- the shape of every item first (nothing is written until the whole set is valid)
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' or exists (select 1 from jsonb_object_keys(v_item) k where k <> all (array['id', 'code', 'line', 'text'])) or not (v_item ?& array['id', 'code', 'line', 'text'])
       or jsonb_typeof(v_item -> 'id') <> 'string' or (v_item ->> 'id') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(v_item -> 'code') <> 'string' or jsonb_typeof(v_item -> 'text') <> 'string'
       or (jsonb_typeof(v_item -> 'line') <> 'null' and (jsonb_typeof(v_item -> 'line') <> 'number' or (v_item ->> 'line') !~ '^[0-5]$')) then
      perform app.followup_error('invalid');
    end if;
    v_code := v_item ->> 'code';
    v_text := v_item ->> 'text';
    if v_code !~ '^(missing|conflicting|confirm)_(saree_type|fabric|colour|quantity|budget|deadline|delivery_city|payment_terms)$'
       or char_length(v_text) not between 8 and 300 or not app.text_is_clean(v_text) or app.text_has_contact(v_text) then
      perform app.followup_error('value');
    end if;
    v_key := v_code || ':' || coalesce(v_item ->> 'line', '0');
    if v_key = any (v_seen) then
      perform app.followup_error('invalid');
    end if;
    v_seen := array_append(v_seen, v_key);
  end loop;

  -- lock order: the requirement row, then its question rows
  select * into q from public.requirements x where x.id = p_requirement_id for update;
  if q.status not in ('draft', 'confirmed') then
    perform app.followup_error('SM223', 'closed');
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_id := (v_item ->> 'id')::uuid;
    v_code := v_item ->> 'code';
    v_line := coalesce((v_item ->> 'line')::smallint, 0);
    v_text := v_item ->> 'text';
    select * into v_cur from public.question_drafts d
     where d.tenant_id = q.tenant_id and d.requirement_id = q.id and d.question_code = v_code and d.line_no = v_line and d.status in ('draft', 'approved');
    if found and v_cur.question_text = v_text then
      continue;
    end if;
    if found then
      update public.question_drafts d set status = 'discarded', decided_at = now(), decided_by = v_uid, discard_code = 'superseded' where d.id = v_cur.id;
      v_changed := v_changed + 1;
    end if;
    if exists (select 1 from public.question_drafts d where d.id = v_id) then
      perform app.followup_error('conflict');
    end if;
    insert into public.question_drafts (id, tenant_id, requirement_id, line_no, question_code, question_text) values (v_id, q.tenant_id, q.id, v_line, v_code, v_text);
    v_changed := v_changed + 1;
  end loop;

  -- a question that is no longer derived is resolved
  update public.question_drafts d set status = 'discarded', decided_at = now(), decided_by = v_uid, discard_code = 'resolved'
   where d.tenant_id = q.tenant_id and d.requirement_id = q.id and d.status in ('draft', 'approved')
     and (d.question_code || ':' || d.line_no::text) <> all (v_seen);
  get diagnostics v_n = row_count;
  v_changed := v_changed + v_n;

  return jsonb_build_object('requirement_id', q.id, 'changed', v_changed,
    'drafts', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'code', d.question_code, 'line', d.line_no, 'status', d.status) order by d.question_code, d.line_no), '[]'::jsonb)
                 from public.question_drafts d where d.tenant_id = q.tenant_id and d.requirement_id = q.id and d.status in ('draft', 'approved')));
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- public.decide_question_draft: approve or discard one question. A repeat of the same decision replays; a closed question stays closed.
-- ---------------------------------------------------------------------------------------------
create function public.decide_question_draft(p_draft_id uuid, p_decision text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  d     public.question_drafts;
begin
  if v_uid is null or p_draft_id is null then
    perform app.followup_deny();
  end if;
  select * into d from public.question_drafts x where x.id = p_draft_id;
  if not found or not app.has_tenant_role(d.tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.followup_deny();
  end if;
  if p_decision is null or p_decision not in ('approve', 'discard') then
    perform app.followup_error('invalid');
  end if;
  -- lock order: the requirement row, then the question row
  perform 1 from public.requirements r where r.tenant_id = d.tenant_id and r.id = d.requirement_id for update;
  select * into d from public.question_drafts x where x.id = p_draft_id for update;
  if (p_decision = 'approve' and d.status = 'approved') or (p_decision = 'discard' and d.status = 'discarded') then
    return jsonb_build_object('draft_id', d.id, 'status', d.status, 'replayed', true);
  end if;
  if d.status = 'discarded' then
    perform app.followup_error('SM223', 'closed');
  end if;
  if p_decision = 'approve' then
    update public.question_drafts x set status = 'approved', decided_by = v_uid, decided_at = now() where x.id = d.id;
  else
    update public.question_drafts x set status = 'discarded', decided_by = v_uid, decided_at = now(), discard_code = 'person' where x.id = d.id;
  end if;
  return jsonb_build_object('draft_id', d.id, 'status', case p_decision when 'approve' then 'approved' else 'discarded' end, 'replayed', false);
end;
$$;

revoke all on function public.persist_question_drafts(uuid, jsonb), public.decide_question_draft(uuid, text) from public, anon;
grant execute on function public.persist_question_drafts(uuid, jsonb), public.decide_question_draft(uuid, text) to authenticated;
