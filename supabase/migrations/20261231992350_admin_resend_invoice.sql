-- Staff "resend invoice" (admin console, support gap). The database part only: it checks the staff member, the reason and a FRESH second factor, finds the invoice of that business and the
-- address of its Owner, writes the audit line ('resend_invoice', already an allowed action) and hands both to the API, which sends the e-mail (a database cannot send mail).
--   * owner, support and finance may do it; a reason in words and one of the closed reason codes are required; the invoice must belong to THAT business (a number of another business is "not found");
--   * the address is the oldest Owner membership's e-mail; a business with none answers 'not found' (nothing is sent to a guess);
--   * the customer sees it in their own activity log (customer visible = true), like the other staff actions that touch their money.
-- No table changes, no data is deleted.

create function public.admin_invoice_resend(p_tenant_id uuid, p_number text, p_reason_code text, p_reason_text text) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_staff admin.staff;
  v_text  text := btrim(coalesce(p_reason_text, ''));
  i       pricing.invoices;
  v_to    text;
begin
  v_staff := admin.staff_check(array['owner', 'support', 'finance']);
  if p_tenant_id is null or p_number is null or p_number !~ '^(S19|C19)-[0-9]{4}-[0-9]{6}$'
     or p_reason_code is null or p_reason_code not in ('support_ticket', 'customer_asked', 'privacy_request', 'incident', 'billing_dispute', 'other') then
    raise exception 'invalid input' using errcode = '22023';
  end if;
  if char_length(v_text) not between 3 and 300 or not app.text_is_clean(v_text) then
    raise exception 'a reason is required' using errcode = 'SM946';
  end if;
  perform admin.second_confirm();
  select * into i from pricing.invoices x where x.tenant_id = p_tenant_id and x.number = p_number;
  select u.email into v_to from public.memberships m join auth.users u on u.id = m.user_id
   where m.tenant_id = p_tenant_id and m.role = 'owner' and u.email is not null order by m.created_at, m.user_id limit 1;
  if i.number is null or v_to is null or not exists (select 1 from public.tenants t where t.id = p_tenant_id and t.archived_at is null) then
    raise exception 'not found' using errcode = '23503';
  end if;
  perform admin.log(v_staff.user_id, 'resend_invoice', p_tenant_id, null, p_reason_code, v_text, 'invoice', i.number, true);
  return jsonb_build_object('to', v_to, 'invoice', jsonb_build_object(
    'number', i.number, 'kind', i.kind, 'issued_at', i.issued_at, 'subtotal_paise', i.subtotal_paise, 'gst_paise', i.gst_paise, 'total_paise', i.total_paise,
    'cgst_paise', i.cgst_paise, 'sgst_paise', i.sgst_paise, 'igst_paise', i.igst_paise, 'tax_split', i.tax_split, 'against_number', i.against_number,
    'gst_percent', (select round(s.gst_bps / 100.0, 2) from pricing.settings s),
    'buyer_name', i.buyer_name, 'buyer_gstin', i.buyer_gstin, 'buyer_state_code', i.buyer_state_code,
    'seller_name', i.seller_name, 'seller_gstin', i.seller_gstin, 'seller_address', i.seller_address, 'seller_sac', i.seller_sac));
end $$;
revoke all on function public.admin_invoice_resend(uuid, text, text, text) from public, anon;
grant execute on function public.admin_invoice_resend(uuid, text, text, text) to authenticated;

-- the Owner's activity log names the two staff actions that touch their money in plain words (before, 'debit' and this one would read "Stack19 support viewed your account")
do $patch$
declare
  v_def text := pg_get_functiondef('public.activity_log(uuid,integer,timestamptz,text,text)'::regprocedure);
  v_old text := $q$else 'Stack19 support viewed your account' end$q$;
  v_new text := $q$when 'debit' then 'Stack19 took credits back from your balance' when 'resend_invoice' then 'Stack19 support sent you an invoice again' else 'Stack19 support viewed your account' end$q$;
begin
  if position(v_old in v_def) = 0 then
    raise exception 'activity_log has changed: the staff wording no longer fits';
  end if;
  execute replace(v_def, v_old, v_new);
end $patch$;
