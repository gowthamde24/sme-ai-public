-- Job AT (ADR 0066): the OUTBOX, its deterministic send policy, the kill switch, STOP, quiet hours, the per-customer limit, the first-message disclosure, call requests.
-- NOTHING IS SENT: the only adapter that exists is a local fake (tests/test_outbox_*.py); here the database only decides and records.
--   A catalog           B the words (money / commitment / complaint in en te hi kn ta; a Telugu price MUST wait)   C quiet hours, pure
--   D the kill switch   E the policy table (auto / needs_approval) through outbox_submit   F the hard blocks (STOP, no opt-in, no phone, daily limit)
--   G the disclosure    H idempotency   I roles x aal   J edit / approve / reject   K dispatch (claim, mark, re-checks)   L direct writes and the guard triggers
--   M call requests     N Today      O audit holds no message text
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

-- ---------------------------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------------------------
create function pg_temp.at(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform tests.as_aal(p_aal);
  r := tests.error_full_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
  perform tests.as_aal('aal2');
  if r = 'ok' then return 'ok'; end if;
  return split_part(r, '|', 1);
end $$;
create function pg_temp.try(p_user text, p_sql text) returns text language sql as $$ select pg_temp.at('aal2', p_user, p_sql) $$;
-- a scalar as a user (at aal2 unless told); 'ERR:<sqlstate>' on failure
create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;
create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;

-- a customer: company, contact (with a phone unless told), a lead; WhatsApp consent granted by the Owner unless told
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
create function pg_temp.mk(p_label text, p_consent boolean default true, p_phone boolean default true, p_keyed boolean default true) returns void language plpgsql as $$
begin
  insert into public.contacts (id, tenant_id, company_id, full_name, phone)
  values (tests.rid(p_label || '_c'), tests.tid('a'), tests.rid('a_company'), 'Contact ' || p_label, case when p_phone then '+00 9' || lpad((abs(hashtext(p_label)) % 100000)::text, 5, '0') end);
  insert into public.leads (id, tenant_id, company_id, contact_id) values (tests.rid(p_label), tests.tid('a'), tests.rid('a_company'), tests.rid(p_label || '_c'));
  if p_keyed and p_phone then
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_contact_keys(%L, %L::jsonb)$q$, tests.rid(p_label || '_c'), jsonb_build_object('version', 1, 'phone', pg_temp.h(p_label || '_p'))::text));
  end if;
  if p_consent then
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_consent(%L, %L, 'whatsapp', 'granted', 'explicit_consent', 'web_form', 'form:at')$q$, tests.tid('a'), tests.rid(p_label || '_c')));
  end if;
end $$;
-- the customer wrote to us on WhatsApp p_ago ago
create function pg_temp.inbound(p_label text, p_body text, p_ago interval default '1 hour') returns void language sql as $$
  insert into public.enquiries (id, tenant_id, lead_id, channel, received_at, body, body_sha256)
  values (gen_random_uuid(), tests.tid('a'), tests.rid(p_label), 'whatsapp', now() - p_ago, p_body, repeat('a', 64)) $$;
-- submit a message as a user (default the Owner); the answer as JSON text, or 'ERR:<sqlstate>'
create function pg_temp.sub(p_msg text, p_lead text, p_text text, p_cat text default 'info', p_lang text default 'en', p_flag boolean default false, p_unc boolean default false,
                            p_user text default 'a_owner', p_tenant text default 'a') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.outbox_submit(%L, %L, %L, 'whatsapp', %L, %L, %L, 'assistant', %L, %L)$q$,
                    tests.rid(p_msg), tests.tid(p_tenant), tests.rid(p_lead), p_text, p_lang, p_cat, p_flag, p_unc)) $$;
create function pg_temp.st(p_msg text) returns text language sql as $$ select status || '/' || reason from public.outbox_messages where id = tests.rid(p_msg) $$;
create function pg_temp.verdict(p_json text) returns text language sql as $$ select (p_json::jsonb ->> 'status') || '/' || (p_json::jsonb ->> 'reason') $$;

-- ---------------------------------------------------------------------------------------------
-- A. catalog: grants, definers, flags, RLS
-- ---------------------------------------------------------------------------------------------
select is((select enabled from public.platform_flags where key = 'outbox_enabled'), false, 'the global kill switch exists and is OFF by default');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('outbox_messages', 'outbox_settings', 'call_requests')
            and grantee in ('anon', 'authenticated', 'public') and privilege_type <> 'SELECT'), 0::bigint, 'no client role can write the outbox, its settings or call requests directly');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('outbox_messages', 'outbox_settings', 'call_requests') and grantee = 'anon'),
          0::bigint, 'anon reads none of it');
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('outbox_messages', 'outbox_settings', 'call_requests')
            and c.relrowsecurity and c.relforcerowsecurity), 3::bigint, 'row-level security is on and forced for all three');
select is((select string_agg(p.proname, ',' order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('outbox_submit', 'outbox_edit', 'outbox_decide', 'outbox_claim_due', 'outbox_mark', 'outbox_set_settings', 'outbox_settings_get',
                                                          'call_request_create', 'call_request_decide') and p.prosecdef and p.proconfig @> array['search_path=""']),
          'call_request_create,call_request_decide,outbox_claim_due,outbox_decide,outbox_edit,outbox_mark,outbox_set_settings,outbox_settings_get,outbox_submit',
          'every public function is a SECURITY DEFINER with an empty search_path');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
            and p.proname in ('outbox_submit', 'outbox_edit', 'outbox_decide', 'outbox_claim_due', 'outbox_mark', 'outbox_set_settings', 'outbox_settings_get', 'call_request_create', 'call_request_decide')
            and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('public', p.oid, 'execute'))), 0::bigint, 'none is executable by anon or public');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app'
            and (p.proname like 'outbox\_%' escape '\') and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0::bigint,
          'the internal policy functions are not executable by any client role');

