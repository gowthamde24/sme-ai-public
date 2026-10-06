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

## T010 — pure follow-up cadence decision engine

- Discovery verified before implementation: unchanged `make test-packages`
  discovered `pure/followup_cadence/tests` and passed its nested package import.
  No runner or scripts changes. New code lives in `packages/pure/followup_cadence`.
- Baseline implementation: 28 cadence tests plus 29 existing quote tests pass;
  `make check-leftovers` passes. Includes 250 fresh seeded cases for suppression/
  inbound/closed/limit precedence, eligibility, determinism, immutability and
  monotonicity at the same touch number; bounds and huge inputs are covered.
- Pure decide(request) returns only stop/wait/draft_followup or rejection.
  Policy supplies cadence/calendar numbers; explicit UTC as_of and fixed offset,
  integer-only JSON, version 1.0.0, canonical hash and calculation trace.
- Assumptions: initial outbound counts toward max_touches; gap_days[0] is before
  touch 2; no outbound means initial_outreach_required; equal quiet endpoints
  now reject INVALID_QUIET_HOURS (T010 fix); all outbound attempts count; any inbound means takeover.
- API/rules/bounds and owner decisions: `docs/plans/t010-followup-cadence.md`.
  Legality (consent, DND, opt-in and HMAC suppression list) is NOT decided here;
  lane A must supply authoritative flags before first outreach and owns approval,
  lookup, reply handling, persistence, provenance, audit and integration/security.
- Manual mutation pass evidence follows. No database/network/ports or real data.

### T010 manual mutation evidence

Each mutation was applied individually to the real engine, checked using
`make test-packages`, inspected and reverted. All 28 distinct mutations were
killed; no survivor remained. No mutation scripts were added or run. Engine
diff against the baseline commit is empty after reverting every temporary edit.

| Mutation | Killed by which test | Added test |
| --- | --- | --- |
| Ignore do_not_contact suppression | test_suppression_precedence_each_flag | no |
| Ignore opted_out suppression | test_suppression_precedence_each_flag | no |
| Ignore bounced suppression | test_suppression_precedence_each_flag | no |
| Ignore inbound history takeover | test_inbound_and_replied_precedence | no |
| Ignore replied flag takeover | test_inbound_and_replied_precedence | no |
| Ignore won before touch limit | test_closed_precedence | no |
| Ignore lost before touch limit | test_closed_precedence | no |
| max_touches reached: >= to > | test_max_touches_boundary; test_zero_limit_without_history | yes (clarity) |
| eligible <= as_of to < | test_exact_gap_boundary | no |
| Same-day quiet start: <= to < | test_quiet_same_day_boundaries | no |
| Same-day quiet end: < to <= | test_quiet_same_day_boundaries | no (assertion clarified) |
| Wrapped quiet start: >= to > | test_quiet_wrap_boundaries_and_india_offset | no |
| Wrapped quiet end: < to <= | test_quiet_wrap_boundaries_and_india_offset | no |
| Wrapped quiet OR to AND | test_quiet_wrap_boundaries_and_india_offset | no |
| Quiet next-day boundary: >= to > | test_quiet_wrap_boundaries_and_india_offset | no |
| Ignore holiday skipping | test_weekday_and_holiday_chain | no |
| Ignore weekday skipping | test_weekday_and_holiday_chain | no |
| Gap index number-2 to number-1 | test_gap_index_and_latest_outbound | no |
| Remove minimum-gap floor | test_min_gap_boundary | no |
| Remove as_of floor | test_exact_gap_boundary; test_seeded_properties | no |
| Omit history from hash inputs | test_determinism_hash_and_immutability | no |
| Change ENGINE_VERSION to 1.0.1 | test_nested_package_import_and_version | no |
| Future-history boundary: > to >= | test_timestamp_rejections | no |
| Anchor earliest instead of latest outbound | test_gap_index_and_latest_outbound | no |
| Subtract instead of add recipient offset | test_quiet_wrap_boundaries_and_india_offset | no |
| Omit engine_version from hash payload | test_determinism_hash_and_immutability | no |
| Collection upper boundary: > to >= | test_list_limits | no |
| Integer field upper boundary: > to >= | test_scalar_limits | no |

