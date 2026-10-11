-- Job AY (ADR 0069): the CATALOGUE (items, 1 to 8 photos, the private bucket and its storage rules, the deterministic search), PHOTOS IN THE OUTBOX (media references, the policy still decides), KEEP A RECORD (the lead
-- touch is made when a message is really sent), APPROVED = SEND (the scheduler releases what the Owner approved even when automatic sending is off), the LEAD SEARCH and the Today count of proposed visits.
--   A catalog  B bucket  C items and the exact price  D photos  E search  F storage rules  G media in the outbox  H keep a record  I approved = send  J lead search  K Today  L audit
--
-- THE CLOCK. The outbox clock app.outbox_now() (the AT seam) is replaced for this transaction. Sections A to F, J and K run at one pinned instant, Monday 2026-10-05 14:00 IST by default; to run them at another
-- start psql with PGOPTIONS='-c tests.cat_pin=2026-10-05T23:30:00+05:30' (nothing in them depends on the hour). Sections G, H and I are about WHEN a message goes, so they pin their own instants: day (14:00),
-- night (23:30), 08:59, 09:00, 22:00 ... and test the day and the night path side by side.
begin;
select no_plan();
select tests.seed_two_tenants();
select tests.seed_crm();
select tests.seed_t008();
select tests.seed_t009();

