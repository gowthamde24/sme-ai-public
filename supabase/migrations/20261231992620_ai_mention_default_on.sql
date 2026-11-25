-- The AI mention defaults to ON (lawyer's written opinion, 25 Nov 2026; planner's decision): the line the outbox appends to the assistant's FIRST message says it is an AI assistant unless the business switched it off
-- AND the Owner has accepted the written undertaking, which the API stores in the Talk training document (`ai_off_undertaking`: when and who). An "off" without it is ON. Before this the default was OFF (owner decision of 20 Nov 2026).
create or replace function app.outbox_mention_ai(p_tenant uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select not (t.doc ->> 'say_ai_when_greeting' = 'false'
                               and t.doc #>> '{ai_off_undertaking,at}' is not null and t.doc #>> '{ai_off_undertaking,by}' is not null)
                     from public.talk_training t where t.tenant_id = p_tenant), true)
$$;

create or replace function app.outbox_mention_ai(p_tenant uuid, p_category text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select case t.doc -> 'say_ai_by_job' ->> (case p_category when 'followup' then 'followups' when 'visit' then 'store_visits' end)
                   when 'on' then true
                   when 'off' then not (t.doc #>> '{ai_off_undertaking,at}' is not null and t.doc #>> '{ai_off_undertaking,by}' is not null) end
       from public.talk_training t
      where t.tenant_id = p_tenant and jsonb_typeof(t.doc -> 'say_ai_by_job') = 'object'),
    app.outbox_mention_ai(p_tenant))
$$;

-- Listening in (lawyer's written opinion, 25 Nov 2026): a workspace whose Owner may listen to or take over a live call says "this call may be monitored" in the opening. The phone line (the scheduler account) asks.
create function public.phone_monitored_for_call(p_tenant_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as
$$
begin
  if not app.is_scheduler() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((select s.enabled from workspace.call_takeover_settings s where s.workspace_id = p_tenant_id), false);
end $$;
revoke all on function public.phone_monitored_for_call(uuid) from public, anon;
grant execute on function public.phone_monitored_for_call(uuid) to authenticated;
