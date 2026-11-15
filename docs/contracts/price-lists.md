# Contract: price lists (C1 to C2)

Existing (rehearsal step 5): `POST /price-lists/import/preview` and `POST /price-lists/import` (Owner or Admin, second factor): check a file and make one VERSION from it.

## GET /price-lists/current (15 Nov 2026, for the Price lists page)

`GET /v1/tenants/{t}/price-lists/current` (Owner, Admin, Sales; read only, no second factor): what is loaded now.
```json
{ "current":  { "version_id": uuid, "version_no": 2, "effective_from": "2026-11-13", "item_count": 7, "created_at": "...",
                "sample": [ { "sku", "name", "sale_unit", "unit_price_paise", "minimum_order_quantity", "tax_bps" } ] },   // the first 5 rows by sku
  "upcoming": { "version_id", "version_no", "effective_from", "item_count", "created_at" } }                              // a version loaded for a later day
```
`current` is the newest version whose day has come (India date) and is `null` until a first list is loaded; `upcoming` is `null` when nothing later is loaded. 401 without a token, 403 for a Viewer, 404 for another workspace. Money is integer paise.