-- ---------------------------------------------------------------------------------------------
-- B. the words: money, commitments, complaints, in five languages (pure)
-- ---------------------------------------------------------------------------------------------
select is(app.outbox_content_flags('The price is Rs 500 each'), array['money'], 'EN: "Rs 500" is money');
select is(app.outbox_content_flags('Total ₹1,200 only'), array['money'], 'EN: the rupee sign is money');
select is(app.outbox_content_flags('Only 500/- per piece'), array['money'], 'EN: "500/-" is money');
select is(app.outbox_content_flags('Ten thousand rupees'), array['money'], 'EN: the word rupees is money');
select is(app.outbox_content_flags('GST is extra and an advance is needed'), array['money'], 'EN: GST / advance');
select is(app.outbox_content_flags('Please pay by UPI to our bank account'), array['money'], 'EN: pay / UPI / bank');
select is(app.outbox_content_flags('We can give a discount on bulk orders'), array['money'], 'EN: discount');
select is(app.outbox_content_flags('A refund or store credit is possible'), array['money'], 'EN: refund / credit');
select is(app.outbox_content_flags('ఈ చీర ధర 500 రూపాయలు'), array['money'], 'TE: ధర / రూపాయలు (a price in Telugu MUST wait)');
select is(app.outbox_content_flags('తగ్గింపు ఉంది, జీఎస్టీ అదనం'), array['money'], 'TE: తగ్గింపు (discount) / జీఎస్టీ');
select is(app.outbox_content_flags('అడ్వాన్స్ చెల్లింపు యూపీఐ ద్వారా చేయండి'), array['money'], 'TE: advance / payment / UPI');
select is(app.outbox_content_flags('इस साड़ी की कीमत 500 रुपये है'), array['money'], 'HI: कीमत / रुपये');
select is(app.outbox_content_flags('आपको छूट और एडवांस मिलेगा, पेमेंट बैंक से करें'), array['money'], 'HI: छूट / एडवांस / पेमेंट / बैंक');
select is(app.outbox_content_flags('ಈ ಸೀರೆಯ ಬೆಲೆ 500 ರೂಪಾಯಿ'), array['money'], 'KN: ಬೆಲೆ / ರೂಪಾಯಿ');
select is(app.outbox_content_flags('ಮುಂಗಡ ಪಾವತಿ ಮತ್ತು ರಿಯಾಯಿತಿ'), array['money'], 'KN: advance / payment / discount');
select is(app.outbox_content_flags('இந்த புடவையின் விலை 500 ரூபாய்'), array['money'], 'TA: விலை / ரூபாய்');
select is(app.outbox_content_flags('We promise delivery'), array['commitment'], 'EN: promise is a commitment');
select is(app.outbox_content_flags('We guarantee the colour'), array['commitment'], 'EN: guarantee');
select is(app.outbox_content_flags('మేము హామీ ఇస్తున్నాము'), array['commitment'], 'TE: హామీ');
select is(app.outbox_content_flags('हम गारंटी देते हैं'), array['commitment'], 'HI: गारंटी');
select is(app.outbox_content_flags('ನಾವು ಭರವಸೆ ನೀಡುತ್ತೇವೆ'), array['commitment'], 'KN: ಭರವಸೆ');
select is(app.outbox_content_flags('I want to make a complaint, the saree is damaged'), array['complaint'], 'EN: complaint / damaged');
select is(app.outbox_content_flags('నాకు ఫిర్యాదు ఉంది'), array['complaint'], 'TE: ఫిర్యాదు');
select is(app.outbox_content_flags('मुझे शिकायत है'), array['complaint'], 'HI: शिकायत');
select is(app.outbox_content_flags('ನನಗೆ ದೂರು ಇದೆ'), array['complaint'], 'KN: ದೂರು');
select is(app.outbox_content_flags('Price: ₹500, we guarantee it and will fix any complaint'), array['money', 'commitment', 'complaint'], 'all three at once');
select is(app.outbox_content_flags('We are open from 10 am to 8 pm, Monday to Saturday.'), '{}'::text[], 'EN: opening hours carry no flag');
select is(app.outbox_content_flags('Your visit is booked for Saturday at 4 pm. See you at our shop in Hyderabad.'), '{}'::text[], 'EN: a visit booking carries no flag');
select is(app.outbox_content_flags('మేము ఉదయం 10 గంటలకు తెరుస్తాము'), '{}'::text[], 'TE: hours carry no flag');
select is(app.outbox_content_flags('हम सुबह 10 बजे खुलते हैं'), '{}'::text[], 'HI: hours carry no flag');
select is(app.outbox_content_flags('ನಾವು ಬೆಳಿಗ್ಗೆ 10 ಗಂಟೆಗೆ ತೆರೆಯುತ್ತೇವೆ'), '{}'::text[], 'KN: hours carry no flag');
select is(app.outbox_content_flags('Order 1234 is packed and ready.'), '{}'::text[], 'a number alone is not money');
select is((select count(*) from unnest(array['en', 'te', 'hi', 'kn', 'ta']) l where app.outbox_content_flags(app.outbox_disclosure(l)) <> '{}'), 0::bigint, 'the disclosure lines themselves carry no flag');
select ok(app.outbox_disclosure('te') <> app.outbox_disclosure('en') and app.outbox_disclosure('hi') <> app.outbox_disclosure('kn') and app.outbox_disclosure('ta') <> app.outbox_disclosure('en'), 'the disclosure is said in each language');

-- ---------------------------------------------------------------------------------------------
-- C. quiet hours 21:00 to 09:00 India time (pure, explicit instants)
-- ---------------------------------------------------------------------------------------------
select is(app.outbox_in_quiet_hours('2026-10-10 20:59:00+05:30'), false, '20:59 IST is open');
select is(app.outbox_in_quiet_hours('2026-10-10 21:00:00+05:30'), true, '21:00 IST is quiet');
select is(app.outbox_in_quiet_hours('2026-10-11 02:00:00+05:30'), true, '02:00 IST is quiet');
select is(app.outbox_in_quiet_hours('2026-10-11 08:59:00+05:30'), true, '08:59 IST is quiet');
select is(app.outbox_in_quiet_hours('2026-10-11 09:00:00+05:30'), false, '09:00 IST is open');
select is(app.outbox_next_open('2026-10-10 22:30:00+05:30'), '2026-10-11 09:00:00+05:30'::timestamptz, '22:30 IST waits until 09:00 the next morning');
select is(app.outbox_next_open('2026-10-11 02:00:00+05:30'), '2026-10-11 09:00:00+05:30'::timestamptz, '02:00 IST waits until 09:00 the same morning');
select is(app.outbox_next_open('2026-10-10 15:00:00+05:30'), '2026-10-10 15:00:00+05:30'::timestamptz, 'daytime does not wait');
select is(app.outbox_next_open('2026-10-10 21:00:00+05:30'), '2026-10-11 09:00:00+05:30'::timestamptz, '21:00 sharp waits');
select is(app.outbox_next_open('2026-10-10 20:00:00+00'), '2026-10-11 09:00:00+05:30'::timestamptz, '20:00 UTC is 01:30 IST the next day: quiet, and it waits for 09:00 IST that day');

-- ---------------------------------------------------------------------------------------------
-- D. the kill switch: OFF by default blocks everything, even a perfect message
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('k1');
select pg_temp.inbound('k1', 'Hello, are you open on Sunday?');
select is(pg_temp.verdict(pg_temp.sub('d1', 'k1', 'Yes, we are open on Sunday from 10 am.', 'reply_to_inbound')), 'blocked/switch_off', 'the kill switch is off: a perfect reply is blocked (switch_off)');
select is(pg_temp.st('d1'), 'blocked/switch_off', '...and the row says so');
select is((select count(*) from public.outbox_messages where tenant_id = tests.tid('a') and status in ('queued', 'sent')), 0::bigint, 'nothing is queued or sent');
update public.platform_flags set enabled = true where key = 'outbox_enabled';
select is(pg_temp.sc('a_owner', format($q$select public.outbox_set_settings(%L, true, 3)$q$, tests.tid('a'))), '{"auto_send_enabled": true, "per_customer_daily_limit": 3}', 'the Owner switches auto-send on (limit 3) with a second factor');

-- ---------------------------------------------------------------------------------------------
-- E. the policy through outbox_submit (switch on, auto on, consent granted, an inbound message an hour ago)
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('p1');  select pg_temp.inbound('p1', 'Hello, please tell me about your sarees');
select pg_temp.mk('p2');  select pg_temp.inbound('p2', 'Hello, please tell me about your sarees');
select pg_temp.mk('p3');  select pg_temp.inbound('p3', 'Hello, please tell me about your sarees');
select pg_temp.mk('p4');  select pg_temp.inbound('p4', 'Hello, please tell me about your sarees');
select pg_temp.mk('p5');  select pg_temp.inbound('p5', 'Hello, please tell me about your sarees');
select pg_temp.mk('p6');  select pg_temp.inbound('p6', 'This is a complaint. The saree I got is damaged.');
select pg_temp.mk('p7');  select pg_temp.inbound('p7', 'Hello, please tell me about your sarees');
select pg_temp.mk('p8');  select pg_temp.inbound('p8', 'Hello, please tell me about your sarees');
select pg_temp.mk('p9');  -- no inbound at all
select pg_temp.mk('p10'); select pg_temp.inbound('p10', 'Hello, please tell me about your sarees');
select pg_temp.mk('p11'); select pg_temp.inbound('p11', 'Hello, please tell me about your sarees');
select pg_temp.mk('p12'); select pg_temp.inbound('p12', 'Hello, please tell me about your sarees');

