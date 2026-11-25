-- Erasure registry for the online-store tables (release 2, 26 Nov 2026; pgTAP 39 found three PII columns nobody handled):
--   public.commerce_orders.phone, public.commerce_checkouts.phone and public.commerce_checkouts.name carry a person's number or name.
--   * tenant scope: set NULL (all three are nullable) when the workspace is erased;
--   * identifier sweep: when ONE person is erased, an identifier found inside the column is replaced by the erasure marker. The two phone columns have a strict "+digits" CHECK, which the marker
--     (and a number with the marker inside) would break and so would make the whole erasure fail: the CHECKs now also accept a value that holds the marker `erased-1`. Nothing else about them changes.
alter table public.commerce_orders drop constraint commerce_orders_phone_check;
alter table public.commerce_orders add constraint commerce_orders_phone_check check (phone ~ '^\+[0-9]{8,15}$' or phone ~ 'erased-1');
alter table public.commerce_checkouts drop constraint commerce_checkouts_phone_check;
alter table public.commerce_checkouts add constraint commerce_checkouts_phone_check check (phone ~ '^\+[0-9]{8,15}$' or phone ~ 'erased-1');

insert into erasure.registry (table_name, column_name, scope, strategy, replacement) values
  ('commerce_orders',    'phone', 'tenant', 'null',      'erased:1'),
  ('commerce_checkouts', 'phone', 'tenant', 'null',      'erased:1'),
  ('commerce_checkouts', 'name',  'tenant', 'null',      'erased:1'),
  ('commerce_orders',    'phone', 'sweep',  'substring', 'erased:1'),
  ('commerce_checkouts', 'phone', 'sweep',  'substring', 'erased:1'),
  ('commerce_checkouts', 'name',  'sweep',  'substring', 'erased:1');
