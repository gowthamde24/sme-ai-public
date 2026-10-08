# Pure quote text (lane C)

## API and approval handoff
Stdlib `packages/pure/quote_text`; `render(request) -> dict`, no I/O, clock,
model, translation, sending, HTML or PDF. Successful output has exactly text,
line_count (including blank separators), canonical_hash. Text is UTF-8 with LF
and no final newline; every line is <=60 Unicode characters.
Request: `{quote, approved: bool, expected_engine_hash: str, display}`.
Quote is the exact quote_engine 1.1.0 result (status draft). The engine never
approves; lane A supplies approved=true from its authoritative approval record,
and expected_engine_hash from that same record. Non-approved/rejected results
are refused. Do not overwrite the engine's draft status with approved.
Display has exactly seller_name, customer_name, quote_ref, issued_on, valid_until,
line_labels (sku -> label for exactly every line), payment_terms_text, notes.
Notes are fixed strings chosen by A; the renderer has no tenant note vocabulary.

Owner-confirmed handoff: separate approval wrapper; 200-character limit applies to all
ordinary/display strings, with a separate bound for generated trace.text, which
often exceeds 200 in valid engine outputs. No trace/reasons are rendered.
Rejections: `{status: rejected, code, message}` with no partial text/hash.
NOT_APPROVED: "Quote is not approved." HASH_MISMATCH:
"Quote hash does not match approval." All other codes have the fixed message
"Invalid quote text request." Codes: INVALID_TYPE, INVALID_FIELDS, OUT_OF_RANGE,
EMPTY_STRING, UNSAFE_STRING, INVALID_DATE, DATE_MISMATCH, INVALID_QUOTE,
UNSUPPORTED_ENGINE. Floats/bool-as-int, unknown keys, unsafe strings reject.

## Engine fields and rendering
Lines use exact engine keys: sku/name, quantity, unit_price_applied,
price_break_applied, line_subtotal, discount, net, tax, gross. Totals use subtotal,
discount, net, tax, item_tax, shipping_tax, shipping, shipping_gross, total.
Optional payment_terms uses advance_amount, balance, due_date; engine 1.1.0
normally provides it. Supplied zero advance/balance prints; absent object adds none.
Rates come from the engine's discount.ceiling, tax.inclusive/exclusive and
shipping.tax.inclusive/exclusive trace inputs (discount_bps/tax_bps), not guesses
from rounded amounts. Trace rule/operand schemas are closed to version 1.1.0.

Output sections: approved header, seller/customer/ref/dates, inclusion/exclusion
of GST, one block per line using the supplied label, quantity x unit price =
line_subtotal; any line discount with rate, net, GST with rate, gross line total;
merchandise subtotal, any aggregate discount, merchandise net, merchandise GST,
shipping net/GST/gross, total GST, grand total; advance/balance/due if provided;
validity, supplied payment terms and supplied notes. No contact details or terms
are invented; fixed English labels describe input facts. No locale detection or
translation: supplied proper names/text are preserved apart from neutralization.
Money uses divmod(integer paise, 100), Indian grouping (last 3 then 2 digits),
rupee sign and exactly 2 decimals. Bps divide into integer percent and residual
two digits, removing trailing decimal zeroes: 500 -> 5%, 1250 -> 12.5%.
Money tokens never wrap internally. Display long words wrap deterministically.

All strings/keys reject control/format/surrogate and Unicode line/paragraph
separator characters (includes bidi controls, zero-width formatting and newline),
except that since 1.1.0 U+200C and U+200D are allowed directly after an Indic
letter or mark (U+0900..U+0DFF); anywhere else they are still refused. Since 1.2.0
a shipping line whose amount is zero is not printed. Versions: `packages/pure/quote_text/VERSIONS.md`.
Supplied display * _ ~ and backticks become spaces; whitespace collapses. A
markup-only/blank display value rejects. No numeric amounts are recalculated:
integer conservation checks validate line subtotal, discounts, net+tax=gross,
totals, advance+balance, tax/shipping breakdown and relevant trace operands.
Display dates are canonical YYYY-MM-DD; issuance and validity match the engine
quote.validity trace, and validity matches quote.valid_until. No clock/expiry
decision occurs. Due date must not precede issuance.

## Bounds and determinism
| Constant | Inclusive bound |
| --- | --- |
| MAX_STRING | 200 Unicode characters (ordinary strings and keys) |
| MAX_LINES / MAX_NOTES | 30 quote item lines / 10 note strings |
| MAX_WIDTH / MAX_OUTPUT_LINES | 60 characters per rendered line / 500 rendered lines |
| MAX_UNIT_PRICE / MAX_QUANTITY / MAX_RATE | 100,000,000 paise / 10,000 / 10,000 bps |
| MAX_AMOUNT | 60,000,200,000,000 paise (30 maximum gross lines plus maximum freight) |
| MAX_TRACE / MAX_TRACE_TEXT | 300 rules / 4,000 characters per generated trace.text |
| MAX_DEPTH / MAX_NODES / MAX_OBJECT_FIELDS | 10 / 50,000 / 40 |
Trace/reason lists, line labels and all nested shapes are bounded before hashing,
formatting or per-line validation. Trace.text has no control characters either.
Canonical JSON sorts keys, uses compact separators and ASCII escaping, integers
only. Hash = sha256 of `{renderer_version: V, inputs: request}`, with V the renderer's
version ("1.2.0" today; the version is part of the hash). All supplied
metadata participates even when not printed. Input is never mutated/shared.
Tests use the real quote engine in tests only, synthetic JSON fixtures and 250
seeded inclusive/exclusive cases parsing every printed amount back to paise.

## Lane A handoff and limits
A must approve first, load the authoritative approved record, recompute the
engine request/hash/result and require a match, then supply the matching engine
hash and display fields. The renderer checks hash equality but is NOT an
authorization or signature verifier: the engine hash binds its inputs, not its
result; a caller can forge the boolean/hash without A's checks. A must enforce
tenant/actor rights, provenance, stored-result equality, display/notes review,
approval, persistence and audit. These security decisions belong to A.
A presents text for a human to copy into WhatsApp/e-mail. This package sends
nothing, reads no contacts, approves nothing and performs no network action.
