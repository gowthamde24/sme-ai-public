# Jobs, slice S2: the job page (C1 -> C2), 20 Nov 2026

Behind the API flag `JOBS` (404 `not_found` on every route below while it is off, before sign-in is even looked at). Everything is under `/v1/tenants/{t}`. Contract: `jobs-contract-DRAFT.md` FINAL 1.0 sections 0 to 3, 14 to 16 and `jobs-contract-1.1-part1.md`. A job owns no rows: every value below is read from, and written to, the SAME subsystem the old screens use, so the old screens, the old routes and the assistant always agree with the job page.

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
* `results`: `numbers` is `{called, picked_up, visits}` for speed_to_lead (the last 7 days, from the outreach report); `{}` for the other kinds; `items` is `[]` for all in v1.
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
| | more | `from_hour`, `to_hour` | `09:00` to `21:00` on the half hour | the assistant's calling hours (Settings > AI assistant) |
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

`say_ai_when_greeting` (docs/contracts/greeting-disclosure.md): `business` follows the business setting. The page's `says` follow it. **Real calls do not read the per-job override yet**: calls still read the business setting only (the call paths take no job); until they do, the override changes the page's preview only. The honest answer when a customer asks is not a setting.

## PATCH `enabled`, `POST pause/resume`

`enabled` is the underlying switch, written through the old function; it never creates an approval and `resume` never restarts what stopped for another reason.

* `speed_to_lead`: pause stops every rule that is on; resume turns on the rules the OWNER paused. A rule paused by the plan (`billing`) or a limit (`cap_calls`, `cap_minutes`) is not restarted by a tap. With no rule at all nothing happens and the job says `not_set_up`. `enabled` reads true only when ALL rules are on, so a pause is always sent (it stops the ones still on).
* `answer_calls`: the Owner's assistant (Pause / Go live of "My assistant"). Owner only (Admin: 403). `409 held_by_support`, `409 assistant_not_ready` (with `missing`). The job reads `enabled` true only when the line is switched on as well (which support does after the first test call), so a resume can leave it `paused` with `line_not_switched_on`.
* `offers`: the offers that are approved or running pause; the ones that are paused resume. A reminder campaign is never touched.
* `followups`, `store_visits`, `researcher` have no switch in the code base (a policy, the visit hours and the monthly search have no off): a PATCH or pause/resume whose `enabled` would change the value is `409 job_not_switchable`; the same value is a no-op (200).

## PATCH `name` and `finds_out`

`name`: the owner's own name for the helper (`public.job_meta_set_name`). Empty, only spaces or `null` clears it. A name with only digits, a web address, an e-mail address or a phone number, or longer than 40 characters, is `422 name_invalid`. The fresh page has the new `custom_name` and a new `says`. `finds_out`: `{key: boolean}` of the kind's closed keys; a key that is not the kind's is `422 setting_invalid` with `fields: ["finds_out.<key>"]`. The job's row is made the first time it is needed (by a write; a read never makes it).

Order inside one PATCH: everything is checked first (settings, finds_out keys, name length, whether the switch exists); then settings, switch, name, finds_out are written. The first refusal of a subsystem (a role, the second factor) is the answer and stops the rest; what was written before it stays (each part is its own subsystem's write).

## `needs_you`

`GET /jobs/today` `needs_you` is Today's own list (the same service reads the same rows, shaped by the caller's role): `[{id, code, kind, at, target: {type, id}}]`. `kind` is Today's word, unchanged; `code` is the same word. `target.type` is `order | lead | call_request | approval | message` where Today's type has such a word (enquiry -> lead; quote, material_quote, campaign, outreach_batch, outbox_message -> approval; phone_call -> call_request); one with no word in the list (`fees`, `billing`, `calls`) is sent as Today sends it.

`Job.needs_you` (in `/jobs`, `/jobs/today`, the page) counts the items that are about that job: speed_to_lead = hot_lead_waiting, outreach_paused, call_approval; answer_calls = person_requested; followups = followup_due, enquired_again, message_needs_change; store_visits = visit_requested; offers = campaign_approval. An item that is about no job (a quote, an order's money) is in the list and counted by none. A job that is `running` and has something waiting is `waiting`. If Today cannot be read the list is empty and the counts are 0.

## Not in this slice

The settings the contract names that have nothing behind them in the code base are not offered (no fake): answer_calls' "only when I don't / always", its hours and after-hours choice (no forwarding fallback exists), follow-up channel, store_visits' reminder and confirmation choices, the offer's "who / when / language", the researcher's area, `next_morning`. Results items, results of the other kinds, `effect.inputs`, `rupees` and `pace_per_hour` are empty by design in v1. Starting a job (`POST /jobs`, plans, suggestions, test calls) is S3.