select ok(pg_temp.verdict(pg_temp.sub('e1', 'p1', 'Thank you for writing. We are open from 10 am to 8 pm every day.', 'reply_to_inbound')) in ('queued/auto_allowed', 'queued/quiet_hours'), 'AUTO: a plain reply within 24h is queued (immediately, or at 09:00 in quiet hours)');
select is(pg_temp.verdict(pg_temp.sub('e2', 'p2', 'ఈ చీర ధర 500 రూపాయలు మాత్రమే', 'reply_to_inbound', 'te')), 'needs_approval/money', 'WAITS: a price in TELUGU, inside the 24h window, is held for a person');
select is((select flags from public.outbox_messages where id = tests.rid('e2')), array['money'], '...and the row names the flag');
select is((select status from public.outbox_messages where id = tests.rid('e2')), 'needs_approval', '...and it is not queued');
select is(pg_temp.verdict(pg_temp.sub('e3', 'p3', 'The price is ₹500 each', 'reply_to_inbound')), 'needs_approval/money', 'WAITS: a rupee amount');
select is(pg_temp.verdict(pg_temp.sub('e4', 'p4', 'Your order status: packed and ready to ship.', 'order_status')) in ('queued/auto_allowed', 'queued/quiet_hours'), true, 'AUTO: an order status without amounts');
select is(pg_temp.verdict(pg_temp.sub('e5', 'p5', 'Your order total is 4,500 rupees.', 'order_status')), 'needs_approval/money', 'WAITS: an order status WITH an amount');
select is(pg_temp.verdict(pg_temp.sub('e6', 'p6', 'Thank you for writing to us. We will look into it.', 'reply_to_inbound')), 'needs_approval/complaint', 'WAITS: a reply to a customer who complained (the complaint is in THEIR message)');
select is(pg_temp.verdict(pg_temp.sub('e7', 'p7', 'We guarantee delivery by Friday.', 'followup')), 'needs_approval/commitment', 'WAITS: a new commitment');
select is(pg_temp.verdict(pg_temp.sub('e8', 'p8', 'Happy to help with your question.', 'reply_to_inbound', 'en', true)), 'needs_approval/model_flagged', 'WAITS: the model flagged it');
select is(pg_temp.verdict(pg_temp.sub('e9', 'p9', 'Hello, would you like to see our new collection?', 'followup')) in ('queued/auto_allowed', 'queued/quiet_hours'), true, 'AUTO: a follow-up without prices (consent is granted)');
select is(pg_temp.verdict(pg_temp.sub('e10', 'p9', 'Thanks for your reply.', 'reply_to_inbound')), 'needs_approval/no_inbound_window', 'WAITS: a "reply" with no inbound message in the last 24 hours');
select is(pg_temp.verdict(pg_temp.sub('e11', 'p10', 'Happy to help with your question.', 'reply_to_inbound', 'en', false, true)), 'needs_approval/uncertain', 'WAITS: the model is uncertain');
select is(pg_temp.verdict(pg_temp.sub('e12', 'p11', 'Happy to help with your question.', 'other')), 'needs_approval/category_other', 'DEFAULT: an uncategorised message waits');
select is(pg_temp.verdict(pg_temp.sub('e13', 'p12', 'Your visit is confirmed for Saturday at 4 pm.', 'visit')) in ('queued/auto_allowed', 'queued/quiet_hours'), true, 'AUTO: a visit confirmation');
-- the inbound is old: more than 24 hours ago
select pg_temp.mk('p13'); select pg_temp.inbound('p13', 'Hello', interval '30 hours');
select is(pg_temp.verdict(pg_temp.sub('e14', 'p13', 'Thanks for writing to us.', 'reply_to_inbound')), 'needs_approval/no_inbound_window', 'WAITS: the customer wrote 30 hours ago (outside the 24h window)');
-- the business has not switched auto-send on
select pg_temp.sc('a_owner', format($q$select public.outbox_set_settings(%L, false, 3)$q$, tests.tid('a')));
select pg_temp.mk('p14'); select pg_temp.inbound('p14', 'Hello');
select is(pg_temp.verdict(pg_temp.sub('e15', 'p14', 'Thanks for writing to us.', 'reply_to_inbound')), 'needs_approval/auto_off', 'WAITS: the business has auto-send switched off (its default)');
select pg_temp.sc('a_owner', format($q$select public.outbox_set_settings(%L, true, 3)$q$, tests.tid('a')));
-- the policy decision at an explicit instant: quiet hours queue until 09:00
select is((app.outbox_decide_content(tests.tid('a'), tests.rid('p1'), 'Thank you for writing.', 'info', false, false, '2026-10-10 22:00:00+05:30'::timestamptz)) ->> 'reason', 'quiet_hours', 'QUIET HOURS: 22:00 IST queues with reason quiet_hours');
select is((app.outbox_decide_content(tests.tid('a'), tests.rid('p1'), 'Thank you for writing.', 'info', false, false, '2026-10-10 22:00:00+05:30'::timestamptz)) ->> 'scheduled_for',
          to_char('2026-10-11 09:00:00+05:30'::timestamptz at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"+00:00"'), '...scheduled for the next 09:00 IST');
select is((app.outbox_decide_content(tests.tid('a'), tests.rid('p1'), 'Thank you for writing.', 'info', false, false, '2026-10-10 15:00:00+05:30'::timestamptz)) ->> 'reason', 'auto_allowed', 'daytime: auto_allowed');
select is((app.outbox_decide_content(tests.tid('a'), tests.rid('p1'), 'The price is 500 rupees', 'info', false, false, '2026-10-10 22:00:00+05:30'::timestamptz)) ->> 'status', 'needs_approval', 'a price at night still waits for a person (money beats the clock)');
-- the queued rows follow the clock the database used
select is((select count(*) from public.outbox_messages where id = tests.rid('e1') and ((reason = 'quiet_hours') = app.outbox_in_quiet_hours(created_at)) and (scheduled_for >= created_at)), 1::bigint, 'a queued row is scheduled at or after its creation, and is quiet_hours exactly in quiet hours');

-- ---------------------------------------------------------------------------------------------
-- F. the hard blocks
-- ---------------------------------------------------------------------------------------------
-- no opt-in: consent unknown and the customer never wrote to us
select pg_temp.mk('h1', false);
select is(pg_temp.verdict(pg_temp.sub('f1', 'h1', 'Hello, would you like to see our new collection?', 'followup')), 'blocked/no_opt_in', 'BLOCKED: no opt-in and no contact history');
-- consent unknown but the customer wrote to us first: contact history is enough
select pg_temp.mk('h2', false); select pg_temp.inbound('h2', 'Hello, do you have silk sarees?');
select is(pg_temp.verdict(pg_temp.sub('f2', 'h2', 'Yes, we have silk sarees in stock.', 'reply_to_inbound')) in ('queued/auto_allowed', 'queued/quiet_hours'), true, 'ALLOWED: consent unknown but the customer wrote to us (contact history)');
-- no phone number
select pg_temp.mk('h3', true, false);
select is(pg_temp.verdict(pg_temp.sub('f3', 'h3', 'Hello, would you like to see our new collection?', 'followup')), 'blocked/no_phone', 'BLOCKED: the contact has no phone number');
-- a lead without a contact
insert into public.leads (id, tenant_id, company_id) values (tests.rid('h4'), tests.tid('a'), tests.rid('a_company'));
select is(pg_temp.verdict(pg_temp.sub('f4', 'h4', 'Hello, would you like to see our new collection?', 'followup')), 'blocked/no_contact', 'BLOCKED: the lead has no contact');
-- STOP: the contact is suppressed (opted out)
select pg_temp.mk('s1'); select pg_temp.inbound('s1', 'Hello');
select is(pg_temp.verdict(pg_temp.sub('f5', 's1', 'Thanks for writing to us.', 'reply_to_inbound')) in ('queued/auto_allowed', 'queued/quiet_hours'), true, 'before STOP: queued');
select is(pg_temp.verdict(pg_temp.sub('f5b', 's1', 'The price is ₹500', 'reply_to_inbound')), 'needs_approval/money', 'before STOP: a priced message waits');
select pg_temp.sc('a_sales', format($q$select public.suppress_contact(%L, %L, 'opted_out')$q$, tests.tid('a'), tests.rid('s1_c')));
select is(pg_temp.st('f5'), 'blocked/stopped', 'AFTER STOP: the message that was queued is blocked at once (stopped)');
select is(pg_temp.st('f5b'), 'blocked/stopped', '...and so is the one waiting for approval');
select is(pg_temp.verdict(pg_temp.sub('f6', 's1', 'Thanks for writing to us.', 'reply_to_inbound')), 'blocked/stopped', 'AFTER STOP: a new message is blocked (stopped)');
select is(pg_temp.verdict(pg_temp.sub('f6b', 's1', 'The price is ₹500', 'reply_to_inbound')), 'blocked/stopped', 'AFTER STOP: even a message a person would approve is blocked');
select is(pg_temp.priv(format($q$update public.outbox_messages set status = 'queued' where id = %L$q$, tests.rid('f5'))), '42501', 'a blocked message cannot be revived');
-- WhatsApp consent withdrawn (not a full suppression) also stops
select pg_temp.mk('s2'); select pg_temp.inbound('s2', 'Hello');
select pg_temp.sc('a_owner', format($q$select public.record_consent(%L, %L, 'whatsapp', 'withdrawn', 'explicit_consent', 'web_form', 'form:stop')$q$, tests.tid('a'), tests.rid('s2_c')));
select is(pg_temp.verdict(pg_temp.sub('f7', 's2', 'Thanks for writing to us.', 'reply_to_inbound')), 'blocked/stopped', 'BLOCKED: WhatsApp consent was withdrawn (stopped)');
-- the phone has no suppression key on record: fail closed (ADR 0020), whatever the consent says
select pg_temp.mk('s4', true, true, false);
select is(pg_temp.verdict(pg_temp.sub('f9', 's4', 'Hello, would you like to see our new collection?', 'followup')), 'blocked/no_key', 'BLOCKED: the phone has no suppression key on record (no_key)');
-- a suppression KEY hit: the same number is on record as suppressed under another contact
select pg_temp.mk('s3');
select pg_temp.mk('s5');
select pg_temp.sc('a_owner', format($q$select public.record_contact_keys(%L, %L::jsonb)$q$, tests.rid('s5_c'), jsonb_build_object('version', 1, 'phone', pg_temp.h('s3_p'))::text));
select pg_temp.sc('a_owner', format($q$select public.suppress_contact(%L, %L, 'opted_out')$q$, tests.tid('a'), tests.rid('s5_c')));
select is(pg_temp.verdict(pg_temp.sub('f8', 's3', 'Hello again', 'followup')), 'blocked/stopped', 'BLOCKED: the number''s suppression key is suppressed under another record of the same number (stopped)');
-- the per-customer daily limit (3): the fourth queued message today is blocked
select pg_temp.mk('l1');
select is(pg_temp.verdict(pg_temp.sub('g1', 'l1', 'Hello, would you like to see our new collection?', 'followup')) like 'queued/%', true, 'limit: message 1 is queued');
select is(pg_temp.verdict(pg_temp.sub('g2', 'l1', 'We have new arrivals this week.', 'followup')) like 'queued/%', true, 'limit: message 2 is queued');
select is(pg_temp.verdict(pg_temp.sub('g3', 'l1', 'Our shop is open every day.', 'info')) like 'queued/%', true, 'limit: message 3 is queued');
select is(pg_temp.verdict(pg_temp.sub('g4', 'l1', 'Do visit us this weekend.', 'info')), 'blocked/daily_limit', 'BLOCKED: the 4th message to the same customer today (daily_limit)');
select is(pg_temp.verdict(pg_temp.sub('g5', 'l1', 'The price is ₹500', 'info')), 'blocked/daily_limit', 'BLOCKED: and a priced message does not get round the limit');
select pg_temp.sc('a_owner', format($q$select public.outbox_set_settings(%L, true, 4)$q$, tests.tid('a')));
select is(pg_temp.verdict(pg_temp.sub('g6', 'l1', 'Do visit us this weekend, we love guests.', 'info')) like 'queued/%', true, 'the Owner raises the limit to 4: the next message goes');
select pg_temp.sc('a_owner', format($q$select public.outbox_set_settings(%L, true, 3)$q$, tests.tid('a')));
select pg_temp.mk('l2');
select is(pg_temp.verdict(pg_temp.sub('g7', 'l2', 'Hello, would you like to see our new collection?', 'followup')) like 'queued/%', true, 'another customer is not affected by the first one''s limit');

-- ---------------------------------------------------------------------------------------------
-- G. the disclosure line: the first message to a customer, in their language
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('di1');
select pg_temp.mk('di2'); select pg_temp.mk('di3'); select pg_temp.mk('di4'); select pg_temp.mk('di5');
select pg_temp.sub('di_a', 'di1', 'Welcome to our shop. We have new silk sarees.', 'followup');
select is((select disclosure_added from public.outbox_messages where id = tests.rid('di_a')), true, 'the first message carries the disclosure');
select is((select position(app.outbox_disclosure('en') in body) > 0 from public.outbox_messages where id = tests.rid('di_a')), true, '...in English');
select pg_temp.sub('di_b', 'di1', 'We are open every day from 10 am.', 'info');
select is((select disclosure_added from public.outbox_messages where id = tests.rid('di_b')), false, 'the second message does not repeat it');
select is((select body from public.outbox_messages where id = tests.rid('di_b')), 'We are open every day from 10 am.', '...and the text is exactly what was sent in');
select pg_temp.sub('di_c', 'di2', 'మా కొత్త పట్టు చీరలు చూడండి.', 'followup', 'te');
select is((select position(app.outbox_disclosure('te') in body) > 0 from public.outbox_messages where id = tests.rid('di_c')), true, 'the first message to a Telugu customer carries the Telugu line');
select pg_temp.sub('di_d', 'di3', 'हमारी नई रेशमी साड़ियां देखिए।', 'followup', 'hi');
select is((select position(app.outbox_disclosure('hi') in body) > 0 from public.outbox_messages where id = tests.rid('di_d')), true, 'Hindi');
select pg_temp.sub('di_e', 'di4', 'ನಮ್ಮ ಹೊಸ ರೇಷ್ಮೆ ಸೀರೆಗಳನ್ನು ನೋಡಿ.', 'followup', 'kn');
select is((select position(app.outbox_disclosure('kn') in body) > 0 from public.outbox_messages where id = tests.rid('di_e')), true, 'Kannada');
select pg_temp.sub('di_f', 'di5', 'எங்கள் புதிய பட்டுப் புடவைகளைப் பாருங்கள்.', 'followup', 'ta');
select is((select position(app.outbox_disclosure('ta') in body) > 0 from public.outbox_messages where id = tests.rid('di_f')), true, 'Tamil');
-- a held first message keeps its disclosure through an edit, and a second message while it waits does not repeat it
select pg_temp.mk('di6');
select pg_temp.sub('di_g', 'di6', 'Our price list: ₹500 for the basic range.', 'followup');
select is(pg_temp.st('di_g'), 'needs_approval/money', 'a first message that waits for approval...');
select is((select disclosure_added from public.outbox_messages where id = tests.rid('di_g')), true, '...already carries the disclosure');
select pg_temp.sub('di_h', 'di6', 'Visit us on Saturday.', 'visit');
select is((select disclosure_added from public.outbox_messages where id = tests.rid('di_h')), false, 'a second message while the first waits does not repeat it');
-- a first message that is BLOCKED does not use up "first"
select pg_temp.mk('di7', false);
select pg_temp.sub('di_i', 'di7', 'Hello, would you like to see our new collection?', 'followup');
select is(pg_temp.st('di_i'), 'blocked/no_opt_in', 'a first message to someone with no opt-in is blocked');
select pg_temp.sc('a_owner', format($q$select public.record_consent(%L, %L, 'whatsapp', 'granted', 'explicit_consent', 'web_form', 'form:later')$q$, tests.tid('a'), tests.rid('di7_c')));
select pg_temp.sub('di_j', 'di7', 'Hello again, would you like to see our new collection?', 'followup');
select is((select disclosure_added from public.outbox_messages where id = tests.rid('di_j')), true, '...so the first message that really goes still carries the disclosure');

-- ---------------------------------------------------------------------------------------------
-- H. idempotency
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('i1');
select is(pg_temp.j(pg_temp.sub('ia', 'i1', 'Hello, would you like to see our new collection?', 'followup'), 'replayed'), 'false', 'the first submit is new');
select is(pg_temp.j(pg_temp.sub('ia', 'i1', 'Hello, would you like to see our new collection?', 'followup'), 'replayed'), 'true', 'the same message again replays');
select is((select count(*) from public.outbox_messages where id = tests.rid('ia')), 1::bigint, '...it made no second row');
select is(pg_temp.sub('ia', 'i1', 'Something else entirely', 'followup'), 'ERR:23505', 'the same id with other words: 23505');
select is(pg_temp.sub('ia', 'i1', 'Hello, would you like to see our new collection?', 'info'), 'ERR:23505', 'the same id with another category: 23505');
select is(pg_temp.sub('ia', 'i1', 'Hello, would you like to see our new collection?', 'followup', 'en', true), 'ERR:23505', 'the same id with a different model flag: 23505');
select is(pg_temp.sc('b_owner', format($q$select public.outbox_submit(%L, %L, %L, 'whatsapp', 'Hello, would you like to see our new collection?', 'en', 'followup')$q$, tests.rid('ia'), tests.tid('b'), tests.rid('b_lead'))), 'ERR:23505',
          'another business cannot take over the id (23505, no content revealed)');

-- ---------------------------------------------------------------------------------------------
-- I. roles and assurance
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('r1'); select pg_temp.mk('r2'); select pg_temp.mk('r3');
select is(pg_temp.verdict(pg_temp.sub('ra', 'r1', 'Hello, would you like to see our new collection?', 'followup', 'en', false, false, 'a_admin')) like 'queued/%', true, 'ALLOW: an Admin may submit');
select is(pg_temp.verdict(pg_temp.sub('rb', 'r2', 'Hello, would you like to see our new collection?', 'followup', 'en', false, false, 'a_sales')) like 'queued/%', true, 'ALLOW: Sales may submit');
select is(pg_temp.sub('rc', 'r3', 'Hello there', 'followup', 'en', false, false, 'a_viewer'), 'ERR:42501', 'DENY: a Viewer');
select is(pg_temp.sub('rd', 'r3', 'Hello there', 'followup', 'en', false, false, 'outsider'), 'ERR:42501', 'DENY: a stranger');
select is(pg_temp.sub('re', 'r3', 'Hello there', 'followup', 'en', false, false, 'b_owner'), 'ERR:42501', 'DENY: the owner of another business');
select is(tests.sqlstate_as(null, format($q$select public.outbox_submit(%L, %L, %L, 'whatsapp', 'Hello there', 'en', 'followup')$q$, tests.rid('rf'), tests.tid('a'), tests.rid('r3'))), '42501', 'DENY: no identity');
select is(pg_temp.sc('a_owner', format($q$select public.outbox_submit(%L, %L, %L, 'whatsapp', 'Hello there', 'en', 'followup')$q$, tests.rid('rg'), tests.tid('a'), tests.rid('b_lead'))), 'ERR:23503', 'DENY: a lead of another business is an unknown reference (23503)');
select is(pg_temp.sub('rh', 'r3', 'x', 'followup'), 'ERR:22023', 'INVALID: a one-character text');
select is(pg_temp.sub('rh', 'r3', repeat('x', 3001), 'followup'), 'ERR:22023', 'INVALID: a text over 3000 characters');
select is(pg_temp.sub('rh', 'r3', 'Hello there', 'sms'), 'ERR:22023', 'INVALID: an unknown category');
select is(pg_temp.sc('a_owner', format($q$select public.outbox_submit(%L, %L, %L, 'sms', 'Hello there', 'en', 'followup')$q$, tests.rid('rh'), tests.tid('a'), tests.rid('r3'))), 'ERR:22023', 'INVALID: a channel other than whatsapp (nothing else exists yet)');
select is(pg_temp.sub('rh', 'r3', 'Hello there', 'followup', 'fr'), 'ERR:22023', 'INVALID: an unknown language');
select is(pg_temp.sc('a_owner', format($q$select public.outbox_submit(%L, %L, %L, 'whatsapp', 'Hello there ' || U&'\200B', 'en', 'followup')$q$, tests.rid('rh'), tests.tid('a'), tests.rid('r3'))), 'ERR:22023', 'INVALID: a hidden character in the text');
select is((select count(*) from public.outbox_messages where id = tests.rid('rh')), 0::bigint, 'none of the invalid ones stored anything');
select is((select count(*) from public.outbox_messages where created_by = tests.uid('a_owner') and tenant_id = tests.tid('a')) > 0, true, 'the submitter is recorded from the token');
-- reading: Owner, Admin, Sales; never a Viewer, a stranger or another business
select is(tests.rows_as(tests.uid('a_sales'), 'select 1 from public.outbox_messages') > 0, true, 'READ: Sales sees the outbox');
select is(tests.rows_as(tests.uid('a_viewer'), 'select 1 from public.outbox_messages'), 0::bigint, 'READ: a Viewer sees none of it');
select is(tests.rows_as(tests.uid('b_owner'), 'select 1 from public.outbox_messages'), 0::bigint, 'READ: another business sees none of it');
select is(tests.rows_as(tests.uid('a_admin'), 'select 1 from public.outbox_settings') > 0, true, 'READ: an Admin sees the settings');

-- ---------------------------------------------------------------------------------------------
-- J. edit / approve / reject
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('j1'); select pg_temp.inbound('j1', 'Hello');
select pg_temp.mk('j2'); select pg_temp.inbound('j2', 'Hello');
select pg_temp.mk('j3'); select pg_temp.inbound('j3', 'Hello');
select pg_temp.mk('j4'); select pg_temp.inbound('j4', 'Hello');
select pg_temp.sub('ja', 'j1', 'The price is ₹500 each', 'reply_to_inbound');
select pg_temp.sub('jb', 'j2', 'The price is ₹600 each', 'reply_to_inbound');
select pg_temp.sub('jc', 'j3', 'The price is ₹700 each', 'reply_to_inbound');
select pg_temp.sub('jd', 'j4', 'Thanks for writing to us.', 'reply_to_inbound');
select is(pg_temp.st('ja'), 'needs_approval/money', 'four messages wait or go (j1..j3 wait)');
-- edit
select is(pg_temp.sc('a_admin', format($q$select public.outbox_edit(%L, %L, 'The price is ₹450 each, see you soon')$q$, tests.tid('a'), tests.rid('ja')))::jsonb ->> 'status', 'needs_approval', 'EDIT: an Admin edits a message that waits');
select is((select body like '%₹450%' from public.outbox_messages where id = tests.rid('ja')), true, '...and the new words are stored');
select is((select disclosure_added and position(app.outbox_disclosure('en') in body) > 0 from public.outbox_messages where id = tests.rid('ja')), true, '...and the disclosure line stays in the edited first message');
select is((select edited_by from public.outbox_messages where id = tests.rid('ja')), tests.uid('a_admin'), '...the editor is recorded');
select is(pg_temp.sc('a_sales', format($q$select public.outbox_edit(%L, %L, 'Sales cannot edit')$q$, tests.tid('a'), tests.rid('ja'))), 'ERR:42501', 'DENY: Sales cannot edit');
select is(pg_temp.sc('a_viewer', format($q$select public.outbox_edit(%L, %L, 'Viewer cannot edit')$q$, tests.tid('a'), tests.rid('ja'))), 'ERR:42501', 'DENY: a Viewer cannot edit');
select is(pg_temp.sc('b_owner', format($q$select public.outbox_edit(%L, %L, 'Other business')$q$, tests.tid('b'), tests.rid('ja'))), 'ERR:23503', 'another business''s Owner finds no such message (23503)');
select is(pg_temp.sc('a_owner', format($q$select public.outbox_edit(%L, %L, 'x')$q$, tests.tid('a'), tests.rid('ja'))), 'ERR:22023', 'INVALID: a one-character edit');
select is(pg_temp.sc('a_owner', format($q$select public.outbox_edit(%L, %L, 'Cannot edit a queued message')$q$, tests.tid('a'), tests.rid('jd'))), 'ERR:SM501', 'STATE: a message that is already queued cannot be edited (SM501)');
-- approve
select is(pg_temp.sc('a_sales', format($q$select public.outbox_decide(%L, %L, 'approve')$q$, tests.tid('a'), tests.rid('ja'))), 'ERR:42501', 'DENY: Sales cannot approve');
select is(pg_temp.sc('a_viewer', format($q$select public.outbox_decide(%L, %L, 'approve')$q$, tests.tid('a'), tests.rid('ja'))), 'ERR:42501', 'DENY: a Viewer cannot approve');
select is(pg_temp.sc('a_admin', format($q$select public.outbox_decide(%L, %L, 'approve')$q$, tests.tid('a'), tests.rid('ja')), 'aal1'), 'ERR:SM306', 'DENY: approving needs a second factor (SM306)');
select is(pg_temp.st('ja'), 'needs_approval/money', '...and nothing changed');
select is(pg_temp.sc('a_admin', format($q$select public.outbox_decide(%L, %L, 'maybe')$q$, tests.tid('a'), tests.rid('ja'))), 'ERR:22023', 'INVALID: an unknown decision');
select is(pg_temp.verdict(pg_temp.sc('a_admin', format($q$select public.outbox_decide(%L, %L, 'approve')$q$, tests.tid('a'), tests.rid('ja')))), 'queued/owner_approved', 'APPROVE: an Admin with a second factor approves the priced message: queued (owner_approved)');
select is((select decided_by from public.outbox_messages where id = tests.rid('ja')), tests.uid('a_admin'), '...the approver is the person the token proved');
select ok((select scheduled_for >= decided_at and (not app.outbox_in_quiet_hours(decided_at) or scheduled_for > decided_at) from public.outbox_messages where id = tests.rid('ja')), '...scheduled at once, or at 09:00 India time in quiet hours');
select is(pg_temp.sc('a_admin', format($q$select public.outbox_decide(%L, %L, 'approve')$q$, tests.tid('a'), tests.rid('ja'))), 'ERR:SM501', 'STATE: approving twice is refused (SM501)');
select is(pg_temp.sc('a_owner', format($q$select public.outbox_edit(%L, %L, 'Too late to edit')$q$, tests.tid('a'), tests.rid('ja'))), 'ERR:SM501', 'STATE: an approved message cannot be edited any more');
-- reject
select is(pg_temp.verdict(pg_temp.sc('a_owner', format($q$select public.outbox_decide(%L, %L, 'reject')$q$, tests.tid('a'), tests.rid('jb')), 'aal1')), 'blocked/owner_rejected', 'REJECT: needs no second factor; the message is blocked (owner_rejected)');
select is(pg_temp.sc('a_owner', format($q$select public.outbox_decide(%L, %L, 'approve')$q$, tests.tid('a'), tests.rid('jb'))), 'ERR:SM501', 'STATE: a rejected message cannot be approved');
-- the hard blocks again at approval: STOP between the hold and the approval
select pg_temp.sc('a_sales', format($q$select public.suppress_contact(%L, %L, 'opted_out')$q$, tests.tid('a'), tests.rid('j3_c')));
select is(pg_temp.st('jc'), 'blocked/stopped', 'STOP while a message waits blocks it at once');
select is(pg_temp.sc('a_owner', format($q$select public.outbox_decide(%L, %L, 'approve')$q$, tests.tid('a'), tests.rid('jc'))), 'ERR:SM501', '...so it cannot be approved any more (SM501)');
-- the kill switch at approval: approval of a waiting message while the switch is off blocks it
select pg_temp.mk('j5'); select pg_temp.inbound('j5', 'Hello');
select pg_temp.sub('je', 'j5', 'The price is ₹800 each', 'reply_to_inbound');
update public.platform_flags set enabled = false where key = 'outbox_enabled';
select is(pg_temp.verdict(pg_temp.sc('a_owner', format($q$select public.outbox_decide(%L, %L, 'approve')$q$, tests.tid('a'), tests.rid('je')))), 'blocked/switch_off', 'KILL SWITCH: approving while the switch is off blocks the message (switch_off)');
update public.platform_flags set enabled = true where key = 'outbox_enabled';

-- ---------------------------------------------------------------------------------------------
-- K. dispatch: claim, mark, re-checks
-- ---------------------------------------------------------------------------------------------
-- (clear the way: close every queued message of the earlier sections, so the claims below see only their own)
update public.outbox_messages set scheduled_for = now() + interval '30 days' where tenant_id = tests.tid('a') and status = 'queued' and id not in (tests.rid('ja'), tests.rid('jd'));
select pg_temp.mk('k2'); select pg_temp.inbound('k2', 'Hello');
select pg_temp.mk('k3'); select pg_temp.inbound('k3', 'Hello');
select pg_temp.sub('ka', 'k2', 'Thanks for writing to us.', 'reply_to_inbound');
select pg_temp.sub('kb', 'k3', 'Thanks for writing to us.', 'reply_to_inbound');
update public.outbox_messages set scheduled_for = now() - interval '1 minute' where id in (tests.rid('ka'), tests.rid('kb'), tests.rid('ja'), tests.rid('jd'));
-- quiet hours at claim time cannot be faked from here; assert the other behaviours when it is daytime and the shape when it is not
select is(pg_temp.sc('a_sales', format($q$select public.outbox_claim_due(%L, 10)$q$, tests.tid('a'))), 'ERR:42501', 'DENY: Sales cannot dispatch');
select is(pg_temp.sc('a_viewer', format($q$select public.outbox_claim_due(%L, 10)$q$, tests.tid('a'))), 'ERR:42501', 'DENY: a Viewer cannot dispatch');
select is(pg_temp.sc('a_owner', format($q$select public.outbox_claim_due(%L, 0)$q$, tests.tid('a'))), 'ERR:22023', 'INVALID: a limit of 0');
update public.platform_flags set enabled = false where key = 'outbox_enabled';
select is(pg_temp.sc('a_owner', format($q$select public.outbox_claim_due(%L, 10)$q$, tests.tid('a'))), '[]', 'KILL SWITCH: while it is off nothing is claimed...');
select is((select count(*) from public.outbox_messages where id in (tests.rid('ka'), tests.rid('kb')) and status = 'queued' and claimed_at is null), 2::bigint, '...and the queue waits unchanged');
update public.platform_flags set enabled = true where key = 'outbox_enabled';
create temp table claimed as select pg_temp.sc('a_owner', format($q$select public.outbox_claim_due(%L, 10)$q$, tests.tid('a')))::jsonb as j;
select ok((select case when app.outbox_in_quiet_hours(now()) then jsonb_array_length(j) = 0 else jsonb_array_length(j) >= 2 end from claimed), 'CLAIM: due messages are returned (none during quiet hours: they are pushed to 09:00)');
select ok((select case when app.outbox_in_quiet_hours(now()) then true else (j -> 0) ?& array['id', 'lead_id', 'contact_id', 'phone', 'body', 'language'] end from claimed), 'a claim carries what the adapter needs: id, lead, contact, phone, body, language');
select ok((select case when app.outbox_in_quiet_hours(now()) then (select scheduled_for > now() from public.outbox_messages where id = tests.rid('ka'))
                       else (select claimed_at is not null and attempts = 1 from public.outbox_messages where id = tests.rid('ka')) end), 'a claimed message is marked claimed (attempt 1); in quiet hours it was rescheduled instead');
select ok((select case when app.outbox_in_quiet_hours(now()) then true else jsonb_array_length(pg_temp.sc('a_owner', format($q$select public.outbox_claim_due(%L, 10)$q$, tests.tid('a')))::jsonb) = 0 end), 'a second claim right away returns nothing: claimed messages are not handed out twice');
-- mark (needs a claim; forced here so it runs at any hour)
update public.outbox_messages set claimed_at = now(), attempts = 1 where id in (tests.rid('ka'), tests.rid('kb'));
select is(pg_temp.sc('a_sales', format($q$select public.outbox_mark(%L, %L, 'sent', 'fake', 'fake-1')$q$, tests.tid('a'), tests.rid('ka'))), 'ERR:42501', 'DENY: Sales cannot mark');
select is(pg_temp.sc('a_owner', format($q$select public.outbox_mark(%L, %L, 'sent', 'twilio', 'x-1')$q$, tests.tid('a'), tests.rid('ka'))), 'ERR:22023', 'INVALID: only the fake adapter exists');
select is(pg_temp.sc('a_owner', format($q$select public.outbox_mark(%L, %L, 'sent', 'fake')$q$, tests.tid('a'), tests.rid('ka'))), 'ERR:22023', 'INVALID: sent needs the adapter''s message id');
select is(pg_temp.sc('a_owner', format($q$select public.outbox_mark(%L, %L, 'failed', 'fake', null, 'oops')$q$, tests.tid('a'), tests.rid('ka'))), 'ERR:22023', 'INVALID: an unknown failure code');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.outbox_mark(%L, %L, 'sent', 'fake', 'fake-ka')$q$, tests.tid('a'), tests.rid('ka'))), 'status'), 'sent', 'MARK: sent');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.outbox_mark(%L, %L, 'sent', 'fake', 'fake-ka')$q$, tests.tid('a'), tests.rid('ka'))), 'replayed'), 'true', 'MARK: the same outcome again changes nothing');
select is((select sent_at is not null and adapter = 'fake' and adapter_message_id = 'fake-ka' from public.outbox_messages where id = tests.rid('ka')), true, '...with the time and the adapter''s id');
select is(pg_temp.sc('a_owner', format($q$select public.outbox_mark(%L, %L, 'failed', 'fake', null, 'timeout')$q$, tests.tid('a'), tests.rid('ka'))), 'ERR:SM501', 'STATE: a sent message cannot be marked failed');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.outbox_mark(%L, %L, 'failed', 'fake', null, 'timeout')$q$, tests.tid('a'), tests.rid('kb'))), 'reason'), 'send_failed', 'MARK: failed (send_failed)');
select is((select failure_code from public.outbox_messages where id = tests.rid('kb')), 'timeout', '...with its closed code');
select is(pg_temp.sc('a_owner', format($q$select public.outbox_mark(%L, %L, 'sent', 'fake', 'fake-x')$q$, tests.tid('a'), tests.rid('jd'))), 'ERR:SM501', 'STATE: a message nobody claimed cannot be marked');
-- the re-check at claim: STOP after queueing blocks the message instead of handing it out
select pg_temp.mk('k4'); select pg_temp.inbound('k4', 'Hello');
select pg_temp.sub('kc', 'k4', 'Thanks for writing to us.', 'reply_to_inbound');
update public.outbox_messages set scheduled_for = now() - interval '1 minute' where id = tests.rid('kc');
update public.contacts set suppressed_at = now(), suppression_reason = 'opted_out' where id = tests.rid('k4_c');  -- a privileged edit that does not pass through the contact functions
select ok(pg_temp.st('kc') = 'blocked/stopped', 'a STOP written even outside the consent functions still blocks the queued message (trigger)');
-- the state machine: nothing moves backwards or sideways
select is(pg_temp.priv(format($q$update public.outbox_messages set status = 'queued' where id = %L$q$, tests.rid('ka'))), '42501', 'a sent message cannot go back to queued');
select is(pg_temp.priv(format($q$update public.outbox_messages set status = 'sent', sent_at = now(), adapter = 'fake', adapter_message_id = 'z' where id = %L$q$, tests.rid('jd'))), 'ok', 'queued -> sent is the legal move (privileged here)');
select is(pg_temp.priv(format($q$update public.outbox_messages set body = 'rewritten' where id = %L$q$, tests.rid('ka'))), '42501', 'the text of a sent message never changes');
select is(pg_temp.priv(format($q$update public.outbox_messages set status = 'needs_approval' where id = %L$q$, tests.rid('kb'))), '42501', 'a failed message does not go back to waiting');
select is(pg_temp.priv(format($q$update public.outbox_messages set lead_id = %L where id = %L$q$, tests.rid('a_lead'), tests.rid('ka'))), '42501', 'the lead of a message never changes');
select is(pg_temp.priv(format($q$update public.outbox_messages set category = 'info' where id = %L$q$, tests.rid('jd'))), '42501', 'the category never changes');
select is(pg_temp.priv(format($q$delete from public.outbox_messages where id = %L$q$, tests.rid('ka'))), '42501', 'a message is never deleted (not even by the owner of the database)');
select is(pg_temp.priv('truncate public.outbox_messages'), '42501', '...nor truncated');
select is(pg_temp.priv(format($q$insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, channel, body, language, category, status, reason, request_sha256, created_by, sent_at, adapter, adapter_message_id)
                                 values (gen_random_uuid(), %L, %L, %L, 'whatsapp', 'forged as sent', 'en', 'info', 'sent', 'auto_allowed', repeat('a', 64), %L, now(), 'fake', 'f')$q$,
                 tests.tid('a'), tests.rid('a_lead'), tests.rid('a_contact'), tests.uid('a_owner'))), '42501', 'a row cannot be inserted already sent');

