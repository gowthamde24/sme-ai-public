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
