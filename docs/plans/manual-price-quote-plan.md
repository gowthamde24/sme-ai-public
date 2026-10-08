# Plan: the manual-price quote (the owners type each line's price; GST is added on top)

Status: **PLAN ONLY. Not approved. No code, migration, test, ADR or dependency was written or changed.** Written 2026-10-08 on the branch `docs/manual-price-quote-plan` from `origin/main`. The facts come from the code on `main` (paths below); the quote renderings in section 5 were produced from the pinned packages with synthetic inputs and nothing in the repository was run or changed. Sizes: **S** = web only, existing endpoints, about a day. **M** = a new endpoint or one migration with its tests, a few days. **L** = a security-relevant database change with an equivalence proof, more than a week. They are my estimates.

**Every GST rate and every price range in this document is a SYNTHETIC PLACEHOLDER and is marked as such. The accountant's real rates and thresholds are not known and nothing here is tax advice.**

## 0. What the owners decided (2026-10-08) and what follows

* There is **no fixed discount**: the price is decided by the owners **each time**, per saree line, and may differ for the same saree between customers. Prices range from about ₹1,500 to ₹100,000.
* **The shop does not charge customers for courier.** The quote has **no courier line and no courier amount**. (An earlier draft of this plan had a typed courier amount, a courier GST rate and a courier rate card; all of that is withdrawn.)
* **GST is added on top**, at a rate that may **depend on the price per piece**; the rule is the accountant's and is not known yet.
* Both owners are Owners.

So a quote needs a **manual kind**: an allowed role types the unit price of each line; the deterministic engine adds GST on top at the rate the policy gives; the existing text renderer writes the message. No model calculates anything (non-negotiable 4): a person types, a service computes, a person approves and sends by hand.

## 1. The rule today, and what stays

**Today** (`supabase/migrations/20261016090100_t009_picks_and_quotes.sql`, header): the API runs the pinned engine (`packages/quote-engine`, 1.1.0) and hands the database the request and the result. The database does not trust either: the request must be **byte for byte** the one it builds from its own sources (the confirmed picks, a price list version, a policy version, the customer kind), the hash must match, and **every figure** must equal the database's own integer recomputation (`app.quote_build`, line 298); the flags are derived there too. Approval (`public.approve_quote`, latest definition `20261020090000_review_fixes.sql:241`) re-runs the build from the quote's recorded versions and refuses a stale quote (SM215), needs an Owner or Admin with the second factor, and an Owner alone when the quote needs it (SM218).

**What stays in a manual kind** (unchanged, and the reason it is safe to add):
* the pinned engine and its version check, the request and result texts, the canonical hash, and the database's **own recomputation of every figure** (the arithmetic helper `app.quote_round`, line 71);
* quote content is **immutable**; only the status moves (`app.quote_guard_update`); a new price is a new draft (a new quote number), never an edit;
* approval: Owner or Admin, second factor, the lock order enquiry, requirement, quote; withdrawal; the follow-up stop on a withdrawn quote; order conversion reads the quote's totals, not its lines (checked: `20261019090000_order_conversion.sql` has no `quote_lines` or `product_id` read);
* the confirmed requirement: only fields a person confirmed count; a line needs a confirmed saree type **and** quantity (SM210, `20261015090100_t008_requirement_functions.sql`);
* the quote text is written by the pinned renderer from the engine result; nothing is composed in the web.

**What a new quote kind changes** (the honest list):
1. The **sources** of the rebuild are no longer "a pick and a price list item" but "the requirement's confirmed saree type code and quantity, **the typed price**, the policy version (GST rule, validity, advances)". The typed prices are arguments of the creating function, validated and stored with the quote; approval rebuilds from the stored values.
2. `quotes.price_list_version_id` is `not null` today (`20261016090100:119-120`): it must be nullable for a manual quote, with a check that it is set exactly for the list kind. **And the staleness test in `approve_quote`** (`app.quote_active_price_version(...) is distinct from z.price_list_version_id`) would call every manual quote stale while a price list exists: it must be skipped for the manual kind. This is the sharpest edge.
3. `quote_lines.product_id` and `sku` are `not null` (`:190-191`). A manual line has no catalog product: the engine needs a key, so the request uses a synthetic key per line (`LINE-1`, `LINE-2`), the label is the saree type's name, and `product_id` becomes nullable for the manual kind; the line stores the **saree-type code** (new nullable column) for the warning and rate options below. **So the catalog (the add-a-product form) is not required for a manual quote.**
4. The engine's "price list" for a manual quote is built from the lines themselves: `{sku: "LINE-n", name: label, unit_price: typed, minimum_order_quantity: 1, price_breaks: [], tax_bps: the rate for this line}`; `order_lines` carry `{sku, qty}` and **no discount**; `policy.shipping = {flat_fee: 0, tax_bps: 0}` because the engine **requires** a shipping rule (`packages/quote-engine/src/quote_engine/__init__.py:165-178`); it is fixed at zero by the policy and never typed. The engine's hash covers the typed prices, so a tampered price changes it.
5. `delivery_state` stays a required input (`required_inputs`, owner decision 6) because it decides `gst_supply` (same state or another state). The text does not show the difference. Whether to keep asking for it with no courier is a small question for the owners (section 11).

