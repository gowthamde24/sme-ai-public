-- Chat promises (owner, 16 Nov 2026, the Kavitha Gowda chat): the assistant answered "I will check the price and let you know", nothing followed, the customer asked again and the 24-hour window closed.
-- A promise made in a customer's chat must be written down AT ONCE, where the owner looks (Today's "Price asked" section = public.price_asks), with the day the customer named ("Sunday").
--   * public.price_asks gets `kind` (price | follow_up: a price the shop has not fixed, or any other "we will check / send / confirm") and `needed_by` (the date the customer named, India time). `website` is a source as well.
--   * public.scheduler_auto_reply_note (the registered worker only): after the assistant has replied to a WhatsApp message it records (1) the promise, if the reply makes one: one OPEN item per customer and kind,
--     a later promise or a later deadline updates it instead of adding another; (2) a deadline the customer names without a new promise (a later "need it for Sunday") on that customer's open item;
--     (3) the PRODUCT the customer asks about ("Semi silk tissue"), as lead_profiles.product (the customer card's "Interested in"); `need` stays the customer's own first words.
--   * public.price_ask_list returns `kind` and `needed_by`; app.lead_desk_json returns `profile.product`.

alter table public.price_asks
  add column kind text not null default 'price' check (kind in ('price', 'follow_up')),
  add column needed_by date;
alter table public.price_asks drop constraint price_asks_source_check;
alter table public.price_asks add constraint price_asks_source_check check (source in ('assistant', 'call', 'whatsapp', 'website'));
comment on column public.price_asks.kind is 'SAFE: a closed word (price | follow_up). CLEAN-EXEMPT: closed CHECK list';
comment on column public.price_asks.needed_by is 'SAFE: the date the customer said they need it by (India time), when they named one';

alter table public.lead_profiles add column product text check (product is null or (char_length(product) between 2 and 80 and app.text_is_clean(product) and not app.text_has_contact(product)));
comment on column public.lead_profiles.product is 'PII: the product or collection the customer asked about, in a few words ("Semi silk tissue"), taken from their own words by the assistant. Erased with the workspace.';
insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('lead_profiles', 'product', 'tenant', 'null', 'erased:1'),
  ('lead_profiles', 'product', 'sweep', 'substring', 'erased:1');
drop trigger audit_lead_profiles on public.lead_profiles;
create trigger audit_lead_profiles after insert or update or delete on public.lead_profiles for each row execute function app.audit_row_change('lead_profile', 'need,quantity,area,city,budget,timeline,campaign,notes,product');

-- the profile the lead card reads carries `product`
do $patch$
declare
  v_def text := pg_get_functiondef('app.lead_desk_json(public.leads, public.lead_profiles, public.contacts, uuid, boolean)'::regprocedure);
  v_old text := $q$'need', p.need,$q$;
  v_new text := $q$'need', p.need, 'product', p.product,$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'lead_desk_json has changed: the product patch no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end;
$patch$;

-- the list returns the kind and the deadline
create or replace function public.price_ask_list(p_tenant_id uuid, p_open boolean default true, p_limit integer default 50) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'item', s.item, 'source', s.source, 'kind', s.kind, 'needed_by', s.needed_by, 'lead_id', s.lead_id, 'customer', s.customer, 'asked_at', s.asked_at, 'answered_at', s.answered_at)
                     order by s.needed_by nulls last, s.asked_at desc)
      from (select a.id, a.item, a.source, a.kind, a.needed_by, a.lead_id, c.full_name as customer, a.asked_at, a.answered_at
              from public.price_asks a left join public.contacts c on c.tenant_id = a.tenant_id and c.id = a.contact_id and c.erased_at is null
             where a.tenant_id = p_tenant_id and (not coalesce(p_open, true) or a.answered_at is null)
             order by a.asked_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) s), '[]'::jsonb);
end;
$$;

-- ------------------------------------------------------------------------------------------------------------------------------
-- the worker's note after a reply
-- ------------------------------------------------------------------------------------------------------------------------------
create function public.scheduler_auto_reply_note(p_enquiry_id uuid, p_promise boolean, p_kind text, p_item text, p_needed_by date, p_product text) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today   date := (app.outbox_now() at time zone 'Asia/Kolkata')::date;
  v_item    text := left(btrim(regexp_replace(coalesce(p_item, ''), '\s+', ' ', 'g')), 120);
  v_product text := left(btrim(regexp_replace(coalesce(p_product, ''), '\s+', ' ', 'g')), 80);
  v_by      date := case when p_needed_by between v_today and v_today + 120 then p_needed_by end;
  e         public.enquiries;
  v_contact uuid;
  v_ask     uuid;
  v_out     text := 'nothing';
begin
  if not app.is_scheduler() then
    perform app.scheduler_error('deny');
  end if;
  if p_enquiry_id is null or coalesce(p_promise, false) and (p_kind is null or p_kind not in ('price', 'follow_up') or char_length(v_item) < 2 or not app.text_is_clean(v_item)) then
    perform app.scheduler_error('invalid');
  end if;
  select * into e from public.enquiries x where x.id = p_enquiry_id and x.channel = 'whatsapp';
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;
  select l.contact_id into v_contact from public.leads l where l.tenant_id = e.tenant_id and l.id = e.lead_id and l.archived_at is null;
  if not found then
    return jsonb_build_object('outcome', 'not_found');
  end if;

  -- the product the customer asks about (never over a field the owner fixed; a text that is not clean, holds a phone number or an address, or is too short is left out)
  if char_length(v_product) >= 2 and app.text_is_clean(v_product) and not app.text_has_contact(v_product) then
    insert into public.lead_profiles (tenant_id, lead_id) values (e.tenant_id, e.lead_id) on conflict (tenant_id, lead_id) do nothing;
    update public.lead_profiles set product = v_product, updated_at = now() where tenant_id = e.tenant_id and lead_id = e.lead_id and not ('product' = any (fixed)) and product is distinct from v_product;
    if found then
      v_out := 'product';
    end if;
  end if;

  if coalesce(p_promise, false) then
    -- one OPEN item per customer and kind: a new promise or a later deadline updates it
    select a.id into v_ask from public.price_asks a where a.tenant_id = e.tenant_id and a.lead_id = e.lead_id and a.kind = p_kind and a.answered_at is null order by a.asked_at desc limit 1 for update;
    if v_ask is not null then
      update public.price_asks set item = v_item, needed_by = coalesce(v_by, needed_by) where id = v_ask;
      v_out := 'updated';
    else
      insert into public.price_asks (tenant_id, lead_id, contact_id, item, source, kind, needed_by) values (e.tenant_id, e.lead_id, v_contact, v_item, 'whatsapp', p_kind, v_by) returning id into v_ask;
      v_out := 'recorded';
    end if;
  elsif v_by is not null then
    update public.price_asks set needed_by = v_by where tenant_id = e.tenant_id and lead_id = e.lead_id and answered_at is null and needed_by is distinct from v_by;
    if found then
      v_out := 'deadline';
    end if;
  end if;
  return jsonb_build_object('outcome', v_out, 'ask_id', v_ask);
end;
$$;
revoke all on function public.scheduler_auto_reply_note(uuid, boolean, text, text, date, text) from public, anon;
grant execute on function public.scheduler_auto_reply_note(uuid, boolean, text, text, date, text) to authenticated;
comment on function public.scheduler_auto_reply_note(uuid, boolean, text, text, date, text) is 'Chat promises (16 Nov 2026): after the assistant replied on WhatsApp, write down its promise (price_asks), the deadline the customer named and the product they asked about. Scheduler account only. PII.';
