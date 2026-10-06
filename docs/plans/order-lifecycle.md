# Pure order lifecycle (lane C)

## API and inputs
Stdlib-only `packages/pure/order_lifecycle`; add `packages/pure` to sys.path and
import `transition`, `canonical_json`, `ENGINE_VERSION`. No clock, randomness,
I/O or dependencies. Currency INR; amounts integer paise, policy/override flags
strict booleans. Inputs are unchanged. Synthetic fixture is under package tests.
Request exact fields: current_state, event, as_of, valid_until, order_total,
payments, refunds, policy, flags. Timestamps are canonical YYYY-MM-DDTHH:MM:SSZ.
- event is `{type}`; record_payment adds `{amount, payment_id}`;
  record_refund adds `{amount, refund_id}`. No unused event fields accepted.
- payments: `[{payment_id, amount}]`; refunds: `[{refund_id, amount}]`.
- policy: `{advance_required, advance_amount, dispatch_requires_advance,
  cancel_allowed_until_state}`; flags: `{owner_override}`.
Result: status ok/rejected, new_state, allowed_next_events, balance_due,
paid_total, flags `{needs_owner_approval, reasons}`, trace, engine_version,
canonical_hash; rejection adds codes. Rejected new_state is null, allowed list
empty: caller keeps the original state/ledger. Valid snapshot money is retained
on event rejection. Invalid/overpaid snapshots have null money (no safe balance).
Trace has rule_id, operands and readable text. Hash/version do not authenticate
actor, ledger or catalog. ENGINE_VERSION=1.0.0; hash = sha256 of sorted compact
ASCII JSON of `{"engine_version": ENGINE_VERSION, "inputs": request}`.
canonical_json(result).encode("utf-8") is deterministic. Oversize preflight
rejects with null hash. Other rejections retain hash. Wrong types raise TypeError
(including floats and booleans in integer fields); business-invalid values reject.

## Structural matrix (additional guards below)
| State | Events |
| --- | --- |
| quote_approved | send_quote, expire, cancel |
| quote_sent | customer_accept, customer_decline, expire, cancel |
| accepted | request_advance, record_payment, start_preparation, cancel, record_refund |
| advance_requested / advance_paid | record_payment, start_preparation, cancel, record_refund |
| in_preparation | record_payment, dispatch, cancel, record_refund |
| dispatched | record_payment, deliver, record_refund |
| delivered | record_payment, record_refund |
| closed_paid / declined / expired / cancelled | none |
All other pairs reject ILLEGAL_TRANSITION, including refunds after terminal
states. allowed_next_events is structural matrix filtered by current guards and
ledger capacity/positive money availability, in the declared event order; monetary
events still require a valid amount/new ID. It is guidance, never approval.

## Rules and smallest safe assumptions
- send_quote -> quote_sent; customer_accept -> accepted; customer_decline ->
  declined; request_advance -> advance_requested; start_preparation ->
  in_preparation; dispatch -> dispatched; expire -> expired; cancel -> cancelled.
- Expire is allowed only before accepted and strictly as_of > valid_until.
  Sending/accepting after valid_until rejects QUOTE_EXPIRED; equality remains valid.
- All ledger/event money amounts are positive; order_total can be zero for a free
  order. Net paid = sum(payments) - sum(refunds); balance = order_total - net paid.
- Refunds exceeding available net receipts reject REFUND_EXCEEDS_PAID. Proposed
  or existing overpayment rejects OVERPAYMENT and flags owner review, preserving
  existing valid money on event rejection. No negative paid/balance is returned.
- Each payment ID and each refund ID is unique within its own namespace;
  historical duplicates and incoming replay reject DUPLICATE_PAYMENT_ID or
  DUPLICATE_REFUND_ID. Caller appends the event to the ledger only on status ok.
- Advance amount cannot exceed order total and must be positive if either
  advance_required or dispatch_requires_advance is true (else INVALID_ADVANCE).
- Preparation requires net paid >= advance_amount when advance_required.
  Dispatch independently requires this threshold when dispatch_requires_advance.
  Only dispatch can use owner_override; a used bypass flags ADVANCE_OVERRIDE.
- Payments at accepted/advance_requested move to advance_paid when required
  advance is met. Partial payment stays in place. Other payment states stay in
  place until delivery. Refund below required advance at advance_paid moves back
  to advance_requested; later fulfillment states never move backwards for refunds.
- Every successful refund flags REFUND_REQUIRES_OWNER_APPROVAL. Cancel with funds
  flags CANCELLATION_WITH_FUNDS. Cancel is limited inclusively by the configured
  pre-dispatch state (quote_approved through in_preparation); after dispatch it
  is structurally illegal, even with override. Terminal states cannot refund:
  refund before cancellation or use lane A's separate reviewed reconciliation.
- deliver yields delivered with an unpaid balance, otherwise closed_paid.
  A payment at delivered closes exactly at zero balance. Full payment before
  delivery does not close; no separate close event exists. Unpaid closed_paid
  input rejects CLOSED_UNPAID. A financial flag never authorizes a payment/write.
- Additional value codes: INVALID_FIELDS, INVALID_STATE, INVALID_EVENT,
  INVALID_TIMESTAMP, EMPTY_IDENTIFIER, INVALID_CANCEL_WINDOW, OUT_OF_RANGE;
  guard codes include QUOTE_NOT_EXPIRED, CANCEL_WINDOW_CLOSED, ADVANCE_NOT_PAID.

## Inclusive operational bounds
| Constant | Maximum |
| --- | --- |
| MAX_AMOUNT (per amount/order total, generic integer cap) | 1,000,000,000 paise (INR 10,000,000) |
| MAX_RECORDS (each ledger, including proposed entry) | 1,000 |
| MAX_STRING_LENGTH (strings and keys) | 128 Unicode characters |
| MAX_DEPTH / MAX_NODES / MAX_OBJECT_FIELDS | 8 / 12,000 / 16 |
Preflight checks both ledger lengths before item work/hash, then iteratively
bounds all JSON shape/strings/integers. Dates span Python ISO years 0001..9999.
Tests cover limits/one-above, 10**30 and huge poison-element collections.

## Owner decisions and lane A handoff
Owner must confirm whether advance is always required, its amount, who may
override dispatch, refund approval/policy, cancellation window, zero-value orders,
late acceptance and closure-on-delivery semantics. This package proposes only:
persistence, approvals, authorization, audit, authoritative state/ledger lookup,
payment reconciliation with real payments and GST invoicing are NOT here.
Lane A must bind/idempotently persist verified payment/refund events, validate
actor rights (owner_override is not proof), serialize concurrent transitions,
retain provenance, supply approval flows and handle post-terminal reconciliation.
