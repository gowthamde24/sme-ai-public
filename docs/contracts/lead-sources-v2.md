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

## Slices 4 and 5, planned shapes (C1 to C2, 15 Nov 2026; nothing below is built yet: build the UI against it)

Same card object as above (`state`, `received_count`, `received_total`, `last_lead_at`, `can_test`, `can_disconnect`, `test_label`, `cost_source`). New `connect.type` value for slice 4: `paste_key` (the owner types a secret INTO the card; it never goes through the assistant chat).

### Slice 4: IndiaMART with the owner's own Lead Manager key — BUILT (15 Nov 2026; Owner only for connect and disconnect, the database decides)

Built as described below, with these facts: `connect` checks the key with IndiaMART first (nothing is stored for a refused key: `422 key_rejected`; `429 rate_limited`; `502 provider_unreachable`), the body is only `{key}` (anything else is 422, and the key is never echoed in an error). `test` answers `{ok, kind: "indiamart", result: "key_valid"|"key_rejected"|"rate_limited", message, lead: null}` (the test label is "Check your IndiaMART key"). `disconnect` deletes the key from the database row and from Secret Manager (`workspace_secret_clear`, migration 20261231920000). There is no scheduled pull yet: the card's "Pull now" is `POST /lead-sources/indiamart/pull`.

* `POST /lead-sources/cards/indiamart/connect` (Owner or Admin). Body `{ "key": "<CRM key from IndiaMART Lead Manager>" }`, 20 to 64 characters of letters, digits, `-`, `_`, `=`. The server asks IndiaMART for a one-hour window with that key; a rejected key answers `422 {code: "key_rejected", message: "IndiaMART did not accept this key. Check it in Lead Manager > Import/Export Leads."}` and nothing is stored. An accepted key goes to the workspace secret store (never returned, never logged, never read by the assistant) and the card answers `state: "connected"` with `last_checked_at`.
* `POST /lead-sources/cards/indiamart/test`: asks IndiaMART again with the stored key. Answer `{ result: "key_valid" | "key_rejected" | "rate_limited", checked_at }`. It creates no lead.
* `POST /lead-sources/cards/indiamart/disconnect`: deletes the key and sets the source `disconnected`; every lead stays.
* NOT BUILT YET, the scheduled pull: today the owner's key is used by the existing manual pull (`POST /lead-sources/indiamart/pull`); the 15-minute worker is a later step, so for now the card has a "Pull now" that calls that route. New enquiries arrive through the same intake as every other source (de-duplicated by phone, tag `indiamart`, consent basis `enquired`). A key that stops working turns the card `needs_attention` ("IndiaMART no longer accepts the key") with the `paste_key` action again.
* Until the operator switches it on, the card reads `coming_soon` as today.

### Slice 5: e-mail parser (JustDial, Sulekha, 99acres, MagicBricks, Housing and other portals) — BUILT (15 Nov 2026)

The card's `test_label` is "Send a test portal e-mail to your Leads" ALWAYS (also when the card is off, and `can_test` is then false): the web uses a non-null `test_label` as its switch for the once-only address. `/connect` answers 409 `not_available` while the inbound mail domain is not configured. The test answer is `{ok, kind, result: "lead_created", portal, message, lead}`; `portal` is the portal whose format the sample matched.

* `POST /lead-sources/cards/email_forward/connect`: answers the card plus `connect: {type: "copy", shown_once: true, fields: [{label: "Forward portal e-mails to", value: "leads+<token>@<inbound domain>", secret: true}], steps: [3 short steps]}`; only the token's hash is kept (lose it: `/rotate`).
* `POST /lead-sources/cards/email_forward/test`: one canned portal mail goes through the REAL parser; `result: "lead_created"`, a test lead (`is_test`, +00 number) tagged with the portal the parser recognised; the answer also says which portal format matched (`portal`), so the owner sees the parser works.
* `POST /lead-sources/cards/email_forward/disconnect`: kills the address.
* A mail the parser cannot read becomes an entry in `GET /lead-sources/unparsed` (already live) with the sender and the first lines; the card shows how many are waiting and `needs_attention` when more than 3 are.

## Meta lead form consent (15 Nov 2026, built on staging)

* A lead form made with a custom disclaimer and a REQUIRED checkbox (Meta `legal_content.custom_disclaimer.checkboxes`) gives every lead `custom_disclaimer_responses: [{checkbox_key, is_checked}]`. For each Meta lead the API reads the answer and the form's wording (once per form) and the worker stores it with `scheduler_lead_meta_consent` AFTER the arrival: table `lead_consent_evidence` (form id, lead id, wording, checkbox key, `ticked` true / false / null = no checkbox on the form, time).
* Ticked: consent for the phone and WhatsApp channels is granted in the ledger (basis `explicit_consent`, evidence `web_form`, reference `meta_form:<form>-<lead>`). The calling hours, the per-day limit and the quiet hours still apply. Not ticked, or no checkbox: nothing is granted (consent stays `unknown`): the assistant asks first.
* UPDATE (15 Nov, owner decision): the evidence travels INSIDE the lead's row (`consent`) and the database stores it in the SAME transaction as the lead (`scheduler_lead_intake_live` calls `app.meta_consent_apply`), so a ticked lead's intake line reads `ready` with no `no_consent`; an unticked box or no box leaves `no_consent` (ask first). A replay records nothing twice.
* The log line `meta consent: status=recorded,recorded=1,granted=1,ask_first=0` (numbers only) says what happened.

## Speed to lead: first touch in seconds (15 Nov 2026, built on staging)

* A standing rule may say `within_minutes: 0` = IMMEDIATELY: the call is due the moment the lead is stored (1 to 120 were the only values before; the screen's "0 = immediately" option is C2's).
* The first touch no longer waits for the worker's next minute: when a live source stores a NEW lead (`counts.ready > 0`), the API starts the outreach step in a thread at once (`OUTREACH_DIALER` must be set on the API; staging: `fake`). The worker's tick stays as the safety net. The database still decides everything (calling hours, consent, caps, the sandbox fence).
* `public.leads.is_test` now also marks the leads Meta's Testing Tool and test leads make (Meta's "<test lead: ...>" placeholders, Meta's test e-mail addresses, a +00 test number). They are left out of `GET /outreach/reports` and of the cards' counts. A test lead has no dialable number, so no real dialer can reach it; the staging FAKE dialer may place a pretend call for it so the chain can be timed. (This replaces the earlier sentence "never called by speed to lead": the guarantee is the number, and the reports.)
* Log lines (numbers and closed words only): `meta: lead fetched lead_id=...`, `lead intake: status=received rows=1 counts=ready=1`, `outreach: 1 found, 1 calls ...`.

## Speed-to-lead: the first WhatsApp is an approved template (15 Nov 2026)

A new lead has not written to us, so the 24-hour window is closed and Meta allows only an approved template. The lead rule's WhatsApp step (after hours, or when asked) is sent with the template of purpose `lead`
(`lead_ack`, data/first_templates.json, en/te/hi/kn, utility, TWO structured variables since 15 Nov 2026: {{1}} the customer's first name, {{2}} the business name, both filled by the database in `app.wa_send_context` (`template.variables`), never the rule's message text; Meta's samples: Ravi, Sri Lakshmi Silks; no usable name = a plain greeting word of the language). Without an approved `lead_ack` in the lead's language the message fails `template_required`; it is never sent as free text.
Submitting it: Settings → WhatsApp → templates → "Create the first templates" (idempotent) → "Submit all" → wait for Meta's decision (`sync`).
