-- Job DR / A1 (migrations 20261204090000 and 20261204090100): the nine "Leads & calls" business types, the lead playbook and the knowledge base.
--   A the packs   B the playbook   C the sources   D the facts   E who sees what   F isolation   G the doors
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();

create function pg_temp.val(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(case when p_user = 'anon' then null else tests.uid(p_user) end, p_sql);
exception when others then return 'ERR:' || sqlstate; end $$;
create function pg_temp.j(p_user text, p_fn text, p_args text, p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.val(p_user, format($q$select public.%s(%s)::text$q$, p_fn, p_args), p_aal) $$;
create function pg_temp.tid(p text) returns text language sql as $$ select quote_literal(tests.tid(p)) $$;
create function pg_temp.rid(p text) returns text language sql as $$ select quote_literal(tests.rid(p)) $$;

-- ============================================================================ A. the packs
select is((select count(*)::int from packs.pack_versions where code in ('real_estate', 'coaching', 'clinic', 'insurance_loans', 'auto_dealer', 'interiors_solar', 'travel', 'gym', 'wholesale_b2b') and status = 'preview'), 9, 'A1 the nine business types are in the database as preview packs');
select is(pg_temp.val('a_owner', $q$select jsonb_array_length(public.pack_catalogue())::text$q$), '12', 'A2 the sign-up list holds the three deep packs and the nine new ones');
select is((select manifest ->> 'core_tab' from packs.pack_versions where code = 'real_estate'), 'campaigns', 'A3 a lead pack''s core tab is the campaigns (batches of calls)');
select is((select count(*)::int from packs.pack_versions v, jsonb_array_elements(v.manifest -> 'custom_fields') f where v.code = 'clinic' and f ->> 'entity' = 'contact'), 7, 'A4 a pack carries the contact fields its questions fill');
select ok(not exists (select 1 from packs.pack_versions v where v.code = 'gym' and (v.manifest -> 'modules') ? 'quotes'), 'A5 a lead pack does not switch the quotes module on');
select ok(exists (select 1 from packs.pack_versions v where v.code = 'wholesale_b2b' and (v.manifest -> 'modules') ? 'companies'), 'A6 the wholesale pack has companies');

-- ============================================================================ B. the playbook
select is(pg_temp.val('a_sales', format($q$select (public.lead_playbook_get(%s) ->> 'saved')$q$, pg_temp.tid('a'))), 'false', 'B1 before a save, the template applies (any member can ask)');
select is(pg_temp.j('a_owner', 'lead_playbook_save', pg_temp.tid('a') || $q$, '{"goal_ask": {"en": "Book a visit"}, "questions": []}'::jsonb$q$) is not null, true, 'B2 the Owner saves it with a second factor');
select is(pg_temp.val('a_viewer', format($q$select (public.lead_playbook_get(%s) -> 'playbook' -> 'goal_ask' ->> 'en')$q$, pg_temp.tid('a'))), 'Book a visit', 'B3 every member reads the saved one');
select is(pg_temp.j('a_owner', 'lead_playbook_save', pg_temp.tid('a') || ', ''{}''::jsonb', 'aal1'), 'ERR:SM306', 'B4 without the second factor: refused');
select is(pg_temp.j('a_admin', 'lead_playbook_save', pg_temp.tid('a') || ', ''{}''::jsonb'), 'ERR:42501', 'B5 an Admin cannot save it');
select is(pg_temp.j('a_owner', 'lead_playbook_save', pg_temp.tid('a') || ', ''[]''::jsonb'), 'ERR:22023', 'B6 not an object: invalid');
select is(pg_temp.j('a_owner', 'lead_playbook_save', pg_temp.tid('a') || format(', jsonb_build_object(''x'', %L)', repeat('x', 41000))), 'ERR:22023', 'B7 too big: invalid');
select is(pg_temp.j('a_owner', 'lead_playbook_reset', pg_temp.tid('a'), 'aal1'), 'ERR:SM306', 'B8 a reset needs the second factor too');
select is(pg_temp.val('a_owner', format($q$select (public.lead_playbook_reset(%s) ->> 'saved')$q$, pg_temp.tid('a'))), 'false', 'B9 a reset goes back to the template');
select is((select count(*)::int from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'lead_playbook'), 2, 'B10 the save and the reset are in the audit trail');
select is((select count(*)::int from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'lead_playbook' and new_values::text like '%Book a visit%') > 0, true, 'B11 ... and it keeps the script itself (the business''s own words, like a policy)');

-- ============================================================================ C. the sources
select is(pg_temp.j('a_owner', 'knowledge_source_add', pg_temp.tid('a') || ', ' || pg_temp.rid('s1') || $q$, 'paste', 'Our brochure', null, null, 'Green Valley Villas. Open 10 to 6. Site visits every day.'$q$) is not null, true, 'C1 the Owner adds a pasted source');
select is(pg_temp.val('a_admin', format($q$select public.knowledge_source_add(%s, %s, 'paste', 'From Instagram', null, null, 'Two and three bedroom homes near the ring road.')::text$q$, pg_temp.tid('a'), pg_temp.rid('s2'))) not like 'ERR:%', true, 'C2 an Admin may too');
select is(pg_temp.val('a_sales', format($q$select public.knowledge_source_add(%s, %s, 'paste', 'x', null, null, 'text')::text$q$, pg_temp.tid('a'), pg_temp.rid('s3'))), 'ERR:42501', 'C3 Sales may not');
select is(pg_temp.val('a_owner', format($q$select (public.knowledge_source_add(%s, %s, 'paste', 'Our brochure', null, null, 'Green Valley Villas. Open 10 to 6. Site visits every day.') ->> 'chars')$q$, pg_temp.tid('a'), pg_temp.rid('s1'))), '57', 'C4 the same id again is a retry: the same source');
select is((select count(*)::int from public.knowledge_sources where tenant_id = tests.tid('a')), 2, 'C5 ... not a second row');
select is(pg_temp.val('a_owner', format($q$select public.knowledge_source_add(%s, %s, 'paste', 'Bad kind', null, null, 'x')::text$q$, pg_temp.tid('a'), pg_temp.rid('s4'))) not like 'ERR:%', true, 'C6 a one-letter text is allowed (the API sets the real minimum)');
select is(pg_temp.val('a_owner', format($q$select public.knowledge_source_add(%s, %s, 'video', 'x', null, null, 'text')::text$q$, pg_temp.tid('a'), pg_temp.rid('s5'))), 'ERR:22023', 'C7 an unknown kind: invalid');
select is(pg_temp.val('a_owner', format($q$select public.knowledge_source_add(%s, %s, 'file', 'A file', null, null, 'text')::text$q$, pg_temp.tid('a'), pg_temp.rid('s5'))), 'ERR:22023', 'C8 a file source needs its name and type');
select is(pg_temp.val('a_owner', format($q$select public.knowledge_source_add(%s, %s, 'paste', 'Huge', null, null, %L)::text$q$, pg_temp.tid('a'), pg_temp.rid('s5'), repeat('a', 60001))), 'ERR:22023', 'C9 more than 60,000 characters: invalid');
select is(pg_temp.val('a_owner', format($q$select public.knowledge_source_add(%s, %s, 'paste', 'Hidden', null, null, %L)::text$q$, pg_temp.tid('a'), pg_temp.rid('s5'), 'text' || chr(8203) || 'hidden')), 'ERR:22023', 'C10 invisible characters are refused');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.knowledge_sources_list(%s))::text$q$, pg_temp.tid('a'))), '3', 'C11 the Owner lists the sources');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.knowledge_sources_list(%s))::text$q$, pg_temp.tid('a'))), 'ERR:42501', 'C12 Sales does not');
select is(pg_temp.val('a_admin', format($q$select (public.knowledge_source_text(%s, %s) ->> 'text')$q$, pg_temp.tid('a'), pg_temp.rid('s1'))), 'Green Valley Villas. Open 10 to 6. Site visits every day.', 'C13 the text of a source is read back for the model');

