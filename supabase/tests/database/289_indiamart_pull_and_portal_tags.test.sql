-- The scheduled IndiaMART pull (migration 20261231992400), the portal source tags (20261231992410) and the Today "Needs you" item for a refused key (20261231992420).
-- The worker's doors answer only the registered worker account; the window, the intake and the key state; a refused key is left alone until a new one is saved; a lead e-mail names its portal.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('x5@test.local');

create function pg_temp.q(p_user text, p_sql text) returns text language plpgsql as $$
begin
  return tests.scalar_as(tests.uid(p_user), format(p_sql, tests.tid('a')));
exception when others then return 'ERR:' || sqlstate;
end $$;

create function pg_temp.today_item(p_user text, p_tenant text) returns text language plpgsql as $$
begin
  return tests.scalar_as(tests.uid(p_user), format($q$select exists (select 1 from jsonb_array_elements(public.today_summary(%L) -> 'needs_you') e where e ->> 'kind' = 'indiamart_key_expired' and e -> 'target' ->> 'type' = 'lead_sources')::text$q$, tests.tid(p_tenant)));
exception when others then return 'ERR:' || sqlstate;
end $$;

-- ---- the owner connects IndiaMART (the source, then the saved key as the API does); nothing is due while the real-data gate is closed
select is(pg_temp.q('a_owner', $q$select public.lead_source_create(%L, gen_random_uuid(), 'indiamart', 'indiamart', 'IndiaMART', null, null, null, null, null)::text ~ 'indiamart'$q$), 'true', 'A1 the owner has an IndiaMART source');
set local session_replication_role = replica;
insert into public.workspace_secrets (tenant_id, kind, secret_name, last4, fingerprint, set_by)
values (tests.tid('a'), 'indiamart_key', 'sme-ws-' || tests.tid('a') || '-indiamart', 'abcd', repeat('a', 16), tests.uid('a_owner'));
reset session_replication_role;
select is(pg_temp.q('x5', $q$select jsonb_array_length(public.scheduler_indiamart_links(5))::text$q$), '0', 'A2 real data not allowed yet: nobody is due');
select tests.open_gate('a');
select is(pg_temp.q('x5', $q$select jsonb_array_length(public.scheduler_indiamart_links(5))::text$q$), '1', 'A3 the gate is open: the business is due');
select is(pg_temp.q('x5', $q$select (public.scheduler_indiamart_links(5) -> 0 ->> 'secret_name') = 'sme-ws-' || %L || '-indiamart'$q$), 'true', 'A4 the worker is told WHERE the key is kept, by name');
select is(pg_temp.q('x5', $q$select (public.scheduler_indiamart_links(5) -> 0)::text ~ 'abcd'$q$), 'false', 'A5 and never the key, not even its last four');
select is(pg_temp.q('a_owner', $q$select public.scheduler_indiamart_links(5)::text$q$), 'ERR:42501', 'A6 a person does not use the worker door');
select is(pg_temp.q('x5', $q$select public.scheduler_indiamart_links(0)::text$q$), 'ERR:22023', 'A7 a bad limit');

-- ---- the window
select is(pg_temp.q('x5', $q$select (public.scheduler_indiamart_begin(%L) ->> 'status')$q$), 'ok', 'B1 the first attempt gets a window');
select is(pg_temp.q('x5', $q$select (public.scheduler_indiamart_begin(%L) ->> 'status')$q$), 'too_soon', 'B3 a second attempt inside five minutes is refused');
select is(pg_temp.q('x5', $q$select jsonb_array_length(public.scheduler_indiamart_links(5))::text$q$), '0', 'B5 and it is not due again for 15 minutes');
select is(pg_temp.q('a_owner', $q$select public.scheduler_indiamart_begin(%L)::text$q$), 'ERR:42501', 'B6 a person cannot ask for a window');

-- ---- the buyers go through the shared intake; the same buyer twice is one lead
select is(pg_temp.q('x5', $q$select (public.scheduler_indiamart_apply(%L, '[{"name": "Invented Buyer One", "phone": "+00 99999 20001", "external_id": "QID-0001", "message": "Need 20 sarees"}, {"name": "Invented Buyer Two", "phone": "+00 99999 20002", "external_id": "QID-0002"}]'::jsonb, now(), 2) -> 'counts' ->> 'ready')$q$), '2', 'C1 two buyers, two leads');
select is((select count(*)::text from public.lead_arrivals a where a.tenant_id = tests.tid('a') and a.source_tag = 'indiamart'), '2', 'C2 each arrival is tagged indiamart');
select is(pg_temp.q('x5', $q$select (public.scheduler_indiamart_apply(%L, '[{"name": "Invented Buyer One", "phone": "+00 99999 20001", "external_id": "QID-0001"}]'::jsonb, now(), 1) -> 'counts' ->> 'already_imported')$q$), '1', 'C3 the same buyer again is recognised by IndiaMART''s own id');
select is((select count(*)::text from public.leads l where l.tenant_id = tests.tid('a') and l.source = 'indiamart'), '2', 'C4 still two leads');
select is(pg_temp.q('a_owner', $q$select public.indiamart_pull_status(%L) ->> 'key_state'$q$), 'ok', 'C5 the key is known to work after a pull');
select is(pg_temp.q('a_owner', $q$select (public.indiamart_pull_status(%L) ->> 'last_count')$q$), '1', 'C6 the status shows the last pull');
select is(pg_temp.q('x5', $q$select public.scheduler_indiamart_apply(%L, '[]'::jsonb, now() + interval '1 hour', 0)::text$q$), 'ERR:22023', 'C7 a window that ends in the future is refused');
select is(pg_temp.q('a_owner', $q$select public.scheduler_indiamart_apply(%L, '[]'::jsonb, now(), 0)::text$q$), 'ERR:42501', 'C8 a person cannot apply buyers');

