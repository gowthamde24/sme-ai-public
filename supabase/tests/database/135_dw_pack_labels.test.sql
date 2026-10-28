-- Job DW (28 Oct 2026): the menu word of the lead packs, "Find leads", is now "Leads" (to match "Catches every lead": nothing is searched for). Each of the eleven lead packs got a NEW version 2 (a synced version
-- is never edited) that differs only in that word; the workspaces pinned to version 1 moved to it. Textiles and construction materials are untouched ("Find retailers" is a real search).
--   A the new versions and their words   B the default   C the workspaces were moved   D nothing else changed
begin;
select no_plan();
select tests.seed_two_tenants();

create temp table dw_packs (code text) on commit drop;
insert into dw_packs values ('auto_dealer'), ('clinic'), ('coaching'), ('education'), ('general_business'), ('gym'), ('insurance_loans'), ('interiors_solar'), ('real_estate'), ('travel'), ('wholesale_b2b');

select is((select count(*) from dw_packs p join packs.pack_versions v on v.code = p.code and v.version = 2), 11::bigint, 'A1: all eleven lead packs have a version 2');
select is((select count(*) from dw_packs p join packs.pack_versions v on v.code = p.code and v.version = 1 where v.manifest -> 'labels' -> 'en' ->> 'nav.item.retailers' = 'Find leads'), 11::bigint, 'A2: version 1 of each is kept as it was ("Find leads")');
select is((select count(*) from dw_packs p join packs.pack_versions v on v.code = p.code and v.version = 2 where v.manifest -> 'labels' -> 'en' ->> 'nav.item.retailers' = 'Leads'), 11::bigint, 'A3: version 2 says "Leads"');
select is((select count(*) from dw_packs p join packs.pack_versions v on v.code = p.code and v.version = 2 where v.manifest -> 'labels' -> 'en' ->> 'agent.lead_finder' ~* 'finder'), 0::bigint, 'A4: no version 2 says Finder');
select is((select v.manifest -> 'labels' -> 'en' ->> 'agent.lead_finder' from packs.pack_versions v where v.code = 'education' and v.version = 2), 'Admissions Desk', 'A5: education keeps its Admissions Desk');
select is((select count(*) from packs.pack_versions v where v.code in ('textiles', 'construction_materials') and v.manifest -> 'labels' -> 'en' ->> 'agent.lead_finder' = 'Lead Finder'), 3::bigint, 'A6: textiles (1 version) and construction materials (2 versions) are untouched');

select is((select count(*) from packs.pack_versions where is_default), 1::bigint, 'B1: still exactly one default pack version');
select is((select code || ' ' || version from packs.pack_versions where is_default), 'textiles 1', 'B2: and it is still textiles version 1');

select is((select count(*) from dw_packs p join packs.pack_versions o on o.code = p.code and o.version = 1 join packs.pack_versions n on n.code = p.code and n.version = 2
            where (o.manifest - 'labels' - 'version') is distinct from (n.manifest - 'labels' - 'version')), 0::bigint, 'D1: apart from the labels and the version number the manifests are identical');
select is((select count(*) from dw_packs p join packs.pack_versions o on o.code = p.code and o.version = 1 join packs.pack_versions n on n.code = p.code and n.version = 2
            where exists (select 1 from jsonb_each(o.manifest -> 'labels') l(lang, words), jsonb_each_text(l.words) w(k, v)
                           where w.k <> 'nav.item.retailers' and (n.manifest -> 'labels' -> l.lang ->> w.k) is distinct from w.v)), 0::bigint, 'D2: every other label is unchanged');
select is((select count(*) from packs.pack_modules m join dw_packs p on p.code = m.code where m.version = 1), (select count(*) from packs.pack_modules m join dw_packs p on p.code = m.code where m.version = 2), 'D3: the same modules');

-- C: a workspace pinned to version 1 is moved by the migration's statement (run again here, on a workspace pinned back)
update packs.workspace_pack set pack_code = 'real_estate', pack_version = 1 where tenant_id = tests.tid('a');
update packs.workspace_pack w set pack_version = 2
 where w.pack_version = 1 and w.pack_code in (select code from dw_packs) and exists (select 1 from packs.pack_versions v where v.code = w.pack_code and v.version = 2);
select is((select pack_code || ' ' || pack_version from packs.workspace_pack where tenant_id = tests.tid('a')), 'real_estate 2', 'C1: a workspace on real estate version 1 is on version 2');
select is((select count(*) from packs.workspace_pack w join dw_packs p on p.code = w.pack_code where w.pack_version = 1), 0::bigint, 'C2: nobody is left on version 1 of these packs');

select * from finish();
rollback;