-- ---------------------------------------------------------------------------------------------
-- L. direct writes by clients
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.try('a_owner', format($q$insert into public.outbox_messages (id, tenant_id, lead_id, channel, body, language, category, status, reason, request_sha256, created_by)
                                          values (gen_random_uuid(), %L, %L, 'whatsapp', 'direct', 'en', 'info', 'queued', 'auto_allowed', repeat('a', 64), %L)$q$, tests.tid('a'), tests.rid('a_lead'), tests.uid('a_owner'))), '42501', 'DENY: even the Owner cannot insert a message directly');
select is(pg_temp.try('a_owner', format($q$update public.outbox_messages set status = 'sent' where id = %L$q$, tests.rid('jd'))), '42501', 'DENY: nor update one');
select is(pg_temp.try('a_owner', format($q$delete from public.outbox_messages where id = %L$q$, tests.rid('jd'))), '42501', 'DENY: nor delete one');
select is(pg_temp.try('a_owner', format($q$update public.outbox_settings set auto_send_enabled = true where tenant_id = %L$q$, tests.tid('a'))), '42501', 'DENY: nor change the settings directly');
select is(pg_temp.try('a_owner', format($q$insert into public.call_requests (id, tenant_id, lead_id, contact_id, reason, script_draft, language, request_sha256, requested_by)
                                          values (gen_random_uuid(), %L, %L, %L, 'a reason', 'a script', 'en', repeat('a', 64), %L)$q$, tests.tid('a'), tests.rid('a_lead'), tests.rid('a_contact'), tests.uid('a_owner'))), '42501', 'DENY: nor a call request directly');
