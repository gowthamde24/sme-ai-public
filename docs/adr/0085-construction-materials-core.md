# ADR 0085: the construction-materials core: product specs, sites, the area-to-quantity calculator, material quotes, orders to deliveries, dues, and the materials requirement analyst

Status: **ACCEPTED and BUILT (job CN, 2026-10-14), for the owner's review.** Builds on ADR 0084 parts 1 and 2 (packs, modules, custom fields), 0019 (quotes), 0021 (order conversion), 0066 (the outbox), 0013 (agents) and 0014 (erasure). The web screens are jobs CO and CM; the shared receivables engine and the campaigns are job CP. Nothing here is deployed, no paid service was added, no dependency was added, and all data is synthetic.

## Context

The `construction_materials` pack (job CK, blueprint 5.2) defined the product fields and switched modules on, but a paver block could not be a catalogue item (the catalogue was saree-shaped), a customer had one address, a quote could only be by saree piece, an order could only come from a saree quote, and nothing recorded what a customer owes. The owner's formula for a paver quote is *area x pieces per area x (1 + wastage)*, rounded to pallets if asked, plus transport by the truck, plus laying, plus GST item by item. The rule of the whole product is unchanged: **a model never calculates a price**.

## Decisions

1. **One pure calculator, three readers.** `packages/quote-engine/src/quote_engine/construction.py` (Python reference, integer paise, basis points, hundredths of an area, thousandths of pieces per area) and its TypeScript twin `packages/quote-engine/ts/construction.ts` (BigInt) are held equal by 44 golden vectors (`tests/fixtures/construction_vectors.json`, generated once from the reference). A **third** reader, the SQL function `app.cq_compute`, lets the database recompute every figure itself. The saree engine (`quote_engine.quote`, v1.1.0, pinned) is untouched. The calculator is public through `POST /v1/calculate/materials` (rate limited, no sign-in) so the public page and the web reuse the same function.
2. **The database builds the request; the API only compares.** A material quote is made from the confirmed requirement, the person's picks, the owner's price and item figures, the site's distance, the policy version in force and the customer's dues. The API sends none of those figures. The database builds the request (`app.cq_build`), the API runs the calculator on it and sends back the request, the result and the hash; `material_quote_draft` verifies the request is **exactly** the one it would build, that the hash matches, and that `app.cq_compute` gives the same figures. Any difference is SM761 and nothing is stored. A calculator that disagrees with the database is a 500 `calculator_disagreement`, never a quote.
3. **Nothing is assumed.** GST rate and HSN code are entered by the owner per item (pack custom fields `gst_rate_percent`, `hsn_code`); pieces per area, pieces per pallet and the minimum order likewise. A missing input is refused with a closed reason (SM762 with DETAIL `price`, `gst_rate`, `pieces_per_area`, `unit`, `hsn`, `policy`, ...), never defaulted. Laying needs a laying rate in the policy (`LAYING_RATE_MISSING`); freight by the kilometre needs the site's distance (`DISTANCE_MISSING`).
4. **Separate tables for material quotes** (`material_quotes`, `material_quote_lines`) instead of widening the saree `quotes` tables. The saree quote stays byte-for-byte as it was. Orders gained `material_quote_id` and `site_id`, `quote_id` became nullable, and a CHECK says exactly one of the two quotes is set. `create_order_from_material_quote` returns a **credit warning** (never a block). `app.order_stops_followups` covers material orders so the follow-up stop rules still hold.
5. **Approval is the Owner's or an Admin's, with a second factor; a quote with a flag is the Owner's alone.** Flags: `BELOW_MINIMUM_ORDER_QUANTITY`, `CREDIT_LIMIT_EXCEEDED`, `LINE_NOT_COUNTED_IN_TRIPS`. Staleness (a price, a policy or a confirmed requirement that changed after the draft) is SM764.
6. **Wastage and pallets.** Pieces are `ceil(area x pieces-per-area x (1 + wastage))` once; pallet round-up is optional and per policy or line. `bill_wastage` decides whether the customer is billed for the delivered area (with wastage) or only their own. `range` gives a low (no wastage, no pallets) and a high figure. Default wastage is 5% and the owner's. Advance defaults to 50%, validity to 7 days.
7. **Dues groundwork, shaped to be reused.** `customer_invoices`, `customer_payments` and `customer_credit_limits` with a FIFO allocation (`app.dues_open_items`): a payment goes to the oldest open invoice first; a payment beyond the invoiced total is an advance, never a negative balance. Ageing buckets 0-30, 31-60, 61-90, 90+. Invoices can be entered or imported (5,000 rows in parts of 500; ids derived from the batch id so a retry adds nothing). Owner and Admin void; a Viewer sees no money. The credit limit is the Owner's with a second factor. **This was a groundwork, not the shared ledger**: job CP generalised it (ADR 0086: one ledger of accounts and entries for a company or a contact, with adjustments, concessions and receipt numbers; `customer_invoices` and `customer_payments` were copied into it and dropped, and the functions kept their names and answers).
8. **Trips require an accepted order; leaving requires a dispatched one.** A trip may be planned once the order is accepted and not closed; `loaded` is allowed any time after; `on_the_way` needs the order dispatched (the order's own advance rule decides when that is, SM772); `delivered` needs a photo in storage and the name of who received the goods; `problem` needs a reason from a closed list and goes back to `planned`. Quantities of a line over all trips never exceed the quote line. The delivery note (challan) has no amounts and no tax.
9. **Messages to the site contact go through the outbox and only through it.** Fixed templates in five languages (no model, no amounts), the contact's own consent, suppression key and quiet hours apply; the message is category `order_status`. The three ordinary kinds (left, soon, delivered) pass the outbox's content rules with no flags in all five languages; **a delay reads as a complaint to the outbox's rules and is held for a person**, which is the safe direction.
10. **The requirement analyst for materials is the same agent with a second version.** Profile (materials or saree) comes from the workspace's **module** state (`materials` on), never a pack id. The agent keeps the name `requirement` and one `agent_definitions` row; its version label is `requirement-materials-1` (saree: `requirement-1`). Closed vocabularies (application, product type, laying), deterministic readers for area (sq ft, sq m; hundredths), length and width, thickness (mm; cm x 10), material quantities with their unit (bag, tonne, cft, truckload, box, piece), and the site as short text; each value must be **supported by the quote** (the same rule as the saree flow); anything uncertain is `implied` or `ambiguous` and goes to the owner as a closed-template question. A requirement is confirmable with a product and a measure (an area, or length and width, or a quantity) a person confirmed; it is ready for a quote with the site location and laying settled too. The profile lookup needs the caller's token, so it lives in `app/enquiries/profile.py`, outside the sandboxed `app/requirements` package (a boundary test forbids a token there).
11. **Module-gated.** A new module `materials` (26 modules now); `sites`, `deliveries` and `dues` moved from "future" to real guarded tables. The construction pack is version 2 (adds `materials`); workspaces on version 1 are moved by the migration. Textiles are unchanged (the equivalence proof of job CK still passes).

## SQLSTATEs (new)

| Code | Meaning |
|---|---|
| SM751 | a site: not allowed, invalid, or the contact is not the customer's |
| SM761 | the draft differs from what the database builds and recomputes (tampering or a stale calculator) |
| SM762 | an input the quote needs is missing (DETAIL: `pick`, `measure`, `product_type`, `price`, `gst_rate`, `pieces_per_area`, `unit`, `hsn`, `policy`, `duplicate_item`) |
| SM763 | the quote is not a draft |
| SM764 | the quote is stale |
| SM765 | the Owner's approval is required (a flagged quote) |
| SM766 | the request is not computable (DETAIL: the calculator's closed code) |
| SM767 | the requirement is not confirmed |
| SM771 | the trip is not in a state that allows this |
| SM772 | the order is not dispatched |
| SM773-SM776 | trip shape, proof, quantity over the order, and unknown reference |
| SM781 | the invoice number is already used |
| SM782 | already voided |

Orders reuse SM230, 231, 233, 236 and 239. The closed DETAIL of a refusal passes through `app/rpc_base.py` only when it has the shape `[A-Za-z][A-Za-z0-9_]{0,39}`; no other data-layer text is ever returned.

## Privacy and erasure

New personal-data columns: a site's name, address, city, map pin and access notes; a trip's vehicle number, driver name and phone; the name of who received a delivery. All carry `PII:` comments and registry rows; erasing a company wipes its sites and the received-by names of its deliveries, and a sweep replaces the other values (`erase_company` was replaced by a full copy in migration `20261123090600`). Free text refuses phone numbers and e-mail addresses (text hygiene). The proof photo may show people: it is in a private per-tenant bucket (`pod-<tenant>`), shown only through short-lived signed addresses, and its removal on erasure is an operator step in this build (see the checklist). A model never sees a site, a trip or a person's name: the requirement analyst reads only the enquiry, whose contact details were removed at capture.

## What was proved

pgTAP 96 to 99 (catalogue kinds, sites, requirement fields; the dues ledger; material quotes with the SQL twin; deliveries with proof and the outbox); the golden vectors in Python, TypeScript and SQL (the real stack's integration test also compares the SQL twin with the reference on 150 random requests); the HTTP journey on the real stack (`tests/integration/test_cn_construction.py`: policy, item, requirement, preview, draft, approval, order, sites, dues, trips with a real photo in Storage, challan, outbox) and the analyst run end to end (`test_cn_requirement_agent.py`). The numbers are in the job's report.

## Deviations and risks

* **Lane note.** The job text puts the engine in `packages/quote-engine`; `lanes.json` denies lane A that path. PRs from `api/*` branches are not path-guarded; the owner's instruction is followed and the exception is reported.
* The calculator is **not** the saree engine; two engines now exist side by side. They share no code by design (the saree engine is pinned).
* Pallet and wastage rules are the owner's to confirm with a real paver seller (the pack is still `preview`).
* Languages other than English for the quote text and the trip messages are drafts; native readers are open.
* Not built here: the web screens (CO, CM), the shared ledger and campaigns (CP), photos as a requirement field, question drafts for materials (the saree question-draft table is saree-shaped), plan entitlements, and removal of proof photos on erasure.
