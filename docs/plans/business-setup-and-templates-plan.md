# Plan: business setup and templates (any business set up by selecting options)

Status: **PLAN ONLY. NOT APPROVED. Updated 2026-10-08 against `main` after manual-price slice 1** (migration `20261029090000_manual_price_slice1.sql`, `manual-price-quote-plan.md` section 22). First written 2026-10-08 on the branch `docs/business-setup-plan`, lane B (docs). No code, migration, test, ADR or dependency was written or changed, and nothing was run. The facts come from files in this repository as they are on `main` after slice 1 (paths below); what I could not check is marked **unverified**. Sizes follow the repo's convention: **S** = web only, existing endpoints; **M** = a new endpoint or one migration with tests; **L** = a security-relevant database change with an equivalence proof. They are my estimates.

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
| Quote policy: required inputs | **Partly an option**: `delivery_state` is always required (a table check); `delivery_city`, `payment_terms`, `deadline` may be added | `20261016090000:31,225-226`. The owner decided on 2026-10-08 not to ask for delivery state on manual quotes; whether that is possible is **unverified** (`manual-price-quote-plan.md` section 12, item 5) |
| **GST rate and its effective date** | **Two places.** (1) **List-price quotes:** per price-list item (`tax_bps` on each item of a price-list version, which has its own effective date), unchanged. (2) **Manual-price quotes:** the policy now carries ONE rate, `gst_rate_bps` (0 to 2800; the database default is 500, see section 6.2), and `gst_effective_from` (a date; default the version's own date). A change is a new policy version. `app.quote_gst_bps_on` returns null before the date (the caller refuses). **The policy page has no field for either yet**: it says GST on a manual price is added at 5 % "until a later change". Nothing calls the manual-price path yet (slice 2). By item type or price band is **not built** (slice 1 chose the single policy rate, option 1 of section 4); the accountant's answers are still awaited | `manual-price-quote-plan.md` sections 4 and 22 (item 2); `20261029090000:29-34,247-249`; `quote-policy-form.test.tsx:79-81`; checklist row "GST rates, GST slabs and freight rules are the owner's and the accountant's inputs" |
| Price lists (items, minimum order quantity, price breaks, GST per item) | **Exists** (versioned; plain page and CSV import on `main`) | ADR 0019; `docs/plans/price-list-csv.md` |
| **Item types** (the editable list, for example the family's 20 saree types) | **Exists as data and API; no page and no seed list.** Table `item_types` (code, name, position, active; the code never changes and a row is never deleted). Two routes: `GET /item-types` (Owner, Admin, Sales; a Viewer reads none) and `PUT /item-types/{code}` (Owner or Admin with the second factor, through `public.save_item_type`; no client write grant). **There is no web page to edit the list and no starter list**, so a new workspace has none until a page is built (the "list" slice). **Unlike the policies it is not versioned:** a save replaces the record in place (`save_item_type` updates the row), so the principle in section 2 (immutable versions) does not hold for it; whether an audit event is written is **unverified**. The fixed eight saree codes of the requirement vocabulary are separate (below) | `manual-price-quote-plan.md` section 22 (item 3); `20261029090000:381-470` |
| **Optional price range per item type** | **Stored (optional `min_price_paise` and `max_price_paise`, 1 to 100,000,000, lowest not above highest). The rule exists as a function (`app.price_outside_range`, `app.item_type_price_outside_range`, and a pure copy in the API) but NOTHING calls it yet.** Slice 3 is to call it and, as slice 1 wrote it, **refuse** a price outside the range with the code `price_outside_range`; there is **no override flag** (whether the owners may override is their later decision). That is a refusal, not the "soft warning" the earlier plan sections 6 and 12 describe: the two have not been reconciled. The last-price warning (`last_price_warn_bps`) is **not built** | `manual-price-quote-plan.md` sections 6, 12, 17, 22 (item 3); `20261029090000:472-498` |
| **Requirement codes** (saree type, fabric, colour, payment terms) | **Not a setting.** A fixed list in a migration, the same for every workspace, saree-themed; changing it is a deploy | `app.requirement_vocab`, `20261015090000:50-56`. The owner decided on 2026-10-08 to keep the eight codes and let only the manual quote use the family's list (`manual-price-quote-plan.md` section 20, item 3) |
| Follow-up cadence: gaps in days, maximum touches (1 to 100), quiet hours, allowed weekdays, holidays, minimum gap, recipient time zone offset | **Exists** (versioned; web policy form on `main`) | `followup_policy_versions`, `20261024090000:166-190` |
| Follow-up wording | **Not a setting.** Three closed English templates, extended by a migration and a reviewer who reads the language | ADR 0022 ("Deliberately not built"); checklist row "The draft wording is synthetic placeholder text" |
| **Quote languages** | **Not a setting and not built.** The quote text uses fixed English labels and does no translation; other languages are "not built" | `docs/plans/quote-text.md:43-44`; ADR 0022 line 92. The quote renderer is lane C's pinned package |
| Order policy: advance required, dispatch needs the advance, cancel window, zero-value orders | **Exists in the database and API; no web page** | `order_policy_versions`, `20261019090000:107-123`; checklist rows "Order policy has no page" |
| Mapper config (which catalog products a requirement may suggest) | **Exists, seeded only**, no page; matters for list-price quotes | `mapper_config_versions`, `20261016090000:243-256` |
| Business type / industry on the workspace | **Does not exist.** `tenants` has a name and a slug only | `20261004120000_t002_tenancy_schema.sql:60-67` |

**What is still not true of the brief after slice 1:** (1) item types exist as data and API but have no page and no starter list, and the price range is stored but not yet used by any quote; (2) the GST rate for a manual-price quote is one policy rate, not a rule by item type or price band, and the policy page cannot set it; (3) the rate has a database default (section 6.2), which this plan treats as a problem. Everything else in the brief's list now exists. This plan adds no money rule to any of it.

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
3. **Item types** (the table and routes exist; the screen does not, section 7): add, rename, order, switch off; an optional lowest and highest price for each. How the range is used (refuse or warn) is settled by slice 3, not here. For a list-price business this screen is the price-list import instead (exists).
4. **Tax.** The GST rule, entered by the owner from the accountant's answer. **No default** (see section 6.2 and open question 13: the database default of 5 % must go). The rate shows its effective date; before that date the database returns no rate and the caller refuses, nothing is guessed (`app.quote_gst_bps_on`). Per-item-type or per-price-band rates are not built.
5. **Payment terms.** Validity, advances, net days, credit limit, rounding. Each has a one-line plain explanation and a worked **synthetic** example.
6. **Follow-up.** Cadence, quiet hours, weekdays, holidays. Skippable; skipping means no lead appears on the due list (the page already says so).
7. **Orders.** The order policy (needs a web page; none exists today).
8. **Review.** One page showing every chosen option next to what is in force now (empty for version 1), with the fields the owner must still choose highlighted. A confirmation that the owner has had the rates and terms checked by their accountant is recorded as the owner's statement. It is a claim, not proof, like the references on the real-data gate (ADR 0015).
9. **Preview a sample quote with SYNTHETIC data.** The page runs the pinned engine and the pinned text renderer on invented lines and the draft values, and shows the text a customer would get, with a banner: "Preview. Not a quote. Synthetic data." It writes nothing: it takes no quote number and creates no row. No endpoint for this was found; it would be a new stateless API route (size M). **Unverified** whether the pure packages can be called with draft, unpublished values without going through the database path; the preview must never replace the database's own recomputation on a real quote.
10. **Publish version 1.** Owner or Admin with the second factor, one publish per setting. After each, the checklist shows what is in force.

### What must be true before a business can send its first quote

Read from the code and the existing plans; "send" means a person sends by hand, because the system sends nothing.
* A **quote policy in force**; for a manual-price quote its GST rate and date must be in force (as slice 1 stands, a rate is always present because of the default, which is the problem in section 6.2; the refusal for a missing rate, SM217, is planned for slice 2 and is not built); a **price list in force** for list quotes, or **active item types** for manual quotes. Manual-price quotes themselves are not built yet (slice 2).
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
| **Wrong tax** | A template or a hurried owner puts a plausible-looking GST rate on a quote; the customer is charged wrongly | No template pre-fills a rate. **Today this is not true of the database:** if the policy page does not send a rate, `create_quote_policy_version` stores `gst_rate_bps = 500` (5 %) from the version's own date (`20261029090000:247-249`), and the policy page has no GST field, so every policy published from the page gets 5 %. That is a pre-filled tax rate, and it contradicts "templates never pre-fill tax". The rate must become a required choice with no default before manual quotes (slice 2) are built (open question 13). The review screen shows each rate with its effective date and the owner's recorded statement that the rates were checked. A synthetic worked example is shown, never a real figure. The risk is reduced, not removed: the database proves the arithmetic, not that the rate is the right one (ADR 0019, "honest limits") |
| **Wrong credit terms** | An owner copies net days or an advance from a template; the credit limit is one global number for all repeat buyers | No template pre-fills money or days. The page states in plain words that the limit is global, not per customer. The screen shows what a new quote would say |
| **Confusing the owner** | Many options, saree-themed words, six independent versions, drafts going stale | Few options per screen; plain words; "suggested" versus "you must choose"; a ready/not-ready checklist; the word "item type" everywhere new (section 9); a warning before publishing that open drafts become stale |
| **False sense of readiness** | A template labelled for a business type is mistaken for something checked | Every template other than 1 is marked "Not validated"; none is shown until a person who runs that business has reviewed it (row (c)) |
| **Support access misused or over-broad** | A support person reads customers' data, or access lingers | Section 5: one workspace, setup-only scope, database-enforced expiry, visible log, legal review first |
| **Settings drift from the pinned engines** | A setting offers a value the engine or the database refuses | Options are limited to what the database accepts today; any new option needs its own ticket and its own equivalence proof |

## 7. Phasing

| When | What | Size |
| --- | --- | --- |
| **Now: almost nothing new.** | This plan. **Done in slice 1 (on `main`):** net days per customer kind, the single GST rate and date on the policy, and the `item_types` table with two routes and an optional price range. **Still to build from `manual-price-quote-plan.md`, not by this plan:** slice 2 (the manual quote itself, which must also make the GST rate a required choice, section 6.2), slice 3 (the price-range rule called and the API), the item-type editor page and a starter list (the "list" slice), GST and net-days fields on the policy page as needed. **Not built and not planned for now:** a GST rule by item type or price band. Optional and small: a read-only "what is in force" checklist page that reads the existing endpoints (which of the reads exist for the order policy and mapper config is **unverified**) | S, optional |
| **Waits until a second business type is real** (an actual person who will use it) | The template data format and the picker (step 1). The review page (step 8). The sample-quote preview route (step 9, M). An order-policy page (step 7). A rule for how a second type shows its requirement words. Support grants (section 5), because a second business means someone other than us needs help | M each; support grants L |
| **Waits for real pilot data** | Which options the family actually changed from the starting values; which ones nobody touches (remove them); the real values for policies; whether template shapes (cadence length, required inputs) fit a second business; the editable requirement vocabulary (largest change; its own ticket) | decided from the Customer Zero four-week measurement |
| **Waits for the external-customer gates** | Any business other than the family on the hosted system. Gates already on the checklist: option B (a dedicated agent and signing principal), the DPDP review, rate limiting, a tenant export and deletion workflow, the daily cost cap moving to operator-only | not scheduled |

**Naming. Decided and done in slice 1:** the table is `item_types` (migration `20261029090000`), not `saree_types`; `manual-price-quote-plan.md` section 22 says "no `saree_types` table existed in the code". The fixed requirement codes (`saree_type` in `app.requirement_vocab`) are not touched. Whether a column on a quote line will be `item_type_code` or keep the older planned name `saree_type_code` (`manual-price-quote-plan.md` sections 1 and 16, written before the table was named) is **unverified**; slice 2 creates it and should use `item_type_code`.

## 8. Open questions for the owner (each with my recommended answer)

1. **Scope of "any business".** Does it mean: India, rupees, GST added on top, and a business that quotes, follows up and collects payment? **Recommend yes.** Anything else is a separate ticket.
2. **Rename `saree_types` to `item_types`?** **DECIDED and DONE** in slice 1: the table is `item_types`. The fixed requirement codes stay as they are. Left to slice 2: use `item_type_code` for the new column on quote lines (recommended).
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
13. **The database defaults the policy GST rate to 5 % when none is sent** (`gst_rate_bps` default 500, and the policy page sends none). Should it stay? **Recommend no: before manual quotes (slice 2) are built, `gst_rate_bps` must become a required choice with no default.** The policy page gets a rate field the owner must fill in (from the accountant), the database function refuses a policy for manual-price use without one, and the old policy versions keep the value they hold (a migration cannot edit them). This is a new migration, not an edit of the pushed one. Until then, no real quote may rely on the 5 %.
14. **The item-type price range: refuse or warn?** Slice 1 wrote it as a refusal with no override; the earlier plan and the owner's 2026-10-08 decision said "soft warning, never a block". **Recommend the owner decides before slice 3 and the earlier plan sections are brought into line;** this plan assumes nothing.

## 9. Naming rule

* **New code, tables, columns, API routes, tests, docs and UI text say "item type", not "saree".** Example: "item type", "item types", `item_type_code`, "Add an item type".
* Existing names stay as they are until a deliberate rename: `app.requirement_vocab('saree_type')`, the eight codes, the family's own words in their data. Do not rename them as a side effect of other work.
* The table is already `item_types` (open question 2). The planned quote-line column `saree_type_code` should be `item_type_code`; the older sections of `manual-price-quote-plan.md` still use the old words.
* The family's own item names are data entered by the owner, not code, and are never committed to the repository.
* Words a non-saree owner would not know ("requirement", "SKU", "basis points", "RLS", "aal2") do not appear on setup screens; use plain words ("what the customer asked for", "product code", "percent").

## 10. What was added to the pre-pilot checklist

Three unchecked rows were added to `docs/pre-pilot-checklist.md`, under "Business setup and templates (plan, 2026-10-08)":
* (a) the support-access model reviewed by counsel;
* (b) the support-access audit log visible to the owner;
* (c) the template defaults reviewed by a person who runs that kind of business.

## 11. Conflicts found with this direction

1. **Mostly resolved by slice 1:** net days per customer kind, `item_types`, and a GST rate with an effective date on the policy now exist. What remains different from the brief: item types have no page and no starter list; the price range is stored but unused; the policy GST rate is one rate for manual-price quotes only (list quotes keep the rate per price-list item), is not on the policy page, and **has a 5 % default that conflicts with "templates never pre-fill tax"** (section 6.2, question 13).
1a. Slice 1 stores the item-type price range as a refusal with no override; the earlier plan and the owner's decision describe a soft warning (question 14).
2. `docs/product.md` plans external pilots as "same core, configured industry pack" and `docs/plans/roadmap.md` is local-first with synthetic data only. Self-setup by any business is the **external-customer** stage, which the checklist gates behind option B, the DPDP review, rate limits and export/deletion. This plan keeps those gates.
3. The requirement vocabulary is fixed and saree-themed (section 2.2); "any business" is limited by it until a later ticket.
4. "Support team access" overlaps the existing **operator** path (ADR 0015), which is standing and not owner-visible. The proposal adds a narrower path; it does not remove the operator route.
5. The "Owner role is never granted through the app" rule (`members-and-invitations.md` 3.1) stays: a support grant is never an Owner membership.
