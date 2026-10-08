# Plan: the whole app in the v2 look, inside one workspace

Status: **PLAN ONLY.** Written 2026-10-09 on branch `docs/workspace-v2-plan`, from `origin/main` (47edd4d). No code, no dependency, no server, no database, nothing pushed. Every count below comes from a command run for this plan; where I read code but could not run it, it says "unverified".

**Owner direction (2026-10-09):** "i want everything screen look like v2 design, all these should under workspace." Meaning: after sign-in there is one workspace with one frame, the same on every screen, and every screen uses the v2 look of the front page and the sign-in pages (orange brand, type, spacing, light/dark toggle, language menu).

**Not in this base:** Job U (branch `web/screen-polish`, commit 14193e8, not pushed): item-types table, link colours, form grid, hidden freight rows on typed-price quotes. It touches files this plan also touches (section 3, "Order"). Merge it first, or this plan's batches 1B and 1C will conflict with it.

## 0. The short version

1. **Today there is no frame.** There is no layout under `/app`. Each of the 23 screens draws its own box and its own row of links. The v2 look exists only on the front page (`/`, `/landing`) and the sign-in pages (`/login`, `/auth/*`). The sign-in pages already show the pattern: the frame lives in a **route layout**, and the page tests never render a layout, so they do not change (Stage 3 risk check).
2. **The same trick works for the app.** Two new layouts (`app/app/layout.tsx`, `app/app/tenants/[tenantId]/layout.tsx`) carry the v2 frame: top bar, menu, language, theme, workspace switcher. The pages inside keep their own `<main>`. This is Batch 1A and changes no page.
3. **The hard part is not the frame. It is the old stylesheet.** The v2 reset wipes margins, borders and button looks inside `[data-ui="v2"]`. If the whole page sat inside one v2 wrapper, every screen not yet migrated would lose its look. So until the last batch the frame is a v2 **island** and each screen's content becomes its own v2 island **when that screen is migrated**, folder by folder (section 2.9).
4. **Eight batches, plus a language track.** Frame first, then the quote flow with item types and the quote policy, then home and account, customers, follow-ups, the rest, and last the clean-up that deletes the old stylesheet.
5. **Safe by construction.** Before any markup changes, a plain-text snapshot of every screen (all four roles) is captured from `main`. A look batch may not change that snapshot except for lines the owner approved. The one golden is re-captured on purpose, in its own commit, with a before/after.
6. **No new features, no API or database change.** The "Set up your business" checklist and the "due today" cards are separate tickets; this plan reserves their place on the home screen and nothing more (section 7).

## 1. Inventory: every screen under /app

Found with `find app -name page.tsx` (23 pages) plus two route handlers. "Roles" come from the role lists and checks in each page's code (unverified in a browser). "Look": **legacy** = the old plain look (`globals.css`), **v2** = new look; **all 23 are legacy**.

"Tests" = `it`/`test` blocks in that screen's folder (an `it.each` counts once, so true numbers are higher). "DOM" = places in those tests that read a class, a selector or the DOM shape (`querySelector`, `closest`, `toHaveClass`): these break when markup changes. Folder counts include the screen's components. Some components are shared (section 3.2).

