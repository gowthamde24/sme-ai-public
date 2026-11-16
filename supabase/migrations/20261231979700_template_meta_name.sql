-- The name Meta knows a template by (owner's 16 Nov 2026 submit): Meta refuses a template whose name it already holds in that language, and it already held approved visit_reminder, visit_confirmation and
-- missed_call_followup (all four languages, the older words). The new words go to Meta under another name (`meta_name`, e.g. visit_reminder_v2) while everything in the app keeps using the template's own name.
--   * integrations.wa_templates.meta_name: null = Meta knows it by `name`. Unique per business and language when set.
--   * public.wa_template_save takes it; the template's JSON shows it; what the sender is told names the template by it (that is what Meta's send call needs).

alter table integrations.wa_templates add column meta_name text check (meta_name is null or meta_name ~ '^[a-z][a-z0-9_]{0,59}$');
create unique index wa_templates_meta_name_key on integrations.wa_templates (tenant_id, meta_name, language) where meta_name is not null;
comment on column integrations.wa_templates.meta_name is 'SAFE: the name Meta knows the template by when it differs from `name` (lowercase letters, digits, underscore); never customer data';

create or replace function app.wa_template_json(t integrations.wa_templates) returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object('id', t.id, 'name', t.name, 'meta_name', t.meta_name, 'language', t.language, 'category', t.category, 'purpose', t.purpose, 'body', t.body, 'opt_out_label', t.opt_out_label, 'status', t.status, 'updated_at', t.updated_at)
$$;

drop function public.wa_template_save(uuid, uuid, text, text, text, text, text, text);
create function public.wa_template_save(p_id uuid, p_tenant_id uuid, p_name text, p_language text, p_category text, p_purpose text, p_body text, p_opt_out_label text default null, p_meta_name text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t integrations.wa_templates;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.wa_error('deny');
  end if;
  if p_id is null or p_name is null or p_language is null or p_category is null or p_purpose is null or p_body is null then
    perform app.wa_error('invalid');
  end if;
  select * into t from integrations.wa_templates x where x.id = p_id;
  if found then
    if t.tenant_id <> p_tenant_id then
      perform app.wa_error('invalid');
    end if;
    if t.status in ('approved', 'submitted') then
      perform app.wa_error('state');   -- a template under review or approved is not edited: make a new one
    end if;
  end if;
  begin
    insert into integrations.wa_templates as x (id, tenant_id, name, language, category, purpose, body, opt_out_label, meta_name, created_by)
    values (p_id, p_tenant_id, btrim(p_name), p_language, p_category, p_purpose, btrim(p_body), nullif(btrim(coalesce(p_opt_out_label, '')), ''), nullif(btrim(coalesce(p_meta_name, '')), ''), auth.uid())
    on conflict (id) do update set name = excluded.name, language = excluded.language, category = excluded.category, purpose = excluded.purpose, body = excluded.body,
                                   opt_out_label = excluded.opt_out_label, meta_name = excluded.meta_name, status = 'draft', updated_at = now()
    returning x.* into t;
  exception
    when unique_violation then perform app.wa_error('used');
    when check_violation then perform app.wa_error('invalid');
  end;
  perform app.write_audit_event(p_tenant_id, 'whatsapp.template_saved', 'wa_template', t.id, null, jsonb_build_object('purpose', t.purpose, 'language', t.language));
  return app.wa_template_json(t);
end;
$$;
revoke all on function public.wa_template_save(uuid, uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.wa_template_save(uuid, uuid, text, text, text, text, text, text, text) to authenticated;

-- the sender names the template as Meta knows it
do $patch$
declare
  v_def text := pg_get_functiondef('app.wa_send_context(public.outbox_messages, timestamp with time zone)'::regprocedure);
  v_old text := $q$jsonb_build_object('name', t.name, 'language', t.language, 'body', t.body)$q$;
  v_new text := $q$jsonb_build_object('name', coalesce(t.meta_name, t.name), 'language', t.language, 'body', t.body)$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'wa_send_context has changed: the meta-name patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

-- chat promises: a deadline the customer named may already be behind us when an old promise is written down (a backfill): it is kept (an overdue promise is more urgent, not less)
do $patch$
declare
  v_def text := pg_get_functiondef('public.scheduler_auto_reply_note(uuid, boolean, text, text, date, text)'::regprocedure);
  v_old text := $q$p_needed_by between v_today and v_today + 120$q$;
  v_new text := $q$p_needed_by between v_today - 90 and v_today + 120$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'scheduler_auto_reply_note has changed: the deadline patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;
