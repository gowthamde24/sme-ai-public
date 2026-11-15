-- The assistant's name is optional (owner, 15 Nov 2026: "remove your name" / "call yourself X"; no name = "your assistant" in the app and "the assistant" on calls: no name is ever made up).
--   * assistant_settings.assistant_name may be NULL (the check keeps every rule for a name that is there);
--   * public.assistant_name_set(tenant, name): Owner and Admin, NO second factor (cosmetic; owner decision 14 Nov: no authenticator code for shop settings). A blank name = NULL. It changes the name only;
--     it refuses (SM801) when the assistant was never set up, because a row needs the whole setup and this function must not invent its other fields.
-- The full save (assistant_settings_save, Owner + second factor) is untouched: it still takes a name.

alter table public.assistant_settings alter column assistant_name drop not null;
alter table public.assistant_settings drop constraint if exists assistant_settings_assistant_name_check;
alter table public.assistant_settings add constraint assistant_settings_assistant_name_check
  check (assistant_name is null or (char_length(assistant_name) between 1 and 24 and app.text_is_clean(assistant_name) and assistant_name ~ '^[^<>{}@/\\|]+$'));

create function public.assistant_name_set(p_tenant_id uuid, p_name text) returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_found boolean;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    perform app.assistant_error('deny');
  end if;
  select true into v_found from public.assistant_settings a where a.tenant_id = p_tenant_id;
  if v_found is null then
    if v_name is null then
      return null;   -- nothing was saved, so there is no name to remove
    end if;
    raise exception 'the assistant is not set up yet' using errcode = 'SM801';
  end if;
  begin
    perform set_config('app.assistant_edit', 'on', true);
    update public.assistant_settings set assistant_name = v_name, updated_by = auth.uid(), updated_at = app.outbox_now() where tenant_id = p_tenant_id;
    perform set_config('app.assistant_edit', '', true);
  exception when check_violation or invalid_text_representation then
    perform set_config('app.assistant_edit', '', true);
    perform app.assistant_error('invalid');
  end;
  return v_name;
end;
$$;
revoke all on function public.assistant_name_set(uuid, text) from public, anon;
grant execute on function public.assistant_name_set(uuid, text) to authenticated;
comment on function public.assistant_name_set(uuid, text) is 'Owner/Admin: the assistant''s name only (blank = no name). Refused (SM801) when the assistant was never set up.';
