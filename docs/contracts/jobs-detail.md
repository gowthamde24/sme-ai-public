# Jobs, slice S2: the job page (C1 -> C2), 20 Nov 2026

Behind the API flag `JOBS` (404 `not_found` on every route below while it is off; the workspace door comes first: sign-in, membership, role and the read-only gate). Everything is under `/v1/tenants/{t}`. Contract: `jobs-contract-DRAFT.md` FINAL 1.0 sections 0 to 3, 14 to 16 and `jobs-contract-1.1-part1.md`. A job owns no rows: every value below is read from, and written to, the SAME subsystem the old screens use, so the old screens, the old routes and the assistant always agree with the job page.

The job id is `uuid5(workspace, kind)`: the same on every call, never stored, different in every workspace. An id that is not one of THIS workspace's jobs (another workspace's, invented, not a uuid) is `404 not_found`. A `researcher` for a business type that never has the Lead Finder (a school) is 404 as well.

## Routes

| Route | Who | Answer |
|---|---|---|
| `GET /jobs/{id}` | every member | `JobDetail`, with an `ETag` (`If-None-Match` gives 304) |
| `PATCH /jobs/{id}` | Owner, Admin | `{enabled?, name?, settings?, finds_out?}` -> the fresh `JobDetail` |
| `POST /jobs/{id}/pause`, `POST /jobs/{id}/resume` | Owner, Admin | the `Job` (same as `PATCH {enabled}`) |
| `GET /jobs`, `GET /jobs/today` | every member | now carry the owner's `custom_name` and the real `needs_you` (below) |
| `GET/POST /jobs/{id}/faqs`, ... | as S1 | the id may now be the Job's own id (it is turned into the job's row); the row's own id still works |

Sales and Viewer read; a write by either is `403 forbidden`. A write that needs the second factor (below) answers `403 mfa_required` until the code is entered; pausing never needs it.

## JobDetail

`Job` (as in `GET /jobs`) plus:

```
business_name   string                                   the workspace's name
what_it_does    {code}                                   code = the kind (the web holds one sentence per kind)
says            [{language, channel: call|whatsapp, text}]
when            {from_hour: "HH:MM"|null, to_hour: "HH:MM"|null, days: ["mon".."sun"], pace_per_hour: null}
settings        {main: [Setting], more: [Setting]}       at most 4 in main
effect          {inputs: {who: null, event_at: null, booked_at: null}}
finds_out       [{key, enabled: boolean}]
faqs            [{id, question, answer}]
results         {days: 7, numbers: {key: n}, items: []}
failure         {code, params: {count}, items: []} | null   (only when the job has a `fix`)
test_channel    "call" | "whatsapp"
cost            {minutes_used: int, minutes_included: int|null, rupees: null}
Setting         {key, type: "choice", value: string|null, options: [string]} | {key, type: "toggle", value: boolean|null}
```

