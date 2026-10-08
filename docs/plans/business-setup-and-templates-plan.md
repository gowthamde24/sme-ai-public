# Plan: business setup and templates (any business set up by selecting options)

Status: **PLAN ONLY. NOT APPROVED. Updated 2026-10-09 against `main` after manual-price slice 3** (earlier update: 2026-10-08 after slice 1). Section 12 (self-serve setup in the website) is new on 2026-10-09; sections 2.1, 4, 6.2, 7, 8 (question 13) and 11 were corrected for slices 2 and 3 (migration `20261030090000_manual_price_slice2.sql`, `manual-price-quote-plan.md` sections 22 to 25). First written 2026-10-08 on the branch `docs/business-setup-plan`, lane B (docs). No code, migration, test, ADR or dependency was written or changed, and nothing was run. The facts come from files in this repository as they are on `main` (paths below); what I could not check is marked **unverified**. Sizes follow the repo's convention: **S** = web only, existing endpoints; **M** = a new endpoint or one migration with tests; **L** = a security-relevant database change with an equivalence proof. They are my estimates.

**Owner direction (2026-10-08):** "Our website should be flexible in a way that any type of business can be set up by themself or my support team easily by selecting options."

**Nothing in this plan is tax, legal or compliance advice.** Every rate, amount, day count and range named here is a SYNTHETIC PLACEHOLDER unless the owner or the accountant has said otherwise. No statement here claims that anything complies with any law.

Sources read: `docs/plans/manual-price-quote-plan.md`, `docs/plans/open-in-whatsapp-plan.md`, `docs/pre-pilot-checklist.md`, `docs/plans/members-and-invitations.md`, `docs/plans/quote-text.md`, `docs/plans/t009-quote-integration.md`, `docs/product.md`, `docs/architecture.md`, ADRs 0013, 0015, 0019, 0022, and the migrations `20261029090000_manual_price_slice1.sql`, `20261016090000_t009_quote_reference_data.sql`, `20261019090000_order_conversion.sql`, `20261024090000_t010_part2_followups.sql`, `20261015090000_t008_enquiries_requirements.sql`.

## 1. Goal and non-goals