select is(pg_temp.sc('a_admin', format($q$select public.outbox_set_settings(%L, true, 3)$q$, tests.tid('a'))), 'ERR:42501', 'DENY: an Admin cannot change the settings (Owner only)');
select is(pg_temp.sc('a_owner', format($q$select public.outbox_set_settings(%L, true, 3)$q$, tests.tid('a')), 'aal1'), 'ERR:SM306', 'DENY: the Owner needs a second factor for the settings');
select is(pg_temp.sc('a_owner', format($q$select public.outbox_set_settings(%L, true, 21)$q$, tests.tid('a'))), 'ERR:22023', 'INVALID: a limit of 21');
select is(pg_temp.sc('a_owner', format($q$select public.outbox_set_settings(%L, true, 0)$q$, tests.tid('a'))), 'ERR:22023', 'INVALID: a limit of 0');
select is(pg_temp.j(pg_temp.sc('a_admin', format($q$select public.outbox_settings_get(%L)$q$, tests.tid('a'))), 'platform_switch_on'), 'true', 'READ: an Admin reads the settings and the global switch');
select is(pg_temp.sc('a_sales', format($q$select public.outbox_settings_get(%L)$q$, tests.tid('a'))), 'ERR:42501', 'DENY: Sales does not read the settings function');

-- ---------------------------------------------------------------------------------------------
-- M. call requests: only the Owner approves; nothing dials
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('c1'); select pg_temp.mk('c2'); select pg_temp.mk('c3', true, false);
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.call_request_create(%L, %L, %L, 'The customer asked for a call about a large order', 'Hello, this is the shop calling about your enquiry.', 'en')$q$,
          tests.rid('cr1'), tests.tid('a'), tests.rid('c1'))), 'status'), 'requested', 'REQUEST: Sales asks for a call; it is only a request');
