-- Job CK (wave 1, C1, ADR 0084 part 1, blueprint sections 3 and 4): SWITCH THE PACKS ON. Migration 4 of 4 of the job (structure, generated data, custom fields, THIS).
--
--   1. EVERY existing business runs the default pack (the one pack.json marked default_for_existing_workspaces, today's textile behaviour), source `legacy`. Their recorded sign-up type is NOT acted on:
--      nothing read it before, "textiles must not change", and moving a business between packs is an operator act (ADR 0084 part 1).
--   2. EVERY new business gets the default pack the moment its tenants row is inserted (source `default`), whatever path made it (sign-up, POST /v1/tenants, a test, a seed). The sign-up then moves it
--      to the pack the person chose. A database with no default pack REFUSES to make a business (fail closed).
--   3. THE GUARDS: a BEFORE INSERT trigger (app.module_guard) on every table a module owns. A module that is off for the business cannot create rows (SM701); reads and updates are untouched. Because the
--      default pack lists every module that exists today, the guards are a no-op for the default pack: that is the equivalence proof (supabase/tests/database/93_ck_modules.test.sql).
--   4. UNITS: a product's selling unit must be one of packs.units when written or changed.
--   5. SIGN-UP: the business type is the ONLY thing sign-up needs. complete_setup(business_type, language) takes a PACK CODE (SM702 when it is not selectable), the business name is optional (the activation
--      checklist asks for it; until then it is "My business"), the terms may be evidenced by the old sign-up metadata OR by the acceptance the setup call records (a Google or Facebook account has no sign-up
--      form), and an e-mail the identity provider did not verify is refused (SM309). get_account_setup says `needed` also for a social account that has not set up a business.
--      The previous bodies are in 20261031090100; the lines that differ are named in services/ai-api/tests/test_migration_copies_ck.py.
--
-- A second factor is NOT asked at sign-up. It is asked at the first action that needs one: approving a quote, a follow-up, an outbox message, a call or an order; connecting WhatsApp; the other Owner and
-- Admin acts of ADR 0016 (app.require_aal2, unchanged).

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 0. which module an agent needs
-- ---------------------------------------------------------------------------------------------------------------------------------
insert into packs.agent_modules (agent_name, module) values ('research', 'research'), ('requirement', 'enquiries'), ('assistant', 'today');

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. existing businesses
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from packs.pack_versions where is_default) then
    raise exception 'no default pack: run scripts/pack_migration.py';
  end if;
end;
$$;
insert into packs.workspace_pack (tenant_id, pack_code, pack_version, source)
select t.id, d.code, d.version, 'legacy' from public.tenants t cross join (select code, version from packs.pack_versions where is_default) d;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. new businesses
-- ---------------------------------------------------------------------------------------------------------------------------------
create function app.assign_default_pack() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d packs.pack_versions;
begin
  select * into d from packs.pack_versions v where v.is_default;
  if not found then
    raise exception 'no default pack is installed' using errcode = 'SM702';
  end if;
  insert into packs.workspace_pack (tenant_id, pack_code, pack_version, source) values (new.id, d.code, d.version, 'default');
  return new;
