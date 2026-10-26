# ADR 0101: the website can be live while the app stays closed (job DQ, part 1)

Status: built on branch `web/dq-site-live` (night run 27 Oct 2026).

## Context
The public website (home, the three business pages, plans, contact, the legal texts) is ready to go live on stack19.com. The app is not: sign-up is closed on purpose (job DH) and real data is not accepted yet. The site's buttons ("Start trial", "Sign in") lead into the app, and the pages were set to `noindex` until a launch switch that is baked into the build (`NEXT_PUBLIC_SITE_LIVE`).

## Decision
1. **One setting, read at request time: `SITE_MODE=website`** (a Cloud Run variable; no rebuild). Anything else is the usual behaviour.
2. **What is served:** the home page, the business types' pages, plans (the pricing page), contact, privacy, terms and data deletion. How it works, security and help are not served (404, no link to them from anywhere): they explain a product people can use, and the owner's list for the website has none of them.
3. **What is closed:** every address that starts with `/app`, and `/login`, `/signup`, `/setup`, `/auth/...`. The proxy rewrites them to `/opening-soon` ("Opening soon — book a demo", with the same form as the home page) before any session is read, so nothing of the sign-in code runs. `/landing` (an alias of `/`) redirects to `/`. The service worker is not registered and the manifest opens `/`.
4. **Buttons:** every "Start trial" and "Sign in" becomes "Book a demo" and goes to the form (`#demo` on a page that has it, the contact page's from any other). The trial sentence under the hero gives way to "Opening to businesses soon".
5. **The form** (`WAITLIST`): name, business type, city, phone or e-mail, language (en, te, hi, kn, ta, ml), and a SEPARATE marketing box that is never ticked for the visitor. It posts to C1's `POST /v1/public/waitlist` (contract-dpdp.md) with the notice version it read from `GET /v1/privacy/notice`; the API stores the consent, given or not, with that version and the time. A hidden field is the bots' trap; a per-address limit counts the tries (the API has its own).
6. **Search engines:** robots.txt, the sitemap and each page's `robots` meta are open when the response is served from `stack19.com` or `www.stack19.com` in website mode (or when the old launch switch is on). Any other address, staging included, is always closed, so staging needs no setting of its own. robots.txt and the sitemap are rendered per request for this reason.
7. **No claim we cannot prove:** the website says nothing of where data is stored, of GST in prices, of a "most popular" plan, of customers or testimonials; prices stay "at launch". A test renders every served page in four languages and refuses those phrases.

## Consequences
- Going live is two settings and a DNS change; going back is one setting (`go-live-website.md`).
- The app, its API and its database are untouched by the mode: they are simply not reachable through the web service while it runs in website mode.
- The privacy text still says "stored in India (Mumbai)" in a sentence of the notice: job DQ part 2 replaces the notice with per-processor facts read from the API.
