# Runbook: the public website, its languages and going live (jobs BS and CM)

The public site is server-rendered, in four languages, at addresses that carry the language: English is unprefixed (`/pricing`, `/construction`), Telugu, Hindi and Kannada have a prefix (`/te`, `/te/pricing`, `/hi/construction`, `/kn/security`). `/` is the English home page, or the language of the `sme_lang` cookie if there is one; `/landing` is the same page, always `noindex`. Telugu, Hindi and Kannada are machine-written drafts and every page says so at the top (`draft.banner`). Decisions: ADR 0086.

## The pages
| Address | What it is | Words from |
| --- | --- | --- |
| `/` | hero, the business-type cards (pack switcher), the owl team, three steps, trust strip, pricing teaser, FAQ | `i18n/strings/site.json` and the bundle's cards |
| `/<slug>` (`/textiles`, `/construction`, `/education`) | one business type: hero, the problem, a day in the business, features, plan fit, FAQ; plus `calculator` (construction), `fee_preview` and `children_promise` (education) | that type's `packages/packs/<id>/landing.json` |
| `/pricing` | trial, Starter, Growth, Business, done-for-you, the founding offer, fair use | prices in `apps/web/lib/site/plans.ts`, words in `site.json` |
| `/how-it-works`, `/security`, `/contact`, `/help` | as named; the help index lists seven topics (no separate articles yet) | `site.json` |

A business type's page exists because its folder has a `landing.json` (schema `packages/packs/landing.schema.json`, checked by `make packs-check`). **The web names no business type**: the cards, the page, the menu and the sitemap come from the generated bundle `apps/web/lib/site/site-packs.generated.json`. After editing any `landing.json` (or a pack's names) run **`make site-packs`** and commit the result; `make packs-check` and a unit test fail when the bundle is stale. The page's address is the landing's `slug` (the construction pack's id is `construction_materials`, its page is `/construction`).

## Our WhatsApp number and the lead forms
There is **no backend for website leads yet** (no table, no route, no consent record), so nothing a visitor types is stored. The contact form and the calculator's "Get exact quote on WhatsApp" check the input on the server (a server action: consent ticked, a name, the calculator's numbers worked out again), count the try against a per-address hourly limit, and hand back a `wa.me` address of **our own** number with the message filled in; the visitor's own WhatsApp opens and *they* press send. So a lead reaches Stack19 as a WhatsApp message into its own workspace. When a public lead API exists (a later backend job: a table, a route, a consent record, a business that has opted in to receive enquiries), the two server actions in `apps/web/app/site-actions.ts` are the only places to change.

Set on the server (never `NEXT_PUBLIC_`, so the number is not in any page's HTML until a visitor asks for the chat):

```
STACK19_WHATSAPP=919876543210     # digits with the country code; unset = the pages say chat is not set up and show no button
SITE_LEAD_MAX_PER_HOUR=10         # optional; the tries one address may make in an hour (default 10)
```

## What is on the pricing page
The numbers are in one file, `lib/site/plans.ts` (30-day trial, Starter 499, Growth 1,499, Business 3,999, done-for-you 2,999, in rupees, GST included), never inside a text. **Billing is off** and the page says so. The plan limits and the founding offer are *not* stated (the pricing decision document was not available to job CM): the founding offer text says "details on WhatsApp"; fair use is described as a meter with no number. When the owner decides them, edit `plans.ts` and the `price.*` strings; the tests forbid a percentage or a count in the text.

## The calculator
`/construction` has the public paver calculator. It uses the same calculator as the app's quote builder, **imported, not copied**: `packages/quote-engine/ts/construction.ts` through the path alias `@quote-engine/construction` (`tsconfig.json`, `vitest.config.mts`; `deploy/Dockerfile.web` copies `packages/quote-engine/ts`). Blocks, pallets and truck trips (and an amount before GST and transport only when the visitor typed their own price). The paver types and their numbers are in the construction `landing.json` (`calculator` block), not in code.

## Search engines: the launch switch
Until launch the pages say `noindex`, `robots.txt` turns every crawler away and the sitemap is empty (owner decision of 2026-10-07). Titles, descriptions, canonical addresses, language alternates and share pictures are already there. To go live, set at build time (public values, shipped to the browser):

```
NEXT_PUBLIC_SITE_URL=https://<the real address>
NEXT_PUBLIC_SITE_LIVE=1
```
Then the pages say `index, follow`, `/robots.txt` allows the public pages and keeps `/app`, `/auth`, `/api`, `/login`, `/signup`, `/setup`, `/landing` closed, and `/sitemap.xml` lists every page in every language with its alternates (hreflang `en-IN`, `te-IN`, `hi-IN`, `kn-IN`). The home page and a business type's page carry schema.org data (`FAQPage`, and a `SoftwareApplication` with its plans as offers) in a `<script type="application/ld+json">`; it is data, not executable script, so the nonce CSP does not apply, and `<` is escaped (the one allowed use of raw HTML, pinned by `test/guards.test.ts`).

## Share pictures
`npm run og:images` draws, with Chromium (from `e2e/node_modules`), `public/og/og-<lang>.png` (4) and `og-<slug>-<lang>.png` (12, in the business type's accent colour) from the plush owl and the page's own headline (`hero.h1` in `site.json`, or the landing's hero). Commit the PNGs when a headline, the owl or a colour changes; `lib/seo/seo.test.ts` checks all 16 exist at 1200 x 630.

## Checks
* `make check-fast` (unit tests of every page in every language, the routes, the server actions, the islands, the generated bundle, the honesty rules of the words).
* `npm run audit:landing [-- --path /pricing]` (real Chrome on `next start`: one h1 and heading order, landmarks, share picture, canonical and alternates, valid JSON-LD, no horizontal scroll at 360 to 1440 px, text >= 14 px, contrast, targets >= 44 px on a phone, a Tab-key walk, 0 CSP violations and 0 console warnings, four languages, light and dark). Run it once per page that changed.
* `npm run audit:route-js` (the first-visit JavaScript ceilings, `apps/web/scripts/budget.json`); `make perf` (Core Web Vitals on slow 4G); `make visual`.
* Screens of every page: `make site-shots` (to `~/Desktop/v2-overnight/shots-cm/`).
