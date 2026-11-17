-- Chat promises (owner's end-to-end test, 17 Nov 2026): a customer asked a price ("do you have bridal Kanchipuram sarees? what is the price?"), the assistant said the team will get back, and the customer then said "need it Sunday".
-- The second promise (a follow-up) became a SECOND open item beside the price item, and the deadline went on the new one. It is ONE thing for the shop: the same customer, the same product. Now:
--   * an open item of the same kind is still updated (as before);
--   * otherwise an open item of the OTHER kind about the same thing (the same words, or one holds the other, at least 4 characters) is updated instead of a new one added: its deadline is kept or moved, its words stay,
--     and it becomes a price item when either was one (the price is the more specific ask);
--   * a promise about something else is still its own item.

do $patch$
declare
  v_def  text := pg_get_functiondef('public.scheduler_auto_reply_note(uuid, boolean, text, text, date, text)'::regprocedure);
  v_old1 text := $q$  v_ask     uuid;
  v_out     text := 'nothing';$q$;
  v_new1 text := $q$  v_ask     uuid;
  v_akind   text;
  v_out     text := 'nothing';$q$;
  v_old2 text := $q$    if v_ask is not null then
      update public.price_asks set item = v_item, needed_by = coalesce(v_by, needed_by) where id = v_ask;
      v_out := 'updated';
    else$q$;
  v_new2 text := $q$    if v_ask is null then
      -- the same thing under the other kind (a price asked, then "I'll let you know"): one item, never two for one thing
      select a.id, a.kind into v_ask, v_akind from public.price_asks a
       where a.tenant_id = e.tenant_id and a.lead_id = e.lead_id and a.answered_at is null
         and (lower(a.item) = lower(v_item) or (char_length(a.item) >= 4 and char_length(v_item) >= 4 and (position(lower(a.item) in lower(v_item)) > 0 or position(lower(v_item) in lower(a.item)) > 0)))
       order by a.asked_at desc limit 1 for update;
      if v_ask is not null then
        update public.price_asks set kind = case when 'price' in (v_akind, p_kind) then 'price' else 'follow_up' end, needed_by = coalesce(v_by, needed_by) where id = v_ask;
        v_out := 'updated';
      end if;
    else
      update public.price_asks set item = v_item, needed_by = coalesce(v_by, needed_by) where id = v_ask;
      v_out := 'updated';
    end if;
    if v_ask is null then$q$;
begin
  if position(v_old1 in v_def) = 0 or position(v_old2 in v_def) = 0 then
    raise exception 'scheduler_auto_reply_note has changed: the one-item patch no longer fits';
  end if;
  execute replace(replace(v_def, v_old1, v_new1), v_old2, v_new2);
end;
$patch$;
