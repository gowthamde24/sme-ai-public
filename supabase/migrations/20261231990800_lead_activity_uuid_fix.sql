-- Fix of 20261231990500 for databases that already ran its first version: the activity table's id was a bigint, but the audit trigger needs a uuid id (every insert failed). The table held nothing yet
-- (no insert had ever succeeded), so it is dropped and made again with a uuid id. A database that ran the corrected 990500 skips this.
do $fix$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'lead_source_activity' and column_name = 'id' and data_type = 'bigint') then
    drop table public.lead_source_activity;
    create table public.lead_source_activity (
      id        uuid primary key default gen_random_uuid(),
      tenant_id uuid not null references public.tenants (id) on delete restrict,
      source_id uuid not null,
      at        timestamptz not null default now(),
      outcome   text not null check (outcome in ('accepted', 'duplicate', 'refused')),
      reason    text not null check (reason ~ '^[a-z][a-z_]{1,30}$'),
      test      boolean not null default false,
      foreign key (tenant_id, source_id) references public.lead_sources (tenant_id, id) on delete restrict
    );
    create index lead_source_activity_source_idx on public.lead_source_activity (tenant_id, source_id, at desc, id);
    comment on table public.lead_source_activity is 'What arrived at a lead source: one row per post with a closed outcome and reason (never a name, number or any field of the post). Written only by SECURITY DEFINER functions; kept 30 days, at most 200 a source.';
    comment on column public.lead_source_activity.outcome is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
    comment on column public.lead_source_activity.reason is 'SAFE: a closed word. CLEAN-EXEMPT: closed pattern';
    create trigger lead_source_activity_forbid_tenant_id_change before update on public.lead_source_activity for each row execute function app.forbid_tenant_id_change();
    create trigger audit_lead_source_activity after insert or update or delete on public.lead_source_activity for each row execute function app.audit_row_change('lead_source_activity');
    alter table public.lead_source_activity enable row level security;
    alter table public.lead_source_activity force row level security;
    revoke all on public.lead_source_activity from public, anon, authenticated;
    grant select on public.lead_source_activity to authenticated;
    create policy lead_source_activity_select on public.lead_source_activity for select to authenticated using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin']::public.app_role[])))::uuid[]));


  end if;
end
$fix$;
