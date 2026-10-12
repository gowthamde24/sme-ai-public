# Owner's runbook: connect Meta's free WhatsApp test number (job CD)

For the owner. It takes about an hour the first time. Everything runs on your Mac against your demo stack; nothing is deployed and nothing is bought. The adapter was built in job BR (ADR 0076) and has only ever talked to a fake; **this is its first real conversation**, so expect to fix a small thing.

## What you get, and what the free test number can and cannot do

* A real WhatsApp conversation between your own phone and the app: you write to the test number, the message appears in the app's inbox, you reply, your phone receives it, and the delivery steps (sent, delivered, read) come back.
* The rules you can see working for real: the **24-hour window** (free text only within 24 hours of the customer's last message; outside it only an approved template), **STOP** (the contact is stopped and nothing more is sent), the **status steps**, the **signature check** on Meta's webhook.
* Limits of Meta's test number (from Meta's get-started guide, read 2026-10-12; their screens change, so trust the screen over this page): it can message **up to 5 recipient numbers** that you add and verify with a code; the **temporary access token lasts about a day**; it is free; it is not a business number and cannot be used for customers.
* Not covered by this run: photos (the first real photo needs catalogue photos in the test workspace; the code path is tested with samples only), a permanent token, a real business number, running outside your Mac. Those come with hosting.

## The one decision that is yours: the real-data gate

Every workspace starts **closed**: it accepts only fictional contacts (a phone starting `+00`), because no real person's data may enter before the DPDP review, the hosting and the restore drill (ADR 0015, `real-data-gate.md`). Meta sends from and to a **real phone number: yours**. With the gate closed, a message from your real number is **acknowledged and counted as ignored**, and a reply cannot be addressed to it. So a real round trip needs one of:

* **A. Open the gate for the throwaway local workspace `wa-test-local` only**, for the test, with your own number only. The function checks only that four references are present and well-formed; **the references are meant to say that hosting, the DPDP review and the restore drill are real, and they are not yet.** So this is a deliberate exception that only you can make, and the honest way is references that say what it is (the command below uses `doc:local-test-number-only`). Close it again afterwards (the last section). The demo workspace is never opened.
* **B. Leave the gate closed.** Then you can still prove the plumbing that carries no real number: Meta's handshake with your app, Meta's "Test" button on the webhook page (a signed sample), the token check, and the send attempt failing for the right reason. You will not get a message on your phone.

I recommend **A on `wa-test-local`, with only your own number and the 5 verified testers you choose**, and closing the gate and erasing the test contact at the end. I have not done either; the choice and the commands are yours.

## 1. On Meta's side (about 20 minutes)

1. Sign in at developers.facebook.com with your Facebook account and register as a developer if asked.
2. **Create an app**: type **Business** (or "Other", then "Business"); give it a name such as `sme-test`.
3. In the app, **Add product > WhatsApp > Set up**. Meta makes a **test WhatsApp Business Account** and a **test phone number** for you.
4. Open **WhatsApp > API Setup**. Copy these three (they are not secrets, you will type them):
   * **Phone number ID** (digits)
   * **WhatsApp Business Account ID** (digits)
   * the **Temporary access token** (this one IS a secret, valid about a day; you will type it hidden below)
5. In the same page, under **To**, choose **Manage phone number list** and add **your own phone** (and up to four others). Meta sends each a code on WhatsApp; enter it. Only these numbers can receive from the test number.
6. **App settings > Basic**: reveal the **App secret** (a secret; you will type it hidden). Meta signs every webhook with it.
7. Think up a **verify phrase**: 12 or more letters and digits, for example three random words joined with dashes. You type it into the script and into Meta (step 4 of the next section). It is not a Meta value.

## 2. On your Mac (windows 1 to 4; update the demo folder first)

This job is merged into `main` by the merge line; then bring the demo folder up to date: `cd ~/Desktop/sme-ai-demo && git fetch origin && git checkout --detach origin/main && make install`.

**Window 1: the API with the real adapter** (it replaces the plain `make dev-api-local` on port 8000: stop that one with Ctrl-C first). Add `AGENTS_ENABLED=true` in front if you want Ask to work as in the demo.
```
cd ~/Desktop/sme-ai-demo && make dev-api-whatsapp
```
It asks for, hidden (nothing is shown or saved): the **access token**, the **app secret**, the **verify phrase**; and, visible, the **phone number ID**. It asks Meta whether the token works for that number (`Meta accepts this token for that number`), prepares a local channel account, and starts the API on port 8000 with `OUTBOX_ADAPTER=whatsapp`. If Meta refuses the token it stops and says so (a temporary token lasts about a day: make a new one on the API Setup page). The real adapter is switched on **only** by this command; every other command keeps the fake.

**Window 2: a public address for Meta** (Meta cannot reach `localhost`). Any tunnel that gives an `https://` address for port 8000 works; one that needs no account is Cloudflare's quick tunnel (`brew install cloudflared` once):
```
cloudflared tunnel --url http://localhost:8000
```
It prints an address like `https://something-random.trycloudflare.com`. Keep the window open; the address changes each time you start it. (ngrok works too but needs an account.) I could not run a tunnel here, so this step is by Meta's and the tunnel's own documentation.

**Meta's webhook page** (WhatsApp > Configuration > Webhook > Edit): **Callback URL** `https://<your tunnel address>/v1/webhooks/whatsapp`, **Verify token** = your verify phrase. Click **Verify and save**: Meta calls the API and the API answers the handshake. Then under Webhook fields **Subscribe** to **messages**. If verify fails: the phrase differs from the one you typed in window 1, or the tunnel points at another port.