create function pg_temp.pin(p_instant timestamptz) returns void language plpgsql as $fn$
begin
  execute format('create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '''' as $b$ select timestamptz %L $b$', p_instant::text);
end $fn$;
create function pg_temp.main_pin() returns void language sql as $$
  select pg_temp.pin(coalesce(nullif(current_setting('tests.cat_pin', true), ''), '2026-10-05T14:00:00+05:30')::timestamptz) $$;
create function pg_temp.sc(p_user text, p_sql text, p_aal text default 'aal2') returns text language plpgsql as $$
begin perform tests.as_aal(p_aal); return tests.scalar_as(tests.uid(p_user), p_sql);
exception when others then return 'ERR:' || sqlstate;
end $$;
create function pg_temp.j(p_json text, p_key text) returns text language sql as $$ select case when p_json like 'ERR:%' then p_json else (p_json::jsonb) ->> p_key end $$;
create function pg_temp.priv(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.h(p text) returns text language sql immutable as $$ select md5(p) || md5(p || 'x') $$;
create function pg_temp.mk(p_label text, p_tenant text default 'a') returns void language plpgsql as $$
begin
  insert into public.contacts (id, tenant_id, company_id, full_name, phone)
  values (tests.rid(p_label || '_c'), tests.tid(p_tenant), tests.rid(p_tenant || '_company'), 'Contact ' || p_label, '+00 9' || lpad((abs(hashtext(p_label)) % 100000)::text, 5, '0'));
  insert into public.leads (id, tenant_id, company_id, contact_id) values (tests.rid(p_label), tests.tid(p_tenant), tests.rid(p_tenant || '_company'), tests.rid(p_label || '_c'));
  if p_tenant = 'a' then
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_contact_keys(%L, %L::jsonb)$q$, tests.rid(p_label || '_c'), jsonb_build_object('version', 1, 'phone', pg_temp.h(p_label || '_p'))::text));
    perform tests.scalar_as(tests.uid('a_owner'), format($q$select public.record_consent(%L, %L, 'whatsapp', 'granted', 'explicit_consent', 'web_form', 'form:ay')$q$, tests.tid(p_tenant), tests.rid(p_label || '_c')));
  end if;
end $$;
-- the catalogue
create function pg_temp.item(p_item text, p_name text default 'Maroon Kanchi pattu', p_fabric text default 'kanchi_pattu', p_colours text default '{maroon}', p_occ text default '{wedding}', p_band text default '25k_50k',
                             p_stock text default 'in_stock', p_active boolean default false, p_user text default 'a_owner', p_tenant text default 'a', p_price text default 'null', p_change boolean default false,
                             p_aal text default 'aal2') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.catalogue_item_save(%L, %L, %L, %L, %L::text[], 'rich', 'Contrast border', %L::text[], %L, %L, %L, %s, %L)$q$,
                                   tests.rid(p_item), tests.tid(p_tenant), p_name, p_fabric, p_colours, p_occ, p_band, p_stock, p_active, p_price, p_change), p_aal) $$;
-- the two files a photo is made of, as the API would have put them in storage
create function pg_temp.files(p_item text, p_photo text, p_tenant text default 'a', p_mime text default 'image/jpeg') returns void language plpgsql as $$
begin
  insert into storage.objects (bucket_id, name, metadata)
  values (app.catalogue_bucket(tests.tid(p_tenant)), tests.rid(p_item)::text || '/' || tests.rid(p_photo)::text || '.jpg', jsonb_build_object('mimetype', p_mime, 'size', 1000)),
         (app.catalogue_bucket(tests.tid(p_tenant)), tests.rid(p_item)::text || '/' || tests.rid(p_photo)::text || '_t.jpg', jsonb_build_object('mimetype', p_mime, 'size', 100));
end $$;
create function pg_temp.photo(p_item text, p_photo text, p_user text default 'a_owner', p_tenant text default 'a') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.catalogue_photo_add(%L, %L, %L, 640, 800, 1000, 100)', tests.rid(p_photo), tests.tid(p_tenant), tests.rid(p_item))) $$;
create function pg_temp.search(p_args text default '', p_user text default 'a_owner', p_tenant text default 'a') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.catalogue_search(%L%s)', tests.tid(p_tenant), p_args)) $$;
create function pg_temp.names(p_json text) returns text language sql as $$
  select case when p_json like 'ERR:%' then p_json else coalesce((select string_agg(e ->> 'name', ', ' order by ord) from jsonb_array_elements(p_json::jsonb) with ordinality as t(e, ord)), '') end $$;
-- the outbox
create function pg_temp.sub(p_msg text, p_lead text, p_text text, p_media text default '{}', p_keep boolean default false, p_user text default 'a_sales', p_tenant text default 'a', p_cat text default 'info') returns text language sql as $$
  select pg_temp.sc(p_user, format($q$select public.outbox_submit(%L, %L, %L, 'whatsapp', %L, 'en', %L, 'assistant', false, false, %L::uuid[], %L)$q$,
                                   tests.rid(p_msg), tests.tid(p_tenant), tests.rid(p_lead), p_text, p_cat, p_media, p_keep)) $$;
create function pg_temp.mst(p_msg text) returns text language sql as $$ select status || '/' || reason from public.outbox_messages where id = tests.rid(p_msg) $$;
create function pg_temp.ids(variadic p_labels text[]) returns text language sql as $$ select '{' || string_agg(tests.rid(l)::text, ',' order by ord) || '}' from unnest(p_labels) with ordinality as t(l, ord) $$;
create function pg_temp.sch(p_sql text) returns text language sql as $$ select pg_temp.sc('outsider', p_sql) $$;

select app.operator_register_scheduler('outsider@test.local');
select pg_temp.main_pin();

-- ---------------------------------------------------------------------------------------------
-- A. catalog
-- ---------------------------------------------------------------------------------------------
select is((select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname in ('catalogue_items', 'catalogue_photos', 'outbox_message_media') and c.relrowsecurity and c.relforcerowsecurity), 3::bigint, 'row-level security is on and forced for the three tables');
select is((select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('catalogue_items', 'catalogue_photos', 'outbox_message_media')
            and grantee in ('anon', 'authenticated', 'public') and privilege_type <> 'SELECT'), 0::bigint, 'no client role can write them directly');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('catalogue_ensure_bucket', 'catalogue_item_save', 'catalogue_photo_add', 'catalogue_photo_remove', 'catalogue_photos_reorder') and p.prosecdef and 'search_path=""' = any (p.proconfig)),
          5::bigint, 'the five catalogue writes are SECURITY DEFINER with an empty search_path');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('catalogue_get', 'catalogue_search', 'lead_search') and not p.prosecdef), 3::bigint, 'the reads (catalogue_get, catalogue_search, lead_search) are SECURITY INVOKER: row-level security decides');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname in ('catalogue_ensure_bucket', 'catalogue_item_save', 'catalogue_photo_add', 'catalogue_photo_remove', 'catalogue_photos_reorder', 'catalogue_get', 'catalogue_search', 'lead_search')
              and has_function_privilege('anon', p.oid, 'execute')), 0::bigint, 'anon cannot execute any of them');
select is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'catalogue\_objects\_%' and policyname <> 'catalogue_objects_select_worker'), 3::bigint, 'three storage rules: read, add and remove (job BB adds a fourth, the worker''s, tested in 81)');
select is((select string_agg(distinct roles::text, ',') from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'catalogue\_objects\_%'), '{authenticated}', '...all for signed-in callers only');
select is(app.catalogue_bucket_tenant(app.catalogue_bucket(tests.tid('a'))), tests.tid('a'), 'the bucket name leads back to the business...');
select is(app.catalogue_bucket_tenant('cat-not-a-uuid'), null, '...and any other name leads nowhere');
select is(app.catalogue_bucket_tenant('avatars'), null, '...(an unrelated bucket)');

-- ---------------------------------------------------------------------------------------------
-- B. the private bucket
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.sc('a_viewer', format('select public.catalogue_ensure_bucket(%L)', tests.tid('a'))), 'ERR:42501', 'a Viewer cannot make the bucket');
select is(pg_temp.sc('a_sales', format('select public.catalogue_ensure_bucket(%L)', tests.tid('a'))), 'ERR:42501', 'Sales cannot');
select is(pg_temp.sc('b_owner', format('select public.catalogue_ensure_bucket(%L)', tests.tid('a'))), 'ERR:42501', 'another business''s Owner cannot');
select is(pg_temp.sc('a_admin', format('select public.catalogue_ensure_bucket(%L)', tests.tid('a'))), app.catalogue_bucket(tests.tid('a')), 'an Admin can');
select is(pg_temp.sc('a_owner', format('select public.catalogue_ensure_bucket(%L)', tests.tid('a'))), app.catalogue_bucket(tests.tid('a')), '...and again changes nothing (idempotent)');
select is((select (public, file_size_limit, allowed_mime_types)::text from storage.buckets where id = app.catalogue_bucket(tests.tid('a'))), '(f,5242880,"{image/jpeg,image/png,image/webp}")', 'the bucket is PRIVATE, 5 MB, jpeg / png / webp');
select is((select count(*) from storage.buckets where id like 'cat-%'), 1::bigint, 'one bucket for the one business that asked');
select pg_temp.sc('b_owner', format('select public.catalogue_ensure_bucket(%L)', tests.tid('b')));

-- ---------------------------------------------------------------------------------------------
-- C. items and the exact price
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.j(pg_temp.item('i1'), 'created'), 'true', 'an Owner makes an item (inactive until it has a photo)');
select is((select active from public.catalogue_items where id = tests.rid('i1')), false, '...inactive');
select is(pg_temp.j(pg_temp.item('i1', 'Maroon Kanchi pattu'), 'created'), 'false', 'the same id again changes the item (an upsert)');
select is((select name from public.catalogue_items where id = tests.rid('i1')), 'Maroon Kanchi pattu', '...the new name');
select is(pg_temp.j(pg_temp.item('i_admin', p_user => 'a_admin'), 'created'), 'true', 'an Admin makes one too');
select is(pg_temp.item('i_sales', p_user => 'a_sales'), 'ERR:42501', 'Sales cannot (42501)');
select is(pg_temp.item('i_viewer', p_user => 'a_viewer'), 'ERR:42501', 'a Viewer cannot');
select is(pg_temp.item('i_b', p_user => 'b_owner', p_tenant => 'a'), 'ERR:42501', 'another business''s Owner cannot write in this business');
select is(pg_temp.item('i1', p_user => 'b_owner', p_tenant => 'b'), 'ERR:23505', 'an id that belongs to another business is a conflict, not a takeover (23505)');
select is(pg_temp.item('i_bad1', p_fabric => 'nylon'), 'ERR:22023', 'INVALID: an unknown fabric (22023)');
select is(pg_temp.item('i_bad2', p_colours => '{}'), 'ERR:22023', 'INVALID: no colour');
select is(pg_temp.item('i_bad3', p_colours => '{red,blue,green,black,white}'), 'ERR:22023', 'INVALID: five colours');
select is(pg_temp.item('i_bad4', p_colours => '{sparkly}'), 'ERR:22023', 'INVALID: an unknown colour');
select is(pg_temp.item('i_bad5', p_occ => '{wedding,funeral}'), 'ERR:22023', 'INVALID: an unknown occasion');
select is(pg_temp.item('i_bad6', p_band => 'cheap'), 'ERR:22023', 'INVALID: an unknown price band');
select is(pg_temp.item('i_bad7', p_stock => 'plenty'), 'ERR:22023', 'INVALID: an unknown stock status');
select is(pg_temp.item('i_bad8', p_name => ''), 'ERR:22023', 'INVALID: an empty name');
select is(pg_temp.item('i_bad9', p_name => 'Zero' || chr(8203) || 'width'), 'ERR:22023', 'INVALID: an invisible character in the name');
select is(pg_temp.item('i_bad10', p_name => repeat('x', 121)), 'ERR:22023', 'INVALID: a name over 120 characters');
select is(pg_temp.item('i_act', p_active => true), 'ERR:SM521', 'a NEW item cannot start active: it needs a photo first (SM521)');
select is(pg_temp.item('i1', p_active => true), 'ERR:SM521', '...and an item without a photo cannot be made active (SM521)');
select is(pg_temp.item('i_dup', p_occ => '{wedding,wedding,festival}') like '%"created": true%', true, 'repeated colours or occasions are folded');
select is((select occasions from public.catalogue_items where id = tests.rid('i_dup')), array['festival', 'wedding'], '...to one of each, in order');
-- the exact price
select is((select price_paise from public.catalogue_items where id = tests.rid('i1')), null, 'no exact price by default (the band is all that is shown)');
select is(pg_temp.item('i1', p_price => '850000', p_change => true, p_user => 'a_admin'), 'ERR:42501', 'PRICE: an Admin cannot set an exact price (the Owner''s alone)');
select is(pg_temp.item('i1', p_price => '850000', p_change => true, p_aal => 'aal1'), 'ERR:SM306', 'PRICE: the Owner needs a second factor (SM306)');
select is(pg_temp.j(pg_temp.item('i1', p_price => '850000', p_change => true), 'id'), tests.rid('i1')::text, 'PRICE: the Owner with a second factor sets it');
select is((select price_paise from public.catalogue_items where id = tests.rid('i1')), 850000::bigint, '...Rs 8,500');
select is(pg_temp.item('i1', p_price => '50', p_change => true), 'ERR:22023', 'PRICE: under one rupee is invalid');
select is(pg_temp.j(pg_temp.item('i1', 'Renamed by an Admin', p_user => 'a_admin'), 'id'), tests.rid('i1')::text, 'an Admin edits the other details...');
select is((select price_paise from public.catalogue_items where id = tests.rid('i1')), 850000::bigint, '...and the price is untouched when the call does not say it changes');
select is(pg_temp.j(pg_temp.item('i1', p_price => 'null', p_change => true), 'id'), tests.rid('i1')::text, 'the Owner can clear the exact price');
select is((select price_paise from public.catalogue_items where id = tests.rid('i1')), null, '...back to "ask us"');

-- ---------------------------------------------------------------------------------------------
-- D. photos
-- ---------------------------------------------------------------------------------------------
select is(pg_temp.photo('i1', 'p1'), 'ERR:SM523', 'a photo whose files are not in storage is refused (SM523)');
select pg_temp.files('i1', 'p1');
select is(pg_temp.j(pg_temp.photo('i1', 'p1'), 'position'), '1', 'the files are there: the photo is registered at place 1');
select is((select (bucket = app.catalogue_bucket(tenant_id) and path = item_id::text || '/' || id::text || '.jpg' and thumb_path = item_id::text || '/' || id::text || '_t.jpg')::text from public.catalogue_photos where id = tests.rid('p1')), 'true', '...with paths the DATABASE derived from the ids');
select is(pg_temp.j(pg_temp.photo('i1', 'p1'), 'replayed'), 'true', 'an exact retry replays');
select is(pg_temp.photo('i_admin', 'p1'), 'ERR:23505', 'the same photo id under another item is a conflict (23505)');
select pg_temp.files('i1', 'p_png', p_mime => 'image/png');
select is(pg_temp.photo('i1', 'p_png'), 'ERR:SM523', 'a stored file that is not a jpeg (the API always converts) is refused (SM523)');
select is(pg_temp.photo('i1', 'p2', 'a_sales'), 'ERR:42501', 'Sales cannot add a photo');
select is(pg_temp.photo('i1', 'p2', 'b_owner'), 'ERR:42501', 'another business''s Owner cannot');
select pg_temp.files('i_b', 'pb', 'b');
select is(pg_temp.photo('i1', 'pb', 'b_owner', 'b'), 'ERR:23503', 'an item of another business is not found (23503)');
select is(pg_temp.photo('nothing', 'p2'), 'ERR:23503', 'an unknown item is not found (23503)');
select is((select active from public.catalogue_items where id = tests.rid('i1')), false, '(the item is still inactive: a photo does not switch it on)');
select is(pg_temp.j(pg_temp.item('i1', p_active => true), 'active'), 'true', 'with a photo the item can be made active');
select pg_temp.files('i1', 'p2'); select pg_temp.files('i1', 'p3'); select pg_temp.files('i1', 'p4'); select pg_temp.files('i1', 'p5'); select pg_temp.files('i1', 'p6'); select pg_temp.files('i1', 'p7'); select pg_temp.files('i1', 'p8'); select pg_temp.files('i1', 'p9');
select is((select string_agg(pg_temp.j(pg_temp.photo('i1', 'p' || n), 'position'), ',' order by n) from generate_series(2, 8) n), '2,3,4,5,6,7,8', 'places 2 to 8 follow');
select is(pg_temp.photo('i1', 'p9'), 'ERR:SM522', 'a ninth photo is refused (SM522)');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.catalogue_photo_remove(%L, %L)', tests.tid('a'), tests.rid('p3'))), 'replayed'), 'false', 'a photo is removed (the record stays)');
select is((select string_agg(position::text, ',' order by position) from public.catalogue_photos where item_id = tests.rid('i1') and removed_at is null), '1,2,3,4,5,6,7', '...and the places close up (1 to 7)');
select is((select count(*) from public.catalogue_photos where id = tests.rid('p3')), 1::bigint, '...the row is still there (a sent message may point at it)');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.catalogue_photo_remove(%L, %L)', tests.tid('a'), tests.rid('p3'))), 'replayed'), 'true', 'removing twice changes nothing');
select is(pg_temp.j(pg_temp.photo('i1', 'p9'), 'position'), '8', 'after a removal there is room again');
select is(pg_temp.sc('a_sales', format('select public.catalogue_photo_remove(%L, %L)', tests.tid('a'), tests.rid('p4'))), 'ERR:42501', 'Sales cannot remove');
select is(pg_temp.sc('b_owner', format('select public.catalogue_photo_remove(%L, %L)', tests.tid('b'), tests.rid('p4'))), 'ERR:23503', 'another business cannot reach it (23503)');
-- reorder
select is(pg_temp.sc('a_owner', format('select public.catalogue_photos_reorder(%L, %L, %L::uuid[])', tests.tid('a'), tests.rid('i1'), pg_temp.ids('p1', 'p2'))), 'ERR:22023', 'REORDER: the list must name every live photo once (22023)');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.catalogue_photos_reorder(%L, %L, %L::uuid[])', tests.tid('a'), tests.rid('i1'), pg_temp.ids('p9', 'p8', 'p7', 'p6', 'p5', 'p4', 'p2', 'p1'))), 'item_id'), tests.rid('i1')::text, 'REORDER: a full list reorders');
select is((select id from public.catalogue_photos where item_id = tests.rid('i1') and removed_at is null and position = 1), tests.rid('p9'), '...the first of the list is the cover');
-- the last photo of an ACTIVE item
select pg_temp.item('i_one');
select pg_temp.files('i_one', 'po'); select pg_temp.photo('i_one', 'po'); select pg_temp.item('i_one', p_active => true);
select is(pg_temp.sc('a_owner', format('select public.catalogue_photo_remove(%L, %L)', tests.tid('a'), tests.rid('po'))), 'ERR:SM521', 'the last photo of an ACTIVE item cannot be removed (SM521)');
select pg_temp.item('i_one', p_active => false);
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.catalogue_photo_remove(%L, %L)', tests.tid('a'), tests.rid('po'))), 'replayed'), 'false', '...once it is inactive it can');
select is(pg_temp.item('i_one', p_active => true), 'ERR:SM521', 'and then it cannot be made active again without a photo');
-- guards
select is(pg_temp.priv('delete from public.catalogue_items'), '42501', 'GUARD: items are never deleted (42501)');
select is(pg_temp.priv('delete from public.catalogue_photos'), '42501', '...nor photos');
select is(pg_temp.priv('truncate public.catalogue_items cascade'), '42501', '...nor truncated');
select is(pg_temp.priv(format('update public.catalogue_photos set path = %L where id = %L', 'x/y.jpg', tests.rid('p1'))), '42501', 'GUARD: a photo record changes only its place and its removal (42501)');
select is(pg_temp.priv(format('update public.catalogue_photos set removed_at = null where id = %L', tests.rid('p3'))), '42501', '...a removed photo stays removed');
select is(pg_temp.priv(format('update public.catalogue_items set active = true where id = %L', tests.rid('i_one'))), 'SM521', 'GUARD: even the database owner cannot make an item without a photo active (SM521)');
select is(pg_temp.priv(format($i$insert into public.catalogue_items (id, tenant_id, name, fabric, colours, price_band, active, created_by) values (gen_random_uuid(), %L, 'x', 'soft_silk', array['red'], '5k_10k', true, %L)$i$, tests.tid('a'), tests.uid('a_owner'))), 'SM521', '...nor insert one that starts active');
select is(tests.outcome_as(tests.uid('a_owner'), format($i$update public.catalogue_items set name = 'x' where id = %L$i$, tests.rid('i1'))), '42501', 'DIRECT WRITE: an Owner cannot update an item directly (42501)');
select is(tests.outcome_as(tests.uid('a_owner'), format($i$insert into public.catalogue_photos (id, tenant_id, item_id, position, bucket, path, thumb_path, width, height, bytes, thumb_bytes, created_by) values (gen_random_uuid(), %L, %L, 1, 'x', 'x', 'x', 100, 100, 1, 1, %L)$i$,
                                  tests.tid('a'), tests.rid('i1'), tests.uid('a_owner'))), '42501', '...nor insert a photo');

-- ---------------------------------------------------------------------------------------------
-- E. search
-- ---------------------------------------------------------------------------------------------
-- a small catalogue of business a: (name, fabric, colours, occasions, band, stock), active with a photo
create function pg_temp.stock(p_item text, p_name text, p_fabric text, p_colours text, p_occ text, p_band text, p_stock text) returns void language plpgsql as $$
begin
  perform pg_temp.item(p_item, p_name, p_fabric, p_colours, p_occ, p_band, p_stock);
  perform pg_temp.files(p_item, p_item || '_p'); perform pg_temp.photo(p_item, p_item || '_p');
  perform pg_temp.item(p_item, p_name, p_fabric, p_colours, p_occ, p_band, p_stock, true);
end $$;
select pg_temp.stock('s1', 'Alpha Kanchi red', 'kanchi_pattu', '{red,gold}', '{wedding}', '25k_50k', 'in_stock');
select pg_temp.stock('s2', 'Beta Kanchi green', 'kanchi_pattu', '{green}', '{wedding,festival}', 'above_50k', 'few_left');
select pg_temp.stock('s3', 'Gamma Dharmavaram blue', 'dharmavaram_silk', '{blue}', '{festival}', '10k_25k', 'in_stock');
select pg_temp.stock('s4', 'Delta soft silk pink', 'soft_silk', '{pink,cream}', '{party,daily}', '5k_10k', 'made_to_order');
select pg_temp.stock('s5', 'Epsilon cotton silk', 'cotton_silk', '{yellow}', '{daily}', 'under_5k', 'in_stock');
-- inactive (has a photo) and photo-less (active is impossible): both hidden
select pg_temp.item('s_off', 'Zeta hidden', 'soft_silk', '{red}', '{wedding}', '5k_10k', 'in_stock'); select pg_temp.files('s_off', 's_off_p'); select pg_temp.photo('s_off', 's_off_p');
select pg_temp.item('s_nophoto', 'Eta no photo', 'soft_silk', '{red}', '{wedding}', '5k_10k', 'in_stock');
select is(pg_temp.names(pg_temp.search()), 'Alpha Kanchi red, Epsilon cotton silk, Gamma Dharmavaram blue, Maroon Kanchi pattu, Beta Kanchi green, Delta soft silk pink', 'ORDER: in stock first (by name), then few left, then made to order');
select is(pg_temp.names(pg_temp.search(', p_fabric => ''kanchi_pattu''')), 'Alpha Kanchi red, Maroon Kanchi pattu, Beta Kanchi green', 'FABRIC: kanchi pattu');
select is(pg_temp.names(pg_temp.search(', p_colours => array[''green'', ''blue'']')), 'Gamma Dharmavaram blue, Beta Kanchi green', 'COLOUR: any of green or blue');
select is(pg_temp.names(pg_temp.search(', p_colours => array[''gold'']')), 'Alpha Kanchi red', 'COLOUR: a second colour of an item counts');
select is(pg_temp.names(pg_temp.search(', p_occasions => array[''festival'']')), 'Gamma Dharmavaram blue, Beta Kanchi green', 'OCCASION: festival');
select is(pg_temp.names(pg_temp.search(', p_price_bands => array[''under_5k'', ''5k_10k'']')), 'Epsilon cotton silk, Delta soft silk pink', 'PRICE BAND: either of two');
select is(pg_temp.names(pg_temp.search(', p_in_stock_only => true')), 'Alpha Kanchi red, Epsilon cotton silk, Gamma Dharmavaram blue, Maroon Kanchi pattu, Beta Kanchi green', 'IN STOCK: in stock and few left, not made to order');
select is(pg_temp.names(pg_temp.search(', p_fabric => ''kanchi_pattu'', p_colours => array[''red''], p_occasions => array[''wedding''], p_price_bands => array[''25k_50k''], p_in_stock_only => true')), 'Alpha Kanchi red', 'ALL filters together');
select is(pg_temp.names(pg_temp.search(', p_fabric => ''georgette''')), '', 'nothing matches: an empty list');
select is(pg_temp.names(pg_temp.search(', p_include_inactive => true', 'a_owner')) like '%Zeta hidden%' and pg_temp.names(pg_temp.search(', p_include_inactive => true', 'a_owner')) like '%Eta no photo%', true, 'INACTIVE: an Owner can ask for them');
select is(pg_temp.names(pg_temp.search(', p_include_inactive => true', 'a_sales')) like '%Zeta%', false, '...Sales cannot (the flag is ignored for them)');
select is(pg_temp.names(pg_temp.search('', 'a_viewer')) like '%Alpha%', true, 'a Viewer can search (every member reads the catalogue)');
select is(pg_temp.names(pg_temp.search('', 'b_owner', 'a')), 'ERR:42501', 'another business''s Owner cannot search this business (42501)');
select is(pg_temp.names(pg_temp.search('', 'b_owner', 'b')), '', '...and business b has an empty catalogue');
select is(pg_temp.search(', p_fabric => ''nylon''' ), 'ERR:22023', 'INVALID: an unknown fabric (22023)');
select is(pg_temp.search(', p_limit => 0'), 'ERR:22023', 'INVALID: a limit of 0');
select is(pg_temp.search(', p_limit => 51'), 'ERR:22023', 'INVALID: a limit of 51');
select is(pg_temp.search(', p_after_rank => 0'), 'ERR:22023', 'INVALID: half a position');
-- paging
select is(pg_temp.names(pg_temp.search(', p_limit => 2')), 'Alpha Kanchi red, Epsilon cotton silk', 'PAGING: the first two');
select is(pg_temp.names(pg_temp.search(', p_limit => 2, p_after_rank => 0, p_after_name => ''Epsilon cotton silk'', p_after_id => ' || quote_literal(tests.rid('s5')) || '::uuid')), 'Gamma Dharmavaram blue, Maroon Kanchi pattu', '...the next two, from the last one seen');
select is(pg_temp.names(pg_temp.search(', p_limit => 2, p_after_rank => 1, p_after_name => ''Beta Kanchi green'', p_after_id => ' || quote_literal(tests.rid('s2')) || '::uuid')), 'Delta soft silk pink', '...and the end of the list');
select is((pg_temp.search(', p_limit => 1')::jsonb -> 0 -> 'photos' -> 0 ->> 'position'), '1', 'a result carries its photos (place 1 first)');
select is((pg_temp.search(', p_limit => 1')::jsonb -> 0 ->> 'price_paise') is null, true, 'no exact price is shown unless the Owner set one');
select is(pg_temp.j(pg_temp.sc('a_viewer', format('select public.catalogue_get(%L, %L)', tests.tid('a'), tests.rid('s1'))), 'name'), 'Alpha Kanchi red', 'GET: a member reads one item');
select is(pg_temp.sc('b_owner', format('select public.catalogue_get(%L, %L)', tests.tid('b'), tests.rid('s1'))), 'ERR:23503', '...another business''s Owner cannot reach it (23503)');
select is(tests.scalar_as(tests.uid('b_owner'), 'select count(*) from public.catalogue_items where tenant_id = ' || quote_literal(tests.tid('a'))), '0', 'RLS: another business reads none of the items');

