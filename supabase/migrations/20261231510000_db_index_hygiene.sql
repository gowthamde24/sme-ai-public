-- Index hygiene after the 12 Nov 2026 timeouts on staging (owner: "it goes with production"). Nothing here changes who can read or write anything.
-- The investigation found the queries themselves cheap (a Today read is about 5 ms alone; the stalls were CPU contention on the small instance), so these are the Advisor's remaining suggestions, not the cure:
--   1. the two duplicate indexes: a plain index that repeats the key of a unique constraint (the constraint's own index serves every query and every foreign key the copy did);
--   2. the foreign keys without an index (a delete or update on the parent scans the child without one);
--   3. two policies on storage.objects that call auth.uid() per row: wrapped so it runs once per query (same result, `alter policy` changes it in place, there is no moment without a policy).

-- 1. duplicates (same columns, same order as the unique constraint next to them)
drop index if exists public.delivery_trips_order_idx;       -- = delivery_trips_tenant_id_order_id_trip_no_key (tenant_id, order_id, trip_no)
drop index if exists public.marks_send_log_batch_idx;       -- = marks_send_log_tenant_id_batch_id_seq_key (tenant_id, batch_id, seq)

-- 2. foreign keys without an index (child side). One index (tenant_id, message_id) also serves the (tenant_id) key of wa_message_status.
create index if not exists tenants_plan_idx on public.tenants (plan);
create index if not exists agent_definitions_requires_flag_idx on public.agent_definitions (requires_flag);
create index if not exists calendar_tokens_user_idx on integrations.calendar_tokens (user_id);
create index if not exists data_exports_tenant_idx on privacy.data_exports (tenant_id);
create index if not exists wa_message_status_message_idx on integrations.wa_message_status (tenant_id, message_id);
create index if not exists missed_calls_contact_idx on integrations.missed_calls (tenant_id, contact_id);
create index if not exists voice_budget_notice_tenant_idx on public.voice_budget (notice_tenant);

-- 3. the picture bucket's policies: auth.uid() evaluated once per query, not once per row
alter policy images_objects_delete on storage.objects
  using (
    app.images_bucket_tenant(bucket_id) is not null
    and (
      (name like 'logo/%' and app.has_tenant_role(app.images_bucket_tenant(bucket_id), array['owner', 'admin']::public.app_role[]))
      or (name like ('member/' || ((select auth.uid()))::text || '/%') and app.is_tenant_member(app.images_bucket_tenant(bucket_id)))
    )
  );
alter policy images_objects_insert on storage.objects
  with check (
    app.images_bucket_tenant(bucket_id) is not null
    and (
      (name like 'logo/%' and app.has_tenant_role(app.images_bucket_tenant(bucket_id), array['owner', 'admin']::public.app_role[]))
      or (name like ('member/' || ((select auth.uid()))::text || '/%') and app.is_tenant_member(app.images_bucket_tenant(bucket_id)))
    )
  );
