# Inbound phone calls on Plivo (staging)

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
4. `TELEPHONY_INBOUND=1 API_MIN_INSTANCES=1 ./deploy/staging.sh deploy api` (one warm instance so the first answer is instant; about $44 a month with CPU always allocated).
   Back to scale-to-zero after the test: `TELEPHONY_INBOUND=1 API_MIN_INSTANCES=0 ./deploy/staging.sh deploy api`.

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