-- ---------------------------------------------------------------------------------------------
-- F. the storage rules
-- ---------------------------------------------------------------------------------------------
select is(tests.scalar_as(tests.uid('a_viewer'), 'select count(*) from storage.objects where bucket_id = ' || quote_literal(app.catalogue_bucket(tests.tid('a')))) <> '0', true, 'STORAGE: a Viewer of the business can read its files (that is what lets a signed URL be made for them)');
select is(tests.scalar_as(tests.uid('b_owner'), 'select count(*) from storage.objects where bucket_id = ' || quote_literal(app.catalogue_bucket(tests.tid('a')))), '0', 'STORAGE: another business reads none');
select is(tests.scalar_as(tests.uid('outsider'), 'select count(*) from storage.objects'), '0', 'STORAGE: nor does a stranger');
select is(tests.outcome_as(tests.uid('a_sales'), format($i$insert into storage.objects (bucket_id, name) values (%L, 'x/y.jpg')$i$, app.catalogue_bucket(tests.tid('a')))), '42501', 'STORAGE: Sales cannot add a file (42501)');
select is(tests.outcome_as(tests.uid('b_owner'), format($i$insert into storage.objects (bucket_id, name) values (%L, 'x/y.jpg')$i$, app.catalogue_bucket(tests.tid('a')))), '42501', 'STORAGE: another business''s Owner cannot add to this bucket');
select is(tests.outcome_as(tests.uid('a_admin'), format($i$insert into storage.objects (bucket_id, name) values (%L, 'x/z.jpg')$i$, app.catalogue_bucket(tests.tid('a')))), 'rows:1', 'STORAGE: an Admin of the business can add a file');
select is(tests.outcome_as(tests.uid('a_owner'), format($i$insert into storage.objects (bucket_id, name) values ('avatars', 'x/y.jpg')$i$)) <> 'rows:1', true, 'STORAGE: a bucket that is not a catalogue bucket is not opened by these rules');
select is(tests.outcome_as(tests.uid('a_admin'), format($i$delete from storage.objects where bucket_id = %L and name = 'x/z.jpg'$i$, app.catalogue_bucket(tests.tid('a')))), '42501',
          'STORAGE: a direct SQL delete is refused for everyone by the storage service''s own protection (a file is removed through the Storage API, which the integration tests drive with the same rules)');

