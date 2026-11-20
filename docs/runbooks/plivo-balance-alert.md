# Plivo balance alert (owner decision, 19 Nov 2026)

Plivo is prepaid and its credit must never run out. Plivo auto-recharge does not exist for India (INR) accounts, so top-ups stay manual (the owner can also set Plivo's own balance e-mails under Payment Settings). This check is the second net: once a day the scheduler worker reads the balance and tells the owner when it is low. **Everything is OFF until `PLIVO_BALANCE_CHECK=true` is set on the worker.**

## What it does (read-only on Plivo)
1. Once per India day (the database says when a read is due; a failed read is tried again an hour later) the worker calls `GET /v1/Account/<auth id>/` on Plivo with the main account's credentials. Nothing is changed at Plivo, ever.
2. It reads `cash_credits` and `auto_recharge`. Plivo's documentation says `cash_credits` is **USD** and the response carries no currency field, so the comparison is configured: `rupees = credits x PLIVO_BALANCE_INR_PER_UNIT` (rate for one unit of `PLIVO_BALANCE_CURRENCY`; with `INR` no rate is used), and the balance is **low when rupees < `PLIVO_BALANCE_MIN_INR` (300)**.
3. The result goes to the database (`ops_plivo_balance_report`). One row per day is kept in `ops.plivo_balance_checks` (day, state, rupees, whether Plivo says auto-recharge is on; no credential, no number).
4. **Low:** ONE "Needs you" item for the platform owner (staff console, Alerts; kind `plivo_balance`; the owner and finance staff see it) that stays open while the balance is low (its words are refreshed by each day's reading), and ONE WhatsApp message a day to `PLIVO_BALANCE_ALERT_TO`, the owner's own number from the environment (never a customer; not an outbox message, so no customer, consent or approval is involved). The message goes through the worker's WhatsApp adapter with an approved utility template from the platform's own number (`WHATSAPP_PHONE_NUMBER_ID`); if the send fails it is tried again on the next tick, and once it has gone there is no second one that day.
5. **Recovery:** when a day's reading is back above the limit the open item is acknowledged by the system (no staff member), so the list is clean.
6. **Could not be read:** six failed tries in one India day raise their own item ("The Plivo balance could not be read today": a wrong key, or Plivo is down).
7. The alert and the message both say whether Plivo reports auto-recharge as on, off or not at all. Nothing here switches it.

## Owner steps (nothing below was done by the build)
1. Create and submit the WhatsApp template in WhatsApp Manager under the platform's own number: name `platform_alert`, category **Utility**, language `en`, body `Stack19 alert: {{1}}` (one variable; example `Plivo balance is low: about Rs 212 left (limit Rs 300). Auto-recharge: off. Top up at plivo.com so calls keep working.`). Wait for Meta's approval.
2. On the worker (Cloud Run job `sme-worker`), after the owner's word to switch it on: `WORKER_OUTBOX_ADAPTER=whatsapp` (already so on staging), and in `WORKER_EXTRA_ENV` `PLIVO_BALANCE_CHECK=true`, `PLIVO_AUTH_ID=<the Plivo Auth ID>`, `PLIVO_BALANCE_CURRENCY=USD`, `PLIVO_BALANCE_INR_PER_UNIT=<today's rupees to the dollar>`, `PLIVO_BALANCE_ALERT_TO=<the owner's own number with the country code>`; in `WORKER_EXTRA_SECRETS` `PLIVO_AUTH_TOKEN=sme-plivo-auth-token:latest` (the worker's service account needs secretAccessor on it: an IAM step, the owner's word). Staging fences WhatsApp to `WHATSAPP_ALLOWED_RECIPIENTS`: the owner's number must be on that list.
3. **First real read (the one check this build could not make):** after the first tick, look at the item or the log line `plivo balance: read, state=...` and compare with the Plivo console. If the console shows rupees for this account, set `PLIVO_BALANCE_CURRENCY=INR` (no rate needed). The amount in the alert is the amount after the conversion.
4. To see the day's record: `select * from ops.plivo_balance_checks order by day desc limit 7;` (database owner only).

## Limits of the design
* One reading a day: a balance that drops below Rs 300 at night is seen the next day. Plivo's own custom balance e-mails (up to three thresholds) cover the hours in between.
* The rate is a setting, not a market feed: change it when the rupee moves a lot.
* The worker must run with `OUTBOX_ADAPTER=whatsapp` for the message; otherwise only the "Needs you" item is raised (a warning says so in the worker's log at start).
