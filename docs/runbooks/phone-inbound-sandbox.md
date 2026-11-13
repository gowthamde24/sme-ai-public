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
   `{"url": "wss://…/v1/telephony/exotel/stream/<token>?sample-rate=8000"}`. The token is signed with `sme-exotel-stream-secret`, lives 120 s and is bound to the call's id when Exotel sends one. The token rides in the PATH (on 4 Nov Exotel opened one stream with the query string dropped); `?t=` is still accepted. The log carries call ids only as `call_sid_fp` (8 hex of an HMAC with the stream secret), so a Call SID from the dashboard can be matched without writing it down.
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

## Who may call in: the allowed list, kept out of every chat and log
The callers allowed in are the secret `sme-telephony-sandbox-numbers` (comma-separated E.164). The owner writes it himself in his own terminal (zsh): the number is typed hidden, never shown, never in the shell history, never in a chat.
```
read -s "BRO?Second tester's mobile, 10 digits (hidden): "; echo
if [[ "$BRO" =~ '^[6-9][0-9]{9}$' ]]; then
  printf '%s' "+919502380998,+91$BRO" | gcloud secrets create sme-telephony-sandbox-numbers --project project-2757c07e-37d2-4167-88f \
      --replication-policy=user-managed --locations=asia-south1 --data-file=- \
    && gcloud secrets add-iam-policy-binding sme-telephony-sandbox-numbers --project project-2757c07e-37d2-4167-88f \
      --member=serviceAccount:sme-api-run@project-2757c07e-37d2-4167-88f.iam.gserviceaccount.com --role=roles/secretmanager.secretAccessor --condition=None --format=none \
    && echo "Saved. The next API deploy uses it."
else echo "Not a 10-digit Indian mobile; nothing saved."; fi
unset BRO
```
To change it later: the same, with `gcloud secrets versions add sme-telephony-sandbox-numbers --project project-2757c07e-37d2-4167-88f --data-file=-` in place of `create` (and no binding); then redeploy the API.

## Switch it on (staging only)
1. The owner's IAM grants: `sme-api-run` reads `sme-exotel-stream-secret`, `sme-exotel-sid`, `sme-exotel-api-key`, `sme-exotel-api-token`. The exact lines are in `~/Desktop/stack19-jobs/phone-calls-check/owner-steps-inbound.md`.
2. The line, once, as the operator:
   ```
   insert into public.phone_numbers (tenant_id, number, label, inbound_on)
   select id, '+914045903172', 'Hyderabad ExoPhone', true from public.tenants where name = 'Stack19 Owner Test'
   on conflict (number) do update set inbound_on = true;
   update public.phone_numbers set inbound_on = false where number = '+919513886363';   -- the old trial number: off
   ```
3. Put the telephony settings in `deploy/settings/staging/api.env` and `api.secrets` (pull request), then `ALLOW_FLAG_CHANGE=<the names you changed> make deploy-staging WHAT=api`. The deploy applies exactly those files (nothing is typed in front of the command any more, since 12 Nov 2026), compares them with the serving revision before it builds, and gives the new revision traffic only after its settings check.

## Switch it off
Set `TELEPHONY_MODE=off` and `TELEPHONY_OUTBOUND=false` in `deploy/settings/staging/api.env` (pull request), then `ALLOW_FLAG_CHANGE=TELEPHONY_MODE,TELEPHONY_OUTBOUND make deploy-staging WHAT=api`: both addresses answer "off". (A deploy only applies the declared files and only UPDATES settings; it never drops one by leaving it out.) Or `update public.phone_numbers set inbound_on = false where number = '+914045903172';`.

## The voice budget: our cap on Cartesia (migration 20261231280000)

Cartesia has no spending cap of its own, so we enforce one: **2,000 Cartesia characters a call and 20,000 a day** across all calls. Past either limit, the call speaks with Sarvam Bulbul for the rest of the call. Live talk speaks with Cartesia where `VOICE_TALK_PRIMARY=true` (declared in staging since 13 Nov 2026, the owner's choice: Cartesia is the main voice), and with Sarvam where it is off (production, until the owner says).

Each call logs `voice_budget` (granted, used, the day's total, the limit) and `voice_chars` per engine in `phone_call_numbers`.

**Operator steps** (SQL editor, as `postgres`; nothing here is reachable from a client):

```sql
-- the workspace whose Today shows the warnings (the platform owner's: Stack19 Owner Test)
update public.voice_budget set notice_tenant = '<tenant id>', updated_at = now() where engine = 'cartesia';

-- count characters spent outside the API into the month (local renders; or the gap to the Cartesia dashboard's own figure)
select app.voice_usage_add_script('2026-11-06', 'cartesia', <characters>);

-- change a limit (owner's decision only)
update public.voice_budget set daily_chars = 20000, per_call_chars = 2000, monthly_credits = 100000, period_day = 29, updated_at = now() where engine = 'cartesia';

-- the day's and the period's totals
select source, chars from public.voice_usage_days where engine = 'cartesia' and day = app.voice_day();
select sum(chars) from public.voice_usage_days where engine = 'cartesia' and day >= app.voice_period_start(app.voice_day(), 29::smallint);
```
