-- The lawyer's written opinion (25 Nov 2026, reports/lawyer-opinion-actions.md): the default calling window is 10:00 to 21:00 India time, not 09:00. The call gate (app/telephony/gate.py WINDOW_FROM_MINUTE) is the hard rule; this migration moves
-- every stored bound and default of the same idea so nothing offers or keeps a start before 10:00:
--   * assistant_settings call hours, the Lead Desk's night call minute and the retry step "next morning", the call settings' hours validator, the speed-approval default hours, the activity limits' tighten check: lower bound 540 -> 600 (default 570 -> 600);
--   * rows that hold an earlier time are moved to 10:00 (one UPDATE each; no row is deleted; nothing is widened).
-- Messages (WhatsApp) keep their own quiet hours (21:00 to 09:00): this is about calls.

-- 1. assistant settings (the guard trigger lets the edit door through)
select set_config('app.assistant_edit', 'on', true);
update public.assistant_settings set call_from_minute = 600 where call_from_minute < 600;
update public.assistant_settings set call_to_minute = 600 where call_to_minute < 600;
select set_config('app.assistant_edit', '', true);
alter table public.assistant_settings drop constraint assistant_settings_call_from_minute_check;
alter table public.assistant_settings add constraint assistant_settings_call_from_minute_check check (call_from_minute >= 600 and call_from_minute <= 1260 and call_from_minute % 15 = 0);
alter table public.assistant_settings drop constraint assistant_settings_call_to_minute_check;
alter table public.assistant_settings add constraint assistant_settings_call_to_minute_check check (call_to_minute >= 600 and call_to_minute <= 1260 and call_to_minute % 15 = 0);

-- 2. the Lead Desk's night call and retry ladder
update public.outreach_policy set night_call_minute = 600 where night_call_minute < 600;
alter table public.outreach_policy drop constraint outreach_policy_night_call_minute_check;
alter table public.outreach_policy add constraint outreach_policy_night_call_minute_check check (night_call_minute >= 600 and night_call_minute <= 720 and night_call_minute % 15 = 0);
alter table public.outreach_policy alter column night_call_minute set default 600;
update public.outreach_policy p set retry_steps = (
  select jsonb_agg(case when e ? 'next_morning_minute' and (e ->> 'next_morning_minute')::int < 600 then jsonb_build_object('next_morning_minute', 600) else e end order by o)
    from jsonb_array_elements(p.retry_steps) with ordinality as t(e, o))
 where exists (select 1 from jsonb_array_elements(p.retry_steps) e where e ? 'next_morning_minute' and (e ->> 'next_morning_minute')::int < 600);
alter table public.outreach_policy alter column retry_steps set default '[{"after_minutes": 10}, {"after_minutes": 120}, {"next_morning_minute": 600}]'::jsonb;

-- 3. the stored call settings of a workspace (jsonb: hours.from_minute) and the functions that validate or default them
update public.call_settings set settings = jsonb_set(settings, '{hours,from_minute}', '600'::jsonb)
 where jsonb_typeof(settings #> '{hours,from_minute}') = 'number' and (settings #>> '{hours,from_minute}')::int < 600;
update public.call_settings set settings = jsonb_set(settings, '{hours,to_minute}', '600'::jsonb)
 where jsonb_typeof(settings #> '{hours,to_minute}') = 'number' and (settings #>> '{hours,to_minute}')::int < 600;

do $patch$
declare
  v_f record;
  v_def text;
begin
  for v_f in select * from (values
      ('app.cs_hours(jsonb)'::text,                    '540, 1260, 15'::text, '600, 1260, 15'::text, 2),
      ('app.outreach_hours(uuid)',                     $q$'from_minute', 540$q$, $q$'from_minute', 600$q$, 1),
      ('app.outreach_pol(uuid)',                       '570',                 '600',                 2),
      ('public.limits_tighten(uuid, jsonb)',           'between 540 and 1260', 'between 600 and 1260', 2)) as x(fn, old, new, n) loop
    v_def := pg_get_functiondef(v_f.fn::regprocedure);
    if (length(v_def) - length(replace(v_def, v_f.old, ''))) / length(v_f.old) <> v_f.n then
      raise exception '% has changed: the calling-window patch (% x%) no longer fits', v_f.fn, v_f.old, v_f.n;
    end if;
    execute replace(v_def, v_f.old, v_f.new);
  end loop;
end $patch$;
