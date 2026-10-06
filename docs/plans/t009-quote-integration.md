# T009 integration (lane A): from a confirmed requirement to an approved DRAFT quote

Status: **PLAN ONLY, awaiting the owner's review.** No code, no migration. Written 2026-10-06 after T008 was accepted.
Not to be confused with `docs/plans/t009-quote-engine.md`, which is lane C's contract for the pure calculation library. This plan is lane A's half: authoritative inputs, persistence, approval, provenance, audit, the screens.

**The slice:** a person looks at a CONFIRMED requirement (T008), confirms which catalog product each line means, a deterministic service prices it, and an Owner/Admin approves the resulting DRAFT quote. **Nothing is ever sent, no PDF, no e-mail, no payment, no order.** No model is involved anywhere in this slice: the mapper and the engine are pure deterministic libraries and the people decide. (Roadmap: "AI only explains"; in this slice the explanation is the engine's own rule trace rendered through closed templates. A model-written explanation waits for the live batch and the owner's approval of a provider.)

## Owner decisions on this plan (2026-10-06, accepted in principle)

1. A Viewer sees no price lists or policy **and no quote totals** (for now); prices, policies and quotes are Owner/Admin/Sales only, and a Viewer sees at most that a quote exists (status chip), never an amount.
2. `discard_requirement` is blocked by a draft AND an approved quote (SM212).
3. No tax advice in code or docs; GST slabs and freight rules are owner/accountant inputs; synthetic seed values only.
4. Advance, validity, net days, credit limit and freight are synthetic seeds.
5. aal2 to approve a quote and to publish a price list, policy or mapper version.
6. Delivery state is required, as proposed.
7. **The optional Prices and Policy pages are SKIPPED for T009** (commit 7 of section 7 is dropped): synthetic data is seeded through a script, and "price-list CSV import" is a pre-pilot checklist row.
8. The two Dockerfile COPY lines are a T012 checklist row, not built now (commit 8 keeps only the plan's as-built notes, ADR and checklist rows).

Progress: commit 1 (the `quote_engine` adapter) is done; the mapper checkpoint and every migration wait for the owner's confirmation.

## 0. What I read, what I verified, what I assume

Read: CLAUDE.md, AGENTS.md, docs/lanes.md, docs/product.md, docs/architecture.md, ADR 0013 (agent path; not on this slice's path), ADR 0016 (aal2), ADR 0018 (requirements), `docs/plans/t009-quote-engine.md`, `t010-followup-cadence.md`, `roadmap.md`, lane C's notes, and (read through git from `lane/c`, never from lane C's folder) `docs/plans/order-lifecycle.md`.

Verified in the repository:

* The engine: `packages/quote-engine/src/quote_engine`, `quote(request) -> dict`, `ENGINE_VERSION = "1.1.0"`, `canonical_json`, integer paise and bps only, no clock, no I/O. Hash = sha256 of canonical JSON of `{"engine_version", "inputs": request}`. Inputs: `as_of`, `price_list[{sku, name, unit_price, minimum_order_quantity, price_breaks[{min_qty, unit_price}], tax_bps, cost?}]`, `customer{kind: new|repeat, credit_limit?}`, `order_lines[{sku, qty, discount_bps?}]`, `policy{discount_ceiling_bps, shipping{flat_fee, free_above?, tax_bps?}, validity_days, payment_terms{new_advance_bps, repeat_advance_bps, net_days}, tax_mode, rounding_mode?, margin_floor_bps?}`. Flags: DISCOUNT_ABOVE_CEILING, BELOW_MINIMUM_ORDER_QUANTITY, MARGIN_BELOW_FLOOR, CREDIT_LIMIT_EXCEEDED, UNKNOWN_SKU. Bounds: quantity 10,000 per line, unit price INR 1,000,000, 100 lines, 1,000 catalog items, net days 180, validity 365.
* **The engine takes ONE tax rate per catalog item and one for shipping. It knows nothing about states.** Delivery state therefore does not change any number in v1 (section 4).
* `requirement_v1` (security invoker): confirmed/corrected fields of a confirmed requirement: `requirement_id, tenant_id, enquiry_id, confirmed_by/at, field_id, line_no, field_key, value_code/int/date/text, basis, state`. Quantities are pieces or sets (`basis`), money is paise.
* `products` (T003): `sku, name, unit, category, attributes jsonb (<= 4 KB), active`; unique (tenant, sku). **Prices do not exist anywhere yet.**
* Lane C's `order_lifecycle` (on `lane/c`, not on `main`) starts at `quote_approved`: the status names below are chosen to line up with it. Order conversion is a later ticket and is NOT wired here.
* `deploy/Dockerfile.api` copies only `services/ai-api/app`: the pure packages are not in the image (section 1).
* SQLSTATEs in use: SM201 to SM211, SM306 (second factor). Next free: SM212.
* ADR numbers for lane A: 0017 to 0039; **next is 0019**.

**Assumption (stated, not verified): the requirement mapper.** `docs/plans/requirement-mapper.md` does not exist on `main` or on `lane/c` yet. I plan against the contract you described: input = `requirement_v1` rows + a catalog snapshot + a config; output = per line a status in `matched | ambiguous | unmatched | needs_human | needs_input` and an `order_lines_proposal`; a human confirms every proposal. Everything about the mapper in this plan is behind one adapter and a "contract checkpoint" (section 7, commit 2) so nothing blocks on it: **the manual pick path (a person searches the priced catalog) works without the mapper; the mapper only pre-fills.**

## 1. How lane A calls the pure packages (no new dependency)

* **One adapter module per package, and only the adapters import them:** `services/ai-api/app/quotes/engine_port.py` (`quote_engine`) and `app/quotes/mapper_port.py` (`requirement_mapper`). A boundary test (the T006/T008 pattern, `tests/test_agents_boundary.py`) fails if any other module imports them, and the agent sandbox can never reach them.
* **Import path, no packaging change to the package itself:** the adapter resolves the repository root from its own file, puts `packages/quote-engine/src` and `packages/pure` on `sys.path` once, and **fails closed** (the quote endpoints answer 503 `quotes_unavailable`) if the package is missing or the version is not on the allow-list. Stdlib only, nothing added to `pyproject.toml` dependencies. `mypy` gets two per-module `ignore_missing_imports` overrides (not a global one).
* **Deployment is a known gap, not built now:** `deploy/Dockerfile.api` must `COPY packages/quote-engine/src` and `packages/pure` and set the path (a two-line change, A-owned). I will make that edit in the docs commit but it stays **untested until T012** (no deployment before then; recorded in the checklist).
* **Versioning is explicit, in three places:**
  1. the adapter pins `EXPECTED_ENGINE_VERSIONS = {"1.1.0"}` and refuses to run any other version;
  2. a **golden test** runs lane C's synthetic fixture and asserts the pinned canonical hash: a package upgrade by lane C cannot go unnoticed (the test fails until A reviews the changelog and moves the pin);
  3. every quote stores `engine_version`, and the database accepts only versions listed in a tiny table `quote_engine_versions` that a migration extends (a new engine version needs a reviewed migration, never a config flip).
* **Canonical hash:** the engine's own `canonical_hash` (sha256 of `{"engine_version": ..., "inputs": <request>}`, sorted compact ASCII JSON) is the quote's hash. I store the **exact canonical request text** (a `text` column, not `jsonb`, which would renormalise it), so the database can bind the hash to the stored request itself (section 3). The mapper's output gets the same treatment (its own `mapper_version` + hash, stored with the proposal).
* `as_of` is supplied by the API: today's calendar date in Asia/Kolkata (the T008 rule). The engine never reads a clock.
* Money: integers only end to end (paise, bps). The API models use `int`; a float anywhere is a test failure. The web shows rupees by formatting integers (the T008 `rupees()` pattern).

## 2. Schema (proposal; one migration pair, see section 7)

Pattern for every table: `tenant_id`, `unique (tenant_id, id)`, composite foreign keys, tenant id immutable, RLS enabled and forced, **writes only through `SECURITY DEFINER` functions with `search_path = ''`** (no client INSERT/UPDATE/DELETE grants, like T008), `audit_row_change` triggers, column classification comments (SAFE / PII), immutability triggers, and the catalog guards (pgTAP 00001, 06, 28, 41) updated. **Every quote writer locks the enquiry row FIRST** (ADR 0018 decision 9 invariant), then the requirement row, then the quote row.

**Reference data: immutable versions, created whole, never edited.** A version is created in one call from a validated payload; there is no draft state and no UPDATE. A correction is a new version.

| Table | What it holds |
| --- | --- |
| `price_lists` | one row per tenant in v1 (`name`, `currency` fixed `INR`). A second list (retail/wholesale) is a later row, not a redesign. |
| `price_list_versions` | `version_no` (per list), `effective_from date`, `retired_at`, `content_sha256` (computed by the database over the items in a fixed order), `created_by/at`. Rule: `effective_from` may be today or later, **never earlier than the latest existing version** (no retroactive history). Active at a date = the latest version with `effective_from <= date` and not retired. |
| `price_list_items` | `version_id`, `product_id` (composite FK to `products`), **snapshots** of `sku` and `name`, `unit_price_paise`, `minimum_order_quantity`, `tax_bps`. Bounds are the engine's (price <= 100,000,000; qty <= 10,000; bps <= 10,000). |
| `price_list_breaks` | `item_id`, `min_qty`, `unit_price_paise`: strictly increasing quantity, non-increasing price, first break >= MOQ (the engine's rules, checked again in SQL), at most 20 per item, 1,000 items per version. |
| `quote_policy_versions` | same version pattern. Fields: `discount_ceiling_bps`, `shipping_flat_fee_paise`, `shipping_free_above_paise?`, `shipping_tax_bps`, `validity_days`, `new_advance_bps`, `repeat_advance_bps`, `net_days`, `tax_mode` (**`exclusive` only in v1**, a CHECK), `rounding_mode` (`half_up` default), `repeat_credit_limit_paise`, `seller_state`, `required_inputs text[]` (section 4), `margin_floor_bps` **always null in v1**. |
| `mapper_config_versions` | same pattern; `config jsonb` (bounded, <= 16 KB) validated by the Python mapper before the call and size-checked by the database. **The database does not understand it** (honest limit: it can only make the mapper propose differently; a person confirms every pick, so a bad config cannot price anything). |
| `quote_engine_versions` | the allow-list of section 1. |

**Per-requirement work:**

| Table | What it holds |
| --- | --- |
| `requirement_mappings` | one row per mapper run: `requirement_id`, `mapper_version`, `mapper_config_version_id`, `price_list_version_id`, `input_sha256`, `output_text` (canonical, bounded) + `output_sha256`, `created_by`. Provenance for "why was this suggested". Idempotent on `input_sha256`. |
| `requirement_line_picks` | the **human product pick**: `(requirement_id, line_no)` unique, `product_id`, `qty` (integer in the product's unit, 1..10,000), `state` (`confirmed`), `source` (`mapper` or `manual`), `mapping_id?`, `decided_by/at`. Written only by `pick_requirement_line_product`. A person must confirm **every** line, including `matched` ones; a `set` basis or a quantity the mapper marks `needs_input` is entered by the person here (nothing infers pieces from sets). |

**Quotes:**

| Table | What it holds |
| --- | --- |
| `quotes` | `quote_no` (per tenant, "Q-0001": a counter row locked inside the function; gapless is not promised on rollback), `requirement_id`, `enquiry_id`, `lead_id`, `company_id?` (composite FKs), `status` **`draft | approved | rejected | superseded`** (never "sent": nothing is sent), `supersedes_quote_id?`; provenance: `price_list_version_id`, `policy_version_id`, `mapper_config_version_id?`, `engine_version`, `request_text` (canonical), `canonical_hash`; context: `customer_kind`, `delivery_state?`, `delivery_city?` (text from the requirement: **classified PII**, see below), `requested_deadline?`; results: `as_of`, `valid_until`, `total_paise`, `advance_paise`, `balance_paise`, `due_date`, `result_text` (the engine output, canonical, trace included); flags: `engine_flags text[]` (codes), `review_flags text[]` (API-added, closed set, section 3), `needs_owner_approval` (**computed by the database**, never taken from the payload); `created_by/at`, `approved_by/at`, `approved_aal`, `rejected_by/at`, `reject_code` (closed list). |
| `quote_lines` | `quote_id`, `line_no`, `requirement_line_no`, `product_id`, `sku` and `name` snapshots, `qty`, `unit_price_applied_paise`, `price_break_min_qty?`, `line_subtotal`, `discount_paise` (always 0 in v1), `net`, `tax`, `gross`, `tax_bps`, `rule_ids text[]` (the engine's trace rule ids for the line: "every quote line records its rule/source"). |

Constraints that make the table shape do part of the work: **one draft per requirement** and **one approved quote per requirement** (two partial unique indexes); a quote row's content columns are immutable after insert (trigger); only `status`, `approved_*`, `rejected_*` move, and only inside the functions.

**PII and erasure.** The only free-text-ish column that can carry a place is `delivery_city`; it is copied from the requirement's confirmed `value_text` and **registered for erasure in every scope** (`erasure.registry`, tombstone / substring, like `requirement_fields.value_text`). Everything else is codes, snapshots of business product names, integers and dates: classified SAFE. **No free-text note column in v1** (a reject reason is a closed code), so nothing else needs registering. `delivery_state` is a closed list code (36 states and UTs), not PII. The audit trigger names `delivery_city` in its masked-column list.

**RLS.** Read: Owner, Admin, Sales for prices, policies, mapper config, picks, quotes (**recommended: a Viewer sees none of the prices**; the existing tables let any member read, so this is a deliberate difference and an owner decision, section 9). Write: no client grant at all.

## 3. Create, approve, and what the database can and cannot prove

**Functions** (all `SECURITY DEFINER`, role proven first, an unknown id and another tenant's id are the same refusal, exact retries are replays):

| Function | Who | Second factor |
| --- | --- | --- |
| `create_price_list_version`, `create_policy_version`, `create_mapper_config_version` | Owner, Admin | **aal2** (price and policy changes are exactly the "workspace settings" ADR 0016 already protects) |
| `record_requirement_mapping` | Sales+ (called by the API with the mapper output) | no |
| `pick_requirement_line_product` | Sales+ | no |
| `create_quote_draft(p_id, ...)` | Sales+ | no |
| `approve_quote(p_id, p_recomputed_hash)` | Owner, Admin (Owner only when `needs_owner_approval`) | **aal2, recommended** |
| `reject_quote(p_id, p_code)` (supersede happens inside create and approve) | Owner, Admin reject; Sales may withdraw their own draft | no |
| `discard_requirement` (T008, changed) | unchanged roles | unchanged (section 5) |

**Recommendation on aal2 for approval: yes.** Approval is the act that turns a computed number into the basis of a commitment; ADR 0016 already puts the actions an Owner or Admin takes that move money-adjacent or workspace-wide state (erasure, export, memberships, workspace settings) behind aal2; approving a quote belongs with them. It costs nothing for Sales (they never approve) and one code entry for the person who does. Creating a draft and picking products stay aal1 (Sales-level, nothing committed). `confirm_requirement` stays aal1 (your decision 2). Sending, when it exists, will need aal2 too; decided in its own plan.

**`create_quote_draft` (the API computes, the database re-verifies).** The API, with the caller's JWT, reads `requirement_v1`, the picks, the active price list version, the active policy version, builds the engine request, runs the engine and calls the function with the canonical request text and the engine output. The function (enquiry row locked first, then requirement, then quote counter):

1. caller role, tenant from the requirement; requirement is `confirmed` and still has the saree type and quantity of every line confirmed (T008 rule); every requirement line has a **confirmed pick**;
2. `engine_version` is in the allow-list; sizes are bounded;
3. **hash binding:** `canonical_hash = sha256('{"engine_version":"<v>","inputs":' || request_text || '}')` computed in SQL; the stored text is the thing the hash covers;
4. **inputs equal their sources (the strong check):** the request's `policy` equals the policy version row; every `price_list` entry equals the version's item and breaks (sku, price, MOQ, breaks, tax_bps); every `order_line` is (pick's sku, pick's qty) and nothing else; `as_of` is today in Asia/Kolkata (+/- 1 day); `customer.kind` is the supplied one;
5. **output invariants (cheap, integer):** all amounts >= 0 and within the engine bounds; per line `qty * unit_price_applied = line_subtotal`, and `unit_price_applied` is the break price for that qty (the database recomputes the break lookup from the version's breaks); `discount = 0` (v1 has no discounts), `net = subtotal`; sum of line nets = merchandise net; sum of line taxes = item tax; `total = net + shipping net + tax`; `advance + balance = total`; `valid_until = as_of + validity_days`; `due_date = as_of + net_days`; line count and totals match `quote_lines`;
6. **flags are re-derived, not trusted:** BELOW_MINIMUM_ORDER_QUANTITY (qty < MOQ), CREDIT_LIMIT_EXCEEDED (repeat balance > limit), and the API-added `review_flags` (closed set: `TERMS_DIFFER_FROM_REQUEST`, `MIXED_GST_RATES_SHIPPING`, `DELIVERY_STATE_UNCONFIRMED`) decide `needs_owner_approval`; a payload that omits a flag the database can see is refused. With no discounts and no margin floor in v1 these are all the engine flags there can be;
7. one draft per requirement: a new draft supersedes the old draft in the same transaction (the T008 re-run pattern). Idempotent on `p_id`: same payload replays, a different payload under a used id is a conflict.

**`approve_quote`** (enquiry, requirement, quote locked in that order): role (and Owner-only when flagged), aal2, status `draft`, the requirement is still `confirmed`, today <= `valid_until`, **no newer price list or policy version is active than the ones the draft used** (stale: refused, the draft must be re-created), and `p_recomputed_hash = canonical_hash`. It records `approved_by/at/aal` and supersedes any earlier approved quote of the requirement (one approved at a time). A replay by the same approver returns the same result.

**Recomputation at approval (in the API, with the approver's JWT).** The API loads the quote's recorded sources by id (the versions, the picks, the requirement), checks their immutable `content_sha256`, **rebuilds the request and requires it to equal the stored `request_text` byte for byte, re-runs the engine, requires the same canonical hash and the same output**, shows the approver the recomputed numbers and flags, and only then calls `approve_quote` with the hash it computed. A mismatch is a 409 `quote_stale` / `quote_inconsistent` and nothing is approved.

**The limit, stated honestly.** The database **cannot run the engine**. It binds the hash to the stored request, makes the request equal its authoritative sources, and re-checks integer arithmetic and the derivable flags; it cannot re-derive tax rounding under every rounding mode, free-shipping thresholds or the trace. A caller who bypasses the API and holds a Sales token can therefore create a draft whose tax or shipping figure is wrong within those invariants. What stops it becoming a commitment: a draft is a draft; **approval is Owner/Admin + aal2 and re-runs the engine in the API**; the approver sees the recomputed figure; every step is audited with the actor. An Owner who calls `approve_quote` directly with the stored hash, skipping the API, is trusted (the T006 option-A limit again). **Closing it properly is option B (a dedicated service principal that signs results)**, required before any external customer and before any automatic step; recorded in the checklist.

## 4. What a quote needs (proposal, configurable policy)

**Always required (not configurable):** the requirement is confirmed (so every line has a person-confirmed saree type and quantity); every line has a **confirmed product pick** that is on the active price list; the customer kind (`new` or `repeat`) is confirmed by the person (default: `repeat` when the company type is `customer`, else `new`; shown, one tap to change).

**Configurable per tenant (`quote_policy_versions.required_inputs`, a closed set):** `delivery_state`, `delivery_city`, `payment_terms`, `deadline`.

**My recommendation, default `['delivery_state']`:**
* **delivery_state: required, a closed-list select** (the requirement holds only the city text; a person picks the state, pre-selected from the company region when it matches). It is recorded because the later invoice needs intra-state vs inter-state GST. **Honest note: in v1 it changes no number** (the engine has one rate per item); it is stored with a derived label `intra_state` / `inter_state` against `seller_state`, and a CGST/SGST/IGST split is NOT built.
* **payment terms: the policy default is used, and they are not required from the customer.** If the requirement has confirmed payment terms that differ from the policy (more days, a smaller advance), the quote still uses the policy and the API adds `TERMS_DIFFER_FROM_REQUEST`, which needs the Owner. v1 never silently adopts customer-requested terms.
* **deadline: optional**, shown next to the quote, no lead-time logic.
* **delivery city: optional**, shown.
* Budget, fabric, colour: not required; budget is shown beside the total, no comparison logic.

## 5. Blocking `discard_requirement`; `requirement_v1` is the only input

* `discard_requirement` (new migration, `create or replace`, copied from the LATEST definition with only added lines, the `test_migration_copies.py` rule) refuses with **SM212 "a quote depends on this requirement"** when any `draft` or `approved` quote references it. Recommendation: block **both**: a person rejects or withdraws the draft first (one click) instead of discard silently orphaning it; the alternative (discard auto-supersedes drafts but never approved quotes) is in the decisions list. Lock order enquiry, then requirement, then quotes, so a discard racing a create is one or the other (race test).
* The requirement itself is already frozen once confirmed (T008: no field can be added, decided or corrected after confirmation), so an approved quote's source cannot change; the only exits are discard (now blocked) and erasure (which anonymises the city text, not the codes and quantities the quote used).
* **`requirement_v1` is the only requirement input**: the API reads nothing else (no enquiry text, no quotes of fields, no proposals); a test greps the quote services for any other requirement table.

## 6. UI sketch (phone width first; inline styles like T008 unless B supplies components)

On the existing enquiry page, below the requirement panel, a **Quote** section that appears only when the requirement is Confirmed. A persistent line: **"Draft. Nothing is sent."** State chips follow the no-hidden-autonomy rule: *Suggested* (mapper), *Confirmed* (a person), *Draft*, *Approved*, *Rejected*, *Superseded*.

```
Quote                              [Draft]
1  Match products
   Line 1: Kanjivaram, red, 20 pcs
     (Suggested) KJ-RED-01  Kanjivaram red   Rs 4,200
     ( ) KJ-RED-02 ...        [Use this product]
     [Search the price list]
   Line 2: Banarasi, blue, 10 sets   -> "How many pieces?" [ 40 ]
2  Delivery and customer
   State [Telangana v]   Customer [Repeat v]
   Terms (from policy): 30 days, 25% advance
   [Create draft quote]
3  Draft Q-0007            valid until 21 Oct
   1  KJ-RED-01   20 x Rs 4,200      Rs 84,000
   Merchandise Rs 84,000 | GST Rs 4,200 | Shipping Rs 0
   Total Rs 88,200   Advance Rs 22,050   Balance Rs 66,150 due 5 Nov
   (!) Needs owner approval: below minimum order quantity (line 2)
   Why: price list v3, policy v2, engine 1.1.0, ref a3f9c1d2e4b5
   [Approve] [Reject]     (Sales sees "Waiting for approval")
```

* Lines become **cards** at phone width (no table); totals stack; flags are a banner with the closed reason text; "Why" is a collapsed block that renders the engine's rule trace through closed templates (the explanation, no model).
* Approve asks for the second factor in the existing flow (ADR 0016 redirect) and shows the recomputed numbers first.
* The lead page's enquiry list shows the quote chip. An **Owner/Admin "Prices" page** (paste a CSV of sku, rupees, MOQ, GST %, breaks `10:950;50:900`, preview against the active version, publish with aal2) and a **Policy** page come last and are optional for the first review: the demo seed provides a synthetic price list, policy and mapper config.
* Lane B owns `apps/web/components/ui/*`: A does not touch it. Either A uses inline styles (as T008) or B writes a contract in `docs/contracts/B/` for a product-pick card and a quote card; **default: inline**, B restyles later.

## 7. Commit order (small), stops, checks

0. This plan, reviewed. (**Stop: you are here.**)
1. **Adapters and golden tests (no database):** `engine_port.py`, `mapper_port.py` (against the stated contract; if the mapper package has not landed, a stub that reports `mapper_unavailable` and the manual path carries the slice), version allow-lists, pinned-hash golden test, import-boundary test, mypy overrides.
2. **Mapper contract checkpoint** (no code if the package is not there): reconcile this plan's section 2 mapper rows with `docs/plans/requirement-mapper.md` when it exists; any difference is reported before commit 3, not guessed.
3. **Migration + functions, part 1: reference data.** Versioned price list, policy, mapper config, engine-version allow-list, RLS, audit, classification, immutability, aal2 on the three create functions; pgTAP; direct-PostgREST attack tests.
4. **Migration + functions, part 2: picks, mappings, quotes, quote lines, create/approve/reject/supersede, the SM212 discard block**, lock order, flags re-derivation, hash binding, source equality, output invariants, erasure registration for `delivery_city`; pgTAP, direct-PostgREST attacks, two-connection races (create vs discard, approve vs discard, approve vs approve, create vs create, approve vs publish), lock probes. **STOP FOR YOUR REVIEW** (only here: after the migrations and functions).
5. API: models, services (read `requirement_v1`, assemble the request, run the engine, create, approve with recomputation), routes, contracts regeneration, structured-output, authorization and idempotency tests; `make seed-demo` extended with a synthetic price list, policy and mapper config.
6. Web: pick screen, draft quote, approve/reject; tests on mocks of the API client.
7. Web, optional: Prices and Policy pages.
8. ADR 0019 (quote integration), checklist rows, handoff, the Dockerfile COPY lines (untested until T012), the plan's as-built section. Then **one full `make check`** and **one mutation pass** over the new guards (every role check, aal2, hash binding, source equality, each output invariant, each flag, status transitions, the two uniqueness indexes, the discard block, lock order), then **a single report** and stop.

Between commits: `make check-fast` plus the tests I touched (pgTAP files and targeted integration tests for the database commits, after `supabase db reset`). Mutation harness hygiene as in `docs/handoff/next.md` (no stale bytecode). Lane A only runs the local stack and `make check`; nothing is pushed.

## 8. What I will NOT build

Sending of any kind (e-mail, WhatsApp, links), PDF or any document rendering, payments, advance requests or order creation (`order_lifecycle` is not wired), **any price, tax, discount or total calculated anywhere except the engine**, discounts (the ceiling is stored, `discount_bps` is not offered in v1), cost and margin (no cost column exists, margin floor is null), tax-inclusive mode, a CGST/SGST/IGST split, multiple currencies, credit tracking beyond the policy's flat limit, quote numbering guarantees beyond "unique, increasing", free-text notes, a model-written explanation, a customer-facing page, or any agent run. Follow-up and the Owner Agent stay with T010/T011.

## 9. Owner decisions (with my default)

| # | Decision | Default I will build |
| --- | --- | --- |
| 1 | **GST on shipping for mixed-rate orders** (the engine has one shipping rate per policy) | `shipping_tax_bps` is a policy field; when the lines have different rates the API adds `MIXED_GST_RATES_SHIPPING` and the Owner must approve. The owner or accountant states the rule for freight; I do not give tax advice. |
| 2 | **GST rate per SKU, and slabs.** A rate can depend on the unit price (a slab); the engine has one fixed `tax_bps` per item, so a price break or a discount could cross a slab | Rate set per item by the owner/accountant; no discounts in v1; **price breaks that would cross a slab are the owner's to avoid** (flagged in the price-list paste preview as a warning only if a slab table is supplied later). Needs the accountant. |
| 3 | **Advance rates** | New 50 % and repeat 25 % in the SYNTHETIC seed only, clearly labelled; the real values are the owner's before any real quote. |
| 4 | **Rounding** | Engine default `half_up`, once per line (as lane C proposed). |
| 5 | **MOQ exceptions** | A quote below MOQ is created and flagged; **only the Owner** may approve it. |
| 6 | **Who approves what** | Create draft: Owner/Admin/Sales. Approve unflagged: Owner or Admin. Approve flagged (`needs_owner_approval`): Owner only. Reject: Owner/Admin; Sales may withdraw their own draft. Publish prices/policy/mapper config: Owner/Admin. |
| 7 | **aal2** | Required to approve a quote and to publish any price/policy/mapper version; not for drafts or picks. |
| 8 | **Validity and net days** | 15 days validity, 30 net days (synthetic seed); real values the owner's. |
| 9 | **Discount ceiling** | 0 bps (no discount authority until set); v1 offers no discount input anyway. |
| 10 | **Shipping** | Flat fee 0 and no free-above in the seed; the real freight rule (actuals, per-parcel, free above) is the owner's. |
| 11 | **Repeat-customer credit limit** | 0 (every repeat balance is flagged) until the owner sets one. How a company becomes "repeat": company type `customer` (default) or a person's choice per quote. |
| 12 | **Required inputs** | `['delivery_state']` (section 4). |
| 13 | **Viewer sees prices?** | No. Prices, policies and quotes are Owner/Admin/Sales only. |
| 14 | **Discard with a draft quote** | Blocked until the draft is rejected or withdrawn (the alternative: auto-supersede drafts, never approved quotes). |
| 15 | **Stale price list at approval** | Refused: re-create the draft on the newer version. |
| 16 | **Tax mode** | Exclusive only in v1. |
| 17 | **Quote numbers** | Per-tenant "Q-0001" counter, not gapless on rollback. |
| 18 | **Catalog coding** | The family's real catalog (codes, colours, designs) decides how `products.attributes` carry `saree_type`, `fabric`, `colour` for the mapper; synthetic until Customer Zero. |

## 10. Risks and open points

* **The mapper contract is assumed** (section 0). It is isolated behind one adapter and a checkpoint; the manual path does not depend on it.
* **The database re-verifies, it does not recompute** (section 3). Option B before any external customer.
* **GST slabs and mixed-rate freight need the accountant** (decisions 1 and 2), not an engineer.
* **Packaging:** the Docker image does not contain the pure packages; fixed in commit 8, proven only at T012.
* **Real prices and costs never enter the repository**; the seed is synthetic and labelled.
* **Scope creep to watch:** discounts, PDFs and sending are the first things that will be asked for; each needs its own plan.
