# Order conversion plan: approved quote to order, won / lost, payments recorded by a person (PLAN ONLY, nothing built)

Status: written 2026-10-06 after T009 for the owner's review. Related: ADR 0019 (quote integration; the withdrawal hook), ADR 0018 decision 9 (lock order), ADR 0013 / 0016 (agents, second factor), `docs/plans/order-lifecycle.md`
(lane C's pure package, the contract this plan wraps), `docs/plans/t009-quote-integration.md`, `docs/plans/t010-integration.md`, `docs/pre-pilot-checklist.md` rows "Quotes".
Reads before building: CLAUDE.md, AGENTS.md, docs/lanes.md, this plan, the lifecycle plan, ADR 0019.

## 1. Scope and non-goals

**In scope:** an approved quote becomes an **order record** that follows the pure lifecycle (`packages/pure/order_lifecycle`, 1.0.0): `quote_approved -> quote_sent -> accepted -> advance_requested / advance_paid -> in_preparation -> dispatched -> delivered -> closed_paid`,
with the terminal exits `declined` (LOST, with a reason), `expired` and `cancelled`. Every event is a PERSON's record of something that happened outside the system ("I sent the quote", "the customer accepted", "we received Rs 40,000"); the order page shows
Won / Lost, the ledger of payments and refunds, the balance, and the source trail (enquiry, requirement, quote, price list and policy versions, who recorded what and when). Everything is deterministic and idempotent.

**Non-goals:** sending a quote or any message (nothing is sent: `send_quote` means a person records that THEY sent it), payment collection or reconciliation with a bank or gateway, invoices, GST invoicing or filing, e-way bills, stock and dispatch logistics, supplier orders, refunds that move money,
a customer portal, automatic change of a CRM opportunity's status (decision 6), a per-customer credit limit (checklist: "repeat credit limit is global"; order history now makes it possible but it is a later ticket), and any model or agent (no model sees an order).

**What does not change:** a person decides every step; the amounts of an order are copied BY THE DATABASE from the approved quote row, never from a caller; no agent may create a financial commitment (CLAUDE.md 3), so no agent code path reaches these functions.

## 2. Tables and functions

SQLSTATEs proposed in the range **SM230-SM239** (confirm free codes at build time; SM201-SM218 are the quote module's, SM220-SM229 are reserved by the T010 plan).

* `order_policy_versions` (immutable, versioned, created by an Owner with aal2, synthetic seed only): `advance_required` (bool), `dispatch_requires_advance` (bool), `cancel_allowed_until_state` (the engine's state names), `allow_zero_value_orders` (bool). The advance AMOUNT is not here: it is the quote's own `advance_paise`.
* `orders` (tenant-owned): `id` (the caller's, idempotent), `tenant_id`, `order_no` (the tenant's next, under an advisory lock like `quote_no`), `quote_id` (**unique per tenant: one order per quote**), `enquiry_id`, `requirement_id`, `lead_id`, `state` (the engine's states as an enum),
  `order_total_paise`, `advance_paise`, `valid_until` (all copied from the approved quote row), `policy_version_id`, `created_by/at`, `closed_at`. Content columns are immutable; only `state`, `closed_at` and `updated_at` move, only through the functions (a guard trigger like `quote_guard_update`).
* `order_events` (append-only ledger, the source of truth; `orders.state` is its cache and a pgTAP check proves they agree): `id` (the caller's event id, **idempotency key**), `tenant_id`, `order_id`, `seq` (per order, gapless), `type` (the engine's event names), `amount_paise` (nullable),
  `payment_id` / `refund_id` (the caller's ids, unique per order within their own namespace, exactly the engine's rule), `occurred_at` (the person's date of the real-world event), `recorded_by`, `recorded_at`, `prior_state`, `new_state`, `engine_version`, `request_text`, `result_text`, `canonical_hash`,
  `reason_code` (for `customer_decline`: the lost reason, from a closed list), `owner_approved_by` (for a refund or an override).
* Views: `order_ledger` (security invoker): paid total, refunded total, balance, from the events.
* Functions (all `SECURITY DEFINER`, `search_path=''`, one overload, `authenticated` only, the role proven before anything else is revealed, one generic 42501):
  * `public.create_order_from_quote(p_order_id, p_quote_id)`: **SM230** the quote is not approved (draft, rejected, superseded or withdrawn); **SM231** a different order already exists for this quote (an exact retry replays); **SM236** the quote has expired (`as_of > valid_until`, the engine's `QUOTE_EXPIRED` rule);
    **SM222** no order policy in force. Copies the figures from the quote row; inserts the first event (`quote_approved` is the start state, event `created`) in the same statement.
  * `public.record_order_event(p_event_id, p_order_id, p_type, p_occurred_at, p_amount_paise, p_ledger_id, p_reason_code, p_engine_version, p_request_text, p_result_text)`: the API ran the pinned engine on the order's recorded state and the new event; the database rebuilds the request from its own ledger and refuses a different one
    (**SM238**, like SM216), refuses a rejected result (**SM232** with the engine's fixed code mapped to a closed list, never free text), refuses a terminal order (**SM235**), and a refund or an override that lacks the Owner (**SM234**, like SM218). It inserts the event and moves the cache in one statement.
  * `public.withdraw_approved_quote` (replaced in a new migration, copy test): **SM237 once an order exists for the quote** (the hook already in the function, ADR 0019). And `public.approve_quote` (replaced): when it would supersede an older approved quote that has an order it refuses with **SM237** instead.
* The pure engine is the AUTHORITY on transitions; the database proves a **v1 subset** it can recompute exactly (decision 2): the structural state / event matrix, positive integer money, `paid <= order_total`, `refunds <= paid`, unique payment and refund ids, the advance threshold for `start_preparation` and `dispatch`, and the cancel window. An equivalence property test (generated ledgers, the real engine against the database function, like `test_quote_engine_equivalence.py`) pins them equal.

## 3. Lock order

**Enquiry row, requirement row, quote row, order row, then the order's events** (ADR 0018 decision 9 extended at its tail). `create_order_from_quote` locks `enquiry -> requirement -> quote` exactly like `approve_quote`, then inserts the order; `record_order_event` locks `order` only if it never reads
a quote after locking (it does not: the order carries what it needs), so its chain is `order` alone; `withdraw_approved_quote` (existing chain `enquiry -> requirement -> quote`) then reads the `orders` row of that quote **while holding the quote lock** (no new lock needed to see "exists": an `insert` of the order
needs the quote row `FOR UPDATE` first, so the two are serialised on the quote row). **Invariant to state in the ADR: every writer that creates an order or changes the standing of an approved quote locks the quote row, after the enquiry and requirement rows.** Any one of the three parent locks is redundant given the others (ADR 0018 / 0019 reasoning); the mutation notes must say that.

## 4. Who may do what

| Event / action | Owner | Admin | Sales | Viewer | aal2 |
| --- | --- | --- | --- | --- | --- |
| Create an order from an approved quote | yes | yes | no | no | **yes** (a financial commitment) |
| `send_quote` (I sent it), `customer_accept`, `customer_decline` (+ reason), `request_advance`, `start_preparation`, `dispatch`, `deliver`, `expire` | yes | yes | yes | no | no |
| `record_payment` | yes | yes | no | no | **yes** (money) |
| `cancel` | yes | yes | no | no | **yes** (with funds it also flags `CANCELLATION_WITH_FUNDS`) |
| `record_refund` (the engine flags `REFUND_REQUIRES_OWNER_APPROVAL`) | yes | no | no | no | **yes** |
| `dispatch` with an unpaid advance (`owner_override`) | yes | no | no | no | **yes** |
| Create an order policy version | yes | no | no | no | **yes** |
| Read orders, events, ledger | yes | yes | yes (no money columns? decision 4) | no | no |

`owner_override` is a FLAG derived from the caller's role by the database, never a field a caller can set (the engine's own note: "owner_override is not proof").

## 5. What the database proves and what it trusts

| Property | Proven by the database | Trusted |
| --- | --- | --- |
| Tenant isolation, role, aal, one order per quote, append-only ledger, gapless `seq`, the cache equals the ledger | yes | |
| The order's amounts are the approved quote's | yes (copied from the row under the quote lock) | |
| The state machine for the v1 subset and the money conservation | yes (recomputed; equivalence property test) | |
| A withdrawn quote has no order; an order's quote cannot be withdrawn or silently superseded | yes (SM237, the shared quote-row lock) | |
| Payments and refunds are idempotent (a retry replays, a reused id with other values is refused) | yes (unique ids, exact-replay comparison) | |
| That money really arrived, that the customer really accepted, that goods really shipped | **no** | a person's record. This is the honest limit of "payments recorded by a person": the system is a ledger of claims, not a bank. The ledger is append-only and audited, a refund needs the Owner, and a reconciliation against bank statements is a Customer Zero process (checklist row). |
| The engine's rarer guards (late acceptance, closure semantics) | the database re-checks the subset only | the engine result (the API ran it with the caller's token; a forged result can only describe a transition the matrix also allows) |

## 6. Test plan

* **pgTAP:** the role / aal matrix for every function and event type (including Admin refused for refunds, Sales refused for payments, aal1 owner refused with the second-factor code AFTER the role check); every SQLSTATE reached; append-only (update, delete, truncate of events and orders' content); the guard trigger (state moves only along the matrix); the cache equals the ledger after a generated sequence;
  `unique (tenant_id, quote_id)`; the replaced `withdraw_approved_quote` and `approve_quote` with copy tests; the catalog guards and the registry; erasure reaches nothing here that is personal (the order carries no contact fields; the lead link is an id, like quotes: a test like `test_quote_erasure.py`).
* **Real stack:** every new read and write through the API and straight through PostgREST: a Viewer refused, a second tenant sees nothing, a forged request / result refused (SM238), a forged `owner_override`, a payment twice (replay), a payment with the same id and another amount (refused), an overpayment, a refund above paid, a payment on a terminal order, dispatch without the advance, cancel after dispatch, the full happy path to `closed_paid`, and the ledger totals equal the engine's `paid_total` / `balance_due` at every step.
* **Races (two real connections, as in `test_quote_races.py`):** `create_order_from_quote` vs `withdraw_approved_quote` on one quote (exactly one wins; never an order on a withdrawn quote, never a withdrawn quote with an order); `create_order` vs a second `create_order` (one order); `approve_quote` of a NEWER quote vs `create_order` of the OLDER one (the older keeps its approval or the order is refused, never both states); two payments with one id; a payment vs a cancel; a storm of mixed events (no deadlock, `seq` gapless, the cache equals the ledger).
* **Python:** the lifecycle adapter (pinned version, golden vectors by value for every state and event, independent hash recomputation, fail closed, no new dependency, path appended never first, shallow-path safe), the request builder (mirrors `app.order_build`, like the quote builder), error mapping to fixed names, no field a caller can use to set an amount, an approver, a state or `owner_override`.
* **Web:** the order page (state badge: Won / Lost / Cancelled / Expired as our words, the ledger, the balance, the source trail with links), forms for each event with the allowed next events from the engine (guidance only; the database decides), the second-factor notice, "nothing is sent" on `send_quote`, a Viewer sees nothing.
* **Mutation pass at the milestone:** every SM check, the role lists, aal2 after role, the quote-row lock and the order lock (combined mutants for the redundant parent locks), the unique index, `seq` gaplessness, the ledger-cache agreement, the replay comparison, the refund-owner rule, the override derivation, the copy-from-quote, the SM237 checks in withdraw and approve.

## 7. Risks

(1) A person records money that did not arrive: the ledger is a ledger of claims (limit above; the checklist gets a reconciliation row). (2) Time: `occurred_at` is a person's date; the engine takes an `as_of` that the API sets to now (IST) and the database bounds (like quotes: today or yesterday), so a backdated payment cannot be used to dodge `QUOTE_EXPIRED`. (3) Rounding is already settled in the quote; an order never recomputes a price. (4) A discount or a changed price after acceptance is NOT an order edit: it is a new quote, which supersedes only a quote without an order (SM237).

## 8. Open owner decisions (recommended default in each)

1. **When an order exists.** Default: a person starts tracking an approved quote as an order explicitly (Owner/Admin, aal2). Alternative: automatically at approval (then every approved quote has an order and the withdrawal hook always fires, which makes a mistaken approval harder to undo).
2. **Database recompute vs trusting the engine.** Default: the database recomputes the v1 subset (section 2) and an equivalence test pins it. Alternative: trust the API-run engine entirely (less code, but PostgREST is exposed, so a malicious user could submit a forged result straight to the database).
3. **Advance policy.** Default: `advance_required = true`, amount = the quote's own advance (new 50%, repeat 25% in the synthetic seed); `dispatch_requires_advance = true`; override by the Owner only. Real values are the family's.
4. **Sales and money.** Default: Sales reads an order's state and events but not its payment amounts or totals (as quotes: a Viewer sees no totals; Sales does see quote totals today, so the consistent default is Sales sees amounts, Viewer none). **Please confirm which**; I will build "Sales sees amounts, Viewer sees nothing" unless told otherwise.
5. **Cancellation window and late acceptance.** Default: cancel allowed through `in_preparation` (the engine's default reading); accepting after `valid_until` refused (`QUOTE_EXPIRED`); a person who wants to honour a late acceptance makes a new quote.
6. **Won / lost and the CRM.** Default: the order page shows Won (accepted) and Lost (declined, with a reason from a closed list); the CRM opportunity is NOT changed automatically; the order page links to it and a person updates it. Alternative: a function moves the opportunity through the existing transition rules in the same transaction (needs the opportunity-to-order link and its race).
7. **Lost reasons.** Default list: `price`, `timing`, `bought_elsewhere`, `no_response`, `requirement_changed`, `other`. The owner may edit it before the build (it is an enum, so changing it later needs a migration).
8. **Zero-value orders.** Default: refused (`allow_zero_value_orders = false`).
9. **Refund approval.** Default: Owner with aal2 records the refund, which is itself the approval (one step); no second approver. A refund records that money was returned elsewhere; the system returns nothing.
10. **Reconciliation.** Default: out of scope; a checklist row "reconcile the ledger with bank statements weekly during the four-week measurement" for Customer Zero.

## 9. Commit order and stops

1. ADR 0021 (orders), this plan's as-built section, checklist rows. 2. The lifecycle adapter (golden vectors, fail closed, no new dependency) and the request builder with its unit tests. 3. Migration: policy versions, orders, events, the ledger view, `create_order_from_quote`, `record_order_event`, guard triggers, the two replaced functions (SM237) with copy tests, pgTAP.
4. The equivalence property test and the race tests. 5. API and real-stack attacks. 6. Web (order page, event forms, the link from the quote). 7. Milestone: full `make check`, one mutation pass, handoff and checklist notes. **Stop for the owner's review after 3-4 (the database and its proofs) before the API and web.** No push.
