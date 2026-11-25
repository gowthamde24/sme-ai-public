-- Extra lines: "calls at once" per workspace (26 Nov 2026; API and web switch EXTRA_LINES, OFF at deploy; the platform switch below is OFF too).
--   * A workspace's lines = 2 for every phone number it has (ops.line_settings.included_per_number) + the extra lines it bought and that are working.
--   * An extra line costs Rs 149 a month (ops.line_settings.price_paise), taken from the credits wallet when it is bought and again every month. Our cost at VoiceLink is about Rs 99 a channel.
--   * At most 20 lines in a workspace (ops.line_settings.default_cap); Stack19 raises it for one workspace with app.operator_set_line_cap.
--   * Cancelling takes effect at the end of the paid month; the 2 included lines of a number are never cancelled (they are not rows).
--   * A renewal that cannot be paid (not enough credits) gives 3 days of grace (the line keeps working, the Owner gets a "Needs you" item), then the line pauses. It resumes by itself when credits are added.
--     A line paused for 30 days ends and its channel is given back.
-- The money moves only in these functions (the wallet's own spend), never through a table write: pricing.extra_lines has RLS forced, members may read their own rows, nobody writes directly.
-- The purchase of the channel at the phone company is the API's job (a port with a fake and a VoiceLink adapter, off): this file never calls anyone. A channel that could not be bought gives the money back.
-- The statement says "Extra calls at once line" for a charge (usage kind `line`). Codes: SM954 not available now, SM955 the workspace is at its limit, SM956 no phone number yet, SM957 not enough credits, SM958 no such line.
-- Rollback = the platform switch off (ops.line_settings.enabled) and the API switch off; the objects are additive.

create table ops.line_settings (
  only_row            boolean primary key default true check (only_row),
  enabled             boolean not null default false,
  price_paise         bigint not null default 14900 check (price_paise between 0 and 10000000),
  default_cap         integer not null default 20 check (default_cap between 2 and 100),
  included_per_number integer not null default 2 check (included_per_number between 1 and 10),
  grace_days          integer not null default 3 check (grace_days between 0 and 30),
  updated_at          timestamptz not null default now()
);
insert into ops.line_settings default values;
comment on table ops.line_settings is 'Platform data (not tenant data): the extra-lines switch, the monthly price of one extra line in paise (before GST, taken from the wallet), the default most lines a workspace may have, the lines each number includes, the days of grace. No personal data.';
alter table ops.line_settings enable row level security;
alter table ops.line_settings force row level security;
revoke all on ops.line_settings from public, anon, authenticated, service_role;

create table ops.line_caps (
  tenant_id  uuid primary key references public.tenants (id) on delete restrict,
  max_lines  integer not null check (max_lines between 2 and 100),
  updated_at timestamptz not null default now()
);
comment on table ops.line_caps is 'Platform data about ONE workspace: a higher (or lower) most-lines limit than the default, set by Stack19 staff. No personal data.';
alter table ops.line_caps enable row level security;
alter table ops.line_caps force row level security;
revoke all on ops.line_caps from public, anon, authenticated, service_role;

create function app.operator_set_extra_lines(p_enabled boolean, p_price_paise bigint default null, p_default_cap integer default null) returns void language sql security definer set search_path = '' as
$$ update ops.line_settings set enabled = p_enabled, price_paise = coalesce(p_price_paise, price_paise), default_cap = coalesce(p_default_cap, default_cap), updated_at = now() $$;
revoke all on function app.operator_set_extra_lines(boolean, bigint, integer) from public, anon, authenticated, service_role;

create function app.operator_set_line_cap(p_tenant uuid, p_max integer) returns void language sql security definer set search_path = '' as
$$ insert into ops.line_caps (tenant_id, max_lines) values (p_tenant, p_max) on conflict (tenant_id) do update set max_lines = excluded.max_lines, updated_at = now() $$;
revoke all on function app.operator_set_line_cap(uuid, integer) from public, anon, authenticated, service_role;

-- one row per extra line
create table pricing.extra_lines (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references public.tenants (id) on delete restrict,
  status               text not null default 'active' check (status in ('active', 'grace', 'paused', 'ended')),
  price_paise          bigint not null check (price_paise between 0 and 10000000),
  started_at           timestamptz not null default now(),
  paid_until           timestamptz not null,
  cancel_at_period_end boolean not null default false,
  grace_until          timestamptz,
  paused_at            timestamptz,
  ended_at             timestamptz,
  channel_state        text not null default 'pending' check (channel_state in ('pending', 'bought', 'failed', 'released')),
  channel_ref          text check (channel_ref is null or channel_ref ~ '^[A-Za-z0-9_.:-]{1,60}$'),
  buy_key              text not null check (buy_key ~ '^[A-Za-z0-9_-]{8,64}$'),
  created_by           uuid not null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (tenant_id, buy_key)
);
comment on table pricing.extra_lines is 'One extra line (one more call at once) a workspace bought: its month, its state, whether the channel at the phone company is bought. Written only by the extra_line_* functions; members read their own through extra_lines_get.';
comment on column pricing.extra_lines.status is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column pricing.extra_lines.channel_state is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
comment on column pricing.extra_lines.channel_ref is 'SAFE: the phone company''s order word for the channel, an opaque token. CLEAN-EXEMPT: charset-limited CHECK';
comment on column pricing.extra_lines.buy_key is 'SAFE: the idempotency key of the purchase, an opaque token. CLEAN-EXEMPT: charset-limited CHECK';
create index extra_lines_tenant_idx on pricing.extra_lines (tenant_id, started_at);
create index extra_lines_due_idx on pricing.extra_lines (paid_until) where status in ('active', 'grace', 'paused');
alter table pricing.extra_lines enable row level security;
alter table pricing.extra_lines force row level security;
revoke all on pricing.extra_lines from public, anon, authenticated, service_role;
create policy extra_lines_member_read on pricing.extra_lines for select to authenticated using (app.is_tenant_member(tenant_id));   -- the rule for reading; the table itself is read through extra_lines_get (no grant), never written

-- the ledger may hold a line's monthly charge, and the statement says so
alter table pricing.usage drop constraint usage_kind_check;
alter table pricing.usage add constraint usage_kind_check check (kind in ('call', 'search', 'adjustment', 'line'));
do $patch$
declare
  v_old text := $q$when 'adjustment' then 'Taken back by Stack19' else 'Lead Finder search' end$q$;
  v_new text := $q$when 'adjustment' then 'Taken back by Stack19' when 'line' then 'Extra calls at once line' else 'Lead Finder search' end$q$;
  v_def text;
begin
  v_def := pg_get_functiondef('public.pricing_statement(uuid,date,date,integer,timestamptz)'::regprocedure);
  if position(v_old in v_def) = 0 then
    raise exception 'pricing_statement has changed: the line label no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
  v_def := pg_get_functiondef('pricing.statement_internal(uuid,date,date,integer,timestamptz)'::regprocedure);
  if position(v_old in v_def) = 0 then
    raise exception 'statement_internal has changed: the line label no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- how many lines a workspace has (the call gate reads this; the screen shows it)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.line_cap(p_tenant uuid) returns integer language sql stable set search_path = '' as
$$ select coalesce((select c.max_lines from ops.line_caps c where c.tenant_id = p_tenant), (select s.default_cap from ops.line_settings s)) $$;
revoke all on function app.line_cap(uuid) from public, anon, authenticated, service_role;

create function app.workspace_lines(p_tenant uuid) returns integer language sql stable set search_path = '' as
$$
  select (select s.included_per_number from ops.line_settings s) * (select count(*)::integer from public.phone_numbers n where n.tenant_id = p_tenant)
       + (select count(*)::integer from pricing.extra_lines x where x.tenant_id = p_tenant and x.status in ('active', 'grace') and x.channel_state = 'bought')
$$;
revoke all on function app.workspace_lines(uuid) from public, anon, authenticated, service_role;

-- the phone server's own account: the lines of one workspace, and the live calls of every workspace (counted from the calls table, so another API instance's calls are in it)
create function public.phone_workspace_lines(p_tenant_id uuid) returns integer language plpgsql stable security definer set search_path = '' as
$$
begin
  perform ops.system_only();
  return app.workspace_lines(p_tenant_id);
