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
{"items": [{"id": "…", "name": "Red Kanchi silk", "stock_status": "in_stock", "quantity": 2, "asked_this_week": 3, "asked_is_approximate": true},
           {"id": "…", "name": "Cotton daily wear", "stock_status": "few_left", "quantity": null, "asked_this_week": 0, "asked_is_approximate": true}], "counts_available": true}
```

- **Items:** active catalogue items that are low: **3 or fewer** when a count is set, otherwise marked "few left". Counted items come first, lowest count first.
- **`quantity`:** the count when the owner keeps one: show "2 left". `null`: not counted; show the status ("Few left").
- **`asked_this_week`:** how many customers in the last 7 days had a need containing a word of the item's name (4+ letters). It is approximate, so show it as "about 3 asked".
- **`counts_available: true`:** items can carry a count (owner decision, 6 Nov 2026). It used to be `false`.

## `PUT /v1/tenants/{t}/catalogue/items/{item_id}/quantity` (Owner, Admin)

Body `{"quantity": 2}` (a whole number, 0 to 1,000,000) or `{"quantity": null}` to stop counting. Returns the item (the same shape as `GET /catalogue/items/{item_id}`), which now carries `quantity` too.

- A text "2", a decimal or a missing field is a 422; Sales and Viewers get 403; an item of another workspace, or a building material, is 404.
- Setting the same number again changes nothing, so a retry is safe.
- **The assistant:** this is the write tool `catalogue.put_quantity` ("2 red Kanchi left"). Like every write tool it shows the plan card first and changes nothing until the owner confirms. It has no automatic undo; set the old number again.
- Every catalogue item (list rows and the item page) now has `quantity: int | null`.
