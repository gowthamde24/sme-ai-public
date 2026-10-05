# T009 pure quote engine (lane C)
## API
Stdlib only. Add `packages/quote-engine/src` to the caller's import path;
`from quote_engine import quote, canonical_json, ENGINE_VERSION`.
`quote(request: dict) -> dict`: JSON-shaped inputs return a draft Quote or a
Rejection (`status: rejected`, `codes`); `canonical_json(result)` is deterministic.
Use `canonical_json(result).encode("utf-8")` for byte-identical bytes; no clock/I/O.
Currency is INR; all money is nonnegative integer paise, rates integer bps.
- `as_of`: canonical ISO date, e.g. `2026-01-30`.
- `price_list`: `[{sku, name, unit_price, minimum_order_quantity, price_breaks: [{min_qty, unit_price}], tax_bps, cost?}]`.
- `customer`: `{kind: "new" | "repeat", credit_limit?}`.
- `order_lines`: nonempty list of `{sku, qty, discount_bps?}`.
- `policy`: `{discount_ceiling_bps, shipping: {flat_fee, free_above?, tax_bps?},
  validity_days, payment_terms: {new_advance_bps, repeat_advance_bps, net_days},
  tax_mode: "exclusive" | "inclusive", rounding_mode?, margin_floor_bps?}`.
Example: `packages/quote-engine/tests/fixtures/synthetic.json`; input is unchanged.
Quote fields:
- `lines`: SKU/name, quantity, unit_price_applied, price_break_applied (or null),
  line_subtotal (before discount, in catalog tax mode), discount, net, tax, gross.
- `totals`: subtotal, discount, merchandise net, aggregate tax, item_tax,
  shipping_tax, shipping (net fee), shipping_gross, total.
- `payment_terms`: advance_amount, balance, due_date; plus `valid_until`.
- `flags`: needs_owner_approval and reasons with machine-readable `code`.
- `trace`: ordered `{rule_id, inputs, text}` entries naming rule operands/results.
- `engine_version`, `canonical_hash`: sha256 of canonical JSON containing
  `{"engine_version": ENGINE_VERSION, "inputs": request}` (including unused
  descriptive fields). Canonical JSON sorts keys, uses compact separators and
  ASCII escaping. Version 1.1.0 changes every bounded request hash; the fixture
  shape is unchanged. Explicit shipping tax_bps (even zero) also changes the hash.
Rejections retain version, codes, flags and trace; no partial totals. Oversized
inputs rejected by preflight have canonical_hash null: they are never serialized.

## Rules and assumptions
- Quantity must be positive; MOQ violations flag rather than reject.
- SKU identifiers are case-sensitive. Duplicate catalog/order SKUs reject:
  callers must aggregate quantities before requesting a quote.
- Price breaks must be strictly increasing in quantity and nonincreasing in
  price; highest qualifying break applies to every unit in that line. Breaks below
  MOQ reject (INVALID_PRICE_BREAKS): avoid a discount tier for an invalid quantity.
- Missing line discount means zero. Discounts are bounded 0..10000 bps and
  rounded once per line; exceeding the ceiling flags without changing the rate.
- Rounding is integer division, default half_up; half_even and down also work.
- tax_mode applies to the whole order, including shipping.
- Exclusive: net = subtotal - discount; tax = round(net * tax_bps / 10000).
- Inclusive: gross = subtotal - discount; net = round(gross * 10000 / (10000 + tax_bps)); tax = gross - net.
  Residual paise go to tax, preserving gross.
- Margin is measured against discounted net revenue excluding tax/shipping:
  flag if `(net - qty * cost) * 10000 < net * margin_floor_bps`.
  A configured floor requires cost for every catalog item; missing cost rejects.