select is(pg_temp.j(pg_temp.sc('a_sales', format($q$select public.call_request_create(%L, %L, %L, 'The customer asked for a call about a large order', 'Hello, this is the shop calling about your enquiry.', 'en')$q$,
          tests.rid('cr1'), tests.tid('a'), tests.rid('c1'))), 'replayed'), 'true', 'REQUEST: a retry replays');
select is(pg_temp.sc('a_sales', format($q$select public.call_request_create(%L, %L, %L, 'A different reason', 'Hello, this is the shop calling about your enquiry.', 'en')$q$,
          tests.rid('cr1'), tests.tid('a'), tests.rid('c1'))), 'ERR:23505', 'REQUEST: other words under the same id: 23505');
select is(pg_temp.sc('a_viewer', format($q$select public.call_request_create(%L, %L, %L, 'A reason', 'A script', 'en')$q$, tests.rid('cr2'), tests.tid('a'), tests.rid('c1'))), 'ERR:42501', 'DENY: a Viewer cannot ask for a call');
select is(pg_temp.sc('b_owner', format($q$select public.call_request_create(%L, %L, %L, 'A reason', 'A script', 'en')$q$, tests.rid('cr2'), tests.tid('a'), tests.rid('c1'))), 'ERR:42501', 'DENY: another business cannot');
select is(pg_temp.sc('a_owner', format($q$select public.call_request_create(%L, %L, %L, 'A reason', 'A script', 'en')$q$, tests.rid('cr2'), tests.tid('a'), tests.rid('b_lead'))), 'ERR:23503', 'a lead of another business: 23503');
select is(pg_temp.sc('a_owner', format($q$select public.call_request_create(%L, %L, %L, 'A reason', 'A script', 'en')$q$, tests.rid('cr2'), tests.tid('a'), tests.rid('c3'))), 'ERR:22023', 'INVALID: a contact with no phone number');
select is(pg_temp.sc('a_owner', format($q$select public.call_request_create(%L, %L, %L, 'x', 'A script', 'en')$q$, tests.rid('cr2'), tests.tid('a'), tests.rid('c1'))), 'ERR:22023', 'INVALID: a one-character reason');
select is(pg_temp.sc('a_admin', format($q$select public.call_request_decide(%L, %L, 'approve')$q$, tests.tid('a'), tests.rid('cr1'))), 'ERR:42501', 'DENY: an Admin cannot approve a call (the Owner only)');
select is(pg_temp.sc('a_sales', format($q$select public.call_request_decide(%L, %L, 'approve')$q$, tests.tid('a'), tests.rid('cr1'))), 'ERR:42501', 'DENY: Sales cannot approve a call');
select is(pg_temp.sc('a_owner', format($q$select public.call_request_decide(%L, %L, 'approve')$q$, tests.tid('a'), tests.rid('cr1')), 'aal1'), 'ERR:SM306', 'DENY: the Owner needs a second factor');
select is((select status from public.call_requests where id = tests.rid('cr1')), 'requested', '...and nothing changed');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.call_request_decide(%L, %L, 'approve', 'Go ahead, before noon')$q$, tests.tid('a'), tests.rid('cr1'))), 'status'), 'approved', 'APPROVE: the Owner with a second factor approves; it is recorded');
select is((select decided_by = tests.uid('a_owner') and decided_at is not null and decision_note = 'Go ahead, before noon' from public.call_requests where id = tests.rid('cr1')), true, '...who, when and the note');
select is(pg_temp.sc('a_owner', format($q$select public.call_request_decide(%L, %L, 'reject')$q$, tests.tid('a'), tests.rid('cr1'))), 'ERR:SM501', 'STATE: a decided call stays decided');
select is(pg_temp.priv(format($q$update public.call_requests set status = 'requested', decided_at = null, decided_by = null where id = %L$q$, tests.rid('cr1'))), '42501', '...even for the owner of the database');
select is(pg_temp.priv(format($q$update public.call_requests set script_draft = 'rewritten' where id = %L$q$, tests.rid('cr1'))), '42501', 'the script of a call request never changes');
select is(pg_temp.priv(format($q$delete from public.call_requests where id = %L$q$, tests.rid('cr1'))), '42501', 'a call request is never deleted');
select pg_temp.sc('a_owner', format($q$select public.call_request_create(%L, %L, %L, 'Follow-up call about the quote', 'Hello, calling about your quote.', 'en')$q$, tests.rid('cr3'), tests.tid('a'), tests.rid('c2')));
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.call_request_decide(%L, %L, 'reject', 'Not now')$q$, tests.tid('a'), tests.rid('cr3'))), 'status'), 'rejected', 'REJECT: the Owner rejects a call');
-- a customer who asked us to stop cannot be called
select pg_temp.mk('c4');
select pg_temp.sc('a_sales', format($q$select public.suppress_contact(%L, %L, 'opted_out')$q$, tests.tid('a'), tests.rid('c4_c')));
select is(pg_temp.sc('a_owner', format($q$select public.call_request_create(%L, %L, %L, 'A reason', 'A script', 'en')$q$, tests.rid('cr4'), tests.tid('a'), tests.rid('c4'))), 'ERR:SM502', 'STOPPED: no call request for a customer who asked us to stop (SM502)');
select pg_temp.mk('c5');
select pg_temp.sc('a_owner', format($q$select public.call_request_create(%L, %L, %L, 'A reason', 'A script', 'en')$q$, tests.rid('cr5'), tests.tid('a'), tests.rid('c5')));
select pg_temp.sc('a_sales', format($q$select public.suppress_contact(%L, %L, 'opted_out')$q$, tests.tid('a'), tests.rid('c5_c')));
select is(pg_temp.sc('a_owner', format($q$select public.call_request_decide(%L, %L, 'approve')$q$, tests.tid('a'), tests.rid('cr5'))), 'ERR:SM502', 'STOPPED: a pending request cannot be approved after the customer asked us to stop (SM502)');
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.call_request_decide(%L, %L, 'reject')$q$, tests.tid('a'), tests.rid('cr5'))), 'status'), 'rejected', '...it can still be rejected');
select is(tests.rows_as(tests.uid('a_viewer'), 'select 1 from public.call_requests'), 0::bigint, 'READ: a Viewer sees no call request');
select is(tests.rows_as(tests.uid('b_owner'), 'select 1 from public.call_requests'), 0::bigint, 'READ: another business sees none');

