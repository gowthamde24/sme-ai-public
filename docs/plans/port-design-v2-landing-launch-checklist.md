# What must be true or changed before the landing page goes public

Status: written with the flip of "/" to the landing page (branch `web/port-flip`). Until every item below is done, the page stays **noindex** (item h) and is an early-access preview, not a public launch. Nothing here is a code change in the flip itself. Paths are relative to `apps/web`. String keys are in `i18n/strings/landing.json` (four languages; te/hi/kn are drafts).

The rule behind all of it (CLAUDE.md, non-negotiables 3 and 6, and the "nothing we cannot prove" rule of the Stage 2 plan): **the page may only say what the product does today.** Where a sentence describes something that does not exist yet, either build it and prove it, or change the sentence to say "will".

## a. Every role named on the page must exist and work as the text says

The page names seven roles (`role.*.t` / `role.*.d`, shown in the team section and used in the hero flow and "how it works" steps). Check each against the running app, not against a ticket title:

| Role on the page | What the text claims (en) | Keys | Where to check |
|---|---|---|---|
| Lead Finder | "Finds businesses that may buy." | `role.lead.*`, `step.lead.*`, `card.lead.*` | the lead discovery / import flow and its agent; `CLAUDE.md` ticket status (T007b), `docs/product.md` |
| Researcher | "Reads public pages about a lead." | `role.research.*`, `step.research.*` | the Research Agent (T007) with the guarded fetcher; `make smoke-fetch` is the opt-in proof; has it run live against a real model? (the real adapter had never run live at the last status) |
| Requirement Analyst | "Turns a request into price list rows." | `role.requirement.*`, `step.requirement.*` | the Requirement Agent (T008, ADR 0018) |
| Quote Writer | "Drafts quotes from your price list." and "priced ... by fixed rules" (`step.quote.d`) | `role.quote.*`, `step.quote.*`, `card.quote.*` | the quote engine (T009, ADR 0019): prices come from the deterministic service, never from a model |
| Follow-up Desk | "Drafts reminders when nobody replies." | `role.followup.*`, `step.followup.*`, `card.followup.*` | follow-up (T010 part 2, ADR 0022) in the app's follow-up screens: is it merged and enabled on `main`? |
| Order Desk | "Watches advances and open orders." | `role.order.*`, `step.order.*` | order conversion and the order screens (ADR 0021) |
| Main agent | "Answers your questions from recorded facts." | `role.main.*` | the Owner Agent (T011): **not started at the last status**; this sentence is untrue until it exists |

For each role: open the feature in the app with synthetic data, do the thing the sentence says, and write the date and result next to the row. If a role is missing or partial, change its `role.*.d` (and any step or card text that depends on it) to the future tense in all four languages, for example "Will draft reminders when nobody replies", and keep te/hi/kn as draft until reviewed.

## b. "Drafts, never sends" must be reworded the day any sending is added

The page promises no sending, in many places (all `en`; the te/hi/kn versions say the same):
`hero.sub` ("you approve each message and send it yourself"), `how.sub`, `control.sub` ("Nothing leaves the system"), `ctl.1.t` ("Drafts, never sends"), `ctl.1.d` ("does not send anything"), `faq.1.q`/`faq.1.a` ("Does it send messages to my customers? No ... Nothing is sent automatically."), `meta.description` ("Every message is a draft you approve and send yourself"), and the early-access texts `early.nodata` and `early.clicked`.

The day any channel can send (WhatsApp, email, SMS), including "send after approval", all of these are false. Reword them in all four languages **in the same change that adds sending**, and add that sending's approval path to `ctl.2` ("Every draft waits for you"). Where to check before launch: the follow-up and quote screens (`app/app/tenants/[tenantId]/followups`, quotes) and the sending code (`services/ai-api`): confirm there is still no code path that sends to a customer. Test to add or keep: `components/v2/landing/LandingView.test.tsx` already checks forbidden claims on rendered text; extend `i18n/strings/forbidden.ts` if the new wording needs guarding.

## c. "Phone numbers are partly hidden on screen" must be verified in the app

Key: `priv.4.d` ("We keep only the details a task needs, and phone numbers are partly hidden on screen."). Check: open the screens that show a contact (the lead review screen, the lead detail, the follow-up screens, the orders screen) with synthetic data that has a phone number, and confirm the number is partly hidden everywhere it appears (including exports, tooltips and the audit trail views). At the time this checklist was written I searched `app/` and `lib/` for masking (`mask`, `redact`, `last4`, bullet characters) and found none; so treat this claim as **unproven** until someone shows the screen. If it is not true, change the sentence (for example to "We keep only the details a task needs") or build the masking first. Related: `docs/pre-pilot-checklist.md` (erasure and PII items).

