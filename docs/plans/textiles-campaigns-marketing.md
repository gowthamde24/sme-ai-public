# Textiles campaigns and per-customer marketing consent: the plan (15 Nov 2026) — APPROVED by the owner on 15 Nov, with the addition below

Owner's instruction (15 Nov): saree and textile shops are a core campaign user (new collection, festival offers) to customers who opted in only; campaigns must be ON for textiles; keep the consent rules: marketing only to customers with marketing consent, approved marketing templates only. This is the plan to approve BEFORE the build. Nothing here sends anything real: staging keeps the sandbox fence, production stays OFF.

## What is true today
* Textiles pack version 1 (published, the default) is the ONE pack without the `campaigns` module (13 other packs have it). It was published before the module existed and was left out when the eleven lead packs got version 2.
* The campaign engine (ADR 0084 part 3, ADR 0086) is REMINDERS ONLY: its kinds are payment due, delivery update, fee due, event, exam, holiday, and each needs a module textiles does not have. So switching the module on alone shows an empty screen.
* Consent is per CHANNEL on a contact (`whatsapp_consent`, `phone_consent`, `email_consent`: unknown / granted / withdrawn), never per PURPOSE. A WhatsApp message to a customer who wrote to the shop is allowed as a service message; marketing needs more.
* Meta already separates the two: a `marketing` template category is priced and policed differently, and the first templates `followup_nudge` and `catalogue_share` are marketing (drafts, not yet submitted).

## Built already (branch `c1/textiles-campaigns`, not pushed)
* Textiles pack version 2 = version 1 + `campaigns`, default for new workspaces; the 2 existing textiles workspaces are moved to version 2 by a second migration (a shop keeps its pack, only the version moves).

## Design
1. **Marketing consent, per customer.** New columns on `contacts`: `marketing_consent` (unknown | granted | withdrawn, default unknown), `marketing_consent_at`, `marketing_consent_via` (a closed word: whatsapp_reply, form_tick, owner_recorded, import_with_proof) and the existing opaque evidence reference pattern (no free text). Unknown means NO marketing, always.
   * Granted by: the customer's own WhatsApp reply to an opt-in question ("Reply YES to get news of new collections"), a separate tick on a form (not the service consent), or the owner recording it (verbal or written) with who and when; an import may carry it only with a proof column.
   * Withdrawn by: STOP / "unsubscribe" in en, hi, te, kn (already parsed for service messages; marketing is withdrawn first), the customer's own link, or the owner. Withdrawing marketing never touches service messages (visit and order updates); STOP in general still stops everything.
   * **Owner-recorded consent (owner's addition, 15 Nov): it needs a short "how given" note (free text, clean, at most 160 characters, e.g. "said yes in shop"), WHO recorded it and WHEN; all three are stored with the consent and SHOWN on the customer's page.** Without the note the API refuses (422). The note is the only free text in the consent model.
   * Every change is an audit row (who, when, via), as for the other consents.
2. **A new campaign kind `offer`** (labels: new collection, festival offer), module `campaigns` only, no money amounts, no due date. The message is a fixed approved MARKETING template with STRUCTURED variables: {{1}} first name, {{2}} business name, {{3}} a short collection or occasion label (at most 30 characters, clean text, owner-typed or picked), never free message text. Every marketing template carries "Reply STOP to unsubscribe" in its own words.
3. **Per-message checks** (inside `app.campaign_submit`, on top of every outbox rule: STOP, suppression key, quiet hours, daily limit, kill switch): `marketing_consent = granted` AND the template is `approved` AND its category is `marketing` AND in the contact's language. A frequency cap: at most ONE marketing message per customer in 7 days (owner can lower it, not raise it above 3 a week). A customer without consent is SKIPPED with the closed reason `no_marketing_consent` and counted.
4. **Approval** is the existing one: the Owner approves the whole campaign once with the second factor after seeing the rendered samples; the approval screen also shows how many customers are in, how many are left out and why (no marketing consent / withdrawn / stopped / no WhatsApp), and the estimated Meta cost (the marketing message rate from the price catalogue).
5. **Audience**: customers from the shop's own list (any tag, last purchase, city). The wizard shows the consent state next to each, and a one-tap way to ask for consent (an approved opt-in template, sent only to people who wrote to the shop in the last 24 hours or already granted service consent).
6. **Templates**: `new_collection_offer` and `festival_offer` (en, te, hi, kn) as data in `first_templates.json`, drafts for native review. **The text in all four languages goes to the owner BEFORE any submit; a submit then happens only through the app (the owner's second factor) or a command the owner has seen and said "run it" to.**

## Slices (one PR each, in this order, after #762 / #763 / #765)
| Slice | What | Who | Size |
|---|---|---|---|
| S0 | Textiles pack v2 + repin (done locally; push with S1) | C1 | S |
| S1 | `marketing_consent` columns, set/withdraw functions with audit, STOP handling for marketing, pgTAP | C1 | M |
| S2 | campaign kind `offer`, per-message checks, frequency cap, skip reasons, pgTAP | C1 | M |
| S3 | API (kind, consent endpoints, samples, cost estimate, approval counts), two marketing templates, tests, contract | C1 | M |
| S4 | Web: consent chip and "ask for consent" on Contacts, the offer wizard, the approval screen with counts and cost, Today line | C2 | M |
| S5 | Staging proof with the sandbox number only: consented customer gets it, a customer without consent is skipped, STOP withdraws | C1 | S |

## Decisions I made (reverse any of them)
* Marketing consent is separate from service consent and defaults to unknown (no marketing).
* One marketing message per customer per week by default.
* Variable {{3}} is a short label, not free text; no price, discount or link inside a template (Meta's review and our own rule).
* The whole campaign is approved once by the Owner with the second factor (the reminder-campaign rule), not message by message.

## Not in this plan
* Any real send, any production change, broadcast to numbers that never wrote to the shop, a consent text for customers (the wording of the opt-in question is a draft for the owner and the lawyer, like every privacy text).
