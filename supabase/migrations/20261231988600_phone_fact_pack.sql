-- The phone assistant's FACTS (28 Nov 2026). Until now an AI phone call was given no business facts at all (the call path passed an empty list), so every question about the business was deflected to the team.
-- This one function lets the call's scheduler account read, for ONE workspace, the few things a call may use: the owner's notes, the owner's FAQ answers, the calling hours, the active catalogue items (names and
-- facts, NEVER a price) and the CURRENT price list (the only source of an amount a call may say). Read-only; nothing here writes; the API turns it into a short block once at the start of a call and checks every
-- rupee amount the assistant speaks against the price-list rows.

create function public.phone_fact_pack(p_tenant_id uuid) returns jsonb
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
  return jsonb_build_object('notes', v_notes, 'faqs', v_faqs, 'hours', v_hours, 'catalogue', v_cat, 'prices', v_prices);
end;
$$;
revoke all on function public.phone_fact_pack(uuid) from public, anon;
grant execute on function public.phone_fact_pack(uuid) to authenticated;
comment on function public.phone_fact_pack(uuid) is 'The scheduler account only: the few facts an AI phone call may use for one workspace (notes, FAQ answers, hours, active catalogue items without prices, the current price list). Read-only.';
