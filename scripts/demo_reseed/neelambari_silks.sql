-- Demo reseed for the workspace named exactly 'Neelambari Silks (demo)' (a textiles / saree shop). Synthetic people, +00 phone numbers, nothing is ever sent.
-- Run as the database operator (postgres), one transaction, safe to run again:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/demo_reseed/neelambari_silks.sql
-- What it does and what it never touches: scripts/demo_reseed/README.md.
-- The file is ONE transaction: begin ... commit. Any failed check raises and nothing is kept.
\set ON_ERROR_STOP on
begin;

-- =====================================================================================================================
-- 0. helpers (they live in this session only: pg_temp) and the tenant lookup
-- =====================================================================================================================
create function pg_temp.sid(k text) returns uuid language sql immutable as
$f$ select md5('stack19.demo-reseed.neelambari:' || k)::uuid $f$;

-- the same, but an RFC-valid UUID (version 4, variant 8): the web's live-call strip accepts only those, so the ids of the live call (a row of its own, one a day, never history) use it
create function pg_temp.sidv(k text) returns uuid language sql immutable as
$f$ select (substr(h, 1, 12) || '4' || substr(h, 14, 3) || '8' || substr(h, 18))::uuid from (select md5('stack19.demo-reseed.neelambari:' || k) as h) x $f$;

