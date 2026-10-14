# Runbook: the shared ledger and reminder campaigns (job CP, ADR 0086)

For the owner or the support person setting up payment, fee or delivery reminders, and for the next developer. Everything here is local and uses synthetic data. **The money rule is ACCEPTED by the owner but not yet confirmed by the lawyer: no workspace is opened to real customer data for a campaign with amounts before that** (`docs/pre-pilot-checklist.md`, "Reminder campaigns and the shared ledger").

## 1. What must be true before a campaign can send

| Needed | Where it comes from |
|---|---|
| the module `campaigns` and the kind's own module | the business type (construction: payment due, delivery update; education: fee due, event, exam, holiday). A textile business has none |
| an **approved** WhatsApp template of purpose `reminder`, in the campaign's language, with one variable `{{1}}` and words around it | `PUT .../whatsapp/templates/{id}` (purpose `reminder`), then Meta's decision with `POST .../whatsapp/templates/{id}/status` |
| the global outbox switch on, and the business's **automatic sending** on | the operator (`platform_flags.outbox_enabled`) and `PUT .../outbox/settings` |
| the scheduler worker running | `docs/runbooks/scheduler-local.md` (`make dev-worker-local`): its tick now has a campaign phase |
| each person: a contact with a phone, a suppression key (the API records it) and WhatsApp consent or a history of writing to you | otherwise that person's message is blocked, honestly (`no_opt_in`, `no_key`) |

## 2. Make a campaign

1. **Save the draft**: `PUT /v1/tenants/{t}/campaigns/{id}` with the name, the kind, the language, the template id, the **text** (only `{{name}}`, `{{amount}}`, `{{due_date}}`, `{{reference}}`, `{{business}}`; one line; no link; no promise or complaint word), the **steps** (at most five: `{"offset_days": -3, "time": "10:00"}`, in order; negative is before the person's date, 0 the day itself; the time is India time and must be outside the business's quiet hours) and, for a money kind, an optional **call plan** (`call_after_step`, `call_wait_hours`). The same id again changes it.
2. **Build the list**, either way (both may be used):
   * **import**: `POST .../campaigns/{id}/recipients` with rows `{contact_id | phone, due_date, amount_paise?, reference?}` (up to 5,000; a phone number only finds an existing contact of this business). The answer lists each refused row with a closed reason: `duplicate`, `contact_not_found`, `ambiguous_contact`, `amount_required`, `reference_required`, `amount_not_allowed`, `no_lead`, `list_full`, `invalid_row`.
   * **from the ledger**: `POST .../campaigns/{id}/recipients/from-ledger` with `{"due_from", "due_to"}` (at most 400 days), optionally `party` (`company` or `contact`) and `min_open_paise`. One person per account: the open total of the claims in the range, the earliest due date. A company's reminder goes to its first contact with a number (`no_contact` otherwise).
3. **Look at it**: `GET .../campaigns/{id}` lists what still stands in the way (`issues`, each with a fixed sentence); `GET .../campaigns/{id}/preview` gives the count, the total, the dates and the **rendered samples** (the first, the longest, the highest amount, three at random) with `samples_sha256`.
4. **The Owner approves** (`POST .../campaigns/{id}/approve`, body `{"samples_sha256": "<the hash you were shown>"}`, second factor required). Nothing is sent by this: the steps are planned. A step already in the past is skipped (`past`).
5. **Change your mind**: any change to the text, the steps, the template, the language, the call plan or the list sends the campaign **back to draft** and cancels the planned steps (a new name does not). Approve again after looking again. **Pause**, **resume** and **cancel** are the Owner's or Admin's (`POST .../pause|resume|cancel`); a resume skips steps more than a day late (`missed`).

## 3. What the worker does

