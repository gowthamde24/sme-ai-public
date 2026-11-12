# Phone calls on Plivo (staging): inbound (phase A) and a test call out (phase B)

Job 3 phase A, 10 Nov 2026. Design: ADR 0122. A call to a Plivo number is answered by the same assistant pipeline as an Exotel call. Staging only; inbound only; only callers on `TELEPHONY_SANDBOX_NUMBERS`.

## The addresses (paste into the Plivo Application; Method POST for both)
- **Answer URL:** `https://sme-api-620338396268.asia-south1.run.app/v1/telephony/plivo/answer`
- **Hangup URL:** `https://sme-api-620338396268.asia-south1.run.app/v1/telephony/plivo/hangup`
- Fallback and ring URLs: leave empty. (The stream status callback address is given to Plivo inside our answer.)
They must be exactly the staging API's `PUBLIC_BASE_URL` plus the path: Plivo signs the address it called, and we rebuild it from `PUBLIC_BASE_URL` to check the signature.

## Plivo console, step by step (menu names may differ slightly)
1. Voice > Applications > **XML** > Add new application. Name: `stack19-staging`. Answer URL and Hangup URL as above, both **POST**. Save.
2. Phone Numbers > Your numbers > the rented number > set the application type to **XML application** and choose `stack19-staging` > Update.
3. Nothing else: the Auth Token stays in Secret Manager (`sme-plivo-auth-token`), never in the console fields of this app.
4. Make the call from an Indian mobile whose number is on the sandbox list. About 1 to 2 seconds after pickup you hear the assistant's opening line (it says it is an AI).

## Switching on (done by C1; the owner's steps are the Secret Manager secret and step 1 to 2 above)
1. The secret `sme-plivo-auth-token` (the owner creates it; the value is never in a chat, a log or this repo).
2. Read access for the API only, on THAT secret:
   `gcloud secrets add-iam-policy-binding sme-plivo-auth-token --project project-2757c07e-37d2-4167-88f --member=serviceAccount:sme-api-run@project-2757c07e-37d2-4167-88f.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor --condition=None`
3. The line (operator SQL, as `postgres`): `insert into public.phone_numbers (tenant_id, number, label, inbound_on, provider, spoken_business_name) select id, '+918065590129', 'Plivo Bangalore', true, 'plivo', 'Stack19' from public.tenants where name = 'Stack19 Owner Test' on conflict (number) do update set inbound_on = true, provider = 'plivo';`
   (To give a number to another workspace: `update public.phone_numbers set tenant_id = '<id>' where number = '<number>';`.)
4. `min_instances=1` in `deploy/settings/staging/api.scale` (pull request), then `ALLOW_FLAG_CHANGE=API_MIN_INSTANCES ./deploy/staging.sh deploy api` (one warm instance so the first answer is instant; about $44 a month with CPU always allocated). Staging has run with 1 since 10 Nov.
   Back to scale-to-zero after the test: `min_instances=0` in the same file and the same command.

## Switching off
`update public.phone_numbers set inbound_on = false where number = '+918065590129';` (the line is refused within 5 minutes: the lookup is cached), or deploy without the secret grant (the Plivo addresses answer "off").

## Reading a call
`gcloud logging read 'resource.labels.service_name="sme-api" AND (textPayload:"plivo_" OR textPayload:"phone_call_numbers")' --project project-2757c07e-37d2-4167-88f --limit 30 --format='value(timestamp,textPayload)'`
Lines: `plivo_answer admitted|refused=<word> call_fp=...`, `plivo_stream start ...`, `plivo_inbound admitted rule=plivo_signed_answer`, `phone_call_numbers {...}` (latency, turns, bytes, end), `plivo_hangup call_fp=... {cause, source, duration}`. No phone number and no raw call id is ever logged (an 8-character fingerprint of the call id).
Refusal words: `bad_signature` (403: the address in the Application differs from `PUBLIC_BASE_URL`, or the wrong token), `telephony_off`, `bad_number`, `no_such_line`, `line_not_plivo`, `inbound_off`, `not_on_sandbox_list`, `too_many_calls`; on the socket `bad_token`, `no_admission`, `unsupported_encoding`.

## What the throwaway test showed (10 Nov 2026, real calls from Indian mobiles)
Format `audio/x-l16` 8000 Hz little-endian; events `start`, `media` (320 bytes = 20 ms, very steady), `playedStream`, `clearedAudio`; NO `stop`; `extraHeaders` come back as `{X-PH-name: value}`; paced sending played in real time (checkpoints confirmed about 385 ms after sending);
`clearAudio` acknowledged in about 5 ms and audio sent a second later played; closing the socket ended the call 1.3 s later (cause 4010 "End Of XML Instructions", source Plivo); 31 s and 38 s calls were billed as 60 s (30-second pulse); the answer took 3.24 s on a cold instance and 6 ms warm,
and a caller gave up during the cold answer. Not yet known: audio sent within milliseconds after a `clearAudio`, 16 kHz, burst sending, a caller hanging up during the stream, which token signs a subaccount's application.

## Legal
The lawyer's answer on three items was VERBAL on 10 Nov 2026 and is not confirmed in writing (ADR 0122). Safeguards stay on regardless of any switch.

