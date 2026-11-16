# Speed-to-lead rules v2: template-only WhatsApp, a faster retry ladder, a truthful summary, language "auto" (plan, 15 Nov 2026)

From the owner's screenshots of the Rules "Change" form (22:20 CET). Plan first, then the build, then "retest". Staging only; nothing real is sent (sandbox fence, fake dialer).

## What is wrong today (verified in the code)
1. The rule has a free-text field `message_text` ("The WhatsApp message"). A phone call does NOT open WhatsApp's 24-hour window (only a customer's own inbound WhatsApp does), so a message after a call or after hours must be an approved template; free text is allowed only inside an open window. Today the lead rule falls back to the `lead` template only when nothing else names one (migration 20261231970000) and the owner's typed text is what fills the single variable of old templates.
2. Retry spacing is ONE workspace number, `retry_gap_hours` (default 18, 1 to 48), `max_attempts` 3: a missed lead is called again tomorrow. For speed-to-lead that is too slow.
3. The sentence "What happens to a new lead: Call within a few minutes" is fixed words in the web, not driven by the minutes field.
4. The rule's language must be picked (en, te, hi, kn, ta, ml); there is no "same as the lead".

## Design
### 1. Templates, never free text (C1 DB + API, C2 form)
* Rule gets two template choices: `wa_first_template` (the first message: after hours, or when the first call could not even start; default `lead_ack`) and `wa_missed_template` (after the last unanswered call; default `missed_call_followup`). Both are NAMES; the language is the lead's (see 4), so one name covers en, te, hi, kn.
* `message_text` is no longer accepted on a rule (422 `template_required`, plain words); old rules keep their column, unused. The API checks that the chosen name exists in the workspace's templates; the database refuses a rule whose WhatsApp channel has no template names.
* Send path: the outbox message carries the template name; `app.wa_send_context` picks that name in the lead's language when it is `approved`; the variables are the structured ones already built (first name, business name). Inside an open 24-hour window the message goes as the template's own rendered text (the same words, no free text). With no approved template in that language the message fails `template_required` and the item says so on Today (nothing is sent).
* Preview: `GET /outreach/rules/preview?within_minutes=&language=&wa_first_template=&wa_missed_template=` returns the plan lines AND each template's text in the language with sample values (Ravi, the business name) and its status (approved / draft / not submitted), so the form shows "pick a template + preview" and a warning when it is not approved yet.

### 2. Retry ladder (C1 DB + API, C2 summary)
* Default for lead rules: call at arrival + the minutes; no answer: retry after 10 minutes, then after 2 hours, then the next morning at 09:30 (`night_call_minute`); all inside the calling hours (a due time outside them moves to the next window start); after the last unanswered call the WhatsApp template `wa_missed_template`, then stop. That is 4 calls at most. A "no" or STOP stops it at once (unchanged).
* Stored in the policy as `retry_steps` (array of `{after_minutes: n}` or `{next_morning_minute: 570}`; named `retry_steps`, not `lead_retry_ladder`, to match the screen), default as above, Owner-editable with the second factor like the rest of the policy. Batches keep `retry_gap_hours`.
* `GET /outreach/rules` rows and the preview answer carry `plan.steps`: `[{kind: "call", at: "arrival", minutes: 0}, {kind: "retry", after_minutes: 10}, {kind: "retry", after_minutes: 120}, {kind: "retry", at: "next_morning", time: "09:30"}, {kind: "whatsapp", template: "missed_call_followup"}]` so the screen can write the whole summary from data.

### 3. The summary follows the fields (C2)
"Call immediately" for 0, "Call within n minutes" for n, then the ladder lines from `plan.steps`, then the template names with their status. No fixed sentence.

### 4. Language "same as the lead / business language" (C1 DB + API, C2 select)
* `language: "auto"` is the new default. Resolved at call and message time: the lead's own language (the form's language answer, else the script of their name, else the number's state) when it is one we speak; otherwise the business language (the assistant's main language); a Telugu shop therefore gets Telugu. English stays a choice.

## Slices (one PR each)
| Slice | Content | Who |
|---|---|---|
| R1 | migration: `outreach_rules.language` accepts `auto`, `wa_first_template`, `wa_missed_template`; policy `lead_retry_ladder`; `outreach_rule_save` and the item scheduler use them; `wa_send_context` picks by name; pgTAP | C1 |
| R2 | API: RuleIn (template names, `auto`, no `message_text`), rules list with `plan`, the preview route, tests, contract in speed-approvals.md | C1 |
| R3 | Web: template pickers with preview and status, the summary from `plan.steps`, language default | C2 |
| R4 | Staging proof (fake dialer, a no-answer result per step) with the times of each retry; then I say "retest" | C1 |

## Decisions I made (reverse any of them)
* One first-message template and one missed-call template per rule, picked by name, not per language.
* The ladder lives in the policy, not in each rule; the rule summary only shows it.
* "auto" resolves to the business language when the lead's own is unknown.
* `lead_ack` and `missed_call_followup` must be approved by Meta before the WhatsApp steps send; until then the step is skipped and shown (nothing is sent as free text).

## Built (R1 + R2, 16 Nov 2026)
Migration `20261231975000_rules_v2.sql`, API `GET /outreach/rule-templates`, `plan` and `warnings` on every rule, `retry_steps` on the policy, contract in `docs/contracts/speed-approvals.md`. Differences from the plan, all decided here (reverse any):
* `GET /outreach/rules/preview` was not built: the form needs `rule-templates` (status + preview) and `plan.steps` on the rules, which the screen already uses.
* `channel: "call"` = calls only, nothing is sent; `channel: "both"` = calls and the two templates (the old wording "WhatsApp if they ask for it" no longer fits: nothing is sent because the customer asks on a call any more, since a call opens no window).
* The first message goes after hours AND when the first call fails to start; the missed-call message after the last unanswered call. A step with no consent, or no APPROVED template in the lead's language, is recorded as `blocked` and the lead moves on (nothing sent as free text).
* This amends the 5 Nov "after the last unanswered call: stop, never an automatic WhatsApp" and "after hours: nothing sent now" for rules with `channel: "both"` (the owner asked for it on 15 Nov). `channel: "call"` rules keep the 5 Nov behaviour exactly.
* The weekly calls-per-customer limit no longer counts the calls of the same item (otherwise the 4-call ladder would stall at the default limit of 2 a week); other lists and rules still count.
* Language `auto` looks at the contact's `preferred_language` answer, then the script of the name; the number's state is not used (no table for it).
