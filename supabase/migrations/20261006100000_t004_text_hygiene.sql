-- T004 hardening: invisible Unicode in free text.
--
-- Text that a person (or an agent, or a scraped page) can type ends up in prompts later. Characters
-- that render as nothing (Unicode "tag" characters U+E0000..E007F, zero-width space, BOM, line /
-- paragraph separators, invisible operators) let instructions for a language model hide in plain
-- sight. One shared IMMUTABLE function says whether a string is clean; CHECK constraints call it on
-- every free-text column of every tenant-owned table (enumerated from the catalog below).
--
-- Blocked (false):
--   * C0 controls except tab, line feed, carriage return: U+0001..0008, 000B, 000C, 000E..001F
--   * DEL and the C1 controls U+007F..009F
--   * U+200B zero-width space, U+2028 / U+2029 line and paragraph separators, U+202A..202E bidi
--     embeddings / overrides, U+2060..2064 word joiner and invisible operators,
--     U+2066..2069 bidi isolates, U+FEFF byte-order mark
--   * U+E0000..E007F tag characters
-- Deliberately NOT blocked: U+200C / U+200D (zero-width non-joiner / joiner: required to spell words
-- in Indic and Persian scripts) and U+200E / U+200F (left-to-right / right-to-left marks).
--
-- CHECK constraints run with the privileges of the inserting role, so authenticated needs EXECUTE.
-- The function reads nothing and has no side effects.

create function app.text_is_clean(p text) returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p is null or p !~ '[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u2069\ufeff\U000e0000-\U000e007f]'
$$;

-- text[] (tags): every element must be clean. A separator that is itself allowed text keeps the
-- elements from forming a blocked character across a boundary (none can).
create function app.text_is_clean(p text[]) returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p is null or app.text_is_clean(array_to_string(p, E'\n'))
$$;

-- jsonb: scanned through its text rendering. Invisible characters appear raw there; C0 controls
-- appear as JSON escapes (\b, \f, \u0001..\u001f except \t \n \r), so those are matched too, but
-- only when the backslash really starts an escape (an even number of backslashes before it), so a
-- string that merely contains the characters backslash + b is fine.
create function app.text_is_clean(p jsonb) returns boolean
language sql
immutable
parallel safe
set search_path = ''
as $$
  select p is null or (
    app.text_is_clean(p::text)
    and p::text !~* '(^|[^\\])(\\\\)*\\(u00(0[0-8bcef]|1[0-9a-f])|[bf])'
  )
$$;

revoke all on function app.text_is_clean(text) from public;
revoke all on function app.text_is_clean(text[]) from public;
revoke all on function app.text_is_clean(jsonb) from public;
grant execute on function app.text_is_clean(text) to authenticated;
grant execute on function app.text_is_clean(text[]) to authenticated;
grant execute on function app.text_is_clean(jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- T004 columns: replace the inline character classes, keep every other rule.
-- ---------------------------------------------------------------------------------------------
alter table public.evidence drop constraint evidence_url_check;
alter table public.evidence add constraint evidence_url_check check (
  char_length(url) between 8 and 2048
  and url ~* '^https?://[^/?#@[:space:][:cntrl:]<>"''\\]+([/?#][^[:space:][:cntrl:]<>"''\\]*)?$'
  and app.text_is_clean(url));

alter table public.evidence drop constraint evidence_snippet_check;
alter table public.evidence add constraint evidence_snippet_check check (
  char_length(snippet) between 1 and 1000
  and btrim(snippet, E' \t\r\n') <> ''
  and app.text_is_clean(snippet));

alter table public.claims drop constraint claims_value_check;
alter table public.claims add constraint claims_value_check check (
  char_length(value) between 1 and 500
  and btrim(value, E' \t\r\n') <> ''
  and app.text_is_clean(value));

-- ---------------------------------------------------------------------------------------------
-- Every other free-text column of a tenant-owned table, from the catalog (not from memory).
-- Exempt, with a documented reason in the column comment (CLEAN-EXEMPT:), because a strict
-- anchored regex already limits the characters or no client can write them:
--   consent_events.evidence_ref, evidence.provider, evidence.reference, claims.predicate
--   audit_events.* (written only by the SECURITY DEFINER audit writer)
-- ---------------------------------------------------------------------------------------------
do $$
declare
  r record;
  exempt text[] := array[
    'consent_events.evidence_ref', 'evidence.provider', 'evidence.reference', 'claims.predicate'];
  expr text;
begin
  for r in
    select c.relname, a.attname, a.atttypid
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public' and c.relkind = 'r'
      join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
     where exists (select 1 from pg_attribute t where t.attrelid = c.oid and t.attname = 'tenant_id' and not t.attisdropped)
       and a.atttypid in ('text'::regtype, 'varchar'::regtype, 'text[]'::regtype, 'jsonb'::regtype)
       and c.relname <> 'audit_events'
       and (c.relname || '.' || a.attname) <> all (exempt)
       -- already guarded by the constraints replaced above
       and not exists (select 1 from pg_constraint k
                        where k.conrelid = c.oid and k.contype = 'c' and a.attnum = any (k.conkey)
                          and pg_get_constraintdef(k.oid) like '%text_is_clean(%')
     order by c.relname, a.attnum
  loop
    expr := format('app.text_is_clean(%I)', r.attname);
    execute format('alter table public.%I add constraint %I check (%s)', r.relname, r.relname || '_' || r.attname || '_clean', expr);
  end loop;
end $$;

-- Documented exceptions (read by the guard in supabase/tests/database/06): the existing comment is
-- kept and the exemption is appended.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('consent_events', 'evidence_ref', 'strict anchored pattern (letters, digits and . _ : / # - only)'),
      ('evidence',       'provider',     'strict anchored slug pattern'),
      ('evidence',       'reference',    'strict anchored pattern (letters, digits and . _ : / # - only)'),
      ('claims',         'predicate',    'strict anchored slug pattern')) as t(tbl, col, why)
  loop
    execute format('comment on column public.%I.%I is %L', r.tbl, r.col,
      col_description(format('public.%I', r.tbl)::regclass,
                      (select attnum from pg_attribute where attrelid = format('public.%I', r.tbl)::regclass and attname = r.col))
      || ' CLEAN-EXEMPT: ' || r.why);
  end loop;
end $$;

do $$
declare r record;
begin
  for r in
    select a.attname
      from pg_attribute a
     where a.attrelid = 'public.audit_events'::regclass and a.attnum > 0 and not a.attisdropped
       and a.atttypid in ('text'::regtype, 'varchar'::regtype, 'text[]'::regtype, 'jsonb'::regtype)
  loop
    execute format('comment on column public.audit_events.%I is %L', r.attname,
      'CLEAN-EXEMPT: written only by the SECURITY DEFINER audit writer (never by a client); PII columns are recorded by name only; request_id is sanitised by the writer');
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- audit_events.request_id is the one audit column influenced by a client (the X-Request-Id header,
-- capped at 100 characters by T003). A header with invisible characters is dropped, not stored.
-- ---------------------------------------------------------------------------------------------
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

  insert into public.audit_events (
    tenant_id, actor_user_id, actor_type, action, entity_type, entity_id,
    old_values, new_values, metadata, request_id
  ) values (
    p_tenant_id,
    v_uid,
    case when v_uid is null then 'system' else 'user' end,
    p_action,
    p_entity_type,
    p_entity_id,
    p_old,
    p_new,
    coalesce(p_metadata, '{}'::jsonb),
    v_request_id
  );
end;
$$;
