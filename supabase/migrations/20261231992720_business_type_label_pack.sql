-- The business's own type label (Other / Something else), round 2 (26 Nov 2026, owner request): `workspace.profiles.type_label` already exists (2 to 60 characters, set at first run or by PATCH /workspace/profile, Owner only, audited).
-- This migration (1) refuses markup characters in it (a `<` or `>` can never be stored; the API strips tags first), and (2) hands it to the phone fact pack as `business_type` (only for a business that chose Other), so the call knows what kind of business it speaks for.
-- The fact pack function is the 992710 one with that one key added.

alter table workspace.profiles add constraint profiles_type_label_plain check (type_label is null or type_label !~ '[<>]') not valid;

create or replace function public.phone_fact_pack(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_notes   text;
  v_faqs    jsonb;
  v_hours   jsonb;
  v_cat     jsonb;
  v_prices  jsonb;
  v_holidays jsonb;
  v_items   jsonb;
  v_type    text;
begin
  if auth.uid() is null or not app.is_scheduler() or p_tenant_id is null then
    perform app.phone_error('deny');
  end if;
  select a.notes into v_notes from public.assistant_context_versions a where a.tenant_id = p_tenant_id order by a.version desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('q', f.question, 'a', f.answer) order by f.created_at, f.id), '[]'::jsonb)
    into v_faqs from (select x.question, x.answer, x.created_at, x.id from public.job_faqs x where x.tenant_id = p_tenant_id order by x.created_at, x.id limit 30) f;
  select jsonb_build_object('days', to_jsonb(s.call_days), 'from_minute', s.call_from_minute, 'to_minute', s.call_to_minute)
    into v_hours from public.assistant_settings s where s.tenant_id = p_tenant_id;
  select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'fabric', c.fabric, 'colours', to_jsonb(c.colours), 'occasions', to_jsonb(c.occasions), 'stock', c.stock_status) order by c.updated_at desc, c.id), '[]'::jsonb)
    into v_cat from (select x.name, x.fabric, x.colours, x.occasions, x.stock_status, x.updated_at, x.id from public.catalogue_items x where x.tenant_id = p_tenant_id and x.active order by x.updated_at desc, x.id limit 20) c;
  v_prices := app.phone_exact_prices(p_tenant_id, 40);
  -- the business's own words for its type, when it chose Other (the label the Owner typed; only then)
  select left(btrim(p.type_label), 60) into v_type from workspace.profiles p join packs.workspace_pack w on w.tenant_id = p.tenant_id where p.tenant_id = p_tenant_id and w.pack_code = 'general_business';
  -- the items of the owner's lists that say whether they are available, or say a short description (nothing else of a row is read)
  select coalesce(jsonb_agg(jsonb_build_object('name', x.name, 'category', x.cat, 'availability', x.av, 'description', x.dsc) order by x.name, x.id), '[]'::jsonb) into v_items from (
    select r.id, r.name, left(r.cells ->> ct.key, 40) as cat, r.cells ->> av.key as av, left(r.cells ->> d.key, 200) as dsc
      from public.sell_list_rows r
      join public.sell_lists l on l.tenant_id = r.tenant_id and l.id = r.list_id and l.removed_at is null
      left join public.sell_list_columns av on av.tenant_id = r.tenant_id and av.list_id = r.list_id and av.removed_at is null and av.role = 'availability'
      left join public.sell_list_columns d on d.tenant_id = r.tenant_id and d.list_id = r.list_id and d.removed_at is null and d.role = 'description'
      left join public.sell_list_columns ct on ct.tenant_id = r.tenant_id and ct.list_id = r.list_id and ct.removed_at is null and ct.role = 'category'
     where r.tenant_id = p_tenant_id and r.removed_at is null and r.active and (r.cells ->> av.key is not null or r.cells ->> d.key is not null or r.cells ->> ct.key is not null)
     order by r.name, r.id limit 30) x;
  -- the days the business is closed (the follow-up policy's holidays, the same list the call gate uses): today and the next 60 days
  select coalesce(jsonb_agg(h order by h), '[]'::jsonb) into v_holidays from (
    select distinct d::text as h from public.followup_policy_versions p, unnest(p.holidays) d
     where p.tenant_id = p_tenant_id
       and p.version_no = (select max(q.version_no) from public.followup_policy_versions q where q.tenant_id = p_tenant_id and q.effective_from <= (now() at time zone 'Asia/Kolkata')::date)
       and d between (now() at time zone 'Asia/Kolkata')::date and (now() at time zone 'Asia/Kolkata')::date + 60) x;
  return jsonb_build_object('notes', v_notes, 'faqs', v_faqs, 'hours', v_hours, 'catalogue', v_cat, 'prices', v_prices, 'holidays', v_holidays, 'items', v_items, 'business_type', v_type);
end;
$$;
revoke all on function public.phone_fact_pack(uuid) from public, anon;
grant execute on function public.phone_fact_pack(uuid) to authenticated;
