-- sm: Sales and money at a glance (app v4, part 6; owner 6 Nov 2026; C2's requests #4 and #5). Read only.
--   * public.money_summary: across ALL customers: what is owed, what of it is overdue, how many customers owe / are overdue (summed from the ledger's own per-customer statements, so the rules
--     of payments-to-the-oldest-invoice, concessions and voids are the ledger's, not a copy), what was paid this month, and the five who owe the most.
--   * public.catalogue_low_stock: the items marked "few left", each with how many customers asked for something like it in the last 7 days (an item's name words found in a lead's need:
--     approximate, and said so). There are no stock COUNTS in the catalogue: "2 left" needs a quantity field, which is the owner's decision.

create function public.money_summary(p_tenant_id uuid, p_as_of date default null) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_page jsonb;
  v_row jsonb;
  v_after_paise bigint;
  v_after_id uuid;
  v_owed bigint := 0;
  v_overdue bigint := 0;
  v_owing integer := 0;
  v_late integer := 0;
  v_top jsonb := '[]'::jsonb;
  v_pages integer := 0;
  v_month date := date_trunc('month', coalesce(p_as_of, (now() at time zone 'Asia/Kolkata')::date))::date;
  v_paid bigint;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  loop
    v_page := public.ledger_summary(p_tenant_id, p_as_of, 100, v_after_paise, v_after_id);
    exit when v_page is null or jsonb_array_length(v_page) = 0;
    for v_row in select * from jsonb_array_elements(v_page) loop
      v_owed := v_owed + coalesce((v_row ->> 'outstanding_paise')::bigint, 0);
      v_overdue := v_overdue + coalesce((v_row ->> 'overdue_paise')::bigint, 0);
      if coalesce((v_row ->> 'outstanding_paise')::bigint, 0) > 0 then v_owing := v_owing + 1; end if;
      if coalesce((v_row ->> 'overdue_paise')::bigint, 0) > 0 then v_late := v_late + 1; end if;
      if jsonb_array_length(v_top) < 5 then
        v_top := v_top || jsonb_build_array(jsonb_build_object('account_id', v_row -> 'account_id', 'company_id', v_row -> 'company_id', 'contact_id', v_row -> 'contact_id',
                                                               'name', coalesce(v_row ->> 'party_name', v_row ->> 'company_name'), 'outstanding_paise', v_row -> 'outstanding_paise',
                                                               'overdue_paise', v_row -> 'overdue_paise'));
      end if;
      v_after_paise := (v_row ->> 'outstanding_paise')::bigint;
      v_after_id := (v_row ->> 'account_id')::uuid;
    end loop;
    v_pages := v_pages + 1;
    exit when jsonb_array_length(v_page) < 100 or v_pages >= 50;
  end loop;
  select coalesce(sum(e.amount_paise), 0) into v_paid from public.ledger_entries e
   where e.tenant_id = p_tenant_id and e.kind = 'payment' and e.voided_at is null and e.entry_date >= v_month and e.entry_date <= coalesce(p_as_of, (now() at time zone 'Asia/Kolkata')::date);
  return jsonb_build_object('as_of', coalesce(p_as_of, (now() at time zone 'Asia/Kolkata')::date), 'owed_paise', v_owed, 'overdue_paise', v_overdue, 'customers_owing', v_owing,
                            'customers_overdue', v_late, 'paid_this_month_paise', v_paid, 'month_from', v_month, 'top', v_top, 'complete', v_pages < 50);
end;
$$;
revoke all on function public.money_summary(uuid, date) from public, anon;
grant execute on function public.money_summary(uuid, date) to authenticated;

create function public.catalogue_low_stock(p_tenant_id uuid) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.is_tenant_member(p_tenant_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name, 'stock_status', i.stock_status, 'asked_this_week', (
             select count(distinct p.lead_id) from public.lead_profiles p
              where p.tenant_id = i.tenant_id and greatest(p.created_at, p.updated_at) >= now() - interval '7 days' and p.need is not null
                and exists (select 1 from regexp_split_to_table(lower(i.name), '[^[:alnum:]]+') w where char_length(w) >= 4 and position(w in lower(p.need)) > 0)),
             'asked_is_approximate', true) order by i.name)
      from public.catalogue_items i
     where i.tenant_id = p_tenant_id and i.active and i.stock_status = 'few_left'), '[]'::jsonb);
end;
$$;
revoke all on function public.catalogue_low_stock(uuid) from public, anon;
grant execute on function public.catalogue_low_stock(uuid) to authenticated;
