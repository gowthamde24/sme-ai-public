-- Erasing a customer leaves one platform item naming the VoiceLink call ids of their recorded calls (migration 20261231989100).
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.er_plant('a');
select tests.er_plant('b');

create function pg_temp.w(p_sql text, p_user text default 'a_owner') returns text language plpgsql as $$
begin return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;

set local session_replication_role = replica;
update public.phone_calls set provider = 'voicelink', provider_call_sid = 'vl-call-1' where id = tests.rid('a_er_call');
update public.phone_calls set provider = 'voicelink', provider_call_sid = 'vl-call-b' where id = tests.rid('b_er_call');
reset session_replication_role;

select tests.scalar_as(tests.uid('a_owner'), format('select public.request_erasure(%L, %L, ''contact'', %L)', tests.rid('r1'), tests.tid('a'), tests.rid('a_contact')));

select is(pg_temp.w(format('select public.erasure_recordings_notify(%L)::text', tests.rid('r1')), 'a_admin'), 'ERR:42501', 'A1: only the Owner');
select is(pg_temp.w(format('select public.erasure_recordings_notify(%L)::text', tests.rid('r1')), 'b_owner'), 'ERR:42501', 'A2: not another workspace''s Owner');
select is(pg_temp.w(format('select public.erasure_recordings_notify(%L)::text', tests.rid('r1'))), '1', 'B1: one recorded call of that customer');
select is((select count(*) from admin.alerts where kind = 'recording_deletion')::int, 1, 'B2: one platform item');
select ok((select detail from admin.alerts where kind = 'recording_deletion') like '%vl-call-1%' and (select detail from admin.alerts where kind = 'recording_deletion') not like '%vl-call-b%', 'B3: it names this customer''s call id and no other workspace''s');
select is(pg_temp.w(format('select public.erasure_recordings_notify(%L)::text', tests.rid('r1'))), '1', 'B4: asking again counts the same');
select is((select count(*) from admin.alerts where kind = 'recording_deletion')::int, 1, 'B5: and raises no second item');

select * from finish();
rollback;
