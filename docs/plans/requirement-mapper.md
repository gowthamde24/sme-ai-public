# Pure requirement mapper (lane C)

## API
Stdlib `packages/pure/requirement_mapper`, no I/O, model, clock, randomness,
prices or dependencies. Import `map_requirements(request) -> dict` from
`requirement_mapper` with packages/pure on the import path. MAPPER_VERSION=1.0.0.
The request has exactly fields, catalog and config; plain JSON dictionaries/lists.
Rows have exactly line_no, field_key, value_code, value_int, value_date,
value_text, basis. Product fields: sku, category, attributes, active, sale_unit.
Config fields: saree_type_to_categories, fabric_to_values, colour_to_values;
each maps opaque codes to lists of tenant-supplied comparison strings.

Result: mapper_version, order (copied original rows), lines, order_lines_proposal,
flags, human_confirmation_required (always true), canonical_hash. Each line:
line_no, status, reason (or null), candidates OR alternatives, truncated,
quantity and unit. Only matched lines propose `{sku, qty, discount_bps: 0}`.
No code path prices, selects from several candidates, approves or writes anything.
Rejected requests: status rejected, codes, fixed message, version, null hash,
human_confirmation_required true. Wrong types also reject INVALID_TYPE, including
bool-as-int and floats. Other codes: OUT_OF_RANGE, INVALID_FIELDS, INVALID_CODE,
INVALID_FIELD_KEY, INVALID_VALUE_SLOT, INVALID_UNIT, INVALID_DATE, EMPTY_STRING,
DUPLICATE_SKU, DUPLICATE_ATTRIBUTE. Messages contain no caller data.

## Matching and assumptions
- Process only observed line numbers, ascending; never invent or merge lines.
  Duplicate per-line slots yield needs_input/duplicate_slot, ahead of all rules.
  Missing/null saree_type or quantity yields missing_saree_type/missing_quantity;
  a quantity without its basis yields missing_unit. No default unit is assumed.
- Then other in any code yields needs_human/other_value, even if mapped by config.
  Optional fabric/colour absent or null imposes no criterion.
- Missing saree type mapping yields unmatched/saree_type_not_mapped. Otherwise
  filter active/category, fabric, colour in that order. Missing configured fabric
  or colour mapping is an empty allowed set and fails that criterion.
- Category, attribute keys and values compare with casefold and collapsed Unicode
  whitespace. All configured values are considered. Missing requested attributes
  strictly exclude a product; this deliberately avoids guessing from sparse data.
- First empty set yields unmatched/category|fabric|colour. Fabric/colour failures
  show the candidates immediately before that filter as alternatives. Category
  failures have empty alternatives (owner-confirmed); unrelated products are not
  suggested. Alternatives never create quote proposals.
- One candidate: matched unless its known sale_unit differs from the requirement
  basis, then needs_human/unit_mismatch. Unknown product unit is allowed and must
  be confirmed by a human. Multiple candidates stay ambiguous, including mixed
  sale units: no candidate is chosen or converted; humans resolve units/products.
- Candidates/alternatives are raw SKUs, sorted ascending, capped at 20; truncated
  means the pre-cap count exceeded 20. Two matched lines for the same SKU remain
  separate proposals and add one duplicate_sku flag to the result.
- Identifiers and comparison strings must be nonblank. Catalog SKUs must be unique
  after normalization, including inactive entries; normalized duplicate attribute
  keys reject. SKUs are echoed exactly, with no name or attribute/free-text echo.
- Order budget/deadline/delivery_city/payment_terms rows never affect matching,
  including duplicate order slots. Their typed slots are int/date/text/text;
  other value slots must be null. Order basis is nullable bounded text. They are
  deep-copied untouched (the explicit exception to the no-free-text output rule),
  sorted canonically; values are neither interpreted nor used as price filters.
- Code rows use only value_code and no basis; quantity uses only value_int and
  piece/set/null basis. Nullable slots represent incomplete confirmed input.

## Bounds (inclusive)
| Constant | Bound |
| --- | --- |
| MAX_LINES / MAX_QUANTITY | line numbers 1..5 / quantities 1..10,000 |
| MAX_FIELDS / MAX_PRODUCTS / MAX_ATTRIBUTES | 100 rows / 5,000 products / 20 attributes each |
| MAX_STRING_LENGTH | 200 Unicode characters for strings and keys |
| Code format | `[a-z][a-z0-9_]{0,40}` (1..41 ASCII characters) |
| MAX_CONFIG_CODES / MAX_CONFIG_VALUES | 500 codes per map / 100 comparison values per code |
| MAX_INTEGER | 1,000,000,000; order budget 0..cap, passed through |
| MAX_DEPTH / MAX_NODES / MAX_OBJECT_FIELDS | 8 / 400,000 / 500 |
| MAX_CANDIDATES | 20 returned SKUs per line |
Dates are exact ISO YYYY-MM-DD, years 0001..9999. Preflight checks fields/catalog
sizes first, config/attribute collection sizes before item validation/hash, then
iteratively bounds shape/strings/integers. Oversize input never reaches matching.

## Determinism and lane A handoff
Canonical JSON is sorted-key compact ASCII JSON without floating point. Hash is
sha256 of `{mapper_version, inputs}`. For hashing, fields sort by canonical row
JSON, catalog by SKU, mapping value lists lexically; raw leaves are retained.
Output/hash ignore catalog/field permutation. Adding an irrelevant product leaves
decisions unchanged but changes the hash: it identifies the entire input snapshot.
Input and result do not share mutable objects. Tests use invented Dharmavaram-
pattu-style fixtures only, 250 seeded cases and the real library import.

Lane A must supply confirmed requirement_v1 rows, tenant-owned config, and an
authoritative active catalog snapshot. A owns tenant isolation, retrieval,
provenance, persistence, audit, approval and integration with the quote engine.
A must confirm every proposal with a human, resolve ambiguity, duplicate lines,
other values, missing attributes and sale-unit uncertainty, and look up prices
authoritatively only after confirmation. Hashes are identifiers, not authentication.