-- ---------------------------------------------------------------------------------------------
-- N. Today: what waits for the Owner and the Admin
-- ---------------------------------------------------------------------------------------------
select pg_temp.mk('t1'); select pg_temp.inbound('t1', 'Hello');
select pg_temp.sub('ta', 't1', 'The price is ₹900 each', 'reply_to_inbound');
select pg_temp.sc('a_owner', format($q$select public.call_request_create(%L, %L, %L, 'Call about a bulk order', 'Hello, calling about your bulk order.', 'en')$q$, tests.rid('cr6'), tests.tid('a'), tests.rid('t1')));
select ok((select count(*) from jsonb_array_elements(tests.scalar_as(tests.uid('a_owner'), format($q$select public.today_summary(%L)$q$, tests.tid('a')))::jsonb -> 'needs_you') x
            where x ->> 'kind' = 'outbox_approval' and x -> 'target' ->> 'type' = 'outbox_message') >= 1, 'TODAY: the Owner sees the messages that wait for approval');
select ok((select count(*) from jsonb_array_elements(tests.scalar_as(tests.uid('a_owner'), format($q$select public.today_summary(%L)$q$, tests.tid('a')))::jsonb -> 'needs_you') x
            where x ->> 'kind' = 'call_approval' and x -> 'target' ->> 'type' = 'call_request') = 1, 'TODAY: ...and the call request');
