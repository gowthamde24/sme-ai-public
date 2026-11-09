-- at: the morning stand-up, as TEXT (owner, 9 Nov 2026; docs/contracts/ai-team.md, "The stand-up"). The worker makes it once a day at the business's opening time from the real day numbers
-- (app/ai_team/standup.py: code, no model, no audio, no customer names) and stores it here, so "Report ready" is a real time: generated_at.
--   * One row per workspace, India day and language. The worker writes it once (by = 'schedule'); the Owner or an Admin may make it again by hand, at most 3 times a day per workspace.
--   * The scheduler decides which workspaces are due: it has an assistant, is open today (store hours; a closed day has no stand-up), opening time has passed, and today's row does not exist yet.
--   * The language is the assistant's main language when it is one of en, te, hi, kn; anything else (ta) gets English.

create table public.ai_team_standups (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants (id),
  day           date not null,
  language      text not null check (language in ('en', 'te', 'hi', 'kn')),
  body          text not null check (char_length(body) between 1 and 2000 and app.text_is_clean(body)),
  lines         jsonb not null check (jsonb_typeof(lines) = 'array' and jsonb_array_length(lines) between 1 and 12 and app.text_is_clean(lines::text)),
  numbers       jsonb not null check (jsonb_typeof(numbers) = 'array' and jsonb_array_length(numbers) <= 20 and app.text_is_clean(numbers::text)),
  draft         boolean not null,
  by            text not null check (by in ('schedule', 'owner')),
  manual_count  integer not null default 0 check (manual_count between 0 and 3),
  generated_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (tenant_id, day, language)
);
comment on table public.ai_team_standups is 'The morning stand-up as text, one per workspace, India day and language. Made by code from counts and times; no customer name or phone number is ever in it. Written only by ai_team_standup_save.';
comment on column public.ai_team_standups.day is 'SAFE: the India day it is for. CLEAN-EXEMPT: date';
comment on column public.ai_team_standups.language is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column public.ai_team_standups.body is 'SAFE: the stand-up sentences, made by code from counts and times of the workspace''s own day. Clean text.';
comment on column public.ai_team_standups.lines is 'SAFE: the same sentences one by one, each with the source it came from. Clean text.';
comment on column public.ai_team_standups.numbers is 'SAFE: every number in the text and where it came from. Clean text.';
comment on column public.ai_team_standups.draft is 'SAFE: true while the language is not yet reviewed by a native reader. CLEAN-EXEMPT: boolean';
comment on column public.ai_team_standups.by is 'SAFE: schedule (the worker) or owner (made by hand). CLEAN-EXEMPT: closed CHECK list';
comment on column public.ai_team_standups.manual_count is 'SAFE: how many times it was made again by hand that day (at most 3). CLEAN-EXEMPT: number';
comment on column public.ai_team_standups.generated_at is 'SAFE: when the text was made (the time "Report ready" shows). CLEAN-EXEMPT: timestamp';
comment on column public.ai_team_standups.created_at is 'SAFE: row time. CLEAN-EXEMPT: timestamp';

alter table public.ai_team_standups enable row level security;
alter table public.ai_team_standups force row level security;
revoke all on public.ai_team_standups from public, anon, authenticated, service_role;
create trigger ai_team_standups_forbid_tenant_id_change before update on public.ai_team_standups for each row execute function app.forbid_tenant_id_change();
grant select on public.ai_team_standups to authenticated;
create policy ai_team_standups_select on public.ai_team_standups for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));
create trigger audit_ai_team_standups after insert or update or delete on public.ai_team_standups for each row execute function app.audit_row_change('ai_team_standup', '');

create function app.standup_json(s public.ai_team_standups) returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('date', s.day, 'language', s.language, 'text', s.body, 'lines', s.lines, 'numbers', s.numbers, 'draft', s.draft, 'by', s.by,
                            'generated_at', s.generated_at,
                            'left_today', greatest(0, 3 - (select coalesce(sum(x.manual_count), 0) from public.ai_team_standups x where x.tenant_id = s.tenant_id and x.day = s.day))::integer)
$$;
revoke all on function app.standup_json(public.ai_team_standups) from public, anon, authenticated, service_role;