-- text a person can see that marks a leftover of earlier trials (the owner's list, plus the ones found in the staging data)
create function pg_temp.junk(t text) returns boolean language sql immutable as
$f$ select coalesce(t, '') ~* '(smoke|click-through|df click|synthetic|\mtest|lorem|example:|test buyer|\mdf\M|\mdemo\M)' $f$;

-- the canonical JSON of the quote engine: sorted keys, compact, ASCII (python json.dumps(sort_keys=True, separators=(",", ":")))
create function pg_temp.canon(j jsonb) returns text language plpgsql immutable as
$f$
declare r text;
begin
  case jsonb_typeof(j)
    when 'object' then
      select '{' || coalesce(string_agg(to_json(e.k)::text || ':' || pg_temp.canon(e.v), ',' order by e.k collate "C"), '') || '}' into r from jsonb_each(j) as e(k, v);
    when 'array' then
      select '[' || coalesce(string_agg(pg_temp.canon(e.v), ',' order by e.o), '') || ']' into r from jsonb_array_elements(j) with ordinality as e(v, o);
    when 'string' then r := to_json(j #>> '{}')::text;
    when 'null' then r := 'null';
    else r := j::text;
  end case;
  return r;
end;
$f$;

create function pg_temp.order_step(p_order uuid, p_type text, p_when timestamptz, p_reason text) returns void language plpgsql as
$f$
declare
  v_as text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
  v_ver constant text := '1.0.0';
  v_req jsonb; v_dec jsonb; v_txt text; v_hash text; v_res jsonb; v_flags jsonb;
begin
  -- the same request the database builds from its own ledger, decided by the database's own lifecycle, recorded by the real function (so every rule of the ledger holds)
  v_req := app.order_build(p_order, p_type, null, null, v_as, true);
  v_dec := app.order_decide(v_req);
  if v_dec ->> 'status' <> 'ok' then
    raise exception 'order step % refused: %', p_type, v_dec ->> 'code';
  end if;
  v_txt := pg_temp.canon(v_req);
  v_hash := app.order_request_hash(v_ver, v_txt);
  v_flags := coalesce((select jsonb_agg(jsonb_build_object('code', x)) from jsonb_array_elements_text(v_dec -> 'flags') x), '[]'::jsonb);
  v_res := jsonb_build_object('status', 'ok', 'engine_version', v_ver, 'canonical_hash', v_hash, 'new_state', v_dec ->> 'new_state', 'paid_total', v_dec -> 'paid_total',
                              'balance_due', v_dec -> 'balance_due', 'flags', jsonb_build_object('needs_owner_approval', jsonb_array_length(v_flags) > 0, 'reasons', v_flags));
  perform public.record_order_event(pg_temp.sid('oev-' || p_order::text || '-' || p_type), p_order, p_type, p_when, null, null, p_reason, v_ver, v_txt, pg_temp.canon(v_res));
end;
$f$;

create temp table demo_ctx (tenant_id uuid not null, owner_id uuid not null, today date not null, kd text not null) on commit drop;
create function pg_temp.tid() returns uuid language sql stable as $f$ select tenant_id from demo_ctx $f$;
create function pg_temp.uid() returns uuid language sql stable as $f$ select owner_id from demo_ctx $f$;
create function pg_temp.kd() returns text language sql stable as $f$ select kd from demo_ctx $f$;
-- a moment on a day (India time) some days ago; never in the future
create function pg_temp.ago(p_days int, p_hh int, p_mm int) returns timestamptz language sql stable as
$f$ select least(((select today from demo_ctx) - p_days)::timestamp + make_interval(hours => p_hh, mins => p_mm), (now() at time zone 'Asia/Kolkata') - interval '1 minute') at time zone 'Asia/Kolkata' $f$;

do $a$
declare
  n int; t uuid; u uuid; v_today date; m text;
begin
  select count(*) into n from public.tenants x where x.name = 'Neelambari Silks (demo)';
  if n <> 1 then
    raise exception 'demo reseed: expected exactly one workspace named "Neelambari Silks (demo)", found %', n;
  end if;
  select x.id into t from public.tenants x where x.name = 'Neelambari Silks (demo)';
  if exists (select 1 from public.tenants x where x.id = t and x.archived_at is not null) then
    raise exception 'demo reseed: the workspace is archived';
  end if;
  select mm.user_id into u from public.memberships mm where mm.tenant_id = t and mm.role in ('owner', 'admin') order by (mm.role = 'owner') desc, mm.created_at, mm.user_id limit 1;
  if u is null then
    raise exception 'demo reseed: the workspace has no owner or admin';
  end if;
  foreach m in array array['catalogue', 'quotes', 'orders', 'visits', 'call_list', 'reports', 'inbox', 'enquiries', 'contacts', 'companies'] loop
    if not app.module_enabled(t, m) then
      raise exception 'demo reseed: the module % is off in this workspace', m;
    end if;
  end loop;
  v_today := (now() at time zone 'Asia/Kolkata')::date;
  insert into demo_ctx values (t, u, v_today, to_char(v_today, 'YYMMDD'));
  -- act as the workspace owner for the rows' author columns and the audit trail (claims are transaction-local)
  perform set_config('request.jwt.claim.sub', u::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated', 'aud', 'authenticated', 'aal', 'aal2')::text, true);
  raise notice 'demo reseed: workspace %, acting as owner %, day key %', t, u, to_char(v_today, 'YYMMDD');
end
$a$;

-- the rows of today's slots: the open needs-you items this script owns today are kept, everything else open is closed below
create temp table demo_keep (id uuid primary key) on commit drop;
insert into demo_keep
select pg_temp.sid(p || '-' || pg_temp.kd() || '-' || n) from unnest(array['quote', 'reply', 'callreq', 'prospect']) p, generate_series(1, 9) n;

-- =====================================================================================================================
-- 1. the catalogue: the owner's 18 products in 4 categories (the old trial items are switched off, never deleted)
-- =====================================================================================================================
create temp table demo_items (key text primary key, code text, name text, category text, fabric text, zari text, border text, band text, qty int) on commit drop;
insert into demo_items values
  ('ss_tissue',        'SS-TISSUE',   'Semi silk tissue',               'semi_silk',   'cotton_silk',  'light', null,           'under_5k', 100),
  ('ss_meenakari',     'SS-MEENAKARI','Semi silk meenakari',            'semi_silk',   'cotton_silk',  'none',  null,           'under_5k', 100),
  ('ss_checks',        'SS-CHECKS',   'Semi silk vintage checks',       'semi_silk',   'cotton_silk',  'none',  null,           'under_5k', 100),
  ('ss_kadiyal',       'SS-KADIYAL',  'Semi silk kadiyal kuttu',        'semi_silk',   'cotton_silk',  'none',  null,           'under_5k', 100),
  ('ss_buttas',        'SS-BUTTAS',   'Semi silk plain buttas',         'semi_silk',   'cotton_silk',  'none',  null,           'under_5k', 100),
  ('ss_selfgold',      'SS-SELFGOLD', 'Semi silk self gold',            'semi_silk',   'cotton_silk',  'light', null,           'under_5k', null),
  ('lw_kanchi',        'LW-KANCHI',   'Lightweight Kanchi border',      'lightweight', 'soft_silk',    'none',  'Kanchi border','under_5k', 50),
  ('lw_vpure',         'LW-VPURE',    'Lightweight vintage pure',       'lightweight', 'soft_silk',    'none',  null,           'under_5k', 50),
  ('lw_vhandloom',     'LW-VHANDLOOM','Lightweight vintage handloom',   'lightweight', 'soft_silk',    'none',  null,           'under_5k', null),
  ('ps_selfdesign',    'PS-SELFDESIGN','Pure silk self design',         'pure_silk',   'kanchi_pattu', 'light', null,           '5k_10k',   50),
  ('ps_reshamwarp',    'PS-RESHAMWARP','Pure silk resham warp self',    'pure_silk',   'kanchi_pattu', 'none',  null,           '5k_10k',   50),
  ('ps_tissuecontrast','PS-TISSUECON','Pure silk pure tissue contrast', 'pure_silk',   'kanchi_pattu', 'light', null,           '5k_10k',   50),
  ('ps_meenakari',     'PS-MEENAKARI','Pure silk meenakari',            'pure_silk',   'kanchi_pattu', 'none',  null,           '5k_10k',   50),
  ('ps_reshamkuttu',   'PS-RESHAMKUT','Pure silk resham kuttu',         'pure_silk',   'kanchi_pattu', 'none',  null,           '5k_10k',   null),
  ('ps_zari',          'PS-ZARI',     'Pure silk 1g/2g zari',           'pure_silk',   'kanchi_pattu', 'light', null,           '5k_10k',   null),
  ('ps_3cord',         'PS-3CORD',    'Pure silk 3-cord',               'pure_silk',   'kanchi_pattu', 'none',  null,           '5k_10k',   null),
  ('ps_4cord',         'PS-4CORD',    'Pure silk 4-cord',               'pure_silk',   'kanchi_pattu', 'none',  null,           '5k_10k',   null),
  ('hl_pure',          'HL-PURE',     'Pure handloom',                  'handloom',    'pure_cotton',  'none',  null,           'under_5k', null);

do $b$
declare
  t uuid := pg_temp.tid(); u uuid := pg_temp.uid(); r record; f uuid; v_n int;
begin
  -- the category of an item: one choice field of the catalogue (the catalogue table has no category column)
  insert into public.custom_field_defs (id, tenant_id, entity, code, label, kind, choices, source, created_by, position)
  values (pg_temp.sid('cf-category'), t, 'catalogue_item', 'category', '{"en": "Category"}'::jsonb, 'choice',
          '[{"code":"semi_silk","label":{"en":"Semi silk"}},{"code":"lightweight","label":{"en":"Lightweight"}},{"code":"pure_silk","label":{"en":"Pure silk"}},{"code":"handloom","label":{"en":"Handloom"}}]'::jsonb,
          'owner', u, 0)
  on conflict (tenant_id, entity, code) do nothing;
  select d.id into f from public.custom_field_defs d where d.tenant_id = t and d.entity = 'catalogue_item' and d.code = 'category';

  -- stock: a number the owner counted, or NULL = not counted (the app asks). A price is only a BAND here and it is a placeholder: the owner has not sent prices (no exact price is stored).
  for r in select * from demo_items order by key loop
    insert into public.catalogue_items (id, tenant_id, name, fabric, colours, zari, border, occasions, price_band, stock_status, active, created_by, item_kind, quantity)
    values (pg_temp.sid('item-' || r.key), t, r.name, r.fabric, array['multi'], r.zari, r.border, array[]::text[], r.band, 'in_stock', false, u, 'saree', r.qty)
    on conflict (id) do nothing;
    -- the catalogue has no note or price-status field; the only free text besides the name is "border" (shown on the item's page as Border): the marker goes there
    update public.catalogue_items c set border = coalesce(r.border || '. ', '') || 'Draft price, to be confirmed', updated_by = u
     where c.id = pg_temp.sid('item-' || r.key) and c.border is distinct from coalesce(r.border || '. ', '') || 'Draft price, to be confirmed';
    insert into public.custom_field_values (tenant_id, field_id, entity, catalogue_item_id, value_choices, updated_by)
    values (t, f, 'catalogue_item', pg_temp.sid('item-' || r.key), array[r.category], u)
    on conflict (tenant_id, field_id, catalogue_item_id) do nothing;
    -- the item types a quote line names (manual prices): the same names
    insert into public.item_types (id, tenant_id, code, name, active, created_by)
    values (pg_temp.sid('itype-' || r.key), t, r.code, r.name, true, u)
    on conflict (tenant_id, code) do nothing;
  end loop;

  -- the old trial catalogue and item types: switched off (items cannot be deleted; photos and quotes may point at them)
  update public.catalogue_items c set active = false, updated_by = u
   where c.tenant_id = t and c.active and c.id not in (select pg_temp.sid('item-' || key) from demo_items);
  get diagnostics v_n = row_count;
  raise notice 'catalogue: % old items switched off', v_n;
  begin
    update public.item_types i set active = false
     where i.tenant_id = t and i.active and i.id not in (select pg_temp.sid('itype-' || key) from demo_items) and i.code not in (select code from demo_items);
  exception when others then
    raise warning 'item types: the old ones could not be switched off (%)', sqlerrm;
  end;
end
$b$;

-- =====================================================================================================================
-- 2. cleanup: leftovers of earlier trials in THIS workspace only. Nothing is deleted: the database forbids it for calls,
--    messages, quotes, visits and the rest, so rows are renamed, archived, rejected, cancelled or marked handled.
-- =====================================================================================================================
create temp table junk_lead_all on commit drop as
select l.id as lead_id, l.contact_id, l.company_id, (l.archived_at is null) as live
  from public.leads l
  left join public.contacts c on c.tenant_id = l.tenant_id and c.id = l.contact_id
  left join public.companies co on co.tenant_id = l.tenant_id and co.id = l.company_id
 where l.tenant_id = pg_temp.tid()
   and (pg_temp.junk(concat_ws(' ', c.full_name, c.job_title, c.email, co.name, l.disqualified_reason, l.source))
        or exists (select 1 from public.enquiries e where e.tenant_id = l.tenant_id and e.lead_id = l.id and pg_temp.junk(concat_ws(' ', e.subject, e.body)))
        or exists (select 1 from public.lead_profiles p where p.tenant_id = l.tenant_id and p.lead_id = l.id and pg_temp.junk(concat_ws(' ', p.need, p.quantity, p.area, p.city, p.budget, p.timeline, p.campaign))));

do $c$
declare
  t uuid := pg_temp.tid(); u uuid := pg_temp.uid(); r record; v_n int; v_names text[] := array['Anitha Kumari', 'Mahesh Babu', 'Swathi Reddy', 'Rajesh Varma', 'Divya Teja', 'Prakash Rao', 'Latha Mohan', 'Kiran Kumar', 'Harini S.', 'Gopal Krishna', 'Sireesha K.', 'Murali Mohan'];
  v_firms text[] := array['Sri Venkateswara Silks', 'Lakshmi Narasimha Textiles', 'Padma Sarees', 'Tirumala Fabrics', 'Sai Krishna Sarees', 'Rajarajeswari Silks'];
  v_ord uuid;
begin
  -- 2.1 names and e-mail addresses that carry a leftover word: a plain real-sounding name instead (calls and messages keep pointing at the row)
  with j as (select c.id, row_number() over (order by c.id) rn from public.contacts c where c.tenant_id = t and c.erased_at is null and pg_temp.junk(concat_ws(' ', c.full_name, c.job_title)))
  update public.contacts c set full_name = v_names[1 + (j.rn - 1)::int % array_length(v_names, 1)], job_title = case when pg_temp.junk(c.job_title) then null else c.job_title end
    from j where c.id = j.id;
  update public.contacts c set email = null where c.tenant_id = t and c.erased_at is null and pg_temp.junk(c.email);
  with j as (select c.id, row_number() over (order by c.id) rn from public.companies c where c.tenant_id = t and c.erased_at is null and pg_temp.junk(concat_ws(' ', c.name, c.website, c.industry)))
  update public.companies c set name = v_firms[1 + (j.rn - 1)::int % array_length(v_firms, 1)], website = case when pg_temp.junk(c.website) then null else c.website end, industry = case when pg_temp.junk(c.industry) then null else c.industry end
    from j where c.id = j.id;

  -- 2.2 the leads that are leftovers leave every list: the lead, its enquiries, and its contact and company when nothing else is live on them
  update public.enquiries e set archived_at = now() where e.tenant_id = t and e.archived_at is null and e.lead_id in (select lead_id from junk_lead_all where live);
  update public.leads l set archived_at = now() where l.tenant_id = t and l.archived_at is null and l.id in (select lead_id from junk_lead_all where live);
  update public.contacts c set archived_at = now() where c.tenant_id = t and c.archived_at is null and c.erased_at is null and c.id in (select contact_id from junk_lead_all)
     and not exists (select 1 from public.leads l where l.tenant_id = t and l.contact_id = c.id and l.archived_at is null);
  update public.companies c set archived_at = now() where c.tenant_id = t and c.archived_at is null and c.erased_at is null and c.id in (select company_id from junk_lead_all)
     and not exists (select 1 from public.leads l where l.tenant_id = t and l.company_id = c.id and l.archived_at is null);

  -- 2.3 quotes: a draft is rejected; an approved one that is a leftover or above Rs 1,00,000 is withdrawn (its open order is cancelled first)
  for r in
    select q.id, q.status, q.total_paise, q.lead_id from public.quotes q
     where q.tenant_id = t and q.status in ('draft', 'approved') and q.id not in (select id from demo_keep)
       and (q.status = 'draft' or q.total_paise > 10000000 or q.lead_id in (select lead_id from junk_lead_all)
            or exists (select 1 from public.quote_lines ql where ql.tenant_id = t and ql.quote_id = q.id and pg_temp.junk(ql.name)))
  loop
    if r.status = 'draft' then
      update public.quotes set status = 'rejected', rejected_by = u, rejected_at = now(), reject_code = 'other' where id = r.id;
    else
      -- a quote that has an order that is still open: the order is cancelled first (an order without money in it)
      for v_ord in select o.id from public.orders o where o.tenant_id = t and o.quote_id = r.id and o.closed_at is null loop
        begin
          perform pg_temp.order_step(v_ord, 'cancel', now(), null);
        exception when others then
          raise warning 'order % could not be cancelled (%): its quote stays approved', v_ord, sqlerrm;
          continue;
        end;
      end loop;
      if exists (select 1 from public.orders o where o.tenant_id = t and o.quote_id = r.id and o.closed_at is null) then continue; end if;
      update public.quotes set status = 'superseded', withdrawn_by = u, withdrawn_at = now(), withdraw_code = 'entered_in_error' where id = r.id;
    end if;
  end loop;

  -- 2.4 messages waiting for approval (any) and queued ones that are leftovers: closed as "owner rejected"; nothing can leave
  update public.outbox_messages m set status = 'blocked', reason = 'owner_rejected', decided_by = u, decided_at = now()
   where m.tenant_id = t and m.id not in (select id from demo_keep)
     and (m.status = 'needs_approval' or (m.status = 'queued' and (pg_temp.junk(m.body) or m.lead_id in (select lead_id from junk_lead_all))));
  select count(*) into v_n from public.outbox_messages m where m.tenant_id = t and m.status = 'queued';
  if v_n > 0 then raise warning 'outbox: % other message(s) are queued (not a leftover, left alone)', v_n; end if;

  -- 2.5 callback requests waiting, prospects waiting for the owner, drafts, campaigns, tasks and batches waiting: closed
  update public.call_requests c set status = 'rejected', decided_by = u, decided_at = now(), decision_note = 'Closed by the owner.' where c.tenant_id = t and c.status = 'requested' and c.id not in (select id from demo_keep);
  update public.prospects p set status = 'skipped', decision_reason = 'owner_skipped' where p.tenant_id = t and p.status = 'needs_owner' and p.id not in (select id from demo_keep);
  update public.followup_drafts d set status = 'discarded', discarded_by = u, discarded_at = now(), discard_code = 'person' where d.tenant_id = t and d.status = 'draft';
  update public.campaigns c set status = 'cancelled' where c.tenant_id = t and c.status = 'draft';
  update public.tasks k set status = 'cancelled', finished_at = now() where k.tenant_id = t and k.id <> pg_temp.sid('task-follow-up') and (k.status in ('planned', 'needs_answer', 'paused') or (k.status in ('approved', 'running') and pg_temp.junk(k.instruction)));
  update public.outreach_batches b set status = 'cancelled', approved_by = coalesce(b.approved_by, u), approved_at = coalesce(b.approved_at, now()), finished_at = now(), paused_reason = null, paused_at = null
   where b.tenant_id = t and b.id <> pg_temp.sid('batch-follow-up') and (b.status in ('planned', 'paused') or (b.status in ('approved', 'running') and pg_temp.junk(b.name)));

  -- 2.6 calls: a hand-over or visit request that nobody handled is marked handled; a call whose words are a leftover gets a plain corrected summary (the call itself cannot change)
  update public.phone_calls c set handled_at = now(), handled_by = u
   where c.tenant_id = t and c.handled_at is null and c.created_at >= now() - interval '7 days' and (c.end_reason = 'handover' or c.captured ? 'visit_at');
  update public.phone_calls c set summary_corrected = 'A short call with no result.', corrected_by = u, corrected_at = now()
   where c.tenant_id = t and c.summary_corrected is null and pg_temp.junk(c.summary);
  select count(*) into v_n from public.phone_calls c where c.tenant_id = t and pg_temp.junk(c.summary);
  if v_n > 0 then
    raise warning 'calls: % older call(s) still show a leftover word in the Calls list (the list reads phone_calls.summary, which the database never rewrites; their corrected summary shows in the call detail only)', v_n;
  end if;

  -- 2.7 visits: leftovers and visits the assistant proposed that nobody confirmed are cancelled; visits of earlier days of this script that are still open are cancelled too
  update public.store_visits v set status = 'cancelled', closed_at = now(), cancel_reason = 'Cancelled by the owner', updated_by = u
   where v.tenant_id = t and v.status in ('booked', 'confirmed')
     and (pg_temp.junk(concat_ws(' ', v.purpose, v.note)) or v.lead_id in (select lead_id from junk_lead_all)
          or (v.source = 'assistant' and v.starts_at >= now())
          or v.id in (select pg_temp.sid('visit-today-' || to_char(d, 'YYMMDD') || '-' || k) from generate_series((select today from demo_ctx) - 90, (select today from demo_ctx) - 1, interval '1 day') d,
                       unnest(array['venkata', 'hegde', 'meenakshi', 'ramesh']) k));

  -- 2.8 the live call of an earlier day that the scheduler has not closed yet: closed here as failed (the same step the scheduler makes)
  update public.phone_calls c set state = 'failed', ended_at = now(), end_reason = 'error', outcome = 'failed', duration_s = greatest(0, extract(epoch from now() - coalesce(c.answered_at, c.created_at))::int)
   where c.tenant_id = t and c.state in ('ringing', 'in_progress') and c.created_at < now() - interval '15 minutes';
end
$c$;

-- =====================================================================================================================
-- 3. the people: 15 customers with a lead each, three sources (Instagram, IndiaMART, Walk-in), six stages
--    Phone numbers are +00 numbers: they cannot be dialled or messaged by anyone.
-- =====================================================================================================================
create temp table demo_cast (key text primary key, person text not null, company text, city text not null, source text not null, lstatus text not null, days int not null, ph int not null, lang text not null,
                             need text, quantity text, budget text, disq text, chat boolean not null) on commit drop;
insert into demo_cast values
  ('padmaja',   'Padmaja Naidu',     null,                 'Guntur',      'Instagram', 'in_review',    3, 101, 'te', 'Pure silk sarees for a wedding',        '3 sarees',  'around 25,000 rupees', null, true),
  ('lakshmi',   'Lakshmi Prasad',    'Sri Lakshmi Sarees', 'Vijayawada',  'indiamart', 'qualified',   14, 102, 'te', 'Semi silk sarees for the festival season', '12 sarees', 'around 48,000 rupees', null, true),
  ('sunitha',   'Sunitha Chowdary',  null,                 'Nellore',     'Instagram', 'qualified',    8, 103, 'te', 'Lightweight sarees for a family function', '4 sarees', 'around 15,000 rupees', null, false),
  ('sarala',    'Sarala Devi',       null,                 'Tirupati',    'Walk-in',   'qualified',   25, 104, 'te', 'Pure silk sarees for a wedding',        '4 sarees',  null, null, true),
  ('bhargavi',  'Bhargavi Reddy',    null,                 'Hyderabad',   'indiamart', 'qualified',   20, 105, 'te', 'Semi silk sarees for the festival',      '8 sarees',  null, null, false),
  ('rajeshwari','Rajeshwari Murthy', null,                 'Mysuru',      'Instagram', 'disqualified',19, 106, 'kn', 'Pure silk sarees for a wedding',        '5 sarees',  null, 'Found a lower price elsewhere', false),
  ('nagaraju',  'Nagaraju B.',       null,                 'Kurnool',     'Walk-in',   'disqualified',28, 107, 'te', 'Handloom sarees',                        null,        null, 'Not looking for sarees any more', false),
  ('shobha',    'Shobha Rao',        null,                 'Bengaluru',   'Walk-in',   'new',          1, 108, 'kn', 'Semi silk sarees for daily wear',        null,        null, null, false),
  ('kavitha',   'Kavitha Gowda',     null,                 'Mandya',      'Instagram', 'new',          2, 109, 'kn', 'Semi silk tissue sarees',                null,        null, null, true),
  ('savitha',   'Savitha Reddy',     null,                 'Warangal',    'indiamart', 'new',          0, 110, 'te', 'Semi silk plain buttas for a boutique',  '20 sarees', null, null, false),
  ('ramesh',    'Ramesh K.',         null,                 'Anantapur',   'indiamart', 'in_review',    6, 111, 'te', 'Lightweight Kanchi border sarees',       null,        null, null, true),
  ('venkata',   'Venkata Subbaiah',  null,                 'Ongole',      'Walk-in',   'in_review',    9, 112, 'te', 'Pure silk resham kuttu sarees',          null,        null, null, false),
  ('annapurna', 'Annapurna Devi',    'Annapurna Textiles', 'Rajahmundry', 'indiamart', 'in_review',   11, 113, 'te', 'Bulk rates for pure handloom',          null,        null, null, true),
  ('hegde',     'Suresh Hegde',      'Hegde Silks',        'Hubballi',    'Walk-in',   'qualified',   10, 114, 'kn', 'Lightweight vintage pure sarees to stock', '15 sarees', null, null, false),
  ('meenakshi', 'Meenakshi Iyer',    null,                 'Chennai',     'Instagram', 'qualified',    5, 115, 'en', 'Pure silk meenakari saree',              '1 saree',   null, null, false);

-- the messages: 'in' becomes an enquiry (WhatsApp for a chat, a form or a walk-in note otherwise), 'out' an answered outbox message (status sent, in the past)
create temp table demo_msgs (key text, n int, dir text, channel text, days int, hh int, mm int, body text, primary key (key, n)) on commit drop;
insert into demo_msgs values
  ('padmaja',  1, 'in',  'whatsapp', 3, 10,  5, 'Namaste, I am looking for three pure silk sarees for my daughter''s wedding in December. Can you share designs?'),
  ('padmaja',  2, 'out', 'whatsapp', 3, 10,  6, 'Namaste Padmaja garu, thank you for writing to us. We have Pure silk self design and Pure silk meenakari in stock. I will ask the owner to share photos.'),
  ('padmaja',  3, 'in',  'whatsapp', 2, 18, 40, 'Please send me a quote for three sarees, two self design and one meenakari.'),
  ('kavitha',  1, 'in',  'whatsapp', 2, 18, 20, 'Hi, do you have Semi silk tissue in stock? What is the price?'),
  ('kavitha',  2, 'out', 'whatsapp', 2, 18, 21, 'Hello Kavitha garu, yes, Semi silk tissue is in stock. I will check the price and let you know.'),
  ('kavitha',  3, 'in',  'whatsapp', 1, 20, 15, 'Please tell me soon, I need it for a function on Sunday.'),
  ('ramesh',   1, 'in',  'whatsapp', 5, 11,  0, 'Do you have Lightweight Kanchi border sarees? How many are in stock?'),
  ('ramesh',   2, 'out', 'whatsapp', 5, 11,  1, 'Yes, Lightweight Kanchi border is in stock, 50 pieces. You are welcome to visit the shop or see photos here.'),
  ('ramesh',   3, 'in',  'whatsapp', 5, 11, 30, 'I will visit on Tuesday evening.'),
  ('ramesh',   4, 'out', 'whatsapp', 5, 11, 31, 'Wonderful, we are open until 8 pm. See you on Tuesday.'),
  ('lakshmi',  1, 'in',  'whatsapp',14,  9, 30, 'We run a saree shop in Vijayawada. We need 12 sarees, Semi silk tissue and Semi silk meenakari, for the festival season. Please send your rates.'),
  ('lakshmi',  2, 'out', 'whatsapp',14,  9, 31, 'Namaste Lakshmi garu, thank you. I have passed your list to the owner and a quote will reach you shortly.'),
  ('lakshmi',  3, 'in',  'whatsapp',12, 16, 10, 'Thank you for the quote. We accept the rates, please send it to our shop.'),
  ('lakshmi',  4, 'out', 'whatsapp',12, 16, 12, 'Thank you. The owner will confirm the order with you.'),
  ('sarala',   1, 'in',  'whatsapp',25, 12,  0, 'I want sarees for my sister''s wedding. Pure silk self design, three pieces.'),
  ('sarala',   2, 'out', 'whatsapp',25, 12,  1, 'Namaste Sarala garu, welcome. You are welcome to visit the shop to choose.'),
  ('sarala',   3, 'in',  'whatsapp',21, 19,  0, 'Thank you for the sarees, everyone liked them.'),
  ('sarala',   4, 'out', 'whatsapp',21, 19,  2, 'Thank you, Sarala garu. Please visit us again.'),
  ('annapurna',1, 'in',  'whatsapp',10, 13,  0, 'Please ask the owner to call me about bulk rates for Pure handloom.'),
  ('annapurna',2, 'out', 'whatsapp',10, 13,  2, 'Noted, Annapurna garu. The owner will call you.'),
  ('sunitha',  1, 'in',  'form',     8, 10, 15, 'Need four Lightweight Kanchi border sarees for a family function.'),
  ('bhargavi', 1, 'in',  'form',    20, 14, 20, 'Want sarees for the festival, Semi silk kadiyal kuttu and Semi silk plain buttas.'),
  ('rajeshwari',1,'in',  'form',    19, 15, 45, 'Looking for five Pure silk pure tissue contrast sarees for a wedding.'),
  ('nagaraju', 1, 'in',  'other',   28, 12, 10, 'Walked in and asked about Pure handloom.'),
  ('shobha',   1, 'in',  'other',    1, 16,  0, 'Walked in and asked about Semi silk sarees for daily wear.'),
  ('savitha',  1, 'in',  'form',     0,  8, 30, 'Looking for Semi silk plain buttas, 20 pieces for my boutique.'),
  ('venkata',  1, 'in',  'other',    9, 17, 30, 'Walked in and asked about Pure silk resham kuttu.'),
  ('hegde',    1, 'in',  'other',   10, 11, 45, 'Hegde Silks wants to stock Lightweight vintage pure sarees.'),
  ('meenakshi',1, 'in',  'form',     5, 13, 10, 'Interested in Pure silk meenakari, would like to see it in the shop.');

do $d$
declare
  t uuid := pg_temp.tid(); u uuid := pg_temp.uid(); r record; v_when timestamptz;
begin
  for r in select * from demo_cast order by ph loop
    v_when := pg_temp.ago(r.days, 9, 30 + r.ph % 20);
    insert into public.companies (id, tenant_id, name, type, city, country, region, industry, created_by, created_at, updated_at)
    values (pg_temp.sid('company-' || r.key), t, coalesce(r.company, r.person), case r.lstatus when 'qualified' then 'customer'::public.company_type else 'prospect'::public.company_type end,
            r.city, 'India', case r.city when 'Bengaluru' then 'Karnataka' when 'Mysuru' then 'Karnataka' when 'Mandya' then 'Karnataka' when 'Hubballi' then 'Karnataka' when 'Chennai' then 'Tamil Nadu' when 'Hyderabad' then 'Telangana' when 'Warangal' then 'Telangana' else 'Andhra Pradesh' end,
            'Sarees', u, v_when, v_when)
    on conflict (id) do nothing;
    insert into public.contacts (id, tenant_id, company_id, full_name, phone, whatsapp_consent, phone_consent, created_by, created_at, updated_at)
    values (pg_temp.sid('contact-' || r.key), t, pg_temp.sid('company-' || r.key), r.person, '+00 90003 ' || lpad(r.ph::text, 5, '0'), 'granted', 'granted', u, v_when, v_when)
    on conflict (id) do nothing;
    insert into public.leads (id, tenant_id, company_id, contact_id, owner_user_id, status, source, disqualified_reason, created_by, created_at, updated_at)
    values (pg_temp.sid('lead-' || r.key), t, pg_temp.sid('company-' || r.key), pg_temp.sid('contact-' || r.key), u, r.lstatus::public.lead_status, r.source, r.disq, u, v_when, v_when)
    on conflict (id) do nothing;
    insert into public.lead_profiles (id, tenant_id, lead_id, need, quantity, city, budget, language, created_at, updated_at)
    values (pg_temp.sid('profile-' || r.key), t, pg_temp.sid('lead-' || r.key), r.need, r.quantity, r.city, r.budget, r.lang, v_when, v_when)
    on conflict (id) do nothing;
  end loop;

  -- the words people wrote (enquiries; WhatsApp ones form the chats)
  for r in select * from demo_msgs where dir = 'in' order by key, n loop
    insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body, created_by, created_at)
    values (pg_temp.sid('enq-' || r.key || '-' || r.n), t, pg_temp.sid('lead-' || r.key), r.channel::public.enquiry_channel, pg_temp.ago(r.days, r.hh, r.mm), r.body, u, pg_temp.ago(r.days, r.hh, r.mm))
    on conflict (id) do nothing;
  end loop;

  -- what a lead cost to get, per source (rupees in paise): Instagram and IndiaMART cost money, a walk-in costs nothing
  insert into public.lead_source_costs (tenant_id, source, cost_per_lead_paise, updated_by) values (t, 'Instagram', 6500, u), (t, 'indiamart', 5500, u), (t, 'Walk-in', 0, u)
  on conflict (tenant_id, source) do nothing;
end
$d$;

-- =====================================================================================================================
-- 4. chats: six WhatsApp conversations (two need the owner, two are with the assistant, two are done) and ONE reply waiting for the owner's OK.
--    Earlier answers are written as sent (in the past). The waiting reply is 'needs_approval': no row here is in a state the sender can pick up when the transaction ends.
-- =====================================================================================================================
do $e$
declare
  t uuid := pg_temp.tid(); u uuid := pg_temp.uid(); kd text := pg_temp.kd(); r record; v_msg uuid; v_sent timestamptz; v_st text; v_found boolean; n int; v_has_switch boolean; v_photos uuid[]; i int;
begin
  for r in select m.*, c.person from demo_msgs m join demo_cast c on c.key = m.key where m.dir = 'out' order by m.key, m.n loop
    v_sent := pg_temp.ago(r.days, r.hh, r.mm);
    v_msg := pg_temp.sid('msg-' || r.key || '-' || r.n);
    -- the database makes every message start queued, held or blocked; this one is queued and answered (sent) inside this one transaction, so the sender never sees it queued
    insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, company_id, channel, body, language, category, source, status, reason, request_sha256, created_by, created_at)
    values (v_msg, t, pg_temp.sid('lead-' || r.key), pg_temp.sid('contact-' || r.key), pg_temp.sid('company-' || r.key), 'whatsapp', r.body, 'en', 'reply_to_inbound', 'assistant', 'queued', 'auto_allowed',
            encode(sha256(convert_to(v_msg::text, 'UTF8')), 'hex'), u, v_sent)
    on conflict (id) do nothing;
    if found then
      update public.outbox_messages set status = 'sent', sent_at = v_sent + interval '4 seconds', adapter = 'fake', adapter_message_id = 'wamid.' || substr(md5(v_msg::text), 1, 16) where id = v_msg and status = 'queued';
    end if;
  end loop;

  -- who has each chat (docs: handled_by is derived: a waiting reply or a switched-off assistant with the customer last = needs you; done_at after the last message = done; else the assistant)
  select exists (select 1 from information_schema.columns where table_schema = 'integrations' and table_name = 'wa_conversation_state' and column_name = 'assistant_enabled') into v_has_switch;
  for r in select key, (select max(pg_temp.ago(m.days, m.hh, m.mm)) from demo_msgs m where m.key = c.key) as last_at, (select max(pg_temp.ago(m.days, m.hh, m.mm)) from demo_msgs m where m.key = c.key and m.dir = 'in') as last_in
             from demo_cast c where c.chat order by c.key loop
    insert into integrations.wa_conversation_state (tenant_id, lead_id, last_read_at)
    values (t, pg_temp.sid('lead-' || r.key), case when r.key in ('padmaja', 'kavitha') then '-infinity'::timestamptz else r.last_in + interval '1 minute' end)
    on conflict (tenant_id, lead_id) do update set last_read_at = excluded.last_read_at;
    if v_has_switch then
      execute 'update integrations.wa_conversation_state set assistant_enabled = $3, done_at = $4 where tenant_id = $1 and lead_id = $2'
        using t, pg_temp.sid('lead-' || r.key), r.key <> 'kavitha', case when r.key in ('sarala', 'annapurna') then r.last_at + interval '2 hours' end;
    end if;
  end loop;
  if not v_has_switch then
    raise warning 'chats: the migration 20261231570000 (handled_by) is not applied here: the chats are written, but their needs you / assistant / done words are not stored yet';
  end if;

  -- the reply waiting for the owner's OK (one open slot per day: an unanswered one is kept, an answered one is replaced by a new one)
  v_found := false;
  for n in 1..9 loop
    v_msg := pg_temp.sid('reply-' || kd || '-' || n);
    select status into v_st from public.outbox_messages where id = v_msg;
    if not found then
      insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, company_id, channel, body, language, category, source, status, reason, flags, request_sha256, created_by, created_at)
      values (v_msg, t, pg_temp.sid('lead-padmaja'), pg_temp.sid('contact-padmaja'), pg_temp.sid('company-padmaja'), 'whatsapp',
              'Namaste Padmaja garu, here is your quote: 2 Pure silk self design and 1 Pure silk meenakari, Rs 24,500 in all including GST. Photos are attached. Shall I confirm it for you?',
              'en', 'reply_to_inbound', 'assistant', 'needs_approval', 'money', array['money'], encode(sha256(convert_to(v_msg::text, 'UTF8')), 'hex'), u, now() - interval '20 minutes');
      -- 2 to 3 photos from the workspace's own catalogue photo rows (files that already exist in its storage; nothing is uploaded)
      select array_agg(p.id order by p.created_at, p.id) into v_photos from (select ph.id, ph.created_at from public.catalogue_photos ph where ph.tenant_id = t and ph.removed_at is null order by ph.created_at, ph.id limit 3) p;
      for i in 1..coalesce(array_length(v_photos, 1), 0) loop
        insert into public.outbox_message_media (tenant_id, message_id, photo_id, position) values (t, v_msg, v_photos[i], i);
      end loop;
      if coalesce(array_length(v_photos, 1), 0) < 2 then
        raise warning 'chats: the workspace has fewer than 2 catalogue photos: the waiting reply carries % photo(s)', coalesce(array_length(v_photos, 1), 0);
      end if;
      v_found := true;
      exit;
    elsif v_st = 'needs_approval' then
      v_found := true;
      exit;
    end if;
  end loop;
  if not v_found then raise exception 'chats: no free slot for the waiting reply today'; end if;
end
$e$;

-- =====================================================================================================================
-- 5. quotes (manual prices, built the way the database builds them) and orders for the approved ones
-- =====================================================================================================================
create function pg_temp.gross(p_sub bigint, p_rate int) returns bigint language sql stable as $f$ select p_sub + app.quote_gst_paise(p_sub, p_rate) $f$;
create function pg_temp.solve(p_target bigint, p_rate int, p_q1 int, p_b1 bigint, p_q2 int, out u1 bigint, out u2 bigint) returns record language plpgsql stable as
$f$
declare d int; c1 bigint; rem bigint; s2 numeric; u2c bigint; x bigint;
begin
  for d in 0..120 loop
    foreach c1 in array case when d = 0 then array[p_b1] else array[p_b1 + d, p_b1 - d] end loop
      rem := p_target - pg_temp.gross(p_q1 * c1, p_rate);
      s2 := rem * 10000.0 / (10000 + p_rate);
      u2c := round(s2 / p_q2);
      for x in u2c - 4 .. u2c + 4 loop
        if x > 0 and pg_temp.gross(p_q2 * x, p_rate) = rem then u1 := c1; u2 := x; return; end if;
      end loop;
    end loop;
  end loop;
  raise exception 'no whole-paise prices give the total %', p_target;
end;
$f$;

create temp table demo_quotes (key text primary key, lead_key text not null, status text not null, target bigint not null, c1 text not null, q1 int not null, b1 bigint not null, c2 text not null, q2 int not null,
                               days int not null, state text not null, order_to text) on commit drop;
insert into demo_quotes values
  ('q1', 'padmaja',    'draft',    2450000, 'PS-SELFDESIGN', 2, 700000, 'PS-MEENAKARI',  1, 0, 'AP', null),
  ('q2', 'lakshmi',    'approved', 4800000, 'SS-TISSUE',     8, 350000, 'SS-MEENAKARI',  4, 13, 'AP', 'quote_sent'),
  ('q3', 'sunitha',    'approved', 1540000, 'LW-KANCHI',     3, 400000, 'LW-VPURE',      1, 7, 'AP', 'quote_approved'),
  ('q4', 'sarala',     'approved', 3180000, 'PS-SELFDESIGN', 3, 800000, 'PS-RESHAMWARP', 1, 24, 'AP', 'accepted'),
  ('q5', 'bhargavi',   'approved', 2750000, 'SS-KADIYAL',    5, 380000, 'SS-BUTTAS',     3, 6, 'TG', 'accepted'),
  ('q6', 'rajeshwari', 'rejected', 5600000, 'PS-TISSUECON',  4, 1100000,'PS-MEENAKARI',  1, 18, 'KA', null);

do $f$
declare
  t uuid := pg_temp.tid(); u uuid := pg_temp.uid(); kd text := pg_temp.kd(); r record; v_pol public.quote_policy_versions; v_polver uuid; v_as_of date; v_rate int; v_sol record; v_lines jsonb; v_build jsonb;
  v_req text; v_hash text; v_res jsonb; v_id uuid; v_enq uuid; v_reqid uuid; v_no int; v_created timestamptz; v_ver constant text := '1.1.0'; v_n1 text; v_n2 text; v_ord uuid; v_opol uuid; n int; v_st text; v_done boolean; l jsonb;
  v_seller text; v_supply public.quote_gst_supply;
begin
  v_polver := app.quote_active_policy_version(t, app.quote_today());
  if v_polver is null then raise exception 'quotes: the workspace has no quote policy in force (run app.operator_seed_quote_reference_data first)'; end if;
  select * into v_pol from public.quote_policy_versions where id = v_polver;
  v_opol := app.order_active_policy_version(t, (now() at time zone 'Asia/Kolkata')::date);
  if v_opol is null then raise warning 'quotes: the workspace has no order policy: the approved quotes get no order (no "sent" or "accepted" step)'; end if;

  for r in select * from demo_quotes order by key loop
    -- the draft is a slot of the day: kept while it waits, replaced by a new one once it was decided or expired
    if r.status = 'draft' then
      v_id := null; v_done := false;
      for n in 1..9 loop
        v_id := pg_temp.sid('quote-' || kd || '-' || n);
        select q.status::text into v_st from public.quotes q where q.id = v_id;
        if not found then exit;
        elsif v_st = 'draft' then v_done := true; exit;
        end if;
      end loop;
      if v_done then continue; end if;
      v_created := now() - interval '25 minutes';
    else
      v_id := pg_temp.sid('quote-' || r.key);
      if exists (select 1 from public.quotes where id = v_id) then continue; end if;
      v_created := pg_temp.ago(r.days, 15, 30);
    end if;
    v_as_of := greatest((v_created at time zone 'Asia/Kolkata')::date, v_pol.effective_from, v_pol.gst_effective_from);
    v_rate := app.quote_gst_bps_on(t, v_polver, v_as_of);
    select * into v_sol from pg_temp.solve(r.target, v_rate, r.q1, r.b1, r.q2);
    select name into v_n1 from public.item_types where tenant_id = t and code = r.c1 and active;
    select name into v_n2 from public.item_types where tenant_id = t and code = r.c2 and active;
    if v_n1 is null or v_n2 is null then raise exception 'quotes: the item types % / % are missing or off', r.c1, r.c2; end if;
    v_lines := jsonb_build_array(jsonb_build_object('item_type_code', r.c1, 'name', v_n1, 'qty', r.q1, 'unit_price_paise', v_sol.u1),
                                 jsonb_build_object('item_type_code', r.c2, 'name', v_n2, 'qty', r.q2, 'unit_price_paise', v_sol.u2));
    v_build := app.quote_build_manual(t, v_as_of, 'new', v_polver, v_lines);
    if jsonb_array_length(v_build -> 'flags') + jsonb_array_length(v_build -> 'review') > 0 then raise exception 'quotes: % needs the owner (flags %)', r.key, v_build -> 'flags'; end if;
    if (v_build ->> 'total')::bigint <> r.target then raise exception 'quotes: % came to % instead of %', r.key, v_build ->> 'total', r.target; end if;
    v_req := pg_temp.canon(v_build -> 'request');
    v_hash := app.quote_request_hash(v_ver, v_req);
    v_res := (v_build -> 'core') || jsonb_build_object('status', 'draft', 'engine_version', v_ver, 'canonical_hash', v_hash, 'flags', jsonb_build_object('needs_owner_approval', false, 'reasons', '[]'::jsonb), 'trace', '[]'::jsonb);
    v_enq := pg_temp.sid('enq-' || r.lead_key || '-1');
    select q.id into v_reqid from public.requirements q where q.tenant_id = t and q.enquiry_id = v_enq and q.status in ('draft', 'confirmed') limit 1;
    if v_reqid is null then
      v_reqid := pg_temp.sid('req-' || r.key);
      insert into public.requirements (id, tenant_id, enquiry_id, status, confirmed_by, confirmed_at, created_at) values (v_reqid, t, v_enq, 'confirmed', u, v_created, v_created);
    end if;
    perform pg_advisory_xact_lock(hashtextextended('quote_no:' || t::text, 0));
    select coalesce(max(q.quote_no), 0) + 1 into v_no from public.quotes q where q.tenant_id = t;
    v_seller := v_build ->> 'seller_state';
    v_supply := case when r.state = v_seller then 'intra_state' else 'inter_state' end;
    insert into public.quotes
      (id, tenant_id, quote_no, pricing_kind, requirement_id, enquiry_id, lead_id, status, price_list_version_id, policy_version_id, engine_version, request_text, result_text, canonical_hash, customer_kind, delivery_state,
       gst_supply, as_of, valid_until, due_date, merchandise_net_paise, item_tax_paise, shipping_net_paise, shipping_tax_paise, total_paise, advance_paise, balance_paise, needs_owner_approval,
       created_by, created_at, approved_by, approved_at, approved_hash, rejected_by, rejected_at, reject_code)
    values
      (v_id, t, v_no, 'manual', v_reqid, v_enq, pg_temp.sid('lead-' || r.lead_key), r.status::public.quote_status, null, v_polver, v_ver, v_req, pg_temp.canon(v_res), v_hash, 'new', r.state,
       v_supply, v_as_of, (v_build ->> 'valid_until')::date, (v_build ->> 'due_date')::date, (v_build ->> 'merchandise_net')::bigint, (v_build ->> 'item_tax')::bigint, 0, 0,
       (v_build ->> 'total')::bigint, (v_build ->> 'advance')::bigint, (v_build ->> 'balance')::bigint, false,
       u, v_created,
       case when r.status = 'approved' then u end, case when r.status = 'approved' then v_created + interval '2 hours' end, case when r.status = 'approved' then v_hash end,
       case when r.status = 'rejected' then u end, case when r.status = 'rejected' then v_created + interval '1 day' end, case when r.status = 'rejected' then 'customer_changed'::public.quote_reject_code end);
    for l in select z from jsonb_array_elements(v_build -> 'rows') z loop
      insert into public.quote_lines (tenant_id, quote_id, line_no, requirement_line_no, product_id, price_source, item_type_code, sku, name, sale_unit, qty, unit_price_applied_paise, price_break_min_qty,
                                      line_subtotal_paise, net_paise, tax_paise, gross_paise, tax_bps, created_at)
      values (t, v_id, (l ->> 'line_no')::smallint, (l ->> 'requirement_line_no')::smallint, null, 'typed_by_person', l ->> 'item_type_code', l ->> 'sku', l ->> 'name', 'piece', (l ->> 'qty')::int,
              (l ->> 'unit_price')::bigint, null, (l ->> 'subtotal')::bigint, (l ->> 'subtotal')::bigint, (l ->> 'tax')::bigint, (l ->> 'subtotal')::bigint + (l ->> 'tax')::bigint, (l ->> 'tax_bps')::int, v_created);
    end loop;

    -- an order for an approved quote: created as the database creates it, then moved by the real lifecycle step
    if r.status = 'approved' and v_opol is not null then
      v_ord := pg_temp.sid('order-' || r.key);
      insert into public.orders (id, tenant_id, order_no, quote_id, enquiry_id, requirement_id, lead_id, state, order_total_paise, advance_paise, valid_until, policy_version_id, created_by, created_at, updated_at)
      select v_ord, t, coalesce(max(o.order_no), 0) + 1, v_id, v_enq, v_reqid, pg_temp.sid('lead-' || r.lead_key), 'quote_approved', (v_build ->> 'total')::bigint, (v_build ->> 'advance')::bigint,
             greatest((v_build ->> 'valid_until')::date, (now() at time zone 'Asia/Kolkata')::date + 15), v_opol, u, v_created + interval '3 hours', v_created + interval '3 hours'
        from public.orders o where o.tenant_id = t;
      insert into public.order_events (id, tenant_id, order_id, seq, type, prior_state, new_state, occurred_at, recorded_by, recorded_at)
      values (pg_temp.sid('oev-' || v_ord::text || '-created'), t, v_ord, 1, 'created', null, 'quote_approved', v_created + interval '3 hours', u, v_created + interval '3 hours');
      if r.order_to in ('quote_sent', 'accepted') then
        perform pg_temp.order_step(v_ord, 'send_quote', v_created + interval '4 hours', null);
      end if;
      if r.order_to = 'accepted' then
        perform pg_temp.order_step(v_ord, 'customer_accept', v_created + interval '1 day', null);
      end if;
    end if;
  end loop;
end
$f$;

-- =====================================================================================================================
-- 6. visits: older ones for the funnel and a day of visits today (booked, confirmed, one done earlier)
-- =====================================================================================================================
create function pg_temp.at_day(p_days int, p_hh int, p_mm int) returns timestamptz language sql stable as
$f$ select (((select today from demo_ctx) - p_days)::timestamp + make_interval(hours => p_hh, mins => p_mm)) at time zone 'Asia/Kolkata' $f$;

create temp table demo_visits (key text primary key, lead_key text not null, today boolean not null, days int not null, hh int not null, mm int not null, final_status text not null, outcome text, order_of text,
                               purpose text not null, note text) on commit drop;
insert into demo_visits values
  ('sarala',     'sarala',     false, 22, 11, 30, 'completed', 'bought',         'q4', 'Choose pure silk sarees for a wedding', 'Bought three pure silk sarees.'),
  ('bhargavi',   'bhargavi',   false,  3, 15,  0, 'completed', 'bought',         'q5', 'See semi silk sarees for the festival', 'Bought eight semi silk sarees.'),
  ('rajeshwari', 'rajeshwari', false, 16, 12,  0, 'completed', 'not_interested', null, 'See pure silk sarees for a wedding', 'Found the price too high.'),
  ('nagaraju',   'nagaraju',   false, 12, 17,  0, 'no_show',   null,             null, 'Look at handloom sarees', null),
  ('lakshmi',    'lakshmi',    false,  8, 11,  0, 'completed', 'will_return',    null, 'Check semi silk samples for the shop', 'Will return with her partner.'),
  ('venkata',    'venkata',    true,   0, 10,  0, 'completed', 'will_return',    null, 'See pure silk resham kuttu', 'Will decide after the weekend.'),
  ('meenakshi',  'meenakshi',  true,   0, 15,  0, 'confirmed', null,             null, 'See Pure silk meenakari', null),
  ('hegde',      'hegde',      true,   0, 17, 30, 'booked',    null,             null, 'See Lightweight vintage pure for the shop', null),
  ('ramesh',     'ramesh',     true,   0, 18, 30, 'booked',    null,             null, 'See Lightweight Kanchi border', null);

do $g$
declare
  t uuid := pg_temp.tid(); u uuid := pg_temp.uid(); kd text := pg_temp.kd(); r record; v_id uuid; v_start timestamptz; v_created timestamptz; v_order uuid;
begin
  for r in select * from demo_visits order by today, key loop
    v_id := pg_temp.sid('visit-' || case when r.today then 'today-' || kd || '-' else '' end || r.key);
    v_start := pg_temp.at_day(r.days, r.hh, r.mm);
    v_created := least(v_start - interval '1 day', now() - interval '1 hour');
    insert into public.store_visits (id, tenant_id, lead_id, contact_id, company_id, visit_date, starts_at, ends_at, party_size, purpose, note, status, source, request_sha256, created_by, created_at, updated_at)
    values (v_id, t, pg_temp.sid('lead-' || r.lead_key), pg_temp.sid('contact-' || r.lead_key), pg_temp.sid('company-' || r.lead_key), (v_start at time zone 'Asia/Kolkata')::date, v_start, v_start + interval '30 minutes',
            1 + (length(r.key) % 2), r.purpose, r.note, 'booked', 'staff', encode(sha256(convert_to(v_id::text, 'UTF8')), 'hex'), u, v_created, v_created)
    on conflict (id) do nothing;
    if found then
      if r.final_status = 'confirmed' then
        update public.store_visits set status = 'confirmed', confirmed_at = v_created + interval '1 hour', updated_by = u where id = v_id;
      elsif r.final_status = 'completed' then
        update public.store_visits set status = 'arrived', arrived_at = v_start + interval '5 minutes', updated_by = u where id = v_id;
        v_order := case when r.order_of is not null then pg_temp.sid('order-' || r.order_of) end;
        if v_order is not null and not exists (select 1 from public.orders where id = v_order) then v_order := null; end if;
        update public.store_visits set status = 'completed', outcome = r.outcome, closed_at = v_start + interval '40 minutes', order_id = v_order, updated_by = u where id = v_id;
      elsif r.final_status = 'no_show' then
        update public.store_visits set status = 'no_show', closed_at = v_start + interval '1 hour', updated_by = u where id = v_id;
      end if;
    end if;
  end loop;
end
$g$;

-- =====================================================================================================================
-- 7. calls: nine in every state the Calls page knows (completed x4, live, transferred, no answer, rejected, spam), inbound and outbound
-- =====================================================================================================================
create temp table demo_calls (key text primary key, lead_key text, dir text not null, state text not null, purpose text not null, lang text not null, days int not null, hh int not null, mm int not null,
                              dur int, end_reason text, outcome text, category text, refuse text, summary text, transcript jsonb, handover boolean not null default false, callback_days int, captured jsonb) on commit drop;
insert into demo_calls values
  ('padmaja', 'padmaja', 'inbound', 'completed', 'inbound', 'te', 2, 11, 20, 214, 'goodbye', 'positive', 'order_likely', null,
   'Padmaja Naidu wants three pure silk sarees for a wedding. Quote of Rs 24,500 for 3 sarees sent on WhatsApp.',
   '[{"who":"assistant","text":"Namaste, this is Neelambari Silks. I am an AI assistant. How can I help you?","t":0.5},
     {"who":"caller","text":"I need three pure silk sarees for my daughter''s wedding.","t":6.0},
     {"who":"assistant","text":"We have Pure silk self design and Pure silk meenakari, 50 pieces of each. Shall I send you a quote?","t":11.2},
     {"who":"caller","text":"Yes, please. What will it cost?","t":17.0},
     {"who":"assistant","text":"Two self design and one meenakari come to Rs 24,500 including GST. I will send the quote on WhatsApp.","t":22.4},
     {"who":"caller","text":"Okay, send it. Thank you.","t":29.0}]'::jsonb, false, null, null),
  ('venkata', 'venkata', 'outbound', 'completed', 'sales_followup', 'te', 1, 16, 5, 96, 'goodbye', 'unclear', 'call_back_later', null,
   'Venkata Subbaiah asked to be called again after the weekend about Pure silk resham kuttu.', null, false, 3, null),
  ('lakshmi', 'lakshmi', 'inbound', 'completed', 'inbound', 'te', 4, 10, 40, 305, 'goodbye', 'positive', 'order_likely', null,
   'Sri Lakshmi Sarees want 12 semi silk sarees for the festival. Quote of Rs 48,000 sent.',
   '[{"who":"assistant","text":"Namaste, this is Neelambari Silks. I am an AI assistant. How can I help you?","t":0.5},
     {"who":"caller","text":"We need twelve sarees for the shop, Semi silk tissue and Semi silk meenakari.","t":5.5},
     {"who":"assistant","text":"Both are in stock, 100 pieces each. Eight tissue and four meenakari would come to Rs 48,000 with GST.","t":12.0},
     {"who":"caller","text":"That is fine. Please send it in writing.","t":19.5},
     {"who":"assistant","text":"I will send the quote on WhatsApp and the owner will confirm the order.","t":24.0}]'::jsonb, false, null, null),
  ('meenakshi', 'meenakshi', 'inbound', 'completed', 'inbound', 'en', 3, 13, 15, 188, 'goodbye', 'positive', 'visit_booked', null,
   'Meenakshi Iyer will visit the shop to see Pure silk meenakari. Visit booked.',
   '[{"who":"assistant","text":"Hello, this is Neelambari Silks. I am an AI assistant. How can I help you?","t":0.5},
     {"who":"caller","text":"I saw Pure silk meenakari on Instagram. What is the price?","t":6.0},
     {"who":"assistant","text":"It is around Rs 8,900 a saree. You can see it in the shop. Would you like to visit today at 3 pm?","t":12.5},
     {"who":"caller","text":"Yes, I will come at 3 pm.","t":19.0},
     {"who":"assistant","text":"Thank you, your visit is booked for 3 pm.","t":23.0}]'::jsonb, false, null, '{"visit_day":"Today","name":"Meenakshi Iyer"}'::jsonb),
  ('annapurna', 'annapurna', 'inbound', 'completed', 'inbound', 'te', 3, 15, 50, 72, 'handover', 'unclear', null, null,
   'Annapurna Textiles asked to talk to the owner about bulk rates. The call was passed to the owner.', null, true, null, null),
  ('savitha', 'savitha', 'outbound', 'no_answer', 'sales_followup', 'te', 0, 9, 10, 0, 'no_answer', 'no_answer', null, null,
   'No answer. Savitha Reddy did not pick up.', null, false, null, null),
  ('nagaraju', 'nagaraju', 'outbound', 'refused', 'sales_followup', 'te', 6, 21, 30, null, null, null, null, 'outside_hours',
   'Not called: after calling hours.', null, false, null, null),
  ('spam', null, 'inbound', 'refused', 'inbound', 'en', 5, 14, 5, null, null, null, null, 'blocked_caller',
   'Blocked caller.', null, false, null, '{"caller_ending":"417"}'::jsonb);

do $i$
declare
  t uuid := pg_temp.tid(); u uuid := pg_temp.uid(); kd text := pg_temp.kd(); r record; v_id uuid; v_created timestamptz; v_answered timestamptz; v_n int; v_st text; v_done boolean := false; v_cost bigint;
begin
  for r in select * from demo_calls order by key loop
    v_id := pg_temp.sid('call-' || r.key);
    v_created := pg_temp.ago(r.days, r.hh, r.mm);
    v_answered := case when r.state = 'completed' then v_created + interval '8 seconds' end;
    v_cost := case when coalesce(r.dur, 0) > 0 then ceil(r.dur / 30.0) * 250 else 0 end;   -- about Rs 5 a minute, billed by 30 seconds (Rs 2.50 each)
    insert into public.phone_calls (id, tenant_id, direction, state, refuse_reason, contact_id, lead_id, purpose, language, provider, sandbox, simulated, recorded, ai_disclosed, created_by, answered_at, ended_at,
                                    duration_s, end_reason, outcome, category, callback_at, captured, summary, transcript, cost_paise, created_at, updated_at, handled_at, handled_by)
    values (v_id, t, r.dir, r.state, r.refuse, case when r.lead_key is not null then pg_temp.sid('contact-' || r.lead_key) end, case when r.lead_key is not null then pg_temp.sid('lead-' || r.lead_key) end,
            r.purpose, r.lang, 'plivo', false, false, false, r.state <> 'refused', u, v_answered,
            case when r.state = 'completed' then v_answered + make_interval(secs => r.dur) when r.state in ('no_answer', 'refused') then v_created + interval '30 seconds' end,
            case when r.state in ('completed', 'no_answer') then r.dur end, r.end_reason, r.outcome, r.category, case when r.callback_days is not null then pg_temp.at_day(-r.callback_days, 11, 0) end,
            r.captured, r.summary, r.transcript, v_cost, v_created, v_created,
            case when r.handover then v_created + interval '2 hours' end, case when r.handover then u end)
    on conflict (id) do nothing;
  end loop;

  -- the live call: one open slot a day. A call still running is moved to now (so the "live now" strip shows); a finished one is left and a new one starts.
  for n in 1..9 loop
    v_id := pg_temp.sidv('call-live-' || kd || '-' || n);
    select state into v_st from public.phone_calls where id = v_id;
    if not found then
      insert into public.phone_calls (id, tenant_id, direction, state, contact_id, lead_id, purpose, language, provider, sandbox, simulated, recorded, ai_disclosed, created_by, answered_at, heartbeat_at, created_at, updated_at)
      values (v_id, t, 'outbound', 'in_progress', pg_temp.sid('contact-hegde'), pg_temp.sid('lead-hegde'), 'visit_reminder', 'kn', 'plivo', false, false, false, true, u,
              now() - interval '40 seconds', now(), now() - interval '50 seconds', now());
      v_done := true; exit;
    elsif v_st = 'in_progress' then
      update public.phone_calls set created_at = now() - interval '50 seconds', answered_at = now() - interval '40 seconds', heartbeat_at = now() where id = v_id;
      v_done := true; exit;
    end if;
  end loop;
  if not v_done then raise exception 'calls: no free slot for the live call today'; end if;
end
$i$;

-- =====================================================================================================================
-- 8. what the Reports page reads: a follow-up plan with the people it called, the calls (minutes, answered) and the visits they booked
-- =====================================================================================================================
create temp table demo_follow (key text primary key, minutes numeric not null, result text not null, interested boolean not null, booked boolean not null) on commit drop;
insert into demo_follow values
  ('padmaja', 3.6, 'connected', true, false), ('lakshmi', 5.2, 'connected', true, false), ('sunitha', 2.8, 'connected', true, false), ('sarala', 4.1, 'connected', true, true),
  ('bhargavi', 3.9, 'connected', true, true), ('rajeshwari', 3.0, 'connected', true, true), ('nagaraju', 1.5, 'connected', false, false), ('savitha', 0, 'no_answer', false, false),
  ('ramesh', 3.3, 'connected', true, true), ('venkata', 2.4, 'connected', false, false), ('annapurna', 2.0, 'connected', false, false), ('hegde', 4.4, 'connected', true, true),
  ('meenakshi', 3.7, 'connected', true, true);

do $h$
declare
  t uuid := pg_temp.tid(); u uuid := pg_temp.uid(); r record; v_batch uuid := pg_temp.sid('batch-follow-up'); v_item uuid; v_att uuid; v_arrival timestamptz; v_c record;
begin
  insert into public.outreach_batches (id, tenant_id, name, goal, channel, language, questions, window_days, status, plan, plan_sha256, created_by, created_at, approved_by, approved_at, finished_at)
  values (v_batch, t, 'Follow up on new enquiries', 'site_visit', 'call', 'te', '[]'::jsonb, 7, 'done', '{}'::jsonb, encode(sha256(convert_to(v_batch::text, 'UTF8')), 'hex'), u, pg_temp.ago(30, 9, 0), u, pg_temp.ago(30, 9, 5), pg_temp.ago(0, 9, 0))
  on conflict (id) do nothing;
  for r in select f.*, c.days, c.ph from demo_follow f join demo_cast c on c.key = f.key order by c.ph loop
    v_item := pg_temp.sid('item-follow-' || r.key);
    v_att := pg_temp.sid('attempt-' || r.key);
    v_arrival := (select l.created_at from public.leads l where l.id = pg_temp.sid('lead-' || r.key));
    insert into public.outreach_items (id, tenant_id, batch_id, contact_id, lead_id, status, reason, attempts, arrival_at, first_touch_at, last_result, created_at)
    values (v_item, t, v_batch, pg_temp.sid('contact-' || r.key), pg_temp.sid('lead-' || r.key), 'done', case when r.interested then 'interested' end, 1, v_arrival, v_arrival + make_interval(mins => 3 + r.ph % 5), r.result, v_arrival)
    on conflict (id) do nothing;
    insert into public.outreach_attempts (id, tenant_id, item_id, n, channel, at, result, minutes)
    values (v_att, t, v_item, 1, 'call', v_arrival + make_interval(mins => 3 + r.ph % 5), r.result, r.minutes)
    on conflict (id) do nothing;
    if r.booked then
      insert into public.outcomes (id, tenant_id, contact_id, lead_id, kind, source_id, outcome, category, recorded_by_kind, ai_outcome, ai_category, occurred_at, recorded_at)
      values (pg_temp.sid('outcome-' || r.key), t, pg_temp.sid('contact-' || r.key), pg_temp.sid('lead-' || r.key), 'call', v_att, 'positive', 'visit_booked', 'ai', 'positive', 'visit_booked',
              v_arrival + make_interval(mins => 8 + r.ph % 5), v_arrival + make_interval(mins => 8 + r.ph % 5))
      on conflict (id) do nothing;
    end if;
  end loop;
end
$h$;

-- =====================================================================================================================
-- 9. needs you: exactly these open items (one slot of each kind a day): a quote to approve (section 5), a callback request, a new prospect, and the waiting reply (section 4)
--    plus one assistant job that is running (Lead Desk: a task with nobody left to call, so no worker or runner has anything to do)
-- =====================================================================================================================
do $j$
declare
  t uuid := pg_temp.tid(); u uuid := pg_temp.uid(); kd text := pg_temp.kd(); n int; v_id uuid; v_st text; v_done boolean := false;
begin
  for n in 1..9 loop
    v_id := pg_temp.sid('callreq-' || kd || '-' || n);
    select status into v_st from public.call_requests where id = v_id;
    if not found then
      insert into public.call_requests (id, tenant_id, lead_id, contact_id, company_id, reason, script_draft, language, status, request_sha256, requested_by, created_at)
      values (v_id, t, pg_temp.sid('lead-venkata'), pg_temp.sid('contact-venkata'), pg_temp.sid('company-venkata'), 'Asked for a call back about Pure silk resham kuttu',
              'Namaste Venkata garu, this is Neelambari Silks. You asked about Pure silk resham kuttu. Would you like to see it in the shop this week?', 'te', 'requested',
              encode(sha256(convert_to(v_id::text, 'UTF8')), 'hex'), u, now() - interval '3 hours');
      v_done := true; exit;
    elsif v_st = 'requested' then v_done := true; exit;
    end if;
  end loop;
  if not v_done then raise exception 'needs you: no free slot for the callback request today'; end if;

  v_done := false;
  for n in 1..9 loop
    v_id := pg_temp.sid('prospect-' || kd || '-' || n);
    select status into v_st from public.prospects where id = v_id;
    if not found then
      insert into public.prospects (id, tenant_id, name, name_key, category, area, phone, phone_key, source, source_label, place_id, status, fit, fit_reason, owner_approved, created_by, created_at)
      values (v_id, t, 'Sri Venkateswara Fabrics', 'sri venkateswara fabrics', 'Saree shop', 'Gandhi Road, Tirupati', '+00 90003 00901', '9000300901', 'fixture', 'Saree shops in Tirupati',
              'ChIJneel' || kd || n, 'needs_owner', 78, 'A saree shop that stocks silk and semi silk. A good buyer for Pure silk and Semi silk.', false, u, now() - interval '5 hours');
      v_done := true; exit;
    elsif v_st = 'needs_owner' then v_done := true; exit;
    end if;
  end loop;
  if not v_done then raise exception 'needs you: no free slot for the new prospect today'; end if;

  -- the running job: approved by the owner, running now, no person left to contact (the runner and the dialer act only on waiting people of a task)
  insert into public.tasks (id, tenant_id, instruction, language, status, template, plan, estimate, created_by, approved_by, approved_at, created_at, updated_at)
  values (pg_temp.sid('task-follow-up'), t, 'Following up 5 saree enquiries', 'en', 'running', 'custom', '{"channel":"whatsapp","goal":"Follow up on five saree enquiries"}'::jsonb, '{}'::jsonb, u, u, now() - interval '12 minutes',
          now() - interval '15 minutes', now() - interval '1 minute')
  on conflict (id) do update set status = 'running', updated_at = now() where public.tasks.status = 'running';
end
$j$;

-- =====================================================================================================================
-- 9b. the demo assistant is LIVE (staging demo, 13 Nov 2026): a clearly synthetic line (+999 is an unassigned country code: nobody can dial it, nothing is sent from it) and the app's own go-live
--     function, as the workspace owner, so the real gates (a business name and a number) are met. A re-run keeps it live.
-- =====================================================================================================================
do $g$
declare t uuid := pg_temp.tid(); f jsonb;
begin
  insert into public.phone_numbers (id, tenant_id, number, label, inbound_on, spoken_business_name, provider)
  values (pg_temp.sid('demo-line'), t, '+999000000001', 'Demo line (synthetic)', false, 'Neelambari Silks', 'exotel')
  on conflict (id) do nothing;
  f := app.assistant_set_live(t, true);
  if not coalesce((f ->> 'live')::boolean, false) then
    raise exception 'the demo assistant did not go live: %', f;
  end if;
end
$g$;

-- =====================================================================================================================
-- 10. self-check inside the transaction: if a rule below is broken, everything is rolled back and nothing is kept
-- =====================================================================================================================
do $k$
declare
  t uuid := pg_temp.tid(); u uuid := pg_temp.uid(); v_today jsonb; v_nav jsonb; v_waiting int; v_kinds text[]; v_other int; v_bad int;
begin
  v_today := public.today_summary(t);
  v_nav := public.nav_counts(t);
  v_waiting := (v_today -> 'cards' ->> 'waiting')::int;
  select coalesce(array_agg(x ->> 'kind' order by x ->> 'kind'), '{}') into v_kinds from jsonb_array_elements(v_today -> 'needs_you') x;
  select count(*) into v_other from jsonb_array_elements(v_today -> 'needs_you') x
   where (x ->> 'kind') not in ('quote_approval', 'outbox_approval', 'call_approval', 'followup_due', 'campaign_approval', 'person_requested', 'visit_requested', 'hot_lead_waiting', 'outreach_paused', 'material_quote_approval');
  raise notice 'needs you (Today): % waiting, kinds %; the menu number (Today + Lead Desk + prospects) = %', v_waiting, v_kinds, coalesce((v_nav ->> 'needs_you')::int, 0) + coalesce((v_nav ->> 'lead_desk_waiting')::int, 0) + coalesce((v_nav ->> 'prospects_needing_owner')::int, 0);
  if v_waiting - v_other <> 3 then
    raise exception 'needs you: % customer items are waiting (kinds %), expected exactly 3: a quote, a callback request and the waiting reply', v_waiting - v_other, v_kinds;
  end if;
  if v_other > 0 then raise warning 'needs you: % item(s) of a plan or billing kind are waiting too (not customer data, left alone): %', v_other, v_kinds; end if;
  -- nothing the sender can pick up: no queued message in the workspace, no waiting message other than the one reply
  select count(*) into v_bad from public.outbox_messages m where m.tenant_id = t and (m.status = 'queued' or m.scheduled_for is not null);
  if v_bad > 0 then raise exception 'safety: % outbox message(s) are queued or scheduled', v_bad; end if;
  select count(*) into v_bad from public.outbox_messages m where m.tenant_id = t and m.status = 'needs_approval';
  if v_bad <> 1 then raise exception 'safety: % messages wait for approval, expected exactly 1', v_bad; end if;
  -- every number of the people this script made is a +00 number
  select count(*) into v_bad from public.contacts c where c.tenant_id = t and c.id in (select pg_temp.sid('contact-' || key) from demo_cast) and c.phone not like '+00 %';
  if v_bad > 0 then raise exception 'safety: % contact(s) have a number that is not a +00 number', v_bad; end if;
  raise notice 'demo reseed: done. Today waiting %, prospects waiting %, calls %, chats %', v_waiting, v_nav ->> 'prospects_needing_owner', (select count(*) from public.phone_calls where tenant_id = t), (select jsonb_array_length(public.conversation_list(t, 100, null)));
end
$k$;

commit;
