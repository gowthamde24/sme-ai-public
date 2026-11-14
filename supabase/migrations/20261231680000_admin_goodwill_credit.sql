-- Admin console phase 2, slice 3: a goodwill credit (rupees added to a business's balance by Stack19 as a gesture; owner and finance roles only).
-- A money action, so: a reason in words (always), the amount typed twice, a fresh second factor (a code entered in the last 5 minutes: SM948), a limit (Rs 1,000 a time, Rs 3,000 per business per 30 days),
-- an idempotency key (a retry never credits twice), an audit row, and the shop owner sees it in their activity log. It is a wallet lot with source 'adjustment', not an invoice (no GST on a gesture).

-- the signed token must carry a second-factor code entered within the last 5 minutes (supabase puts every sign-in step in `amr` with its time)
create function admin.second_confirm() returns void language plpgsql stable set search_path = '' as
$$
declare
  v bigint;
begin
  select max((e ->> 'timestamp')::bigint) into v from jsonb_array_elements(case when jsonb_typeof(auth.jwt() -> 'amr') = 'array' then auth.jwt() -> 'amr' else '[]'::jsonb end) e
   where jsonb_typeof(e) = 'object' and e ->> 'method' = 'totp' and (e ->> 'timestamp') ~ '^[0-9]{9,11}$';
  if v is null or to_timestamp(v) < now() - interval '5 minutes' then
    raise exception 'enter your second factor again' using errcode = 'SM948';
  end if;
end $$;
revoke all on function admin.second_confirm() from public, anon, authenticated, service_role;

-- the shop owner's activity log names it ("Stack19 added a goodwill credit to your balance")
create or replace function public.activity_log(p_tenant_id uuid, p_limit integer default 50, p_before_at timestamptz default null, p_before_key text default null, p_kind text default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_items jsonb;
  v_next  jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or (p_kind is not null and p_kind not in ('call', 'message', 'action', 'support'))
     or ((p_before_at is null) <> (p_before_key is null)) or (p_before_key is not null and p_before_key !~ '^(call|message|action|support):[0-9a-f-]{36}$') then
    raise exception 'invalid' using errcode = '22023';
  end if;
  with src as (
    (select c.created_at as at, 'call:' || c.id::text as key,
            jsonb_build_object('key', 'call:' || c.id::text, 'kind', 'call', 'id', c.id, 'at', c.created_at, 'who', 'assistant', 'direction', c.direction, 'state', c.state,
                               'live', app.phone_call_is_live(c), 'outcome', c.outcome, 'duration_s', c.duration_s, 'summary', c.summary,
                               'contact_id', c.contact_id, 'contact_name', (select x.full_name from public.contacts x where x.tenant_id = c.tenant_id and x.id = c.contact_id),
                               'lead_id', c.lead_id, 'sandbox', c.sandbox, 'simulated', c.simulated,
                               'waiting', (c.end_reason = 'handover' and c.handled_at is null), 'undo', jsonb_build_object('state', 'none', 'until', null)) as j
       from public.phone_calls c
      where c.tenant_id = p_tenant_id and (p_kind is null or p_kind = 'call')
        and (p_before_at is null or (c.created_at, 'call:' || c.id::text) < (p_before_at, p_before_key))
      order by c.created_at desc, c.id desc limit p_limit + 1)
    union all
    (select m.created_at, 'message:' || m.id::text,
            jsonb_build_object('key', 'message:' || m.id::text, 'kind', 'message', 'id', m.id, 'at', m.created_at, 'who', m.source, 'channel', m.channel, 'category', m.category,
                               'status', m.status, 'reason', m.reason, 'flags', m.flags,
                               'contact_id', m.contact_id, 'contact_name', (select x.full_name from public.contacts x where x.tenant_id = m.tenant_id and x.id = m.contact_id),
                               'lead_id', m.lead_id, 'scheduled_for', m.scheduled_for,
                               'waiting', (m.status = 'needs_approval'), 'undo', jsonb_build_object('state', 'none', 'until', null))
       from public.outbox_messages m
      where m.tenant_id = p_tenant_id and (p_kind is null or p_kind = 'message')
        and (p_before_at is null or (m.created_at, 'message:' || m.id::text) < (p_before_at, p_before_key))
      order by m.created_at desc, m.id desc limit p_limit + 1)
    union all
    (select w.created_at, 'action:' || w.id::text,
            jsonb_build_object('key', 'action:' || w.id::text, 'kind', 'action', 'id', w.id, 'at', w.created_at, 'who', 'assistant', 'tool', w.tool, 'summary', w.summary,
                               'status', w.status, 'requested_by', w.requested_by, 'decided_by', w.decided_by, 'plan_id', w.plan_id,
                               'waiting', false,
                               'undo', jsonb_build_object('state', case when w.status = 'undone' then 'done'
                                                                       when w.undo is null or w.status <> 'done' then 'none'
                                                                       when w.undo_until is not null and w.undo_until < now() then 'expired'
                                                                       else 'available' end,
                                                         'until', case when w.undo is not null and w.status = 'done' then w.undo_until end))
       from public.assistant_work_actions w
      where w.tenant_id = p_tenant_id and (p_kind is null or p_kind = 'action')
        and (p_before_at is null or (w.created_at, 'action:' || w.id::text) < (p_before_at, p_before_key))
      order by w.created_at desc, w.id desc limit p_limit + 1)
    union all
    -- every time Stack19 support looked at this business (admin_access_open writes it as customer_visible): the shop owner sees who-what-why, never a staff name
    (select a.at, 'support:' || a.id::text,
            jsonb_build_object('key', 'support:' || a.id::text, 'kind', 'support', 'id', a.id, 'at', a.at, 'who', 'support', 'summary', case a.action when 'pause' then 'Stack19 support paused your assistant' when 'resume' then 'Stack19 support resumed your assistant' when 'credit' then 'Stack19 added a goodwill credit to your balance' else 'Stack19 support viewed your account' end,
                               'reason', admin.reason_label(a.reason_code, a.reason_text), 'waiting', false, 'undo', jsonb_build_object('state', 'none', 'until', null))
       from admin.audit a
      where a.tenant_id = p_tenant_id and a.customer_visible and (p_kind is null or p_kind = 'support')
        and (p_before_at is null or (a.at, 'support:' || a.id::text) < (p_before_at, p_before_key))
      order by a.at desc, a.id desc limit p_limit + 1)),
  page as (select s.at, s.key, s.j, row_number() over (order by s.at desc, s.key desc) as rn from src s order by s.at desc, s.key desc limit p_limit + 1)
  select coalesce(jsonb_agg(p.j order by p.rn) filter (where p.rn <= p_limit), '[]'::jsonb),
         (select jsonb_build_object('before_at', q.at, 'before_key', q.key) from page q where q.rn = p_limit and exists (select 1 from page z where z.rn = p_limit + 1))
    into v_items, v_next
    from page p;
  return jsonb_build_object('items', v_items, 'next', v_next);
end;
$$;

create function public.admin_goodwill_credit(p_tenant_id uuid, p_amount_paise bigint, p_confirm_paise bigint, p_reason_code text, p_reason_text text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_text  text := btrim(coalesce(p_reason_text, ''));
  v_new   boolean;
begin
  v_staff := admin.staff_check(array['owner', 'finance']);
  if p_tenant_id is null or p_amount_paise is null or p_amount_paise not between 100 and 100000 or p_confirm_paise is distinct from p_amount_paise
     or p_reason_code is null or p_reason_code not in ('support_ticket', 'customer_asked', 'privacy_request', 'incident', 'billing_dispute', 'other')
     or p_key is null or p_key !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  -- money always needs words
  if char_length(v_text) not between 3 and 300 or not app.text_is_clean(v_text) then
    raise exception 'a reason is required' using errcode = 'SM946';
  end if;
  perform admin.second_confirm();
  if not exists (select 1 from public.tenants t where t.id = p_tenant_id and t.archived_at is null) then
    raise exception 'not found' using errcode = '23503';
  end if;
  -- a retry of the same key changes nothing
  if exists (select 1 from pricing.wallet_lots l where l.tenant_id = p_tenant_id and l.source = 'adjustment' and l.ref = 'goodwill:' || p_key) then
    return jsonb_build_object('credited_paise', p_amount_paise, 'balance_paise', pricing.balance_of(p_tenant_id), 'replayed', true);
  end if;
  if coalesce((select sum(l.amount_paise) from pricing.wallet_lots l where l.tenant_id = p_tenant_id and l.source = 'adjustment' and l.ref like 'goodwill:%' and l.created_at > now() - interval '30 days'), 0) + p_amount_paise > 300000 then
    raise exception 'over the goodwill limit' using errcode = 'SM949';
  end if;
  v_new := pricing.credit(p_tenant_id, 'adjustment', 'goodwill:' || p_key, p_amount_paise);
  perform admin.log(v_staff.user_id, 'credit', p_tenant_id, null, p_reason_code, v_text, 'business', p_tenant_id::text, true);
  return jsonb_build_object('credited_paise', p_amount_paise, 'balance_paise', pricing.balance_of(p_tenant_id), 'replayed', not v_new);
end $$;
revoke all on function public.admin_goodwill_credit(uuid, bigint, bigint, text, text, text) from public, anon;
grant execute on function public.admin_goodwill_credit(uuid, bigint, bigint, text, text, text) to authenticated;