The max-touch and quiet-end mutants initially caused test errors rather than
assertion failures; these were already killed (nonzero test exit). Added an
explicit zero-limit/empty-history test and rejection assertions, then reran
those mutants to confirm clear failures. No mutation survived a green suite.
Added separate nested wrong-type coverage as well. Final: 30 cadence tests + 29
quote tests (59 total), including 250 cadence property cases. Both permitted
Make checks pass. Owner must still confirm cadence/calendar/reply decisions;
lane A integration, legal/authoritative flags, approval and CI remain outstanding.

### T010 fix — terminal decisions and distinct quiet endpoints

- Every non-rejected decision includes boolean terminal. It is true for
  do_not_contact, opted_out, bounced, human_takeover, won, lost and
  max_touches_reached; false for initial_outreach_required and wait/draft_followup.
  Rejections have no terminal field. Tests cover every reason, including inbound
  and replied takeover paths; seeded properties assert terminal/nonterminal cases.
- Equal quiet-hours endpoints now reject INVALID_QUIET_HOURS, including when
  suppression flags are set (invalid requests reject before decision rules).
  Former equal-endpoint acceptance became rejection tests; seeded cases sample
  distinct endpoints. Zero-gap testing remains covered with valid quiet hours.
- Lane A handoff explicitly requires draft de-duplication by (lead, touch_number):
  decide() repeats draft_followup until an outbound is recorded. Added a repeat/
  record test, including a failed outbound on another channel, which still counts.
  Weekday numbering is Monday=0; every outbound counts regardless of channel/outcome.
- Both mutations below were applied individually to the real code, run through
  `make test-packages`, observed failing, and reverted. No survivors or scripts.

| Mutation | Killed by which test | Added test |
| --- | --- | --- |
| Flip terminal to true for initial_outreach_required | test_terminal_for_every_reason | yes (this fix) |
| Bypass equal-endpoint quiet-hours validation | test_equal_quiet_endpoints_reject | yes (this fix) |

Final checks: 33 cadence + 29 quote tests pass (62 total; 59 before fix), including
250 seeded cadence cases; `make check-leftovers` passes. Pure lane C changes only;
no push/network/database/ports. API and handoff updated in the T010 plan. Lane A
legal/authoritative flags, approval, persistence/audit and integration/CI remain pending.

## Order lifecycle: baseline

- Started clean on lane/c at e394cbe; HEAD equalled origin/main.
- Added a stdlib pure transition API, synthetic fixture, all 132 state/event pairs,
  monetary and date boundaries, bounded preflight and 250 seeded 24-step sequences.
- No close event was requested: delivery closes a settled order; payment closes
  an already delivered order. Overpayments reject and flag for owner review.
  Refunds occur before terminal cancellation; lane A owns later reconciliation.
- `make test-packages`: 27 lifecycle + 33 cadence + 29 quote tests pass (89 total;
  62 before this task). `make check-leftovers` passes. No external services used.
- API, matrix, conservative bounds and owner decisions: docs/plans/order-lifecycle.md.
- Manual mutation results follow; all mutations were reverted to the baseline.

### Order lifecycle deliberate-mutation pass

Applied each mutation separately to the real library by hand, ran
`make test-packages`, observed exit 2 with the named test failing, then reverted
before the next mutation. No mutation scripts added. All 36 were killed by
baseline tests; no survivors or extra tests needed. “Added test” means added
because a mutation survived, rather than tests introduced with this package.
Final engine diff against baseline is empty.

