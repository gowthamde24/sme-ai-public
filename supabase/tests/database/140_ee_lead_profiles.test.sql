-- Job EE (migration 20261219090000): the normalised profile of a lead. Who may read and write it (members read through the functions, only through them), the first guess is stored once and never overwrites what the owner
-- fixed, a fixed field stays fixed against a later model guess, junk is a flag (nothing deleted), the "opened" highlight is per person, the list filters, the merge note and the duplicate pointer, and nothing leaks across businesses.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text) returns text language plpgsql as $$
begin return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.page(p_user text, p_tenant text, p_filters text default 'null, null, null, null, null, null, null, null') returns jsonb language sql as $$
  select pg_temp.val(p_user, format($q$select public.lead_desk_page(%L, 50, null, null, false, %s)::text$q$, tests.tid(p_tenant), p_filters))::jsonb $$;
create function pg_temp.one(p_user text, p_tenant text, p_lead text) returns jsonb language sql as $$
  select pg_temp.val(p_user, format($q$select public.lead_desk_get(%L, %L)::text$q$, tests.tid(p_tenant), tests.rid(p_lead)))::jsonb $$;

-- ---- what a lead looks like before anything was guessed
select is(jsonb_array_length(pg_temp.page('a_owner', 'a') -> 'items') >= 1, true, 'the owner lists the leads');
select is((pg_temp.one('a_owner', 'a', 'a_lead') ->> 'needs_profile')::boolean, true, 'no guess yet: needs_profile');
select is((pg_temp.one('a_owner', 'a', 'a_lead') ->> 'is_new')::boolean, true, 'nobody has opened it: new');
select is(pg_temp.one('a_owner', 'a', 'a_lead') -> 'profile' -> 'junk', 'false'::jsonb, 'not junk');
select is(pg_temp.one('a_owner', 'a', 'a_lead') -> 'profile' -> 'fixed_by_you', '[]'::jsonb, 'nothing fixed yet');
select is(pg_temp.val('b_owner', format($q$select public.lead_desk_get(%L, %L)::text$q$, tests.tid('b'), tests.rid('a_lead'))), null, 'another business''s lead id is simply not there');
select is(pg_temp.val('a_owner', format($q$select public.lead_desk_page(%L, 50, null, null, false, 'bogus', null, null, null, null, null, null, null)::text$q$, tests.tid('a'))), 'ERR:22023', 'a status that does not exist is refused');
select is(pg_temp.val('b_owner', format($q$select public.lead_desk_get(%L, %L)::text$q$, tests.tid('a'), tests.rid('a_lead'))), 'ERR:42501', 'DENY: another business''s Owner cannot read ours');
select is(pg_temp.val('anon', format($q$select public.lead_desk_page(%L, 50, null, null, false, null, null, null, null, null, null, null, null)::text$q$, tests.tid('a'))), 'ERR:42501', 'DENY: no identity');
select is(pg_temp.val('a_viewer', format($q$select (public.lead_desk_get(%L, %L) -> 'profile' ->> 'original_text')$q$, tests.tid('a'), tests.rid('a_lead'))), null, 'a Viewer reads the card but not what the person wrote');

-- ---- the first guess (rules) is stored once
insert into public.lead_arrivals (tenant_id, lead_id, contact_id, source_tag, kind, message, received_at) values
  (tests.tid('a'), tests.rid('a_lead'), tests.rid('a_contact'), 'justdial', 'first', 'Need 500 paver blocks in Eluru', now() - interval '2 days'),
  (tests.tid('a'), tests.rid('a_lead'), tests.rid('a_contact'), 'justdial', 'repeat', 'Any update on the blocks?', now() - interval '1 day'),
  (tests.tid('a'), tests.rid('a_lead'), tests.rid('a_contact'), 'indiamart', 'repeat', 'Please reply', now() - interval '1 hour');
select is(pg_temp.one('a_owner', 'a', 'a_lead') -> 'profile' ->> 'original_text', 'Need 500 paver blocks in Eluru', 'the words as they wrote them (the first arrival)');
select is((pg_temp.one('a_owner', 'a', 'a_lead') -> 'profile' ->> 'merged_count')::int, 2, 'two repeats are the merge note');
select is(pg_temp.val('a_sales', format($q$select public.lead_profile_seed(%L, %L::jsonb)::text$q$, tests.tid('a'),
  jsonb_build_array(jsonb_build_object('lead_id', tests.rid('a_lead'), 'fields', jsonb_build_object('need', 'paver blocks', 'quantity', '500', 'city', 'Eluru', 'urgency', 'high'),
                    'confidence', jsonb_build_object('need', 'medium', 'quantity', 'medium', 'city', 'medium', 'urgency', 'low'), 'junk', null))::text)), '1', 'Sales stores the first guess');
