# Pure price-list CSV parser (lane C)

## API and columns
`from price_list_csv import parse, canonical_json, PARSER_VERSION` with
packages/pure on the import path. `parse(text: str) -> dict` is stdlib-only,
deterministic and has no file/network/model I/O. StringIO is only an in-memory
adapter for csv.reader. No process-global CSV settings are changed. Version 1.0.0.
Wrong Python types raise TypeError("Expected str"); malformed text returns errors.
Text must be UTF-8 encodable. One leading BOM is ignored for parsing.
Comma-separated CSV supports LF/CRLF, quoted commas/newlines and doubled quotes.

Required columns: sku, **name**, unit_price, moq, **tax_bps**. Name/tax_bps are
added because quote_engine requires them; neither name nor tax is invented.
Optional paired columns: min_qty_1/price_1 through min_qty_5/price_5.
Header names trim surrounding whitespace and compare case-insensitively; unknown,
duplicate, missing required, or unpaired break columns reject. No cost column:
policies requiring a margin floor need cost from lane A's authoritative catalog.

Items exactly match quote_engine 1.1.0:
`{sku, name, unit_price, minimum_order_quantity, price_breaks, tax_bps}`;
each break is `{min_qty, unit_price}`. All money is integer INR paise, tax is
integer bps. Name trims surrounding whitespace, is nonblank and <=128 characters;
embedded quotes/newlines are preserved. SKU is not trimmed: only ASCII letters,
digits, dot, underscore, hyphen, <=40 chars; a leading = + - @ rejects. SKUs are
unique case-insensitively, echoed exactly and sorted by raw SKU ascending.

## Money and quantity rules
Money accepts plain digits or western thousands groups, optional 1..2 decimal
digits and a leading ₹, Rs, Rs. or INR (case-insensitive). Surrounding whitespace
is ignored. Examples: 1200, "1,200.50", ₹1200.5. Integer parsing uses digits and
decimal padding only: 0.01 is exactly 1 paise, with no floating point/rounding.
Negative/zero, signs, exponent notation, missing integer parts, 3+ decimals,
Unicode/fullwidth digits and malformed groups reject. Indian grouping (1,20,000)
is deliberately unsupported; owner can request a later version if needed.
Quantity/tax cells accept ASCII digits only (surrounding whitespace ignored),
not fractions, signs, exponents or grouping. MOQ/break quantity is 1..10,000;
tax_bps is explicitly supplied in 0..10,000. Prices are positive (CSV is stricter
than the quote engine, which also permits zero), <=100,000,000 paise.
Break quantities strictly increase, are >=MOQ, and prices never increase from
the base or previous tier. Equality at MOQ or on prices is valid. Populated tiers
must be contiguous from 1; each tier has both cells. Trailing empty pairs omit
tiers. The numbered columns define tier order; invalid order is never repaired.

## Output, errors and bounds
Result: `{ok, items, errors: [{row, column, code}], row_count, canonical_hash}`.
Any error means ok false and items empty (no partial import); errors never echo
cell/header data. Logical data rows count from 1 even with embedded newlines.
Header/file errors use row 0. column is a known schema name or null. A header-only
file is a valid empty list; empty/missing header is not. Row width errors reject.
Invalid headers return row_count 0; syntax errors retain completed logical rows.
Any limit breach supersedes all errors with one `{row:0,column:null,code:FILE_LIMIT}`
and row_count 0. Preflight counts decoded quoted cells before CSV allocation.

| Bound | Inclusive maximum |
| --- | --- |
| MAX_ROWS / MAX_BYTES | 5,000 data rows / 2,097,152 UTF-8 bytes, including BOM |
| MAX_COLUMNS / MAX_CELL_LENGTH | 40 columns / 200 decoded Unicode characters |
| MAX_SKU_LENGTH / MAX_IDENTIFIER_LENGTH | 40 SKU chars / 128 name chars |
| MAX_UNIT_PRICE | 100,000,000 paise = INR 1,000,000 |
| MAX_QUANTITY_PER_LINE / MAX_TAX_BPS | 10,000 / 10,000 |
| MAX_BREAKS | 5 (below quote engine's 20-tier maximum) |
Bounds mirror quote-engine 1.1.0, without a runtime cross-package dependency.
Files may hold 5,000 engine-shaped items; quote requests currently accept at most
1,000 catalog items. Lane A selects the relevant bounded snapshot for each quote.
Error codes: FILE_LIMIT, INVALID_UTF8, HEADER_REQUIRED, DUPLICATE_COLUMN,
UNKNOWN_COLUMN, MISSING_COLUMN, UNPAIRED_BREAK_COLUMN, CSV_FORMAT, ROW_WIDTH,
INVALID_SKU, DUPLICATE_SKU, INVALID_NAME, INVALID_MONEY, MONEY_OUT_OF_RANGE,
INVALID_INTEGER, INTEGER_OUT_OF_RANGE, INCOMPLETE_BREAK, BREAK_GAP,
INVALID_PRICE_BREAKS. Tests cover each code and boundaries.

Hash: sha256 of canonical JSON `{parser_version: PARSER_VERSION, items: sorted_items}`,
sorted keys, compact separators, ASCII escaping. Valid row/header permutations,
BOM/newline differences and equivalent money representations give the same hash.
Each valid item leaf and version participates. Rejected files have null hash.
The hash identifies validated semantic content, not original CSV byte provenance.

## Lane A handoff
Pure parsing only. A must build the later tenant-scoped import endpoint, preserve
source provenance, request owner approval, resolve duplicates against the existing
catalog and persist transactionally. The DB re-checks every imported field and
constraint; this parser does not authorize writes or bypass DB validation.
A owns pricing/catalog lookup, security, approval, persistence and durable audit.
Tests are synthetic, including 250 seeded cases checked against documented quote
item fields and rules (existing pure tests have no cross-package imports).
