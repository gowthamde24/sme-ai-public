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

## Quote text: baseline

- Retry fetched origin/main with merged CSV PR (5d912b7); lane/c is already at
  that HEAD and started clean. Work changes only quote_text/**, its plan and C notes.
- Owner confirmed separate {quote, approved, expected_engine_hash, display}
  wrapper; engine status stays draft. approved is A's authoritative approval,
  not the engine's needs_owner_approval flag. Hash must equal the approved record.
- Owner confirmed 200-character ordinary/display strings, separately bounded
  generated trace.text (4,000 characters). Metadata never appears in output.
- Pure English templates, Indian rupee grouping and exact bps percentages;
  no clocks/I/O/translations/sending. All display markup is neutralized, unsafe
  control/bidi characters reject, every rendered line <=60 Unicode characters.
- Input limits: <=30 quote items, <=10 notes, generated output <=500 lines;
  nested preflight before validation/hash, strict types/unknown-key rejection.
- Uses exact engine money fields; traces supply rates. Checks monetary/date
  consistency. A owns approval/auth, recomputation and stored-result binding:
  engine input hash is not a result signature. Human copies text; no system send.
- make test-packages auto-discovers package: 28 text + 149 existing tests pass
  (177 total), including 250 seeded real-engine amount round trips and hostile
  inputs. make check-leftovers passes. Manual mutation evidence follows separately.

## Price-list CSV: baseline

- Retried requested fetch/fast-forward successfully to origin/main 7b78665;
  lifecycle/mapper PR is merged. Started clean on lane/c. No push.
- Added only packages/pure/price_list_csv/**, docs/plans/price-list-csv.md and
  these notes. Existing make test-packages discovers the nested package.
- Required name and tax_bps columns added to the proposed CSV columns: the quote
  engine requires both, so no product name or tax rate is invented/defaulted.
- All-or-nothing parser uses exact integer INR paise, strict SKU syntax,
  case-insensitive SKU uniqueness, fixed row errors and early file limits.
- Engine 1.1.0 item fields/bounds are mirrored. Import files can hold 5,000 rows;
  lane A selects <=1,000 relevant catalog items for a quote request. No existing
  pure test cross-imports: 250 seeded cases assert the documented engine shape
  and break rules instead. Prices are strictly positive; breaks contiguous.
- Semantic hash ignores valid row/header ordering and equivalent money formats;
  error results have null hash. BOM counts toward UTF-8 byte size. Western comma
  grouping only. Lane A owns import endpoint, owner approval, DB re-checks/audit.
- Test count before this package: 123. Baseline adds 26 CSV tests (149 total).
  Mutation evidence follows separately; no services, ports or new dependencies.

### Price-list CSV manual mutation pass

Mutated the real library by hand, one change per run of make test-packages;
each row below observed exit 2 with the named test failing. No mutation scripts.
All 35 killed by baseline tests; no survivors or additional tests needed. All
mutations reverted; parser diff against cdba6aa is empty. One revert of mutation
27 initially matched its adjacent guard; restored both guards and reran mutation
28 in isolation before counting it. No combined result is used as evidence.
“Added test” means added because a mutation survived.

| Mutation | Killed by which test | Added test |
| --- | --- | --- |
| 01 Convert whole rupees with multiplier 10 instead of 100 | test_exact_money_formats_and_boundaries | no |
| 02 Left-pad decimal digits instead of right-padding | test_exact_money_formats_and_boundaries | no |
| 03 Allow three decimal places | test_invalid_money_syntax | no |
| 04 Zero-money guard <= becomes < | test_exact_money_formats_and_boundaries | no |
| 05 Money maximum > becomes >= | test_exact_money_formats_and_boundaries | no |
| 06 Strip commas before checking grouping | test_invalid_money_syntax | no |
| 07 Allow Unicode decimal digits | test_invalid_money_syntax | no |
| 08 Allow leading hyphen in SKU | test_sku_injection_and_character_rules | no |
| 09 Allow 41-character SKU | test_sku_injection_and_character_rules | no |
| 10 Disable case-insensitive duplicate SKU check | test_sku_case_insensitive_duplicates | no |
| 11 Name maximum becomes 200 instead of engine's 128 | test_name_bounds_and_no_tax_default | no |
| 12 Compare header names case-sensitively | test_headers_bom_case_and_column_permutation | no |
| 13 Disable unknown-column check | test_header_errors_no_echo | no |
| 14 Disable duplicate-column check | test_header_errors_no_echo | no |
| 15 Make required name column optional | test_header_errors_no_echo | no |
| 16 Disable paired-break-column check | test_header_errors_no_echo | no |
| 17 Preserve BOM in parsed header | test_headers_bom_case_and_column_permutation | no |
| 18 Relax CSV syntax strictness | test_csv_quotes_newlines_and_doubled_quotes | no |
| 19 Row width != becomes > (short rows accepted) | test_row_width_and_logical_numbering | no |
| 20 Integer lower bound < becomes <= | test_integer_syntax_and_bounds | no |
| 21 Integer upper bound > becomes >= | test_integer_syntax_and_bounds | no |
| 22 Default empty tax_bps to zero | test_name_bounds_and_no_tax_default | no |
| 23 Break minimum < MOQ becomes <= | test_price_break_edges_and_rules | no |
| 24 Break quantity <= previous becomes < | test_price_break_edges_and_rules | no |
| 25 Break price > previous becomes >= | test_price_break_edges_and_rules | no |
| 26 Allow gaps in populated break tiers | test_break_missing_pairs_gaps_and_invalid_values | no |
| 27 Incomplete pair guard OR becomes AND | test_break_missing_pairs_gaps_and_invalid_values | no |
| 28 Add one paise to each parsed break (isolated rerun) | test_price_break_edges_and_rules | no |
| 29 Sort items descending by SKU | test_synthetic_engine_shape | no |
| 30 Change parser/hash version to 1.0.1 | test_hash_determinism_sorting_and_roundtrip | no |
| 31 Omit items from hash | test_hash_includes_all_valid_item_fields | no |
| 32 Return partial items when any error exists | test_all_or_nothing_and_multiple_errors | no |
| 33 Check character count instead of UTF-8 byte count | test_utf8_byte_limit_and_bom_counts | no |
| 34 Decoded cell limit > becomes >= | test_cell_limit_exact_quoted_and_unquoted | no |
| 35 Logical record limit > becomes >= | test_rows_at_limit_and_one_above | no |

Final checks: 26 CSV + 123 existing tests = 149, including 250 seeded CSV cases;
make test-packages and make check-leftovers pass after all reversions. Endpoint,
real DB validation and approval integration remain with lane A. Synthetic only.
`./scripts/check-lane-paths.sh C` output:
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

### Requirement mapper manual mutation pass

Applied each mutation independently by hand to the real mapper, ran
`make test-packages`, observed exit 2 with the named test failing, then reverted
before the next mutation. All 36 killed by baseline tests; no survivors or extra
tests needed. No mutation script; the mapper diff against beddf35 is empty.
“Added test” indicates a test added because a mutant survived.

| Mutation | Killed by which test | Added test |
| --- | --- | --- |
| 01 Ignore duplicate per-line slots | test_duplicate_slots_precede_other_and_missing | no |
| 02 Ignore missing saree_type | test_missing_required_slots | no |
| 03 Ignore missing quantity | test_missing_required_slots | no |
| 04 Ignore missing quantity basis | test_missing_required_slots | no |
| 05 Ignore other in a code slot | test_other_in_each_code_requires_human | no |
| 06 Missing saree mapping returns category reason | test_saree_type_not_mapped | no |
| 07 Include inactive products | test_250_seeded_properties | no |
| 08 Invert category membership | test_250_seeded_properties | no |
| 09 Fabric reads colour mapping | test_normalization_and_config_alternates | no |
| 10 Colour reads fabric mapping | test_matched_and_proposal | no |
| 11 Permit products missing required attributes | test_missing_attributes_strictly_excluded | no |
| 12 Apply colour before fabric | test_colour_failure_after_fabric | no |
| 13 Alternatives use empty post-filter set | test_fabric_failure_and_previous_candidates | no |
| 14 Consider only first configured attribute value | test_normalization_and_config_alternates | no |
| 15 Replace casefold with lowercase | test_normalization_and_config_alternates | no |
| 16 Remove whitespace collapse | test_normalization_and_config_alternates | no |
| 17 Treat two candidates as a single match | test_candidate_cap_and_truncation_boundary | no |
| 18 Raise candidate cap to 21 | test_candidate_cap_and_truncation_boundary | no |
| 19 Truncated > becomes >= at cap | test_candidate_cap_and_truncation_boundary | no |
| 20 Return SKUs in descending order | test_candidate_cap_and_truncation_boundary | no |
| 21 Invert known-unit mismatch comparison | test_unit_mismatch_and_unknown_product_unit | no |
| 22 Treat unknown product unit as mismatch | test_unit_mismatch_and_unknown_product_unit | no |
| 23 Add one to proposal quantity | test_matched_and_proposal | no |
| 24 Invent 100 bps proposal discount | test_matched_and_proposal | no |
| 25 Propose first ambiguous candidate | test_optional_criteria_absent_or_null | no |
| 26 Omit duplicate_sku result flag | test_line_order_and_duplicate_sku_without_merge | no |
| 27 Discard later proposal for same SKU | test_line_order_and_duplicate_sku_without_merge | no |
| 28 Share mutable order rows with input | test_order_rows_untouched_and_not_matching_inputs | no |
| 29 Hash field rows in input order | test_hash_roundtrip_and_every_leaf | no |
| 30 Hash catalog in input order | test_hash_roundtrip_and_every_leaf | no |
| 31 Change mapper version to 1.0.1 | test_matched_and_proposal | no |
| 32 Omit config from hash input | test_hash_roundtrip_and_every_leaf | no |
| 33 Disable normalized duplicate catalog SKU check | test_duplicate_sku_and_normalized_attribute_checks | no |
| 34 Use isinstance, accepting bool-as-int | test_fixed_type_rejections | no |
| 35 Integer upper bound > becomes >= | test_line_and_quantity_bounds | no |
| 36 Set human_confirmation_required false | test_matched_and_proposal | no |

Final checks: 34 mapper + 33 cadence + 27 lifecycle + 29 quote = 123 tests,
all pass after reversions; 250 seeded mapper cases included. `make check-leftovers`
passes. Lane A integration, authoritative input retrieval, approvals and audit
remain pending. No database, network, ports, dependency changes or pushes.
`./scripts/check-lane-paths.sh C` output:
`Lane C: changed paths allowed under base policy` (exit 0).
## Quote text: manual mutation evidence

Final clean verification: 31 quote-text tests + 149 existing tests = 180 passing
tests (baseline 149); includes 250 seeded real-engine amount round trips.
`make test-packages` and `make check-leftovers` pass. Lane guard (exit 0):
`Lane C: changed paths allowed under base policy`.
Lane A approval integration and customer copy flow are not exercised here.

Each mutation below was applied individually by hand, checked with `make
test-packages`, and reverted. Four initially survived: malformed matching hashes,
quantity multiplication, footer validity, and a one-paise discount. Three new
test methods and one strengthened assertion killed them on rerun. All 36 final
mutation runs failed a test; no mutation scripts or mutated implementation remain.

| Mutation | Killed by which test | Added test |
|---|---|---|
| 01 Paise divisor 100 -> 10 | test_money_boundaries | no |
| 02 Indian grouping uses groups of three | test_money_boundaries | no |
| 03 Omit paise zero padding | test_money_boundaries | no |
| 04 Basis-point divisor 100 -> 1000 | test_rate_boundaries | no |
| 05 Omit rate fraction padding | test_rate_boundaries | no |
| 06 Keep supplied WhatsApp markup | test_whatsapp_markup_neutralization_all_display_locations | no |
| 07 Permit bidi format characters | test_hostile_controls_bidi_and_line_separators | no |
| 08 Permit controls and newlines | test_hostile_controls_bidi_and_line_separators | no |
| 09 Width 60 -> 61 | test_long_words_wrap_and_money_tokens_remain_whole | no |
| 10 Disable long-word wrapping | test_long_words_wrap_and_money_tokens_remain_whole | no |
| 11 Disable approval guard | test_approval_and_engine_status_refused | no |
| 12 Disable approval hash equality | test_hash_mismatch_fixed_error | no |
| 13 Disable hash format validation | test_matching_malformed_hashes_refused | yes |
| 14 Accept engine status approved | test_approval_and_engine_status_refused | no |
| 15 Disable line-sum totals check | test_bad_money_and_totals_invariants | no |
| 16 Disable quantity times price check | test_quantity_times_price_invariant | yes |
| 17 Print net instead of line gross | test_sections_and_exact_engine_amounts | no |
| 18 Print net instead of shipping gross | test_sections_and_exact_engine_amounts | no |
| 19 Print balance instead of advance | test_payment_amounts_optional_and_zero | no |
| 20 Footer validity uses issued date | test_sections_and_exact_engine_amounts | yes (assertion) |
| 21 Print subtotal instead of unit price | test_sections_and_exact_engine_amounts | no |
| 22 Omit exactly one-paise discount | test_one_paise_discount_is_shown | yes |
| 23 Use merchandise GST rate for shipping | test_sections_and_exact_engine_amounts | no |
| 24 Aggregate GST omits shipping tax | test_sections_and_exact_engine_amounts | no |
| 25 Use tax rate for discount | test_sections_and_exact_engine_amounts | no |
| 26 Omit notes | test_sections_and_exact_engine_amounts | no |
| 27 Payment terms use seller name | test_sections_and_exact_engine_amounts | no |
| 28 Use engine name instead of display label | test_sections_and_exact_engine_amounts | no |
| 29 Omit display from hash input | test_determinism_hash_roundtrip_and_immutability | no |
| 30 Renderer version 1.0.0 -> 1.0.1 | test_determinism_hash_roundtrip_and_immutability | no |
| 31 Allow eleven notes | test_note_count_limit | no |
| 32 Allow thirty-one quote lines | test_quote_lines_limit_and_large_money | no |
| 33 Accept bool as integer | test_strict_format_types | no |
| 34 Disable validity date equality | test_dates_and_required_labels | no |
| 35 Disable engine version allowlist | test_trace_and_flag_validation | no |
| 36 Allow empty quote lines | test_quote_lines_limit_and_large_money | no |

## quote_text 1.1.0 — U+200C / U+200D in product names (branch quote-text-joiners)

- Checklist row: "The pinned quote-text renderer ... still refuses U+200C and U+200D in a product name"
  (`docs/pre-pilot-checklist.md`). The pure package side is done; the row stays open until lane A adopts 1.1.0
  (adapter allow-list, pins, an end-to-end test) — list below. Lane A consolidates this note into the checklist.
- New renderer version **1.1.0** (minor: behaviour change). `RENDERER_VERSION`, `SUPPORTED_VERSIONS` and
  `renderer_for(version)` are in `packages/pure/quote_text/__init__.py`; 1.0.0 is frozen as `quote_text/v1_0_0.py`,
  byte-identical to the old `__init__.py` (sha256 `a6717e52...9387`, pinned in a test). Package doc: `VERSIONS.md`.
- Rule (the application's, re-implemented, not imported): U+200C / U+200D are allowed only DIRECTLY after a letter or
  mark (`L*`, `M*`) in U+0900..U+0DFF. Refused: at the start, after a space, between Latin letters, in or next to
  digits, after an Indic digit or danda, twice in a row. Every other Cc/Cf/Cs/Zl/Zp character stays refused, even
  right after an Indic letter (ZWSP, word joiner, BOM, soft hyphen, LRM/RLM, ALM, bidi, tags, newline, tab, NUL).
  The rule applies to EVERY validated string (names, labels, seller, customer, notes, payment text, keys), because
  the application's text rule is not per field and the customer name comes from the same text.
- Evidence (`python3 scripts/test-packages.py packages/pure/quote_text/tests packages/pure`, exit 0): **86 tests**
  = the original 31 now run against 1.1.0 AND again against the frozen 1.0.0 (+1 version check), 2 frozen-source
  tests, 21 new tests (`test_joiners.py`): copied application cases, every code point alone / in a word /
  before a joiner / after a joiner, 60,000 seeded random strings with the OLD renderer as oracle ("new accepts a
  string exactly when old accepts it without its joiners and every joiner follows an Indic letter or mark"), and
  `fixtures/golden_1_1_0.json` (9 accepted vectors, 33 refused strings, each refused in all 7 string locations,
  for both versions). The whole `make test-packages` set (all packages) also passes, offline.
- Old vectors unchanged: `fixtures/synthetic.json` and `tests/test_text_bounds.py` are byte-identical to `main`
  (sha256 `6e051024...1f89`, `b7e31dbf...a87f`); `test_quote_text.py` changed only by `GOLDEN_HASH`, a dict whose
  1.0.0 entry is the old literal `376e2b72...b17f`; `v1_0_0.py` equals the old `__init__.py`.
- Hashes: fixture request, 1.0.0 `376e2b72ffc0a880941cb254f891811cdeb99ad3d195b2312d39cd0cf7c3b17f`, 1.1.0
  `6cab990d149f3ef9ef56a4087d1382241b1705921caa18573a32f3030ceb58aa` (same text, only the version in the hash differs).
- Decision to confirm (smallest safe choice): the task said private-use and unassigned characters "stay refused",
  but 1.0.0 never refused Co or Cn (only Cc, Cf, Cs, Zl, Zp), and the same task said 1.1.0 accepts exactly the old
  set plus the joiners. I kept the old behaviour and pinned it (`test_private_use_and_unassigned_are_unchanged_from_1_0_0`).
  The application's CSV rule refuses Co/Cn; the database text rule does not. Tightening is a separate 1.3.0.
- Known limit: `textwrap` can cut a very long unbroken word anywhere, so a joiner may start a line (none lost or
  added). Joiners count toward the 60 / 200 character limits. Both pre-existing in kind; documented in `VERSIONS.md`.
- Cross-lane note: the price-list/lead CSV rule (`app/text_rules.py`) accepts a joiner ANYWHERE; the renderer (like
  `capture_text`) accepts it only after an Indic letter or mark. A product name imported with a joiner in another
  position (e.g. between Latin letters) passes import and is still refused by the renderer. Lane A's call.

### Manual deliberate-mutation evidence (new rule, 31 mutants of `__init__.py`)

Each: temporary edit, the package tests, `git checkout` of the file. 29 killed; 2 survive and both are equivalent mutants.

| Mutation | Result |
| --- | --- |
| Indic range low 0x0900 to 0x0901 / 0x08FF | killed (boundary + before-joiner exhaustive) |
| Range high to 0x0DF2 / 0x0E01 (first Thai letter) | killed |
| Range high to 0x0DFE, and to 0x0E00 | **equivalent**: U+0DFF and U+0E00 are unassigned (Cn), never L/M; unkillable |
| Category `LM` to `L`, `L` or False, `LMN`, `LMP`, Mn/Mc/Lo only | killed (marks, digits, punctuation cases) |
| Only ZWJ / only ZWNJ is a joiner | killed |
| Joiner allowed anywhere; at start; inverted; branch falls through | killed |
| Previous char not advanced past a joiner (double joiner passes); never advanced | killed |
| Drop Cf / Cc / Cs / Zl / Zp from the refused set | killed |
| Add Co / add Cn (tighten) | killed (the pin test) |
| Every Cf allowed after an Indic letter | killed |
| `_string` skips the check | killed |
| Version stays 1.0.0; `SUPPORTED_VERSIONS` drops 1.0.0; `renderer_for("1.0.0")` returns current | killed |

First run of the pass had one harness bug (a `None` replacement truncated `__init__.py`); restored from git and
verified equal to HEAD before the rerun. Nothing survives except the two equivalents. No mutation script is committed.

### What lane A must change to adopt 1.1.0 (not done here)

1. `services/ai-api/app/quotes/text_port.py`: `ALLOWED_RENDERER_VERSIONS` `{"1.0.0"}` to `{"1.2.0"}` (fail closed; the app
   never re-renders from a stored 1.0.0 text, so 1.0.0 need not stay allowed; `quote_text.renderer_for("1.0.0")` exists if that changes).
   Merging the package without the API pin change breaks the API (text_port.py refuses renderer 1.2.0) and its tests, so the package change and the API change must be in the same PR.
2. `services/ai-api/tests/test_quotes_text_port.py`: the `frozenset({"1.0.0"})` assertion (line ~75), `renderer_version == "1.0.0"`
   (~85), `GOLDEN_RENDER_HASH` (the hash changes because the version is hashed; `GOLDEN_TEXT_SHA` must NOT change), and a new joiner
   case (a Telugu / Malayalam-chillu product name renders; a joiner between Latin letters still gives `quote_text_refused`).
3. A differential test in the app (it may import both): `app.requirements.capture_text.strip_invisible` keeps a joiner exactly where
   `quote_text._unsafe` accepts it, so the two copies of the rule cannot drift.
4. An integration test through the real API (lane A's stack): product with a joiner name, quote approved, customer text renders,
   `renderer_version == "1.1.0"`. Check `tests/integration/test_quote_api.py` (only asserts `renderer_version` is truthy).
5. Mocks/fixtures that print the version: `apps/web/lib/api/quotes-fixtures.ts` (`renderer_version: "1.0.0"`), cosmetic.
6. `tests/rehearsal/report.py` line ~383 states the renderer still refuses joiners: update the wording after adoption.
7. Docs: `docs/plans/quote-text.md` ("Hash = sha256 of {renderer_version: "1.0.0", ...}" and the "reject control/format ..." paragraph),
   `docs/checklist-notes/A.md` row about `packages/pure/quote_text/__init__.py (_string)`, and the `docs/pre-pilot-checklist.md` row 254.
8. No migration, pgTAP or RLS change: no database column stores the renderer version or the rendered text (the text is rendered on
   demand from the stored approved row). Decide the CSV-rule alignment (cross-lane note above) and the Co/Cn gap.
