-- T010 part 2: what ERASURE does to the follow-up tables (owner review 2026-10-07, question 5). Answered with tests, not statements.
--   A erasing ONE CONTACT: lead_touches and followup_drafts today (retained, unchanged, free of the person's data; open drafts discarded as `erased`; no new touch or draft)
--   B erasing the WHOLE WORKSPACE (erase_tenant) on a tenant holding policies, touches, drafts and question drafts: it finishes clean despite the append-only trigger, and what it leaves
-- All data is synthetic; keys are well-formed fakes.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();
select tests.as_aal('aal2');

create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
create function pg_temp.at(p_aal text, p_user text, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform tests.as_aal(p_aal);
  r := tests.error_full_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
  perform tests.as_aal('aal2');
  if r = 'ok' then return 'ok'; end if;
  return split_part(r, '|', 1) || case when split_part(r, '|', 3) <> '' then ':' || split_part(r, '|', 3) else '' end;
end $$;
create function pg_temp.try(p_user text, p_sql text) returns text language sql as $$ select pg_temp.at('aal2', p_user, p_sql) $$;
create function pg_temp.err(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.error_full_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql); end $$;
create function pg_temp.sc(p_user text, p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select (p_json::jsonb) ->> p_key $$;
create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.run(p_user text, p_sql text) returns void language plpgsql as $$
declare r text;
begin
  r := pg_temp.try(p_user, p_sql);
  if r <> 'ok' then raise exception 'fixture step failed (%): %', r, left(p_sql, 200); end if;
end $$;
create function pg_temp.today() returns date language sql as $$ select app.quote_today() $$;
create function pg_temp.asof(p_shift interval default '0') returns text language sql as $$ select to_char((now() + p_shift) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') $$;
create function pg_temp.noon_offset() returns integer language sql as $$
  select case when ((720 - (extract(hour from now() at time zone 'UTC')::int * 60 + extract(minute from now() at time zone 'UTC')::int) + 1440) % 1440) > 840
              then ((720 - (extract(hour from now() at time zone 'UTC')::int * 60 + extract(minute from now() at time zone 'UTC')::int) + 1440) % 1440) - 1440
              else ((720 - (extract(hour from now() at time zone 'UTC')::int * 60 + extract(minute from now() at time zone 'UTC')::int) + 1440) % 1440) end $$;
create function pg_temp.pol(p_gaps text default '[1, 2]', p_max int default 3, p_qs text default '03:00', p_qe text default '04:00', p_wd text default '[0, 1, 2, 3, 4, 5, 6]',
                            p_hol text default '[]', p_min int default 0, p_off int default null) returns text language sql as $$
  select jsonb_build_object('gap_days', p_gaps::jsonb, 'max_touches', p_max, 'quiet_hours', jsonb_build_object('start', p_qs, 'end', p_qe), 'allowed_weekdays', p_wd::jsonb,
                            'holidays', p_hol::jsonb, 'min_gap_hours', p_min, 'recipient_utc_offset_minutes', coalesce(p_off, pg_temp.noon_offset()))::text $$;
create function pg_temp.mkpol(p_label text, p_policy text default null, p_tenant text default 'a', p_from date default null, p_user text default 'a_owner') returns text language sql as $$
  select pg_temp.try(p_user, format('select public.create_followup_policy_version(%L, %L, %L, %L::jsonb)', tests.rid('pol_' || p_label), tests.tid(p_tenant),
                                    coalesce(p_from, pg_temp.today()), coalesce(p_policy, pg_temp.pol()))) $$;
create function pg_temp.polid(p_lead text) returns uuid language sql as $$ select app.followup_active_policy_version((select tenant_id from public.leads where id = tests.rid(p_lead)), pg_temp.today()) $$;
create function pg_temp.req(p_lead text, p_asof text default null) returns jsonb language sql as $$ select app.followup_build(tests.rid(p_lead), coalesce(p_asof, pg_temp.asof()), pg_temp.polid(p_lead)) $$;
create function pg_temp.res(p_req jsonb, p_ver text default '1.0.0', p_reqtext text default null) returns jsonb language sql as $$
  select jsonb_build_object('action', 'draft_followup', 'reason_code', 'eligible_now', 'terminal', false,
           'touch_number', (select count(*) + 1 from jsonb_array_elements(p_req -> 'history') h where h ->> 'direction' = 'out'), 'next_eligible_at', p_req ->> 'as_of',
           'engine_version', p_ver, 'canonical_hash', app.followup_request_hash(p_ver, coalesce(p_reqtext, p_req::text)), 'trace', '[]'::jsonb) $$;
create function pg_temp.cd(p_label text, p_lead text, p_channel text default 'email', p_req jsonb default null, p_res jsonb default null, p_ver text default '1.0.0', p_reqtext text default null)
returns text language plpgsql as $$
declare r jsonb := coalesce(p_req, pg_temp.req(p_lead));
begin
  return format('select public.create_followup_draft(%L, %L, %L, %L, %L, %L)', tests.rid('d_' || p_label), tests.rid(p_lead), p_channel, p_ver, coalesce(p_reqtext, r::text),
                coalesce(p_res, pg_temp.res(r, p_ver, p_reqtext))::text);
end $$;
create function pg_temp.mk(p_user text, p_label text, p_lead text, p_channel text default 'email') returns text language sql as $$
  select pg_temp.try(p_user, pg_temp.cd(p_label, p_lead, p_channel)) $$;
create function pg_temp.did(p_label text) returns uuid language sql as $$ select tests.rid('d_' || p_label) $$;
create function pg_temp.dst(p_label text) returns text language sql as $$ select status::text from public.followup_drafts where id = pg_temp.did(p_label) $$;
create function pg_temp.approve(p_user text, p_label text, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.at(p_aal, p_user, format('select public.approve_followup_draft(%L, %L)', pg_temp.did(p_label), (select state_hash from public.followup_drafts where id = pg_temp.did(p_label)))) $$;
create function pg_temp.sent(p_user text, p_label text, p_touch text default null) returns text language sql as $$
  select pg_temp.try(p_user, format('select public.record_draft_sent(%L, %L, null)', pg_temp.did(p_label), tests.rid('s_' || coalesce(p_touch, p_label)))) $$;
create function pg_temp.gate(p_lead text, p_channel text default 'email', p_user text default 'a_sales') returns jsonb language sql as $$ select pg_temp.sc(p_user, format('select public.followup_gate(%L, %L)', tests.rid(p_lead), p_channel))::jsonb $$;

-- a contact with its e-mail and phone, keyed, consented for e-mail and WhatsApp; one lead per label on that contact (created 30 days ago), tenant t
create function pg_temp.mkc(p_t text, p_label text) returns void language plpgsql as $$
begin
  insert into public.contacts (id, tenant_id, company_id, full_name, email, phone)
  values (tests.rid(p_label), tests.tid(p_t), tests.rid(p_t || '_company'), 'Zorro Quillfeather ' || p_label, p_label || '.quillfeather@example.test', '+00 9' || lpad((abs(hashtext(p_label)) % 100000)::text, 5, '0'));
  perform pg_temp.run(p_t || '_owner', format('select public.record_contact_keys(%L, %L::jsonb)', tests.rid(p_label),
          jsonb_build_object('version', 1, 'email', pg_temp.h(p_label || '_e'), 'phone', pg_temp.h(p_label || '_p'))));
  perform pg_temp.run(p_t || '_owner', format($q$select public.record_consent(%L, %L, 'email', 'granted', 'explicit_consent', 'web_form', %L)$q$, tests.tid(p_t), tests.rid(p_label), 'ref:' || p_label));
  perform pg_temp.run(p_t || '_owner', format($q$select public.record_consent(%L, %L, 'whatsapp', 'granted', 'explicit_consent', 'web_form', %L)$q$, tests.tid(p_t), tests.rid(p_label), 'refw:' || p_label));
end $$;
create function pg_temp.mkl(p_t text, p_label text, p_contact text) returns void language plpgsql as $$
begin
  insert into public.leads (id, tenant_id, company_id, contact_id, created_at) values (tests.rid(p_label), tests.tid(p_t), tests.rid(p_t || '_company'), tests.rid(p_contact), now() - interval '30 days');
  perform pg_temp.run(p_t || '_sales', format('select public.record_touch(%L, %L, ''out'', ''email'', %L)', tests.rid('t_' || p_label), tests.rid(p_label), (now() - interval '5 days')::text));
end $$;
-- the whole picture for tenant t: a policy; contact c1 with leads l1 (an OPEN draft), l2 (an APPROVED draft), l3 (a draft RECORDED as sent); contact c2 with l4 (an open draft that a reply then discards)
create function pg_temp.build(p_t text) returns void language plpgsql as $$
begin
  perform pg_temp.run(p_t || '_owner', format('select public.create_followup_policy_version(%L, %L, %L, %L::jsonb)', tests.rid('pol_' || p_t), tests.tid(p_t), pg_temp.today(), pg_temp.pol()));
  perform pg_temp.mkc(p_t, p_t || '_c1');
  perform pg_temp.mkc(p_t, p_t || '_c2');
  perform pg_temp.mkl(p_t, p_t || '_l1', p_t || '_c1');
  perform pg_temp.mkl(p_t, p_t || '_l2', p_t || '_c1');
  perform pg_temp.mkl(p_t, p_t || '_l3', p_t || '_c1');
  perform pg_temp.mkl(p_t, p_t || '_l4', p_t || '_c2');
  for n in 1 .. 4 loop
    perform pg_temp.run(p_t || '_sales', pg_temp.cd(p_t || '_d' || n, p_t || '_l' || n));
  end loop;
  perform pg_temp.run(p_t || '_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did(p_t || '_d2'), (select state_hash from public.followup_drafts where id = pg_temp.did(p_t || '_d2'))));
  perform pg_temp.run(p_t || '_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did(p_t || '_d3'), (select state_hash from public.followup_drafts where id = pg_temp.did(p_t || '_d3'))));
  perform pg_temp.run(p_t || '_sales', format('select public.record_draft_sent(%L, %L, null)', pg_temp.did(p_t || '_d3'), tests.rid('s_' || p_t || '_d3')));
  perform pg_temp.run(p_t || '_sales', format('select public.record_touch(%L, %L, ''in'', ''email'', null)', tests.rid('t_in_' || p_t), tests.rid(p_t || '_l4')));
  perform pg_temp.run(p_t || '_sales', format('select public.persist_question_drafts(%L, %L::jsonb)', tests.rid(p_t || '_requirement'),
          jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'code', 'missing_quantity', 'line', null, 'text', 'How many pieces do you need?'))));
end $$;
select pg_temp.build('a');
select pg_temp.build('b');
-- the person's data, to look for afterwards (tenant a's contact c1)
create temp table pii as select email, phone, full_name, regexp_replace(phone, '[^0-9]', '', 'g') as digits from public.contacts where id = tests.rid('a_c1');
create function pg_temp.dig(p_t text, p_what text) returns text language plpgsql as $$
declare v text;
begin
  execute format('select coalesce(md5(string_agg(x::text, ''~'' order by x::text)), ''-'') from public.%I x where tenant_id = %L', p_what, tests.tid(p_t)) into v;
  return v;
end $$;
select is((select count(*) from public.followup_drafts where tenant_id = tests.tid('a')), 4::bigint, 'S1 (setup) four drafts in tenant a: open, approved, recorded as sent, open (another contact)');
select is(pg_temp.dst('a_d1') || '/' || pg_temp.dst('a_d2') || '/' || pg_temp.dst('a_d3') || '/' || pg_temp.dst('a_d4'), 'draft/approved/recorded_sent/discarded', 'S3 states: d1 open, d2 approved, d3 recorded as sent, d4 discarded by the reply recorded on its lead');
select is((select count(*) from public.lead_touches where tenant_id = tests.tid('a')), 6::bigint, 'S4 six touches: four first touches, the "I sent it" of d3 and one reply');
select is((select count(*) from public.question_drafts where tenant_id = tests.tid('a')), 1::bigint, 'S5 one question draft');
select is((select full_name ilike '%quillfeather%' and email ilike '%quillfeather%' and length(digits) >= 5 from pii), true, 'S6 (control) the search terms are the person''s real data');
select cmp_ok((select count(*) from public.followup_drafts d where d::text ilike '%followup_gentle%'), '>', 0::bigint, 'S7 (control) a text search of a draft row does find what a draft holds');

-- the digests before: tenant a's touches, the content of its drafts, the question drafts and policies; tenant b's everything
create temp table pre as select
  pg_temp.dig('a', 'lead_touches') as a_touches, pg_temp.dig('a', 'question_drafts') as a_questions, pg_temp.dig('a', 'followup_policy_versions') as a_policies,
  (select md5(string_agg(concat_ws('|', id, lead_id, contact_id, touch_number, channel, template_code, body, policy_version_id, engine_version, request_text, result_text, canonical_hash, state_hash, as_of), '~' order by id))
     from public.followup_drafts where tenant_id = tests.tid('a')) as a_draft_content,
  (select md5(string_agg(concat_ws('|', id, status), '~' order by id)) from public.followup_drafts where tenant_id = tests.tid('b') and id <> pg_temp.did('b_d4')) as b_status,
  pg_temp.dig('b', 'lead_touches') as b_touches, pg_temp.dig('b', 'question_drafts') as b_questions, pg_temp.dig('b', 'followup_policy_versions') as b_policies, pg_temp.dig('b', 'followup_drafts') as b_drafts;

-- ============================================================================ A. erasing ONE CONTACT (tenant a, contact a_c1: leads l1, l2, l3)
select pg_temp.run('a_owner', format('select public.request_erasure(%L, %L, ''contact'', %L)', tests.rid('ec1'), tests.tid('a'), tests.rid('a_c1')));
create temp table eres as select pg_temp.sc('a_owner', format('select public.execute_erasure(%L, false)', tests.rid('ec1')))::jsonb as r;
select is((select r ->> 'status' from eres), 'executed', 'A1 the Owner erased the contact (the other tables did not stand in the way)');
select is((select erased_at is not null and email is null and phone is null from public.contacts where id = tests.rid('a_c1')), true, 'A2 the contact is erased');
select is((select count(*) from public.lead_touches where tenant_id = tests.tid('a')), 6::bigint, 'A3 NO touch was deleted: lead_touches keeps every row');
select is(pg_temp.dig('a', 'lead_touches'), (select a_touches from pre), 'A4 ... and every touch is BYTE-IDENTICAL (direction, channel, time, contact id, recorder: it is a business record that holds no personal data)');
select is((select count(*) from public.lead_touches where contact_id = tests.rid('a_c1')), 4::bigint, 'A5 the touches still point at the (now anonymised) contact row: l1, l2, l3 first touches and l3''s "I sent it"');
select is(pg_temp.dst('a_d1') || '/' || pg_temp.dst('a_d2'), 'discarded/discarded', 'A6 the OPEN draft and the APPROVED draft of the erased contact are discarded');
select is((select string_agg(discard_code::text, ',' order by id) from public.followup_drafts where id in (pg_temp.did('a_d1'), pg_temp.did('a_d2'))), 'erased,erased', 'A7 with the reason `erased`');
select is(pg_temp.dst('a_d3'), 'recorded_sent', 'A8 a draft already RECORDED as sent stays (it is history: a person said they sent it)');
select is((select md5(string_agg(concat_ws('|', id, lead_id, contact_id, touch_number, channel, template_code, body, policy_version_id, engine_version, request_text, result_text, canonical_hash, state_hash, as_of), '~' order by id))
             from public.followup_drafts where tenant_id = tests.tid('a')), (select a_draft_content from pre), 'A9 the CONTENT of every draft (body, request, result, hashes) is unchanged: only the status of two moved');
select is((select count(*) from public.followup_drafts d where d::text ilike '%' || (select email from pii) || '%' or d::text ilike '%' || (select digits from pii) || '%' or d::text ilike '%quillfeather%'), 0::bigint, 'A10 no draft row holds the erased person''s e-mail, phone or name');
select is((select count(*) from public.lead_touches d where d::text ilike '%' || (select email from pii) || '%' or d::text ilike '%' || (select digits from pii) || '%' or d::text ilike '%quillfeather%'), 0::bigint, 'A11 no touch row does');
select is((select count(*) from public.question_drafts d where d::text ilike '%quillfeather%' or d::text ilike '%' || (select digits from pii) || '%'), 0::bigint, 'A12 no question draft does');
select is((select count(*) from public.audit_events a where a.entity_type in ('followup_draft', 'lead_touch', 'question_draft', 'followup_policy_version')
             and (a.new_values::text ilike '%quillfeather%' or a.old_values::text ilike '%quillfeather%' or a.new_values::text ilike '%' || (select digits from pii) || '%' or a.new_values::text ilike '%' || (select email from pii) || '%')), 0::bigint, 'A13 nor does the audit trail of these tables');
select is(pg_temp.dst('a_d4'), 'discarded', 'A14 another contact''s draft is untouched (it was discarded by its reply before, and is unchanged)');
select is(pg_temp.mk('a_sales', 'a_new1', 'a_l1'), 'SM220:erased', 'A15 no new draft can be made for the erased contact (SM220, erased)');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''out'', ''email'', null)', gen_random_uuid(), tests.rid('a_l1'))), 'SM220:erased', 'A16 no new outbound touch');
select is(pg_temp.try('a_sales', format('select public.record_touch(%L, %L, ''in'', ''email'', null)', gen_random_uuid(), tests.rid('a_l1'))), 'SM220:erased', 'A17 and no new inbound touch (erasure wins)');
select is(pg_temp.gate('a_l1') ->> 'blocked', 'erased', 'A18 the read says erased');
select is(pg_temp.try('a_owner', format('select public.approve_followup_draft(%L, %L)', pg_temp.did('a_d2'), repeat('0', 64))), 'SM223:not_draft', 'A19 the discarded approved draft cannot be approved');
select is(pg_temp.dig('a', 'question_drafts') || pg_temp.dig('a', 'followup_policy_versions'), (select a_questions || a_policies from pre), 'A20 question drafts and policies are untouched by a contact erasure');
select is(pg_temp.dig('b', 'followup_drafts') || pg_temp.dig('b', 'lead_touches'), (select b_drafts || b_touches from pre), 'A21 tenant b is byte-identical');

-- ============================================================================ B. erasing the WHOLE WORKSPACE (erase_tenant) while it holds policies, touches, drafts and question drafts
select pg_temp.run('b_owner', format('select public.request_erasure(%L, %L, ''tenant'')', tests.rid('et1'), tests.tid('b')));
update public.erasure_requests set execute_after = now() - interval '1 minute' where id = tests.rid('et1');
create temp table tres as select pg_temp.sc('b_owner', format('select public.execute_erasure(%L, false)', tests.rid('et1')))::jsonb as r;
select is((select r ->> 'status' from tres), 'executed', 'B1 erase_tenant FINISHES CLEAN on a tenant with touches, drafts, policies and question drafts (the append-only trigger of lead_touches never fires: no registered column lives there)');
select is((select count(*) from public.contacts where tenant_id = tests.tid('b') and erased_at is not null), (select count(*) from public.contacts where tenant_id = tests.tid('b')), 'B2 every contact of the workspace is erased');
select is(pg_temp.dig('b', 'lead_touches'), (select b_touches from pre), 'B3 the touches are byte-identical (nothing deleted, nothing rewritten)');
select is(pg_temp.dig('b', 'followup_policy_versions'), (select b_policies from pre), 'B4 so are the policy versions');
select is(pg_temp.dig('b', 'question_drafts'), (select b_questions from pre), 'B5 and the question drafts');
select is((select count(*) from public.followup_drafts where tenant_id = tests.tid('b') and status in ('draft', 'approved')), 0::bigint, 'B6 no open draft is left in an erased workspace');
select is((select string_agg(distinct discard_code::text, ',') from public.followup_drafts where tenant_id = tests.tid('b') and status = 'discarded' and id in (pg_temp.did('b_d1'), pg_temp.did('b_d2'))), 'erased', 'B7 the open and the approved draft were discarded as `erased` (the contact trigger ran inside the erasure)');
select is(pg_temp.dst('b_d3'), 'recorded_sent', 'B8 the recorded draft stays');
select is((select count(*) from public.followup_drafts d where d::text ilike '%quillfeather%'), 0::bigint, 'B10 no draft holds a name');
select is(pg_temp.dig('a', 'lead_touches') || pg_temp.dig('a', 'question_drafts') || pg_temp.dig('a', 'followup_policy_versions'), (select a_touches || a_questions || a_policies from pre), 'B11 tenant a''s tables are untouched by tenant b''s erasure');
select is(pg_temp.try('b_sales', format('select public.record_touch(%L, %L, ''out'', ''email'', null)', gen_random_uuid(), tests.rid('b_l4'))), 'SM220:erased', 'B12 nothing can be recorded for an erased workspace''s contact');

select * from finish();
