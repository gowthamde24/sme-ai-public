# Offer campaigns and marketing consent: the API (campaigns S3, 17 Nov 2026)

Plan: `docs-private/plans/textiles-campaigns-marketing.md`. Database: S1 (`marketing_consent`), S2 (kind `offer`), S3 (migration `20261231979800`). Screens (S4) are C2's. Everything is under `/v1/tenants/{tenant_id}`.

## 1. An offer campaign
`PUT /campaigns/{id}` with `kind: "offer"` is the ordinary campaign call plus two fields:
* `offer_label`: required for an offer, the short label that fills {{3}} of the approved offer template ("Silk sarees", "Diwali"). Tidied (extra spaces), then checked by the same rule as the database: 2 to 30 characters, no link, no price or percent, no "off", "discount", "cashback" (also te/hi/kn words). A refused label is a 422 and never reaches the database.
* `weekly_cap`: 1 to 3 (default 1): at most that many offer messages to one customer in 7 days.
* A label or cap on any other kind, or a call step on an offer, is a 422.
* `message_text` of an offer must be the approved offer template's words with `{{name}}`, `{{business}}`, `{{label}}` (else the issue `text_not_template` blocks approval). `wa_template_id` is an approved template whose purpose is `offer` (`GET /whatsapp/templates`).
* The answer's `campaign` carries `offer_label` and `weekly_cap`; `back_to_draft` is true when a change to an approved offer sent it back to draft (the label and the cap are content).

## 2. Who is on the list
`POST /campaigns/{id}/recipients/consented` `{due_date, q?}` (Owner, Admin, Sales; offers only): adds every customer who **said yes to marketing**, has not said STOP, has a number and is not erased; with `q` only those whose name contains it (any case, at most 60 characters). `due_date` is the occasion's day (the steps count from it). The answer is `{added, skipped:[{row, reason}], recipients}`; reasons: `duplicate`, `no_lead`, `list_full` (5,000). An approved campaign goes back to draft. The ordinary `POST /campaigns/{id}/recipients` (by contact id or phone) still works; a customer without marketing consent on it is skipped at send time and counted as left out.

## 3. The approval screen
`GET /campaigns/{id}/preview` → `offer`: `{recipients, will_receive, left_out:{stopped, marketing_withdrawn, no_marketing_consent, no_whatsapp}, cost}` with
`cost = {messages_at_most, paise_each, paise_at_most, rate_source, before_gst}`: the most the offer can cost (one message per step to each customer who will receive it; the weekly cap can only lower it), from the marketing message rate of the rate card (`ops.provider_rates`, Meta, `message_marketing`). `rate_source` is `estimate` until Meta's invoice replaces the rate (today 60 paise a message, **not confirmed**), `before_gst` is always true; both prices are null when the card has no rate. Show it as "about ₹X before GST (estimate)". Samples are the same as for the other kinds (first name, label, the opt-out line).

## 4. Marketing consent
| Call | Who | Answer |
|---|---|---|
| `GET /marketing-consent?q=&state=&after=&limit=` | Owner, Admin, Sales | `{items:[{contact_id, name, phone, state, at, via, by, note, stopped}], counts:{granted, unknown, withdrawn}, next_cursor}`, by name; `counts` cover the whole book, not the page; `state` is `unknown` / `granted` / `withdrawn`; limit 1 to 100; `q` 1 to 60 characters |
| `GET /contacts/{id}/marketing-consent` | same | `{state, at, via, by, note}` |
| `PUT /contacts/{id}/marketing-consent` `{note}` | same | records that the customer said yes: `note` (2 to 160 characters, "said yes in shop") is required; who recorded it and when are kept (`via: owner_recorded`) |
| `POST /contacts/{id}/marketing-consent/withdraw` `{note?}` | same | records that the customer no longer wants offers |

* `unknown` means no marketing, always. Service messages (visit and order updates) are never touched.
* A customer who said STOP (`stopped: true`: STOP, or the staff's own stop) cannot be recorded as a yes: the answer is the contact-suppressed sentence. Withdrawing is always allowed.
* The customer's own "Stop promotions" button withdraws marketing consent only (`via: stop_button`); typed STOP stops everything and withdraws it too.
* The assistant gets these calls as tools like every other operation (`docs/assistant-tools-coverage.md`).

## 5. Not here
Real sending of an offer, the screens (S4), and the staging proof with the sandbox number (S5).