* `says`: the opening line a call or message really starts with, from the real opening-line function (`app/opening/resolve.py`), with the business name, the job's own name (when set; up to 40 characters, said where the assistant's name would be) and the greeting setting (the job's override, else the business setting, else off: name only). One entry per language (the assistant's main language, then English) and channel the job speaks. Empty (`[]`) when the opening cannot be read, and for the researcher (never a call or message to a prospect). The WhatsApp line is the same opening line as the call (there is no separate WhatsApp opening function).
* `when`: read from where the old screen reads it: speed_to_lead = the assistant's calling days and hours; followups = the policy's days and the end of its quiet time to the start of it; store_visits = the open days and hours (null when the open days differ); the others have no hours (all null/empty). `pace_per_hour` is always null in v1.
* `effect.inputs` are null in v1 (the web uses its own sample for "Ravi's form at ..."); the shape is final.
* `finds_out`: the closed keys per kind (`speed_to_lead`: need, quantity, when, visit; `followups`: still_interested, budget_range; the other kinds none). A key never set is `enabled: false`.
* `results` (`days` is 7; from what the subsystems hold, nothing paid, a part that cannot be read is empty): `numbers` per kind, whole counts: speed_to_lead `{called, picked_up, visits}`; followups `{drafted, approved, sent, waiting}` (drafts made and approved in the 7 days, those marked sent, and the drafts that wait for the owner of any age; "nudges due" is not counted: the due list is a candidates list, not the engine's answer); store_visits `{booked, done, no_show, cancelled}` (visits dated in the 7 days; `booked` = all but cancelled); offers `{sent, replied}` (the offers that went out; sent = sent + delivered + read); researcher `{searches, prospects_found}` and `last_search_at` next to them (contract 15.8; draw the whole numbers only); answer_calls `{}` (not built yet). `items` (at most 5, newest first): `{customer, status: done|waiting|failed|noanswer, detail_code, params, at}`: followups = the drafts (`draft_draft`, `draft_approved`, `draft_recorded_sent`; params `{touch, channel}`), store_visits = the visits (`visit_completed|booked|confirmed|arrived|no_show|cancelled`; params `{date, source}`; completed = done, no_show = noanswer, cancelled = failed). `customer` is the display-name helper's name; "New enquiry" when the person has no real name; never a phone number or an id. offers, researcher, answer_calls and speed_to_lead have `items: []` (a recipient list and a prospect list are their own screens; a prospect's name may cost a Google lookup).
* `cost`: the month's call minutes so far (rounded up) and what the plan includes (`null` = pay as you go or unknown). `rupees` is always `null` until a paid plan's rate is read here.
* A part that cannot be read (the caller's role, a subsystem that is not built here) is empty or `null`, never a failed page. A setting whose current value has no word in `options` (a slot of 25 minutes, hours on a quarter past) reads `null`: draw nothing selected.

## The settings catalogue (server data: `app/jobs/catalogue.py`)

Words are closed; the web holds a sentence for each. A value that is not in `options` (or an unknown key, or a toggle that is not a boolean or "on"/"off") is `422 setting_invalid` with `error.fields = [the keys]`, checked before anything is written. Toggles are booleans on the wire (`"on"`/`"off"` are accepted in a PATCH and answered as booleans).

| Job | Area | Key | Options | Reads / writes (through the old function) |
|---|---|---|---|---|
| speed_to_lead | main | `when` | `right_away`, `after_10_min` | every standing rule's `within_minutes` (0 / 10). `next_morning` is not offered: a rule cannot say it. |
| | main | `language` | `auto`, `en`, `te`, `hi`, `kn`, `ta`, `ml`, `mr` | every rule's language (`auto` = the customer's own) |
| | main | `tries` | `tries_1`, `tries_2`, `tries_3` | the policy's retry steps (the owner's own first, the platform ladder only fills a gap) |
| | main | `thank_you_whatsapp` | toggle | every rule's channel (`both` = call and WhatsApp template, `call`) |
| | more | `from_hour`, `to_hour` | `10:00` to `21:00` on the half hour | the assistant's calling hours (Settings > AI assistant) |
| | more | `say_ai_when_greeting` | `business`, `on`, `off` | the Talk training document (`say_ai_by_job`) |
| answer_calls | more | `say_ai_when_greeting` | as above | (no other setting exists in the code base yet) |
| followups | main | `nudges` | `nudges_1`, `nudges_2`, `nudges_3` | a NEW follow-up policy version (`max_touches` = nudges + 1, `gap_days` has one entry per nudge) |
| | main | `gap_days` | `days_2`, `days_3`, `days_5` | the same new version |
| | more | `say_ai_when_greeting` | as above | |
| store_visits | main | `from_hour`, `to_hour` | `06:00` to `23:30` on the half hour | every OPEN day's hours of the visit settings (a closed day stays closed) |
| | main | `slot_minutes` | `minutes_15`, `_20`, `_30`, `_45`, `_60`, `_90`, `_120` | the visit settings' slot |
| | more | `buffer_minutes` | `minutes_0`, `_10`, `_15`, `_30` | the visit settings' gap after a booking |
| | more | `say_ai_when_greeting` | as above | |
| offers | main | `weekly_cap` | `cap_1`, `cap_2`, `cap_3` | the offer campaign's weekly cap; only while the offer is a draft |
| | more | `say_ai_when_greeting` | as above | |
| researcher | main | `results_per_search` | `results_5`, `_10`, `_20` | the Lead Finder settings |
| | main | `fit_bar` | `fit_60`, `_70`, `_80`, `_90` | the Lead Finder settings |

Refusals of a write: `409 job_not_set_up` (nothing to change yet: no standing rule, no follow-up policy, no offer drafted, no assistant name saved; nothing is ever created by a setting), `409 job_locked` (an approved offer, or a rule saved in an older way: change it on its own screen), `403 mfa_required` (a standing rule, the follow-up policy and the greeting override need the Owner and the second factor, exactly like the old screens; the database decides), `403 forbidden` (the role).

`say_ai_when_greeting` (docs/contracts/greeting-disclosure.md): `business` follows the business setting; `on` / `off` is that job's own word (Talk training document, `say_ai_by_job`). **Every path that speaks to a customer reads it** (S3a): an inbound call is the answer_calls job; a call we place is the job that placed it (a standing rule = speed_to_lead; a task by its template: call_new_leads = speed_to_lead, reengage_old_leads = followups, confirm_appointments = store_visits, offer_invite = offers; any other task, a list the owner approved and the owner's own test call follow the business setting); the assistant's first WhatsApp message in the outbox follows it by its category (`followup` = followups, `visit` = store_visits; the database function `app.outbox_mention_ai(tenant, category)`); the messages of a task follow its template's job. One function decides for all of them (`resolve_greeting_disclosure`, via `greeting.resolved_for_job`), and the page's call lines come from the same function the live call uses (`app/telephony/call_opening.py`): **what a call opens with is the call line of `says`**, for on, off and business (tests per path). What stays the page's own: the WhatsApp line of `says` is the opening line of the opening-line function, and the helper's own NAME (`custom_name`) is shown in that line but a call we place names the business only (the plain outbound opening has no name), so the name does not change a call yet. The AI sentence we append to campaign messages (offers among them), trip updates and the speed-to-lead rule's template messages (migration 20261231987500) follows the BUSINESS setting only: those senders do not know their job yet. The approved template text itself is fixed. The honest answer when a customer asks is not a setting.

