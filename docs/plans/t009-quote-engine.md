# T009 pure quote engine (lane C)

## API
Stdlib only. Add `packages/quote-engine/src` to the caller's import path;
`from quote_engine import quote, canonical_json, ENGINE_VERSION`.
`quote(request: dict) -> dict` accepts JSON-shaped values and returns a structured
Quote (`status: draft`) or Rejection (`status: rejected`, `codes`). No approval
state is produced. `canonical_json(result)` gives deterministic JSON text.
Use `canonical_json(result).encode("utf-8")` for byte-identical serialization.
No clock, randomness, external I/O, implicit catalog, prices or tax rates.

Request fields (all money is nonnegative integer paise, all rates integer bps):
- `as_of`: canonical ISO date, e.g. `2026-01-30`.
- `price_list`: list of `{sku, name, unit_price, minimum_order_quantity,
  price_breaks: [{min_qty, unit_price}], tax_bps, cost?}`.
- `customer`: `{kind: "new" | "repeat", credit_limit?}`.
- `order_lines`: nonempty list of `{sku, qty, discount_bps?}`.
- `policy`: `{discount_ceiling_bps, shipping: {flat_fee, free_above?},
  validity_days, payment_terms: {new_advance_bps, repeat_advance_bps, net_days},
  tax_mode: "exclusive" | "inclusive", rounding_mode?, margin_floor_bps?}`.
See `packages/quote-engine/tests/fixtures/synthetic.json` for a complete request.
No input is mutated. Dict key order has no effect; list order is meaningful.

Quote fields:
- `lines`: SKU/name, quantity, unit_price_applied, price_break_applied (or null),
  line_subtotal (before discount, in catalog tax mode), discount, net, tax, gross.
- `totals`: subtotal, discount, net, tax, shipping, total.
- `payment_terms`: advance_amount, balance, due_date; plus `valid_until`.
- `flags`: needs_owner_approval and reasons with machine-readable `code`.
- `trace`: ordered `{rule_id, inputs, text}` entries naming rule operands/results.
- `engine_version`, `canonical_hash`: sha256 of canonical JSON containing
  `{"engine_version": ENGINE_VERSION, "inputs": request}` (including unused
  descriptive fields). Canonical JSON sorts keys, uses compact separators and
  ASCII escaping. Engine semantics changes require a version change.
Rejections retain hash/version, codes, flags and trace; no partial totals.

## Rules and smallest safe assumptions
- Quantity must be positive; MOQ violations flag rather than reject.
- SKU identifiers are case-sensitive. Duplicate catalog/order SKUs reject:
  callers must aggregate quantities before requesting a quote.
- Price breaks must be strictly increasing in quantity and nonincreasing in
  price; highest qualifying break applies to every unit in that line.
- Missing line discount means zero. Discounts are bounded 0..10000 bps and
  rounded once per line; exceeding the ceiling flags without changing the rate.
- Rounding is integer division, default half_up; half_even and down also work.
- Exclusive: net = subtotal - discount; tax = round(net * tax_bps / 10000).
- Inclusive: gross = subtotal - discount;
  net = round(gross * 10000 / (10000 + tax_bps)); tax = gross - net.
  This allocates the residual paise to tax and preserves the supplied gross.
- Margin is measured against discounted net revenue excluding tax/shipping:
  flag if `(net - qty * cost) * 10000 < net * margin_floor_bps`.
  A configured floor requires cost for every catalog item; missing cost rejects.
- Shipping uses discounted net merchandise; free only strictly above free_above.
  Shipping is an untaxed final fee; no implicit GST rate is applied to it.
- Total = sum(line.net + line.tax) + shipping. Subtotal/discount are catalog-mode
  values; inclusive totals already contain tax, so do not add tax to subtotal.
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

## Owner decisions and lane A handoff
Owner must confirm advance rates, due-date anchor, repeat credit calculation,
MOQ exception policy, discount authority, margin formula, shipping tax/threshold,
GST inclusive/exclusive handling, line/invoice rounding and quote validity.
This is arithmetic, not GST filing or jurisdiction-specific tax determination.
Lane A must build authoritative tenant catalog/policy lookup, input aggregation,
approval/RBAC, persistence, provenance/source binding, immutable audit records,
approved quote versioning and downstream order/payment integration.
The hash recognizes a request; it authenticates neither its catalog nor actor.
Normal pure-library tests cover boundaries, flags, rejection, payment dates,
serialization, pinned hash and seeded properties; no database/network checks.
Owner runs full CI before merging; integration and security checks belong to A.