end $$;
revoke all on function public.phone_workspace_lines(uuid) from public, anon;
grant execute on function public.phone_workspace_lines(uuid) to authenticated;

create function public.phone_live_by_tenant() returns jsonb language plpgsql stable security definer set search_path = '' as
$$
begin
  perform ops.system_only();
  return coalesce((select jsonb_object_agg(x.tenant_id::text, x.n) from (select c.tenant_id, count(*)::integer as n from public.phone_calls c where app.phone_call_is_live(c) group by c.tenant_id) x), '{}'::jsonb);
end $$;
revoke all on function public.phone_live_by_tenant() from public, anon;
grant execute on function public.phone_live_by_tenant() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- reading (any member)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.extra_line_json(r pricing.extra_lines, p_replayed boolean default false) returns jsonb language sql stable set search_path = '' as
$$
  select jsonb_build_object('id', r.id, 'status', r.status, 'price_paise', r.price_paise, 'started_at', r.started_at, 'paid_until', r.paid_until, 'cancel_at_period_end', r.cancel_at_period_end,
                            'grace_until', r.grace_until, 'working', r.status in ('active', 'grace') and r.channel_state = 'bought', 'channel_state', r.channel_state, 'replayed', p_replayed)
$$;
revoke all on function app.extra_line_json(pricing.extra_lines, boolean) from public, anon, authenticated, service_role;