select is(pg_temp.one('a_owner', 'a', 'a_lead') -> 'profile' ->> 'need', 'paver blocks', '...it shows');
select is(pg_temp.one('a_owner', 'a', 'a_lead') -> 'profile' -> 'confidence' ->> 'urgency', 'low', '...with its confidence');
select is((pg_temp.one('a_owner', 'a', 'a_lead') ->> 'needs_profile')::boolean, false, '...and the lead no longer needs a guess');
select is(pg_temp.val('a_sales', format($q$select public.lead_profile_seed(%L, %L::jsonb)::text$q$, tests.tid('a'),
  jsonb_build_array(jsonb_build_object('lead_id', tests.rid('a_lead'), 'fields', jsonb_build_object('need', 'something else'), 'confidence', '{}'::jsonb, 'junk', null))::text)), '0', 'a second first-guess changes nothing');
select is(pg_temp.val('a_viewer', format($q$select public.lead_profile_seed(%L, '[]'::jsonb)::text$q$, tests.tid('a'))), 'ERR:42501', 'DENY: a Viewer cannot store guesses');
select is(pg_temp.val('b_owner', format($q$select public.lead_profile_seed(%L, '[]'::jsonb)::text$q$, tests.tid('a'))), 'ERR:42501', 'DENY: another business');
select is(pg_temp.val('a_owner', format($q$select public.lead_profile_seed(%L, %L::jsonb)::text$q$, tests.tid('a'),
  jsonb_build_array(jsonb_build_object('lead_id', tests.rid('b_lead'), 'fields', jsonb_build_object('need', 'x'), 'confidence', '{}'::jsonb))::text)), '0', 'a lead of another business is skipped, not written');
select is(pg_temp.val('a_owner', format($q$select public.lead_profile_seed(%L, %L::jsonb)::text$q$, tests.tid('a'),
  jsonb_build_array(jsonb_build_object('lead_id', tests.rid('a_lead'), 'fields', jsonb_build_object('need', 'call me on 9876543210'), 'confidence', '{}'::jsonb))::text)), '0', 'a phone number inside a field is refused (skipped)');

-- ---- the owner fixes a field: fixed, high, and never overwritten
select is(pg_temp.val('a_sales', format($q$select (public.lead_profile_fix(%L, %L, '{"city":"Vijayawada","budget":null}'::jsonb) -> 'profile' ->> 'city')$q$, tests.tid('a'), tests.rid('a_lead'))), 'Vijayawada', 'Sales fixes the city');
select is(pg_temp.one('a_owner', 'a', 'a_lead') -> 'profile' -> 'fixed_by_you', '["city", "budget"]'::jsonb, '...city and budget are "fixed by you"');
select is(pg_temp.one('a_owner', 'a', 'a_lead') -> 'profile' -> 'confidence' ->> 'city', 'high', '...with confidence high');
select is(pg_temp.val('a_owner', format($q$select (public.lead_profile_apply_ai(%L, %L, '{"city":"Guntur","need":"pavers 60mm","quantity":"600"}'::jsonb, '{"city":"medium","need":"medium","quantity":"low"}'::jsonb) -> 'profile' ->> 'city')$q$, tests.tid('a'), tests.rid('a_lead'))), 'Vijayawada', 'a later model guess does not overwrite a fixed field');
select is(pg_temp.one('a_owner', 'a', 'a_lead') -> 'profile' ->> 'need', 'pavers 60mm', '...but fills the others');
select is(pg_temp.one('a_owner', 'a', 'a_lead') -> 'profile' -> 'confidence' ->> 'quantity', 'low', '...with the confidence it gave');
select is(pg_temp.val('a_owner', format($q$select public.lead_profile_apply_ai(%L, %L, '{"need":"x"}'::jsonb, '{"need":"high"}'::jsonb)::text$q$, tests.tid('a'), tests.rid('a_lead'))) ~ 'pavers 60mm', true, 'a guess can never claim "high" (the field keeps its value)');
select is(pg_temp.val('a_owner', format($q$select public.lead_profile_fix(%L, %L, '{"name":"x"}'::jsonb)::text$q$, tests.tid('a'), tests.rid('a_lead'))), 'ERR:22023', 'DENY: a field that is not a profile field');
select is(pg_temp.val('a_owner', format($q$select public.lead_profile_fix(%L, %L, '{"urgency":"extreme"}'::jsonb)::text$q$, tests.tid('a'), tests.rid('a_lead'))), 'ERR:22023', 'DENY: urgency is a closed list');
select is(pg_temp.val('a_owner', format($q$select public.lead_profile_fix(%L, %L, '{}'::jsonb)::text$q$, tests.tid('a'), tests.rid('a_lead'))), 'ERR:22023', 'DENY: nothing to fix');
select is(pg_temp.val('a_viewer', format($q$select public.lead_profile_fix(%L, %L, '{"city":"x"}'::jsonb)::text$q$, tests.tid('a'), tests.rid('a_lead'))), 'ERR:42501', 'DENY: a Viewer');
select is(pg_temp.val('b_owner', format($q$select public.lead_profile_fix(%L, %L, '{"city":"x"}'::jsonb)::text$q$, tests.tid('b'), tests.rid('a_lead'))), 'ERR:23503', 'DENY: our lead through their workspace');