| # | Route (under `/app`) | Who may see it | What it is for | Reads (API) | Tests / DOM | Also pinned by |
|---|---|---|---|---|---|---|
| 1 | `/app` | any signed-in user | Your workspaces, create one, sign out, authenticator reminder | `fetchMe` | 11 / 0 | |
| 2 | `/app/security` | any signed-in user | Turn the authenticator app on or off | session only | 16 / 0 | `e2e/auth.mjs` |
| 3 | `/app/tenants/[id]` | all four roles; create-company form for owner, admin, sales; link row hides links by role | Workspace home: five record tabs (companies, contacts, products, leads, opportunities), create a company, "synthetic data only" banner, a row of links to everything | `fetchTenant`, `fetchPage`, `fetchDataPolicy` | 142 / 43 (folder also holds the evidence, suggestions and review components) | `touch-targets.test.ts` |
| 4 | `/agents` | all roles read; start a run: owner, admin, sales; settings and cost: owner, admin | Assistant runs, their cost and settings | `fetchAgentSettings`, `fetchRuns`, `fetchAgentCost`, `fetchPage`, `fetchTenant` | 28 / 4 | `e2e/agents.mjs` |
| 5 | `/companies/[id]` | all read; edit: owner, admin, sales; review suggestions: owner, admin | One company with evidence and claims | `fetchCompany`, `fetchEvidencePage`, `fetchClaims` | 21 / 1 | `e2e/agents.mjs` |
| 6 | `/contacts/[id]/consent` | owner, admin, sales (others get a plain notice) | Record consent for a contact | `fetchContact` | 38 / 0 | |
| 7 | `/customers/new` | owner, admin, sales | Add a customer | `fetchTenant` | 33 / 6 | |
| 8 | `/enquiries/[id]` | owner, admin, sales (others get one sentence); typed prices: owner, admin | The quote flow: pasted enquiry, requirement, pick products or type prices, make a draft quote, approve, text to copy, start an order, "I sent it on WhatsApp" | `fetchEnquiry`, `fetchRequirement`, `fetchQuoteSetup`, `fetchEnquiryQuotes`, `fetchQuote`, `fetchQuoteText`, `fetchOrders`, item types, policy, WhatsApp view | 262 (page 50 + components 212) / 43 | **the golden** `golden/list-quote-render.json` |
| 9 | `/followups` | owner, admin, sales | Follow-ups due, paged | `fetchDueList` | 123 / 16 (whole follow-ups folder) | `checklist.test.ts`, `docs/rehearsal-followups-checklist.md` |
| 10 | `/followups/policy` | owner, admin, sales read; owner edits | When to follow up (rules, versions) | `fetchPolicyVersions` | in the 123 above | same |
| 11 | `/item-types` | owner, admin, sales read; owner, admin edit (needs authenticator) | List and edit item types | `fetchItemTypes` | 52 / 0 | |
| 12 | `/leads/[id]` | all read; write: owner, admin, sales | One lead: evidence, enquiries, sent-message form | `fetchLead`, `fetchEvidencePage`, `fetchClaims`, `fetchLeadEnquiries` | 58 / 2 | |
| 13 | `/leads/[id]/followup` | owner, admin, sales | Follow-up drafts and touches for one lead | `fetchLeadFollowup` | in the 123 above | same |
| 14 | `/orders` | owner, admin, sales | Orders list | `fetchOrders` | 52 / 9 (whole orders folder) | |
| 15 | `/orders/[id]` | owner, admin, sales; events offered by role | One order, record events (money held shown) | `fetchOrder`, `fetchMembers` | in the 52 above | |
| 16 | `/price-list` | owner, admin (others get a notice) | Paste or import a price list (CSV) | `fetchTenant` plus its own actions | 26 / 5 | |
| 17 | `/privacy` | owner, admin | Ask for personal data to be erased; the data policy | `fetchErasureRequests`, `fetchPage` | 18 / 1 | `e2e/privacy.mjs` (security tier) |
| 18 | `/products/new` | owner, admin | Add a product | `fetchTenant` | 11 / 1 | |
| 19 | `/quote-policy` | owner, admin (needs authenticator to publish) | Quote policy versions and a form to publish one | `fetchQuotePolicyVersions` | 92 / 11 | |
| 20 | `/requirements/[id]/questions` | owner, admin, sales | Questions to ask the customer (drafts) | `fetchQuestionDrafts` | in the 123 above | same |
| 21 | `/review` | all read; label and import: owner, admin, sales; export: owner, admin | Lead review queue with blind scoring | `fetchReviewQueue`, `fetchActiveIcpConfig` | 54 / 6 | `touch-targets.test.ts`, `e2e/review.mjs`, `e2e/export.mjs` |
| 22 | `/suggestions` | all read; accept or reject: owner, admin | Assistant suggestions to review | `fetchAgentClaims` | 6 / 0 (plus the shared suggestion components) | `e2e/agents.mjs` |
| 23 | `/suppression` | owner only | Suppression keys (do-not-contact) | `fetchSuppressionStatus` | 21 / 0 | |
| h1 | `/review/export` (route handler, no page) | owner, admin | CSV export | | 6 / 0 | `e2e/export.mjs` |
| h2 | `/quotes/[id]/whatsapp` (route handler) | by role | "Open in WhatsApp" link | | 33 / 0 | |

Totals under `app/app`: 94 test files, about 1,070 test blocks, 83 `.tsx` and 35 `.ts` source files. One golden file. Five on-demand browser scripts in `e2e/` (not in CI). 128 `className` uses and 25 inline `style` uses in the `enquiries` folder alone; the home folder has 20 inline styles.

