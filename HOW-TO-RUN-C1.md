# Running the API locally with every new switch on (localhost, staging database)

**Start (one line):** `cd /Volumes/Stack19/stack19/c1wt-b && VENV=/Volumes/Stack19/stack19/c1wt-a1/services/ai-api/.venv ./run-local-api.sh`
Then `http://localhost:8000` (the web: C2's `run-local-web.sh`). The first start takes about a minute: it reads the staging secrets one by one into this process only (nothing is written to a file). Stop it with Ctrl-C; the fake VoiceLink stops with it.

It uses the **staging** Supabase project (`uiallwgywitryxatcqxf`), so sign in with a staging account (the demo owners). Production is never touched.

## What is ON locally (and nowhere else)
SIGNUP_OPEN (+ fake phone sender: the start answer returns the code), PRICING_V2, BILLING_CHARGE_CALLS, CALL_COORDINATION, KYC_PER_CLIENT, PHONE_PICKER, WEBHOOKS_OUT, DEVELOPER_API=test, CONTACT_FORM, ADMIN_CONSOLE, JOBS + JOBS_GET_PAID, WHAT_YOU_SELL_LISTS, Razorpay **test** keys (from the owner's local file; no money), the fake Google Calendar. Not here yet: EXTRA_LINES and the IndiaMART scheduled pull (the two planner builders' branches; they come with their commits).
Database switches are staging data, not API settings: the number picker's platform switch (`ops.picker_settings.enabled`) is OFF on staging; `python3 scripts/smoke_local_phone.py --i-know-this-is-staging --open-picker` turns it on for one proof run and puts it back. Sign-up's database switch is opened the same way by `scripts/smoke_batch.py --open-signup`.

## What is FAKE (nothing real is bought, sent or called)
| Thing | Locally | How |
|---|---|---|
| VoiceLink (numbers, clients, KYC, calls) | **fake server** `scripts/fake_voicelink.py` on 127.0.0.1:8099 | `VOICELINK_API_BASE`; 40 numbers for sale; KYC approved 20 s after submit, or `POST :8099/_fake/approve/{client_id}`; `GET :8099/_fake/state` shows what it holds |
| Phone code at sign-up | fake sender, code echoed | `SIGNUP_PHONE_SENDER=fake` (an SMS sender exists too: `SMS_PROVIDER=fake`, `SIGNUP_PHONE_SENDER=sms`) |
| E-mail (receipts, reminders) | fake sender, nothing leaves; see them at `GET /v1/dev/outbox` (signed in) | `BILLING_EMAIL_SENDER=fake`; the Resend/WhatsApp/Meta/Plivo/Exotel send keys are dropped from the process |
| WhatsApp, outbox | fake | `OUTBOX_ADAPTER=fake` |
| Payments (links) , IndiaMART, call bridge, DND, number provider, places, web search | fake providers | `*_PROVIDER=fake` |
| Razorpay | TEST mode keys, real test orders, no money | the owner's local file |
| Workspace secrets (webhook signing keys) | in memory | `WORKSPACE_SECRETS=fake` |
| Google Calendar | fake Google; the authorize link comes straight back to the local callback | `GOOGLE_CALENDAR_FAKE=true` |
Real, on purpose: Supabase staging (data), the AI model and speech keys (they cost a little per use). There is **no local worker**: things the worker does (reminder e-mails, webhook deliveries, calendar sync) stay queued; a local worker would also mark staging's real reminders as sent.

## Changing a setting for one run
`LOCAL_ENV_OVERRIDES="PAGE_MAX_INFLIGHT=24 CALL_COORDINATION=false" ./run-local-api.sh`; `FAKE_VOICELINK=0` to skip the fake (then the picker/KYC are off); `PORT=8001` for another port.

## Proofs
- `python3 scripts/smoke_batch.py --i-know-this-is-staging --api-url http://localhost:8000 --open-signup` (sign-up, test order, signed webhook, lead address, describe-the-job, phone lines, developer API: 8 PASS).
- `python3 scripts/smoke_local_phone.py --i-know-this-is-staging --open-picker` (numbers for sale, the business KYC steps and documents, claim before and after approval, my numbers).
- Tests: only what you touched, through `lockf -k /tmp/stack19-heavy.lock <venv>/bin/python -m pytest <files> -q` (from `services/ai-api`).
Contracts: docs/contracts/{sell-lists,signup,calls,business-kyc,jobs-describe,credits-topup,webhooks-out,developer-api}.md.