## Outbound (phase B): a test call to the owner's own phone
Only to numbers on `TELEPHONY_SANDBOX_NUMBERS` (the owner's), only 09:00 to 21:00 IST, only from the business's own Plivo line (Plivo: the caller id must be a Plivo number; both legs in India). No outreach to any business or customer.
1. Switch on (C1, after the owner's OK): `PLIVO_AUTH_ID` (the Auth ID, plain) and `TELEPHONY_OUTBOUND=true` on the API, with `PLIVO_AUTH_TOKEN` already mounted. The gate still decides every call; `live` stays refused (no consent path yet).
2. The Owner places it: `POST /v1/tenants/{t}/calls/place` (`docs/contracts/calls.md`), e.g. with the app's session token. Plivo rings the phone; on pickup you hear "Hello, this is ..., the AI assistant of ... This is a test call to check the phone line. Can you hear me clearly?".
3. Reading it: `plivo_outbound placed call_fp=...`, `plivo_outbound_answer admitted ...`, `plivo_outbound admitted rule=plivo_outbound_answer`, `phone_call_numbers {...}`, `plivo_hangup ...`, and for a call nobody answered `plivo_outbound ended call_fp=... state=busy|no_answer|failed|cancelled`.
4. The outreach worker's `PlivoDialer` (`app/telephony/plivo_outbound.py`) is built and tested but NOT wired: `OUTREACH_DIALER` stays `fake` until the owner decides, because the worker would need the Plivo credentials (a grant on that one secret for the worker's account) and its task timeout must exceed the call.
Not yet proven on a real call: the `from` / `to` format (digits with the country code, no "+"), the answer/hangup callbacks of an outbound call, and `time_limit`. The first real test call proves them.

## Outbound test call with a goal (job 3 phase B, owner 10 Nov 2026) — staging, sandbox numbers only

**What it is.** The Owner types a goal in plain words; the assistant calls a person the Owner named (a number on the sandbox list) and works towards that goal. Nobody else can start it (Owner only), nothing goes to a real business, and the gate decides before every dial.

**One-time set-up (owner, never in chat).** The Auth ID is kept as a secret too, so it never appears in a command history or a screen:

```
read -s "PID?Plivo Auth ID: "; echo
printf %s "$PID" | gcloud secrets create sme-plivo-auth-id --data-file=- --replication-policy=user-managed --locations=asia-south1
unset PID
```

Then tell C1 "auth id secret created". C1 grants `sme-api-run` read on **that one secret** (`roles/secretmanager.secretAccessor` on the secret, never project-wide) and deploys with
`TELEPHONY_OUTBOUND=true` in `deploy/settings/staging/api.env` (pull request), then `ALLOW_FLAG_CHANGE=TELEPHONY_OUTBOUND ./deploy/staging.sh deploy api`. Without the Auth ID or Auth Token secret the outbound route answers "off" and nothing is dialled.

**How the goal reaches the assistant.** `POST /v1/tenants/{id}/calls/place` with `{"to": "...", "goal": "..."}` (Owner only; `goal` is 10–400 characters of plain words: no phone number, e-mail address or link, no line breaks).
1. The gate checks first (mode, outbound switch, sandbox list, 09:00–21:00 IST, DND, concurrency, spending cap). A refusal is a closed word (`outside_window`, `not_in_sandbox`, ...), is recorded, and keeps no goal.
2. The goal is kept **in memory only**, keyed by the call's row id, for 10 minutes and used once. It is never in the answer/hangup addresses (they carry ids and closed words only), never in a log, never in the database.
3. When the person picks up, Plivo asks our signed answer address. We take the goal from memory and give the assistant the platform's own frame: the goal in the Owner's words, plus fixed rules (it cannot send or book anything itself: it says the team will do it and notes what was asked; it never states a price; it says a short goodbye). A call meant to carry a goal that finds none is hung up, so a restart never turns it into an unguided call.
4. The opening line is the plain one per language ("Hello, this is the AI assistant of {business}. Is this a good time to talk?"), which says it is an AI. The line-check call (`POST` without `goal`) stays English with its own "this is a test call" line.

Safeguards that stay on whatever the lawyer's answer: the assistant never claims to be human; outbound only 09:00–21:00 IST; DND respected; no recording; every change of a switch is logged with who and when. (The lawyer's answer on three items was verbal on 10 Nov 2026 and is not confirmed in writing.)

## Approved Lead Desk tasks place real calls (job 3 step 3, 10 Nov 2026) — staging, sandbox numbers only

**Switch:** `TASKS_DIALER=plivo` (with `TELEPHONY_OUTBOUND=true`); empty or `fake` keeps the fake that dials nobody. Deploy: set `TASKS_DIALER=plivo` (and `TELEPHONY_OUTBOUND=true`) in `deploy/settings/staging/api.env` (pull request), then `ALLOW_FLAG_CHANGE=TASKS_DIALER,TELEPHONY_OUTBOUND ./deploy/staging.sh deploy api`.

**Flow:** Vijaya proposes the call, the plan card shows it, the Owner approves it (with the second factor as before), and the API's background run places the calls one person at a time (`app/telephony/plivo_tasks.py`).
1. The DATABASE decides the money first: a person is handed to the dialer only while the task is running and under its cap; a paused or capped task claims nobody. The cost of each finished call is added by the database, which pauses the task at the cap.
2. The gate decides every dial: sandbox list (any other number is refused `not_on_sandbox_list`), 09:00 to 21:00 IST, do-not-disturb, consent, the opening says it is an AI, one call at a time. A refusal is kept as a refused call with its closed word and the person's row ends `failed`.
3. The assistant gets the approved plan as its goal (the goal, then the questions in order), in the platform's frame (it cannot send or book anything itself, never states a price).
4. The row says only what is known: an answered call ends `unclear`, with no captured answers (the call does not yet write structured answers back) and a transcript of the one line we know we said (the opening). A real call is never labelled simulated and sends no summary message.

**Not done:** structured answers captured from the call; the outreach worker (speed to lead) still uses the fake (`OUTREACH_DIALER=fake`), because a goal lives in the API's memory and the worker is a separate process.
