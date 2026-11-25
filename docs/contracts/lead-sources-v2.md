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

Built as described below, with these facts: `connect` checks the key with IndiaMART first (nothing is stored for a refused key: `422 key_rejected`; `429 rate_limited`; `502 provider_unreachable`), the body is only `{key}` (anything else is 422, and the key is never echoed in an error). `test` answers `{ok, kind: "indiamart", result: "key_valid"|"key_rejected"|"rate_limited", message, lead: null}` (the test label is "Check your IndiaMART key"). `disconnect` deletes the key from the database row and from Secret Manager (`workspace_secret_clear`, migration 20261231920000). The card's "Pull now" is `POST /lead-sources/indiamart/pull`. A scheduled pull (worker switch `INDIAMART_PULL`, off by default; migration `20261231992400`, `app/lead_sources/indiamart_pull.py`) does the same by itself every 15 minutes for a workspace with its own key and the real-data gate open: the same buyer twice is one lead (IndiaMART's own query id), and a key IndiaMART refuses turns the card to `status: needs_attention` with `problem.code: key_expired` (headline "Needs a new key", fix `paste_key`) until a new key is saved.

* `POST /lead-sources/cards/indiamart/connect` (Owner or Admin). Body `{ "key": "<CRM key from IndiaMART Lead Manager>" }`, 20 to 64 characters of letters, digits, `-`, `_`, `=`. The server asks IndiaMART for a one-hour window with that key; a rejected key answers `422 {code: "key_rejected", message: "IndiaMART did not accept this key. Check it in Lead Manager > Import/Export Leads."}` and nothing is stored. An accepted key goes to the workspace secret store (never returned, never logged, never read by the assistant) and the card answers `state: "connected"` with `last_checked_at`.
* `POST /lead-sources/cards/indiamart/test`: asks IndiaMART again with the stored key. Answer `{ result: "key_valid" | "key_rejected" | "rate_limited", checked_at }`. It creates no lead.
* `POST /lead-sources/cards/indiamart/disconnect`: deletes the key and sets the source `disconnected`; every lead stays.
* NOT BUILT YET, the scheduled pull: today the owner's key is used by the existing manual pull (`POST /lead-sources/indiamart/pull`); the 15-minute worker is a later step, so for now the card has a "Pull now" that calls that route. New enquiries arrive through the same intake as every other source (de-duplicated by phone, tag `indiamart`, consent basis `enquired`). A key that stops working turns the card `needs_attention` ("IndiaMART no longer accepts the key") with the `paste_key` action again.
* Until the operator switches it on, the card reads `coming_soon` as today.

### Slice 5: e-mail parser (JustDial, Sulekha, 99acres, MagicBricks, Housing and other portals) — BUILT (15 Nov 2026)

The card's `test_label` is "Send a test portal e-mail to your Leads" ALWAYS (also when the card is off, and `can_test` is then false): the web uses a non-null `test_label` as its switch for the once-only address. `/connect` answers 409 `not_available` while the inbound mail domain is not configured. The test answer is `{ok, kind, result: "lead_created", portal, message, lead}`; `portal` is the portal whose format the sample matched.

* `POST /lead-sources/cards/email_forward/connect`: answers the card plus `connect: {type: "copy", shown_once: true, fields: [{label: "Your lead e-mail address", value: "leads+<token>@<inbound domain>", secret: true}], steps: [3 short steps]}`; only the token's hash is kept (lose it: `/rotate`).
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