## d. The amber "money still held until you record the refund" rule must be verified in the app

Keys: `ctl.money` ("Money still held: {held}. A refund may be owed to the customer."), `ctl.moneyNote` ("If an order is cancelled after an advance, the money held stays on screen in amber until you record the refund. It is never hidden."). The page shows a labelled example (`flow.example`, amounts from `components/v2/landing/example-data.ts`). Check against the order screens (`app/app/tenants/[tenantId]/orders/*`, `order-logic.ts`, ADR 0021): cancel a synthetic order that has an advance and confirm (1) the held amount stays visible, (2) it is amber (a warning style, not hidden or greyed), (3) it disappears only when a refund is recorded, (4) a cancellation with funds is the Owner's decision (the review fix in CLAUDE.md). If any of that is untrue, reword `ctl.moneyNote` to what is true.

## e. `langs.note` is internal wording: replace it, and require reviewed translations

`langs.note` ("Telugu, Hindi and Kannada text here is machine-written. The owner will proofread it before launch.") speaks to the owner, not a visitor. `faq.4.a` ends with a similar sentence ("Machine-written translations should be proofread by someone who knows the language."). Once the owner has reviewed the Telugu, Hindi and Kannada strings (the review loop: `npm run i18n:export`, `npm run i18n:import -- <csv>`, `npm run i18n:status`):
1. replace `langs.note` (and soften `faq.4.a`) with wording for visitors, or remove the note;
2. run with `PUBLIC_LAUNCH_REQUIRES_REVIEWED=1` (`npm run i18n:status` must exit 0: today it exits 1 with 525 draft strings, which is the intended gate);
3. **wire that flag into the build** (an open proposal: today `i18n:status` is a separate script; the `build` script is a security-adjacent file and a separate proposal to the owner and Claude 1).

## f. The product name is decided and "(working name)" is removed

`design/brand.ts`: `BRAND_NAME = "Sme-AI (working name)"`. Change it once (the page, the title, the metadata and the header all read it; `design/brand.test.ts` and `components/v2/landing/LandingView.brand.test.tsx` prove that one edit renames everything). Also check: the `<title>` of `app/layout.tsx` ("SME AI Revenue Engine", the root layout, not touched by the port) and the legacy screens' titles still carry the old product name; decide whether they follow. Re-check the Kannada/Telugu/Hindi renderings of the new name (the word joiner in `BRAND_TEXT` avoids a bad hyphen break; a new name may need its own handling) and the hero line breaks, because the Kannada first-screen fit is tight (`audit:landing`).

## g. Privacy policy, terms and contact become real pages for a real legal entity

Keys `foot.privacy`, `foot.terms`, `foot.contact` are plain text labelled "(placeholder)"; `priv.*` makes statements about data handling. Before launch: a real legal entity exists; a privacy policy that matches what the product actually does (DPDP review is a T012 item: `docs/pre-pilot-checklist.md`), terms, and a working contact route; the three labels become links to those pages and lose "(placeholder)". Also the early-access control (`early.*`, `components/v2/landing/EarlyAccess.tsx`) is a "coming soon" placeholder that sends and saves nothing: when it becomes a real form it collects personal data, so it needs a purpose statement, consent wording, the data-minimisation review and a server action with its own security-tier review and tests (not part of a styling change). `hero.note`, `faq.6.a`, `priv.3.d` ("not had an independent review yet") and `early.body` talk about invitation-only access: keep them true.

## h. noindex is removed only after a to g

Today the page sets `robots: { index: false, follow: false }` in `generateMetadata` (`app/landing/page.tsx`, shared by "/" through the re-export in `app/page.tsx`; the test `app/landing/page.test.tsx` and `app/page.test.tsx` assert it). Removing it is one edit in that function plus those two assertions, **after** a to g. When it is removed, decide separately: an Open Graph image (none today by decision), structured data (none today by decision), a sitemap and `robots.txt` (none exist). `audit:landing` currently fails if the page is not noindex (`structure` check); change that expectation in the same commit.

## Before the checks above can be trusted

Run, from `apps/web`, after a fresh `npm run build`: `npm run audit:landing` (and `-- --engine webkit`, `-- --engine firefox`), `npm run audit:leaks`, `npm run audit:budget`, `npm run i18n:status`. These are local only (not in CI). Also still open from Stage 2: the root layout preloads Geist fonts that no v2 page uses (52,396 B per visit; a change to `app/layout.tsx` for lane A or the owner).