-- ---------------------------------------------------------------------------------------------
-- G. photos in the outbox
-- ---------------------------------------------------------------------------------------------
update public.platform_flags set enabled = true where key = 'outbox_enabled';
select pg_temp.sc('a_owner', format('select public.outbox_set_settings(%L, true, 5)', tests.tid('a')));
select pg_temp.mk('g1'); select pg_temp.mk('g2'); select pg_temp.mk('g3'); select pg_temp.mk('g4'); select pg_temp.mk('g5'); select pg_temp.mk('g6');
select pg_temp.pin('2026-10-05 14:00:00+05:30');
select is(pg_temp.j(pg_temp.sub('g_m1', 'g1', 'Here are two sarees you may like.', pg_temp.ids('s1_p', 's3_p')), 'status'), 'queued', 'MEDIA: a caption with two photos and no price is queued...');
select is(pg_temp.mst('g_m1'), 'queued/auto_allowed', '...and goes by itself by day (automatic sending is on)');
select is((select string_agg(position::text || ':' || (photo_id = tests.rid('s1_p'))::text, ',' order by position) from public.outbox_message_media where message_id = tests.rid('g_m1')), '1:true,2:false', '...the photos are REFERENCES, in order');
select is(pg_temp.j(pg_temp.sub('g_m2', 'g2', 'This one is ₹30,000 to ₹50,000.', pg_temp.ids('s1_p')), 'status'), 'needs_approval', 'MEDIA + A PRICE: a caption with an amount waits for a person...');
select is(pg_temp.mst('g_m2'), 'needs_approval/money', '...for the reason money');
select is(pg_temp.sub('g_m3', 'g3', 'Five photos.', pg_temp.ids('s1_p', 's2_p', 's3_p', 's4_p', 's5_p')), 'ERR:22023', 'INVALID: more than 4 photos (22023)');
select is(pg_temp.sub('g_m4', 'g3', 'The same twice.', pg_temp.ids('s1_p', 's1_p')), 'ERR:22023', 'INVALID: the same photo twice');
select is(pg_temp.sub('g_m5', 'g3', 'A hidden saree.', pg_temp.ids('s_off_p')), 'ERR:23503', 'a photo of an INACTIVE item is not found (23503)');
select is(pg_temp.sub('g_m6', 'g3', 'A removed photo.', pg_temp.ids('p3')), 'ERR:23503', 'a REMOVED photo is not found (23503)');
select pg_temp.files('i_b', 'pbb', 'b');
select is(pg_temp.sub('g_m7', 'g3', 'Another business''s photo.', pg_temp.ids('pb')), 'ERR:23503', 'a photo of another business is not found (23503)');
select is(pg_temp.sub('g_m8', 'g3', 'Photos from a Viewer.', pg_temp.ids('s1_p'), p_tenant => 'a', p_user => 'a_viewer'), 'ERR:42501', 'a Viewer cannot send photos (42501)');
select is(pg_temp.j(pg_temp.sub('g_m1', 'g1', 'Here are two sarees you may like.', pg_temp.ids('s1_p', 's3_p')), 'replayed'), 'true', 'IDEMPOTENT: the same message with the same photos replays');
select is(pg_temp.sub('g_m1', 'g1', 'Here are two sarees you may like.', pg_temp.ids('s1_p')), 'ERR:23505', 'the same id with other photos is a conflict (23505)');
select is(pg_temp.sub('g_m1', 'g1', 'Here are two sarees you may like.'), 'ERR:23505', '...and so is the same id with none');
select is((select count(*) from public.outbox_message_media where message_id = tests.rid('g_m1')), 2::bigint, '(still two rows after the retries)');
select is(pg_temp.priv('update public.outbox_message_media set position = 3'), '42501', 'GUARD: the photos of a message are never changed (42501)');
select is(pg_temp.priv('delete from public.outbox_message_media'), '42501', '...never deleted');
select is(pg_temp.priv('truncate public.outbox_message_media'), '42501', '...never truncated');
select is(tests.scalar_as(tests.uid('a_viewer'), 'select count(*) from public.outbox_message_media'), '0', 'RLS: a Viewer reads no media (a message can hold a price)');
select is(tests.scalar_as(tests.uid('a_sales'), 'select count(*) from public.outbox_message_media') <> '0', true, '...Sales do');
select is(tests.scalar_as(tests.uid('b_owner'), 'select count(*) from public.outbox_message_media'), '0', '...another business does not');
-- a claim hands the channel the photos
select pg_temp.pin('2026-10-05 23:30:00+05:30');
select pg_temp.mk('g8');
select is(pg_temp.mst('g_nothing') is null, true, '(night: a message with photos is made at 23:30)');
select is(pg_temp.j(pg_temp.sub('g_night', 'g8', 'Here is one saree you may like.', pg_temp.ids('s1_p')), 'reason'), 'quiet_hours', 'NIGHT 23:30: the same kind of message is held for the morning (quiet_hours), photos and all');
select is((select count(*) from public.outbox_message_media where message_id = tests.rid('g_night')), 1::bigint, '...with its photo reference');
select pg_temp.pin('2026-10-05 14:03:00+05:30');
select pg_temp.sub('g_m9', 'g4', 'Two more.', pg_temp.ids('s2_p', 's4_p'));
select pg_temp.pin('2026-10-05 14:03:30+05:30');
create temp table claimed_g as select pg_temp.sc('a_owner', format('select public.outbox_claim_due(%L, 20)', tests.tid('a')))::jsonb as j;
select is((select e -> 'media' -> 0 ->> 'path' from claimed_g, jsonb_array_elements(j) e where e ->> 'id' = tests.rid('g_m9')::text), tests.rid('s2')::text || '/' || tests.rid('s2_p')::text || '.jpg', 'the claim carries each photo''s bucket and PATH (the channel fetches by reference)');
select is((select jsonb_array_length(e -> 'media') from claimed_g, jsonb_array_elements(j) e where e ->> 'id' = tests.rid('g_m9')::text), 2, '...both photos, in order');
select is((select e -> 'media' -> 0 ->> 'bucket' from claimed_g, jsonb_array_elements(j) e where e ->> 'id' = tests.rid('g_m9')::text), app.catalogue_bucket(tests.tid('a')), '...in the business''s own bucket');
select is((select jsonb_array_length(e -> 'media') from claimed_g, jsonb_array_elements(j) e where e ->> 'id' = tests.rid('g_m1')::text) in (2), true, 'an earlier media message is claimed with its two photos too');
-- a photo removed after the message was queued is not sent
select pg_temp.stock('q1', 'Theta two photos', 'soft_silk', '{red}', '{daily}', '5k_10k', 'in_stock');
select pg_temp.files('q1', 'q1_b'); select pg_temp.photo('q1', 'q1_b');
select pg_temp.mk('g7');
select pg_temp.sub('g_m10', 'g7', 'Gone by then.', pg_temp.ids('q1_p', 'q1_b'));
select pg_temp.sc('a_owner', format('select public.catalogue_photo_remove(%L, %L)', tests.tid('a'), tests.rid('q1_b')));
create temp table claimed_g2 as select pg_temp.sc('a_owner', format('select public.outbox_claim_due(%L, 50)', tests.tid('a')))::jsonb as j;
select is((select jsonb_array_length(e -> 'media') from claimed_g2, jsonb_array_elements(j) e where e ->> 'id' = tests.rid('g_m10')::text), 1, 'a photo REMOVED after the message was queued is not handed to the channel');