create function public.extra_lines_get(p_tenant_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
declare
  v_set     ops.line_settings;
  v_numbers integer;
  v_cap     integer;
  v_extra   integer;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform pricing.deny();
  end if;
  select * into v_set from ops.line_settings;
  v_numbers := (select count(*)::integer from public.phone_numbers n where n.tenant_id = p_tenant_id);
  v_cap := app.line_cap(p_tenant_id);
  v_extra := (select count(*)::integer from pricing.extra_lines x where x.tenant_id = p_tenant_id and x.status <> 'ended' and x.channel_state <> 'failed');
  return jsonb_build_object(
    'enabled', v_set.enabled, 'price_paise', v_set.price_paise, 'cap', v_cap, 'numbers', v_numbers, 'included', v_set.included_per_number * v_numbers,
    'total', app.workspace_lines(p_tenant_id),
    'can_add', v_set.enabled and v_numbers > 0 and v_set.included_per_number * v_numbers + v_extra < v_cap,
    'extra', coalesce((select jsonb_agg(app.extra_line_json(x) order by x.started_at, x.id) from pricing.extra_lines x where x.tenant_id = p_tenant_id and x.status <> 'ended' and x.channel_state <> 'failed'), '[]'::jsonb));
end $$;
revoke all on function public.extra_lines_get(uuid) from public, anon;
grant execute on function public.extra_lines_get(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- buying one (the Owner): every rule is checked here, the wallet is charged, the line is recorded with its channel still to buy
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.extra_line_buy(p_tenant_id uuid, p_key text) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_set     ops.line_settings;
  v_row     pricing.extra_lines;
  v_numbers integer;
  v_have    integer;
  v_exempt  boolean;
  v_id      uuid := gen_random_uuid();
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform pricing.deny();
  end if;
  if p_key is null or p_key !~ '^[A-Za-z0-9_-]{8,64}$' then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('extra_lines:' || p_tenant_id::text, 0));
  select * into v_row from pricing.extra_lines x where x.tenant_id = p_tenant_id and x.buy_key = p_key;
  if found then
    return app.extra_line_json(v_row, true);
  end if;
  select * into v_set from ops.line_settings;
  if not v_set.enabled then
    raise exception 'lines cannot be added now' using errcode = 'SM954';
  end if;
  v_numbers := (select count(*)::integer from public.phone_numbers n where n.tenant_id = p_tenant_id);
  if v_numbers = 0 then
    raise exception 'no phone number yet' using errcode = 'SM956';
  end if;
  v_have := v_set.included_per_number * v_numbers + (select count(*)::integer from pricing.extra_lines x where x.tenant_id = p_tenant_id and x.status <> 'ended' and x.channel_state <> 'failed');
  if v_have + 1 > app.line_cap(p_tenant_id) then
    raise exception 'line limit reached' using errcode = 'SM955';
  end if;
  v_exempt := exists (select 1 from public.tenants t where t.id = p_tenant_id and t.billing_exempt);
  if not v_exempt and v_set.price_paise > 0 then
    if pricing.balance_of(p_tenant_id) < v_set.price_paise or pricing.spend(p_tenant_id, v_set.price_paise) > 0 then
      raise exception 'not enough credits' using errcode = 'SM957';   -- the whole call rolls back: nothing was taken
    end if;
    insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise, shortfall_paise) values (p_tenant_id, 'line', md5(v_id::text || ':first')::uuid, 0, 0, v_set.price_paise, 0);
  end if;
  insert into pricing.extra_lines (id, tenant_id, price_paise, paid_until, buy_key, created_by)
  values (v_id, p_tenant_id, case when v_exempt then 0 else v_set.price_paise end, now() + interval '1 month', p_key, auth.uid())
  returning * into v_row;
  perform app.write_audit_event(p_tenant_id, 'extra_line.added', 'workspace', p_tenant_id, null, jsonb_build_object('lines', v_have + 1));
  return app.extra_line_json(v_row, false);
