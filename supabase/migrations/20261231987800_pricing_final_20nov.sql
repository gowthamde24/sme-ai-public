-- The owner's FINAL pricing (19-20 Nov 2026; project-docs/decision-plans-and-pricing.md), replacing the 13 Nov numbers that /v1/pricing still served:
--   Pay as you go  Rs 499 a month + Rs 5 a minute; 1 number; Lead Finder 2 searches a month, then Rs 49
--   Pro            Rs 1,999, 500 minutes included, extra Rs 5; 1 number; 10 searches, then Rs 39
--   Business       Rs 5,999, 1,500 minutes included, extra Rs 5; 1 number; 100 searches, then Rs 29
--   every extra number Rs 299 a month; billed per 30 seconds; MONTHLY plans only: the catalogue no longer shows a yearly price or "2 months free" (the yearly column and function arguments stay in the database, unused,
--   so no existing function changes; the API refuses a yearly interval).
-- Plan ids stay (payg, sales_assistant, sales_lead_finder: subscriptions and functions refer to them); only the owner-facing NAMES change. `lead_finder` (unlimited, fair use) is false for every plan now: every plan has
-- Lead Finder with its own free searches (free_searches_month) and its own price after them (extra_search_paise), which is exactly what pricing_charge_search already does.
update pricing.plans set name = 'Pay as you go', monthly_paise = 49900,  yearly_paise = 499000,  included_minutes = 0,    rate_paise_per_minute = 500, numbers_included = 1, lead_finder = false, free_searches_month = 2,   extra_search_paise = 4900 where id = 'payg';
update pricing.plans set name = 'Pro',           monthly_paise = 199900, yearly_paise = 1999000, included_minutes = 500,  rate_paise_per_minute = 500, numbers_included = 1, lead_finder = false, free_searches_month = 10,  extra_search_paise = 3900 where id = 'sales_assistant';
update pricing.plans set name = 'Business',      monthly_paise = 599900, yearly_paise = 5999000, included_minutes = 1500, rate_paise_per_minute = 500, numbers_included = 1, lead_finder = false, free_searches_month = 100, extra_search_paise = 2900 where id = 'sales_lead_finder';

alter table pricing.settings add column extra_number_paise bigint not null default 29900 check (extra_number_paise between 0 and 100000000);
comment on column pricing.settings.extra_number_paise is 'SAFE: the monthly price of each business number after the first (Rs 299). CLEAN-EXEMPT: range CHECK';

do $patch$
declare
  v_def text := pg_get_functiondef('public.pricing_catalogue()'::regprocedure);
  v_new text;
begin
  if position($q$'yearly_paise', p.yearly_paise, $q$ in v_def) = 0 or position($q$'lot_days', (select s.lot_days from pricing.settings s),$q$ in v_def) = 0 then
    raise exception 'the pricing catalogue is not the one this migration expects';
  end if;
  v_new := replace(v_def, $q$'yearly_paise', p.yearly_paise, $q$, '');
  v_new := replace(v_new, $q$'lot_days', (select s.lot_days from pricing.settings s),$q$, $q$'lot_days', (select s.lot_days from pricing.settings s), 'extra_number_paise', (select s.extra_number_paise from pricing.settings s),$q$);
  execute v_new;
end
$patch$;
