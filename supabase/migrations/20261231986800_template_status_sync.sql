-- WhatsApp's decision on our templates, read by the system and put in front of the owner (planner, 20 Nov 2026; Customer Zero code list item 3, part 2). Until now a template stayed `submitted` until somebody pressed
-- "Check WhatsApp's answer": right after Connect the owner would not know which messages WhatsApp approved or sent back.
--   * the worker (system account) asks each connected account for the status of its submitted templates every few minutes and writes it here (scheduler_wa_templates_due / scheduler_wa_templates_decided; the decision
--     is audited when it changes); nothing in it is a credential;
--   * a template that WhatsApp sent back (rejected, paused or disabled) is a "Needs you" item for the Owner and Admin: kind `message_needs_change`, pointing at the message (Chats, Templates), one item per message name,
--     gone when the message is approved again or after 30 days. Meta's own closed reason word (INVALID_FORMAT, ...) is kept next to it, never Meta's prose.

alter table integrations.wa_templates add column checked_at timestamptz;
alter table integrations.wa_templates add column reject_code text check (reject_code is null or reject_code ~ '^[A-Z][A-Z0-9_]{1,39}$');
comment on column integrations.wa_templates.checked_at is 'SAFE: a time. CLEAN-EXEMPT: a time';
comment on column integrations.wa_templates.reject_code is 'SAFE: Meta''s own closed reason word (INVALID_FORMAT, TAG_CONTENT_MISMATCH ...). CLEAN-EXEMPT: pattern CHECK';

-- the accounts that have submitted templates not asked about for p_minutes minutes: where to ask and for which messages
create function public.scheduler_wa_templates_due(p_limit integer default 20, p_minutes integer default 10) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
begin
  perform ops.system_only();
  if p_limit is null or p_limit not between 1 and 100 or p_minutes is null or p_minutes not between 1 and 1440 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  return coalesce((select jsonb_agg(x.j) from (
    select jsonb_build_object('tenant_id', a.tenant_id, 'waba_id', a.waba_id, 'token_ref', a.token_ref,
                              'templates', (select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'meta_name', t.meta_name, 'language', t.language) order by t.name, t.language)
                                              from integrations.wa_templates t
                                             where t.tenant_id = a.tenant_id and t.status = 'submitted' and (t.checked_at is null or t.checked_at <= now() - make_interval(mins => p_minutes)))) as j
      from integrations.whatsapp_accounts a
     where a.status = 'active'
       and exists (select 1 from integrations.wa_templates t where t.tenant_id = a.tenant_id and t.status = 'submitted' and (t.checked_at is null or t.checked_at <= now() - make_interval(mins => p_minutes)))
     order by a.updated_at
     limit p_limit) x), '[]'::jsonb);
end $$;
revoke all on function public.scheduler_wa_templates_due(integer, integer) from public, anon;
grant execute on function public.scheduler_wa_templates_due(integer, integer) to authenticated;

-- what WhatsApp said about some of one business's templates: [{id, status, reject_code}]. Every named template is marked as asked; its status changes only when WhatsApp's word is different (and never for a draft).
create function public.scheduler_wa_templates_decided(p_tenant_id uuid, p_decisions jsonb) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  d       jsonb;
  t       integrations.wa_templates;
  v_new   text;
  v_code  text;
  v_n     integer := 0;
begin
  perform ops.system_only();
  if p_tenant_id is null or p_decisions is null or jsonb_typeof(p_decisions) <> 'array' or jsonb_array_length(p_decisions) > 200 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  for d in select * from jsonb_array_elements(p_decisions) loop
    v_new := d ->> 'status';
    v_code := nullif(d ->> 'reject_code', '');
    if v_new is null or v_new not in ('submitted', 'approved', 'rejected', 'paused', 'disabled') or (v_code is not null and v_code !~ '^[A-Z][A-Z0-9_]{1,39}$') then
      raise exception 'invalid input' using errcode = '22023';
    end if;
    select * into t from integrations.wa_templates x where x.tenant_id = p_tenant_id and x.id = (d ->> 'id')::uuid for update;
    continue when not found or t.status = 'draft';
    if t.status is distinct from v_new then
      update integrations.wa_templates set status = v_new, reject_code = case when v_new in ('rejected', 'paused', 'disabled') then v_code else null end, checked_at = now(), updated_at = now() where id = t.id;
      perform app.write_audit_event(p_tenant_id, 'whatsapp.template_' || v_new, 'wa_template', t.id, null, jsonb_build_object('status', v_new, 'source', 'sync'));
      v_n := v_n + 1;
    else
      update integrations.wa_templates set checked_at = now(), reject_code = case when v_new in ('rejected', 'paused', 'disabled') then coalesce(v_code, reject_code) else null end where id = t.id;
    end if;
  end loop;
  return jsonb_build_object('changed', v_n);
end $$;
revoke all on function public.scheduler_wa_templates_decided(uuid, jsonb) from public, anon;
grant execute on function public.scheduler_wa_templates_decided(uuid, jsonb) to authenticated;

-- the messages WhatsApp sent back, for Today: one per message name (the newest language), for the Owner and Admin of the workspace asking, not older than 30 days
create function app.today_templates_needing_change(p_tenant uuid) returns table (id uuid, name text, status text, at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct on (t.name) t.id, t.name, t.status, t.updated_at
    from integrations.wa_templates t
   where auth.uid() is not null and t.tenant_id = p_tenant and app.has_tenant_role(p_tenant, array['owner', 'admin']::public.app_role[])
     and t.status in ('rejected', 'paused', 'disabled') and t.updated_at > now() - interval '30 days'
     and not exists (select 1 from integrations.wa_templates ok where ok.tenant_id = t.tenant_id and ok.name = t.name and ok.language = t.language and ok.status = 'approved')
   order by t.name, t.updated_at desc
$$;
revoke all on function app.today_templates_needing_change(uuid) from public;
grant execute on function app.today_templates_needing_change(uuid) to authenticated;   -- today_summary runs as the caller; this answers the caller's own workspace and only for its Owner and Admin

do $patch$
declare
  v_def    text := pg_get_functiondef('public.today_summary(uuid)'::regprocedure);
  v_marker constant text := E'     where v_decider and f.students > 0\n';
  v_new    text;
begin
  if position(v_marker in v_def) = 0 then
    raise exception 'needs-you: the Today function is not the one this migration expects';
  end if;
  v_new := replace(v_def, v_marker, v_marker
    || E'    union all\n'
    || E'    select ''message_needs_change'', tn.id, ''WhatsApp message''::text, null::text, ''followup_desk'', replace(tn.name, ''_'', '' ''), null::bigint, tn.at, ''message'', tn.id\n'
    || E'      from app.today_templates_needing_change(p_tenant_id) tn\n'
    || E'     where v_decider\n');
  execute v_new;
end
$patch$;