**Goal.** A business owner (or our support team, with the owner's permission) sets up a workspace by choosing options on screens, with no code change and no deploy. The result is a set of published, versioned settings that the existing quote, follow-up and order machinery already reads.

**"Any business" means:** any business that **quotes, follows up and collects payment**: it sends a price to a customer, chases a reply, and takes an order and money. It does not mean any business of any kind.

**Non-goals (these are product changes, not options):**
* Country-specific or product-specific tax logic. The product is India, rupees, GST added on top (`price_lists.currency` is always INR; `tax_mode` is `exclusive` only in v1, enforced by a check: `t009-quote-integration.md:63`). A second country, tax-inclusive prices, a CGST/SGST/IGST split, HSN rules and any other tax scheme each need their own ticket and an accountant's input.
* Any new money-calculation rule: a new discount formula, a margin rule, tiered or customer-specific pricing, a new rounding mode, a new way to compute an advance or a balance. The deterministic engine and the database's own recomputation (ADR 0019 decision 3) define what can be calculated. A setting may choose among the rules that exist; it may not add one.
* Full ERP, payroll, GST filing, HR (`docs/product.md`, non-goals), and a self-service sign-up for strangers (the product stays invitation-only until the external-customer gates in section 7 are closed).
* A template builder, a rules language, a scripting hook or any user-written logic.

## 2. Principle: configuration over code

**Everything configurable is a versioned setting.** A setting is a whole, immutable version with an effective date and a creator and time, published by an Owner or Admin with the second factor; a correction is a new version; nothing is edited or deleted. This is already how the quote policy, price lists, follow-up policy, order policy and mapper config work (ADR 0019 decision 1: "created WHOLE by one definer function and never edited or deleted"; a new version may not be effective before today in India or before the latest one). New settings must follow the same pattern. Whether every publish also writes a separate audit event is **unverified** for each table; the creator and time are on the version row.

### 2.1 What exists, what is only planned, what is not a setting

The owner's brief lists some items as already existing. The code says otherwise for several. **Status as read from `main` today:**

| Setting | Status | Evidence and what it really is |
| --- | --- | --- |
| Quote policy: validity days, new and repeat **advance** (basis points), **net days per customer kind** (`new_net_days`, `repeat_net_days`, each 0 to 180), repeat **credit limit**, seller state, required inputs, rounding mode, shipping fee / free-above / shipping tax | **Exists** (versioned; web page on `main`, item d, which also carries the two net-days fields) | `quote_policy_versions`, `20261016090000:207-233`, changed by `20261029090000` (slice 1; `manual-price-quote-plan.md` section 22, item 1). Net days and the advance now both differ by kind; the kind is still a person's claim (`REPEAT_CUSTOMER_CLAIMED`). The credit limit is still one global number (checklist row "The repeat credit limit is global, not per customer") |
| Customer kinds | **Fixed in code**: two, `new` and `repeat` | `quote_customer_kind` enum, `20261016090100:36` |
| Quote policy: discount ceiling | **Column exists, not usable**: v1 offers no discounts | ADR 0019 decision 3; `t009-quote-integration.md:184` |
| Quote policy: tax mode | **Not an option**: `exclusive` only | `t009-quote-integration.md:63` |
| Quote policy: required inputs | **Partly an option**: for list-price quotes `delivery_state` is always required (a table check); `delivery_city`, `payment_terms`, `deadline` may be added. **For a manual-price quote nothing is asked**: `delivery_state` is optional (decided 2026-10-08, built in slice 2) | `20261016090000:31,225-226`; `manual-price-quote-plan.md` sections 23 (item 3) and 24 (CHOICE 4) |
| **GST rate and its effective date** | **Two places.** (1) **List-price quotes:** per price-list item (`tax_bps` on each item of a price-list version, which has its own effective date), unchanged. (2) **Manual-price quotes:** the policy carries ONE rate for every line, `gst_rate_bps` (0 to 2800), and `gst_effective_from`. **Since slice 2 the rate is a required choice with no default**: the policy create function refuses a policy without it, a manual quote is refused (SM217) if no rate is in force on the quote date, and the policy page has a "GST rate (percent)" field, empty at the start. Existing versions keep the rate they hold. A change is a new policy version. By item type or price band is **not built** (option 1 of section 4 was chosen); a business whose goods carry **different rates** cannot show them on one manual-price quote (see section 12.3); the accountant's answers are still awaited | `manual-price-quote-plan.md` sections 4, 22 (item 2), 23 (item 1), 24; `quote-policy-form.tsx:101-105`; checklist row "GST rates, GST slabs and freight rules are the owner's and the accountant's inputs" |
| Price lists (items, minimum order quantity, price breaks, GST per item) | **Exists** (versioned; plain page and CSV import on `main`) | ADR 0019; `docs/plans/price-list-csv.md` |
| **Item types** (the editable list, for example the family's 20 saree types) | **Exists as data and API; no page and no seed list.** Table `item_types` (code, name, position, active; the code never changes and a row is never deleted). Two routes: `GET /item-types` (Owner, Admin, Sales; a Viewer reads none) and `PUT /item-types/{code}` (Owner or Admin with the second factor, through `public.save_item_type`; no client write grant). **There is no web page to edit the list and no starter list**, so a new workspace has none until a page is built (the "list" slice). **Unlike the policies it is not versioned:** a save replaces the record in place (`save_item_type` updates the row), so the principle in section 2 (immutable versions) does not hold for it. **ACCEPTED by the owner.** Every change is audited: the trigger `audit_item_types` writes an audit event for each insert, update and delete, as the person who made it (**verified in the migration, `20261029090000:422`, and its tests**, pgTAP `67_manual_price_slice1` C70 and C71: a create and a real change are each audited once, as the actor, and an exact retry adds nothing). The fixed eight saree codes of the requirement vocabulary are separate (below) | `manual-price-quote-plan.md` section 22 (item 3); `20261029090000:381-470` |
| **Optional price range per item type** | **Stored and used.** Optional `min_price_paise` and `max_price_paise` (1 to 100,000,000, lowest not above highest). **DECIDED by the owner and built in slice 2:** a typed price outside the range gives a SOFT WARNING: the quote is made and saved as typed, the review flag `TYPED_PRICE_OUTSIDE_RANGE` is added, and the quote is flagged for the Owner (an Admin's approval is refused, SM218; CHOICE 2 in section 24). It never blocks and has no override flag. The slice 1 migration comments that say "refuse" are out of date; section 22 item 3 governs. The last-price warning (`last_price_warn_bps`) is **not built**. **There is no overall lowest and highest price in the policy**: only the per-type range exists | `manual-price-quote-plan.md` sections 6, 12, 17, 22 (item 3), 24; `20261029090000:472-498` |
| **Requirement codes** (saree type, fabric, colour, payment terms) | **Not a setting.** A fixed list in a migration, the same for every workspace, saree-themed; changing it is a deploy | `app.requirement_vocab`, `20261015090000:50-56`. The owner decided on 2026-10-08 to keep the eight codes and let only the manual quote use the family's list (`manual-price-quote-plan.md` section 20, item 3) |
| Follow-up cadence: gaps in days, maximum touches (1 to 100), quiet hours, allowed weekdays, holidays, minimum gap, recipient time zone offset | **Exists** (versioned; web policy form on `main`) | `followup_policy_versions`, `20261024090000:166-190` |
| Follow-up wording | **Not a setting.** Three closed English templates, extended by a migration and a reviewer who reads the language | ADR 0022 ("Deliberately not built"); checklist row "The draft wording is synthetic placeholder text" |
| **Quote languages** | **Not a setting and not built.** The quote text uses fixed English labels and does no translation; other languages are "not built" | `docs/plans/quote-text.md:43-44`; ADR 0022 line 92. The quote renderer is lane C's pinned package |
| Order policy: advance required, dispatch needs the advance, cancel window, zero-value orders | **Exists in the database and API; no web page** | `order_policy_versions`, `20261019090000:107-123`; checklist rows "Order policy has no page" |
| Mapper config (which catalog products a requirement may suggest) | **Exists, seeded only**, no page; matters for list-price quotes | `mapper_config_versions`, `20261016090000:243-256` |
| Business type / industry on the workspace | **Does not exist.** `tenants` has a name and a slug only | `20261004120000_t002_tenancy_schema.sql:60-67` |

**What is still not true of the brief after slice 3:** (1) item types exist as data and API but have **no web page and no starter list** (slice 4b); (2) the manual quote exists in the database and API but has **no web form** yet (slice 4a); (3) the GST rate for a manual-price quote is one policy rate, not a rule by item type or price band. The earlier worry about a 5 % database default is closed (slice 2 removed the default). Everything else in the brief's list now exists. This plan adds no money rule to any of it.

### 2.2 The hard part: the fixed requirement codes

The requirement vocabulary (eight saree types, eight fabrics, colours, payment terms) is fixed in a migration. A business that is not a saree business can only use the code `other` for a type. **A template for another business type therefore cannot change what the Requirement Agent proposes or what a person confirms**; it can only change the settings above. This is the largest limit on "any business" today, and it is why template 1 is the only validated one. Making the vocabulary editable per workspace would change the confirmation rule (SM210), the Requirement Agent, the mapper and their tests; the owner has already left that for later (`manual-price-quote-plan.md` section 20, item 3). **This plan does not propose it.**

## 3. Templates

A template is a **static, reviewed set of starting values for the forms in section 4.** It is shipped by us (as data in the repository), contains no tenant data and no personal data, and writes nothing by itself: choosing a template only pre-fills the forms on the screen. Nothing is stored until a person reviews each option and publishes (section 4). No templates made by users, and no sharing of one workspace's settings with another.

**Rules for every template:**
* A template never fills in a **GST rate, a money amount, a credit limit or a number of net days.** Those are always "the owner must choose" (the accountant for the rates). A pre-filled number would look like advice.
* A template may pre-fill the **shape**: which quote kind is offered, which optional inputs are asked, how long the follow-up cadence is, yes/no order-policy choices, and the order of screens. Each pre-filled value is shown as "suggested starting value" and must be confirmed.
* Only template 1 has been run by anyone (on synthetic data). Templates 2 and 3 are labelled **"Not validated"** on screen until a person who runs that kind of business has reviewed them (checklist row (c) below).

| | 1. Wholesale with repeat buyers (Customer Zero) | 2. Made-to-order service | 3. Retail with walk-ins |
| --- | --- | --- | --- |
| **Fits** | Family silk-saree wholesale: known buyers, repeat orders, price decided per customer, advance on new buyers, credit for repeat buyers | A business that builds or does a job to a customer's specification: the quote follows a requirement and a deadline | A shop customers visit; most buyers are one-off and may give no contact details |
| **Validated?** | The only one. Rehearsed end to end on **synthetic** data (`make rehearse-thin-slice`, `make rehearse-followups`); **never run with real data** (the real-data gate is closed) | **No.** Unverified fit | **No.** Weakest fit: the follow-up gate needs a contact with a phone, a suppression key and granted consent (`open-in-whatsapp-plan.md` section 5), so a walk-in with no contact cannot be followed up |
| **Pre-fills (suggested, owner confirms)** | Customer kinds shown: new and repeat (fixed). Quote kind: manual typed prices (once built; decided 2026-10-08) or list. Optional inputs asked: none beyond delivery state (see 2.1). Follow-up: a multi-step cadence shape and WhatsApp as a first-class channel. Order policy: advance choices shown with explanations. Item types: **an empty list** (the family's real list is entered by the owner, never shipped) | Quote kind: manual typed prices. Optional inputs asked: deadline. Follow-up: a shorter cadence shape. Order policy: advance-required choice highlighted as a question | Quote kind: list prices. Optional inputs: none. Follow-up: **off by default** (policy not published). Order policy: zero-value orders shown as a question |
| **Owner must choose (no default)** | Every GST rate (accountant) and its effective date; validity days; new and repeat advance; new and repeat net days; repeat credit limit; seller state; rounding mode; each follow-up gap, quiet hours, weekdays, holidays; item types and any price ranges | Same list, plus how to price a custom job (a person types it; no rule is offered) | Same list; and whether to quote at all or keep to price list lookups |
| **Cannot be offered by any template** | Another country, tax-inclusive prices, discounts, a margin rule, languages other than English, a different requirement vocabulary (section 2.2) | Same | Same |

The 3 templates are an example set the owner asked for. Whether template 3 stays in the list is an open question (section 8, no. 8).

## 4. Setup flow

The screens, in order. Each screen reads and publishes through an **existing** definer function; the API never decides and the database re-checks (CLAUDE.md non-negotiables). The setup is a **checklist of independent publishes**, not one transaction: the quote policy, the price list (or item types), the follow-up policy and the order policy are separate versions today, and each is created whole. A half-finished setup is therefore possible and is shown honestly as "not ready".

1. **Pick a template**, or "start blank". Shows the template's fit, whether it is validated, and what it will pre-fill. Nothing is saved.
2. **Business basics.** Workspace name (exists). Seller state (required by the quote policy). Currency is shown as INR and cannot be changed.
3. **Item types** (the table and routes exist; the screen does not, section 7): add, rename, order, switch off; an optional lowest and highest price for each. A typed price outside the range gives a soft warning and flags the quote for the Owner (question 14); it never blocks. For a list-price business this screen is the price-list import instead (exists).
4. **Tax.** The GST rate, entered by the owner from the accountant's answer, on the quote policy page (the field exists). **No default**: the field starts empty and the database refuses a policy without it. The rate has a start date; before that date the database returns no rate and a manual quote is refused, nothing is guessed (`app.quote_gst_bps_on`). Per-item-type or per-price-band rates are not built.
5. **Payment terms.** Validity, advances, net days, credit limit, rounding. Each has a one-line plain explanation and a worked **synthetic** example.
6. **Follow-up.** Cadence, quiet hours, weekdays, holidays. Skippable; skipping means no lead appears on the due list (the page already says so).
7. **Orders.** The order policy (needs a web page; none exists today).
8. **Review.** One page showing every chosen option next to what is in force now (empty for version 1), with the fields the owner must still choose highlighted. A confirmation that the owner has had the rates and terms checked by their accountant is recorded as the owner's statement. It is a claim, not proof, like the references on the real-data gate (ADR 0015).
9. **Preview a sample quote with SYNTHETIC data.** The page runs the pinned engine and the pinned text renderer on invented lines and the draft values, and shows the text a customer would get, with a banner: "Preview. Not a quote. Synthetic data." It writes nothing: it takes no quote number and creates no row. No endpoint for this was found; it would be a new stateless API route (size M). **Unverified** whether the pure packages can be called with draft, unpublished values without going through the database path; the preview must never replace the database's own recomputation on a real quote.
10. **Publish version 1.** Owner or Admin with the second factor, one publish per setting. After each, the checklist shows what is in force.

### What must be true before a business can send its first quote

Read from the code and the existing plans; "send" means a person sends by hand, because the system sends nothing.
* A **quote policy in force** with a GST rate whose start date has come (a manual-price quote is refused without it: SM217); a **price list in force** for list quotes, or **active item types** for manual quotes. A manual quote can be made through the API today; the web form for it is slice 4a.
* A signed-in Owner or Admin who has **enrolled the second factor**, because approving a quote needs it (ADR 0016, ADR 0019 decision 5).
* A **lead with an enquiry**, and a confirmed requirement (list kind) or typed lines (manual kind, proposal in `manual-price-quote-plan.md` section 21).
* To record that it was sent and to start the follow-up clock: a **contact with a phone, a suppression key and granted consent** for the channel (`open-in-whatsapp-plan.md` section 5). A follow-up policy is not needed to record a touch but is needed for the lead to appear on the due list (same document, section 7).
* While the real-data gate is closed, **all data must be synthetic.** Opening the gate needs four prerequisites, one of which is the DPDP review (ADR 0015).
* The quote's policy and price list must not be replaced between drafting and approving, or the draft is stale (SM215). Publishing a new version makes every open draft stale; the screen must say so before publishing.

## 5. Support-team access

**Status: PROPOSAL. Nothing exists. It needs a DPDP review and a lawyer's view before any real use** (rows (a) and (b) in section 9). Nothing here is a claim that the model is lawful.

**Today.** Our own people reach a workspace in two ways, neither a support feature: the **operator** runs SQL as the database owner (`app.operator_add_member`, with a reason recorded; ADR 0015, `members-and-invitations.md` section 1), or an Owner or Admin adds a member. The operator route is standing, not time-limited, and the workspace owner cannot see it except through the audit rows those functions write.

**Proposal: a support grant.**
1. **Granted by the business Owner**, with the second factor, to one named support account, for **one workspace only**. The grant records the reason and the scope.
2. **Time-limited.** It has an expiry set by the Owner within a maximum (recommended: default 72 hours, maximum 7 days; the owner of the product decides). **No standing access, no automatic renewal:** a longer job is a new grant by the Owner. The Owner can revoke at once.
3. **Expiry is enforced by the database,** in the same helper that decides which workspaces a person belongs to (the RLS helper, ADR 0004), not by the API or the screen. After expiry the account has no rows, no matter what the app does.
4. **Same RLS, one workspace.** The grant behaves like a membership of exactly one tenant and passes through the same policies and definer functions as any member. There is no cross-tenant read or write path, no service-role key, and no bypass. A support account with grants in two workspaces holds two separate grants; one never widens the other.
5. **The API never decides.** The API passes the support person's own token; the database checks the grant, the role, the second factor and the scope every time (the rule behind the whole product, CLAUDE.md non-negotiables 1 and 2, ADR 0002).
6. **Narrow scope, recommended: setup only.** A support grant may read and publish the setup settings of section 2.1 and nothing else. It does **not** read contacts, leads, enquiries, quotes with customer details, orders or evidence; and it **cannot** erase, export, change members or roles, create or change another grant, open the real-data gate, or use an agent. Reason for the narrow scope: reading customer data is not covered by the audit log today (the checklist row "(a) `blind=false` is logged, not audited in the database" under "Lead review" says the same: a READ is logged, not audited in the database), so a broader grant would be unaudited access to personal data.
7. **Every support action is logged and visible to the Owner.** Each write records the support account, the grant, the workspace, the action and the time, in the same audit table, marked as made under a support grant. The Owner gets a page listing them. The log is append-only in the same way as the rest of the audit log, which is "append-only style, not tamper-proof" (checklist row "Audit is append-only style"): a person with database-owner power can still change it.
8. **Support accounts are named and individual** (no shared login), need the second factor to write, and are created only by us.
9. **A grant cannot be used inside an agent run** (the same boundary test style as ADR 0013 and the manual-quote plan, section 14).

**What this does not do.** It does not restrict a person who holds the database owner role (`postgres`, `BYPASSRLS`: checklist row "BYPASSRLS dependency"). The operator route stays; this proposal only gives the business owner a visible, time-limited, narrower path for ordinary setup help. The real-data gate still applies per workspace: while it is closed, a support person sees only synthetic data.

**Questions for counsel (none answered here; all unverified):** whether a support person acting on the owner's grant is processing on the owner's behalf, what notice staff and customers of the business need, how long support logs may be kept, whether logs that name a support person are themselves personal data, and whether support from outside India is a cross-border transfer. The checklist already lists the DPDP review as an open prerequisite (rows "DPDP legal review" and "India-qualified legal review").

## 6. What must NOT be an option, and the risks of too much flexibility

### 6.1 Never an option (a template, a setting or a support person cannot change these)

* Turning off human approval of a quote or of any message; **automatic sending** of any kind; automatic first contact (`manual-price-quote-plan.md` section 19).
* Who may type or approve a price; lowering the second-factor requirement; role permissions.
* Any **tax rate pre-filled** by us; tax-inclusive mode; another country's tax; HSN or similar rules until the accountant has answered.
* Any new **money rule**: discounts, margin floors, tiered or per-customer prices, a new rounding mode, a formula typed by a user.
* A price, a rate, a credit limit or payment terms **suggested or set by a model.** An agent may suggest as text only; a person types (manual-quote plan section 14, CLAUDE.md non-negotiable 4).
* Switching off the **consent, suppression, erasure or quiet-hours gates**; opening the **real-data gate**; the retention of audit rows. (The quiet-hours *values* are the owner's; the gate is not.)
* Agent switches, spend caps and allow-lists (operator-only today, ADR 0013).
* Custom code, custom scripts, free SQL, webhooks, or any generic tool (CLAUDE.md: least privilege, "no generic SQL shell").
* Editing or deleting a published version; back-dating an effective date.
* A currency other than INR; a language other than English in a customer message (not built).
* A template that reads another workspace, or a setting shared across workspaces.
* A permanent support grant, or a support grant to more than one workspace.

### 6.2 Risks of too much flexibility

| Risk | How it happens | What the design does about it |
| --- | --- | --- |
| **Wrong tax** | A template or a hurried owner puts a plausible-looking GST rate on a quote; the customer is charged wrongly | No template pre-fills a rate. **Closed in slice 2:** the database no longer defaults the policy rate (it was 5 % in slice 1); the policy page field starts empty and a policy without a rate is refused. The review screen shows each rate with its effective date and the owner's recorded statement that the rates were checked. A synthetic worked example is shown, never a real figure. The risk is reduced, not removed: the database proves the arithmetic, not that the rate is the right one (ADR 0019, "honest limits"). **Still open:** one rate on a manual-price quote cannot show goods at different rates (section 12.3, question 5) |
| **Wrong credit terms** | An owner copies net days or an advance from a template; the credit limit is one global number for all repeat buyers | No template pre-fills money or days. The page states in plain words that the limit is global, not per customer. The screen shows what a new quote would say |
| **Confusing the owner** | Many options, saree-themed words, six independent versions, drafts going stale | Few options per screen; plain words; "suggested" versus "you must choose"; a ready/not-ready checklist; the word "item type" everywhere new (section 9); a warning before publishing that open drafts become stale |
| **False sense of readiness** | A template labelled for a business type is mistaken for something checked | Every template other than 1 is marked "Not validated"; none is shown until a person who runs that business has reviewed it (row (c)) |
| **Support access misused or over-broad** | A support person reads customers' data, or access lingers | Section 5: one workspace, setup-only scope, database-enforced expiry, visible log, legal review first |
| **Settings drift from the pinned engines** | A setting offers a value the engine or the database refuses | Options are limited to what the database accepts today; any new option needs its own ticket and its own equivalence proof |

## 7. Phasing

| When | What | Size |
| --- | --- | --- |
| **Now: almost nothing new.** | This plan. **Done and on `main`:** slice 1 (net days per customer kind, the policy GST rate and date, `item_types` with an optional range), slice 2 (the manual kind in the database, GST rate required, the range as a soft warning) and slice 3 (the API for manual quotes). **Next from `manual-price-quote-plan.md`, not by this plan:** slice 4a (quote form and view) and 4b (item-types admin page and a starter list). **Not built and not planned for now:** a GST rule by item type or price band. What comes after 4a and 4b to reach "a new owner can finish setup alone" is section 12.7 | S, optional |
| **Waits until a second business type is real** (an actual person who will use it) | The template data format and the picker (step 1). The review page (step 8). The sample-quote preview route (step 9, M). An order-policy page (step 7). A rule for how a second type shows its requirement words. Support grants (section 5), because a second business means someone other than us needs help | M each; support grants L |
| **Waits for real pilot data** | Which options the family actually changed from the starting values; which ones nobody touches (remove them); the real values for policies; whether template shapes (cadence length, required inputs) fit a second business; the editable requirement vocabulary (largest change; its own ticket) | decided from the Customer Zero four-week measurement |
| **Waits for the external-customer gates** | Any business other than the family on the hosted system. Gates already on the checklist: option B (a dedicated agent and signing principal), the DPDP review, rate limiting, a tenant export and deletion workflow, the daily cost cap moving to operator-only | not scheduled |

**Naming. Decided and done:** the table is `item_types` (slice 1) and the quote-line column is `item_type_code` (slice 2, `quote_lines.item_type_code`). The fixed requirement codes (`saree_type` in `app.requirement_vocab`) are not touched.

## 8. Open questions for the owner (each with my recommended answer)

1. **Scope of "any business".** Does it mean: India, rupees, GST added on top, and a business that quotes, follows up and collects payment? **Recommend yes.** Anything else is a separate ticket.
2. **Rename `saree_types` to `item_types`?** **DECIDED and DONE:** the table is `item_types` and the quote-line column is `item_type_code`. The fixed requirement codes stay as they are.
3. **Fixed requirement vocabulary for non-saree businesses.** Keep the eight saree codes and the code `other` until a second business is real, or make the vocabulary editable now? **Recommend keep the fixed codes** (the owner already chose this on 2026-10-08); a manual quote line uses the item-type list and does not need the vocabulary.
4. **Templates: who makes them?** Only we make them, as static reviewed data in the repository. **Recommend yes.** No user-made templates and no sharing between workspaces in version 1.
5. **Does choosing a template write anything?** **Recommend no:** it only pre-fills the screens; nothing is stored until the owner publishes each setting. This keeps "no hidden autonomy".
6. **Do templates pre-fill any money, tax or day count?** **Recommend never.** Structure and yes/no choices only, shown as "suggested".
7. **Setup as independent publishes or one atomic "publish setup"?** **Recommend independent publishes with a ready/not-ready checklist.** It reuses the existing functions and is smaller; an atomic bundle needs a new security-sensitive function.
8. **Keep template 3 (retail with walk-ins)?** **Recommend drop it from the first list.** The product cannot follow up a buyer who gives no phone or consent, so the fit is unverified and weak. Keep templates 1 and 2, mark 2 "Not validated".
9. **Support grant limits.** Who may grant, how long, what scope? **Recommend:** Owner only, with the second factor; default 72 hours, maximum 7 days; scope setup-only (section 5, item 6); named support accounts with the second factor; the log visible to the Owner and Admin. And **recommend no real use before counsel has reviewed it.**
10. **The sample-quote preview.** A stateless route that runs the pinned engine and renderer on synthetic lines and draft values (size M), or a fixed screenshot-style sample? **Recommend the stateless route,** but only after the engine confirms it can run on unpublished values (unverified); until then show a static sample.
11. **Who reviews template 2?** Row (c) needs a person who runs that kind of business. **Recommend** the owner finds one real person before template 2 is shown to anyone; until then it is hidden.
12. **When to build any of this beyond the existing plan?** **Recommend not before the Customer Zero four-week measurement ends,** except the optional read-only checklist page.
13. **The database defaulted the policy GST rate to 5 %.** **DECIDED and DONE:** slice 2 made `gst_rate_bps` a required choice with no default; the policy page has the field, empty at the start; old versions keep their stored rate (`manual-price-quote-plan.md` sections 23 and 24).
14. **The item-type price range: refuse or warn?** **DECIDED by the owner:** a typed price outside an item type's range gives a **soft warning** and **flags the quote for the Owner at approval**. It never blocks and has no override flag. The database function (`app.price_outside_range`) only returns true or false. The slice 1 migration comments and `manual-price-quote-plan.md` section 22 item 3 still say "refused ... no override"; lane A will correct them.

## 9. Naming rule

* **New code, tables, columns, API routes, tests, docs and UI text say "item type", not "saree".** Example: "item type", "item types", `item_type_code`, "Add an item type".
* Existing names stay as they are until a deliberate rename: `app.requirement_vocab('saree_type')`, the eight codes, the family's own words in their data. Do not rename them as a side effect of other work.
* The table is `item_types` and the quote-line column is `item_type_code` (open question 2); the older sections of `manual-price-quote-plan.md` still use the old words.
* The family's own item names are data entered by the owner, not code, and are never committed to the repository.
* Words a non-saree owner would not know ("requirement", "SKU", "basis points", "RLS", "aal2") do not appear on setup screens; use plain words ("what the customer asked for", "product code", "percent").

## 10. What was added to the pre-pilot checklist

Three unchecked rows were added to `docs/pre-pilot-checklist.md`, under "Business setup and templates (plan, 2026-10-08)":
* (a) the support-access model reviewed by counsel;
* (b) the support-access audit log visible to the owner;
* (c) the template defaults reviewed by a person who runs that kind of business.

## 11. Conflicts found with this direction

1. **Mostly resolved by slices 1 and 2:** net days per customer kind, `item_types`, and a GST rate with an effective date (required, no default) now exist. What remains different from the brief: item types have no page and no starter list (slice 4b); the manual quote has no web form (slice 4a); the policy GST rate is one rate for manual-price quotes only (list quotes keep the rate per price-list item).
1a. The slice 1 migration comments say a price outside the item-type range is "refused"; the owner decided, and slice 2 built, a soft warning that flags the quote for the Owner (question 14). Section 22 item 3 of the manual-price plan governs.
2. `docs/product.md` plans external pilots as "same core, configured industry pack" and `docs/plans/roadmap.md` is local-first with synthetic data only. Self-setup by any business is the **external-customer** stage, which the checklist gates behind option B, the DPDP review, rate limits and export/deletion. This plan keeps those gates.
3. The requirement vocabulary is fixed and saree-themed (section 2.2); "any business" is limited by it until a later ticket.
4. "Support team access" overlaps the existing **operator** path (ADR 0015), which is standing and not owner-visible. The proposal adds a narrower path; it does not remove the operator route.
5. The "Owner role is never granted through the app" rule (`members-and-invitations.md` 3.1) stays: a support grant is never an Owner membership.


## 12. Self-serve setup in the website

Written 2026-10-09. **Owner direction, verbatim:** "all these setup should be done in the website, because its not pre built, each and everything should be setup in the live website, when the customers (parents) log in, we are also planning to give free trial to construction field, paver block stones, our websites should be able to setup according to their needs, we will provide separate service, if they dont know how to setup."

So: nothing is set up for a business in advance. The owner logs in, follows a checklist, and the website writes their settings. A paid setup service helps those who cannot. This section adds to sections 3 to 5; where it differs, this section governs. **PLAN ONLY.** Every rate, price, unit and name below is a **synthetic placeholder or an unvalidated guess**. Nothing here is tax or legal advice.

### 12.1 The first-login setup flow

A guided checklist, one step at a time, titled "Set up your business". It is a new page. **It does not exist today.** The tenant page has plain links to each screen (`apps/web/app/app/tenants/[tenantId]/page.tsx`) and nothing tells a new owner what to do first.

**Progress is saved by the database, not by the page.** Each step writes a published version (or a row) through an existing function. The checklist then **reads what is in force** and ticks the step. Close the browser and come back: the ticks are still there, because they come from the data. A half-typed form is not saved on the server (it stays in the browser at most). I recommend no new "progress" table (question 1).

| # | Step | What it writes | Screen today? |
| --- | --- | --- | --- |
| 1 | **Create the workspace** (name) | `tenants` (name and slug); the creator becomes Owner | **Yes.** `CreateTenantForm` on the workspaces page |
| 2 | **Turn on the second factor** | Supabase Auth factor. Every publish below needs it (aal2) | **Yes.** `/app/security`, `/auth/mfa` |
| 3 | **Quote policy**: days a quote is valid, advance for new and repeat customers, days to pay for new and repeat customers, **GST rate and its start date**, most credit for a repeat customer, the shop's state, discount ceiling (saved, changes no quote), "Shipping: none" | one `quote_policy_versions` row | **Yes.** `/quote-policy` (the GST field was added in slice 2). The start date field is "Starts on" |
| 4 | **Item types**: name, order, active or not, optional lowest and highest price for each | `item_types` through `public.save_item_type` | **API yes** (`GET /item-types`, `PUT /item-types/{code}`). **No screen. No starter list.** Slice 4b |
| 5 | **Price list** (only for a business that quotes from a list): items, prices, minimum order quantity, price breaks, GST per item | `price_list_versions`, items, breaks | **Yes.** `/price-list` (paste or import a CSV), and `/products/new` |
| 6 | **Delivery rules** | Nothing to write today. The shop's rule is "no courier charge": the policy page fixes shipping at none and a manual quote has no delivery line. `delivery_state` is optional on a manual quote | **No screen, and no delivery or freight rule exists** (see 12.3 and question 6) |
| 7 | **Follow-up**: touches at most, days between touches, quiet hours, weekdays, holidays, minimum gap, time zone offset | one `followup_policy_versions` row | **Yes.** `/followups/policy` |
| 8 | **WhatsApp wording** | Nothing. The follow-up messages are three closed English templates in a migration (`followup_templates`); the quote text is written by the pinned renderer | **No screen and not a setting.** Changing the wording is a migration plus a person who reads the language (ADR 0022). See question 7 |
| 9 | **Order rules**: advance required, dispatch needs the advance, how long an order may be cancelled, zero-value orders | one `order_policy_versions` row | **Database and API yes. No screen** (checklist row "Order policy has no page") |
| 10 | **First customer and consent** | `contacts`, a lead, a consent record, a suppression key | **Yes.** `/customers/new`, the consent page, `/suppression` |
| 11 | **Ready check and a sample quote** | Nothing (read only). Shows what is in force, what is missing, and a quote text made from invented data | **No.** Sections 4 (steps 8 and 9) and 12.7 |

**Order.** Steps 1 to 3 first and always. Then 4 or 5 (a business uses item types, a price list, or both). Steps 6 to 9 may be skipped to send a first quote; step 7 is needed for a lead to appear on the due list. Step 10 is needed to record that a message was sent. A skipped step stays visibly "not done"; nothing is hidden.

**A published version cannot be edited.** If the owner makes a mistake they publish a new version. A new policy version makes every open draft quote stale (SM215), and the page must say so before publishing. `item_types` is the exception: a save replaces the row, and every change is audited (section 2.1).

**What the checklist never does:** it does not publish for the owner, fill in a number, or move on by itself. Each publish is the owner's click, with the second factor (CLAUDE.md: no hidden autonomy).

### 12.2 The paper values sheets and the screens

Customer Zero's setup values were collected on **paper values sheets**. **The sheets are not in this repository** (other plans say private material is kept in the private repository), so I did not read them and **I cannot map them row by row**. I have not guessed their rows. The only trace of their content here is one line in `manual-price-quote-plan.md` section 12, item 3: the sheet asks for an optional price range for each type, and also an overall lowest and highest price.

What I can do is list **every field the screens have**, so each sheet row can be ticked against it. The planner or the owner fills the left column from the private copy.

| Sheet row (fill in from the private copy) | Screen field that takes it | Exists? |
| --- | --- | --- |
| *(to fill)* | Quote policy: Starts on; Days a quote is valid; Advance for a new customer (percent); Advance for a repeat customer (percent); Days to pay: new customers; Days to pay: repeat customers; GST rate (percent); Most credit for one repeat customer (rupees); State where the shop is; Discount ceiling (percent) | Yes |
| *(to fill)* | Item type: name; order; active; lowest price; highest price (one set per type) | Table and API yes; screen no |
| *(to fill)* | Price list: sku, name, price, minimum order quantity, price breaks, GST per item | Yes |
| *(to fill)* | Follow-up: Starts on; Touches at most; Days to wait before each touch; Quiet hours start and end; Weekdays; Holidays; Minimum gap in hours; the recipient's UTC offset | Yes |
| *(to fill)* | Order rules: four choices | No screen |
| *(to fill)* | **Overall lowest and highest price** | **No field.** The policy has no overall range; only the per-type range exists (question 8) |
| *(to fill)* | **Delivery or courier** | **No field.** None by design for Customer Zero |
| *(to fill)* | **WhatsApp wording** | **No field.** Not a setting |
| *(to fill)* | **A different GST rate for a type** | **No field.** One rate on a manual quote; per-item rate only on a price list |

**When a sheet can be retired.** A sheet is retired when (1) every one of its rows has a row in the table above, (2) the owner has entered all its values through the screens in one sitting, and (3) the "what is in force" page shows them. A sheet row with no screen field is a **gap**, listed to the owner; it is not retired by deleting the row. Keep the paper until then.

### 12.3 Draft templates for new business types (DRAFT ONLY)

These two are **first guesses to start a conversation with a real owner**. They are not validated. **Every line is an unvalidated guess and needs a real owner in this field.** No GST rate is stated for any line; for every line it is **accountant to confirm**. They follow the template rules in section 3: a template only pre-fills the screens, it writes nothing, and it never fills a rate, a price, a credit limit or a number of days.

**Things the product cannot do today, which matter for both (read first):**
* **Units.** The product knows only `piece` and `set` (`quote_sale_unit`). An item type has **no unit**. A quantity is a whole number from 1 to 10,000 and a unit price is at most ₹10,00,000. So "per sq ft", "per tonne" or "per load" can only be written **in the item type's name** ("Paver block 60 mm, per sq ft"), the quantity is a whole number of that unit, and a half tonne or 2.5 sq ft is not possible. This is a real limit for both guesses (question 4).
* **One GST rate per manual-price quote.** If the goods carry different rates, a manual-price quote cannot show them. A **price-list quote** can (each item has its own rate). Accountant to confirm whether the rates differ (question 5).
* **No delivery or freight line.** A manual quote has no courier line by design; there is no rule for a delivery charge by distance, load or weight (question 6).
* **No quantity calculator.** The product does not work out how much material a job needs; a person types the quantity.
* **The requirement words are fixed and saree-themed** (section 2.2). These goods can only use the code `other` there, so a person types the lines.

**(a) Construction supplies (a dealer selling building materials to contractors and builders)**

| Line | Guess | Status |
| --- | --- | --- |
| Item types | Cement; steel bars; sand; stone chips (aggregate); bricks; concrete blocks; fittings and small items. Probably many more | Unvalidated guess, needs a real owner in this field |
| Unit | bag (cement); kg or tonne (steel); load or tonne (sand, chips); piece (bricks, blocks, fittings) | Unvalidated guess, needs a real owner in this field |
| Priced how | A price per unit, probably changing often (daily or weekly). A typed price per quote fits; a long price list that goes stale does not | Unvalidated guess, needs a real owner in this field |
| Quote kind | Manual-price for a few items at one rate; **price-list** if the goods carry different rates | Unvalidated guess, needs a real owner in this field |
| Buyers | Contractors who buy again and may buy on credit: "repeat" with days to pay and a credit limit fits; walk-in buyers do not (section 3, template 3) | Unvalidated guess, needs a real owner in this field |
| Delivery | Often by truck to the site, with a charge by distance or load, and sometimes unloading. No rule exists. A stopgap is an item type called "Delivery" with a typed price | Unvalidated guess, needs a real owner in this field |
| GST notes | Whether goods carry one rate or several, and what applies to transport: **accountant to confirm.** No rate is stated here | Unvalidated guess, needs a real owner in this field |

**(b) Paver blocks and stone (a maker or dealer of paver blocks, kerb stones and paving stone)**

| Line | Guess | Status |
| --- | --- | --- |
| Item types | Paver block by thickness and shape; paver block by colour or grade; kerb stone; grass paver; paving stone or slab; delivery | Unvalidated guess, needs a real owner in this field |
| Unit | sq ft (or sq m) for pavers; piece for kerb stones; load or truck for delivery. Pallet or bundle for dispatch | Unvalidated guess, needs a real owner in this field |
| Priced how | A price per sq ft by thickness or colour, probably lower for a larger area. **A quantity break by area would be a price break, which only a price list has** | Unvalidated guess, needs a real owner in this field |
| Quote kind | Price-list if the range is stable and breaks matter; manual-price for a custom job | Unvalidated guess, needs a real owner in this field |
| Buyers | Builders, contractors and homeowners; many one-off buyers (consent and a phone are needed to follow up, section 3 template 3) | Unvalidated guess, needs a real owner in this field |
| Delivery | By truck, charged by load or distance, and perhaps unloading or laying as a separate service. No rule exists. Laying is a service, not goods | Unvalidated guess, needs a real owner in this field |
| GST notes | Goods and a laying service may be taxed differently: **accountant to confirm.** No rate is stated here | Unvalidated guess, needs a real owner in this field |

Each of these stays hidden from every workspace until a real owner in that field has reviewed it (checklist row (c) in section 10). The names above would only ever be pre-filled as suggestions the owner edits; no price comes with them.

### 12.4 Free-trial boundaries (all gated, none built)

A free trial is a **business that is not the family, signing up to try the product**. That is the external-customer stage (section 11, item 2), and **nothing needed for it exists**.

**What must exist first (every one is open):**
* **A live website.** Nothing is deployed (T012, the Customer Zero stage). Hosting, the hosted verifier, SMTP and the domain are open checklist rows.
* **A domain** and working e-mail for confirmations and password reset.
* **A way into the trial.** Sign-up is closed today (the hosted verifier checks that it is) and a person joins only by an operator or an invitation. A trial needs an owner-approved way in.
* **Legal terms.** Terms of use and a privacy notice that name WhatsApp and Meta; the DPDP review is an open prerequisite for the real-data gate. Counsel's view is needed. This plan does not claim anything is compliant.
* **Billing**, for when a trial ends and someone pays. None exists. A free trial can start without it; keeping the customer cannot.
* **Export and deletion of a trial workspace** when it ends (checklist row "Tenant data export and deletion workflow").
* **The external-customer gates** already on the checklist: a separate agent and signing identity (option B), rate limits, the daily cost cap not raisable by the tenant, and the support-access model (section 5).

**What a trial business could do** once those exist, and only with **synthetic data** unless the real-data gate is opened for that one workspace: follow the checklist, set up policy, item types and price list, make and approve sample quotes, look at the follow-up screens.

**What a trial business cannot do:**
* Enter **real customer names, e-mails or phone numbers.** The real-data gate is per workspace, closed by default, and opening it needs four prerequisites including the DPDP review and a restore drill, and it is opened by the operator one workspace at a time. **That does not scale to many trials**, and is the main reason to start with a synthetic-only trial (question 2).
* Have anything sent by the system. The system sends nothing; "Open in WhatsApp" needs a real number, and a `+00` number is not a real chat.
* Use agents or model calls. They are off by default, paid, and need the owner's written approval, a provider cap and a price row.
* Edit the requirement words or the follow-up wording, change tax mode, or get another currency or language (section 6.1).

**Recommendation: validate ONE extra business type with ONE real owner before opening any trial to many.** Pick the one where you can name a real owner today. Do the whole of section 12 for that business alone, with that owner, and with their accountant. Only after that, decide whether to open a trial. A trial of several unvalidated types would be a test of the templates on strangers.

### 12.5 The paid setup service

A support person helps an owner who cannot set up alone. It rests on section 5 and **cannot start on a real workspace until counsel's review of support access and the owner-visible access log both exist** (checklist rows (a) and (b)).

**What the support person does** (with the owner's time-limited grant, one workspace, setup scope only):
* Sits with the owner and walks the checklist (12.1), working on the same screens the owner uses.
* Helps the owner pick item types and write their names; enters the values the owner (or their accountant) gave **in writing**.
* Runs the sample quote and the ready check with the owner and explains each line in plain words.
* Tells the owner when a step needs their accountant, and waits.

**What a support person can NEVER do** (section 6.1 applies in full):
* **Choose or suggest a GST rate, a price, a credit limit, an advance or the days to pay.** They enter only what the owner gave them. The log says "entered by support".
* Read **customers, contacts, leads, enquiries, quotes with customer details, orders or evidence.**
* Make, approve, withdraw or send a quote or a message; record a sent message.
* Erase, export, change members or roles, **grant or extend access**, open the real-data gate, switch on an agent.
* Work outside the grant window or on another workspace, or share a login.
* Remove an entry from the access log.

**Until counsel has reviewed it,** the service is **advice with no access**: the support person talks the owner through the screens (a call or a screen share) and the owner types. That needs no new feature. Every setup on a real workspace should wait for the real-data gate anyway.

**Dependencies:** counsel's review of the grant model (row (a)); the owner-visible access log (row (b)); named support accounts with the second factor; the grant, its database-enforced expiry and the log page (section 5, size L); and a clear written scope the owner sees before they grant.

### 12.6 What changed since this plan was first written

Slices 1, 2 and 3 of the manual-price quote are on `main`. In short: net days are per customer kind; the policy has a **required** GST rate and start date with no default (used by manual-price quotes only); `item_types` exists with an API and an optional range; a manual quote exists in the database and API, with the price range as a soft warning. **Still not built:** the web form for a manual quote (4a), the item-types page and starter list (4b), an order-policy page, the checklist, the ready check and the sample quote. See sections 2.1 and 7.

### 12.7 Build order after slice 4

Slice 4a is the quote form and view. Slice 4b is the item-types admin page. To reach **"a new owner can finish setup alone"**, the next slices are these. Sizes are my estimates.

| Order | Slice | Why | Size |
| --- | --- | --- | --- |
| 1 | **4a, 4b** (planned in `manual-price-quote-plan.md`) | A manual quote and the item-types list can be used from the screens | M each |
| 2 | **Setup checklist page** ("Set up your business"), reached from first login and from the tenant page. Reads what is in force for steps 1 to 10. No database change. If a read for the order policy or the shop's price list is missing, add a read-only API route (**unverified** which exist) | A new owner knows what to do first, and progress is saved because it comes from the data | S to M |
| 3 | **Order policy page** | Step 9 has no screen; orders cannot be set up by the owner | M |
| 4 | **Draft templates as suggestions** (section 12.3): a static list that pre-fills the item-type form, hidden until a real owner has reviewed it | Saves typing; keeps the "template writes nothing" rule | S |
| 5 | **Ready check and the sample quote** (steps 8 and 9 of section 4): a stateless route running the pinned engine and renderer on invented data | The owner sees a quote before a customer does | M |
| 6 | **Decisions that may need a migration**, only if the first extra owner needs them: a unit on item types; an overall price range; mixed GST rates on one quote; a delivery charge; owner-editable wording (questions 4 to 8) | They add a rule or a money path, which is a product change | M to L each |
| 7 | **Support grant and the access log page** (section 5) | Before any paid setup service on a real workspace | L, then M |
| 8 | **Trial gates** (section 12.4): live site, domain, entry path, terms, billing, export and deletion | Before any trial | separate tickets |

**"Finish alone" is reached after items 1 to 3**, with 4 and 5 for comfort. Steps 6 to 8 of the flow (delivery, wording, and the paid service) are not needed to send a first quote.

### 12.8 Open questions for the owner

1. **Where is setup progress kept?** **Recommend derived from the data** (what is published and in force); no new table. A skipped step simply stays "not done".
2. **Trial: synthetic-only first, or real data per workspace?** **Recommend a synthetic-only trial first.** It needs no DPDP-reviewed gate per business and lets an owner set up and see a quote. Real data comes only for one validated business after the gate is opened for it.
3. **Which one extra type, and which real owner?** Construction supplies or paver blocks? **Recommend the one where you can name a real owner and their accountant this month,** and build nothing for the other until then.
4. **Units for goods sold by sq ft, tonne or load.** Add a unit to item types, or keep the unit in the item type's name? **Recommend keep it in the name** for the first extra owner (no change to the engine or the database); revisit if that owner needs a fractional quantity. Whole-number quantities and a ₹10,00,000 ceiling per unit price stay.
5. **A business whose goods carry different GST rates.** **Recommend: it uses price-list quotes** (a rate on each item) and not manual-price quotes, and the accountant confirms the rates. Do not build a rate by item type until a real owner needs it.
6. **Delivery or freight.** **Recommend no delivery rule yet.** If the accountant confirms the tax treatment, use an item type "Delivery" with a typed price as a stopgap. A rule by distance or load is a new money rule (a non-goal of section 1) and its own ticket.
7. **WhatsApp wording owned by the business.** **Recommend not yet.** Keep the closed wording and the migration plus a reviewer who reads the language until counsel has said how a business's own wording should be approved.
8. **An overall lowest and highest price** (the sheets ask for it, 12.2). **Recommend no new field;** the per-type range covers it. If the owner wants one, it is a small policy field and a migration.
9. **Paid setup service before counsel's review.** **Recommend advice with no access only,** on synthetic workspaces; no grant on any real workspace until rows (a) and (b) are closed.
10. **When may the paper sheets be thrown away?** **Recommend** after one sitting in which the owner enters every row through the screens and the "what is in force" page shows it, and after the gaps in 12.2 are decided. Keep the sheets until then.
11. **Template names shipped as suggestions.** **Recommend names only, never a price or a rate,** pre-filled in the form and written only when the owner publishes, and hidden until a real owner has reviewed them.
12. **Trial length, price after the trial and billing.** **Not mine to recommend.** Decide with the legal terms; build no billing before the live site exists.

### Rows for the checklist

For the planner to merge into `docs/pre-pilot-checklist.md` (not edited here). All unchecked.

| | Item | Source | Gate | Phase |
| --- | --- | --- | --- | --- |
| [ ] | **Self-serve setup flow built and walked by a new owner alone.** The checklist page, the item-types page, the order-policy page, and a ready check; a person who has never seen the system finishes steps 1 to 5 without help. | business-setup plan 12.1, 12.7 | **Before any second business** | Later |
| [ ] | **Paper values sheets retired.** Every sheet row has a screen field, the owner entered all values through the screens in one sitting, and the gaps (overall price range, delivery, wording, a rate per type) are decided. | business-setup plan 12.2 | **Customer Zero** | Before real data |
| [ ] | **Draft templates for construction supplies and paver blocks reviewed by a real owner in each field, and their GST treatment confirmed by an accountant.** Hidden until then. | business-setup plan 12.3 | **Before a second business type is offered** | Later |
| [ ] | **Units, mixed GST rates and delivery for goods sold by sq ft, tonne or load: decided by the first extra owner's needs.** Whole-number quantities, one rate per manual quote and no delivery rule are the limits today. | business-setup plan 12.3 | **Before a second business type is offered** | Later |
| [ ] | **Free-trial prerequisites:** live site, domain and e-mail, an owner-approved way in (sign-up is closed), terms of use and a privacy notice naming WhatsApp and Meta (counsel), billing if charging, export and deletion of a trial workspace, and the external-customer gates. | business-setup plan 12.4 | **Before any trial** | Later |
| [ ] | **Trial workspaces are synthetic-only unless the real-data gate is opened for that one workspace.** Decide and write down which. | business-setup plan 12.4 | **Before any trial** | Later |
| [ ] | **Validate ONE extra business type with ONE real owner and their accountant before a trial opens to many.** | business-setup plan 12.4 | **Before any trial** | Later |
| [ ] | **No paid setup service with access on a real workspace until counsel has reviewed support access (row (a)) and the owner-visible access log exists (row (b)).** Until then: advice with no access. | business-setup plan 12.5 | **Before the paid service** | Before external customers |