## A repeat enquiry is a new enquiry (17 Nov 2026, migration 20261231980500)
A submission from a customer the shop already knows (same phone, else same e-mail), through a LIVE source (website form, webhook, Meta, IndiaMART, a portal mail, Google Ads), is no longer merged silently:
* it is an arrival of kind `again` on that customer's lead (a pasted or uploaded list still makes a quiet `repeat`, and starts nothing);
* a lead the shop had closed (Lost) is reopened (New); a lead in progress is not moved;
* it fires the source's standing rule like a new lead (the same consent, quiet hours, calling hours, caps). One rule item per arrival; no second ladder while an earlier item of the same lead is still open; each item has its own `arrival_at`;
* Today's needs-you has an item of kind `enquired_again` (target: the lead, `ref`: the source tag) until a person handles it (types a reply, places a call, presses Done, or opens the lead; an automated send or a rule's call does not count), for three days at most, once per customer;
* silent only for a true duplicate: the same lead, the same source, the same words (case, spaces and punctuation ignored; two empty messages are the same) within 10 minutes. It is not stored; the API logs `row N not stored: duplicate_within_10_min` and the intake counts it as `already_imported`. The old "same words the same day" rule is gone. A row that carries the source's own external id (Meta leadgen id, IndiaMART query id) is a duplicate only by that id.
* The worker's live intake answer carries `again` (how many were enquiries again) and `problems` (`[{row, reason}]`, closed words) next to `counts`.

