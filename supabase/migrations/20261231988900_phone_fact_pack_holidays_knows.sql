-- The phone fact pack, two additions (28 Nov 2026): (1) the days the business is closed (the follow-up policy's holidays, the list the call gate already uses) join the pack, today and the next 60 days; (2) public.phone_assistant_knows:
-- what the phone assistant has to answer with for one workspace, as COUNTS (any member may read it), so the owner sees before a real call whether the assistant will be able to answer prices and products or will only deflect.

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
  v_version uuid;
  v_prices  jsonb;
  v_holidays jsonb;
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
  select v.id into v_version from public.price_list_versions v
   where v.tenant_id = p_tenant_id and v.effective_from <= (now() at time zone 'Asia/Kolkata')::date order by v.effective_from desc, v.version_no desc, v.created_at desc limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'unit', i.sale_unit::text, 'paise', i.unit_price_paise, 'moq', i.minimum_order_quantity, 'tax_bps', i.tax_bps) order by i.name, i.id), '[]'::jsonb)
    into v_prices from (select x.name, x.sale_unit, x.unit_price_paise, x.minimum_order_quantity, x.tax_bps, x.id from public.price_list_items x where x.tenant_id = p_tenant_id and x.version_id = v_version order by x.name, x.id limit 40) i;
  -- the days the business is closed (the follow-up policy's holidays, the same list the call gate uses): today and the next 60 days
  select coalesce(jsonb_agg(h order by h), '[]'::jsonb) into v_holidays from (
    select distinct d::text as h from public.followup_policy_versions p, unnest(p.holidays) d
     where p.tenant_id = p_tenant_id
       and p.version_no = (select max(q.version_no) from public.followup_policy_versions q where q.tenant_id = p_tenant_id and q.effective_from <= (now() at time zone 'Asia/Kolkata')::date)
       and d between (now() at time zone 'Asia/Kolkata')::date and (now() at time zone 'Asia/Kolkata')::date + 60) x;
  return jsonb_build_object('notes', v_notes, 'faqs', v_faqs, 'hours', v_hours, 'catalogue', v_cat, 'prices', v_prices, 'holidays', v_holidays);
end;
$$;

revoke all on function public.phone_fact_pack(uuid) from public, anon;
grant execute on function public.phone_fact_pack(uuid) to authenticated;

create function public.phone_assistant_knows(p_tenant_id uuid) returns jsonb language plpgsql stable security definer set search_path = '' as
$$
declare
  v_notes text;
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    perform app.phone_error('deny');
  end if;
  select a.notes into v_notes from public.assistant_context_versions a where a.tenant_id = p_tenant_id order by a.version desc limit 1;
  return jsonb_build_object(
    'price_rows', (select count(*) from public.price_list_items i where i.tenant_id = p_tenant_id
                     and i.version_id = (select v.id from public.price_list_versions v where v.tenant_id = p_tenant_id and v.effective_from <= (now() at time zone 'Asia/Kolkata')::date order by v.effective_from desc, v.version_no desc, v.created_at desc limit 1)),
    'catalogue_items', (select count(*) from public.catalogue_items c where c.tenant_id = p_tenant_id and c.active),
    'faq_answers', (select count(*) from public.job_faqs f where f.tenant_id = p_tenant_id),
    'notes_lines', (select count(*) from unnest(string_to_array(coalesce(v_notes, ''), E'\n')) l where btrim(l) <> ''),
    'has_hours', exists (select 1 from public.assistant_settings s where s.tenant_id = p_tenant_id));
end $$;
revoke all on function public.phone_assistant_knows(uuid) from public, anon;
grant execute on function public.phone_assistant_knows(uuid) to authenticated;
