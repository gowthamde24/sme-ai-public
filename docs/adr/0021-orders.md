# ADR 0021: Orders: an approved quote becomes an order that follows the pure lifecycle (order conversion, commits 1-4: the database and its proofs)

Status: accepted for the local-first stage (owner review of the plan 2026-10-06, all defaults accepted; plan and decisions: `docs/plans/order-conversion.md`). Related: ADR 0018 (decision 9, lock order), ADR 0019 (quote integration; the withdrawal hook), ADR 0013 (option A / B), ADR 0016 (second factor),
ADR 0017 (local-first), ADR 0020 (suppression; the follow-up stop reads order states), `docs/plans/order-lifecycle.md` (lane C's pure package `packages/pure/order_lifecycle`, 1.0.0, the contract this wraps).

## Context
A person who has approved a quote needs a record of what happens next: the quote was sent, the customer accepted or declined, money arrived, goods left. Lane C's package `order_lifecycle` is the pure rule set for those transitions. It proposes; it persists, authorises and reconciles nothing.
This ADR is the database and its proofs (plan commits 2-4). The API and the web (commits 5-7) are not built yet. **Nothing here sends anything, moves money or reaches a bank: every event is a PERSON's record of something that happened outside the system. The ledger is a ledger of claims.**

## Decisions
**1. An order is started explicitly, never automatically.** `create_order_from_quote(order_id, quote_id)` (Owner / Admin, second factor: it starts a financial commitment record). One order per quote (`unique (tenant_id, quote_id)`). The figures (`order_total_paise`, `advance_paise`, `valid_until`) are copied BY THE DATABASE from the approved quote row under the quote's lock; no caller supplies an amount.
The order copies the quote's ids (enquiry, requirement, lead) and the order policy version in force; it carries no contact field.

**2. The ledger is the source of truth; the state is its cache.** `order_events` is append-only (update, delete and truncate refused for every role), `seq` is per order and gapless, the event id the caller chooses is the idempotency key. `orders.state` is moved only by the same statement that appends the event, and a guard trigger refuses any state change that is not
the new state of the latest event (and whose prior state is the old one): the cache cannot drift, even through a bug in a function. Content columns of an order are immutable. The order's state also determines `closed_at` (set once, with a terminal state).

**3. The pure engine is the authority on transitions; the database proves a v1 subset it can recompute exactly.** The API runs the pinned engine on the order's recorded state and the new event, with the caller's token, and hands the database the canonical request, the engine's result and the person's inputs. The database:
(a) rebuilds the request from its OWN ledger (`app.order_build`) and refuses any other (SM238), (b) recomputes the decision (`app.order_decide`: the structural matrix, positive integer money within the engine's bounds, `paid <= order_total`, `refunds <= paid`, unique payment and refund ids per namespace, the advance threshold for `start_preparation` and `dispatch`,
the cancel window, the quote's expiry for `send_quote` / `customer_accept` / `expire`, the new state, the flags) and refuses a result that differs (SM238), a rejected decision (SM232 with the engine's closed code), a terminal order (SM235). An equivalence property test (generated ledgers, the real engine against the database function) pins them equal.
What the database does not run is the engine itself (two implementations, kept equal by that test); the rule trace is stored as given and not verified.

**4. Who may do what.** Role first (one generic 42501 for every refusal before the role is proven), then the second factor (SM306), then the specific refusals.
| Action | Owner | Admin | Sales | Viewer | aal2 |
| --- | --- | --- | --- | --- | --- |
| create an order, `record_payment` | yes | yes | no | no | yes |
| `cancel` an order with NO money in it | yes | yes | no | no | yes |
| `cancel` an order that carries money (CANCELLATION_WITH_FUNDS) | yes | refused (SM234) | no | no | yes |
| `record_refund` | yes | refused (SM234) | no | no | yes |
| `send_quote`, `customer_accept`, `customer_decline` (with a reason), `request_advance`, `start_preparation`, `dispatch`, `deliver`, `expire` | yes | yes | yes | no | no (except below) |
| `dispatch` with the advance unpaid (the override) | yes | refused (the engine's ADVANCE_NOT_PAID) | refused (same) | no | yes |
| create an order policy version | yes | no | no | no | yes |
| read orders, events, the ledger view | yes | yes | yes (amounts included) | no | no |
`owner_override` is DERIVED by the database from the caller's role (true only for an Owner dispatching); it is never a field a caller can set, and a request that carries another value than the derived one is a mismatch (SM238). An override that is actually used (the decision carries ADVANCE_OVERRIDE) requires the second factor.

**5. Withdrawal and supersession are refused once an order exists (SM237).** `withdraw_approved_quote` and `approve_quote` are replaced in this migration (the latest definitions plus named lines, copy-tested). The invariant: **every writer that creates an order or changes the standing of an approved quote locks the quote row, after the enquiry and the requirement rows**
(lock order: enquiry, requirement, quote, order, the order's events). `record_order_event` locks the order row alone and reads no quote. A new quote for a requirement whose approved quote has an order cannot silently replace it: a discount or a price change after acceptance is a new quote, made after the person has cancelled or lost the order.

**6. Time.** `as_of` is the API's now (UTC, whole seconds) and the database bounds it to within ten minutes before and two minutes after its own clock (a backdated payment cannot dodge `QUOTE_EXPIRED`). The quote's `valid_until` is a date; the engine's `valid_until` is the end of that day in India (23:59:59 IST, as UTC), so equality stays valid and a quote is expired from the next day,
the rule the quote module already applies. `occurred_at` is the person's own date of the real-world event: not in the future (five minutes of clock slack), not more than 30 days old; it never enters the engine.

**7. Lost reasons are a closed list:** `price`, `timing`, `bought_elsewhere`, `no_response`, `requirement_changed`, `product_unavailable`, `credit_terms`, `other` (an enum; `customer_decline` carries one, every other event carries none). Free text is never stored.

**8. Ledger ids are UUIDs.** A payment id and a refund id are UUIDs chosen by the caller (the engine's per-namespace uniqueness rule becomes two partial unique indexes); no bank reference or free text is stored. The amount of an event is the person's claim in integer paise (1 to 1,000,000,000: the engine's cap; an order above the cap is refused at creation).

**9. SQLSTATEs (SM230-SM239; SM220-SM229 stay with follow-ups):** SM230 the quote is not approved; SM231 another order exists for this quote; SM232 the event is refused by the lifecycle rules (the detail carries the engine's closed code); SM233 the figures cannot satisfy the policy (a zero-value order or an advance the policy requires but the quote lacks, or a total above the cap);
SM234 a refund needs the Owner; SM235 the order is closed; SM236 the quote has expired; SM237 the quote has an order (withdrawal / supersession refused); SM238 the request or result is not what the database computes; SM239 no order policy in force. (The plan wrote SM222 for the last: that number is inside the follow-up range, so SM239 is used.)
42501 for every refusal before the role is proven, SM306 second factor, 22023 invalid argument, 23505 record id already used with other values, 23503 invalid reference.

**10. Follow-ups read order states.** `accepted`, `declined` and `cancelled` orders stop a lead's follow-ups (ADR 0020, plan amendment c). The order side writes nothing to follow-up tables. `app.order_stops_followups(lead)` is a read-only helper for the follow-up functions (definer functions need no new grant); it takes no lock.

## What the database proves and what it trusts
Proven: tenant isolation, role and second factor, one order per quote, the append-only gapless ledger, the cache equals the ledger, the amounts are the approved quote's, the v1 subset of the lifecycle and money conservation, idempotency (a retry replays, a reused id with other values is refused),
no order on a withdrawn quote and no withdrawal or silent supersession of an ordered quote.
Trusted: that the money really arrived, that the customer really accepted, that goods really shipped (a person's record); the engine's rarer guards beyond the subset; that the API ran the engine (an Owner or Admin calling the function directly is trusted: the option-A limit; option B before an external customer).

## Consequences and limits
* The system is a ledger of claims, not a bank. A reconciliation against bank statements is a Customer Zero process (checklist).
* Order numbers are unique and increasing per tenant ("max + 1" under an advisory lock) but not gap-free.
* The CRM opportunity is NOT changed automatically; a person updates it (plan decision 6).
* A policy change does not touch existing orders (immutable, versioned); an order keeps the policy version it was created under.
* Not built here: the API, the web, the seed of an order policy (tests create one through the function), the follow-up stop's consumers (T010 part 2).

## Amendments after the owner's review (2026-10-07; migration `20261020090000_review_fixes.sql`)
* **A cancellation that carries money is the Owner's (SM234, reworded "this action needs the owner").** The lifecycle already flags it (CANCELLATION_WITH_FUNDS) and says a flag is never authority; an order with money in it can mean a refund is owed, so the person who may approve a refund decides to cancel it. An Admin may still cancel an order with no money in it. The Owner's `owner_approved_by` is recorded on that event (the `order_events` check now allows it on a `cancel`). Reason: a cancellation with funds was the one money-affecting event an Admin could do without the Owner.
* **SM237 holds only while the quote's order is NOT declined, expired or cancelled.** Decision 5 made a quote with an order permanent. A lost or cancelled deal is finished: its order stays as the record, and the customer may come back with a new quote for the same requirement, which must be approvable (the old quote becomes superseded; its terminal order is untouched). Accepted, in-flight and closed_paid orders still protect their quote, both ways. Reason: without this a declined order would block every later quote for the requirement forever.
* **The follow-up stop reads the lead's LATEST order (decision 10 amended).** `app.order_stops_followups(lead)` looks at the lead's latest order (highest order number): fulfilment states give `accepted`, then `declined`, then `cancelled`; any other state stops nothing. A newer approved quote of the lead with no order yet means a new deal is being made, so nothing stops. The withdrawn rule is unchanged. Reason: an old declined order must not silence a lead the business is quoting again. Known consequence (owner to confirm): a lead with an accepted order in fulfilment AND a later, open order of another quote is not stopped by the older one.
* **A synthetic order policy seed** (`app.operator_seed_order_policy`, operator-only) exists for local work; the values are invented defaults, not the family's.
