-- Meta lead form consent (migration 20261231940000): the per-lead evidence, the grant when the box is ticked, "ask first" otherwise, replays change nothing.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.open_gate('a');
select app.operator_register_scheduler('Outsider@test.local');
create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '' as $b$ select timestamptz '2026-11-15 14:00:00+05:30' $b$;

create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.w(p_sql text) returns text language sql as $$ select pg_temp.val('outsider', p_sql) $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;

-- a Meta source and three arrivals (the worker's live door, as the API makes them)
select pg_temp.val('a_owner', format($q$select public.lead_source_create(%L, %L, 'meta_lead_ads', 'meta_lead_ads', 'Meta lead ads', %L, 'wxyz', null, null, null)::text$q$, tests.tid('a'), tests.rid('m1'), pg_temp.h('meta-token')));
select is(pg_temp.w(format($q$select public.scheduler_lead_intake_live(%L, '[{"name": "Ticked Lead", "phone": "+919822220001", "external_id": "5551"}, {"name": "Unticked Lead", "phone": "+919822220002", "external_id": "5552"}, {"name": "No Box Lead", "phone": "+919822220003", "external_id": "5553"}]'::jsonb)::text$q$, pg_temp.h('meta-token')))::jsonb ->> 'status', 'received', 'A1 three Meta leads arrive');
select is((select count(*)::int from public.contacts where tenant_id = tests.tid('a') and full_name in ('Ticked Lead', 'Unticked Lead', 'No Box Lead') and phone_consent = 'unknown' and whatsapp_consent = 'unknown'), 3, 'A2 none of them has consent from the arrival itself (a Meta source has no confirmation)');

-- B. ticked
select is(pg_temp.w(format($q$select public.scheduler_lead_meta_consent(%L, '[{"leadgen_id": "5551", "form_id": "77", "disclaimer": "Contact consent. I agree that Stack19 may call or WhatsApp me about my enquiry.", "checkbox_key": "contact_consent", "ticked": true}]'::jsonb)::text$q$, pg_temp.h('meta-token')))::jsonb ->> 'granted', '1', 'B1 a ticked box: consent granted');
select is((select phone_consent::text || ',' || whatsapp_consent::text from public.contacts where tenant_id = tests.tid('a') and full_name = 'Ticked Lead'), 'granted,granted', 'B2 ... for the phone and for WhatsApp');
select is((select count(*)::int from public.consent_events e join public.contacts c on c.id = e.contact_id where c.full_name = 'Ticked Lead' and e.event_type = 'granted' and e.basis = 'explicit_consent' and e.evidence_type = 'web_form' and e.evidence_ref = 'meta_form:77-5551'), 2, 'B3 ... in the ledger, with the form and the lead as the evidence reference');
select is((select ticked::text || '|' || checkbox_key || '|' || form_id || '|' || leadgen_id from public.lead_consent_evidence where tenant_id = tests.tid('a') and leadgen_id = '5551'), 'true|contact_consent|77|5551', 'B4 the evidence row holds the form, the key, the answer');
select ok((select disclaimer_text from public.lead_consent_evidence where leadgen_id = '5551') like '%call or WhatsApp me%', 'B5 ... and the wording the form showed');
select is(pg_temp.w(format($q$select public.scheduler_lead_meta_consent(%L, '[{"leadgen_id": "5551", "form_id": "77", "disclaimer": "x", "checkbox_key": "contact_consent", "ticked": true}]'::jsonb)::text$q$, pg_temp.h('meta-token')))::jsonb ->> 'recorded', '0', 'B6 a replay records nothing');
select is((select count(*)::int from public.consent_events e join public.contacts c on c.id = e.contact_id where c.full_name = 'Ticked Lead'), 2, 'B7 ... and adds no ledger event');

-- C. not ticked, or no box on the form: ask first
select is(pg_temp.w(format($q$select public.scheduler_lead_meta_consent(%L, '[{"leadgen_id": "5552", "form_id": "77", "disclaimer": "Contact consent", "checkbox_key": "contact_consent", "ticked": false}, {"leadgen_id": "5553", "form_id": "66"}]'::jsonb)::text$q$, pg_temp.h('meta-token')))::jsonb ->> 'ask_first', '2', 'C1 an unticked box and a form without a box: both stay ask-first');
select is((select count(*)::int from public.contacts where tenant_id = tests.tid('a') and full_name in ('Unticked Lead', 'No Box Lead') and phone_consent = 'unknown' and whatsapp_consent = 'unknown'), 2, 'C2 their consent is untouched');
select is((select string_agg(coalesce(ticked::text, 'none'), ',' order by leadgen_id) from public.lead_consent_evidence where leadgen_id in ('5552', '5553')), 'false,none', 'C3 the evidence says false and none');
select is((select count(*)::int from public.consent_events e join public.contacts c on c.id = e.contact_id where c.full_name in ('Unticked Lead', 'No Box Lead')), 0, 'C4 no ledger event for them');

-- D. who may call it, who may read the evidence
select is(pg_temp.w(format($q$select public.scheduler_lead_meta_consent(%L, '[{"leadgen_id": "5551", "form_id": "77"}]'::jsonb)::text$q$, pg_temp.h('no-such-token')))::jsonb ->> 'status', 'unknown', 'D1 an unknown address answers unknown');
select is(pg_temp.val('a_owner', format($q$select public.scheduler_lead_meta_consent(%L, '[{"leadgen_id": "5551", "form_id": "77"}]'::jsonb)::text$q$, pg_temp.h('meta-token'))), 'ERR:42501', 'D2 only the worker account calls it');
select is(pg_temp.w(format($q$select public.scheduler_lead_meta_consent(%L, '[]'::jsonb)::text$q$, pg_temp.h('meta-token'))), 'ERR:22023', 'D3 an empty list is invalid');
select is(pg_temp.val('a_owner', $q$select count(*)::text from public.lead_consent_evidence$q$), '3', 'D4 the Owner reads the evidence');
select is(pg_temp.val('a_sales', $q$select count(*)::text from public.lead_consent_evidence$q$), '3', 'D5 Sales reads it too');
select is(pg_temp.val('a_viewer', $q$select count(*)::text from public.lead_consent_evidence$q$), '0', 'D6 a Viewer does not');
select is(pg_temp.val('b_owner', $q$select count(*)::text from public.lead_consent_evidence$q$), '0', 'D7 another workspace sees none');
select is(pg_temp.val('a_owner', format($q$insert into public.lead_consent_evidence (tenant_id, lead_id, contact_id, source_tag, form_id, leadgen_id) values (%L, %L, %L, 'meta_lead_ads', '1', '999')$q$, tests.tid('a'), tests.rid('x1'), tests.rid('x2'))), 'ERR:42501', 'D8 no one writes it from a client');

select * from finish();
rollback;