end;
$$;
revoke all on function app.assign_default_pack() from public;
create trigger tenants_assign_default_pack after insert on public.tenants for each row execute function app.assign_default_pack();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. the guards (module -> the tables it owns). A module whose `guard` is `future` has none yet; its job registers them.
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  g record;
begin
  for g in
    select * from (values
      ('contacts',     'public', 'contacts'),
      ('companies',    'public', 'companies'),
      ('enquiries',    'public', 'leads'),
      ('enquiries',    'public', 'opportunities'),
      ('enquiries',    'public', 'enquiries'),
      ('enquiries',    'public', 'requirements'),
      ('enquiries',    'public', 'requirement_fields'),
      ('catalogue',    'public', 'catalogue_items'),
      ('catalogue',    'public', 'catalogue_photos'),
      ('catalogue',    'public', 'products'),
      ('quotes',       'public', 'quotes'),
      ('quotes',       'public', 'quote_lines'),
      ('quotes',       'public', 'price_lists'),
      ('quotes',       'public', 'price_list_versions'),
      ('quotes',       'public', 'price_list_items'),
      ('quotes',       'public', 'price_list_breaks'),
      ('quotes',       'public', 'quote_policy_versions'),
      ('quotes',       'public', 'mapper_config_versions'),
      ('quotes',       'public', 'item_types'),
      ('quotes',       'public', 'requirement_line_picks'),
      ('orders',       'public', 'orders'),
      ('orders',       'public', 'order_events'),
      ('orders',       'public', 'order_policy_versions'),
      ('followups',    'public', 'lead_touches'),
      ('followups',    'public', 'followup_drafts'),
      ('followups',    'public', 'followup_policy_versions'),
      ('followups',    'public', 'question_drafts'),
      ('visits',       'public', 'store_visits'),
      ('visits',       'public', 'store_settings'),
      ('visits',       'public', 'visit_reminders'),
      ('call_list',    'public', 'call_requests'),
      ('integrations', 'integrations', 'import_jobs'),
      ('payment_links', 'integrations', 'payment_links')
    ) as t(module, schema_name, table_name)
  loop
    execute format('create trigger module_guard before insert on %I.%I for each row execute function app.module_guard(%L)', g.schema_name, g.table_name, g.module);
  end loop;
end;
$$;
create trigger module_guard_agent before insert on public.agent_runs for each row execute function app.module_guard_agent();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. selling units
-- ---------------------------------------------------------------------------------------------------------------------------------
-- AFTER, so the table's own CHECKs (text hygiene) answer first with their own error
create trigger products_unit_check after insert or update of unit on public.products for each row execute function app.products_unit_check();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. sign-up
-- ---------------------------------------------------------------------------------------------------------------------------------
alter table public.account_setups drop constraint account_setups_business_type_check;
alter table public.account_setups add constraint account_setups_business_type_check check (business_type ~ '^[a-z][a-z0-9_]{1,30}$');
comment on column public.account_setups.business_type is 'SAFE: the pack code the person chose at sign-up (packs.pack_versions.code), or one of the three older words (textiles, construction, other). CLEAN-EXEMPT: strict pattern in a CHECK';

-- Is this account's e-mail address one we trust? Confirmed by Supabase Auth AND not marked unverified by any identity provider. (Supabase links a social sign-in to an existing account by e-mail only when the
-- provider says the address is verified; this is the second lock, and the setup refuses without it.)
create function app.account_email_verified(p_user uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from auth.users u where u.id = p_user and u.deleted_at is null and u.email_confirmed_at is not null)
     and not exists (select 1 from auth.identities i where i.user_id = p_user and i.provider <> 'email' and i.identity_data ? 'email_verified' and lower(i.identity_data ->> 'email_verified') in ('false', 'f', '0'))
$$;
revoke all on function app.account_email_verified(uuid) from public;

create or replace function public.get_account_setup() returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_setup public.account_setups;
  v_name  text;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into v_setup from public.account_setups where user_id = v_uid;
  if found then
    return jsonb_build_object('state', 'done', 'tenant_id', v_setup.created_tenant_id, 'business_name', null);
  end if;
  if exists (select 1 from public.terms_acceptances where user_id = v_uid) then
    select nullif(btrim(u.raw_user_meta_data ->> 'business_name'), '') into v_name from auth.users u where u.id = v_uid;
    return jsonb_build_object('state', 'needed', 'tenant_id', null, 'business_name', v_name);
  end if;
  -- a Google or Facebook account has no sign-up form: it needs the setup until it has a business of its own or has joined one
  if exists (select 1 from auth.identities i where i.user_id = v_uid and i.provider <> 'email')
     and not exists (select 1 from public.memberships m where m.user_id = v_uid) then
    return jsonb_build_object('state', 'needed', 'tenant_id', null, 'business_name', null);
  end if;
  return jsonb_build_object('state', 'none', 'tenant_id', null, 'business_name', null);