end $$;
revoke all on function public.extra_line_buy(uuid, text) from public, anon;
grant execute on function public.extra_line_buy(uuid, text) to authenticated;

-- how the channel purchase ended (the API says it; the phone server's account or the Owner): bought -> the line counts; failed -> the line ends and the money goes back
create function public.extra_line_channel_result(p_id uuid, p_ok boolean, p_ref text default null) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  r pricing.extra_lines;
begin
  select * into r from pricing.extra_lines x where x.id = p_id for update;
  if not found or auth.uid() is null or not (app.is_scheduler() or app.has_tenant_role(r.tenant_id, array['owner']::public.app_role[])) then
    perform pricing.deny();
  end if;
  if p_ok is null or (p_ref is not null and p_ref !~ '^[A-Za-z0-9_.:-]{1,60}$') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if r.channel_state <> 'pending' then
    return app.extra_line_json(r, true);
  end if;
  if p_ok then
    update pricing.extra_lines set channel_state = 'bought', channel_ref = p_ref, updated_at = now() where id = r.id returning * into r;
  else
    update pricing.extra_lines set channel_state = 'failed', status = 'ended', ended_at = now(), updated_at = now() where id = r.id returning * into r;
    if r.price_paise > 0 then
      perform pricing.credit(r.tenant_id, 'refund', 'xline:' || r.id::text, r.price_paise);   -- the first month goes back whole
    end if;
    perform app.write_audit_event(r.tenant_id, 'extra_line.failed', 'workspace', r.tenant_id, null, jsonb_build_object('reason', 'channel_not_bought'));
  end if;
  return app.extra_line_json(r, false);
end $$;
revoke all on function public.extra_line_channel_result(uuid, boolean, text) from public, anon;
grant execute on function public.extra_line_channel_result(uuid, boolean, text) to authenticated;

-- cancel (the line works to the end of the paid month) or keep it again; a paused line ends at once
create function public.extra_line_cancel(p_tenant_id uuid, p_id uuid, p_cancel boolean default true) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  r pricing.extra_lines;
begin
  if auth.uid() is null or p_tenant_id is null or p_id is null or p_cancel is null or not app.has_tenant_role(p_tenant_id, array['owner']::public.app_role[]) then
    perform pricing.deny();
  end if;
  select * into r from pricing.extra_lines x where x.id = p_id and x.tenant_id = p_tenant_id for update;
  if not found or r.status = 'ended' then
    raise exception 'no such line' using errcode = 'SM958';
  end if;
  if p_cancel and r.status = 'paused' then
    update pricing.extra_lines set status = 'ended', ended_at = now(), cancel_at_period_end = true, updated_at = now() where id = r.id returning * into r;
  else
    update pricing.extra_lines set cancel_at_period_end = p_cancel, updated_at = now() where id = r.id returning * into r;
  end if;
  perform app.write_audit_event(p_tenant_id, case when p_cancel then 'extra_line.cancelled' else 'extra_line.kept' end, 'workspace', p_tenant_id, null, jsonb_build_object('status', r.status));
  return app.extra_line_json(r, false);
end $$;
revoke all on function public.extra_line_cancel(uuid, uuid, boolean) from public, anon;
grant execute on function public.extra_line_cancel(uuid, uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the worker's monthly pass (the scheduler account): renew what is due, give grace, pause, end; and list what the API still has to do at the phone company
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.extra_lines_renew(p_limit integer default 50) returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_set     ops.line_settings;
  r         pricing.extra_lines;
  v_renewed integer := 0;
  v_grace   integer := 0;
  v_paused  integer := 0;
  v_ended   integer := 0;
  v_exempt  boolean;
  v_next    timestamptz;
begin
  if not app.is_scheduler() then
    perform pricing.deny();
  end if;
  if p_limit is null or p_limit not between 1 and 500 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  select * into v_set from ops.line_settings;
  for r in select * from pricing.extra_lines x where x.channel_state = 'bought' and x.status in ('active', 'grace', 'paused') and x.paid_until <= now() order by x.paid_until, x.id limit p_limit for update skip locked loop
    if r.cancel_at_period_end then
      update pricing.extra_lines set status = 'ended', ended_at = now(), updated_at = now() where id = r.id;
      v_ended := v_ended + 1;
      continue;
    end if;
    v_exempt := exists (select 1 from public.tenants t where t.id = r.tenant_id and t.billing_exempt);
    if v_exempt or r.price_paise = 0 or (pricing.balance_of(r.tenant_id) >= r.price_paise and pricing.spend(r.tenant_id, r.price_paise) = 0) then
      v_next := case when r.status <> 'paused' and r.paid_until + interval '1 month' > now() then r.paid_until + interval '1 month' else now() + interval '1 month' end;
      if not v_exempt and r.price_paise > 0 then
        insert into pricing.usage (tenant_id, kind, ref, half_minutes, included_half, charged_paise, shortfall_paise)
        values (r.tenant_id, 'line', md5(r.id::text || ':' || extract(epoch from r.paid_until)::text)::uuid, 0, 0, r.price_paise, 0) on conflict do nothing;
      end if;
      update pricing.extra_lines set status = 'active', paid_until = v_next, grace_until = null, paused_at = null, updated_at = now() where id = r.id;
      v_renewed := v_renewed + 1;
    elsif r.status = 'active' then
      update pricing.extra_lines set status = 'grace', grace_until = now() + make_interval(days => v_set.grace_days), updated_at = now() where id = r.id;
      v_grace := v_grace + 1;
    elsif r.status = 'grace' and r.grace_until <= now() then
      update pricing.extra_lines set status = 'paused', paused_at = now(), updated_at = now() where id = r.id;
      v_paused := v_paused + 1;
    elsif r.status = 'paused' and r.paused_at <= now() - interval '30 days' then
      update pricing.extra_lines set status = 'ended', ended_at = now(), updated_at = now() where id = r.id;
      v_ended := v_ended + 1;
    end if;
  end loop;
  return jsonb_build_object('renewed', v_renewed, 'grace', v_grace, 'paused', v_paused, 'ended', v_ended,
    'pending', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'tenant_id', x.tenant_id)) from (select p.id, p.tenant_id from pricing.extra_lines p where p.channel_state = 'pending' and p.status = 'active' and p.created_at < now() - interval '2 minutes' order by p.created_at limit 50) x), '[]'::jsonb),
    'release', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'tenant_id', x.tenant_id)) from (select e.id, e.tenant_id from pricing.extra_lines e where e.status = 'ended' and e.channel_state = 'bought' order by e.ended_at limit 50) x), '[]'::jsonb));
