-- KYC first needs credits and a free channel (planner decisions of 26 Nov 2026; reports/c1-channel-design.md), on the EXISTING wallet ledger (no holds table):
--   * a phone number including its first call line costs Rs 499 a month (our cost about Rs 299 + Rs 99): pricing.settings.extra_number_paise = 49900 (config, not code); a NEW number includes 1 line (ops.line_settings.included_per_new_number,
--     recorded on the number as phone_numbers.included_lines); a number bought before this keeps the old 2 (included_lines is null: ops.line_settings.included_per_number applies);
--   * when the business's client is made (the "Your calling account" step, only after a free channel exists) the first month is DEBITED as a usage row of kind 'number_reserved' ("Held for your phone number"), once
--     (telephony.line_reserves); if the balance is too low NOTHING is created and the answer says how much is needed;
--   * cancel, a failed KYC or 14 days without verification REFUND the same amount (a refund lot, the path extra lines use) and the abandoned client is deleted so its channel returns; a bought number APPLIES it (it is the number fee);
--   * ops.channel_stock keeps the free channels the worker last saw; staff get the alert `channels_low` at 1 or fewer.
-- No call gate change: the money has already left the balance while it is "held".

-- 1. prices and included lines
update pricing.settings set extra_number_paise = 49900;
alter table pricing.settings alter column extra_number_paise set default 49900;
comment on column pricing.settings.extra_number_paise is 'SAFE: the monthly price of a phone number including its first call line (Rs 499 from 26 Nov 2026; was Rs 299 for each number after the first). CLEAN-EXEMPT: range CHECK';

alter table ops.line_settings add column included_per_new_number integer not null default 1 check (included_per_new_number between 1 and 10);
comment on column ops.line_settings.included_per_new_number is 'Platform data: the call lines included in a number bought from 26 Nov 2026 (1). A number bought earlier keeps included_per_number (2).';
alter table public.phone_numbers add column included_lines integer check (included_lines between 1 and 10);
comment on column public.phone_numbers.included_lines is 'SAFE: how many call lines this number includes (null = the platform''s older rule, ops.line_settings.included_per_number). CLEAN-EXEMPT: range CHECK';

create function app.included_lines(p_tenant uuid) returns integer language sql stable set search_path = '' as
$$ select coalesce(sum(coalesce(n.included_lines, (select s.included_per_number from ops.line_settings s))), 0)::integer from public.phone_numbers n where n.tenant_id = p_tenant $$;
revoke all on function app.included_lines(uuid) from public, anon, authenticated, service_role;

do $patch$
declare
  v_f record;
  v_def text;
begin
  for v_f in select * from (values
      ('app.workspace_lines(uuid)'::text,   $q$(select s.included_per_number from ops.line_settings s) * (select count(*)::integer from public.phone_numbers n where n.tenant_id = p_tenant)$q$::text, 'app.included_lines(p_tenant)'::text, 1),
      ('public.extra_lines_get(uuid)',      'v_set.included_per_number * v_numbers',                                                                                                            'app.included_lines(p_tenant_id)',  2),
      ('public.extra_line_buy(uuid, text)', 'v_set.included_per_number * v_numbers',                                                                                                            'app.included_lines(p_tenant_id)',  1)) as x(fn, old, new, n) loop
    v_def := pg_get_functiondef(v_f.fn::regprocedure);
    if (length(v_def) - length(replace(v_def, v_f.old, ''))) / length(v_f.old) <> v_f.n then
      raise exception '% has changed: the included-lines patch no longer fits', v_f.fn;
    end if;
    execute replace(v_def, v_f.old, v_f.new);
  end loop;
end $patch$;

-- a number bought now records how many lines it includes
do $patch$
declare
  v_def text := pg_get_functiondef('public.number_claim_attach(uuid)'::regprocedure);
  v_old1 text := $q$(tenant_id, number, label, inbound_on, provider) values$q$;
  v_new1 text := $q$(tenant_id, number, label, inbound_on, provider, included_lines) values$q$;
  v_old2 text := $q$, 'voicelink') returning * into n;$q$;
  v_new2 text := $q$, 'voicelink', (select s.included_per_new_number from ops.line_settings s)) returning * into n;$q$;
begin
  if (length(v_def) - length(replace(v_def, v_old1, ''))) / length(v_old1) <> 1 or (length(v_def) - length(replace(v_def, v_old2, ''))) / length(v_old2) <> 1 then
    raise exception 'number_claim_attach has changed: the included-lines patch no longer fits';
  end if;
  execute replace(replace(v_def, v_old1, v_new1), v_old2, v_new2);
end $patch$;

-- 2. the usage kind and its statement words
alter table pricing.usage drop constraint usage_kind_check;
alter table pricing.usage add constraint usage_kind_check check (kind in ('call', 'search', 'adjustment', 'line', 'number_reserved'));
do $patch$
declare
  v_fn text;
  v_def text;
  v_old text := $q$when 'line' then 'Extra calls at once line'$q$;
  v_new text := $q$when 'line' then 'Extra calls at once line' when 'number_reserved' then 'Held for your phone number'$q$;
