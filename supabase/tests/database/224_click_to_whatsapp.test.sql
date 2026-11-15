-- Migration 20261231910000: a Click-to-WhatsApp ad referral becomes the lead's source (an arrival tagged click_to_whatsapp, once a day per lead) and its campaign; only the channel principal may record it.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();
create function pg_temp.ch(p_sql text) returns text language plpgsql as $$
begin perform tests.as_aal('aal2'); return tests.scalar_as(tests.uid('x6'), p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;

select app.operator_register_channel_agent('x6@test.local');
select is(app.lead_tag_ok('click_to_whatsapp'), true, 'A1: the tag is known');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($q$select public.wa_ad_referral(%L, %L, 'ad_1', 'Silk sale', 'clk_1')$q$, tests.tid('a'), tests.rid('a_lead'))), '42501', 'B1: a signed-in owner cannot record a referral (only the channel principal)');
select is(tests.sqlstate_as(null, format($q$select public.wa_ad_referral(%L, %L, 'ad_1', 'Silk sale', 'clk_1')$q$, tests.tid('a'), tests.rid('a_lead'))), '42501', 'B2: nor anyone without an identity');
insert into public.lead_profiles (tenant_id, lead_id) values (tests.tid('a'), tests.rid('a_lead')) on conflict do nothing;
select is((pg_temp.ch(format($q$select public.wa_ad_referral(%L, %L, 'ad_1', 'Silk sale', 'clk_1')::text$q$, tests.tid('a'), tests.rid('a_lead')))::jsonb) ->> 'outcome', 'recorded', 'C1: the channel principal records a referral');
select is((select count(*) from public.lead_arrivals where tenant_id = tests.tid('a') and lead_id = tests.rid('a_lead') and source_tag = 'click_to_whatsapp'), 1::bigint, 'C2: one arrival, tagged click_to_whatsapp');
select is((select message from public.lead_arrivals where tenant_id = tests.tid('a') and lead_id = tests.rid('a_lead') and source_tag = 'click_to_whatsapp'), 'Instagram/Facebook ad: Silk sale', 'C3: with the ad''s headline');
select is((select campaign from public.lead_profiles where lead_id = tests.rid('a_lead')), 'Silk sale', 'C4: and the headline is the lead''s campaign');
select is((pg_temp.ch(format($q$select public.wa_ad_referral(%L, %L, 'ad_1', 'Silk sale', 'clk_1')::text$q$, tests.tid('a'), tests.rid('a_lead')))::jsonb) ->> 'outcome', 'duplicate', 'C5: a second message of the same chat is not a second arrival');
select is(pg_temp.ch(format($q$select public.wa_ad_referral(%L, %L, 'bad id!', 'x', 'c')::text$q$, tests.tid('a'), tests.rid('a_lead'))), 'ERR:22023', 'C6: an ad id of the wrong shape is refused');
select is((pg_temp.ch(format($q$select public.wa_ad_referral(%L, gen_random_uuid(), 'ad_1', 'x', 'c')::text$q$, tests.tid('a')))::jsonb) ->> 'outcome', 'no_lead', 'C7: a lead that is not there says so');
select * from finish();
rollback;
