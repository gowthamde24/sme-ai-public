# Lane C checklist notes

## T009 — deterministic quote calculation

- Checklist row: deterministic pricing/quote draft; pure calculation portion ready
  for owner review, not an approval or authoritative catalog integration.
- Added `packages/quote-engine/src/quote_engine/`, stdlib unittest tests and a
  synthetic JSON fixture. API/rules/handoff: `docs/plans/t009-quote-engine.md`.
- Evidence: `make test-packages` covers MOQ/break edges, exact half-paise rounding,
  taxes, all five flags, credit/payment dates, structured rejection, wrong types,
  JSON round trip, input immutability, pinned hash and 250 seeded property cases.
- `make check-leftovers` is the repository plumbing check; no stack, database,
  network, ports, dependencies, secrets or real customer/price data used.
- Risks/decisions: shipping tax is configurable and free strictly above a net threshold; credit
  means available balance credit, absent limit zero; duplicate order SKUs reject;
  inclusive rounding allocates residual paise to tax. Owner must confirm these.
- Lane A still owns approval, authoritative lookup, persistence, provenance,
  audit and integration/security verification. Unflagged results remain drafts.
- Proposed status: pure library complete; broader T009 remains pending lane A.

## T009 fix batch 1 — calculation bounds and shipping GST

- Baseline: 9 tests passed. Implementation/bound/property suite: 26 tests passed;
  `make check-leftovers` passed. Final mutation evidence follows below.
- `shipping.tax_bps` is optional, default zero. Exclusive fee is net; inclusive
  fee already includes tax. Totals expose item_tax/shipping_tax and shipping net/
  gross; the shipping tax trace records rate, rounding and separate amounts.
- Added named integer/collection/string/day limits (table in the API plan),
  preflight before hashing and item calculation. Oversized inputs return
  OUT_OF_RANGE with null hash; 10**30 and 100,000 poison-element lists are covered
  by structural no-hash/no-calculation checks rather than timing assumptions.
- First break below MOQ rejects, avoiding a discount tier for invalid quantities.
  All order amounts are INR paise; the tax mode applies to merchandise and shipping.
- Every seeded property case owns fresh inputs: parts/split sums, repeated output/
  hash equality, immutability, line permutation totals and nonincreasing prices.
- Fixture input/engine version/pinned hash remain unchanged. Adding explicit
  shipping.tax_bps (including zero) intentionally changes the request hash.
- Owner must confirm GST on shipping, advance rates, rounding mode, MOQ exception
  policy and operational limits. This is pure calculation; approval, authoritative
  catalog lookup, persistence, provenance and durable audit remain lane A work.

### Manual deliberate-mutation evidence

Each row was a temporary edit in the lane C engine, followed by
`make test-packages`, inspection of a failing test, and reversion. No mutation
script was added or run. The engine diff was empty after all reversions.
"Added test" means introduced in response to a surviving mutation; other tests
already existed when that mutation ran (including batch 1 shipping/bound tests).