end;
$$;

create or replace function public.complete_setup(p_business_type text, p_language text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_user      auth.users;
  v_setup     public.account_setups;
  v_pack      packs.pack_versions;
  v_name      text;
  v_base      text;
  v_slug      text;
  v_tenant    public.tenants;
  v_attempts  integer := 0;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_business_type is null or p_business_type !~ '^[a-z][a-z0-9_]{1,30}$' then
    raise exception 'business type is not valid' using errcode = '22023';
  end if;
  if p_language is null or p_language not in ('en', 'te', 'hi', 'kn') then
    raise exception 'language must be en, te, hi or kn' using errcode = '22023';
  end if;
  select * into v_pack from packs.pack_versions p
   where p.code = p_business_type and p.status in ('preview', 'published') order by p.version desc limit 1;
  if not found then
    perform app.pack_error('unavailable');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('complete_setup:' || v_uid::text, 0));

  -- a repeat (double click, second tab, a retry) returns the same business and changes nothing
  select * into v_setup from public.account_setups where user_id = v_uid;
  if found then
    return jsonb_build_object('tenant_id', v_setup.created_tenant_id, 'created', false);
  end if;

  select * into v_user from auth.users where id = v_uid;
  if not found or v_user.deleted_at is not null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if not app.account_email_verified(v_uid) then
    raise exception 'confirm your e-mail address first' using errcode = 'SM309';
  end if;
  if not exists (select 1 from public.terms_acceptances where user_id = v_uid)
     and not exists (select 1 from integrations.policy_acceptances a where a.user_id = v_uid and a.kind = 'terms') then
    raise exception 'the terms were not accepted at sign-up' using errcode = 'SM308';
  end if;

  v_name := btrim(coalesce(v_user.raw_user_meta_data ->> 'business_name', ''));
  if v_name = '' then
    v_name := 'My business';  -- sign-up asks only the business type; the activation checklist asks the name
  elsif char_length(v_name) > 120 then
    raise exception 'the business name from sign-up is too long' using errcode = '22023';
  end if;

  -- a readable web address from the name, plus a random tail so two businesses with the same name never collide
  v_base := trim(both '-' from regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'));
  v_base := trim(both '-' from left(v_base, 28));
  if char_length(v_base) < 2 then
    v_base := 'business';
  end if;
  loop
    v_attempts := v_attempts + 1;
    v_slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text || v_uid::text), 1, 8);
    begin
      insert into public.tenants (name, slug) values (v_name, v_slug) returning * into v_tenant;
      exit;
    exception when unique_violation then
      if v_attempts >= 5 then
        raise;
      end if;
    end;
  end loop;

  -- the workspace limit (SM307) is checked by the trigger on this insert; a refusal rolls the whole call back
  insert into public.memberships (tenant_id, user_id, role) values (v_tenant.id, v_uid, 'owner');
  insert into public.account_setups (user_id, created_tenant_id, business_type, language)
  values (v_uid, v_tenant.id, v_pack.code, p_language);

  -- the tenants insert gave the business the default pack; it now takes the one the person chose, and that pack's custom fields
  update packs.workspace_pack w
     set pack_code = v_pack.code, pack_version = v_pack.version, source = 'signup', chosen_by = v_uid, chosen_at = now()
   where w.tenant_id = v_tenant.id;
  perform app.apply_pack_fields(v_tenant.id, v_pack.code, v_pack.version, v_uid);
  perform app.write_audit_event(v_tenant.id, 'workspace_pack.choose', 'workspace_pack', v_tenant.id, null,
                                jsonb_build_object('pack', v_pack.code, 'version', v_pack.version, 'source', 'signup'));

  return jsonb_build_object('tenant_id', v_tenant.id, 'created', true);
end;
$$;