-- fifty live sources at most
insert into public.knowledge_sources (id, tenant_id, kind, title, text, chars, created_by)
select gen_random_uuid(), tests.tid('a'), 'paste', 'Filler ' || g, 'filler text', 11, tests.uid('a_owner') from generate_series(1, 47) g;
select is(pg_temp.val('a_owner', format($q$select public.knowledge_source_add(%s, %s, 'paste', 'One too many', null, null, 'text')::text$q$, pg_temp.tid('a'), pg_temp.rid('s6'))), 'ERR:53400', 'C14 fifty live sources is the limit');
delete from public.knowledge_sources where title like 'Filler %';

-- ============================================================================ D. the facts
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.knowledge_facts_draft_replace(%s, %s, jsonb_build_array(
    jsonb_build_object('id', %s, 'kind', 'hours', 'text', 'Open every day from 10 am to 6 pm.'),
    jsonb_build_object('id', %s, 'kind', 'price', 'text', 'Two bedroom homes start at ₹ 45 lakh.'),
    jsonb_build_object('id', %s, 'kind', 'location', 'text', 'Near the ring road, Hyderabad.'))))::text$q$, pg_temp.tid('a'), pg_temp.rid('s1'), pg_temp.rid('f1'), pg_temp.rid('f2'), pg_temp.rid('f3'))), '3', 'D1 the model''s draft is stored as three drafts');
