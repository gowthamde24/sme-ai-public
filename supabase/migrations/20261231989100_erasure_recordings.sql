-- Erasure and call recordings (28 Nov 2026; owner decision, option B: VoiceLink records calls on its network in the first weeks). A customer's data is erased in OUR database, but a recording lives at VoiceLink and VoiceLink has no
-- documented way for us to delete it from our side. So when an Owner executes an erasure, the platform's staff get ONE "Needs you" item (admin alerts, owner and finance) naming the VoiceLink call ids of that customer's recorded calls,
-- to delete in the VoiceLink portal. Call ids are the provider's own ids (no name, no number); one item per erasure request (running it again changes nothing).

alter table admin.alerts drop constraint alerts_kind_check;
alter table admin.alerts add constraint alerts_kind_check check (kind in ('google_cap', 'credential_expiry', 'plivo_balance', 'telephony_setting', 'recording_deletion'));

create function public.erasure_recordings_notify(p_request_id uuid) returns integer language plpgsql security definer set search_path = '' as
$$
declare
  r      public.erasure_requests;
  v_ids  text[];
  v_text text;
begin
  select * into r from public.erasure_requests where id = p_request_id;
  if auth.uid() is null or not found or not app.has_tenant_role(r.tenant_id, array['owner']::public.app_role[]) then
    perform app.phone_error('deny');
  end if;
  perform app.require_aal2();
  select coalesce(array_agg(distinct c.provider_call_sid order by c.provider_call_sid), '{}') into v_ids
    from public.phone_calls c
   where c.tenant_id = r.tenant_id and c.provider = 'voicelink' and not c.simulated and c.provider_call_sid is not null
     and (r.scope = 'tenant'
          or (r.scope = 'contact' and c.contact_id = r.subject_id)
          or (r.scope = 'company' and c.contact_id in (select k.id from public.contacts k where k.tenant_id = r.tenant_id and k.company_id = r.subject_id)));
  if cardinality(v_ids) = 0 then
    return 0;
  end if;
  v_text := 'A customer asked for their data to be erased. VoiceLink may hold recordings of their ' || cardinality(v_ids) || ' call(s): delete each in the VoiceLink portal (Call logs), then acknowledge this. Call ids: '
            || array_to_string(v_ids[1:12], ', ') || case when cardinality(v_ids) > 12 then ' and ' || (cardinality(v_ids) - 12) || ' more (ask support for the list).' else '.' end;
  insert into admin.alerts (key, kind, severity, title, detail)
  values ('recordings:' || p_request_id::text, 'recording_deletion', 'warn', 'Delete call recordings at VoiceLink', left(v_text, 500))
  on conflict (key) do nothing;
  return cardinality(v_ids);
end $$;
revoke all on function public.erasure_recordings_notify(uuid) from public, anon;
grant execute on function public.erasure_recordings_notify(uuid) to authenticated;

-- the staff list shows it to the owner and finance, like the other platform items
do $patch$
declare
  v_def    text := pg_get_functiondef('public.admin_alerts_list(boolean)'::regprocedure);
  v_marker constant text := E'x.kind not in (''plivo_balance'', ''telephony_setting'')';
begin
  if position(v_marker in v_def) = 0 then
    raise exception 'recordings: the alerts list is not the one this migration expects';
  end if;
  execute replace(v_def, v_marker, E'x.kind not in (''plivo_balance'', ''telephony_setting'', ''recording_deletion'')');
end
$patch$;
