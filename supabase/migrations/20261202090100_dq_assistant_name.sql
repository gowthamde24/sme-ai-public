-- Job DQ part 3: the assistant's NAME, read-only, for every member (C2 asked in c2-questions-2.md). The name appears in words every member sees (Today, the menu, Help); the full settings stay Owner/Admin only.
--   public.assistant_name_get(tenant)   the name the Owner saved, or null before the first save (the web then shows its default). Any member of the workspace; nobody else.
-- The Malayalam voices of the four personas also go in here (the fake voice 'fake-ml' was added in the languages migration).

create function public.assistant_name_get(p_tenant_id uuid) returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales', 'viewer']::public.app_role[]) then
    perform app.assistant_error('deny');
  end if;
  return (select a.assistant_name from public.assistant_settings a where a.tenant_id = p_tenant_id);
end;
$$;
revoke all on function public.assistant_name_get(uuid) from public, anon;
grant execute on function public.assistant_name_get(uuid) to authenticated;
comment on function public.assistant_name_get(uuid) is 'Job DQ: the assistant''s display name for any member of the workspace (null before the first save). Nothing else of the settings.';

insert into voice.voice_personas (persona, language, voice_code)
select p, 'ml', 'fake-ml' from unnest(array['female_warm', 'female_clear', 'male_calm', 'male_lively']) p
on conflict do nothing;
