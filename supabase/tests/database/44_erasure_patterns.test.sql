-- T006b review fixes (ADR 0014): the identifier patterns of the sweep, as unit vectors AND through the real sweep.
--   phone: the national number, with an optional attached country prefix (+91 / 91 / 0) and separators; never inside a longer run of digits
--   host:  the host, with an optional www. in front; a subdomain or a longer host is a different host
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.open_gate('a');
select tests.open_gate('b');

-- ================================================================ phone: unit vectors
create temp table pv (v text primary key, hit boolean not null);
insert into pv values
  ('+91 98765 43210', true), ('919876543210', true), ('wa.me/919876543210', true), ('09876543210', true), ('+91-9876543210', true),
  ('(98765) 43210', true), ('98765.43210', true), ('call 9876543210 now', true), ('+919876543210', true), ('tel:+91 98765-43210;', true),
  ('119876543210', false), ('987654321012', false), ('9876543211', false), ('8876543210', false), ('98765 4321', false);
select is(ok.hit, pv.hit, 'phone pattern: ' || quote_literal(pv.v) || case when pv.hit then ' is swept' else ' is NOT swept' end)
  from pv, lateral (select pv.v ~* app.erasure_phone_pattern('+91 98765 43210') as hit) ok order by pv.hit desc, pv.v;
select is(app.erasure_phone_pattern('+91 98765 43210'), app.erasure_phone_pattern('09876543210'), 'the same number written two ways gives one pattern (the last ten digits)');
select is(app.erasure_phone_pattern('12345'), null, 'a number of fewer than seven digits identifies nobody');
select is(app.erasure_phone_pattern(null), null, 'no number, no pattern');
select is('x' || chr(2406) || chr(2415) || ' 98765 43210' ~* app.erasure_phone_pattern('+91 98765 43210'), true, 'sanity: the ASCII digits are found next to a non-ASCII numeral');
select is('९८७६५ ४३२१०' ~* app.erasure_phone_pattern('+91 98765 43210'), false, 'known limit: non-ASCII numerals (Devanagari, Telugu) are not matched');

-- ================================================================ host: unit vectors
create temp table hv (v text primary key, hit boolean not null);
insert into hv values
  ('https://acme-silks.test/x', true), ('https://www.acme-silks.test/x', true), ('WWW.ACME-SILKS.TEST', true), ('Visit acme-silks.test for more', true),
  ('mail@acme-silks.test', true), ('acme-silks.test.', true),
  ('https://shop.acme-silks.test/x', false), ('https://notacme-silks.test/x', false), ('https://acme-silks.test.evil.example/', false),
  ('https://sub.www.acme-silks.test/', false), ('acme-silks.testing', false);
select is(ok.hit, hv.hit, 'host pattern: ' || quote_literal(hv.v) || case when hv.hit then ' is swept' else ' is NOT swept' end)
  from hv, lateral (select hv.v ~* app.erasure_host_pattern('https://acme-silks.test/home') as hit) ok order by hv.hit desc, hv.v;
select is(app.erasure_host_pattern('https://www.acme-silks.test/home'), app.erasure_host_pattern('https://acme-silks.test'), 'a website written with or without www gives one pattern');
select is(app.erasure_host_pattern('https://facebook.com/acme'), null, 'a host many businesses share identifies nobody');

-- ================================================================ through the real sweep: a contact
update public.contacts set full_name = 'Pat Terson', email = 'pat.terson@canary.test', phone = '+91 98765 43210', job_title = null where id = tests.rid('a_contact');
update public.contacts set full_name = 'Pat Terson', email = 'pat.terson@canary.test', phone = '+91 98765 43210', job_title = null where id = tests.rid('b_contact');
create temp table pn as select v, hit, row_number() over (order by v) as n from pv;
insert into public.evidence (id, tenant_id, kind, provider, reference, snippet)
select tests.rid('a_p_' || n), tests.tid('a'), 'note', 'manual', 'note:p' || n, 'x ' || v || ' y' from pn;
insert into public.evidence (id, tenant_id, kind, provider, reference, snippet)
select tests.rid('b_p_' || n), tests.tid('b'), 'note', 'manual', 'note:p' || n, 'x ' || v || ' y' from pn where hit;
create temp table before_b as select tests.er_digest('b') as d;

select tests.scalar_as(tests.uid('a_owner'), format('select public.request_erasure(%L, %L, ''contact'', %L)', tests.rid('p1'), tests.tid('a'), tests.rid('a_contact')));
select tests.scalar_as(tests.uid('a_owner'), format('select public.execute_erasure(%L, false)', tests.rid('p1')));

select is((select count(*) from pn join public.evidence e on e.id = tests.rid('a_p_' || pn.n) where pn.hit and e.snippet like 'x %erased-1% y'),
          (select count(*) from pn where hit), 'the real sweep replaces every written form of the number');
select is((select coalesce(string_agg(pn.v, ' | ' order by pn.v), '') from pn join public.evidence e on e.id = tests.rid('a_p_' || pn.n) where pn.hit and e.snippet !~ 'erased-1'), '', 'none of them survives');
select is((select coalesce(string_agg(pn.v, ' | ' order by pn.v), '') from pn join public.evidence e on e.id = tests.rid('a_p_' || pn.n) where not pn.hit and e.snippet <> 'x ' || pn.v || ' y'), '', 'a different number, or digits inside a longer run, are left alone');
select is(tests.er_digest('b'), (select d from before_b), 'tenant b is byte-identical');

-- ================================================================ through the real sweep: a company website
update public.companies set name = 'Acme Silks Co', website = 'https://www.acme-silks.test/home', city = null, region = null, tags = '{}' where id = tests.rid('a_company');
create temp table hn as select v, hit, row_number() over (order by v) as n from hv;
insert into public.evidence (id, tenant_id, kind, provider, reference, snippet)
select tests.rid('a_h_' || n), tests.tid('a'), 'note', 'manual', 'note:h' || n, 'x ' || v || ' y' from hn;
select tests.scalar_as(tests.uid('a_owner'), format('select public.request_erasure(%L, %L, ''company'', %L)', tests.rid('h1'), tests.tid('a'), tests.rid('a_company')));
select tests.scalar_as(tests.uid('a_owner'), format('select public.execute_erasure(%L, false)', tests.rid('h1')));
select is((select coalesce(string_agg(hn.v, ' | ' order by hn.v), '') from hn join public.evidence e on e.id = tests.rid('a_h_' || hn.n) where hn.hit and e.snippet !~ 'erased'), '', 'the real sweep replaces the host with and without www.');
select is((select coalesce(string_agg(hn.v, ' | ' order by hn.v), '') from hn join public.evidence e on e.id = tests.rid('a_h_' || hn.n) where not hn.hit and e.snippet <> 'x ' || hn.v || ' y'), '', 'a subdomain or a longer host is left alone');

select * from finish();
rollback;
