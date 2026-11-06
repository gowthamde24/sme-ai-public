-- Visit booking from a call (owner, 5 Nov 2026; job calls-like-a-pro part 5). The assistant offers the business's next FREE visit slots on a call (store_settings: opening hours, slot length, visits at
-- once); when the caller picks one, the call's outcome records it (captured.visit_at, checked by code against the slots offered) and Today shows "a caller wants to visit on <day> at <time>" until a
-- member books it in Visits and marks the call done (POST /calls/{id}/handled, the hand-over's mark). An inbound caller is not a lead yet, so a person books it; a call with a known lead can book
-- directly once real outbound calls exist.

-- the next free slots for a call (the scheduler account, which the phone line runs as): only with the visits module, from 30 minutes from now, at most p_limit
create function public.visit_slots_for_call(p_tenant_id uuid, p_days integer default 3, p_limit integer default 6) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_set   jsonb;
  v_now   timestamptz := app.visit_now();
  v_today date := (app.visit_now() at time zone 'Asia/Kolkata')::date;
  v_out   jsonb := '[]'::jsonb;
  v_day   date;
  v_plan  jsonb;
  s       jsonb;
  v_taken integer;
begin
  if not app.is_scheduler() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_tenant_id is null or p_days is null or p_days not between 1 and 7 or p_limit is null or p_limit not between 1 and 12 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if not app.module_enabled(p_tenant_id, 'visits') then
    return '[]'::jsonb;
  end if;
  v_set := app.visit_settings_json(p_tenant_id);
  for i in 0 .. p_days - 1 loop
    v_day := v_today + i;
    v_plan := app.visit_day_plan(v_set, v_day);
    for s in select x from jsonb_array_elements(v_plan -> 'slots') x order by (x ->> 'starts_at')::timestamptz loop
      continue when (s ->> 'starts_at')::timestamptz < v_now + interval '30 minutes';
      select count(*) into v_taken from public.store_visits v
       where v.tenant_id = p_tenant_id and v.visit_date = v_day and v.status in ('booked', 'confirmed', 'arrived')
         and v.starts_at < (s ->> 'ends_at')::timestamptz and v.ends_at > (s ->> 'starts_at')::timestamptz;
      continue when v_taken >= (v_set ->> 'max_parallel')::integer;
      v_out := v_out || jsonb_build_array(jsonb_build_object('date', v_day, 'start', s ->> 'start', 'starts_at', s -> 'starts_at'));
      exit when jsonb_array_length(v_out) >= p_limit;
    end loop;
    exit when jsonb_array_length(v_out) >= p_limit;
  end loop;
  return v_out;
end;
$$;
revoke all on function public.visit_slots_for_call(uuid, integer, integer) from public, anon;
grant execute on function public.visit_slots_for_call(uuid, integer, integer) to authenticated;

-- Today: a caller who picked a visit slot, until a member marks the call done (the same function, one more kind; everything else unchanged)
do $do$
declare
  v_def text := pg_get_functiondef('public.today_summary(uuid)'::regprocedure);
  v_anchor text := '  ), top as (';
begin
  if position(v_anchor in v_def) = 0 or position('visit_requested' in v_def) > 0 or position('person_requested' in v_def) = 0 then
    raise exception 'vb_visit_from_call: today_summary is not the one this migration expects';
  end if;
  execute replace(v_def, v_anchor, '    union all
    select ''visit_requested'', pc.id, coalesce(k.full_name, ''A caller''), null::text, ''followup_desk'', pc.captured ->> ''visit_at'', null::bigint, coalesce(pc.ended_at, pc.created_at), ''phone_call'', pc.id
      from public.phone_calls pc
      left join public.contacts k on k.tenant_id = pc.tenant_id and k.id = pc.contact_id
     where v_reader and pc.tenant_id = p_tenant_id and pc.captured ? ''visit_at'' and pc.handled_at is null and coalesce(pc.end_reason, '''') <> ''handover''
       and pc.created_at >= now() - interval ''7 days''
' || v_anchor);
end
$do$;
