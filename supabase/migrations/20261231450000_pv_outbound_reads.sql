-- Job 3 phase B (the Plivo connector, outbound): two reads the outbound path needs.
--
--   public.phone_line_for_tenant(tenant, provider)   the number a business's outbound calls come FROM: its line with that provider (the caller id must be a number rented from the provider). Owner, Admin or the phone server.
--   public.phone_call_state(tenant, call)            the small state of one call (is it still ringing? how did it end?): Owner, Admin, Sales, or the phone server (which cannot read the full call, and does not need to).
-- Nothing here reveals a person's number: the first returns the business's OWN line; the second returns no contact, no transcript and no summary.
-- SQLSTATEs as the other phone functions: 42501 deny, 22023 invalid.

create function public.phone_line_for_tenant(p_tenant_id uuid, p_provider text) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  n public.phone_numbers;
begin
  if auth.uid() is null or p_tenant_id is null or not (app.is_scheduler() or app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[])) then
    perform app.phone_error('deny');
  end if;
  if p_provider is null or p_provider not in ('exotel', 'plivo', 'vobiz') then
    perform app.phone_error('invalid');
  end if;
  select * into n from public.phone_numbers x where x.tenant_id = p_tenant_id and x.provider = p_provider order by x.inbound_on desc, x.created_at, x.id limit 1;
  if not found then
    return null;
  end if;
  return jsonb_build_object('line_id', n.id, 'number', n.number, 'provider', n.provider, 'account_ref', n.account_ref, 'external_ref', n.external_ref);
end;
$$;
revoke all on function public.phone_line_for_tenant(uuid, text) from public, anon;
grant execute on function public.phone_line_for_tenant(uuid, text) to authenticated;

create function public.phone_call_state(p_tenant_id uuid, p_call_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  c public.phone_calls;
begin
  if auth.uid() is null or p_tenant_id is null or not (app.is_scheduler() or app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[])) then
    perform app.phone_error('deny');
  end if;
  select * into c from public.phone_calls x where x.tenant_id = p_tenant_id and x.id = p_call_id;
  if not found then
    return null;
  end if;
  return jsonb_build_object('id', c.id, 'direction', c.direction, 'provider', c.provider, 'state', c.state, 'end_reason', c.end_reason, 'outcome', c.outcome, 'category', c.category,
                            'duration_s', c.duration_s, 'callback_at', c.callback_at, 'captured', c.captured, 'provider_call_sid', c.provider_call_sid, 'purpose', c.purpose, 'language', c.language);
end;
$$;
revoke all on function public.phone_call_state(uuid, uuid) from public, anon;
grant execute on function public.phone_call_state(uuid, uuid) to authenticated;
