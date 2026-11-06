# Money at a glance and low stock (app v4, part 6)

## `GET /v1/tenants/{t}/money/summary?as_of=YYYY-MM-DD` (Owner, Admin, Sales; a Viewer gets 403)

```json
{"as_of": "2026-11-06", "owed_paise": 1200000, "overdue_paise": 700000, "customers_owing": 1, "customers_overdue": 1,
 "paid_this_month_paise": 300000, "month_from": "2026-11-01",
 "top": [{"account_id": "…", "company_id": "…", "contact_id": null, "name": "…", "outstanding_paise": 1200000, "overdue_paise": 700000}],
 "complete": true}
```

- **Totals** are summed from the ledger's own per-customer statements, so payments go to the oldest invoice first and concessions and voids count as the ledger counts them.
- **`complete`** is false only past 5,000 customers who owe.
- **The full per-customer list** is the existing `GET /ledger/summary`.
- **Remind** stays the existing draft-for-approval flow; nothing here sends.

## `GET /v1/tenants/{t}/catalogue/low-stock` (any member)

```json
{"items": [{"id": "…", "name": "Red Kanchi silk", "stock_status": "few_left", "asked_this_week": 3, "asked_is_approximate": true}], "counts_available": false}
```

- **Items:** active catalogue items marked "few left".
- **`asked_this_week`:** how many customers in the last 7 days had a need containing a word of the item's name (4+ letters). It is approximate, so show it as "about 3 asked".
- **`counts_available: false`:** the catalogue has no stock counts, only a status, so "2 left" can't be shown. Adding a quantity field is the owner's decision.