select ok((select count(*) from jsonb_array_elements(tests.scalar_as(tests.uid('a_admin'), format($q$select public.today_summary(%L)$q$, tests.tid('a')))::jsonb -> 'needs_you') x where x ->> 'kind' = 'outbox_approval') >= 1,
          'TODAY: an Admin sees the messages that wait');
select is((select count(*) from jsonb_array_elements(tests.scalar_as(tests.uid('a_admin'), format($q$select public.today_summary(%L)$q$, tests.tid('a')))::jsonb -> 'needs_you') x where x ->> 'kind' = 'call_approval'), 0::bigint,
          'TODAY: ...but not the call (the Owner decides calls)');
select is((select count(*) from jsonb_array_elements(tests.scalar_as(tests.uid('a_sales'), format($q$select public.today_summary(%L)$q$, tests.tid('a')))::jsonb -> 'needs_you') x where x ->> 'kind' in ('outbox_approval', 'call_approval')), 0::bigint,
          'TODAY: Sales sees neither');
select is((select count(*) from jsonb_array_elements(tests.scalar_as(tests.uid('b_owner'), format($q$select public.today_summary(%L)$q$, tests.tid('b')))::jsonb -> 'needs_you') x where x ->> 'kind' in ('outbox_approval', 'call_approval')), 0::bigint,
          'TODAY: another business sees none of it');
select is((tests.scalar_as(tests.uid('a_owner'), format($q$select public.today_summary(%L)$q$, tests.tid('a')))::jsonb -> 'cards' ->> 'waiting')::int,
          (select jsonb_array_length(tests.scalar_as(tests.uid('a_owner'), format($q$select public.today_summary(%L)$q$, tests.tid('a')))::jsonb -> 'needs_you')), 'TODAY: the card counts what the list shows (while the list is under its 20)');

-- ---------------------------------------------------------------------------------------------
-- O. the audit trail records that a message changed, never its text
-- ---------------------------------------------------------------------------------------------
select ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'outbox_message') > 0, 'every change of a message is audited');
select is((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type in ('outbox_message', 'call_request') and (old_values::text like '%₹%' or new_values::text like '%₹%' or old_values::text like '%shop calling%' or new_values::text like '%shop calling%')),
          0::bigint, 'the audit trail holds no message text and no call script');
select ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'call_request') > 0, 'every call request decision is audited');
select ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'outbox_settings') > 0, 'the settings changes are audited');

select * from finish();
rollback;