select is((select status from public.knowledge_sources where id = tests.rid('s1')), 'drafted', 'D2 the source says it was drafted');
select is((select count(*)::int from public.knowledge_facts where tenant_id = tests.tid('a') and status = 'draft'), 3, 'D3 every fact starts as a draft');
select is(pg_temp.val('a_owner', format($q$select public.knowledge_facts_draft_replace(%s, %s, jsonb_build_array(jsonb_build_object('id', %s, 'kind', 'other', 'text', 'Two bedroom homes start at ₹ 45 lakh.')))::text$q$, pg_temp.tid('a'), pg_temp.rid('s1'), pg_temp.rid('f9'))), 'ERR:23514', 'D4 text that looks like a price must be a price fact: refused');
select is((select count(*)::int from public.knowledge_facts where tenant_id = tests.tid('a') and status = 'draft'), 3, 'D5 ... and the refused draft changed nothing');
select is(pg_temp.val('a_admin', format($q$select (public.knowledge_fact_decide(%s, %s, 'approve') ->> 'status')$q$, pg_temp.tid('a'), pg_temp.rid('f1'))), 'approved', 'D6 an Admin approves an ordinary fact');
select is(pg_temp.val('a_admin', format($q$select public.knowledge_fact_decide(%s, %s, 'approve')::text$q$, pg_temp.tid('a'), pg_temp.rid('f2'))), 'ERR:42501', 'D7 an Admin cannot approve a price');
select is(pg_temp.val('a_owner', format($q$select public.knowledge_fact_decide(%s, %s, 'approve')::text$q$, pg_temp.tid('a'), pg_temp.rid('f2')), 'aal1'), 'ERR:SM306', 'D8 the Owner needs the second factor for a price');
select is(pg_temp.val('a_owner', format($q$select (public.knowledge_fact_decide(%s, %s, 'approve') ->> 'status')$q$, pg_temp.tid('a'), pg_temp.rid('f2'))), 'approved', 'D9 with it, the price is approved');
select is(pg_temp.val('a_admin', format($q$select (public.knowledge_fact_decide(%s, %s, 'reject') ->> 'status')$q$, pg_temp.tid('a'), pg_temp.rid('f3'))), 'rejected', 'D10 rejecting is open to an Admin');
select is(pg_temp.val('a_owner', format($q$select (public.knowledge_fact_decide(%s, %s, 'maybe') ->> 'status')$q$, pg_temp.tid('a'), pg_temp.rid('f3'))), 'ERR:22023', 'D11 an unknown decision: invalid');
select is(pg_temp.val('a_owner', format($q$select (public.knowledge_fact_edit(%s, %s, 'Open every day from 9 am to 7 pm.') ->> 'status')$q$, pg_temp.tid('a'), pg_temp.rid('f1'))), 'draft', 'D12 an edit sends an approved fact back to draft');
select is((select edited from public.knowledge_facts where id = tests.rid('f1')), true, 'D13 ... marked as edited');
select is((select decided_at is null and decided_by is null from public.knowledge_facts where id = tests.rid('f1')), true, 'D14 ... with the earlier decision cleared');
select is(pg_temp.val('a_admin', format($q$select public.knowledge_fact_edit(%s, %s, 'The price is ₹ 10 now.', 'other')::text$q$, pg_temp.tid('a'), pg_temp.rid('f1'))), 'ERR:23514', 'D15 an edit cannot turn a fact into a hidden price either');
select pg_temp.val('a_owner', format($q$select public.knowledge_fact_decide(%s, %s, 'approve')::text$q$, pg_temp.tid('a'), pg_temp.rid('f1')));
select is(pg_temp.val('a_owner', format($q$select (public.knowledge_fact_add(%s, %s, 'faq', 'Parking is free for visitors.') ->> 'status')$q$, pg_temp.tid('a'), pg_temp.rid('f4'))), 'draft', 'D16 a fact written by hand is a draft too');
select is(pg_temp.val('a_owner', format($q$select public.knowledge_fact_add(%s, %s, 'faq', 'See https://example.com for more.')::text$q$, pg_temp.tid('a'), pg_temp.rid('f5'))), 'ERR:23514', 'D17 a fact carries no link to another site');
select is(pg_temp.val('a_owner', format($q$select public.knowledge_fact_add(%s, %s, 'weather', 'It is sunny.')::text$q$, pg_temp.tid('a'), pg_temp.rid('f5'))), 'ERR:23514', 'D18 an unknown kind is refused');
select is(pg_temp.val('a_owner', format($q$select public.knowledge_fact_add(%s, %s, 'faq', 'ab')::text$q$, pg_temp.tid('a'), pg_temp.rid('f5'))), 'ERR:22023', 'D19 a fact of two letters is invalid');
select is(pg_temp.val('a_sales', format($q$select public.knowledge_fact_decide(%s, %s, 'approve')::text$q$, pg_temp.tid('a'), pg_temp.rid('f4'))), 'ERR:42501', 'D20 Sales cannot decide');
-- a new draft round keeps the decided facts and replaces the undecided drafts
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.knowledge_facts_draft_replace(%s, %s, jsonb_build_array(jsonb_build_object('id', %s, 'kind', 'policy', 'text', 'Site visits need no booking on weekdays.'))))::text$q$, pg_temp.tid('a'), pg_temp.rid('s1'), pg_temp.rid('f6'))), '1', 'D21 a second round makes its own drafts');
select is((select string_agg(status, ',' order by status) from public.knowledge_facts where tenant_id = tests.tid('a') and source_id = tests.rid('s1')), 'approved,approved,draft,rejected', 'D22 ... and keeps what was decided (two approved, one rejected)');
select is(pg_temp.val('a_admin', format($q$select (public.knowledge_source_discard(%s, %s) ->> 'status')$q$, pg_temp.tid('a'), pg_temp.rid('s1'))), 'discarded', 'D23 a discarded source...');
select is((select count(*)::int from public.knowledge_facts where tenant_id = tests.tid('a') and source_id = tests.rid('s1') and status = 'draft'), 0, 'D24 ... drops its undecided drafts');
select is((select count(*)::int from public.knowledge_facts where tenant_id = tests.tid('a') and source_id = tests.rid('s1') and status = 'approved'), 2, 'D25 ... and keeps the approved facts');
select is(pg_temp.val('a_owner', format($q$select public.knowledge_facts_draft_replace(%s, %s, '[]'::jsonb)::text$q$, pg_temp.tid('a'), pg_temp.rid('s1'))), 'ERR:23503', 'D26 a discarded source cannot be drafted again');

