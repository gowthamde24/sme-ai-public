-- "Out of stock" is a stock state of its own (28 Nov 2026; C2: "mark out of stock" on a phone). The catalogue had in stock, few left and made to order only, so an owner who ran out had to say "made to order", which tells a customer something else.
-- Additive: the check list grows by one word; no row changes. The bulk stock function that applies a previewed stock file accepts the new word too. Rollback = put the old check back (after moving any out_of_stock row to made_to_order).

alter table public.catalogue_items drop constraint catalogue_items_stock_status_check;
alter table public.catalogue_items add constraint catalogue_items_stock_status_check check (stock_status in ('in_stock', 'few_left', 'made_to_order', 'out_of_stock'));

do $patch$
declare
  v_def    text := pg_get_functiondef('public.catalogue_stock_apply(uuid, uuid, jsonb)'::regprocedure);
  v_marker constant text := E'(c ->> ''stock_status'') not in (''in_stock'', ''few_left'', ''made_to_order'')';
begin
  if position(v_marker in v_def) = 0 then
    raise exception 'out of stock: catalogue_stock_apply is not the one this migration expects';
  end if;
  execute replace(v_def, v_marker, E'(c ->> ''stock_status'') not in (''in_stock'', ''few_left'', ''made_to_order'', ''out_of_stock'')');
end
$patch$;
