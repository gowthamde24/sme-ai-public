# Runbook: the public page, its languages and going live (job BS)

The public page is `/` (English; the language of the `sme_lang` cookie if there is one) and, at addresses of their own, `/te`, `/hi` and `/kn` (the language is in the address, so a link can be shared and a search engine can tell them apart). `/landing` is the same page, always `noindex`. The words are in `apps/web/i18n/strings/landing.json`; Telugu, Hindi and Kannada are machine-written drafts and the page says so at the top (`draft.banner`).

## What is on the page
Hero with Agent OWL (the plush owlet: its still picture from the server, the layers loaded when the page is idle) and an example conversation labelled "Example, not real data" > **For your shop** (six jobs) > **Your WhatsApp number stays safe** (six habits the app really has: consent first, stop means stop, daily limit and quiet hours, money talk waits for the owner, messages say an AI assistant wrote them, one switch for automatic sending) > **How it works in three steps** > Languages > Privacy > **Pricing** > FAQ > footer with the Privacy Policy, Terms of Use and Cookie settings.

Pricing: the prices are the plain placeholder **`[PRICE]`** (two places in `price.shop.p` and `price.note`); fair use is a **meter in percent**, never a count of questions, and the page has no number in its pricing text (a test pins it). To fill the price in: edit `price.shop.p` and delete `price.note` (and the matching test lines) in `landing.json`.

## Search engines: the launch switch
Until launch the pages say `noindex`, `robots.txt` turns every crawler away and the sitemap is empty (owner decision of 2026-10-07). The titles, descriptions and share pictures (the owl, 1200 x 630, one per language) are already there, so a link sent to a person shows the owl. To go live, set at build time (they are public values, shipped to the browser):

```
NEXT_PUBLIC_SITE_URL=https://<the real address>
NEXT_PUBLIC_SITE_LIVE=1
```
Then the pages say `index, follow`, `/robots.txt` allows `/`, `/te`, `/hi`, `/kn`, `/privacy`, `/terms` and keeps `/app`, `/auth`, `/api`, `/login`, `/signup`, `/setup`, `/landing` closed, and `/sitemap.xml` lists the pages with their language alternates (hreflang `en-IN`, `te-IN`, `hi-IN`, `kn-IN`, `x-default`). Each page has its own canonical address.

## Share pictures
`npm run og:images` draws `public/og/og-<lang>.png` with Chromium (from `e2e/node_modules`) from `scripts/assets/owl.svg` and the page's own headline (`hero.h1`). Commit the PNGs when the headline, the owl or the brand colour changes; `lib/seo/seo.test.ts` checks the four exist at 1200 x 630.

## Checks
`npm run audit:landing` (real Chrome on `next start`: one h1 and heading order, landmarks, the share picture, canonical and alternates, no horizontal scroll at 360 to 1440 px, text >= 14 px, contrast, targets >= 44 px on a phone, a Tab-key walk, 0 CSP violations and 0 console warnings, four languages, light and dark). Lighthouse (mobile, simulated slow 4G, run on a build with the launch switch on): see the job BS report.
