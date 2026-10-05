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
- Risks/decisions: shipping is untaxed and strictly above a net threshold; credit
  means available balance credit, absent limit zero; duplicate order SKUs reject;
  inclusive rounding allocates residual paise to tax. Owner must confirm these.
- Lane A still owns approval, authoritative lookup, persistence, provenance,
  audit and integration/security verification. Unflagged results remain drafts.
- Proposed status: pure library complete; broader T009 remains pending lane A.