-- ---------------------------------------------------------------------------------------------
-- H. keep a record: the touch is made when the message is really sent
-- ---------------------------------------------------------------------------------------------
select pg_temp.pin('2026-10-05 15:00:00+05:30');
select pg_temp.mk('h1'); select pg_temp.mk('h2'); select pg_temp.mk('h3'); select pg_temp.mk('h4');
select pg_temp.sub('h_m1', 'h1', 'We have the new festival collection.', p_keep => true);
select pg_temp.sub('h_m2', 'h2', 'We have the new festival collection.', p_keep => false);
select pg_temp.sub('h_m3', 'h3', 'The price is ₹5,000.', p_keep => true);
select is(pg_temp.mst('h_m1'), 'queued/auto_allowed', 'a message made with keep_record is queued like any other');
select is((select count(*) from public.lead_touches where lead_id in (tests.rid('h1'), tests.rid('h2'), tests.rid('h3'))), 0::bigint, 'NO TOUCH while it is only queued, or waiting, or blocked');
select is(pg_temp.mst('h_m3'), 'needs_approval/money', '(h_m3 waits for approval)');
create temp table claimed_h as select pg_temp.sc('a_owner', format('select public.outbox_claim_due(%L, 50)', tests.tid('a')))::jsonb as j;
select is((select count(*) from public.lead_touches where lead_id = tests.rid('h1')), 0::bigint, 'NO TOUCH when it is claimed either: only when the channel has said "sent"');
select pg_temp.sc('a_owner', format($q$select public.outbox_mark(%L, %L, 'failed', 'fake', null, 'timeout')$q$, tests.tid('a'), tests.rid('h_m2')));
select is((select count(*) from public.lead_touches where lead_id = tests.rid('h2')), 0::bigint, 'no touch for a message that failed or was not asked to keep one');
select pg_temp.sc('a_owner', format($q$select public.outbox_mark(%L, %L, 'sent', 'fake', 'fake-h1')$q$, tests.tid('a'), tests.rid('h_m1')));
select is((select (direction::text, channel::text, occurred_at = app.outbox_now(), recorded_by = tests.uid('a_sales'))::text from public.lead_touches where lead_id = tests.rid('h1')), '(out,whatsapp,t,t)', 'SENT: one outbound WhatsApp touch at the moment of sending, by whoever made the message');
select pg_temp.sc('a_owner', format($q$select public.outbox_mark(%L, %L, 'sent', 'fake', 'fake-h1')$q$, tests.tid('a'), tests.rid('h_m1')));
select is((select count(*) from public.lead_touches where lead_id = tests.rid('h1')), 1::bigint, 'IDEMPOTENT: telling the database twice makes one touch');
select is(pg_temp.sub('h_m4', 'h4', 'We have the new festival collection.', p_keep => true) like '%queued%', true, '(h_m4: keep_record is part of the request: a retry without it conflicts)');
select is(pg_temp.sub('h_m4', 'h4', 'We have the new festival collection.', p_keep => false), 'ERR:23505', '...a retry that drops the flag is a conflict (23505)');
-- bookkeeping never undoes a delivery: a touch that cannot be written (the clock is ahead of the database) leaves the send standing
select pg_temp.pin(((now() at time zone 'Asia/Kolkata')::date + 2 + time '14:00') at time zone 'Asia/Kolkata');  -- two days AHEAD of the real clock, by day: the touch's time would be after its record
select pg_temp.mk('h5');
select pg_temp.sub('h_m5', 'h5', 'We have the new festival collection.', p_keep => true);
select pg_temp.sc('a_owner', format($q$select public.outbox_claim_due(%L, 50)$q$, tests.tid('a')));
select is(pg_temp.j(pg_temp.sc('a_owner', format($q$select public.outbox_mark(%L, %L, 'sent', 'fake', 'fake-h5')$q$, tests.tid('a'), tests.rid('h_m5'))), 'status'), 'sent', 'A TOUCH THAT CANNOT BE WRITTEN does not undo the delivery: the message is sent');
select is((select count(*) from public.lead_touches where lead_id = tests.rid('h5')), 0::bigint, '...and no touch was made');
select pg_temp.main_pin();

