# Call settings: the API contract for Settings > Calls and a campaign's call settings (job DP, part 4)

**Status: the shapes are final for the web; the endpoints are built on branch `api/dp-call-settings`.** Until they are on a deployed API, build against the example payloads (`packages/contracts/call_settings.examples.json`, validated against the schema by a test).

Files (generated from `services/ai-api/app/callsettings/models.py` by `make contracts`; a test fails if they are stale):
`packages/contracts/call_settings.schema.json` (source of truth), `call_settings.ts`, `call_settings.examples.json`.

## What it is
How the AI assistant behaves **on the phone**, as data: retries, parallel calls, voicemail and phone menus, silence, the longest call, interruption, listening sounds, pronunciations, key words, calling hours and holidays, how often one customer may be called, when to pause by itself, who takes over for which topic, memory, and what it may phone about. **One setting per workspace**, plus a per-**campaign override** of the parts that differ there; everything not overridden is inherited. Until the owner saves, the API returns the **defaults of the business type**, so the screen can be skipped. **Telephony does not exist yet: nothing here places a call.** The settings are what a dialer will read (`effective`).

**The school rule** (owner decision, 25 Oct 2026): a school makes no sales calls and none about dues or fees. `locked.allowed_purposes` lists the only purposes a school may switch on (`admission_followup`, `visit_reminder`, `event_reminder`); show the others as switched off, not as choices. The API answers 422 `locked_for_business_type` (and so does the database) otherwise. No child data anywhere.

## Endpoints (JSON, errors `{error: {code, message}}`)
Base `/v1/tenants/{tenant_id}/call-settings`.

| Method and path | Who | Answer |
|---|---|---|
| `GET /` | Owner, Admin | `CallSettingsOut` |
| `PUT /` | **Owner, second factor** | body `CallSettings` (every field, always) -> `CallSettingsOut` |
| `GET /campaigns/{campaign_id}` | Owner, Admin | `CampaignCallSettingsOut` |
| `PUT /campaigns/{campaign_id}` | **Owner, second factor** | body `CallSettingsOverride` (null or absent = inherit; `{}` removes the override) -> `CampaignCallSettingsOut` |
| `DELETE /campaigns/{campaign_id}` | **Owner, second factor** | removes the override -> `CampaignCallSettingsOut` |

Errors: 403 `mfa_required` (save without a second factor), 403 `workspace_read_only` (the plan ended), 404 (a campaign that is not this workspace's), 422 (a value out of range; the body names the field), 422 `locked_for_business_type`.

## The fields (`CallSettings`)
| Field | Meaning and range | Default (textiles) |
|---|---|---|
| `retry_busy`, `retry_no_answer`, `retry_call_later` | `{count 0..5, gap_minutes 5..1440 in steps of 5}`; `count` 0 = never retry. "call later" = the customer asked but named no time | 2 x 30 min, 3 x 120 min, 2 x 60 min |
| `concurrent_calls` | 1..20 calls at once (a plan may allow fewer; the dialer applies the lower) | 1 |
| `detect_voicemail`, `voicemail_action` | `hang_up` / `leave_message` (short, never prices) / `retry_later` | on, `retry_later` |
| `detect_phone_menu`, `phone_menu_action` | `hang_up` / `retry_later` | on, `hang_up` |
| `silence_timeout_seconds` | 3..30 | 8 |
| `max_call_seconds` | 30..1800 in steps of 30 | 300 |
| `interruption_sensitivity` | `low` / `medium` / `high` | `medium` |
| `listening_sounds` | "hmm", "okay" while listening | true |
| `pronunciations` | up to 50 of `{written, spoken}` (shop and product names); a name once | [] |
| `keywords` | up to 100 words the speech recognition should expect (2..40 characters) | [] |
| `hours` | `{days [1..7], from_minute, to_minute}` (09:00 = 540 to 21:00 = 1260, steps of 15) or **null = follow Settings > AI assistant** (`assistant_hours` shows what that is) | null |
| `holidays` | up to 60 dates (`YYYY-MM-DD`, from yesterday to 400 days ahead) on which it never calls | [] |
| `max_calls_per_customer_per_week` | 1..14 | 2 |
| `auto_pause_refusals_per_hour` | 3..100: pause the campaign when the carrier refuses this many calls in an hour; **null = never pause on its own** | 10 |
| `contact_memory` | remembers earlier conversations with this customer (a school's default is off) | true |
| `handover` | up to 8 of `{topic, person_name, phone}`; a topic goes to one person; topics `pricing` `payment` `delivery` `complaint` `visit` `other`; phone `+` and 7..15 digits. **The name and number are personal data (a team member's): show them only to Owner and Admin, never in a list others see.** | [] |
| `allowed_purposes` | `sales_followup` `payment_reminder` `admission_followup` `visit_reminder` `event_reminder` (see the school rule) | sales, payment, visit |

Strings that are spoken or listened for (`written`, `spoken`, `keywords`, `person_name`) carry no `< > { } @ / \ |` and no control characters.

## Per campaign (`CallSettingsOverride`)
Every field above except `holidays`, `handover` and `allowed_purposes` can be overridden; a **list override replaces** the workspace's list for that campaign (an empty list = none). To switch the automatic pause **off** for one campaign send `auto_pause_off: true` (null in `auto_pause_refusals_per_hour` means "inherit", so it cannot say "off"). `CampaignCallSettingsOut.effective` is what a dialer applies: `settings` (merged), `hours` (resolved, with `source` = `campaign` | `workspace` | `assistant`) and `overridden` (the field names the campaign changed, so the screen can mark them "different here").

## Screen suggestions
Settings > Calls: group as *Trying again* (retries), *On the line* (voicemail, menu, silence, length, interruption, sounds), *Names and words* (pronunciations, keywords), *When* (hours, holidays, per-week limit), *Safety* (auto-pause), *Hand-over*, *Memory*. Use `options` for the labels and descriptions of the closed words. The campaign screen shows only an "Edit call settings for this campaign" link with the `overridden` fields marked. Label draft: the option texts are English drafts; the screen words are yours.
