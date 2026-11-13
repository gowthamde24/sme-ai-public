-- OPS, part 1: the PER-PROVIDER USAGE LEDGER (admin console, docs/plans/admin-console.md "Design"): what each provider cost US, recorded when it happened, from measured units.
--   ops.provider_rates   our cost per unit for each provider, in MICRO-PAISE (1 paisa = 1,000,000 micro-paise, so a sub-paisa rate is an exact whole number), with the date it starts and where the number comes from
--   ops.provider_usage   one row per provider line of a call, a message, a search or an assistant turn: tenant, provider, unit, units, the cost in paise (units x the rate in force at occurred_at, rounded half up),
--                        the rate it used, what it belongs to (ref_kind + ref_id) and when it happened. Unique per (provider, unit, ref_kind, ref_id): a retry changes nothing.
-- Written ONLY by the system accounts (the worker / phone server's registered scheduler account, or the channel account), through public.ops_record_usage and public.ops_record_usage_batch. No client role touches a table;
-- this PR adds NO read function (the admin console adds the operator's reads later). Not personal data: ids, closed words, counts and paise.
-- SQLSTATEs: 42501 not allowed, 22023 invalid input (unknown provider or unit, units <= 0, a bad reference, no rate in force, a batch of more than 50), 23503 no such workspace.

create schema ops;
revoke all on schema ops from public, anon, authenticated, service_role;
comment on schema ops is 'Operator tables of the admin console (the per-provider usage ledger). No client role has usage; the functions are public.ops_*.';

-- which unit a provider is billed in: one list, used by both tables
create function ops.unit_ok(p_provider text, p_unit text) returns boolean language sql immutable set search_path = '' as
$$ select case p_provider
       when 'plivo'     then p_unit = 'second'
       when 'cartesia'  then p_unit = 'character'
       when 'sarvam'    then p_unit in ('second', 'character')
       when 'anthropic' then p_unit in ('token_in', 'token_out')
       when 'meta'      then p_unit in ('message_marketing', 'message_utility', 'message_service')
       when 'google'    then p_unit = 'search'
       else false end $$;
revoke all on function ops.unit_ok(text, text) from public, anon, authenticated, service_role;

create table ops.provider_rates (
  id               uuid primary key default gen_random_uuid(),
  provider         text not null check (provider in ('cartesia', 'sarvam', 'plivo', 'anthropic', 'meta', 'google')),
  unit             text not null check (unit in ('second', 'character', 'token_in', 'token_out', 'message_marketing', 'message_utility', 'message_service', 'search')),
  cost_micro_paise bigint not null check (cost_micro_paise between 0 and 100000000000),
  valid_from       timestamptz not null,
  rate_source      text not null check (rate_source in ('estimate', 'invoice', 'list_price')),
  note             text not null check (char_length(note) between 1 and 400),
  created_at       timestamptz not null default now(),
  unique (provider, unit, valid_from),
  check (ops.unit_ok(provider, unit))
);
comment on table ops.provider_rates is 'Operator data: what each provider costs us per unit, in micro-paise, from a date on. The operator changes a rate by adding a row with a later valid_from. SAFE: not personal data.';
comment on column ops.provider_rates.provider is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list, no client can write it';
comment on column ops.provider_rates.unit is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list, no client can write it';
comment on column ops.provider_rates.rate_source is 'SAFE: a closed word (estimate, invoice, list_price). CLEAN-EXEMPT: closed CHECK list, no client can write it';
comment on column ops.provider_rates.note is 'SAFE: the operator''s note on where the number comes from. CLEAN-EXEMPT: length CHECK, operator data no client can write';
alter table ops.provider_rates enable row level security;
alter table ops.provider_rates force row level security;
revoke all on ops.provider_rates from public, anon, authenticated, service_role;

-- The starting rate card of 13 Nov 2026 (valid from 1 Jan 2026, so every recent event finds a rate), from the rates already in the code (services/ai-api/app/tasks/cost.py, app/voice/sarvam.py, app/lead_finder). A number that is only a guess says 'estimate'.
-- Plivo and Sarvam are per second: the per-second rate is rounded to a whole micro-paisa (the error is under 0.5 micro-paisa a second, a hundredth of a paisa in an hour).
-- META (WhatsApp): the per-message price of a template is NOT confirmed yet (the code's own figure is 60 paise a message, "not confirmed"). Marketing and utility are seeded at that figure and marked 'estimate';
-- a message inside the 24-hour window (service) is believed free but is also unconfirmed. The operator replaces these from Meta's invoice (a new row with a later valid_from, rate_source 'invoice').
insert into ops.provider_rates (provider, unit, cost_micro_paise, valid_from, rate_source, note) values
  ('plivo',     'second',            633333, '2026-01-01 00:00:00+00', 'list_price', 'Plivo India list price: Rs 0.38 a minute (38 paise), billed in 30-second pulses, before GST; Rs 0.38 / 60 s rounded to a whole micro-paisa (tasks/cost.py PLIVO_PAISE_PER_MINUTE)'),
  ('cartesia',  'character',         550000, '2026-01-01 00:00:00+00', 'estimate',   'Cartesia overage list price USD 65 per million characters at about Rs 85 a dollar = 0.55 paise a character; the plan''s included credits make the real cost lower (tasks/cost.py VOICE_PAISE_PER_1000_CHARS)'),
  ('sarvam',    'second',            833333, '2026-01-01 00:00:00+00', 'list_price', 'Sarvam speech-to-text list price: Rs 30 an hour of audio (sarvam.ai/api-pricing), rounded to a whole micro-paisa a second (app/voice/sarvam.py)'),
  ('sarvam',    'character',         300000, '2026-01-01 00:00:00+00', 'list_price', 'Sarvam text-to-speech (Bulbul) list price: Rs 3 per 1,000 characters = 0.3 paise a character (app/voice/sarvam.py), the fallback voice when Cartesia is out'),
  ('anthropic', 'token_in',            8500, '2026-01-01 00:00:00+00', 'estimate',   'A Haiku-class model: USD 1 per million input tokens at about Rs 85 a dollar = 0.0085 paise a token; the real model and its price are the owner''s setting (tasks/cost.py MODEL_PAISE_PER_MINUTE was derived the same way)'),
  ('anthropic', 'token_out',          42500, '2026-01-01 00:00:00+00', 'estimate',   'A Haiku-class model: USD 5 per million output tokens at about Rs 85 a dollar = 0.0425 paise a token; the real model and its price are the owner''s setting'),
  ('meta',      'message_marketing', 60000000, '2026-01-01 00:00:00+00', 'estimate', 'NOT CONFIRMED: Meta''s price of a marketing template message in India; seeded with the code''s own guess of 60 paise a message (tasks/cost.py MESSAGE_PAISE). Replace from the first invoice'),
  ('meta',      'message_utility',   60000000, '2026-01-01 00:00:00+00', 'estimate', 'NOT CONFIRMED: Meta''s price of a utility template message in India; seeded with the code''s own guess of 60 paise a message (tasks/cost.py MESSAGE_PAISE). Replace from the first invoice'),
  ('meta',      'message_service',          0, '2026-01-01 00:00:00+00', 'estimate', 'NOT CONFIRMED: a free-form reply inside the customer''s 24-hour window is believed to be free of a Meta charge; recorded so the volume is known. Confirm on the first invoice'),
  ('google',    'search',          300000000, '2026-01-01 00:00:00+00', 'estimate', 'One Places Text Search Enterprise request: the code''s configured estimate of Rs 3 (LEAD_FINDER_PLACES_COST_PAISE = 300; about USD 35 per 1,000 requests at about Rs 85 a dollar); units are provider requests');

create table ops.provider_usage (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  provider    text not null check (provider in ('cartesia', 'sarvam', 'plivo', 'anthropic', 'meta', 'google')),
  unit        text not null check (unit in ('second', 'character', 'token_in', 'token_out', 'message_marketing', 'message_utility', 'message_service', 'search')),
  units       numeric(18, 3) not null check (units > 0),
  cost_paise  bigint not null check (cost_paise >= 0),
  rate_id     uuid not null references ops.provider_rates (id) on delete restrict,
  ref_kind    text not null check (ref_kind in ('call', 'message', 'search', 'assistant_turn')),
  ref_id      text not null check (ref_id ~ '^[A-Za-z0-9_.:-]{3,100}$'),
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  unique (provider, unit, ref_kind, ref_id),
  check (ops.unit_ok(provider, unit))
);
comment on table ops.provider_usage is 'What each provider cost us, one row per provider line of a call, message, search or assistant turn. Written only by public.ops_record_usage. SAFE: ids, closed words, counts and paise; no personal data.';
comment on column ops.provider_usage.provider is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list, no client can write it';
comment on column ops.provider_usage.unit is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list, no client can write it';
comment on column ops.provider_usage.ref_kind is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list, no client can write it';
comment on column ops.provider_usage.ref_id is 'SAFE: the id of the call, message, search or assistant turn it belongs to, an opaque token. CLEAN-EXEMPT: strict anchored charset pattern CHECK';
create index provider_usage_tenant_idx on ops.provider_usage (tenant_id, occurred_at);
create index provider_usage_provider_idx on ops.provider_usage (provider, occurred_at);
alter table ops.provider_usage enable row level security;
alter table ops.provider_usage force row level security;
revoke all on ops.provider_usage from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- who may: only the system accounts (the same rule as pricing.system_only)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function ops.system_only() returns void language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null or not (app.is_scheduler() or app.is_channel_agent()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
end $$;
revoke all on function ops.system_only() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the one writer (internal): validates, looks up the rate in force at occurred_at, rounds half up, inserts once
-- ---------------------------------------------------------------------------------------------------------------------------------
create function ops.record(p_tenant_id uuid, p_provider text, p_unit text, p_units numeric, p_ref_kind text, p_ref_id text, p_occurred_at timestamptz) returns jsonb language plpgsql set search_path = '' as
$$
declare
  v_units numeric;
  v_rate  ops.provider_rates;
  v_cost  bigint;
  v_row   ops.provider_usage;
begin
  if p_tenant_id is null or p_provider is null or p_unit is null or p_units is null or p_ref_kind is null or p_ref_id is null or p_occurred_at is null
     or not ops.unit_ok(p_provider, p_unit)
     or p_ref_kind not in ('call', 'message', 'search', 'assistant_turn')
     or p_ref_id !~ '^[A-Za-z0-9_.:-]{3,100}$'
     or p_units <= 0 or p_units >= 1000000000000000 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  v_units := round(p_units, 3);
  if v_units <= 0 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  -- a retry changes nothing: the row that is already there is the answer (the first writer's units, rate and cost stand)
  select * into v_row from ops.provider_usage u where u.provider = p_provider and u.unit = p_unit and u.ref_kind = p_ref_kind and u.ref_id = p_ref_id;
  if found then
    return jsonb_build_object('id', v_row.id, 'units', v_row.units, 'cost_paise', v_row.cost_paise, 'rate_id', v_row.rate_id, 'replayed', true);
  end if;
  select * into v_rate from ops.provider_rates r where r.provider = p_provider and r.unit = p_unit and r.valid_from <= p_occurred_at order by r.valid_from desc limit 1;
  if not found then
    raise exception 'no rate in force' using errcode = '22023';
  end if;
  -- units x micro-paise per unit / 1,000,000 = paise, rounded half up (exact: numeric arithmetic)
  v_cost := floor((v_units * v_rate.cost_micro_paise + 500000) / 1000000)::bigint;
  insert into ops.provider_usage (tenant_id, provider, unit, units, cost_paise, rate_id, ref_kind, ref_id, occurred_at)
  values (p_tenant_id, p_provider, p_unit, v_units, v_cost, v_rate.id, p_ref_kind, p_ref_id, p_occurred_at)
  on conflict (provider, unit, ref_kind, ref_id) do nothing
  returning * into v_row;
  if not found then   -- two writers at once: the other one won
    select * into v_row from ops.provider_usage u where u.provider = p_provider and u.unit = p_unit and u.ref_kind = p_ref_kind and u.ref_id = p_ref_id;
    return jsonb_build_object('id', v_row.id, 'units', v_row.units, 'cost_paise', v_row.cost_paise, 'rate_id', v_row.rate_id, 'replayed', true);
  end if;
  return jsonb_build_object('id', v_row.id, 'units', v_row.units, 'cost_paise', v_row.cost_paise, 'rate_id', v_row.rate_id, 'replayed', false);
end $$;
revoke all on function ops.record(uuid, text, text, numeric, text, text, timestamptz) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- the two doors (system accounts only)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.ops_record_usage(p_tenant_id uuid, p_provider text, p_unit text, p_units numeric, p_ref_kind text, p_ref_id text, p_occurred_at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as
$$
begin
  perform ops.system_only();
  return ops.record(p_tenant_id, p_provider, p_unit, p_units, p_ref_kind, p_ref_id, p_occurred_at);
end $$;
revoke all on function public.ops_record_usage(uuid, text, text, numeric, text, text, timestamptz) from public, anon;
grant execute on function public.ops_record_usage(uuid, text, text, numeric, text, text, timestamptz) to authenticated;

-- a call's end writes all its provider lines in one round trip: p_items is a JSON array of up to 50 objects {tenant_id, provider, unit, units, ref_kind, ref_id, occurred_at (optional)}; all or nothing
create function public.ops_record_usage_batch(p_items jsonb) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  e       jsonb;
  v_out   jsonb := '[]'::jsonb;
  v_units text;
  v_tenant text;
  v_at    timestamptz;
begin
  perform ops.system_only();
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) not between 1 and 50 then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  for e in select x from jsonb_array_elements(p_items) x loop
    if jsonb_typeof(e) <> 'object' then
      raise exception 'invalid input' using errcode = '22023';
    end if;
    v_units := e ->> 'units';
    v_tenant := e ->> 'tenant_id';
    if v_units is null or v_units !~ '^[0-9]{1,15}(\.[0-9]{1,6})?$'
       or v_tenant is null or v_tenant !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or (e ? 'occurred_at' and e ->> 'occurred_at' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9:.]+(Z|[+-][0-9]{2}(:?[0-9]{2})?)$') then
      raise exception 'invalid input' using errcode = '22023';
    end if;
    v_at := coalesce((e ->> 'occurred_at')::timestamptz, now());
    v_out := v_out || jsonb_build_array(ops.record(v_tenant::uuid, e ->> 'provider', e ->> 'unit', v_units::numeric, e ->> 'ref_kind', e ->> 'ref_id', v_at));
  end loop;
  return jsonb_build_object('items', v_out, 'count', jsonb_array_length(v_out));
end $$;
revoke all on function public.ops_record_usage_batch(jsonb) from public, anon;
grant execute on function public.ops_record_usage_batch(jsonb) to authenticated;