begin
  foreach v_fn in array array['public.pricing_statement(uuid,date,date,integer,timestamptz)', 'pricing.statement_internal(uuid,date,date,integer,timestamptz)'] loop
    v_def := pg_get_functiondef(v_fn::regprocedure);
    if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
      raise exception '% has changed: the statement wording patch no longer fits', v_fn;
    end if;
    execute replace(v_def, v_old, v_new);
  end loop;
end $patch$;

-- 3. the reserve of a business's first month
create table telephony.line_reserves (
  tenant_id    uuid primary key references public.tenants (id),
  amount_paise bigint not null check (amount_paise >= 0),
  state        text not null check (state in ('held', 'refunded', 'applied')),
  ref          uuid not null,
  placed_at    timestamptz not null default now(),
  due_at       timestamptz not null default now() + interval '14 days',
  closed_at    timestamptz,
  reason       text check (reason is null or reason ~ '^[a-z][a-z_]{1,40}$')
);
comment on table telephony.line_reserves is 'The first month of a business''s phone number, debited when its client is made and refunded or applied later (one row per workspace, the latest). Amounts only.';
comment on column telephony.line_reserves.state is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column telephony.line_reserves.reason is 'SAFE: a closed word. CLEAN-EXEMPT: pattern CHECK';
alter table telephony.line_reserves enable row level security;
alter table telephony.line_reserves force row level security;
revoke all on telephony.line_reserves from public, anon, authenticated, service_role;
create trigger audit_line_reserves after insert or update or delete on telephony.line_reserves for each row execute function app.audit_row_change('line_reserve', '');

create function public.line_reserve_get(p_tenant_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare r telephony.line_reserves;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into r from telephony.line_reserves x where x.tenant_id = p_tenant_id;
  return jsonb_build_object('price_paise', (select s.extra_number_paise from pricing.settings s),
                            'state', case when r.tenant_id is null then 'none' else r.state end,
                            'amount_paise', coalesce(r.amount_paise, 0), 'due_at', r.due_at);
end $$;
revoke all on function public.line_reserve_get(uuid) from public, anon;
grant execute on function public.line_reserve_get(uuid) to authenticated;

-- place: debit once; answers {placed:false, reason:'credits_needed', needed_paise, balance_paise} when the balance is too low (nothing is created)
create function public.line_reserve_place(p_tenant_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_price  bigint := (select s.extra_number_paise from pricing.settings s);
  v_exempt boolean;
  v_ref    uuid;
  r        telephony.line_reserves;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform app.require_aal2();
  perform 1 from public.tenants t where t.id = p_tenant_id for update;
  select * into r from telephony.line_reserves x where x.tenant_id = p_tenant_id;
  if found and r.state = 'held' then
    return jsonb_build_object('placed', true, 'replayed', true, 'amount_paise', r.amount_paise, 'due_at', r.due_at);
  end if;
  v_exempt := exists (select 1 from public.tenants t where t.id = p_tenant_id and t.billing_exempt);
  if v_exempt then
    v_price := 0;
  elsif pricing.balance_of(p_tenant_id) < v_price then
    return jsonb_build_object('placed', false, 'reason', 'credits_needed', 'needed_paise', v_price, 'balance_paise', pricing.balance_of(p_tenant_id));
  end if;
  v_ref := gen_random_uuid();
  if v_price > 0 then
    if pricing.spend(p_tenant_id, v_price) > 0 then
      return jsonb_build_object('placed', false, 'reason', 'credits_needed', 'needed_paise', v_price, 'balance_paise', pricing.balance_of(p_tenant_id));
    end if;
    insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise, shortfall_paise) values (p_tenant_id, 'number_reserved', v_ref, 0, 0, v_price, 0);
  end if;
  insert into telephony.line_reserves (tenant_id, amount_paise, state, ref) values (p_tenant_id, v_price, 'held', v_ref)
  on conflict (tenant_id) do update set amount_paise = excluded.amount_paise, state = 'held', ref = excluded.ref, placed_at = now(), due_at = now() + interval '14 days', closed_at = null, reason = null;
  return jsonb_build_object('placed', true, 'replayed', false, 'amount_paise', v_price, 'due_at', now() + interval '14 days');
end $$;
revoke all on function public.line_reserve_place(uuid) from public, anon;
grant execute on function public.line_reserve_place(uuid) to authenticated;

-- the one place the money goes back (the Owner cancels, a failed start, or the worker): idempotent, only a held reserve
create function app.line_reserve_refund(p_tenant uuid, p_reason text) returns boolean
language plpgsql security definer set search_path = '' as
$$
declare r telephony.line_reserves;
begin
  select * into r from telephony.line_reserves x where x.tenant_id = p_tenant for update;
  if not found or r.state <> 'held' then
    return false;
  end if;
  if r.amount_paise > 0 then
    perform pricing.credit(p_tenant, 'refund', 'nres:' || r.ref::text, r.amount_paise);
  end if;
  update telephony.line_reserves set state = 'refunded', closed_at = now(), reason = p_reason where tenant_id = p_tenant;
  return true;
end $$;
revoke all on function app.line_reserve_refund(uuid, text) from public, anon, authenticated, service_role;

-- the Owner: cancel before the number is bought (refund) or mark it applied (the number was bought: the reserve is the number fee)
create function public.line_reserve_close(p_tenant_id uuid, p_outcome text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare ok boolean;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_outcome = 'refunded' then
    ok := app.line_reserve_refund(p_tenant_id, 'cancelled');
  elsif p_outcome = 'applied' then
    update telephony.line_reserves set state = 'applied', closed_at = now(), reason = 'number_bought' where tenant_id = p_tenant_id and state = 'held';
    ok := found;
  else
    raise exception 'invalid input' using errcode = '22023';
  end if;
  return jsonb_build_object('closed', ok, 'outcome', p_outcome);
end $$;
revoke all on function public.line_reserve_close(uuid, text) from public, anon;
grant execute on function public.line_reserve_close(uuid, text) to authenticated;

-- the Owner removes a client that is not verified yet (cancel): the row goes so the business can start again
create function public.business_client_remove(p_tenant_id uuid) returns void
language plpgsql security definer set search_path = '' as
$$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  delete from telephony.business_clients where tenant_id = p_tenant_id and state <> 'verified';
  delete from telephony.line_waits where tenant_id = p_tenant_id;
end $$;
revoke all on function public.business_client_remove(uuid) from public, anon;
grant execute on function public.business_client_remove(uuid) to authenticated;

-- the worker (the scheduler account): reserves past their 14 days, or whose KYC is stuck, for a business that is not verified; and the refund + removal of one
create function public.scheduler_line_reserves_due(p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
begin
  if not app.is_scheduler() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('tenant_id', x.tenant_id, 'client_id', b.client_id) order by x.due_at)
                     from (select * from telephony.line_reserves r where r.state = 'held' order by r.due_at limit least(greatest(coalesce(p_limit, 50), 1), 200)) x
                     left join telephony.business_clients b on b.tenant_id = x.tenant_id
                    where (b.state is null or b.state <> 'verified') and (x.due_at < app.outbox_now() or b.state = 'stuck')), '[]'::jsonb);