| Mutation | Killed by which test | Added test |
| --- | --- | --- |
| 01 Expire <= becomes < (expiry equality succeeds) | test_expiry_boundary_and_before_accepted | no |
| 02 Send/accept > becomes >= at valid_until | test_send_and_accept_validity_boundary | no |
| 03 Cancel window > becomes >= | test_cancel_window_and_post_dispatch | no |
| 04 Preparation advance < becomes <= | test_advance_preparation_guard | no |
| 05 Dispatch advance < becomes <= | test_full_state_event_matrix (in_preparation, dispatch) | no |
| 06 Ignore owner_override on dispatch | test_dispatch_advance_and_override | no |
| 07 Ignore dispatch_requires_advance policy | test_dispatch_advance_and_override | no |
| 08 Ignore advance_required preparation policy | test_advance_preparation_guard | no |
| 09 Omit ADVANCE_OVERRIDE flag | test_dispatch_advance_and_override | no |
| 10 Ledger net adds refunds instead of subtracting | test_money_payment_refund_and_conservation | no |
| 11 Snapshot balance adds net instead of subtracting | test_overpayment_rejects_and_flags | no |
| 12 Incoming payment subtracts amount | test_money_payment_refund_and_conservation | no |
| 13 Incoming refund adds amount | test_money_payment_refund_and_conservation | no |
| 14 Proposed overpayment > becomes >= | test_overpayment_rejects_and_flags | no |
| 15 Snapshot overpayment > becomes >= | test_closed_only_delivered_and_exactly_paid | no |
| 16 Refund amount > becomes >= net paid | test_refund_cannot_exceed_paid | no |
| 17 Negative snapshot net < becomes <= zero | test_zero_total | no |
| 18 Disable historical duplicate payment check | test_idempotency_history_and_incoming | no |
| 19 Disable historical duplicate refund check | test_idempotency_history_and_incoming | no |
| 20 Disable incoming payment replay check | test_idempotency_history_and_incoming | no |
| 21 Disable incoming refund replay check | test_idempotency_history_and_incoming | no |
| 22 Advance payment >= becomes > | test_advance_payment_and_refund_threshold | no |
| 23 Refund below advance < becomes <= | test_advance_payment_and_refund_threshold | no |
| 24 Closure balance == 0 becomes != 0 | test_closed_only_delivered_and_exactly_paid | no |
| 25 Close any fully paid state before delivery | test_closed_only_delivered_and_exactly_paid | no |
| 26 Disable CLOSED_UNPAID snapshot guard | test_closed_only_delivered_and_exactly_paid | no |
| 27 Delete quote_approved/send_quote matrix entry | test_full_state_event_matrix (quote_approved, send_quote) | no |
| 28 Add declined/deliver terminal matrix entry | test_full_state_event_matrix (declined, deliver) | no |
| 29 Omit payments from canonical hash input | test_hash_determinism_roundtrip_and_immutability | no |
| 30 Change engine version to 1.0.1 | test_hash_determinism_roundtrip_and_immutability | no |
| 31 Incoming payment capacity >= becomes > | test_proposed_entry_capacity_and_allowed_events | no |
| 32 Preflight amount cap > becomes >= | test_amount_upper_bound | no |
| 33 Omit REFUND_REQUIRES_OWNER_APPROVAL flag | test_money_payment_refund_and_conservation | no |
| 34 Omit CANCELLATION_WITH_FUNDS flag | test_cancel_window_and_post_dispatch | no |
| 35 Disable invalid advance amount guard | test_invalid_values_and_types | no |
| 36 Omit incoming OVERPAYMENT flag | test_overpayment_rejects_and_flags | no |

After all reversions: 27 lifecycle + 33 cadence + 29 quote tests (89 total),
including the full 132-pair matrix and 250 seeded lifecycle sequences.
`make test-packages` and `make check-leftovers` pass. No database, network,
ports or pushes; integration, approvals and real payment verification belong to A.
`./scripts/check-lane-paths.sh c main` output:
`Lane C: changed paths allowed under base policy` (exit 0).

## Requirement mapper: baseline

- Started from clean lane/c HEAD 4618cd9, building on unmerged order lifecycle
  commits 4618cd9 and a565cf3 as requested; no fetch, network or pushes.
- Only packages/pure/requirement_mapper/**, its plan and these notes changed.
  Existing runner automatically discovers/imports this nested package.
- Added pure proposed matches, strict structured type/schema rejections, fixed
  messages, bounded preflight, canonical snapshot hash and synthetic fixtures.
- Owner confirmed empty category-failure alternatives. Fabric/colour failures
  retain preceding relevant candidates. Absent attributes strictly exclude.
  Single known unit mismatch requires human review; unknown product units remain
  proposals for confirmation. Order rows are the explicit free-text pass-through
  exception. Added irrelevant products change the snapshot hash, not decisions.
- All proposals require a human. No choices, prices, line merges or persistence.
  Lane A supplies confirmed rows, config, authoritative catalog, approvals/audit.
- `make test-packages`: 34 mapper + 89 existing tests pass (123 total; 89 before).
  Includes 250 seeded mapper cases. `make check-leftovers` passes.
- API, bounds and handoff: docs/plans/requirement-mapper.md. Manual mutation
  evidence follows in the next commit; integration and real data remain with A.