**Not screens, but part of the look:** `/not-found`, an API-down page (`ApiDown` in `followups/page-parts.tsx`) and a "not shown to your role" page (`NotShown`) are drawn by hand in many pages. They become one shared v2 component each (section 3.2).

**Gaps found while reading (not fixed here):** there is no list of all quotes (a quote is reached from a lead's enquiry), no list of all enquiries, and no tenant-wide "drafts waiting for approval" read. The menu can only link to what exists.

## 2. The workspace frame

### 2.1 Layout

Two layouts, nothing else new at the route level:

* **Account frame** (`app/app/layout.tsx`): wordmark, language, theme, an account menu (Security, Sign out). Wraps `/app` and `/app/security`.
* **Workspace frame** (`app/app/tenants/[tenantId]/layout.tsx`): everything above plus the workspace name with a switcher and the menu. It reads the person and the workspace the same way the pages do (`fetchMe`, `fetchTenant`, sharing one result per request with React `cache`; unverified that the existing client supports this without change). **It never decides access.** If the workspace cannot be read, the frame draws only the account part and the page shows its usual not-found or error page, so 404 behaviour does not change.

The frame is built from `components/v2/app/*` (new folder, like `components/v2/auth`). It reuses `V2Root`, `LangSelect`, `ThemeButton`, `Wordmark` and `lucide-react` icons (already a dependency). The page keeps its own `<main>`; the frame has a skip link to `#main`, one banner and one navigation, and each page gets `id="main"` (done as the sign-in pages did).

### 2.2 Navigation groups (shopkeeper words) and who sees what

A group with no visible item is hidden. Visibility is a convenience only: the page, the API and the database stay the gate, as the pages already say.

| Group | Item (the words on screen) | Goes to | Owner | Admin | Sales | Viewer |
|---|---|---|---|---|---|---|
| **Today** | Today | workspace home | yes | yes | yes | yes |
| **Customers** | Leads to look at | `/review` | yes | yes | yes | yes |
| | Companies and contacts | home records tabs | yes | yes | yes | yes |
| | Add a customer | `/customers/new` | yes | yes | yes | no |
| **Quotes and orders** | Orders | `/orders` | yes | yes | yes | no |
| | (Quotes) | made from a customer's enquiry; no list exists, so no menu item (gap above) | | | | |
| **Follow-ups** | Due now | `/followups` | yes | yes | yes | no |
| | Rules for follow-ups | `/followups/policy` | yes | yes | yes | no |
| **Catalogue** | Item types | `/item-types` | yes | yes | yes | no |
| | Price list | `/price-list` | yes | yes | no | no |
| | Add a product | `/products/new` | yes | yes | no | no |
| **Assistant** | Suggestions | `/suggestions` | yes | yes | yes | yes |
| | Agents | `/agents` | yes | yes | yes | yes |
| **Settings** | Quote policy | `/quote-policy` | yes | yes | no | no |
| | Privacy and erasure | `/privacy` | yes | yes | no | no |
| | Suppression keys | `/suppression` | yes | no | no | no |
| | Security (your account) | `/app/security` | yes | yes | yes | yes |

"Agents" keeps its current on-screen word because pages and the e2e script use it. The group is called "Assistant". The Telugu names for the groups are decided in the language batch (section 5). The menu is one table in one file with a test that pins it to the table above, so a role change in a page cannot silently disagree with the menu.

Unverified: the Viewer column is from page code (no role wall found on review, leads, companies, agents, suggestions); the first batch checks each with a Viewer login.

### 2.3 Phone first

Phone is the main case (the owner's parents).

* **Phone (under 768px):** a slim top bar (workspace name with the switcher, language, theme, account) and a **bottom tab bar** with four tabs plus "More": **Today, Customers, Quotes and orders, Follow-ups, More**. "More" opens a full-screen list of the other groups. Tabs shown depend on role (a Viewer sees Today, Customers, Assistant, More).
* **Tablet and desktop (768px and up):** a left side menu with the groups above (16 items are too many for a top bar). The side menu collapses to icons below 1100px.
* Every tap target 44px or more (the existing `touch-targets` test already pins this for the old pages; v2 keeps the rule). Body text 16px, nothing under 14px (already the v2 type scale). The bottom bar respects the phone's safe area. No horizontal scroll at 360px.
* Long tables become stacked cards on a phone (the pattern Job U introduced for item types).
* The primary action of a form stays reachable on a phone (the old `.sticky-actions` pattern, rebuilt in v2).

### 2.4 Language and theme

The language menu and the theme button are the existing v2 controls, in the top bar of both frames. Language is the `sme_lang` cookie plus a page refresh; theme is `sme_theme`. Section 5 covers the strings. Section 2.9 covers what happens to the theme while some screens are still old.

### 2.5 Workspace home

Top to bottom, on the same URL as today (`/app/tenants/[id]`):

1. Notices: the "synthetic data only" banner (as today) and the authenticator reminder (today it is on `/app`; owners and admins also see it here, unverified).
2. **Set up your business** (the checklist of `business-setup-and-templates-plan.md` §12.1): owners and admins only, shown until done. **Reserved slot only.** The checklist is its own ticket (slice 2 of §12.7); until it ships the slot renders nothing (no placeholder: "no decorative agents").
3. **Due today:** only reads that exist today: follow-ups due now (`fetchDueList`, paged, so a count would be "on this page"), leads still to look at (`fetchReviewQueue`), open orders (`fetchOrders`). Quotes waiting for the owner have no tenant-wide read: a gap. Each card appears only if the role may open its page. Also its own ticket, after the checklist.
4. The five record tabs and "create a company", unchanged.

Until those two tickets ship, the redesign puts the existing home content (banners, tabs, create form) in the new look and removes the home's old row of links once the menu carries them.

### 2.6 Back behaviour and breadcrumbs

Phone: each screen under a group shows a "back to" arrow naming its parent (for example "← Customers"). Desktop: a breadcrumb "Workspace name › Group › Page". Only static parents are named; the page's own `h1` names the lead, company or order. The existing "← {workspace}" and "← Workspaces" links inside pages are pinned by tests; they stay until the last batch, then are removed in one visible commit.

### 2.7 Moving between workspaces

A switcher in the top bar lists the person's memberships (name and role) from `fetchMe`, with "All workspaces" and "Create a workspace" (both go to `/app`, where the create form already is). Choosing a workspace goes to **that workspace's home**, never to the same sub-page, and no id from one workspace is carried into another. A person with one workspace sees the name and no menu arrow. `/app` stays the chooser. (Not auto-opening the only workspace: open question 4.)

### 2.8 The role line and second-factor prompts

"Your role: X" stays in each page until the last batch (tests pin it); the frame shows the role beside the workspace name from the first batch. Every sentence that sends a person to `/app/security` ("needs your authenticator app", "Set it up on the Security page") stays word for word and in the same place.

### 2.9 The wrapper problem, and how the frame lives next to old screens

Facts (read in `design/reset.css`, `design/v2.css`, `globals.css`, `V2Root.tsx`, `ThemeButton.tsx`):

* The v2 reset sets margin, padding and border to 0 on **every** element inside `[data-ui="v2"]`, and restores the plain look of `button`, `table`, `select`, headings. Old screens depend on those looks. So **the old pages cannot sit inside the v2 wrapper**.
* Tailwind generates classes only from `components/v2` (`@source "../components/v2"`). A page outside that folder gets v2 classes only through class-name constants exported from `components/v2` (the sign-in pages do exactly this with `components/v2/auth/ui.ts`).
* The leak check refuses legacy class names (`shell`, `card`, `hint`, `error`, `row`, `tap`, `badge`, 46 names in all) inside any file that is v2. So a file is **fully old or fully v2**, never mixed.
* `ThemeButton` sets `data-theme` on the **closest** v2 wrapper only.

Therefore:

1. The frame is a v2 island (header, menu, bottom bar). The old page content below it is **not** inside any v2 wrapper and looks as it does today.
2. A screen is migrated by adding a small `layout.tsx` in **its own folder** (for example `item-types/layout.tsx`) that wraps its content in a v2 wrapper, and by changing the classes in its files. No folder moves, so no import path changes and no test moves. In the last batch the folder layouts merge into the workspace layout and are deleted.
3. `ThemeButton` is changed to update every `[data-ui="v2"]` on the page, so the frame and a migrated screen stay in step.
4. **Known wart during the move:** an old screen follows the system light/dark choice, not the toggle. A person who picks "light" on a dark phone sees a light frame over a dark old screen until that screen migrates. Mitigation (Batch 0, small, needs the owner's yes because it touches the root layout and the lane-B-owned `globals.css`): the toggle also writes `data-theme` on `<html>`, the root layout reads the cookie, and `globals.css` gets two small blocks keyed on it. Open question 5.
5. Pieces used by an old screen and a migrated screen at once (section 3.2) are **forked**: the v2 copy goes in `components/v2/app`, the old copy stays until its last user migrates, then is deleted.

## 3. Migration batches, in order

Sizes (S small, M, L, XL) and commit counts are guesses from file sizes. "Risk" is the chance of breaking money, approvals, roles or tests.

| Batch | Contains | Size | Risk |
|---|---|---|---|
| **0 Groundwork** (no visible change) | the plain-text snapshot of all 23 screens x 4 roles from `main`; `getLang()` proof (section 5); wrapper and theme-sync proof (2.9); the island-per-folder pattern on one tiny throwaway route; the screenshot script (section 6); the `<html data-theme>` change if approved | M (6 to 8 commits) | low |
| **1A Frame and shared pieces** | both layouts, menu and bottom bar, switcher, language and theme in the top bar, breadcrumbs, skip link, v2 versions of `ApiDown`, `NotShown`, `Notice`, `ActionResult`, page header, card, field, button, badge, table, key-value list; the menu table and its test. **No page file changes** except `id="main"`. The home's old link row stays for now | L (10 to 14) | medium: it is on every screen, but pages and page tests do not change |
| **1B-orders** | orders list, order page, event form, start-order form, order view | M (6 to 8) | **high**: money held, cancellation with funds, role-based events |
| **1B-quote** (after 1B-orders) | the enquiry page and everything on it: requirement panel and forms, pick-line, create and manual quote forms, quote view, approve / reject / withdraw, copy text, WhatsApp actions, sent-on-WhatsApp, start-order | XL (12 to 18) | **highest**: approvals, typed prices, the golden |
| **1C Catalogue and policy** (parallel with 1B) | item types (list, add, edit), quote policy (versions, form) | M (8 to 10) | high: second-factor prompts, price ranges |
| **2 Home and account** (parallel with 1B, 1C) | `/app`, `/app/security`, workspace home, create-company form; removes the old link row; reserved checklist slot | M (8 to 10) | medium; security page is security tier |
| **3 Customers and assistant** (after 1B) | review queue, lead page, company page, consent, add a customer, suggestions, agents, the enquiries panel and paste form on the lead page, evidence and suggestions panels | L (14 to 18) | medium; review queue has the touch-target test and phone script |
| **4 Follow-ups** | due list, lead follow-up, policy, questions, sent-message form | L (12 to 16) | high: drafts, "nothing is sent" text, sentence-pinning checklist test |
| **5 The rest** | price list and CSV import, add a product, privacy and erasure, suppression keys | M (8 to 10) | high: erasure and keys are security tier |
| **6 Clean-up** (last, alone) | folder layouts merge into one layout and one wrapper; `globals.css` legacy rules deleted; legacy probe retired; theme bridge removed; old back links and "Your role" lines removed (their tests re-pointed in one visible commit) | M (4 to 6) | medium: touches the lane-B-owned stylesheet and the leak audit |

Language batches (section 5) run as a second track, after each look batch, never inside it.

Rough total: 80 to 110 commits for looks and about 30 to 40 more for language, plus review-fix rounds (earlier tickets needed 5 to 7 fix commits per round). A guess.

### 3.1 What can run in parallel

* **Strictly in order:** 0, then 1A. Nothing starts before 1A is merged.
* **After 1A, in parallel (disjoint folders):** 1B-orders to 1B-quote (one after the other), 1C, and 2.
* **After 1B-quote:** 3. It cannot start earlier because the lead page renders `EnquiriesPanel` from the `enquiries` folder, and both batches would edit that folder's tests.
* **4** can start once 1A is merged; its files do not overlap 1B, 1C or 2. It overlaps 3 on the lead page's sent-message form, so 3 and 4 are not run at the same time unless that form goes to one of them (decide at the start).
* **5** after 1A; free to run in parallel with 3 and 4.
* **6** alone, last.

### 3.2 Files that more than one batch touches (the conflict list)

| Shared file | Used by | Handling |
|---|---|---|
| `enquiries/action-result.tsx` (`ActionResult`) | enquiry, orders, follow-ups, policy forms | forked to a v2 copy in 1A; old copy deleted in Batch 6 |
| `followups/page-parts.tsx` (`ApiDown`, `NotShown`, `Notice`, `todayInIndia`) | follow-ups, item types, quote policy, questions | v2 copies in 1A; the date helper is logic and is not touched |
| `enquiries/quote-panel.tsx` imports `orders/start-order-form` | enquiry page, orders | why orders go before the quote flow |
| `enquiries/enquiries-panel.tsx`, `paste-enquiry-form.tsx`, `enquiry-text.tsx` | lead page (Batch 3) | owned by Batch 3, not 1B (check which are used where when 1B starts) |
| `evidence-panel`, `suggestions-panel`, `suggestion-evidence`, `review-screen` (folder root) | lead, company, suggestions pages | Batch 3 only |
| `item-types-logic.ts` imports `enquiries/manual-quote-logic`; `manual-quote-logic.ts` imports `quote-policy-logic` | logic, not look | not touched by look batches |
| `touch-targets.test.ts`, `factor-breakdown*` | lane B owns them | Batch 3 coordinates; Batch 6 re-points the test |
| `components/v2/app/nav` (menu table) | every batch that adds a route | only 1A edits it |
| `globals.css` | lane B owns it | untouched until Batch 6 (and the small theme bridge, if approved) |
| Job U's edits (`quote-view.tsx`, `item-types-view.tsx`, `manual-quote-form.tsx`, `globals.css`) | 1B-quote, 1C | merge Job U first; 1C then replaces its table and form grid with v2 versions and keeps its tests (columns, labels, hidden freight rows, no edit control for Sales and Viewer) |

### 3.3 Who works on what

The server pages and write forms belong to lane A (`docs/lanes.md`), the old stylesheet and the touch-target test to lane B. The earlier port used `web/…` branches with an advisory path check (owner decision 4 of `port-design-v2.md`). I propose the same here (open question 6). Batches 2 (security page), 5 (privacy, suppression, price list) and the second-factor prompts in 1C get lane A's review and a run of `make check` on the local stack before merge.

## 4. Keeping behaviour safe

### 4.1 Rules

1. **One thing at a time.** A batch changes the look of a screen **or** its behaviour, never both. A look batch's diff must not touch `actions.ts`, `lib/**`, `*-logic.ts`, `proxy.ts`, `csp.ts`, `next.config.ts`, role lists, or anything under `supabase`/`services`. A guard script (as in earlier stages) prints the forbidden-path diff, which must be empty, and a grep of every `ROLES`/`WRITERS`/`WRITE_ROLES` line that must be identical before and after.
2. **Moving strings is its own batch** (section 5), because it touches logic files.
3. **A new menu item is not a behaviour change; a new URL is.** No URL changes in this plan.

### 4.2 What must never change

* **Money:** every figure, its source (the pricing engine and the database), `formatRupees`, the rows shown (Job U's rule: freight rows hidden only on typed-price quotes, and shown if they ever carry money).
* **Pinned text:** the quote text, follow-up message templates, `NOTHING_SENT`, consent wording, and every sentence a test or `checklist.test.ts` quotes. A restyle never rewrites a sentence.
* **Role gating:** who sees a button, a form, a page. The hidden-versus-shown behaviour for Sales and Viewer (no control at all) stays.
* **Second-factor prompts:** wording, link to `/app/security`, and the rule that the control is absent or disabled without it.
* **The state words:** Draft, Suggested, Approved, Sent, Failed, Completed, and "nothing was sent".
* **Idempotency ids:** the ids a page creates per render for retries (quote, order, policy ids) stay where they are.

### 4.3 Tests and the golden

* **Batch 0 builds a plain-text snapshot** for every screen and role: the visible words and numbers in order, link targets, form field names and labels, button names, roles. It is written with Vitest's own file snapshot (`toMatchFileSnapshot`, built in; no new dependency) and committed **from `main` before any markup moves**. A look batch must leave it unchanged. This is the proof that only the look changed.
* **When a markup test fails after a restyle**, each failure is put in one of two lists in the PR: (a) *class or DOM shape only* (re-pointed in a separate commit named `test: re-point ... (no change to words)`), or (b) *words, numbers, roles or behaviour changed* (not allowed; the code is fixed instead). No test is edited in the same commit as the code it checks.
* **The golden** `golden/list-quote-render.json` pins today's class names (`row`, `badge badge-maybe`, `summary`, `evidence-item`, ...). Any restyle of the quote view changes it. It is re-captured **once**, in its own commit (`golden: re-capture list-quote after v2`), with `UPDATE_GOLDEN=1`, and that commit shows the old and new HTML side by side and the text snapshot unchanged. The owner approves that commit before the batch merges. The test's own comment ("only on code known to be the old behaviour") is updated in that commit to say what was done and why.
* **Existing sentences that break the naming rule** (a Customer Zero word used in two list-flow sentences) are found by search and flagged for a separate ticket, not changed here.

### 4.4 Accessibility checks, every batch

Contrast (the existing `npm run audit:contrast` over the v2 tokens, plus both themes), every control has a label (a shared test helper walks each rendered screen), a keyboard Tab walk (the technique of `audit:auth`), visible focus ring, tap targets of 44px or more, no horizontal scroll at 360px, 200% zoom, `lang` set on the language of the content, reduced motion respected (already in v2 base CSS). The browser-driven audits need a signed-in session, so they run on lane A's local stack, not in CI (unverified that the existing audit scripts can be pointed at signed-in pages without change; Batch 0 finds out).

### 4.5 Leak and bundle checks

`npm run audit:leaks` (source step runs without a browser and already passes on `main`; its browser step needs Chrome) and `audit:budget`. The v2 fonts (three scripts) now load on every app route; the public-page budget (about 217 KB gzip) is not an app budget. Batch 0 measures one app route and the owner sets a budget (question 11).

## 5. Language

### 5.1 Mechanism

* One new store file `apps/web/i18n/strings/app.json` (the store's own header already names `app.json`), same shape as `landing.json` and `login.json`: `en`, `te`, `hi`, `kn`, and a status per language (`draft` or `reviewed`). Keys are named by screen (`quote.…`, `orders.…`).
* A small `getLang()` reads the cookie. **Existing page tests call pages directly with no `cookies()`** (that is why the sign-in frame is a layout), so `getLang()` must fall back to English when it is called outside a request. That is a design that I believe works but have **not** run; Batch 0 proves it on one page before any string moves (unverified).
* Server pages resolve their strings and pass what a client form needs as props (the forms are client components). No dictionary is shipped to the browser for all languages.
* Placeholders (`{amount}`, `{name}`) stay exactly; the store's test already checks them.
* **English parity:** moving a sentence into the store must leave the English byte for byte the same. The text snapshot (4.3) proves it.
* Nothing is translated in a batch that also changes the look.

### 5.2 Order

1. **L0:** the store, `getLang()`, the frame and menu (Telugu first, then Hindi and Kannada).
2. **L1:** the quote flow and orders, Telugu. Then Hindi and Kannada for the same screens.
3. **L2 onward:** by batch order: item types and quote policy, home and account, customers, follow-ups, the rest.

About 1,200 sentences sit in screens, actions and `lib/api` today (a rough count of long string literals and text lines in `app/app` and `lib/api`: 825 and 365), plus many short labels and button words I did not count. A long first estimate; Batch 0 produces the real list.

### 5.3 Machine drafts

Every Telugu, Hindi and Kannada string is `draft` until a native reader marks it `reviewed` (the existing export / import sheet and `i18n:status` already do this; 175 strings, all drafts, today). While a screen shows drafts, a small note near the language menu says so (the style brief requires it). `PUBLIC_LAUNCH_REQUIRES_REVIEWED` stays off for the app until the owner decides.

### 5.4 Strings no machine may translate

These get a `humanOnly` mark. In a language that has not been reviewed by a person for that string, **the screen shows the English**, never a machine draft:

* **Money:** any sentence about an amount, an advance, a balance, money held, a refund, cancellation with funds, GST, a price range warning. Figures and `₹` formatting are not strings and stay as they are.
* **Anything a customer receives:** the quote text, follow-up templates, WhatsApp wording. These are closed English text owned by a migration (ADR 0022); they are **not** in the store.
* **Consent and opt-out wording, privacy, erasure, the data policy, DPDP notices, terms.**
* **Safety statements:** "nothing is sent", "a person approves", approval confirmations, authenticator / second-factor instructions.
* **Error messages that say what was or was not saved.**

Everything else (headings, labels, buttons, menu, empty states, help lines) may be a marked machine draft.

### 5.5 Who reads what

The owner decides who reads Telugu, Hindi and Kannada (question 8). The glossary `i18n/review/i18n-glossary.csv` and `STYLE.md` already set the words.

## 6. How the owner reviews each batch

I have no browser, and neither does a batch built the same way, so the review needs something the owner can open.

1. **A contact sheet** from a new on-demand script `e2e/screens.mjs` (not in CI, local only like the other `e2e` scripts). It uses Playwright, **already** in `e2e/package.json`, so **no new dependency**. It signs in with the demo users, visits a list of routes as owner, admin, sales and viewer, at phone (390x844) and desktop (1280x800), light and dark, English and Telugu, and writes PNGs and one `index.html` to `e2e/shots/<batch>/`. Run it on `main` first (`before/`) and on the batch (`after/`); the sheet puts them side by side. It needs the local stack and the demo seed, so the owner or lane A runs it (it cannot run in CI or in a lane without the database).
2. **A short checklist per batch** in the PR: ten clicks (open this, press that), what must look the same, what must read the same. The existing click checklists (`docs/rehearsal-click-checklist.md`) are the model.
3. **The phone itself:** if the dev server listens on the laptop's network address (unverified how `make dev-web-local` binds), the owner opens the same demo on a real phone on the same Wi-Fi. Batch 0 checks this and writes the one line that works.
4. **Pixel-diff screenshot tests: not now.** Playwright can do it with no extra package, but the pictures change on purpose in every batch, so a diff would be noise until the look settles; baseline images must be committed (many, of the order of megabytes); fonts and system rendering differ between machines, which makes such tests flaky; and they need the local stack, so they cannot run in CI. Revisit after Batch 6; if wanted then, it is a small ticket needing the owner's yes.

## 7. What this does NOT do

* No new feature: the set-up checklist and the "due today" cards are separate tickets; this plan only reserves the slot. The frame (menu, switcher, breadcrumbs, bottom bar) is new chrome the owner asked for; it reads no new data.
* No API, database, migration, or `lib/api` change.
* No change to quote logic, money, the pricing engine, pinned text, role lists, second-factor rules, or any URL.
* No new dependency. (Tailwind, `lucide-react` and Playwright are already in.)
* No translation by machine of the strings in 5.4.
* No change to the front page or the sign-in pages, beyond sharing the language and theme controls.
* No deployment, no server, no seed.

## 8. Open questions for the owner (each with my recommendation)

1. **Menu shape.** Side menu on desktop and a bottom tab bar on phone, as in 2.3? **Recommend yes.**
2. **Group names.** Today, Customers, Quotes and orders, Follow-ups, Catalogue, Assistant, Settings: right words for your parents? **Recommend keep; adjust after they use the demo once.**
3. **Home and records.** Keep the records tabs on the home URL until the checklist and "due today" tickets ship, then move them to a Customers page with a redirect (a separate, behaviour-only batch)? **Recommend yes.**
4. **One workspace only:** open it straight after sign-in, skipping the list? **Recommend not yet**; it changes what `/app` does.
5. **Theme during the move (2.9).** Accept that old screens ignore the toggle until they move, or approve the small root-layout and `globals.css` bridge in Batch 0? **Recommend approve the bridge**; it is two small blocks and is deleted in Batch 6.
6. **Branches and review.** Same arrangement as the earlier port (`web/…` branches, advisory path check, lane A reviews security-tier batches and runs `make check`)? **Recommend yes.**
7. **Job U first?** **Recommend merge it before Batch 1A.**
8. **Who reads Telugu, Hindi and Kannada?** **Recommend Telugu first, with a named native reader per language; Hindi and Kannada only for the frame and quote flow until a reader is found.**
9. **The text snapshot as a gate.** Accept "a look batch may not change it" as a merge rule? **Recommend yes.**
10. **Old links and "Your role" lines.** Keep until Batch 6 (tests pin them) or move to the frame earlier at the cost of a visible test change? **Recommend keep until Batch 6.**
11. **Page weight on phones.** The three Indic fonts load on every app route. What budget do you accept? **Recommend measure in Batch 0, then set it; load only the font for the chosen language if it is too heavy.**
12. **Screenshot tool.** Contact sheet script only, no pixel-diff tool for now (section 6)? **Recommend yes.**
13. **Order of the two follow-on tickets.** Checklist first, then "due today"? **Recommend yes**; the checklist is what a new owner needs first.
