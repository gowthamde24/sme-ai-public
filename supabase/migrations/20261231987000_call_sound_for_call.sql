-- Voice and tone for real: the phone line must speak a call with the SAME voice, tone and speed the Owner chose and heard in the previews (owner findings of 19 Nov 2026: "previews do not equal real calls").
--   public.call_sound_for_call(tenant)   the scheduler account (the phone line runs as it) reads, for a call, the workspace's voice choices and gender (the voice picker), and the speed and style of the AI-assistant settings;
--                                         a read only; no row means the defaults (no choice, female, no speed, no style)
-- No table changes. Who may set any of these, and the audit of every change, stay as they are (migrations 20261211090400, 20261220090000, 20261129090300).

create function public.call_sound_for_call(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not app.is_scheduler() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return app.call_voice_json(p_tenant_id)
    || coalesce((select jsonb_build_object('speed', s.speed, 'style', s.style) from public.assistant_settings s where s.tenant_id = p_tenant_id), '{}'::jsonb);
end;
$$;

revoke all on function public.call_sound_for_call(uuid) from public, anon;
grant execute on function public.call_sound_for_call(uuid) to authenticated;