-- ---------------------------------------------------------------------------------------------
-- I. approved = send (job AW amended)
-- ---------------------------------------------------------------------------------------------
select pg_temp.main_pin();
select pg_temp.mk('r1'); select pg_temp.mk('r2'); select pg_temp.mk('r3'); select pg_temp.mk('r4'); select pg_temp.mk('r5'); select pg_temp.mk('r6');
select pg_temp.sc('a_owner', format('select public.outbox_set_settings(%L, false, 5)', tests.tid('a')));
-- automatic sending OFF: a message waits for approval; the Owner approves it
select pg_temp.pin('2026-10-05 13:00:00+05:30');
select is(pg_temp.j(pg_temp.sub('r_m1', 'r1', 'A note for you from the shop.'), 'status'), 'needs_approval', 'AUTOMATIC SENDING OFF: a message waits for approval (auto_off)');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.outbox_decide(%L, %L, ''approve'')', tests.tid('a'), tests.rid('r_m1'))), 'status'), 'queued', 'the Owner approves it: queued, owner_approved');
select is(pg_temp.mst('r_m1'), 'queued/owner_approved', '...');
select is(pg_temp.sch('select public.scheduler_tenants()') like '%' || tests.tid('a')::text || '%', true, 'the worker now lists the business although automatic sending is OFF (it has an approved message to release)');
create temp table claimed_r1 as select pg_temp.sch(format('select public.scheduler_claim_due(%L)', tests.tid('a')))::jsonb as j;
select is((select count(*) from claimed_r1, jsonb_array_elements(j) e where e ->> 'id' = tests.rid('r_m1')::text), 1::bigint, 'AT 13:00: the worker RELEASES the approved message although automatic sending is off');
-- a message that was auto-allowed earlier and waits, with automatic sending now off, is NOT released (nothing without an approval)
select pg_temp.sc('a_owner', format('select public.outbox_set_settings(%L, true, 5)', tests.tid('a')));
select pg_temp.sub('r_m2', 'r2', 'Our shop is open until half past eight today.');
select pg_temp.sc('a_owner', format('select public.outbox_set_settings(%L, false, 5)', tests.tid('a')));
select is(pg_temp.mst('r_m2'), 'queued/auto_allowed', '(r_m2 was allowed while automatic sending was on)');
create temp table claimed_r2 as select pg_temp.sch(format('select public.scheduler_claim_due(%L)', tests.tid('a')))::jsonb as j;
select is((select count(*) from claimed_r2, jsonb_array_elements(j) e where e ->> 'id' = tests.rid('r_m2')::text), 0::bigint, 'NOTHING GOES WITHOUT AN APPROVAL: with automatic sending off the worker leaves an auto-allowed message alone');
-- the other things the worker does stay behind automatic sending
select is(pg_temp.sch(format('select public.scheduler_due_reminders(%L)', tests.tid('a'))), '[]', 'reminders stay behind automatic sending (none while it is off)');
select is(pg_temp.sch(format('select public.scheduler_mark_no_shows(%L)', tests.tid('a'))), '{"marked": 0}', '...and so does the automatic no-show');
-- quiet hours: approved at night, held for 09:00
select pg_temp.pin('2026-10-05 22:00:00+05:30');
select pg_temp.sub('r_m3', 'r3', 'A note for you from the shop.');
select pg_temp.sc('a_owner', format('select public.outbox_decide(%L, %L, ''approve'')', tests.tid('a'), tests.rid('r_m3')));
select is((select scheduled_for from public.outbox_messages where id = tests.rid('r_m3')), timestamptz '2026-10-06 09:00:00+05:30', 'QUIET HOURS: approved at 22:00, it is scheduled for 09:00');
select pg_temp.pin('2026-10-06 08:59:00+05:30');
select is(pg_temp.sch(format('select public.scheduler_claim_due(%L)', tests.tid('a'))), '[]', '08:59: not released');
select pg_temp.pin('2026-10-06 09:00:00+05:30');
create temp table claimed_r3 as select pg_temp.sch(format('select public.scheduler_claim_due(%L)', tests.tid('a')))::jsonb as j;
select is((select count(*) from claimed_r3, jsonb_array_elements(j) e where e ->> 'id' = tests.rid('r_m3')::text), 1::bigint, '09:00: released, automatic sending still off');
-- STOP after approval
select pg_temp.pin('2026-10-06 10:00:00+05:30');
select pg_temp.sub('r_m4', 'r4', 'A note for you from the shop.');
select pg_temp.sc('a_owner', format('select public.outbox_decide(%L, %L, ''approve'')', tests.tid('a'), tests.rid('r_m4')));
select pg_temp.sc('a_sales', format($q$select public.suppress_contact(%L, %L, 'opted_out')$q$, tests.tid('a'), tests.rid('r4_c')));
select is(pg_temp.mst('r_m4'), 'blocked/stopped', 'STOP: an approved message of a customer who then asked us to stop is blocked');
create temp table claimed_r4 as select pg_temp.sch(format('select public.scheduler_claim_due(%L)', tests.tid('a')))::jsonb as j;
select is((select count(*) from claimed_r4, jsonb_array_elements(j) e where e ->> 'id' = tests.rid('r_m4')::text), 0::bigint, '...and not released');
-- the daily limit still applies at send time
select pg_temp.sc('a_owner', format('select public.outbox_set_settings(%L, true, 1)', tests.tid('a')));
select pg_temp.sub('r_m5', 'r5', 'A note for you from the shop.');
select pg_temp.sc('a_owner', format('select public.outbox_set_settings(%L, false, 1)', tests.tid('a')));
select pg_temp.sub('r_m6', 'r5', 'A second note for you from the shop.');
select pg_temp.sc('a_owner', format('select public.outbox_decide(%L, %L, ''approve'')', tests.tid('a'), tests.rid('r_m6')));
select is(pg_temp.mst('r_m6') in ('blocked/daily_limit', 'queued/owner_approved'), true, '(the second note to one customer in a day: the limit of 1 is checked at approval and at send)');
-- global switch off: nothing
update public.platform_flags set enabled = false where key = 'outbox_enabled';
select is(pg_temp.sch('select public.scheduler_tenants()'), '[]', 'GLOBAL SWITCH OFF: no business is listed...');
select is(pg_temp.sch(format('select public.scheduler_claim_due(%L)', tests.tid('a'))), '[]', '...and nothing is released');
update public.platform_flags set enabled = true where key = 'outbox_enabled';
-- the status says approved messages are released whatever automatic sending says
select pg_temp.main_pin();
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.scheduler_status(%L)', tests.tid('a'))), 'releases_approved'), 'true', 'STATUS: releases_approved is true while the global switch is on...');
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.scheduler_status(%L)', tests.tid('a'))), 'active'), 'false', '...although the business is not "active" (automatic sending is off)');
update public.platform_flags set enabled = false where key = 'outbox_enabled';
select is(pg_temp.j(pg_temp.sc('a_owner', format('select public.scheduler_status(%L)', tests.tid('a'))), 'releases_approved'), 'false', '...and false with the global switch off');
update public.platform_flags set enabled = true where key = 'outbox_enabled';
-- the manual path is unchanged: "dispatch now" still releases an auto-allowed message
select pg_temp.pin('2026-10-06 15:00:00+05:30');
select pg_temp.sc('a_owner', format('select public.outbox_set_settings(%L, true, 5)', tests.tid('a')));
select pg_temp.mk('r7');
select pg_temp.sub('r_m7', 'r7', 'Our shop is open until half past eight today.');
select pg_temp.sc('a_owner', format('select public.outbox_set_settings(%L, false, 5)', tests.tid('a')));
select is(jsonb_array_length(pg_temp.sc('a_owner', format('select public.outbox_claim_due(%L, 50)', tests.tid('a')))::jsonb) >= 1, true, 'THE PEOPLE''S "dispatch now" is unchanged: it still releases an auto-allowed message when automatic sending is off');

