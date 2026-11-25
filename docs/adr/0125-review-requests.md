# ADR 0125: asking customers for a review after a job (proposal, 25 Nov 2026; nothing built)

Status: **proposed**, cheap to build once the owner agrees. Written by C1 so the choice is on paper; no code, switch or migration yet.

## Decision (proposed)
After a job, order or appointment is marked **done**, the Owner sees one extra, optional action: **"Ask for a review"**. It prepares ONE message for that customer with the business's **Google review link** and sends it the way the Owner already sends messages (the outbox: the Owner approves it, and sends it from their own WhatsApp by hand, or through the connected channel). The assistant never sends it on its own, and never asks twice for the same job.

## Rules that keep it honest and legal
1. **No review gating.** Everyone is asked the same way. We never ask "were you happy?" first and send only the happy ones to Google: Google's policy forbids it and it is a form of deception.
2. **No reward.** No discount, credit or gift in exchange for a review, and the message says nothing that suggests one.
3. **Consent first.** Only a customer we may message (the existing consent and do-not-disturb checks), once per job, never inside the quiet hours (21:00 to 09:00 IST), and with the usual "reply STOP" line.
4. **The link is the business's own.** The Owner pastes their Google review link once (Settings > Your business); we check that it is an address at google.com or g.page and store it as plain text. We read nothing back from Google: no star count, no review text, no API key, nothing to scrape.
5. **The words are the Owner's** to edit; the default is two plain sentences in the customer's language (English, Telugu, Hindi), in the no-fill-in-the-blanks style the rest of the app uses.

## What it needs (when approved)
- One column: `business_profile.review_link` (https, google.com or g.page only); one row per ask in the outbox with a `kind = review_request` and a unique key (tenant, job) so a second ask is refused.
- One route, `POST /v1/tenants/{t}/jobs/{job}/review-request` (Owner, Admin) that composes the outbox message; `GET` for the state (asked / not asked / no link yet).
- Web: one button on a done job, one field in Settings.
- Cost: about 2 days API + database with tests, the same for the web. No new provider, no new price.

## Not decided here
Whether to also ask by e-mail (needs the customer's address on the job), and whether the assistant may suggest the ask during a Talk session ("Shall I ask Ravi for a review?"). Both are small once the base exists.