- Shipping uses discounted net merchandise; free only strictly above free_above.
  shipping.tax_bps defaults to zero and uses the line rounding mode. Exclusive:
  flat_fee is net, tax = round(fee * tax_bps / 10000). Inclusive: flat_fee already
  includes tax; net = round(fee * 10000 / (10000 + tax_bps)), tax = fee - net.
  Free shipping has zero tax. The shipping.tax trace records fee/net/tax/gross.
  Shipping uses one GST rate per policy; for mixed-rate orders the owner/accountant must decide how freight is taxed.
- tax = item_tax + shipping_tax; total = merchandise net + shipping net + tax.
  Subtotal/discount are catalog-mode values; inclusive subtotal already has tax.
- Configured customer-kind advance applies to the complete total. Balance is
  total minus rounded advance; balance due = as_of + net_days for either kind.
- Repeat customer's balance is compared to credit_limit; absent limit means
  zero available credit. Exceeding it flags and preserves the proposed terms.
  No outstanding account balance is known; caller supplies available credit.
- Valid until = as_of + validity_days (calendar days); no timezone/holiday logic.
- Flags: DISCOUNT_ABOVE_CEILING, BELOW_MINIMUM_ORDER_QUANTITY,
  MARGIN_BELOW_FLOOR, CREDIT_LIMIT_EXCEEDED, UNKNOWN_SKU.
- Unknown SKU rejects the entire order and flags review. Other invalid business
  values return codes: INVALID_FIELDS, OUT_OF_RANGE, INVALID_CHOICE, INVALID_DATE,
  DATE_OVERFLOW, EMPTY_ORDER, EMPTY_IDENTIFIER, DUPLICATE_SKU,
  DUPLICATE_ORDER_SKU, INVALID_PRICE_BREAKS, MISSING_COST.
- Wrong Python types raise TypeError (including booleans in integer fields,
  non-JSON objects and floating point values). Unknown/missing fields reject.
- needs_owner_approval means an exception was detected, never permission to
  transact; even an unflagged quote is a draft requiring external approval.

## Operational bounds (inclusive maxima, not business prices/rates)
| Module constant | Maximum |
| --- | --- |
| MAX_QUANTITY_PER_LINE (also MOQ/break min_qty) | 10,000 |
| MAX_UNIT_PRICE (also cost/break price) | 100,000,000 paise (INR 1,000,000) |
| MAX_TAX_BPS (item/shipping) / MAX_DISCOUNT_BPS (also margin/advance) | 10,000 each |
| MAX_SHIPPING_AMOUNT (flat_fee/free_above) | 100,000,000 paise (INR 1,000,000) |
| MAX_ORDER_LINES / MAX_CATALOG_ITEMS / MAX_PRICE_BREAKS_PER_ITEM | 100 / 1,000 / 20 |
| MAX_PAYMENT_NET_DAYS / MAX_VALIDITY_DAYS | 180 / 365 |
| MAX_IDENTIFIER_LENGTH (SKU/name/strings/keys, Unicode characters) | 128 |
| MAX_CREDIT_LIMIT | 1,000,000,000 paise (INR 10,000,000) |
Sizes are checked before item work/hashing; oversized scalars/collections reject OUT_OF_RANGE.
Malformed JSON limits: depth 8, 100,000 nodes, 16 object fields (MAX_INPUT_DEPTH/NODES, MAX_OBJECT_FIELDS).
All per-field maxima must fit the generic integer cap MAX_CREDIT_LIMIT (tested).

## Owner decisions and lane A handoff
Owner must confirm GST on shipping, advance rates, rounding mode, MOQ exception
policy, due-date anchor/credit, shipping threshold, margin, GST mode and validity.
Pure calculation only: approval, authoritative catalog lookup, persistence,
provenance and durable audit belong to lane A. Trace is calculation evidence;
The hash authenticates neither catalog nor actor. Lane A owns integration/security;
owner requires green CI.

## Changelog
- 1.1.0: bounds, below-MOQ break rejection and shipping-tax totals change valid behavior/schema; unit-price max INR 1,000,000.
  pinned fixture hash changes solely because ENGINE_VERSION is now 1.1.0.