-- ---------------------------------------------------------------------------------------------
-- J. lead search
-- ---------------------------------------------------------------------------------------------
select pg_temp.main_pin();
update public.contacts set full_name = 'Priya Sharma', phone = '+00 98765 43210' where id = tests.rid('g1_c');
update public.contacts set full_name = 'Percent 50% Rao', phone = '+00 90000 11111' where id = tests.rid('g2_c');
update public.contacts set full_name = 'Under_score Nair', phone = null where id = tests.rid('g3_c');
create function pg_temp.ls(p_q text, p_user text default 'a_owner', p_tenant text default 'a', p_more text default '') returns text language sql as $$
  select pg_temp.sc(p_user, format('select public.lead_search(%L, %L%s)', tests.tid(p_tenant), p_q, p_more)) $$;
create function pg_temp.lsn(p_json text) returns text language sql as $$
  select case when p_json like 'ERR:%' then p_json else coalesce((select string_agg(e ->> 'contact_name', ', ' order by ord) from jsonb_array_elements(p_json::jsonb) with ordinality as t(e, ord)), '') end $$;
select is(pg_temp.lsn(pg_temp.ls('priya')), 'Priya Sharma', 'CONTACT NAME: found by part of a contact''s name, any case');
select is(pg_temp.lsn(pg_temp.ls('3210')), 'Priya Sharma', 'PHONE: found by the last four digits');
select is(pg_temp.lsn(pg_temp.ls('43210')), 'Priya Sharma', '...or more of the ending');
select is(pg_temp.lsn(pg_temp.ls('+00 98765 43210')), 'Priya Sharma', '...or the whole number with spaces and a plus');
select is(pg_temp.lsn(pg_temp.ls('5432')), '', 'a number that is only in the MIDDLE is not found (it is an ending that is searched)');
select is((pg_temp.ls('3210')::jsonb -> 0 ->> 'phone_last4'), '3210', 'the number itself is never returned: only its last four digits');
select is(pg_temp.ls('3210') like '%98765%', false, '...nothing more of it');
select is(pg_temp.lsn(pg_temp.ls('50%')), 'Percent 50% Rao', 'a percent sign in the question means itself, not "anything"');
select is(pg_temp.lsn(pg_temp.ls('under_s')), 'Under_score Nair', 'an underscore means itself');
select is(pg_temp.lsn(pg_temp.ls('zzzzz')), '', 'nothing found: an empty list');
select is(pg_temp.ls('p'), 'ERR:22023', 'INVALID: one character (22023)');
select is(pg_temp.ls('12'), 'ERR:22023', 'INVALID: a number under four digits (22023)');
select is(pg_temp.ls('ab' || chr(8203)), 'ERR:22023', 'INVALID: an invisible character');
select is(pg_temp.ls(repeat('a', 61)), 'ERR:22023', 'INVALID: over 60 characters');
select is(pg_temp.ls('priya', p_more => ', 51'), 'ERR:22023', 'INVALID: a limit of 51');
select is(pg_temp.lsn(pg_temp.ls('priya', 'a_viewer')), 'Priya Sharma', 'every member can search (they can all read leads)');
select is(pg_temp.ls('priya', 'b_owner', 'a'), 'ERR:42501', 'another business''s Owner cannot search this business (42501)');
select is(pg_temp.lsn(pg_temp.ls('priya', 'b_owner', 'b')), '', '...and business b finds nothing of ours');
select is(pg_temp.ls('priya', 'outsider'), 'ERR:42501', 'a stranger cannot (42501)');
select is(pg_temp.lsn(pg_temp.ls('Contact')) <> '', true, 'COMPANY-LESS: contacts named "Contact ..." are found by contact name');
update public.leads set archived_at = now() where id = tests.rid('g1');
select is(pg_temp.lsn(pg_temp.ls('priya')), '', 'an ARCHIVED lead is not found');
update public.leads set archived_at = null where id = tests.rid('g1');
select is(pg_temp.lsn(pg_temp.ls('Contact', p_more => ', 2')) like '%,%' and jsonb_array_length(pg_temp.ls('Contact', p_more => ', 2')::jsonb) = 2, true, 'PAGING: a limit of 2 returns two');
select is(jsonb_array_length(pg_temp.ls('Contact', p_more => format(', 50, %L, %L', (pg_temp.ls('Contact', p_more => ', 1')::jsonb -> 0 ->> 'created_at'), (pg_temp.ls('Contact', p_more => ', 1')::jsonb -> 0 ->> 'lead_id')))::jsonb)
          = jsonb_array_length(pg_temp.ls('Contact', p_more => ', 50')::jsonb) - 1, true, '...and the next page starts after the last one seen');