-- Owner, Admin: the stand-up of a day and language (null = not made yet)
create function public.ai_team_standup_get(p_tenant_id uuid, p_date date, p_language text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.ai_team_standups;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into s from public.ai_team_standups x where x.tenant_id = p_tenant_id and x.day = p_date and x.language = p_language;
  if not found then
    return null;
  end if;
  return app.standup_json(s);
end;
$$;
revoke all on function public.ai_team_standup_get(uuid, date, text) from public, anon;
grant execute on function public.ai_team_standup_get(uuid, date, text) to authenticated;

-- keep a made stand-up. The worker: once a day (a second save keeps the first). Owner, Admin: by hand, at most 3 a day per workspace (a text that did not change does not count);
-- over the limit the answer is {"ok": false, "reason": "standup_limit", "retry_after_s": ...} (seconds to the next India midnight), nothing is stored.
create function public.ai_team_standup_save(p_tenant_id uuid, p_date date, p_language text, p_text text, p_lines jsonb, p_numbers jsonb, p_draft boolean) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sched boolean := app.is_scheduler();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  s public.ai_team_standups;
  v_used integer;
  v_has boolean;
begin
  if auth.uid() is null or p_tenant_id is null or not (v_sched or app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[])) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_date is null or p_date <> v_today or p_language is null or p_language not in ('en', 'te', 'hi', 'kn') or p_draft is null then
    raise exception 'invalid' using errcode = '22023';
  end if;
  select * into s from public.ai_team_standups x where x.tenant_id = p_tenant_id and x.day = p_date and x.language = p_language for update;
  v_has := found;
  if v_sched then
    if not v_has then
      insert into public.ai_team_standups (tenant_id, day, language, body, lines, numbers, draft, by) values (p_tenant_id, p_date, p_language, p_text, p_lines, p_numbers, p_draft, 'schedule')
      on conflict (tenant_id, day, language) do nothing;
      select * into s from public.ai_team_standups x where x.tenant_id = p_tenant_id and x.day = p_date and x.language = p_language;
    end if;
    return jsonb_build_object('ok', true) || app.standup_json(s);
  end if;
  -- by hand
  if v_has and s.body = p_text then
    return jsonb_build_object('ok', true) || app.standup_json(s);
  end if;
  select coalesce(sum(x.manual_count), 0) into v_used from public.ai_team_standups x where x.tenant_id = p_tenant_id and x.day = p_date;
  if v_used >= 3 then
    return jsonb_build_object('ok', false, 'reason', 'standup_limit',
                              'retry_after_s', greatest(1, extract(epoch from ((p_date + 1)::timestamp at time zone 'Asia/Kolkata') - now())::integer));
  end if;
  if v_has then
    update public.ai_team_standups x set body = p_text, lines = p_lines, numbers = p_numbers, draft = p_draft, by = 'owner', manual_count = x.manual_count + 1, generated_at = now()
     where x.id = s.id returning * into s;
  else
    insert into public.ai_team_standups (tenant_id, day, language, body, lines, numbers, draft, by, manual_count) values (p_tenant_id, p_date, p_language, p_text, p_lines, p_numbers, p_draft, 'owner', 1)
    returning * into s;
  end if;
  return jsonb_build_object('ok', true) || app.standup_json(s);
end;
$$;
revoke all on function public.ai_team_standup_save(uuid, date, text, text, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.ai_team_standup_save(uuid, date, text, text, jsonb, jsonb, boolean) to authenticated;

-- the worker: the workspaces whose stand-up is due now (opening time passed today, none made yet), with the language to write it in
create function public.scheduler_standup_due(p_limit integer default 50) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_local timestamp := now() at time zone 'Asia/Kolkata';
  v_day text := lower(to_char(v_local, 'Dy'));
begin
  if auth.uid() is null or not app.is_scheduler() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 200 then
    raise exception 'invalid' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('tenant_id', d.tenant_id, 'language', d.lang, 'date', v_local::date) order by d.tenant_id)
      from (
        select a.tenant_id,
               case when a.main_language in ('en', 'te', 'hi', 'kn') then a.main_language else 'en' end as lang
          from public.assistant_settings a
          left join public.store_settings h on h.tenant_id = a.tenant_id
         where not exists (select 1 from public.ai_team_standups s where s.tenant_id = a.tenant_id and s.day = v_local::date)
           -- the opening time of today; no store hours set = 09:00; a closed day (null) has no stand-up
           and v_local::time >= case when h.tenant_id is null then time '09:00'
                                     when jsonb_typeof(h.weekly_hours -> v_day) = 'object' then (h.weekly_hours -> v_day ->> 'open')::time end
         order by a.tenant_id
         limit p_limit) d), '[]'::jsonb);
end;
$$;
revoke all on function public.scheduler_standup_due(integer) from public, anon;
grant execute on function public.scheduler_standup_due(integer) to authenticated;