| Mutation | Killed by which test | Added test |
| --- | --- | --- |
| Swap half_up/half_even tie labels | test_half_paise_rounding | no |
| Treat half_even as down | test_half_paise_rounding | no |
| Remove down branch (nearest instead of floor) | test_down_non_half_rounding | yes |
| free_above: > to >= | test_payment_dates_shipping | no |
| MOQ: qty < minimum to <= (minimum > qty to >=) | test_price_edges_and_minimum | no |
| discount ceiling: > to >= | test_each_flag_and_boundaries | no |
| credit limit: > to >= | test_each_flag_and_boundaries | no |
| Inclusive item denominator: 10000 + rate to 10000 | test_tax_known_values | no |
| Inclusive shipping denominator: 10000 + rate to 10000 | test_shipping_tax_modes_and_default | no |
| Margin: net - cost to net + cost | test_each_flag_and_boundaries | no |
| Advance: bps to 10000 - bps | test_payment_dates_shipping | no |
| Balance: total - advance to total + advance | test_seeded_properties | no |
| Suppress DISCOUNT_ABOVE_CEILING flag (trace only) | test_each_flag_and_boundaries | no |
| Suppress BELOW_MINIMUM_ORDER_QUANTITY flag | test_price_edges_and_minimum | no |
| Suppress MARGIN_BELOW_FLOOR flag | test_each_flag_and_boundaries | no |
| Suppress CREDIT_LIMIT_EXCEEDED flag | test_each_flag_and_boundaries | no |
| Suppress UNKNOWN_SKU flag | test_each_flag_and_boundaries | no |
| Disable catalog DUPLICATE_SKU check | test_rejections | no |
| Disable DUPLICATE_ORDER_SKU check | test_rejections | no |
| Due date net_days + 1 | test_payment_dates_shipping | no |
| Valid-until validity_days + 1 | test_payment_dates_shipping | no |
| Omit engine_version from hash payload | test_round_trip_determinism_hash_and_no_mutation | no |
| Freeze hash input as_of leaf to fixture date | test_round_trip_determinism_hash_and_no_mutation | no |
| Remove break >= MOQ requirement | test_first_break_moq | no |

The down-branch mutation initially passed all 26 tests. A non-half 0.75-paise
rounding test was added while it was still applied, and failed (1 versus 0).
All 24 distinct mutations were killed and reverted; none remain. Duplicate-SKU
tests initially killed removal via missing rejection fields; explicit rejected
status assertions were added for clearer failures, then both removals rerun.
Final suite: 27 passing tests (9 before batch 1), plus 250 fresh seeded property
cases. `make check-leftovers` passes. Owner still needs green CI and lane A's
integration/security checks; no stack/database/network/ports were used.

## T009 fix batch 2 — version 1.1.0 and six additional mutations

- ENGINE_VERSION is 1.1.0: bounds, below-MOQ break rejection and new totals keys
  changed previously valid inputs/output. The fixture shape is unchanged; its new
  pinned hash is `03cf0189ba0aab67d49fdebaa800b0985499d1781b3482d953a3f4a740e2dbc9`,
  changed solely by the version in the canonical payload.
- MAX_UNIT_PRICE is 100,000,000 paise (INR 1,000,000), including costs and break
  prices. The existing at/above-limit tests exercise the raised bound. Added
  test_field_maxima_fit_preflight_integer_cap checks every named MAX_ constant
  against MAX_CREDIT_LIMIT so per-field maxima cannot outgrow the preflight cap.
- Shipping uses one GST rate per policy. For mixed-rate orders, the owner/accountant
  must decide how freight is taxed; this calculation engine does not decide it.
- Each mutation below was applied manually, tested with `make test-packages`,
  inspected and reverted. No script was added or run. "Added test" means added
  after the mutation survived the existing suite.

| Mutation | Killed by which test | Added test |
| --- | --- | --- |
| (a) Swap new/repeat advance rate selection | test_payment_dates_shipping | no |
| (b) Check credit against total instead of balance | test_payment_dates_shipping | no |
| (c) Use subtotal instead of merchandise net for free shipping | test_shipping_threshold_uses_discounted_merchandise_net | yes |
| (d) Omit shipping tax from total | test_shipping_tax_modes_and_default; test_seeded_properties | no |
| (e) Force down rounding for exclusive shipping tax | test_shipping_half_paise_rounding | no |
| (f) Stop at first qualifying price break | test_price_edges_and_minimum | no |

Mutation (c) initially passed all 28 tests. Added discounted-exclusive and
inclusive-tax cases with subtotal above threshold but net below threshold;
both failed while the mutation was applied. All six were killed and reverted.
Final suite: 29 passing tests (27 before batch 2), including 250 seeded cases;
`make check-leftovers` passes. Only lane C files changed; no push/network/stack/
ports. Approval, authoritative catalog lookup, persistence/provenance and audit
remain lane A work; CI and integration/security verification remain outstanding.