-- ============================================================================ E. who sees what
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.knowledge_facts_list(%s))::text$q$, pg_temp.tid('a'))), '4', 'E1 the Owner sees every fact (two approved, one rejected, one draft)');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.knowledge_facts_list(%s))::text$q$, pg_temp.tid('a'))), '2', 'E2 Sales sees only the approved ones');
select is(pg_temp.val('a_viewer', format($q$select jsonb_array_length(public.knowledge_facts_list(%s, 'draft'))::text$q$, pg_temp.tid('a'))), '0', 'E3 ... even when it asks for the drafts');
select is(pg_temp.val('a_admin', format($q$select jsonb_array_length(public.knowledge_facts_list(%s, 'rejected'))::text$q$, pg_temp.tid('a'))), '1', 'E4 an Admin can filter by status');
select is(pg_temp.val('a_owner', format($q$select jsonb_array_length(public.knowledge_facts_list(%s, null, null, 1))::text$q$, pg_temp.tid('a'))), '1', 'E5 the page size is honoured');
select is(pg_temp.val('a_owner', format($q$select public.knowledge_facts_list(%s, 'bogus')::text$q$, pg_temp.tid('a'))), 'ERR:22023', 'E6 an unknown status: invalid');
select is(pg_temp.val('a_sales', format($q$select jsonb_array_length(public.knowledge_facts_approved(%s))::text$q$, pg_temp.tid('a'))), '2', 'E7 every member can read the approved facts for a prompt');
select is(pg_temp.val('a_sales', format($q$select (public.knowledge_facts_approved(%s) -> 0 ? 'id')::text$q$, pg_temp.tid('a'))), 'false', 'E8 ... which carry only the kind and the text');
select is(pg_temp.val('a_owner', format($q$select (public.knowledge_facts_list(%s) -> 0 ->> 'decided_by_you')$q$, pg_temp.tid('a'))), 'true', 'E9 a fact says whether you decided it');

