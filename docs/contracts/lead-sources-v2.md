# Lead sources v2 and speed to lead: the shapes (C1 to C2, 15 Nov 2026)

Owner, Track D: every way of getting enquiries has the same card (connect, test, status, last lead received, disconnect); every lead is de-duplicated by phone and carries its source; the speed-to-lead rules are editable per source. These are the FINAL shapes; build the UI against them. Everything already on main (`GET /lead-sources/cards`, `/outreach/policy`, `/outreach/rules`, `/outreach/source-costs`, `/outreach/reports`) keeps its fields: this file only ADDS.

## a. `GET /v1/tenants/{id}/lead-sources/cards`

Order: `website, missed_calls, meta, click_to_whatsapp, indiamart, email_forward, google_ads, sheets, files, whatsapp`. Card ids (closed): `website`, `missed_calls`, `meta`, `click_to_whatsapp`, `indiamart`, `email_forward`, `google_ads`, `sheets`, `files` (Excel, a pasted list, phone contacts), `whatsapp` (the WhatsApp connection itself).

Today's fields stay (`kind`, `title`, `status`, `headline`, `detail`, `received_7d`, `last_received_at`, `action`, `problem`, `available`). Added to every card:

| field | type | meaning |
|---|---|---|
| `state` | `connected` \| `waiting` \| `needs_attention` \| `paused` \| `off` | the one word for the badge. `waiting` = connected, no lead yet. `off` = not connected or not available. (`status` keeps its old words for the current UI.) |
| `received_count` | int | leads in the last 7 days (same as `received_7d`) |
| `received_total` | int | leads ever from this source (test leads never count) |
| `last_lead_at` | ISO time \| null | same as `last_received_at` |
| `can_test` | bool | the Test button is shown and works |
| `can_disconnect` | bool | the Disconnect link is shown |
| `test_label` | string \| null | what Test does, in words ("Send a test lead to your Leads") |
| `cost_source` | string | the lead tag to send to `PUT /outreach/source-costs` for this card (meta -> `meta_lead_ads`, website -> `website_form`, sheets -> `google_sheet`, files -> `excel_upload` ...); the current value is read with `GET /outreach/source-costs` under that tag (`ad_cost` was dropped from the card) |

## b. Test, disconnect

`POST /lead-sources/cards/{kind}/test` (Owner or Admin; 30 per hour per business) returns

```json
{ "ok": true, "kind": "meta", "result": "lead_created", "message": "A test lead arrived from Facebook and Instagram lead ads.",
  "lead": { "lead_id": "…", "name": "Test lead (Facebook and Instagram lead ads)", "source": "meta" } }
```

