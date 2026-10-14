# Runbook: the construction-materials core (job CN, ADR 0085)

For the owner or the support person setting up a building-materials business (paver blocks, kerb stones, bricks, tiles, cement, sand, aggregate), and for the next developer. Everything here is local and synthetic; nothing is deployed. The screens come in jobs CO and CM; until then the API is the interface (`/docs` in development).

## 1. Set the workspace up

1. The business is a `construction_materials` workspace (chosen at sign-up, pack version 2, which switches on `materials`, `sites`, `deliveries`, `dues`, and with them the materials requirement fields). A workspace that was on version 1 is moved by migration `20261123090100`.
2. **The owner enters the numbers; nothing is assumed.** For each item (`PUT /v1/tenants/{t}/materials/items/{id}`): the name, the selling unit (`sq_ft`, `sq_m`, `piece`, `box`, `bag`, `tonne`, `cft`, `truckload`) and the coverage unit; the **price** (the Owner, with a second factor); and through the item's custom values (`PUT .../catalogue/{id}/custom`): `pieces_per_area` (pieces per sq ft or sq m, e.g. 4.5), `pieces_per_pallet`, `minimum_order`, `lead_days`, `hsn_code` and **`gst_rate_percent`**. `GET .../materials/items/{id}` shows what a quote will read and exactly what is still missing (`inputs.missing_for_area`, `missing_for_quantity`). A quote that needs a missing figure is refused with the name of the figure.
3. **The quoting rules** (`POST .../materials/policy`, Owner with a second factor, a new immutable version each time): wastage (default 5%), whether to round up to full pallets, whether the customer is billed for the wastage, transport (`per_trip` with the truck's capacity in pieces or area, or `per_km_slab`, with its GST), loading/unloading (per order or per trip), laying per sq ft or sq m, advance % (default 50), credit days, validity (default 7). Laying is refused until a laying rate exists.
4. **Sites** (`PUT .../sites/{id}`): a customer can have many; address, PIN, an optional map pin (both numbers or neither), the **distance from your yard** in km (entered by you; freight by the kilometre reads it), lane width, night delivery, unloading help, access notes (no phone numbers here: the site contact is a *contact* of the business, so consent and quiet hours apply to them).
5. The order rules are the same ones the saree flow uses: publish an order policy (`POST .../order-policy-versions`) once.

## 2. A quote, end to end

1. Capture the enquiry (`POST .../leads/{lead}/enquiries`). Either run the requirement agent (`POST .../agent-runs`, agent `requirement`: on a materials workspace it runs the materials version, `requirement-materials-1`) or type the fields in (`POST .../enquiries/{e}/requirement-fields`). Fields: per product line, `product_type`, `thickness`, **`area`** (sq ft or sq m) *or* `length` and `width` *or* a `quantity` with its unit; per order, `application`, `site_location`, `laying`, `deadline`, `budget`, `payment_terms`. Anything uncertain (`implied` or `ambiguous`) shows as a question; the person confirms, corrects or rejects each field, then confirms the requirement.
2. Pick the catalogue item for each line, and **preview** (`POST .../materials/requirements/{r}/preview`): nothing is stored; the result carries the pieces, pallets, trips, each charge, GST per item and per service, advance, balance, validity, a low-to-high range and the rule trace. `database_agrees` must be true.
3. **Draft** (`POST .../materials/requirements/{r}/quotes`), read the customer text (`GET .../materials/quotes/{id}/text?language=en`; the other languages are drafts), **approve** (Owner or Admin, second factor; a quote with a flag is the Owner's alone), then **order** (`POST .../materials/quotes/{id}/order`). The response carries a credit warning when the customer would pass their limit; it never blocks.

Worked example (also the golden vector): 1,000 sq ft of 80 mm pavers, 4.5 pieces/sq ft, 5% wastage, Rs 65/sq ft, GST 18%, truck of 2,500 pieces at Rs 3,500 a trip + 18%, 500 per pallet: 4,725 pieces (10 pallets), 2 trips, material Rs 68,250, transport Rs 7,000, total **Rs 88,795.00**, advance Rs 44,397.50.

## 3. Deliveries

After the customer accepts: plan trips (`POST .../orders/{order}/trips`: date, vehicle, driver and phone, quantity per line, the site and its contact). The truck can be **loaded** at any time, can leave (**on the way**) only when the order is **dispatched**, and is **delivered** with a photo and the receiver's name (`POST .../trips/{id}/delivered?received_by=...` with the photo as the body; location data is stripped). A problem needs a reason from the list and the trip is then rescheduled. `GET .../trips/{id}/challan` is the delivery note (no amounts). `POST .../trips/{id}/notify` queues a fixed-words update for the site contact **through the outbox**: it goes by itself only when the owner switched automatic sending on and the contact's consent, suppression key and quiet hours allow it; a delay message is held for a person.

## 4. Dues

Record invoices (`PUT .../dues/invoices/{id}`, or import up to 5,000 rows from the accounting export: `POST .../dues/invoices/import`) and payments (`PUT .../dues/payments/{id}`). A payment goes to the **oldest** open invoice. `GET .../dues` lists customers by what they owe; `GET .../dues/customers/{c}` is the statement with ageing (0-30, 31-60, 61-90, 90+), overdue and the credit limit (Owner, second factor). Void only by Owner or Admin. This is the groundwork of the shared ledger of job CP.

## 5. What to check when something is refused

| You see | It means |
|---|---|
| 403 `module_off` | the workspace is not a materials one (or the module is off) |
| 403 `mfa_required` | the action needs the second factor (price, policy, approval, credit limit) |
| 422 `quote_not_computable`, `reason` | a closed calculator reason: `LAYING_RATE_MISSING`, `DISTANCE_MISSING`, `MISSING_GST_RATE`, `MIXED_AREA_UNITS`, `TOTAL_TOO_LARGE`, ... |
| 422 `quote_input_missing`, `reason` | an item figure the owner has not entered: `price`, `gst_rate`, `pieces_per_area`, `unit`, `hsn` |
| 500 `calculator_disagreement` | the database and the calculator gave different figures: nothing was stored; report it |
| 409 `order_not_deliverable` | the order is not accepted yet (or is closed) |

## 6. Limits you should know

* The pack is still `preview`: a real paver seller must confirm the wastage, pallet and freight rules before it is offered outside a closed trial.
* The proof photo may show people. It is in a private bucket and shown only by short-lived addresses. Erasing a customer clears the receiver's name; removing the photo files is an operator step today.
* Photos as a requirement field, question drafts for materials, and plan entitlements are not built.
