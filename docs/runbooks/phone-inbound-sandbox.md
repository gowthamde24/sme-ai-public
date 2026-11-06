# Inbound phone calls on the Exotel sandbox (staging)

Job phone-calls part 5, owner brief 4 Nov 2026: **inbound only**, **only from +919502380998**, into the **Owner Test** workspace. No outbound (`TELEPHONY_OUTBOUND` stays false: the gate refuses every
outbound call), no recording, no other number.

**Since 6 Nov 2026: the business's own ExoPhone, 040 4590 3172 (Hyderabad), App ID 1371752 (`voicebot-mum-prod-default-flow`), no PIN.** It replaces the shared trial number 09513886363.
- It has the **strict rule**: only the numbers on `TELEPHONY_SANDBOX_NUMBERS` are taken, and Exotel's own record of the call must confirm it. There is no trial exception: `EXOTEL_TRIAL_NUMBER` is empty.
- At most **one call at a time**, each cut at **3 minutes** (`TELEPHONY_MAX_CALL_S=180`), with **no outgoing calls**.
- A landline line arrives as "04045903172"; `app/connectors/phone.normalise_line` reads it as `+914045903172`.

## How a call gets in
1. The caller dials the ExoPhone 040 4590 3172 (until 6 Nov: the trial ExoPhone 09513886363 with a PIN). Exotel runs app 1371752: Call Start → **Voicebot** → Hangup.
2. The Voicebot applet's URL field is **`https://sme-api-620338396268.asia-south1.run.app/v1/telephony/exotel/stream-url`**: a plain address, with no secret in it. Exotel asks it once per call; it answers
   `{"url": "wss://…/v1/telephony/exotel/stream/<token>?sample-rate=16000"}`. The token is signed with `sme-exotel-stream-secret`, lives 120 s and is bound to the call's id when Exotel sends one. The token rides in the PATH (on 4 Nov Exotel opened one stream with the query string dropped); `?t=` is still accepted. The log carries call ids only as `call_sid_fp` (8 hex of an HMAC with the stream secret), so a Call SID from the dashboard can be matched without writing it down.
   A caller who is named and not on the list gets 403.
3. On the stream, before any audio:
   - the token's signature and expiry;
   - the caller is on `TELEPHONY_SANDBOX_NUMBERS`;
   - the ExoPhone is a row of `public.phone_numbers` (operator SQL) with `inbound_on`;
   - **Exotel's own record** of the call (one read-only `GET /v1/Accounts/<sid>/Calls/<CallSid>.json`) says it is in progress, from that caller;
   - the inbound gate, at most one call at a time.
   Without Exotel's key the API cannot confirm a call and refuses them all.
4. The call session (`app/telephony/call_session.py`) then runs:
   - the opening line says it is an AI, in `TELEPHONY_INBOUND_LANGUAGE` (staging `te`), then it follows the language spoken;
   - stop, voicemail, key 1 or 2 and goodbye rules;
   - at most `TELEPHONY_MAX_CALL_S` seconds (staging 180);
   - a `phone_calls` row (scheduler account), transcript and outcome.
5. One log line per call, numbers only (never the number or a word said):
   ```
   phone_call_numbers {"call": "<id>", "turns": n, "first_sound_p50_ms": …, "first_sound_p95_ms": …, "duration_s": …, "cost_paise_estimate": …, "outcome": …, "end": …}
   ```
   - `first_sound_ms` runs from the caller's last word to our first sound, as the API sends it. Exotel's own buffering is not in it.
   - The cost is the configured estimate (`TELEPHONY_COST_PAISE_PER_MINUTE`, 100 paise a started minute), not a quote.
   - Read it with `gcloud logging read 'resource.labels.service_name="sme-api" AND textPayload:"phone_call_numbers"' --project project-2757c07e-37d2-4167-88f --limit 5`.

## Switch it on (staging only)
1. The owner's IAM grants: `sme-api-run` reads `sme-exotel-stream-secret`, `sme-exotel-sid`, `sme-exotel-api-key`, `sme-exotel-api-token`. The exact lines are in `~/Desktop/stack19-jobs/phone-calls-check/owner-steps-inbound.md`.
2. The line, once, as the operator:
   ```
   insert into public.phone_numbers (tenant_id, number, label, inbound_on)
   select id, '+914045903172', 'Hyderabad ExoPhone', true from public.tenants where name = 'Stack19 Owner Test'
   on conflict (number) do update set inbound_on = true;
   update public.phone_numbers set inbound_on = false where number = '+919513886363';   -- the old trial number: off
   ```
3. `TELEPHONY_INBOUND=1 make deploy-staging WHAT=api`. A secret that `sme-api-run` cannot read yet is left out, and the deploy says so.

## Switch it off
`make deploy-staging WHAT=api` without `TELEPHONY_INBOUND=1`: `TELEPHONY_MODE` goes back to off and both addresses answer "off". Or `update public.phone_numbers set inbound_on = false where number = '+914045903172';`.