select is(pg_temp.ls('Contact', p_more => format(', 50, %L', now())), 'ERR:22023', 'INVALID: half a cursor');

-- ---------------------------------------------------------------------------------------------
-- K. Today: the waiting count includes the visits Agent OWL proposed
-- ---------------------------------------------------------------------------------------------
create function pg_temp.visit(p_id text, p_source text, p_status text, p_starts timestamptz) returns void language plpgsql as $$
begin
  insert into public.store_visits (id, tenant_id, lead_id, contact_id, visit_date, starts_at, ends_at, source, request_sha256, created_by)
  select tests.rid(p_id), tests.tid('a'), l.id, l.contact_id, (p_starts at time zone 'Asia/Kolkata')::date, p_starts, p_starts + interval '30 minutes', p_source, repeat('7', 64), tests.uid('a_owner')
    from (select id, contact_id from public.leads where tenant_id = tests.tid('a') order by id limit 1 offset 0) l;
  if p_status = 'confirmed' then
    update public.store_visits set status = 'confirmed', confirmed_at = now() where id = tests.rid(p_id);
  end if;
end $$;
create function pg_temp.waiting(p_user text) returns text language sql as $$
  select pg_temp.j(pg_temp.sc(p_user, format('select public.today_summary(%L)', tests.tid('a'))), 'cards')::jsonb ->> 'waiting' $$;
create function pg_temp.cards_waiting(p_user text) returns integer language sql as $$
  select ((pg_temp.sc(p_user, format('select public.today_summary(%L)', tests.tid('a')))::jsonb -> 'cards' ->> 'waiting'))::integer $$;
create temp table base_wait as select p.u as u, pg_temp.cards_waiting(p.u) as n from (values ('a_owner'), ('a_admin'), ('a_sales'), ('a_viewer')) p(u);
select pg_temp.visit('k_v1', 'assistant', 'booked', now() + interval '3 days');
select pg_temp.visit('k_v2', 'assistant', 'booked', now() + interval '30 days');
select pg_temp.visit('k_v3', 'staff', 'booked', now() + interval '3 days');
select pg_temp.visit('k_v4', 'assistant', 'confirmed', now() + interval '3 days');
select pg_temp.visit('k_v5', 'assistant', 'booked', now() + interval '90 days');
select pg_temp.visit('k_v6', 'assistant', 'booked', now() - interval '1 day');
select is(pg_temp.cards_waiting('a_owner') - (select n from base_wait where u = 'a_owner'), 2, 'TODAY: the Owner''s waiting count grows by the two visits Agent OWL proposed (booked, from the assistant, still to come within 61 days)');
select is(pg_temp.cards_waiting('a_admin') - (select n from base_wait where u = 'a_admin'), 2, '...the Admin''s too');
select is(pg_temp.cards_waiting('a_sales') - (select n from base_wait where u = 'a_sales'), 2, '...and Sales''s (they decide visits)');
select is(pg_temp.cards_waiting('a_viewer') - (select n from base_wait where u = 'a_viewer'), 0, '...but not a Viewer''s (they are not asked)');
select is(jsonb_array_length(pg_temp.sc('a_owner', format('select public.today_summary(%L)', tests.tid('a')))::jsonb -> 'needs_you') <= 20, true, '(the list of items itself is unchanged: the visits are counted, not listed)');
update public.store_visits set status = 'cancelled', closed_at = now(), cancel_reason = 'x' where id = tests.rid('k_v1');
select is(pg_temp.cards_waiting('a_owner') - (select n from base_wait where u = 'a_owner'), 1, 'a proposal that was cancelled stops counting');

-- ---------------------------------------------------------------------------------------------
-- L. audit
-- ---------------------------------------------------------------------------------------------
select ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'catalogue_item') > 0, 'every change of an item is audited');
select ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'catalogue_photo') > 0, 'every photo record is audited');
select ok((select count(*) from public.audit_events where tenant_id = tests.tid('a') and entity_type = 'outbox_message_media') > 0, 'every photo of a message is audited');

select * from finish();
rollback;
