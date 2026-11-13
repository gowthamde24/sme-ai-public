-- The assertions of check_local.py, in three parts (the script cuts this file at the @@ lines).
-- @@BEFORE
create function tests.chk(p_name text, p_ok boolean, p_detail text default '') returns void language plpgsql as
$f$ begin
  if p_ok is not true then raise exception 'FAIL %: %', p_name, p_detail; end if;
  raise notice 'CHECK % ok: %', p_name, p_detail;
end $f$;
create function tests.demo_id(k text) returns uuid language sql immutable as $f$ select md5('stack19.demo-reseed.neelambari:' || k)::uuid $f$;
create table public.zz_snap (label text, tbl text, n bigint, h text);
create function tests.snap(p_label text, p_tenant uuid) returns void language plpgsql as
$f$
declare r record;
begin
  for r in select * from (values
    ('public.leads', 'id::text || status::text || (archived_at is not null)::text'), ('public.contacts', 'id::text || full_name'), ('public.companies', 'id::text || name'),
    ('public.enquiries', 'id::text || (archived_at is not null)::text'), ('public.outbox_messages', 'id::text || status'), ('public.outbox_message_media', 'message_id::text || photo_id::text'),
    ('public.phone_calls', 'id::text || state || coalesce(summary_corrected, '''')'), ('public.quotes', 'id::text || status::text'), ('public.quote_lines', 'quote_id::text || line_no::text || qty::text || unit_price_applied_paise::text'),
    ('public.orders', 'id::text || state::text'), ('public.order_events', 'id::text || type::text'), ('public.store_visits', 'id::text || status'), ('public.call_requests', 'id::text || status'),
    ('public.prospects', 'id::text || status'), ('public.catalogue_items', 'id::text || active::text || coalesce(quantity::text, ''x'')'), ('public.item_types', 'id::text || active::text'),
    ('public.tasks', 'id::text || status'), ('public.outreach_items', 'id::text'), ('public.outreach_attempts', 'id::text'), ('public.outcomes', 'id::text'), ('public.lead_source_costs', 'source || cost_per_lead_paise::text'),
    ('public.custom_field_values', 'catalogue_item_id::text || value_choices::text'), ('public.requirements', 'id::text || status::text'), ('public.lead_profiles', 'id::text'),
    ('integrations.wa_conversation_state', 'lead_id::text')) v(tbl, expr) loop
    execute format('insert into public.zz_snap select $1, %L, count(*), md5(coalesce(string_agg(%s, ''|'' order by %s), '''')) from %s where tenant_id = $2', r.tbl, r.expr, r.expr, r.tbl) using p_label, p_tenant;
  end loop;
end $f$;
-- the other workspace must stay exactly as it is
select tests.snap('other0', '33333333-3333-3333-3333-333333333333');
select tests.chk('fixture', (select count(*) from public.quotes where tenant_id = '22222222-2222-2222-2222-222222222222' and status = 'draft' and total_paise = 194460000) = 1, 'the leftover quote of Rs 19,44,600 is a draft before the reseed');

-- @@RUN1
select tests.snap('r1', '22222222-2222-2222-2222-222222222222');
select tests.snap('other1', '33333333-3333-3333-3333-333333333333');
select tests.chk('other workspace untouched', (select count(*) from public.zz_snap a join public.zz_snap b on a.tbl = b.tbl where a.label = 'other0' and b.label = 'other1' and (a.n, a.h) is distinct from (b.n, b.h)) = 0, 'every table of "Another Shop" is the same');

do $c$
declare
  t constant uuid := '22222222-2222-2222-2222-222222222222'; o constant uuid := '11111111-1111-1111-1111-111111111111';
  v jsonb; v2 jsonb; n int; txt text; d jsonb; rec record;
begin
  -- (b) leftovers are gone
  perform tests.chk('leftover leads', (select count(*) from public.leads l join public.contacts c on c.id = l.contact_id where l.tenant_id = t and l.archived_at is null and (c.full_name ~* 'smoke|test buyer' or l.source ~* 'df click')) = 0,
                    'no live lead named Smoke test / Test Buyer One / DF click-through');
  perform tests.chk('leftover names', (select count(*) from public.contacts c where c.tenant_id = t and c.full_name ~* 'smoke|test buyer') = 0 and (select count(*) from public.companies c where c.tenant_id = t and c.name ~* 'smoke|test buyer') = 0,
                    'the leftover people were renamed');
  perform tests.chk('big quote', (select count(*) from public.quotes q where q.tenant_id = t and q.total_paise > 10000000 and q.status in ('draft', 'approved')) = 0
                    and (select status::text from public.quotes q where q.id = 'bbbbbbbb-0000-0000-0000-000000000001') = 'rejected', 'the Rs 19,44,600 quote is rejected, no live quote is above Rs 1,00,000');
  perform tests.chk('49 waiting prospects', (select count(*) from public.prospects where tenant_id = t) = 50 and (select count(*) from public.prospects where tenant_id = t and status = 'skipped') = 49,
                    'the 49 prospects that waited for the owner are skipped, the script keeps its one');
  perform tests.chk('leftover requests', (select count(*) from public.call_requests where tenant_id = t and status = 'requested') = 1 and (select count(*) from public.prospects where tenant_id = t and status = 'needs_owner') = 1
                    and (select count(*) from public.tasks where tenant_id = t and status in ('planned', 'paused', 'needs_answer')) = 0 and (select count(*) from public.store_visits where tenant_id = t and source = 'assistant' and status in ('booked', 'confirmed')) = 0,
                    'one callback request, one prospect, no planned task, no proposed visit');

  -- (c) calls: every state the Calls page knows
  v := tests.scalar_as(o, format('select public.phone_calls_list(%L, ''all'', 100, null)::text', t))::jsonb;
  select count(*) into n from jsonb_array_elements(v) x;
  perform tests.chk('calls listed', n = 11, n || ' calls in the list (9 made here + 2 older leftovers the database cannot delete)');
  select jsonb_object_agg(s, c) into d from (
    select case when (x ->> 'live')::boolean then 'live' when x ->> 'state' = 'refused' then (case when x ->> 'refuse_reason' = 'blocked_caller' then 'spam' else 'rejected' end)
                when x ->> 'state' = 'completed' then (case when x ->> 'end_reason' = 'handover' then 'transferred' else 'completed' end) else 'no_answer' end as s, count(*) as c
      from jsonb_array_elements(v) x where (x ->> 'id')::uuid in (select tests.demo_id('call-' || k) from unnest(array['padmaja','venkata','lakshmi','meenakshi','annapurna','savitha','nagaraju','spam']) k)
         or (x ->> 'id')::uuid = tests.demo_id('call-live-' || to_char((now() at time zone 'Asia/Kolkata')::date, 'YYMMDD') || '-1') group by 1) z;
  perform tests.chk('call states', d = '{"completed":3,"transferred":1,"no_answer":1,"rejected":1,"spam":1,"live":1}'::jsonb or d = '{"completed":4,"transferred":1,"no_answer":1,"rejected":1,"spam":1,"live":1}'::jsonb, d::text);
  perform tests.chk('calls shape', (select count(*) from jsonb_array_elements(v) x where (x ->> 'id')::uuid in (select tests.demo_id('call-' || k) from unnest(array['padmaja','venkata','lakshmi','meenakshi']) k)
                    and x ->> 'outcome' is not null and (x ->> 'duration_s')::int > 0 and (x ->> 'cost_paise')::int > 0 and length(x ->> 'summary') > 20) = 4
                    and (select count(distinct x ->> 'direction') from jsonb_array_elements(v) x) = 2 and (select count(*) from jsonb_array_elements(v) x where (x ->> 'created_at')::timestamptz > now() - interval '8 days') >= 9,
                    '4 completed calls have outcome, length, cost and summary; both directions; created within 7 days');
  perform tests.chk('call costs', (select bool_and((x ->> 'cost_paise')::int = ceil((x ->> 'duration_s')::numeric / 30) * 250) from jsonb_array_elements(v) x where (x ->> 'id')::uuid in (select tests.demo_id('call-' || k) from unnest(array['padmaja','venkata','lakshmi','meenakshi','annapurna']) k)),
                    'Rs 2.50 for each 30 seconds begun (about Rs 5 a minute)');
  perform tests.chk('call days', (select count(distinct ((x ->> 'created_at')::timestamptz at time zone 'Asia/Kolkata')::date) from jsonb_array_elements(v) x where (x ->> 'id')::uuid in (select tests.demo_id('call-' || k) from unnest(array['padmaja','venkata','lakshmi','meenakshi','annapurna','savitha','nagaraju','spam']) k)) >= 5, 'the calls are spread over several days');
  v2 := tests.scalar_as(o, format('select public.phone_calls_list(%L, ''live'', 20, null)::text', t))::jsonb;
  perform tests.chk('live call', jsonb_array_length(v2) = 1 and (v2 -> 0 ->> 'who' is null or true) and (v2 -> 0 ->> 'state') = 'in_progress', 'one call shows in the live strip');
  select count(*) into n from public.phone_calls c where c.tenant_id = t and c.transcript is not null and c.id in (select tests.demo_id('call-' || k) from unnest(array['padmaja','venkata','lakshmi','meenakshi','annapurna','savitha','nagaraju','spam']) k);
  perform tests.chk('transcripts', n = 3 and (select count(*) from public.phone_calls c where c.transcript::text ~ 'Rs 24,500|Rs 48,000|Rs 8,900') = 3, n || ' calls have a transcript, each with a price');
  perform tests.chk('call numbers', (select count(*) from public.contacts c where c.tenant_id = t and c.id in (select contact_id from public.phone_calls where tenant_id = t and contact_id is not null) and c.phone not like '+00 %') = 0, 'every contact on a call has a +00 number');

  -- (d) needs you, by the Today function of the app, as the owner
  v := tests.scalar_as(o, format('select public.today_summary(%L)::text', t))::jsonb;
  perform tests.chk('needs you', (v -> 'cards' ->> 'waiting')::int = 3 and (select array_agg(x ->> 'kind' order by x ->> 'kind') from jsonb_array_elements(v -> 'needs_you') x) = array['call_approval', 'outbox_approval', 'quote_approval'],
                    'Today: 3 waiting (a quote to approve, a callback request, a reply)');
  perform tests.chk('needs you quote', (select (x ->> 'amount_paise')::bigint from jsonb_array_elements(v -> 'needs_you') x where x ->> 'kind' = 'quote_approval') = 2450000, 'the quote to approve is Rs 24,500');
  v2 := tests.scalar_as(o, format('select public.nav_counts(%L)::text', t))::jsonb;
  perform tests.chk('prospect waiting', (v2 ->> 'prospects_needing_owner')::int = 1 and (v2 ->> 'lead_desk_waiting')::int = 0 and (v2 ->> 'quotes_waiting')::int = 1,
                    format('prospects %s, lead desk %s, menu number %s', v2 ->> 'prospects_needing_owner', v2 ->> 'lead_desk_waiting', (v2 ->> 'needs_you')::int + (v2 ->> 'lead_desk_waiting')::int + (v2 ->> 'prospects_needing_owner')::int));
  perform tests.chk('running job', (select count(*) from public.tasks where tenant_id = t and status = 'running') = 1 and (v2 ->> 'ai_team_working')::int >= 1 and (v2 ->> 'live_calls')::int = 1,
                    format('ai_team_working %s, live_calls %s', v2 ->> 'ai_team_working', v2 ->> 'live_calls'));

  -- (e) chats
  v := tests.scalar_as(o, format('select public.conversation_list(%L, 100, null)::text', t))::jsonb;
  perform tests.chk('chats', jsonb_array_length(v) = 6 and (select count(*) from jsonb_array_elements(v) x where x ->> 'handled_by' = 'needs_you') = 2 and (select count(*) from jsonb_array_elements(v) x where x ->> 'handled_by' = 'assistant') = 2
                    and (select count(*) from jsonb_array_elements(v) x where x ->> 'handled_by' = 'done') = 2,
                    (select string_agg((x ->> 'name') || '=' || (x ->> 'handled_by'), ', ' order by x ->> 'name') from jsonb_array_elements(v) x));
  perform tests.chk('reply waiting', (select count(*) from public.outbox_messages where tenant_id = t and status = 'needs_approval') = 1
                    and (select count(*) from public.outbox_message_media md join public.outbox_messages m on m.id = md.message_id where m.tenant_id = t and m.status = 'needs_approval') between 2 and 3, 'one reply waits for the owner with 2 or 3 photos');
  v2 := tests.scalar_as(o, format('select public.conversation_thread(%L, %L, 50, null)::text', t, tests.demo_id('lead-padmaja')))::jsonb;
  perform tests.chk('chat thread', jsonb_array_length(v2 -> 'items') = 4 and v2 ->> 'handled_by' = 'needs_you', 'Padmaja: 3 messages and the waiting reply');
  -- (f) nothing the sender could pick up
  perform tests.chk('sender safety', (select count(*) from public.outbox_messages where tenant_id = t and (status = 'queued' or scheduled_for is not null or claimed_at is not null)) = 0
                    and (select count(*) from public.outbox_messages where tenant_id = t and status = 'sent' and sent_at > now()) = 0
                    and (select count(*) from public.contacts c where c.tenant_id = t and c.phone is not null and c.phone not like '+00 %') = 0, 'no queued or scheduled message, every sent message is in the past, every phone is a +00 number');

  -- (g) quotes and orders
  perform tests.chk('quotes', (select array_agg(total_paise order by total_paise) from public.quotes q where q.tenant_id = t and q.id in (select tests.demo_id('quote-' || k) from unnest(array['q2','q3','q4','q5','q6']) k) or q.id = tests.demo_id('quote-' || to_char((now() at time zone 'Asia/Kolkata')::date, 'YYMMDD') || '-1'))
                    = array[1540000::bigint, 2450000, 2750000, 3180000, 4800000, 5600000], 'Rs 15,400, 24,500, 27,500, 31,800, 48,000 and 56,000');
  perform tests.chk('quote states', (select jsonb_object_agg(status, c) from (select status::text, count(*) c from public.quotes q where q.tenant_id = t and q.id in (select tests.demo_id('quote-' || k) from unnest(array['q2','q3','q4','q5','q6']) k) or q.id = tests.demo_id('quote-' || to_char((now() at time zone 'Asia/Kolkata')::date, 'YYMMDD') || '-1') group by 1) z)
                    = '{"draft":1,"approved":4,"rejected":1}'::jsonb
                    and (select jsonb_object_agg(state, c) from (select state::text, count(*) c from public.orders o where o.tenant_id = t group by 1) z) = '{"quote_approved":1,"quote_sent":1,"accepted":2}'::jsonb,
                    'draft 1, approved 4, rejected 1; orders: approved 1, sent 1, accepted 2');
  perform tests.chk('quote lines', (select count(*) from public.quote_lines ql join public.quotes q on q.id = ql.quote_id where q.tenant_id = t and q.status in ('draft', 'approved') and ql.item_type_code is not null
                    and not exists (select 1 from public.catalogue_items c join public.item_types it on it.tenant_id = c.tenant_id and it.name = c.name where c.tenant_id = t and it.code = ql.item_type_code and ql.name = c.name)) = 0
                    and (select count(*) from public.quote_lines ql join public.quotes q on q.id = ql.quote_id where q.tenant_id = t and q.status in ('draft', 'approved')) = 10, 'every line of the 5 live quotes names one of the 18 catalogue items');

  -- (h) leads in six stages, three sources
  select jsonb_object_agg(chip, c) into d from (
    select case when exists (select 1 from public.store_visits v where v.lead_id = l.id and v.status = 'completed' and v.outcome = 'bought') then 'won' when l.status = 'disqualified' then 'lost'
                when exists (select 1 from public.quotes q where q.lead_id = l.id and q.status in ('draft', 'approved')) then 'quote' when exists (select 1 from public.store_visits v where v.lead_id = l.id and v.status <> 'cancelled') then 'visit_booked'
                when l.status = 'new' then 'new' else 'contacted' end as chip, count(*) as c
      from public.leads l where l.tenant_id = t and l.archived_at is null group by 1) z;
  perform tests.chk('lead stages', d = '{"new":3,"contacted":1,"visit_booked":4,"quote":3,"won":2,"lost":2}'::jsonb, d::text);

  -- (i) reports as the owner: funnel, sources, cost per visit
  v := tests.scalar_as(o, format('select public.outreach_report(%L, current_date - 29, current_date)::text', t))::jsonb;
  perform tests.chk('sources', (select array_agg(x ->> 'source' order by (x ->> 'source') collate "C") from jsonb_array_elements(v -> 'by_source') x) = array['Instagram', 'Walk-in', 'indiamart']
                    and (select bool_and((x ->> 'leads')::int = 5 and (x ->> 'bookings')::int = 2 and (x ->> 'cost_per_booking_paise')::int > 0) from jsonb_array_elements(v -> 'by_source') x),
                    (select string_agg((x ->> 'source') || ': ' || (x ->> 'leads') || ' leads, ' || (x ->> 'bookings') || ' visits, Rs ' || round((x ->> 'cost_per_booking_paise')::numeric / 100) || ' a visit', '; ' order by x ->> 'source') from jsonb_array_elements(v -> 'by_source') x));
  perform tests.chk('funnel', (v -> 'total' ->> 'leads')::int = 15 and (v -> 'total' ->> 'calls')::int = 13 and (v -> 'total' ->> 'bookings')::int = 6 and (v -> 'total' ->> 'cost_per_booking_paise')::int > 0,
                    format('enquiries %s, calls %s answered %s%%, visits booked by calls %s, Rs %s a visit', v -> 'total' ->> 'leads', v -> 'total' ->> 'calls', round((v -> 'total' ->> 'connected_rate')::numeric * 100), v -> 'total' ->> 'bookings', round((v -> 'total' ->> 'cost_per_booking_paise')::numeric / 100)));
  select count(*) filter (where status <> 'cancelled') as total, count(*) filter (where outcome = 'bought') as bought, count(*) filter (where status = 'no_show') as no_show, count(*) filter (where status = 'completed') as done into rec
    from public.store_visits where tenant_id = t and visit_date >= current_date - 29 and visit_date <= (now() at time zone 'Asia/Kolkata')::date;
  perform tests.chk('visits in 30 days', rec.total >= 9 and rec.bought = 2 and rec.no_show = 1, format('%s visits (booked, done or missed), %s bought, %s no-show, %s done', rec.total, rec.bought, rec.no_show, rec.done));
  perform tests.chk('quotes in 30 days', (select count(*) from public.quotes q where q.tenant_id = t and q.status not in ('rejected', 'superseded') and q.created_at > now() - interval '30 days') = 5
                    and (select sum(total_paise) from public.quotes q where q.tenant_id = t and q.status not in ('rejected', 'superseded') and q.created_at > now() - interval '30 days') = 14720000, '5 live quotes, Rs 1,47,200 in all');
  v2 := tests.scalar_as(o, format('select public.nav_counts(%L)::text', t))::jsonb;
  perform tests.chk('visits today', (select count(*) from public.store_visits where tenant_id = t and visit_date = (now() at time zone 'Asia/Kolkata')::date) = 4
                    and (select count(distinct starts_at) from public.store_visits where tenant_id = t and visit_date = (now() at time zone 'Asia/Kolkata')::date) = 4
                    and (select jsonb_object_agg(status, c) from (select status, count(*) c from public.store_visits where tenant_id = t and visit_date = (now() at time zone 'Asia/Kolkata')::date group by 1) z) = '{"booked":2,"confirmed":1,"completed":1}'::jsonb
                    and (v2 ->> 'visits_today')::int = 3, 'today: 2 booked, 1 confirmed, 1 done earlier, at 4 different times');

  -- (k) the catalogue: the owner's 18 products
  perform tests.chk('catalogue items', (select count(*) from public.catalogue_items c where c.tenant_id = t and c.id in (select tests.demo_id('item-' || k) from unnest(array['ss_tissue','ss_meenakari','ss_checks','ss_kadiyal','ss_buttas','ss_selfgold','lw_kanchi','lw_vpure','lw_vhandloom','ps_selfdesign','ps_reshamwarp','ps_tissuecontrast','ps_meenakari','ps_reshamkuttu','ps_zari','ps_3cord','ps_4cord','hl_pure']) k)) = 18
                    and (select count(*) from public.catalogue_items c where c.tenant_id = t and c.active) = 0, '18 items; no old trial item is on');
  perform tests.chk('catalogue categories', (select jsonb_object_agg(cat, c) from (select v.value_choices[1] as cat, count(*) c from public.custom_field_values v join public.custom_field_defs d on d.id = v.field_id where v.tenant_id = t and d.code = 'category' group by 1) z)
                    = '{"semi_silk":6,"lightweight":3,"pure_silk":8,"handloom":1}'::jsonb, '4 categories: semi silk 6, lightweight 3, pure silk 8, handloom 1');
  perform tests.chk('catalogue stock', (select count(*) from public.catalogue_items c where c.tenant_id = t and c.quantity is null and c.name !~ '^DEMO') = 7
                    and (select jsonb_object_agg(name, quantity) from public.catalogue_items c where c.tenant_id = t and c.quantity is not null and c.name !~ '^DEMO') = '{"Semi silk tissue":100,"Semi silk meenakari":100,"Semi silk vintage checks":100,"Semi silk kadiyal kuttu":100,"Semi silk plain buttas":100,"Lightweight Kanchi border":50,"Lightweight vintage pure":50,"Pure silk self design":50,"Pure silk resham warp self":50,"Pure silk pure tissue contrast":50,"Pure silk meenakari":50}'::jsonb,
                    '7 items with unknown stock (NULL, the app asks), 11 with the owner''s numbers');
  perform tests.chk('draft price marker', (select count(*) from public.catalogue_items c where c.tenant_id = t and c.name !~ '^DEMO' and c.border like '%Draft price, to be confirmed') = 18, 'all 18 items say "Draft price, to be confirmed" in their border field');
  perform tests.chk('item types', (select count(*) from public.item_types where tenant_id = t and active) = 18, 'the 18 names are the only item types a quote can use');

  -- (j) no leftover word in text a person can see
  select string_agg(w.tbl || '.' || w.col || ': ' || left(w.val, 60), E'\n') into txt from (
    select 'companies' tbl, 'name' col, name val from public.companies where tenant_id = t and archived_at is null union all select 'companies', 'city', city from public.companies where tenant_id = t and archived_at is null
    union all select 'contacts', 'full_name', full_name from public.contacts where tenant_id = t and archived_at is null union all select 'contacts', 'email', email from public.contacts where tenant_id = t and archived_at is null
    union all select 'leads', 'source', source from public.leads where tenant_id = t and archived_at is null union all select 'leads', 'disqualified_reason', disqualified_reason from public.leads where tenant_id = t and archived_at is null
    union all select 'lead_profiles', 'need', p.need from public.lead_profiles p join public.leads l on l.id = p.lead_id and l.archived_at is null where p.tenant_id = t
    union all select 'lead_profiles', 'budget', p.budget from public.lead_profiles p join public.leads l on l.id = p.lead_id and l.archived_at is null where p.tenant_id = t
    union all select 'enquiries', 'body', body from public.enquiries where tenant_id = t and archived_at is null
    union all select 'outbox_messages', 'body', body from public.outbox_messages where tenant_id = t and status in ('sent', 'needs_approval')
    union all select 'phone_calls', 'summary', summary from public.phone_calls where tenant_id = t and id in (select tests.demo_id('call-' || k) from unnest(array['padmaja','venkata','lakshmi','meenakshi','annapurna','savitha','nagaraju','spam']) k)
    union all select 'phone_calls', 'transcript', transcript::text from public.phone_calls where tenant_id = t and transcript is not null and id not in ('cccccccc-0000-0000-0000-000000000001', 'cccccccc-0000-0000-0000-000000000002')
    union all select 'store_visits', 'purpose', concat_ws(' ', purpose, note) from public.store_visits where tenant_id = t and status <> 'cancelled'
    union all select 'call_requests', 'reason', concat_ws(' ', reason, script_draft) from public.call_requests where tenant_id = t and status = 'requested'
    union all select 'prospects', 'name', concat_ws(' ', name, category, area, source_label, fit_reason) from public.prospects where tenant_id = t and status = 'needs_owner'
    union all select 'catalogue_items', 'name', concat_ws(' ', name, border) from public.catalogue_items where tenant_id = t and id in (select tests.demo_id('item-' || k) from unnest(array['ss_tissue','ss_meenakari','ss_checks','ss_kadiyal','ss_buttas','ss_selfgold','lw_kanchi','lw_vpure','lw_vhandloom','ps_selfdesign','ps_reshamwarp','ps_tissuecontrast','ps_meenakari','ps_reshamkuttu','ps_zari','ps_3cord','ps_4cord','hl_pure']) k)
    union all select 'item_types', 'name', name from public.item_types where tenant_id = t and active
    union all select 'quote_lines', 'name', ql.name from public.quote_lines ql join public.quotes q on q.id = ql.quote_id where q.tenant_id = t and q.status in ('draft', 'approved')
    union all select 'tasks', 'instruction', instruction from public.tasks where tenant_id = t and status = 'running'
    union all select 'outreach_batches', 'name', name from public.outreach_batches where tenant_id = t and status <> 'cancelled'
    union all select 'lead_source_costs', 'source', source from public.lead_source_costs where tenant_id = t) w
   where w.val ~* '(smoke|click-through|\mdf\M|synthetic|\mtest|\mdemo|lorem|example:)';
  perform tests.chk('text scan', txt is null, coalesce(E'\n' || txt, 'no smoke, DF, click-through, synthetic, test or demo word in any text a person can see'));
  select count(*) into n from public.phone_calls c where c.tenant_id = t and c.summary ~* 'smoke|test buyer';
  raise notice 'INFO % older call(s) still carry a leftover word in their summary: the database never deletes or rewrites a finished call', n;
end
$c$;

-- @@RUN2
select tests.snap('r2', '22222222-2222-2222-2222-222222222222');
select tests.chk('idempotent', (select count(*) from public.zz_snap a join public.zz_snap b on a.tbl = b.tbl where a.label = 'r1' and b.label = 'r2' and (a.n, a.h) is distinct from (b.n, b.h)) = 0
       and (select count(*) from public.zz_snap where label = 'r1') = (select count(*) from public.zz_snap where label = 'r2'),
       (select string_agg(tbl || '=' || n, ' ' order by tbl) from public.zz_snap where label = 'r2' and n > 0));
select tests.chk('chats after the second run', jsonb_array_length(tests.scalar_as('11111111-1111-1111-1111-111111111111', format('select public.conversation_list(%L, 100, null)::text', '22222222-2222-2222-2222-222222222222'))::jsonb) = 6, 'still 6');
do $e$
declare r record;
begin
  for r in select q.id, q.request_text, q.result_text from public.quotes q where q.tenant_id = '22222222-2222-2222-2222-222222222222' and q.status in ('draft', 'approved') order by q.quote_no loop
    raise notice 'ENGINE_ROW|%|%|%', r.id, r.request_text, r.result_text;
  end loop;
end $e$;

-- @@CONSUME
-- the owner works through the demo: decides the quote, the callback request, the prospect and the reply, and the live call ends. A new run must bring the same three waiting items and a live call again.
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', true);
update public.quotes set status = 'rejected', rejected_by = '11111111-1111-1111-1111-111111111111', rejected_at = now(), reject_code = 'other' where tenant_id = '22222222-2222-2222-2222-222222222222' and status = 'draft';
update public.call_requests set status = 'approved', decided_by = '11111111-1111-1111-1111-111111111111', decided_at = now() where tenant_id = '22222222-2222-2222-2222-222222222222' and status = 'requested';
update public.prospects set status = 'skipped' where tenant_id = '22222222-2222-2222-2222-222222222222' and status = 'needs_owner';
update public.outbox_messages set status = 'blocked', reason = 'owner_rejected', decided_by = '11111111-1111-1111-1111-111111111111', decided_at = now() where tenant_id = '22222222-2222-2222-2222-222222222222' and status = 'needs_approval';
update public.phone_calls set state = 'failed', ended_at = now(), end_reason = 'error', outcome = 'failed', duration_s = 60 where tenant_id = '22222222-2222-2222-2222-222222222222' and state = 'in_progress';
select tests.chk('consumed', (select (public.today_summary('22222222-2222-2222-2222-222222222222') -> 'cards' ->> 'waiting')::int) = 0, 'after the owner decided everything nothing waits');
-- @@RUN3
select tests.chk('slots renew', (select (public.today_summary('22222222-2222-2222-2222-222222222222') -> 'cards' ->> 'waiting')::int) = 3
       and (select (public.nav_counts('22222222-2222-2222-2222-222222222222') ->> 'prospects_needing_owner')::int) = 1
       and (select jsonb_array_length(tests.scalar_as('11111111-1111-1111-1111-111111111111', format('select public.phone_calls_list(%L, ''live'', 20, null)::text', '22222222-2222-2222-2222-222222222222'))::jsonb)) = 1
       and (select count(*) from public.outbox_messages where tenant_id = '22222222-2222-2222-2222-222222222222' and status in ('needs_approval')) = 1
       and (select count(*) from public.outbox_messages where tenant_id = '22222222-2222-2222-2222-222222222222' and status in ('queued')) = 0,
       'a new run after the owner decided everything: 3 waiting again, 1 prospect, 1 live call, 1 waiting reply, nothing queued');
select 'ALL_CHECKS_PASSED';
