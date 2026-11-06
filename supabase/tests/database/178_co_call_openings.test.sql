-- The call-openings bucket (migration 20261231310000): private; only the telephony worker (the scheduler principal) reads and writes; an Owner, a member and anon see nothing.
begin;
select no_plan();
select tests.seed_two_tenants();
select app.operator_register_scheduler('outsider@test.local');

select is((select public::text from storage.buckets where id = 'call-openings'), 'false', 'A1 the bucket is private');
insert into storage.objects (bucket_id, name, owner, metadata) values ('call-openings', tests.tid('a')::text || '/x.pcm', null, '{"mimetype": "application/octet-stream"}');
select is(tests.scalar_as(tests.uid('outsider'), $$select count(*)::text from storage.objects where bucket_id = 'call-openings'$$), '1', 'A2 the worker reads it');
select is(tests.scalar_as(tests.uid('a_owner'), $$select count(*)::text from storage.objects where bucket_id = 'call-openings'$$), '0', 'A3 an Owner does not');
select is(tests.scalar_as(tests.uid('b_admin'), $$select count(*)::text from storage.objects where bucket_id = 'call-openings'$$), '0', 'A4 nor anyone else');
select throws_ok(format($$select tests.scalar_as(%L, 'insert into storage.objects (bucket_id, name) values (''call-openings'', ''x/y.pcm'') returning name')$$, tests.uid('a_owner')), null, null, 'A5 an Owner cannot write there');
select is(tests.scalar_as(tests.uid('outsider'), $$insert into storage.objects (bucket_id, name) values ('call-openings', 'w/z.pcm') returning name$$), 'w/z.pcm', 'A6 the worker can');

select * from finish();
rollback;