-- ---- a refused key: told once, left alone, Needs-you for the Owner and Admin, gone with a new key
select is(pg_temp.q('x5', $q$select public.scheduler_indiamart_key_state(%L, 'expired')::text$q$), 'true', 'D1 the worker says the key is refused');
select is(pg_temp.q('x5', $q$select public.scheduler_indiamart_key_state(%L, 'broken')::text$q$), 'ERR:22023', 'D2 only ok or expired');
select is(pg_temp.q('a_owner', $q$select public.indiamart_pull_status(%L) ->> 'key_state'$q$), 'expired', 'D3 the Owner sees it');
select is(pg_temp.q('a_sales', $q$select public.indiamart_pull_status(%L)::text$q$), 'ERR:42501', 'D4 Sales does not');
update integrations.pull_state set last_attempt_at = now() - interval '20 minutes' where tenant_id = tests.tid('a');
select is(pg_temp.q('x5', $q$select jsonb_array_length(public.scheduler_indiamart_links(5))::text$q$), '0', 'D5 a refused key is not asked again');
update integrations.pull_state set key_state_at = now() where tenant_id = tests.tid('a');
select is(pg_temp.today_item('a_owner', 'a'), 'true', 'E1 the Owner sees a Needs-you item');
select is(pg_temp.today_item('a_admin', 'a'), 'true', 'E2 so does an Admin');
select is(pg_temp.today_item('a_sales', 'a'), 'false', 'E3 Sales does not');
select is(pg_temp.today_item('b_owner', 'b'), 'false', 'E4 another workspace does not');
select is(pg_temp.today_item('b_owner', 'a'), 'ERR:42501', 'E5 and cannot ask about workspace A');
-- the owner pastes a new key: the item goes at once, and the business is due again
update public.workspace_secrets set set_at = now() + interval '1 second' where tenant_id = tests.tid('a');
select is(pg_temp.today_item('a_owner', 'a'), 'false', 'E6 a newer key and the item is gone');
select is(pg_temp.q('a_owner', $q$select public.indiamart_pull_status(%L) ->> 'key_state'$q$), 'ok', 'E7 the status reads ok again at once');
select is(pg_temp.q('x5', $q$select jsonb_array_length(public.scheduler_indiamart_links(5))::text$q$), '1', 'E8 and the worker asks again');
select is(pg_temp.q('x5', $q$select public.scheduler_indiamart_key_state(%L, 'expired')::text$q$), 'true', 'E9 refused once more');

-- ---- the portal tags
select is(app.lead_tag_ok('sulekha') and app.lead_tag_ok('tradeindia') and app.lead_tag_ok('justdial') and not app.lead_tag_ok('nonsense'), true, 'F1 Sulekha and TradeIndia are known tags');
select is((select bool_and(pg_get_functiondef(p.oid) like '%''sulekha'', ''tradeindia''%') from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname in ('call_back_proof', 'outbox_active_conversation')), true, 'F2 the two functions that list the written sources name them too');
select is(pg_temp.q('a_owner', $q$select public.lead_source_create(%L, gen_random_uuid(), 'email_forward', 'email_forward', 'Portal e-mails', repeat('c', 64), 'wxyz', null, null, null)::text ~ 'email_forward'$q$), 'true', 'F3 a lead e-mail address');
select is(pg_temp.q('x5', $q$select public.scheduler_lead_intake_live(repeat('c', 64), '[{"name": "Invented Customer", "phone": "+00 99999 30001", "external_id": "m:1", "tag": "sulekha"}]'::jsonb) ->> 'status'$q$), 'received', 'F4 a Sulekha mail arrives');
select is((select a.source_tag from public.lead_arrivals a join public.contacts k on k.id = a.contact_id where a.tenant_id = tests.tid('a') and app.phone_norm(k.phone) = app.phone_norm('+00 99999 30001')), 'sulekha', 'F5 and is tagged with the portal, not email_forward');
select is(pg_temp.q('x5', $q$select public.scheduler_lead_intake_live(repeat('c', 64), '[{"name": "Invented Customer", "phone": "+00 99999 30002", "external_id": "m:2", "tag": "not_a_portal"}]'::jsonb) ->> 'status'$q$), 'received', 'F6 a tag that is not a portal is ignored');
select is((select a.source_tag from public.lead_arrivals a join public.contacts k on k.id = a.contact_id where a.tenant_id = tests.tid('a') and app.phone_norm(k.phone) = app.phone_norm('+00 99999 30002')), 'email_forward', 'F7 and the source''s own tag is used');
select is(pg_temp.q('a_owner', $q$select public.lead_source_create(%L, gen_random_uuid(), 'website_form', 'website_form', 'Website form', repeat('9', 64), 'wxyz', null, null, null)::text ~ 'website_form'$q$), 'true', 'F8 a website form');
select is(pg_temp.q('x5', $q$select public.scheduler_lead_intake_live(repeat('9', 64), '[{"name": "Invented Customer", "phone": "+00 99999 30003", "external_id": "w:1", "tag": "justdial"}]'::jsonb) ->> 'status'$q$), 'received', 'F9 a website form post that names a portal');
select is((select a.source_tag from public.lead_arrivals a join public.contacts k on k.id = a.contact_id where a.tenant_id = tests.tid('a') and app.phone_norm(k.phone) = app.phone_norm('+00 99999 30003')), 'website_form', 'F10 is still a website form lead (only mail and web-address sources may name a portal)');

select * from finish();
rollback;