**Window 3: connect the number to its own local workspace** (replace the two ids with yours; the display phone is optional):
```
cd ~/Desktop/sme-ai-demo
SME_STACK=owner ./scripts/dev-enable-outbox.sh on
make whatsapp-test ARGS="connect --waba-id <WhatsApp Business Account ID> --phone-number-id <Phone number ID>"
```
This makes the workspace `wa-test-local` (separate from the demo; owner account `wa-test-owner@demo.example.test`, a local account), saves the number (the token is NOT sent: the API holds it), activates it and switches automatic sending on for that workspace. The first line to expect: `connect: workspace wa-test-local (…); number … is active`.

**If you chose A (open the gate for this workspace only):**
```
docker exec -i supabase_db_sme-ai psql -U postgres -d postgres -c "select app.operator_open_real_data_gate('wa-test-local', 'adr:0014', 'doc:local-test-number-only', 'doc:local-test-number-only', 'doc:local-test-number-only')"
```

## 3. The test, step by step (window 3)

1. **A message in.** From your phone, write to the test number (its number is on the API Setup page): `Do you have red sarees?` Then:
   ```
   make whatsapp-test ARGS=inbox
   ```
   You should see one line with your message, `[in]`, `window OPEN until …`. Note the **lead id**. (With the gate closed you will see nothing: the message was ignored.)
2. **A reply, inside the window.**
   ```
   make whatsapp-test ARGS="reply --lead <lead id> --text 'Yes, we do. Come to the shop any day, 10 to 8.'"
   ```
   Expect `reply: queued …` and `handed to the channel`, and the text on your phone within seconds. A reply that mentions a price, an amount or a complaint **waits for your approval** by design: add `--approve` to approve it from the script, or approve it in the web (Outbox) as the test owner.
3. **The delivery steps.** `make whatsapp-test ARGS=status` lists the last messages; after a few seconds a message shows `sent`, then the steps arrive by webhook (delivered, read once you open it on the phone).
4. **STOP.** From your phone send `STOP`. `ARGS=inbox` shows the conversation as `STOPPED`; a new reply is **blocked** (the reason says why) and nothing reaches your phone. (To test again, erase the contact and start over; see the last section.)
5. **The 24-hour rule.** After 24 hours without a message from you, a reply cannot be free text: `ARGS="reply …"` ends with `failed` and the code `template_required` (no approved template) or goes as a template if one is approved. To see the template path: create one in the API (`PUT /v1/tenants/<id>/whatsapp/templates/<id>`, then `POST …/submit`; Meta reviews it, up to 24 hours; then `POST …/status {"status":"approved"}`); Meta's test number also has the ready-made `hello_world` template. Because the web has no screen for this yet, this step is the slowest; it can wait for the day after.
6. **The signature check.** On Meta's webhook page the **Test** button sends a signed sample; the API answers 200. A request without Meta's signature gets 401: `curl -i -X POST http://localhost:8000/v1/webhooks/whatsapp -d '{}'` prints `401`.

## 4. If something is wrong

| You see | Likely cause | Do |
|---|---|---|
| `Meta refuses this token` at start | the temporary token expired (about a day) or belongs to another app | make a new one on API Setup, run `make dev-api-whatsapp` again |
| Meta's "Verify and save" fails | the verify phrase differs, the tunnel is down, or the API is not on 8000 | check window 1 shows the API running, retype the same phrase |
| `inbox` empty after you wrote | the gate is closed (decision A), the number is not `active` (`ARGS=status`), the webhook is not subscribed to **messages**, or the API logs `whatsapp webhook: bad signature` (wrong app secret) | fix the one that applies; the API logs counts only: `stored=… ignored=…` |
| a reply fails with `rejected` and nothing arrives | Meta's error **131030**: the recipient is not on the test number's list | add and verify the number (section 1, step 5). The app shows only the closed word `rejected`; Meta's code is in the API log as `code=131030` |
| `failed window_closed` | more than 24 hours since the customer wrote (or Meta says 131047) | have them write again, or use an approved template |
| `failed not_configured` | the API has no token for the number, or Meta refused it (190) | restart window 1 with a fresh token |
| `failed recipient_unreachable` | not a WhatsApp number, or it has not accepted WhatsApp's current terms (131026) | check the number |
| a delivery step never arrives | the tunnel address changed (it changes on each start) | update the Callback URL on Meta's webhook page |

## 5. When you are done

* Ctrl-C windows 1 and 2. The temporary token dies by itself in about a day; delete the webhook's callback URL on Meta's page so Meta stops calling a dead address.
* If you opened the gate (A): close it, then erase the test contact so your number does not stay in the local database:
  ```
  docker exec -i supabase_db_sme-ai psql -U postgres -d postgres -c "select app.operator_close_real_data_gate('wa-test-local')"
  ```
  Closing does not remove data already inside. Erase through the Privacy page of the `wa-test-local` workspace (sign in as `wa-test-owner@demo.example.test`), or wipe your whole demo database with `make db-reset STACK=owner OWNER_OK=1` and reseed.
* Write down what happened: which steps passed, every error code you saw (the API log has them, never a phone number or a message text), and the time. That is the first real evidence about the adapter.

## What was and was not tested before you try

Tested without a network: the signature check, the handshake, 28 sample files in Meta's documented shapes (12 inbound messages: text, Telugu text, image caption, voice note, button and list replies, a location, STOP in English and Hindi, a reaction; 6 statuses; a batch; a template-review notice; 8 Graph answers), the adapter's request bodies (text and template) checked against the documented shape, and every Meta error mapped to the app's closed failure words; the database rules (window, STOP, status steps) are pgTAP-proven. **Never run against Meta**: the sample payloads were written from Meta's documentation, not captured from a live number, and the Graph API version (`v25.0`) was taken from the documentation of 2026-10-12. If a field differs on the first real message, the API log and the `ignored` count will show it; send me the error codes (not the numbers or the texts).