-- ---- junk is a flag, the filter finds it, nothing is deleted
select is(pg_temp.val('a_owner', format($q$select (public.lead_profile_fix(%L, %L, '{"junk":"spam"}'::jsonb) -> 'profile' -> 'junk' ->> 'reason')$q$, tests.tid('a'), tests.rid('a_lead'))), 'spam', 'the owner flags it as spam');
select is(jsonb_array_length(pg_temp.page('a_owner', 'a', $f$null, null, null, null, null, null, null, 'only'$f$) -> 'items'), 1, 'junk=only finds it');
select is(jsonb_array_length(pg_temp.page('a_owner', 'a', $f$null, null, null, null, null, null, null, 'hide'$f$) -> 'items') < jsonb_array_length(pg_temp.page('a_owner', 'a') -> 'items'), true, 'junk=hide leaves it out');
select is((select count(*)::int from public.leads where id = tests.rid('a_lead')), 1, 'the lead itself is still there');

-- ---- opened is per person
select is(pg_temp.val('a_owner', format($q$select public.lead_profile_open(%L, %L)::text$q$, tests.tid('a'), tests.rid('a_lead'))), 'true', 'the owner opens the lead');
select is((pg_temp.one('a_owner', 'a', 'a_lead') ->> 'is_new')::boolean, false, '...no longer new for the owner');
select is((pg_temp.one('a_sales', 'a', 'a_lead') ->> 'is_new')::boolean, true, '...still new for Sales');
select is(pg_temp.val('a_owner', format($q$select public.lead_profile_open(%L, %L)::text$q$, tests.tid('a'), tests.rid('a_lead'))), 'true', 'opening twice is fine');
select is((select cardinality(opened_by) from public.lead_profiles where lead_id = tests.rid('a_lead')), 1, '...and counted once');
select is(pg_temp.val('b_owner', format($q$select public.lead_profile_open(%L, %L)::text$q$, tests.tid('b'), tests.rid('a_lead'))), 'ERR:23503', 'DENY: opening our lead through their workspace');
select is(jsonb_array_length(pg_temp.page('a_owner', 'a', $f$null, null, null, null, null, null, null, null$f$) -> 'items') > 0
          and not exists (select 1 from jsonb_array_elements(pg_temp.page('a_owner', 'a', $f$null, null, null, null, null, null, true, null$f$) -> 'items') i where i ->> 'id' = tests.rid('a_lead')::text), true, 'new=true leaves out what the owner has opened');

-- ---- filters
select is((select count(*)::int from jsonb_array_elements(pg_temp.page('a_owner', 'a', $f$null, null, 'high', null, null, null, null, null$f$) -> 'items') i where i ->> 'id' = tests.rid('a_lead')::text), 1, 'urgency=high finds the lead the rules marked high');
select is((select count(*)::int from jsonb_array_elements(pg_temp.page('a_owner', 'a', $f$null, null, 'low', null, null, null, null, null$f$) -> 'items') i where i ->> 'id' = tests.rid('a_lead')::text), 0, '...and urgency=low does not');
select is((select count(*)::int from jsonb_array_elements(pg_temp.page('a_owner', 'a', $f$null, 'justdial', null, null, null, null, null, null$f$) -> 'items')), 0, 'source=justdial: the lead''s own source is not justdial (the arrival is)');
select is((select count(*)::int from jsonb_array_elements(pg_temp.page('a_owner', 'a', $f$null, null, null, null, null, 'paver', null, null$f$) -> 'items') i where i ->> 'id' = tests.rid('a_lead')::text), 1, 'q finds the words in the profile');
select is((select count(*)::int from jsonb_array_elements(pg_temp.page('a_owner', 'a', $f$null, null, null, null, null, 'highway', null, null$f$) -> 'items')), 0, 'q with no match finds nothing');
select is((select count(*)::int from jsonb_array_elements(pg_temp.page('a_owner', 'a', $f$null, null, null, null, null, 'Any update', null, null$f$) -> 'items') i where i ->> 'id' = tests.rid('a_lead')::text), 1, 'q also searches what the person wrote');
select is((select count(*)::int from jsonb_array_elements(pg_temp.page('a_viewer', 'a', $f$null, null, null, null, null, 'Any update', null, null$f$) -> 'items')), 0, 'a Viewer''s search does not reach what people wrote');
select is((select count(*)::int from jsonb_array_elements(pg_temp.page('b_owner', 'b') -> 'items') i where i ->> 'id' = tests.rid('a_lead')::text), 0, 'another business''s list never has our lead');
select is(pg_temp.val('a_owner', 'select count(*)::text from public.lead_profiles'), '1', 'the owner reads their own profile rows');
select is(pg_temp.val('a_viewer', 'select count(*)::text from public.lead_profiles'), '0', 'a Viewer reads none directly');
select is(tests.sqlstate_as(tests.uid('a_owner'), format($$insert into public.lead_profiles (tenant_id, lead_id, need) values (%L, %L, 'x')$$, tests.tid('a'), tests.rid('a_lead'))), '42501', 'DENY: no client writes the table directly');

select * from finish();
rollback;