Every tick, for each business whose both switches are on: for each planned step whose time has come (oldest first) it checks that the campaign is still exactly what the Owner approved (else nothing is sent and it goes back to draft), that the person is still open, that the template is still approved, and, for a list made from the ledger, that they still owe the amount (`paid`, `balance_changed`); then it hands the rendered text to the outbox with a message id derived from (campaign, person, step, date). The outbox applies STOP, consent, the suppression key, quiet hours (a message made in the evening waits for 09:00), the daily limit and the kill switches. The channel then sends it as usual.

## 4. The call list

After step N and the waiting hours: a person who did not reply, has not paid and can still be called becomes an item (`GET .../call-list`; the number is never shown). Start the call through the existing bridge with the item's `call_request_id` (Owner or Admin; 09:00 to 21:00 India time), then record what happened (`POST .../call-list/{id}/outcome`): `paid`, `promised` (with `promised_on`), `call_later` (with `call_after`), `wrong_number`, `stop` (puts the person on the do-not-contact list for everything).

## 5. Results

`GET .../campaigns/{id}/results`: counts by state (planned, skipped, held, waiting, sent, delivered, read, failed, blocked), by reason (`stopped`, `no_opt_in`, `daily_limit`, `paid`, `promised`, `missed`, ...), by India day; how many wrote back; how many paid after a reminder and how much; who was closed and why; the call list's counts. Nothing is stored: it is read from the outbox, the WhatsApp status table and the ledger.

## 6. The ledger

* Record: `PUT .../ledger/entries/{id}` (charge: with a due date; payment: with a method, gets a receipt number; adjustment and concession: Owner or Admin with a second factor, with a reason code). Import fees or invoices: `POST .../ledger/charges/import`. A payment can be set against a charge (`against_entry_id`), but credits always go to the oldest claim first.
* Read: `GET .../ledger/statement?company_id=|contact_id=` (balance, credit, age since the entry and days past due, what is overdue, the open claims), `.../ledger/summary` (everyone who owes, the largest first), `.../ledger/entries`, `.../ledger/receipts/{id}`.
* Void: `POST .../ledger/entries/{id}/void` (Owner or Admin). A voided receipt keeps its number.
* Construction's `/dues/...` routes are the same ledger for companies, unchanged.

## 7. What you see when something is refused

| You see | It means |
|---|---|
| 403 `module_off` | the module is off for this business (textiles: no campaigns; construction: no fee kind) |
| 403 `mfa_required` | approving, a concession, an adjustment or a void of one needs the second factor |
| 409 `campaign_not_ready`, `reason` | the first thing in the way: `no_recipients`, `no_template`, `template_not_approved`, `template_language`, `template_purpose`, `bad_field`, `amount_not_allowed`, `link_not_allowed`, `line_break`, `text_words`, `recipient_missing_amount`, `recipient_missing_reference`, `step_in_quiet_hours`, `call_plan_invalid`, `no_future_step` |
| 409 `samples_changed` | the campaign changed since you looked at the samples: look again |
| 409 `campaign_state` | not allowed in this state (for example approving twice, editing a cancelled campaign, recording a different outcome on a finished call) |
| 409 `invoice_number_used` | that invoice number is used by a live charge |

## 8. Limits you should know

* One text and one language per campaign. A reminder before and after the date is the same words with the date in them.
* A list that was **imported** is not checked against the ledger; only one made **from** the ledger is. A call outcome closes a person on any list.
* A guardian (a contact with no company) cannot be sent a campaign yet: they have no lead (`no_lead`). Job CR decides.
* An attestation for an imported list is not built: a person with no opt-in or history is blocked and counted as `no_opt_in`.
* The worker hands over at most 50 steps per business per tick (a minute), and the outbox releases about 100 messages per tick: a step due for 5,000 people takes over an hour to go out. That is the only pacing there is (see the checklist row on WhatsApp quality); a step more than a day late is skipped, not sent.
* A Kong container that was started before job CN's fix keeps a stale mail template after `db-reset`: `make agent-db-down` then `make agent-db-up` once.