end $$;
revoke all on function public.scheduler_line_reserves_due(integer) from public, anon;
grant execute on function public.scheduler_line_reserves_due(integer) to authenticated;

create function public.scheduler_line_reserve_refund(p_tenant_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare ok boolean;
begin
  if not app.is_scheduler() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_reason is null or p_reason !~ '^[a-z][a-z_]{1,40}$' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  ok := app.line_reserve_refund(p_tenant_id, p_reason);
  delete from telephony.business_clients where tenant_id = p_tenant_id and state <> 'verified';
  return jsonb_build_object('refunded', ok);
end $$;
revoke all on function public.scheduler_line_reserve_refund(uuid, text) from public, anon;
grant execute on function public.scheduler_line_reserve_refund(uuid, text) to authenticated;

-- 4. channel stock for the staff alert
create table ops.channel_stock (
  only_row      boolean primary key default true check (only_row),
  free_channels integer not null check (free_channels >= 0),
  seen_at       timestamptz not null default now()
);
comment on table ops.channel_stock is 'Platform data: the free VoiceLink channels the worker last saw (for the low-stock alert). No personal data.';
alter table ops.channel_stock enable row level security;
alter table ops.channel_stock force row level security;
revoke all on ops.channel_stock from public, anon, authenticated, service_role;

create function public.scheduler_channel_stock_put(p_free integer) returns void
language plpgsql security definer set search_path = '' as
$$
begin
  if not app.is_scheduler() then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_free is null or p_free < 0 or p_free > 100000 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  insert into ops.channel_stock (free_channels) values (p_free) on conflict (only_row) do update set free_channels = excluded.free_channels, seen_at = now();
end $$;
revoke all on function public.scheduler_channel_stock_put(integer) from public, anon;
grant execute on function public.scheduler_channel_stock_put(integer) to authenticated;

do $patch$
declare
  v_def text := pg_get_functiondef('admin.computed_alerts(text)'::regprocedure);
  v_old text := E'     where p_role in (''owner'', ''support'') and c.n > 0\n  ) x';
  v_new text := E'     where p_role in (''owner'', ''support'') and c.n > 0\n    union all\n'
    || E'    select 9, jsonb_build_object(''id'', md5(''channels_low'')::uuid, ''kind'', ''channels_low'', ''severity'', ''warn'', ''title'', ''VoiceLink channels are running low'',\n'
    || E'             ''detail'', ''Only '' || s.free_channels || '' free channel(s) are left for new businesses. Buy more at VoiceLink (Buy DIDs and Channels > Add channels) before a business has to wait.'',\n'
    || E'             ''created_at'', s.seen_at, ''acknowledged'', false)\n'
    || E'      from ops.channel_stock s\n'
    || E'     where p_role in (''owner'', ''support'') and s.free_channels <= 1 and s.seen_at > app.outbox_now() - interval ''2 days''\n  ) x';
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'computed_alerts has changed: the low-stock alert no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end $patch$;