end $$;
revoke all on function public.extra_lines_renew(integer) from public, anon;
grant execute on function public.extra_lines_renew(integer) to authenticated;

-- the line's channel was given back at the phone company (or never existed): remembered, so it is not asked again
create function public.extra_line_released(p_id uuid) returns void language plpgsql security definer set search_path = '' as
$$
begin
  if not app.is_scheduler() then
    perform pricing.deny();
  end if;
  update pricing.extra_lines set channel_state = 'released', updated_at = now() where id = p_id and status = 'ended' and channel_state = 'bought';
end $$;
revoke all on function public.extra_line_released(uuid) from public, anon;
grant execute on function public.extra_line_released(uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- "Needs you": a renewal that could not be paid (the line is in its grace days, or paused). Owner and Admin; it goes by itself when the line is paid.
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.today_line_renewal(p_tenant uuid) returns table (id uuid, at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select md5('line_renewal:' || p_tenant::text)::uuid, app.outbox_now()
   where auth.uid() is not null and app.has_tenant_role(p_tenant, array['owner', 'admin']::public.app_role[])
     and exists (select 1 from pricing.extra_lines x where x.tenant_id = p_tenant and x.status in ('grace', 'paused') and x.channel_state = 'bought')
$$;
revoke all on function app.today_line_renewal(uuid) from public;
grant execute on function app.today_line_renewal(uuid) to authenticated;   -- today_summary runs as the caller; this answers the caller's own workspace and only for its Owner and Admin

do $patch$
declare
  v_def    text := pg_get_functiondef('public.today_summary(uuid)'::regprocedure);
  v_marker constant text := E'      from app.today_credits_low(p_tenant_id) cl\n     where v_decider\n';
  v_new    text;
begin
  if position(v_marker in v_def) = 0 then
    raise exception 'needs-you: the Today function is not the one this migration expects';
  end if;
  v_new := replace(v_def, v_marker, v_marker
    || E'    union all\n'
    || E'    select ''line_renewal'', lr.id, ''Balance''::text, null::text, ''followup_desk'', ''lines'', null::bigint, lr.at, ''billing'', p_tenant_id\n'
    || E'      from app.today_line_renewal(p_tenant_id) lr\n'
    || E'     where v_decider\n');
  execute v_new;
end
$patch$;