## 2. Who typed it and when

A change of price is a new draft, so **who and when** are the quote's `created_by` and `created_at` (set by the existing `quotes_set_created_meta` trigger) plus `approved_by` and `approved_at` as today. A new `quote_lines.price_source` (`list` or `typed`) lets the screen print "price typed by [person] on [date]; approved by [person]". To verify in slice 1 (**NOT VERIFIED** here): whether the audit trigger already covers `quotes`; if not, the creating function writes an audit event (`app.write_audit_event`) carrying a hash of the typed amounts.

**Who may type:** my recommendation is **Owner and Admin only** in v1 (the price is the owners' judgment; least privilege). Today the draft function also allows Sales (`create_quote_draft`); the manual function would check owner and admin.

## 3. A second person, a block, or a soft warning

| Option | What it is | Verdict |
| --- | --- | --- |
| **A. Nothing extra** | typed by an Owner or Admin; approved by an Owner or Admin with the second factor, as today (the same person may do both) | **the base**: matches "the owners decide each time" |
| **B. A soft warning (never a block)** | a **range set in the policy**; a typed price outside it shows a warning before saving and is marked on the quote; saving and approving are **never** stopped by it | **recommended with A**, see section 6 |
| **C. A hard floor or a second person** | a minimum price per type, or "typed by one, approved by another" | **not now**: a floor contradicts "no fixed price", and a second person blocks the owner who is alone at the phone; both are the owners' decisions, not defaults |

## 4. GST rate per line: what the code can do, and what changes

**The question:** can the engine and the policy choose the rate **per line** (by the line's price or by a saree-type code), or only one rate per policy?

| Layer | Per line today? | Evidence |
| --- | --- | --- |
| **The engine** | **Yes, by item.** Each price-list item carries its own `tax_bps`; tax is rounded per line and summed | `docs/plans/t009-quote-engine.md` (`price_list: [{sku, ..., tax_bps}]`); my rendering below shows two lines at two rates with the correct per-line tax |
| **The text renderer** | **Yes.** It prints "GST (x%)" for each line from the engine's own trace | the rendering below |
| **The database recomputation** | **Yes, by item.** `app.quote_build` takes `tax_bps` from each price-list item and computes each line's tax | `20261016090100`, `app.quote_build` loop over the lines; `quote_lines.tax_paise` is per line |
| **The policy** | **No.** `quote_policy_versions` has **no tax rate at all**: in a list quote the rate comes from each price-list row (so by product, not by price). My earlier plan added one `default_tax_bps` for manual lines, which is **one rate per policy** | `20261016090000_t009_quote_reference_data.sql:207+` |
| **The review flag** | A flag exists for mixed rates only together with freight (`MIXED_GST_RATES_SHIPPING`, "the lines carry more than one GST rate and freight is charged"); with the shipping fee fixed at zero it should never be set (read from the comment; to confirm in slice 2) | `20261016090100`, `quote_review_flag` |

So **the engine, the renderer and the database arithmetic already handle a different rate on each line; only the choice of the rate is missing.** If the accountant says the rate depends on the price per piece, one policy rate is **not enough**. What would change (the policy decides the rate; the person never types it):

* **Option 1: one rate** (`default_tax_bps`). Smallest. Right only if the accountant says one rate for all sarees. **S** on top of the manual kind.
* **Option 2 (recommended if the rate depends on price): price bands in the policy.** A new nullable policy field `tax_bands`: an ordered list of `{up_to_paise, tax_bps}` ending with an open band, for example (**SYNTHETIC PLACEHOLDER, NOT the accountant's rates: up to ₹10,000 → 3%; above ₹10,000 → 7%**). A pure SQL function `app.quote_tax_bps_for_price(policy, unit_price_paise)` picks the rate; the API builder has the same small function; the database's request check makes any mismatch a refusal (fail closed, SM216), and the equivalence test covers the **band edges** (exactly at the limit, one paise either side). A policy with no bands refuses a manual quote (SM217): nothing is guessed. Validation of the field: one to six bands, strictly increasing limits within the price bounds, rates 0 to 10,000 bps. The policy page (item d) gets a small band editor. Size **M** on top of the manual kind.
* **Option 3: a rate by saree-type code** (a map code to rate in the policy). Right if the accountant says the rate follows the type, not the price. The saree-type code is stored on the line anyway. Same size as option 2.
* **Option 4: the owner types the rate per line.** Not recommended: it puts a tax decision in a typing field; it could be allowed later with the same soft warning.

**Open questions for the accountant (NOT KNOWN):** is the limit inclusive or exclusive; is it the price **per piece** before GST (the quote's unit price) and what is "a piece" for a set; does it depend on anything else; and the actual rates. Nothing is coded until the owners give them. **Placeholders in tests and in the click checklist will be the synthetic ones above.**

**What the renderer shows with no courier (a finding):** I rendered a synthetic two-line quote with the pinned `quote_text` 1.0.0, no courier (the engine's fixed `flat_fee: 0`) and two different rates. The engine and renderer handle the two rates correctly:

```
Saree type A
2 x ₹1,500.00 = ₹3,000.00
Net: ₹3,000.00
GST (3%): ₹90.00            <- SYNTHETIC rate
Line total: ₹3,090.00

Saree type B
1 x ₹1,00,000.00 = ₹1,00,000.00
Net: ₹1,00,000.00
GST (7%): ₹7,000.00         <- SYNTHETIC rate
Line total: ₹1,07,000.00

Merchandise subtotal: ₹1,03,000.00
Merchandise net: ₹1,03,000.00
GST on merchandise: ₹7,090.00
Shipping net: ₹0.00          <- not wanted: there is no courier
GST on shipping (0%): ₹0.00  <- not wanted
Shipping total: ₹0.00        <- not wanted
GST total: ₹7,090.00
Grand total: ₹1,10,090.00
```

**The three zero "Shipping" lines are printed unconditionally** (`packages/pure/quote_text/__init__.py:386-388`; the renderer also requires exactly one shipping-tax trace, line 322). The owners said the quote has no courier line, so a **new lane C renderer version** (1.2.0: leave out the shipping block when the shipping fee is zero) is part of this ticket, with new golden vectors and lane A adopting the version in `ALLOWED_RENDERER_VERSIONS` (`services/ai-api/app/quotes/text_port.py:20`; 1.1.0 is also waiting to be adopted). Size **M**, in lane C. Until then the formal text works with three zero lines.

## 5. What would change: migrations, functions, tests, text

**New migration(s)** (never editing a pushed one):
* `quote_policy_versions`: a nullable rate source (`default_tax_bps` or `tax_bands`, per section 4) and two nullable warning bounds (`price_warn_min_paise`, `price_warn_max_paise`, section 6); replace `public.create_quote_policy_version` (`20261016090000:660`) to accept and validate them. The shipping fields stay (the engine requires them) and are set to zero.
* `quotes`: `pricing_kind` (`list` | `manual`, default `list`); relax `price_list_version_id`. `quote_lines`: `price_source`, `saree_type_code`, relax `product_id`. `quote_review_flag`: one new value (section 6), added in an earlier migration than the one that uses it.
* New `app.quote_build_manual(...)` (**a separate function, so `app.quote_build` stays byte-identical** and list quotes cannot regress), `app.quote_tax_bps_for_price(...)` if bands are chosen, and `public.create_manual_quote_draft(...)` (Owner and Admin; takes the typed lines as arguments).
* Replace `public.approve_quote` (a third definition) so it rebuilds a manual quote from its stored typed values and skips the price-list staleness test for that kind. Check `reject_quote` and `withdraw_approved_quote` in slice 2.

**Tests that must change or be added (an existing test changing is expected here and is why this is a ticket):** pgTAP `58_quote_picks_and_quotes`, `59_quote_withdrawal_collation_repeat`, `61_order_conversion` (plus a manual-kind suite: roles, bounds, immutability, SM215/216/217/218, replay, the band edges); `services/ai-api/tests/test_migration_copies.py` (pins copies of function bodies across replacements: needs the new `approve_quote`); `tests/integration/test_quote_engine_equivalence.py` (the property test that keeps the SQL arithmetic equal to the real engine must cover typed lines, **per-line rates and the band edges**: the proof that matters most); `test_quote_direct_postgrest.py`, `test_quote_races.py`, `test_quote_api.py`, `test_order_races.py`; `services/ai-api/tests/test_quotes_builder.py`, `test_quotes_repository.py`, `test_quotes_routes.py`; the rehearsal driver and `docs/rehearsal-click-checklist.md`; a mutation pass over the changed guards.

**API:** `app/quotes/builder.py` (a manual `build_request`, the band function), `service.py` (`create_draft`, `recomputed_hash`, `setup`, `render_text` to read manual lines), `models.py` (`CreateManualQuoteIn` with typed lines, each 1 paise to ₹1,000,000 like a list price), `repository.py`, `routes.py`. **Web:** `apps/web/lib/api/quotes.ts`, a manual-quote form beside `enquiries/create-quote-form.tsx`, `quote-view.tsx` ("typed by", the warning), tests. **Text:** the lane C renderer 1.2.0 of section 4.

## 6. The soft warning for a typo in a typed price (never a block)

A typed price can hold a slip such as an extra zero. The policy gets an **optional range**: `price_warn_min_paise` and `price_warn_max_paise` (both nullable; both empty means no warning). **Synthetic placeholders for tests and the checklist: ₹1,000 to ₹120,000 (NOT the owners' numbers).** Two places, neither able to stop anything:

1. **On the screen, before saving** (web only, no database change): the typed price is shown back in Indian grouping **and in words** ("₹1,20,000.00, one lakh twenty thousand rupees"); if it is outside the range the screen shows a warning in plain words ("This price is outside your usual range of ₹1,000 to ₹1,20,000. Check for an extra or a missing zero.") with a tick "Yes, this price is right" that the person ticks and saves. The warning is advice: the policy range can be empty, and the save works either way.
2. **On the quote, derived by the database:** a new review flag (for example `TYPED_PRICE_OUTSIDE_RANGE`) is **derived by the database from the stored prices and the policy's range** (never taken from the payload, like the other review flags), stored with the quote and shown in the quote view and on the approval screen: "A typed price is outside the range set in the policy." It does **not** set `needs_owner_approval`, does **not** raise SM218 and does **not** stop approval. It is information for the person who approves.

**Honest limit:** one range for all sarees has little power when prices run from ₹1,500 to ₹100,000: an extra zero on a ₹2,000 saree (₹20,000) lies inside any range that also fits the dearest saree. A stronger soft warning, **later and read-only**: compare with the **last price typed for the same saree-type code** (the code is stored on each manual line) and warn when the new price is more than a policy-set factor above or below it. That needs no new table (it reads earlier manual quote lines) and is also never a block. Size: step 1 is **S**; the flag is part of slice 2 (**S** inside the **L**); the comparison is **S to M** afterwards.

## 7. The follow-up clock and the WhatsApp step

After approval the owner uses the approved text as today. **Item f** (independent of the pricing, size S, web only): on the approved quote, **Copy** (exists, `enquiries/copy-text.tsx`), **"Open in WhatsApp"** (a `wa.me` link built on the server from the contact's phone and the approved text; rules in `docs/plans/customer-zero-intake-gap.md`, section 12), and **"I sent it on WhatsApp"** calling the existing `POST /leads/{id}/touches` (outgoing, channel `whatsapp`). That outgoing touch **starts the follow-up clock**: a lead enters the due list only after at least one outgoing touch (`docs/plans/followups-due-candidates-plan.md`, L1; the engine answers `initial_outreach_required` without one), so the button sits **right after "Open in WhatsApp"**. It needs a contact with a phone, a suppression key and a **granted** consent (the forms built on `web/customer-forms`). Nothing is sent by the system. A withdrawn quote stops the follow-up (`app.followup_stopped`).

## 8. Sizes

| Slice | What | Size |
| --- | --- | --- |
| 1 | migration: policy fields (rate source, warning range), kind columns, relaxed nullability, the new flag value; pgTAP | M |
| 2 | migration: `quote_build_manual`, rate function, `create_manual_quote_draft`, `approve_quote` replacement, the derived flag; pgTAP; equivalence extension (per-line rates, band edges); races; **full `make check`** | **L** |
| 3 | API: builder, service, models, routes, repository; tests | M |
| 4 | web: the manual-quote form, typed-price echo in words, the soft warning, "typed by"; tests | M |
| 5 | lane C: `quote_text` 1.2.0 (no shipping block when the fee is zero) and its adoption in lane A | M |
| 6 | item f (WhatsApp link, "I sent it") | S |
| 7 | rehearsal driver, click checklist, mutation pass, docs and ADR | M |
| | **Total** | **L** (option 1 for the rate is smaller by about one M) |

## 9. What I would NOT do

* Not edit `app.quote_build` or `create_quote_draft` (list quotes stay byte-identical); not edit any pushed migration.
* Not let the web or the API compute a price, a tax or a total; not let a model suggest a price or a rate.
* Not add a discount path, a margin floor, a per-customer price table, or anything about a courier (no courier field, no rate table, no GST on courier).
* Not let the owner type the GST rate (option 4) in v1; not code any rate or range: the policy holds them, empty by default, and a manual quote with no rate source is refused.
* Not turn the warning into a block, an extra approval or a second person.
* Not make a screen that edits a typed price in place (a new draft instead).
* Not require a catalog product for a manual line; not delete the product form.
* Not send anything: the owner sends by hand; direct sending stays a separate plan item with its own written approval.

## 10. Commit slicing with STOP points

Each commit: `make check-fast` and the touched tests; any commit that touches the database, a permission or the quote path runs the **full `make check`**.

1. **ADR sketch + plan approval** *(docs only)*. **STOP: the owner approves the design and answers section 12.**
2. Slice 1 (migration, M). **STOP: owner reviews the migration and the pgTAP before slice 2** (security-sensitive: RLS, SECURITY DEFINER, grants).
3. Slice 2 (functions and the equivalence proof, L). **STOP: the owner reads the equivalence results (per-line rates, band edges) and the mutation survivors.** Full `make check` from a clean `make db-reset`.
4. Slices 3 and 4 as two commits each (code, tests). **STOP if** an existing list-quote test has to change, a dependency is needed, or anything needs real data.
5. Slice 5 (lane C renderer, its own branch from lane C's rules, then lane A adoption) and slice 6 (item f).
6. Slice 7 (rehearsal, checklist, mutation pass, ADR). **STOP: the owner clicks the rehearsal once.**

## 11. The order relative to items d, e, f

* **d (the quote policy page): first among the quote items.** It must carry the new policy fields (the rate source, the warning range) and set the shipping fields to zero; the new fields need slice 1's migration, so d can be built in two steps: the existing fields now, the new fields after slice 1.
* **f ("Open in WhatsApp" and "I sent it"): any time after the customer and consent forms**, because it works on any approved quote, including a list-price one; doing it first starts the follow-up clock for quotes made today. It is independent of the pricing work.
* **e (the quick-quote screen): after slice 4.** Built earlier it would orchestrate the list-price path (enquiry, fields, confirm, pick, draft); built after, it targets the manual kind and needs no product pick.
* **Recommended sequence:** d (existing fields), then f, then slices 1 to 4, then d's new fields, then e, then slices 5 to 7. Slice 5 (the renderer) can run in parallel in lane C once the owners agree to hide the zero shipping lines.

## 12. Decisions I need from the owner

1. **Who may type a price:** Owner and Admin only (recommended), or Sales too?
2. **The GST rule (the accountant's answer):** one rate, or by price band, or by saree type? Where are the limits (inclusive or exclusive), and is it the price per piece before GST? What is "a piece" for a set? Until answered, options 2 and 3 are built only with the synthetic placeholders above.
3. **The soft warning:** the policy range (min and max) as in section 6, and do you want the later "compared with the last price for this saree type" warning?
4. **The text:** hide the three zero shipping lines (a lane C renderer version) or accept them for now?
5. **Delivery state:** keep asking for it (it decides whether the GST is the same-state or other-state kind, which the text does not show) or drop the question for this shop?
6. **Is a catalog product still wanted** for each saree type (the product form), or should saree types live only in the requirement?
7. **Order of work:** the sequence in section 11, or f first?

**Not decided (left open on purpose):** the one-line text variant; a per-customer price table; direct sending.

## 13. ADR sketch (not the ADR)

*Title:* a quote has a pricing kind. *Context:* the owners decide each price; there is no courier; the GST rate may depend on the price per piece; the database must still recompute. *Decision:* add a `manual` kind whose typed prices are arguments of a new definer function, stored immutably, rebuilt by a separate SQL function and re-proved against the pinned engine; the policy supplies the rate rule and an optional warning range; list quotes are untouched. *Consequences:* two SQL arithmetic paths kept equal by the equivalence test; approval skips the price-list staleness test for manual quotes only; the catalog becomes optional; a lane C renderer version removes the empty shipping block.
