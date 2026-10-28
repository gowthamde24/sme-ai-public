-- Job DT (ADR 0116): THE OPENING LINE AND "MENTION THAT I'M AN AI ASSISTANT" (landing-v2 job, C1 part 1).
--
--   workspace.opening_lines      the Owner's own opening line per language, per workspace or per campaign (a campaign row overrides the workspace row)
--   workspace.opening_settings   the "mention that I'm an AI assistant in the greeting" switch, per workspace (default ON) or per campaign
--   public.opening_get/_set_line/_set_mention   Owner only (reads: any member); every change of the switch is in the audit log with who and when
--
-- The line may hold the placeholders {customer} {assistant} {business} {agent_role} and nothing else in braces. A null text resets a line to the default (the row is removed).
-- SQLSTATEs: 42501 deny, 22023 invalid.

create table workspace.opening_lines (
  workspace_id uuid not null references public.tenants (id) on delete restrict,
  language     text not null check (language in ('en', 'te', 'hi', 'kn', 'ta', 'ml', 'mr', 'bn')),
  campaign_key uuid not null default '00000000-0000-0000-0000-000000000000',
  line         text not null check (char_length(btrim(line)) between 10 and 300 and app.text_is_clean(line)
                                    and not (regexp_replace(line, '\{(customer|assistant|business|agent_role)\}', '', 'g') ~ '[{}]')),
  updated_by   uuid,
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, language, campaign_key)
);
alter table workspace.opening_lines enable row level security;
alter table workspace.opening_lines force row level security;
revoke all on workspace.opening_lines from public, anon, authenticated, service_role;

create table workspace.opening_settings (
  workspace_id uuid not null references public.tenants (id) on delete restrict,
  campaign_key uuid not null default '00000000-0000-0000-0000-000000000000',
  mention_ai   boolean not null,
  updated_by   uuid,
  updated_at   timestamptz not null default now(),
  primary key (workspace_id, campaign_key)
);
alter table workspace.opening_settings enable row level security;
alter table workspace.opening_settings force row level security;
revoke all on workspace.opening_settings from public, anon, authenticated, service_role;

create function app.opening_json(p_tenant uuid) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'mention_ai', coalesce((select s.mention_ai from workspace.opening_settings s where s.workspace_id = p_tenant and s.campaign_key = '00000000-0000-0000-0000-000000000000'), true),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('language', l.language, 'campaign_id', case when l.campaign_key = '00000000-0000-0000-0000-000000000000' then null else l.campaign_key end,
                                                           'text', l.line, 'updated_at', l.updated_at) order by l.language, l.campaign_key)
                         from workspace.opening_lines l where l.workspace_id = p_tenant), '[]'::jsonb),
    'campaign_overrides', coalesce((select jsonb_agg(jsonb_build_object('campaign_id', s.campaign_key, 'mention_ai', s.mention_ai) order by s.campaign_key)
                                      from workspace.opening_settings s where s.workspace_id = p_tenant and s.campaign_key <> '00000000-0000-0000-0000-000000000000'), '[]'::jsonb))
$$;
revoke all on function app.opening_json(uuid) from public;

create function public.opening_get(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.workspace_error('deny');
  end if;
  return app.opening_json(p_tenant_id);
end;
$$;
revoke all on function public.opening_get(uuid) from public, anon;
grant execute on function public.opening_get(uuid) to authenticated;

create function public.opening_set_line(p_tenant_id uuid, p_language text, p_campaign_id uuid, p_text text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key uuid := coalesce(p_campaign_id, '00000000-0000-0000-0000-000000000000');
  v_text text := nullif(btrim(coalesce(p_text, '')), '');
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.workspace_error('deny');
  end if;
  if p_language is null or p_language not in ('en', 'te', 'hi', 'kn', 'ta', 'ml', 'mr', 'bn') or (p_text is not null and v_text is null) then
    perform app.workspace_error('invalid');
  end if;
  if v_text is null then
    delete from workspace.opening_lines where workspace_id = p_tenant_id and language = p_language and campaign_key = v_key;
  else
    begin
      insert into workspace.opening_lines as l (workspace_id, language, campaign_key, line, updated_by, updated_at)
      values (p_tenant_id, p_language, v_key, v_text, auth.uid(), now())
      on conflict (workspace_id, language, campaign_key) do update set line = excluded.line, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
    exception when check_violation then
      perform app.workspace_error('invalid');
    end;
  end if;
  perform app.write_audit_event(p_tenant_id, 'assistant.opening_line_saved', 'workspace', p_tenant_id, null,
    jsonb_build_object('language', p_language, 'campaign', p_campaign_id is not null, 'reset', v_text is null));
  return app.opening_json(p_tenant_id);
end;
$$;
revoke all on function public.opening_set_line(uuid, text, uuid, text) from public, anon;
grant execute on function public.opening_set_line(uuid, text, uuid, text) to authenticated;

-- The switch. Every change is audited with the old and the new value (who and when are the audit event's own actor and time). `p_mention_ai` null removes a campaign's override (the workspace's value applies).
create function public.opening_set_mention(p_tenant_id uuid, p_campaign_id uuid, p_mention_ai boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key uuid := coalesce(p_campaign_id, '00000000-0000-0000-0000-000000000000');
  v_old boolean;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform app.workspace_error('deny');
  end if;
  if p_mention_ai is null and p_campaign_id is null then
    perform app.workspace_error('invalid');
  end if;
  select s.mention_ai into v_old from workspace.opening_settings s where s.workspace_id = p_tenant_id and s.campaign_key = v_key;
  v_old := coalesce(v_old, case when p_campaign_id is null then true end);
  if p_mention_ai is null then
    delete from workspace.opening_settings where workspace_id = p_tenant_id and campaign_key = v_key;
  else
    insert into workspace.opening_settings as s (workspace_id, campaign_key, mention_ai, updated_by, updated_at)
    values (p_tenant_id, v_key, p_mention_ai, auth.uid(), now())
    on conflict (workspace_id, campaign_key) do update set mention_ai = excluded.mention_ai, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  perform app.write_audit_event(p_tenant_id, 'assistant.mention_ai_changed', 'workspace', p_tenant_id,
    jsonb_build_object('mention_ai', v_old), jsonb_build_object('mention_ai', p_mention_ai, 'campaign', p_campaign_id is not null));
  return app.opening_json(p_tenant_id);
end;
$$;
revoke all on function public.opening_set_mention(uuid, uuid, boolean) from public, anon;
grant execute on function public.opening_set_mention(uuid, uuid, boolean) to authenticated;
