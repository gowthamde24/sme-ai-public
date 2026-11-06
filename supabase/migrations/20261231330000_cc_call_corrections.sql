-- cc: "Correct it" after a call (app v4, part 4; owner 6 Nov 2026): a person fixes what the AI understood (the short summary, the answers it captured) and may add a NOTE in their own words
-- ("Kanchi pattu means Kanchipuram silk, not cotton"). The correction is saved ON the call; the AI's own summary stays as it was. [C1] "Feed the corrections into how it talks": the latest notes
-- (never a customer's details: the corrected summary and answers stay with that one call) are read by the telephony worker and put into the next calls' instructions.

alter table public.phone_calls
  add column summary_corrected  text check (summary_corrected is null or (char_length(summary_corrected) between 1 and 600)),
  add column captured_corrected jsonb check (captured_corrected is null or (jsonb_typeof(captured_corrected) = 'object' and octet_length(captured_corrected::text) <= 4000)),
  -- the note goes into OTHER calls' instructions, so it may never carry a customer's contact: no run of 10 or more digits (spaces and dashes allowed), no e-mail address
  add column correction_note    text check (correction_note is null or (char_length(correction_note) between 2 and 300 and app.text_is_clean(correction_note)
                                            and correction_note !~ '[0-9]([ -]?[0-9]){9,}' and correction_note !~ '[^[:space:]]@[^[:space:]]')),
  add column corrected_by       uuid,
  add column corrected_at       timestamptz;
comment on column public.phone_calls.summary_corrected is 'PII: a person''s correction of the call''s short summary. Erased with the workspace and with the person. CLEAN-EXEMPT: read by people only, never by a model for another call';
comment on column public.phone_calls.captured_corrected is 'PII: a person''s correction of the answers the call captured. Erased with the workspace and with the person. CLEAN-EXEMPT: read by people only';
comment on column public.phone_calls.correction_note is 'SAFE: the person''s own note about how the AI should talk or what it misunderstood (no phone number or e-mail: refused by the check); used in later calls'' instructions.';
comment on column public.phone_calls.corrected_by is 'SAFE: a user id. CLEAN-EXEMPT: uuid';

drop trigger audit_phone_calls on public.phone_calls;
create trigger audit_phone_calls after insert or update or delete on public.phone_calls for each row execute function app.audit_row_change('phone_call', 'captured,summary,transcript,summary_corrected,captured_corrected');

insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('phone_calls', 'summary_corrected',  'tenant', 'tombstone', 'erased:1'),
  ('phone_calls', 'summary_corrected',  'sweep',  'substring', 'erased:1'),
  ('phone_calls', 'captured_corrected', 'tenant', 'null',      'erased:1');

-- a finished call still never moves, except: once, the "handled" mark; and, any time, the correction fields
create or replace function app.phone_calls_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_fixed text[] := array['updated_at', 'handled_at', 'handled_by', 'summary_corrected', 'captured_corrected', 'correction_note', 'corrected_by', 'corrected_at'];
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception 'calls are never deleted' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.state in ('completed', 'no_answer', 'busy', 'voicemail', 'failed', 'refused', 'cancelled') and not app.erasure_running(old.tenant_id)
       and ((to_jsonb(old) - v_fixed) is distinct from (to_jsonb(new) - v_fixed)
            or (old.handled_at is not null and (old.handled_at, old.handled_by) is distinct from (new.handled_at, new.handled_by))) then
      raise exception 'a finished call does not change' using errcode = 'SM961';
    end if;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

-- "Correct it" (Owner, Admin, Sales): any of the three may be given; null keeps what is there; an empty string clears it
create function public.phone_call_correct(p_tenant_id uuid, p_call_id uuid, p_summary text default null, p_captured jsonb default null, p_note text default null) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.phone_calls;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.phone_error('deny');
  end if;
  update public.phone_calls x set
      summary_corrected  = case when p_summary is null then x.summary_corrected else nullif(btrim(p_summary), '') end,
      captured_corrected = case when p_captured is null then x.captured_corrected when p_captured = '{}'::jsonb then null else p_captured end,
      correction_note    = case when p_note is null then x.correction_note else nullif(btrim(p_note), '') end,
      corrected_by = auth.uid(), corrected_at = now()
   where x.tenant_id = p_tenant_id and x.id = p_call_id
   returning * into c;
  if not found then
    perform app.phone_error('reference');
  end if;
  return jsonb_build_object('summary', c.summary_corrected, 'captured', c.captured_corrected, 'note', c.correction_note, 'corrected_at', c.corrected_at);
end;
$$;
revoke all on function public.phone_call_correct(uuid, uuid, text, jsonb, text) from public, anon;
grant execute on function public.phone_call_correct(uuid, uuid, text, jsonb, text) to authenticated;

-- the telephony worker: the latest notes of a workspace, for the next calls' instructions (notes only, never a customer's corrected details)
create function public.call_corrections_for_call(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not app.is_scheduler() then
    perform app.phone_error('deny');
  end if;
  return coalesce((select jsonb_agg(n.note order by n.at desc)
                     from (select x.correction_note as note, x.corrected_at as at from public.phone_calls x
                            where x.tenant_id = p_tenant_id and x.correction_note is not null order by x.corrected_at desc limit 5) n), '[]'::jsonb);
end;
$$;
revoke all on function public.call_corrections_for_call(uuid) from public, anon;
grant execute on function public.call_corrections_for_call(uuid) to authenticated;

-- the call's detail now carries its correction
create or replace function public.phone_call_get(p_tenant_id uuid, p_call_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.phone_calls;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    perform app.phone_error('deny');
  end if;
  select * into c from public.phone_calls x where x.tenant_id = p_tenant_id and x.id = p_call_id;
  if not found then
    perform app.phone_error('reference');
  end if;
  return app.phone_call_json(c, app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]))
         || jsonb_build_object('correction', case when c.corrected_at is null then null else
              jsonb_build_object('summary', c.summary_corrected, 'captured', c.captured_corrected, 'note', c.correction_note, 'corrected_at', c.corrected_at) end);
end;
$$;
