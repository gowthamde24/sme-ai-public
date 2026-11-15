-- "Price asked: <item>" (owner, 15 Nov 2026): when the assistant could not state a price it says "The shop will confirm the exact price and get back to you". That must be TRUE: the question is written down
-- here, shows on the lead (when there is one) and in the owner's Today as something to answer, until a person marks it answered.
--   public.price_asks              one row per question: the item words (clean text, at most 120 characters), where it was asked (assistant | call | whatsapp), the lead when known, answered or not
--   public.price_ask_record        Owner, Admin, Sales: write one down (the same lead and words within 10 minutes is the same question)
--   public.price_ask_answer        Owner, Admin, Sales: mark it answered
--   public.price_ask_list          Owner, Admin, Sales: the open ones (or all), newest first, with the customer's name when there is a lead
-- Nobody writes the table directly; every change is an audit row.
create table public.price_asks (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants (id) on delete restrict,
  lead_id     uuid,
  contact_id  uuid,
  item        text not null check (char_length(item) between 2 and 120 and app.text_is_clean(item)),
  source      text not null check (source in ('assistant', 'call', 'whatsapp')),
  asked_by    uuid,
  asked_at    timestamptz not null default app.outbox_now(),
  answered_at timestamptz,
  answered_by uuid,
  unique (tenant_id, id),
  foreign key (tenant_id, lead_id) references public.leads (tenant_id, id),
  foreign key (tenant_id, contact_id) references public.contacts (tenant_id, id),
  check ((answered_at is null) = (answered_by is null))
);
create index price_asks_open_idx on public.price_asks (tenant_id, asked_at desc) where answered_at is null;
create index price_asks_lead_idx on public.price_asks (tenant_id, lead_id, asked_at desc);
create index price_asks_contact_idx on public.price_asks (tenant_id, contact_id);
create trigger price_asks_forbid_tenant_id_change before update on public.price_asks for each row execute function app.forbid_tenant_id_change();
comment on table public.price_asks is 'Owner 15 Nov 2026: a price the assistant could not state, written down so "the shop will confirm" is true. Written only by the price_ask_* functions.';
comment on column public.price_asks.item is 'SAFE: the words of the question, clean text (guarded by app.text_is_clean in the CHECK), at most 120 characters';
comment on column public.price_asks.source is 'SAFE: a closed word. CLEAN-EXEMPT: closed CHECK list';
alter table public.price_asks enable row level security;
alter table public.price_asks force row level security;
revoke all on public.price_asks from public, anon, authenticated, service_role;
grant select on public.price_asks to authenticated;
create policy price_asks_select on public.price_asks for select to authenticated
  using (tenant_id = any (((select app.my_tenant_ids_with_role(array['owner', 'admin', 'sales']::public.app_role[])))::uuid[]));
create trigger audit_price_asks after insert or update or delete on public.price_asks for each row execute function app.audit_row_change('price_ask', '');

create function public.price_ask_record(p_tenant_id uuid, p_item text, p_source text, p_lead_id uuid default null) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item text := btrim(regexp_replace(coalesce(p_item, ''), '\s+', ' ', 'g'));
  v_contact uuid;
  v_id uuid;
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_item := left(v_item, 120);
  if char_length(v_item) < 2 or p_source is null or p_source not in ('assistant', 'call', 'whatsapp') or not app.text_is_clean(v_item) then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if p_lead_id is not null then
    select l.contact_id into v_contact from public.leads l where l.tenant_id = p_tenant_id and l.id = p_lead_id;
    if not found then
      raise exception 'not found' using errcode = '23503';
    end if;
  end if;
  select a.id into v_id from public.price_asks a
   where a.tenant_id = p_tenant_id and a.answered_at is null and a.item = v_item and a.lead_id is not distinct from p_lead_id and a.asked_at > app.outbox_now() - interval '10 minutes'
   order by a.asked_at desc limit 1;
  if v_id is not null then
    return v_id;
  end if;
  insert into public.price_asks (tenant_id, lead_id, contact_id, item, source, asked_by) values (p_tenant_id, p_lead_id, v_contact, v_item, p_source, auth.uid()) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.price_ask_record(uuid, text, text, uuid) from public, anon;
grant execute on function public.price_ask_record(uuid, text, text, uuid) to authenticated;

create function public.price_ask_answer(p_tenant_id uuid, p_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or p_tenant_id is null or not app.has_tenant_role(p_tenant_id, array['owner', 'admin', 'sales']::public.app_role[]) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.price_asks set answered_at = app.outbox_now(), answered_by = auth.uid() where tenant_id = p_tenant_id and id = p_id and answered_at is null;
  if not found and not exists (select 1 from public.price_asks where tenant_id = p_tenant_id and id = p_id) then
    raise exception 'not found' using errcode = '23503';
  end if;
  return true;
end;
$$;
revoke all on function public.price_ask_answer(uuid, uuid) from public, anon;
grant execute on function public.price_ask_answer(uuid, uuid) to authenticated;

create function public.price_ask_list(p_tenant_id uuid, p_open boolean default true, p_limit integer default 50) returns jsonb
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
    select jsonb_agg(jsonb_build_object('id', s.id, 'item', s.item, 'source', s.source, 'lead_id', s.lead_id, 'customer', s.customer, 'asked_at', s.asked_at, 'answered_at', s.answered_at) order by s.asked_at desc)
      from (select a.id, a.item, a.source, a.lead_id, c.full_name as customer, a.asked_at, a.answered_at
              from public.price_asks a left join public.contacts c on c.tenant_id = a.tenant_id and c.id = a.contact_id and c.erased_at is null
             where a.tenant_id = p_tenant_id and (not coalesce(p_open, true) or a.answered_at is null)
             order by a.asked_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) s), '[]'::jsonb);
end;
$$;
revoke all on function public.price_ask_list(uuid, boolean, integer) from public, anon;
grant execute on function public.price_ask_list(uuid, boolean, integer) to authenticated;