`result` (closed): `lead_created` (a test lead went through the real intake path), `reachable` (the address/webhook answers, nothing created: Google Ads, Sheets), `key_valid` (IndiaMART key accepted), `waiting_for_provider` (we sent the request, the provider has not answered yet: Meta's testing tool; the card turns `waiting`). A test lead is tagged `is_test`, has a +00 test number and the name above, is NEVER called or messaged by speed to lead, never counts in reports or `received_total`, and the lead page offers "Remove test lead". No real data.

Errors (HTTP 409 unless noted, body `{code, message}`; closed words): `not_connected`, `not_available` (switched off for this business), `source_paused`, `provider_rejected` (422: the key or token is refused), `provider_unreachable` (502), `nothing_to_test` (the kind has no test, `can_test` was false), `rate_limited` (429).

`POST /lead-sources/cards/{kind}/disconnect` (Owner) revokes the key/token/webhook secret, keeps every lead already received, returns the card (`state: off`). The assistant uses the same two calls ("connect my IndiaMART" opens the card's connect step; "test my website form").

## c. New kinds and how a lead arrives

`website` (embed snippet + webhook URL per business), `missed_calls` (an unanswered/missed call on the business number becomes a lead; needs phone calls switched on), `meta` (Lead Ads webhook + leadgen retrieval), `click_to_whatsapp` (an inbound WhatsApp that carries an ad referral becomes a lead tagged "Instagram/Facebook ad"), `indiamart` (CRM key, polling), `email_forward` (JustDial and portal e-mails, one address per business), `google_ads` (lead form webhook), `sheets` (Google Sheet link, rows become leads). Every lead: de-duplicated by phone, `source` = the card kind, ad/campaign name when the provider gives one (`campaign`), cost per lead from the owner's `source-costs`, consent basis "enquired" (reply about their enquiry; no promotions).

## d. Speed-to-lead rules (one view over today's stores, no second store)

`GET /outreach/speed-to-lead` and `PUT /outreach/speed-to-lead` (Owner; sensitive, the second factor as for `/outreach/policy`):

```json
{ "default": RULE, "per_source": { "meta": RULE | null, "website": RULE | null, "…": null } }
RULE = {
  "enabled": true,
  "in_hours":    { "action": "call", "call_within_minutes": 2 },
  "after_hours": { "whatsapp_now": true, "call_at_minute": 570 },
  "retries":     { "max_attempts": 3, "gap_hours": 4, "then_whatsapp": true },
  "handoff":     { "hot_lead": true, "to": "owner" | "<member user id>", "reminder_minutes": 15 }
}
```

`null` for a source = it follows `default`. Ranges: `call_within_minutes` 1 to 120; `call_at_minute` 540 to 720 in steps of 15 (570 = 09:30); `max_attempts` 1 to 6 (3 = the first call and two retries); `gap_hours` 1 to 48; the calling hours and the per-day call limit are the existing settings and always apply. It reads and writes `/outreach/policy` (workspace values) and the per-source `/outreach/rules` rows; nothing else stores it. Every lead keeps an outcome and a reason (`/leads/{id}/touches`).

## e. Cost per visit per source

`GET /outreach/reports` gains, per `by_source` row: `leads`, `visits` (visits booked from leads of that source in the period), `cost_per_lead_paise` (the owner's entry, null if none), `spend_paise` (`leads × cost_per_lead`, null if none) and `cost_per_visit_paise` (`spend ÷ visits`, null if no cost entered or no visit). Test leads are left out. The owner enters the cost per lead with the existing `PUT /outreach/source-costs`.


## Status of the slices (15 Nov 2026)

* Slice 1, website form: the card fields above, `POST /lead-sources/cards/website/{connect,rotate,test,disconnect}`, `leads.is_test`, the Leads badge counts open leads only (new or in review, not test).
* Kinds still `coming_soon` (card shown, no connect yet): missed_calls, click_to_whatsapp, google_ads. `meta`, `indiamart`, `email_forward`, `sheets`, `files` keep their old connect flows; `can_test` and `can_disconnect` are false for them until their slice.
* Slice 2, missed calls and Google Ads lead forms: both are cards with `POST /lead-sources/cards/{missed_calls,google_ads}/{connect,rotate,test,disconnect}`. `connect` and `rotate` answer the card plus `connect: {type: "copy", shown_once: true, fields: [{label, value (the address), secret: true}], steps: [3 short steps]}`: the address is shown ONCE (only its hash is kept); lose it and make a new one. The phone company (missed-call or hang-up callback: fields From / CallFrom / Caller, CallUUID / CallSid as the id) or Google Ads (the lead form's webhook: `user_column_data`, `lead_id`) POSTs to that address, the same door as the website form. Test = one test row through the source's real intake (`public.lead_source_test_lead`, Owner or Admin, no secret needed). Disconnect kills the address. The cards read `not_available` (409) when the API has no public address configured.
* Slice 3, Click-to-WhatsApp: the card `click_to_whatsapp` is `connected` ("On") whenever the business's WhatsApp is connected, `off` otherwise; nothing to connect, no Test (the test is tapping one of the owner's own ads), no Disconnect. A WhatsApp message that carries an ad `referral` (source_type "ad": `source_id`, `headline`, `ctwa_clid`) adds an arrival tagged `click_to_whatsapp` (once a day per lead) with the message "Instagram/Facebook ad: <headline>" and sets the lead's campaign to the headline (`public.wa_ad_referral`, channel principal only; migration 20261231910000). Cost per lead: `cost_source` `click_to_whatsapp`.