## The Website form carries consent per lead (17 Nov 2026, migration 20261231982100)
* The hosted form (`GET /v1/lead-intake/{token}/form`) and the snippet (`snippet_html` of `GET /lead-sources/website`) have a REQUIRED checkbox `consent` (value `yes`) with the words "I agree that {business} may call or WhatsApp me about my enquiry" ({business} is the workspace's name; an address that is not live says "this business"). The name is HTML-escaped.
* A submission that ticked it is stored WITH its consent in the same transaction, as a Meta lead form's is: phone and WhatsApp consent granted (basis explicit consent, evidence `web_form`), and an evidence row in `lead_consent_evidence` (`source_tag` `website_form`, the wording shown, the checkbox name, the tick, the time). The wording stored is ALWAYS the server's: a sender cannot choose it. A customer who said STOP is never re-consented by a tick.
* A submission without the tick (an old embed, a form tool that does not send the field, a plain API call) stays ask-first: stored, no automatic WhatsApp or call. A form tool may send `consent` as `yes`, `true`, `on`, `1` (form field or JSON); anything else is no tick. The Test button's lead never carries consent.
* Embeds pasted before today have no checkbox: the owner pastes the new snippet again (Website form card, "Show the form") to start collecting consent.
* The worker's API reads the business name through `scheduler_lead_form_info(token_hash)` (worker account only).


## Card words as codes (18 Nov 2026, planner + C2)
Every lead-source card now carries `text`: for each English sentence a reference `{code, params}` (or null). The web holds the words in each language and falls back to the English field when it does not know a code. Cards: `text.headline`, `text.detail`, `text.action`, `text.test_label`, `text.problem_message`, `text.problem_fix`. The answer of `connect` / `rotate` also has `connect.step_codes` (`connect.<kind>.<n>`, the same steps in the same order) and the answer of `test` has `message_text` (`test.lead_created` with `params.kind`; the other results are already the closed word `result`). Parameters: `n` (a count) for `detail.leads_this_week`, `detail.chats_this_week`, `detail.sheets_linked`. A test fails when a card says a sentence without a code, so a new sentence needs a new code.

| code | English fallback |
|---|---|
| `action.email_forward_copy` | Copy your address |
| `action.files_add` | Add a file or a list |
| `action.google_ads_copy` | Copy the address for Google Ads |
| `action.google_ads_resume` | Resume Google Ads leads |
| `action.indiamart_connect` | Paste your IndiaMART key |
| `action.meta_connect` | Continue with Facebook |
| `action.missed_calls_copy` | Copy the address for your phone company |
| `action.missed_calls_resume` | Resume missed-call leads |
| `action.open_google_sheets` | Open Google Sheets |
| `action.open_integrations` | Open Integrations |
| `action.open_sheets` | Open my sheets |
| `action.resume` | Turn back on |
| `action.sheets_link` | Link a sheet |
| `action.website_copy` | Copy the form |
| `card.coming_soon` | Coming soon |
| `card.connected` | Connected |
| `card.connecting` | Connecting |
| `card.linked` | Linked |
| `card.needs_a_look` | Needs a look |
| `card.needs_new_key` | Needs a new key |
| `card.not_connected` | Not connected |
| `card.not_linked` | Not linked |
| `card.nothing_added` | Nothing added yet |
| `card.on` | On |
| `card.paused` | Paused |
| `card.ready` | Ready |
| `detail.chats_become_leads` | New chats become leads by themselves |
| `detail.ctwa_connect_wa_first` | Connect WhatsApp first: then a chat that starts from your Instagram or Facebook ad becomes a lead |
| `detail.none_this_week` | No new leads this week |
| `detail.nothing_7d` | Nothing received for 7 days |
| `detail.sheets_paste_link` | Paste the link of a Google Sheet: every new row becomes a lead |
| `detail.wa_connect_in_integrations` | Connect it in Integrations: new chats become leads by themselves |
| `detail.wa_connecting` | Waiting for WhatsApp to finish connecting |
| `detail.waiting_first` | Waiting for the first lead |
| `off.email_forward` | Your portal leads arrive here by e-mail. Ask us to switch this on. |
| `off.google_ads` | Leads from your Google Ads lead forms. Ask us to switch this on. |
| `off.indiamart` | Paste your IndiaMART key here. |
| `off.meta` | Facebook and Instagram lead ads will connect here. |
| `off.missed_calls` | Missed calls become leads when phone calls are switched on. |
| `off.website` | A form for your website. Ask us to switch this on. |
| `problem.indiamart_key_expired` | IndiaMART no longer accepts your key, so no new leads are coming in. A key lasts 7 days: paste a new one and they start again. |
| `problem.sheet_needs_attention` | A Google Sheet you linked cannot be read now. Open it and check that it is still shared and has the same columns. |
| `problem.source_paused` | This is paused, so no new leads come in. |
| `test.email_forward` | Send a test portal e-mail to your Leads |
| `test.google_ads` | Send a test Google Ads lead to your Leads |
| `test.indiamart` | Check your IndiaMART key |
| `test.missed_calls` | Send a test missed call to your Leads |
| `test.website` | Send a test lead to your Leads |

## Website and webhook consent needs its evidence (owner decision, 18 Nov 2026; migration 20261231984500)
* The hosted form and the pasted snippet now carry a hidden field `consent_text` (the exact wording they show: "I agree that {business} may call or WhatsApp me about my enquiry"). A post with `consent` yes AND that wording stores the consent as before. An OLD pasted snippet (no hidden field) no longer records consent: the lead stays ask-first until the owner pastes the new snippet.
* A connected tool (webhook, a form builder) that sends `consent: true` is believed only with `consent_text` (the wording the person saw, 10 to 800 characters) AND `consent_at` (when they agreed: ISO 8601, not in the future, at most 30 days old), and may add `consent_form` (the form or page name, up to 80 characters). Stored in `lead_consent_evidence` (`disclaimer_text`, `consent_given_at`, `form_name`). Without them, or with a time that does not fit: ask-first, nothing is consented, the lead is still created.
* The Website card help sentence (the web holds the words): "If your form tool sends a consent tick, it must also send the exact words the person saw (consent_text) and when they agreed (consent_at, for example 2026-11-18T10:30:00Z), and may add the form's name (consent_form). Without them the person stays ask-first: no automatic call or WhatsApp until they agree." Short form: "A consent tick counts only with the wording the person saw and the time they agreed; otherwise we ask first."


## Portal leads arrive by themselves and say which portal (owner decision, 25 Nov 2026: "forwarded e-mail is not a good idea, it should be automatic")

* **The lead's source is the real portal.** A mail to the lead e-mail address is read by `portals.parse_mail`; the portal it names (`indiamart`, `justdial`, `sulekha`, `tradeindia`, `99acres`, `magicbricks`, `housing`) goes in the row as `tag`, and the intake tags the arrival and the lead with it (migration `20261231992410`, which also adds the tags `sulekha` and `tradeindia` to `lead_tag_ok`, `call_back_proof` and `outbox_active_conversation`). A mail no portal is recognised in keeps the source's own tag `email_forward` (the web shows it as "Portal e-mail", not "Forwarded e-mail"). Only a mail source and a web-address source take a tag from the row; a website form never does, and a tag outside the seven is ignored. The Lead sources e-mail card counts all seven tags.
* **The way in.** First: the owner sets the address as the e-mail that receives leads in the portal's own account settings (nothing to send on by hand). Second, only when the portal can mail only the owner's Gmail: one Gmail rule made once (`GET /lead-sources/portals` returns `mail.steps` and `mail.gmail_rule`, the exact Gmail filter steps).
* **`GET /lead-sources/portals`** (Owner, Admin) answers `{note, portals: [{id, name, tag, how, state, ways, steps?, docs, ask_text}], mail: {steps, gmail_rule}}`. `how` is `automatic` (IndiaMART only) or `account_manager`, whose `state` is the fixed sentence "Available through your portal account manager"; `ask_text` is the short message the shop's owner sends the portal's team (what to ask for: a lead API or webhook to the owner's address). `{WEB_ADDRESS}` and `{MAIL_ADDRESS}` in it are shown as a plain pointer here, because the addresses are shown once: the web writes the real ones in when it holds them.
* **IndiaMART Push API** (switch `INDIAMART_PUSH`, off by default): IndiaMART documents that a seller sets a web address in Lead Manager (Import/Export Leads, the three dots, Push API, choose Other, paste the address, confirm an OTP) and that IndiaMART then POSTs each new lead as JSON (`CODE`, `STATUS`, `RESPONSE` with `UNIQUE_QUERY_ID`, `SENDER_NAME`, `SENDER_MOBILE`, `SENDER_EMAIL`, `SENDER_CITY`, `QUERY_MESSAGE` ...), retrying until it gets an HTTP 200. A web-address lead source (kind `webhook`) is that address; with the switch on it understands that body (plain, wrapped in an outer object, a list), tags the lead `indiamart`, de-duplicates by `UNIQUE_QUERY_ID` and answers **200** (every other lead post answers 202). It is a paid IndiaMART add-on and IndiaMART deactivates it when the address refuses leads for 48 hours.
* **What the research found (25 Nov 2026).** Only IndiaMART publishes, for sellers, a way to set up lead delivery on their own (Pull API with the CRM key: built; Push API: built). For JustDial, 99acres, MagicBricks, Housing.com, Sulekha and TradeIndia no public developer documentation of a lead API or webhook for a business was found; the CRM vendors' own guides all say the portal's account manager switches it on from the portal's side. So those six have no connector: they show the honest state above, the e-mail way, and the message to send. TradeIndia shows an "Inquiry API" (User ID, Profile ID, API key) in the seller's account but publishes no documentation of it, so nothing is built on a guess.
* **Documents behind this** (all public pages, read 25 Nov 2026):
  * IndiaMART Push API: https://help.indiamart.com/knowledge-base/integration-of-indiamarts-lead-manager-crm-push-api-with-third-party-crms-real-time-push-of-leads
  * IndiaMART Pull API: https://help.indiamart.com/knowledge-base/lms-crm-integration-v2
  * JustDial, set up by the account manager (a CRM vendor's guide): https://help.leadsquared.com/integrate-justdial-with-leadsquared/ and https://support.kylas.io/portal/en/kb/articles/how-to-integrate-justdial-to-get-leads-in-kylas-crm
  * 99acres push, activated by 99acres: https://support.sell.do/support/solutions/articles/6000068700-99acres-integration and https://docs.neodove.com/admin-portal/integrations/99acres-integration
  * MagicBricks push, activated by MagicBricks: https://brixi-docs.pages.dev/integrations/lead-providers/magic-bricks and https://help.leadsquared.com/?p=16722
  * TradeIndia Inquiry API credentials (no TradeIndia documentation found): https://support.kylas.io/portal/en/kb/articles/how-to-integrate-kylas-crm-with-your-trade-india-account-to-capture-leads
  * Sulekha and Housing.com: nothing public found.
* **Switches:** `INDIAMART_PUSH` (api) and `INDIAMART_PULL` (worker), both off by default; see `docs/runbooks/hosting-env-and-secrets.md`.