-- ============================================================================ F. isolation
select is(pg_temp.val('b_owner', format($q$select public.knowledge_facts_list(%s)::text$q$, pg_temp.tid('a'))), 'ERR:42501', 'F1 another workspace''s facts are not readable');
select is(pg_temp.val('b_owner', format($q$select public.knowledge_fact_decide(%s, %s, 'approve')::text$q$, pg_temp.tid('b'), pg_temp.rid('f4'))), 'ERR:23503', 'F2 a fact id of another workspace is not found');
select is(pg_temp.val('b_owner', format($q$select public.knowledge_source_add(%s, %s, 'paste', 'Mine', null, null, 'text')::text$q$, pg_temp.tid('b'), pg_temp.rid('s2'))), 'ERR:22023', 'F3 a source id used by another workspace is refused');
select is(pg_temp.val('b_owner', format($q$select (public.lead_playbook_get(%s) ->> 'saved')$q$, pg_temp.tid('a'))), 'ERR:42501', 'F4 nor the playbook');

-- ============================================================================ G. the doors
select is((select count(*)::int from information_schema.role_table_grants where table_name in ('lead_playbooks', 'knowledge_sources', 'knowledge_facts') and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'), 0, 'G1 nobody can write the tables directly');
select is(pg_temp.val('anon', $q$select count(*)::text from public.knowledge_facts$q$), 'ERR:42501', 'G2 the public key cannot read the facts');
select is((select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('lead_playbook_get', 'lead_playbook_save', 'lead_playbook_reset', 'knowledge_source_add', 'knowledge_sources_list', 'knowledge_source_text', 'knowledge_source_discard', 'knowledge_facts_draft_replace', 'knowledge_fact_add', 'knowledge_fact_edit', 'knowledge_fact_decide', 'knowledge_facts_list', 'knowledge_facts_approved') and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')), 0, 'G3 none of the functions is open to the public key');

select * from finish();
rollback;