## PATCH `enabled`, `POST pause/resume`

`enabled` is the underlying switch, written through the old function; it never creates an approval and `resume` never restarts what stopped for another reason.

* `speed_to_lead`: pause stops every rule that is on; resume turns on the rules the OWNER paused. A rule paused by the plan (`billing`) or a limit (`cap_calls`, `cap_minutes`) is not restarted by a tap. With no rule at all nothing happens and the job says `not_set_up`. `enabled` reads true only when ALL rules are on, so a pause is always sent (it stops the ones still on).
* `answer_calls`: the Owner's assistant (Pause / Go live of "My assistant"). Owner only (Admin: 403). `409 held_by_support`, `409 assistant_not_ready` (with `missing`). The job reads `enabled` true only when the line is switched on as well (which support does after the first test call), so a resume can leave it `paused` with `line_not_switched_on`.
* `offers`: the offers that are approved or running pause; the ones that are paused resume. A reminder campaign is never touched.
* `followups`, `store_visits`, `researcher` (S3a): the switch is the job's own row (`jobs_meta.enabled`, on by default, made on the first switch; `public.job_meta_set_enabled`, Owner or Admin, audited) and **the work reads it in the database**, so a paused job stops whichever door the work comes through: followups = no due list and no new draft (the policy is "not in force for work": `policy_in_force: false`, a new draft answers the existing "no policy" refusal); a draft that already waits can still be approved or discarded; store_visits = no reminder is due, the assistant offers no slots and books no choice (a booked visit stays booked); researcher = no search is planned or approved (409 `prospect_state`; what was found stays). A paused job reads `enabled: false`, `status: paused`, `result {code: "paused_by_owner"}`. `409 job_not_switchable` stays in the closed list but is no longer sent for these kinds.

## PATCH `name` and `finds_out`

`name`: the owner's own name for the helper (`public.job_meta_set_name`). Empty, only spaces or `null` clears it. A name with only digits, a web address, an e-mail address or a phone number, or longer than 40 characters, is `422 name_invalid`. The fresh page has the new `custom_name` and a new `says`. `finds_out`: `{key: boolean}` of the kind's closed keys; a key that is not the kind's is `422 setting_invalid` with `fields: ["finds_out.<key>"]`. The job's row is made the first time it is needed (by a write; a read never makes it).

Order inside one PATCH: everything is checked first (settings, finds_out keys, name length, whether the switch exists); then settings, switch, name, finds_out are written. The first refusal of a subsystem (a role, the second factor) is the answer and stops the rest; what was written before it stays (each part is its own subsystem's write).

## `needs_you`

`GET /jobs/today` `needs_you` is Today's own list (the same service reads the same rows, shaped by the caller's role): `[{id, code, kind, at, customer, summary, target: {type, id}}]` (25 Nov 2026: `customer` = the display name Today shows, `summary` = Today's own one-line text, `at` = when it is due or arrived; **one item per promise**: rows with the same kind, target type, customer and summary are one item, the first kept). `kind` is Today's word, unchanged; `code` is the same word. `target.type` is `order | lead | call_request | approval | message` where Today's type has such a word (enquiry -> lead; quote, material_quote, campaign, outreach_batch, outbox_message -> approval; phone_call -> call_request); one with no word in the list (`fees`, `billing`, `calls`) is sent as Today sends it.

`Job.needs_you` (in `/jobs`, `/jobs/today`, the page) counts the items that are about that job: speed_to_lead = hot_lead_waiting, outreach_paused, call_approval; answer_calls = person_requested; followups = followup_due, enquired_again, message_needs_change; store_visits = visit_requested; offers = campaign_approval. An item that is about no job (a quote, an order's money) is in the list and counted by none. A job that is `running` and has something waiting is `waiting`. If Today cannot be read the list is empty and the counts are 0.

## Not in this slice

The settings the contract names that have nothing behind them in the code base are not offered (no fake): answer_calls' "only when I don't / always", its hours and after-hours choice (no forwarding fallback exists), follow-up channel, store_visits' reminder and confirmation choices, the offer's "who / when / language", the researcher's area, `next_morning`. `effect.inputs`, `rupees`, `pace_per_hour`, answer_calls' results and items for speed_to_lead, offers and the researcher are empty by design in v1. Starting a job (`POST /jobs`, plans, suggestions, test calls) is S3.
