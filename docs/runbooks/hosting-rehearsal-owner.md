# The hosting rehearsal: put the app on the internet with SYNTHETIC data, test it, and take it down (owner's runbook, job CE)

For you (the owner), on your Mac. **About half a day the first time, mostly waiting for builds. Expected cost: about zero** (a few cents of image storage if you forget to tear down; the rest is inside the free amounts, ADR 0072). Nothing here is real: no customer, no real phone number, no real e-mail; the real-data gate stays closed. At the end you tear everything down.

The plan is in [ADR 0072](../adr/0072-hosting-free-tier-first.md) (read its short tables and the addendum of job CE first): **Supabase in Mumbai + Google Cloud Run in Mumbai + Cloud Scheduler for the worker**. The web runs on Cloud Run too; the one open question is a custom domain through Cloudflare Free, which this rehearsal tests (Part 7) without buying a domain. Every setting by name: [`hosting-env-and-secrets.md`](hosting-env-and-secrets.md). The longer reference this one is built on: [`hosting-owner-runbook.md`](hosting-owner-runbook.md).

**Tags used below.** **[NO CARD]** free, no payment details. **[CARD]** asks for a payment card, even if nothing is charged. **[COMPANY?]** a place where a registered business could be asked for; for the rehearsal you do NOT need one (it says what to choose). **[SKIP]** not part of the rehearsal. I have not created any account or run any command below: the screens change, so **trust the screen over this page** and tell me when they differ. Every script is a dry run unless you add `--execute`; read the dry run first.

**What you need on the Mac.** Docker Desktop running (you have it). Already installed here: `supabase` (the Supabase CLI), `make`, Python. **To install: the Google Cloud CLI**: `brew install --cask google-cloud-sdk` (Step 7). Nothing else.

---

## Part 1. Accounts and the budget alert (do the alert BEFORE anything is created)

1. **A Google account for the project** [NO CARD]. Use an address you will keep (a shared family address is better than a personal one). Turn on 2-step verification.
2. **Google Cloud: open the console** at console.cloud.google.com with that account and accept the terms. [NO CARD] up to here.
3. **Create the billing account** (Billing > Create account) **[CARD]**. Google asks for a card even to use the free amounts. **[COMPANY?]** it asks "Individual" or "Business": choose **Individual** for the rehearsal (a Business account asks for business details such as a tax number; it is for later). The card may be charged a small amount to verify it and refunded; some Indian cards need an e-mandate/OTP step: if the card is refused, tell me the message, do not try many cards. A new account may be offered free trial credit: take it if offered; read what it says about "free trial" versus "paid account" on the screen.
4. **SET THE BUDGET ALERT NOW** (Billing > Budgets & alerts > Create budget): name `rehearsal-10-eur`; scope: all projects; amount: **10 EUR** (the budget is in the currency of your billing account: if it is INR, enter the rupee equivalent of 10 EUR, about 1,000 rupees, check today's rate); alerts at **50 %, 90 % and 100 %** to your e-mail. **A budget only warns; Google Cloud has no hard spending cap** (ADR 0072). Your real brake is Part 9: delete the project. Put a calendar reminder for tomorrow evening: "check the Google Cloud bill, tear down".
5. **Supabase account** at supabase.com [NO CARD]: sign in with your Google or GitHub account, create an organisation `sme-family`. Choose the **Free** plan. (Pro asks for a card; not for the rehearsal.)
6. **Cloudflare account** at dash.cloudflare.com [NO CARD], **only for Part 7** (the custom-domain test). You can do Parts 1 to 6 and 8 to 9 without it. **[SKIP]** buying a domain: not needed (Part 7 uses a free `workers.dev` address). A domain [CARD] is a later decision.
7. **Vercel** [SKIP]: not chosen (ADR 0072: its 4.5 MB request limit breaks photo upload); see Appendix if you want to try.

## Part 2. The Mac: update the folder and install the one tool

In a new Terminal window (not the windows of your demo; the demo on ports 3000/8000 is not touched by anything here):

```
cd ~/Desktop/sme-ai-demo && git fetch origin && git checkout --detach origin/main && make install
brew install --cask google-cloud-sdk
gcloud --version
```
(`make install` refreshes the Python environment that `make hosted-smoke` uses.)

## Part 3. Supabase: the rehearsal database (Mumbai, free)

1. In the Supabase dashboard: **New project**: name `sme-rehearsal`, **Region: South Asia (Mumbai)**, a long random database password saved in your password manager (you will type it into the CLI; never into a chat or a file).
2. **Settings, by hand in the dashboard** (never `supabase config push`): the checklist in [`hosted-auth-settings.md`](hosted-auth-settings.md). For the rehearsal the five that matter: **sign-up OFF**, **confirm e-mail ON**, **MFA ON**, **JWT signing keys: asymmetric (ES256)**, **exposed schemas: `public` only**. Items marked Pro wait.
3. From Project settings > API copy two public values into a scratch note: the **Project URL** (`https://<ref>.supabase.co`) and the **publishable key**. **Never copy the `service_role` or secret key anywhere**: nothing here uses it.
4. **Apply the migrations** (your Mac; the CLI asks for the database password, type it hidden):
   ```
   cd ~/Desktop/sme-ai-demo
   supabase login
   supabase link --project-ref <the project ref>
   supabase db push --dry-run
   supabase db push
   ```
   Read the dry run: it lists every migration, oldest first. (If the CLI cannot reach the database because your network has no IPv6, use the **session pooler** address from Connect > Session pooler; `hosting-env-and-secrets.md` explains why.)
5. In the dashboard **SQL editor**, run the contents of `supabase/hosted/verify.sql`: **every row must say `ok = true`**. If one does not, stop and send me the row.
6. **Two accounts** (Authentication > Users > Add user, **Auto Confirm User** ticked, password from your password manager):
   * the **rehearsal owner**: an address you can read, for example your own with a `+rehearsal` tag. This is the person who signs in to the web.
   * the **scheduler**: another address (`rehearsal-scheduler@<something>`; if Supabase refuses the address, use any you can receive mail at). Then in the SQL editor: `select app.operator_register_scheduler('<the scheduler address>');`

## Part 4. Google Cloud: project, tools, secrets

Run these in the Terminal, in `~/Desktop/sme-ai-demo`. Replace `<...>`.

```
gcloud auth login                                   # opens the browser; sign in with the project's Google account
gcloud billing accounts list                        # note the ACCOUNT_ID of the account you created
export PROJECT_ID=sme-rehearsal-<four random digits>
gcloud projects create $PROJECT_ID --name="SME rehearsal"
gcloud billing projects link $PROJECT_ID --billing-account=<ACCOUNT_ID>
gcloud config set project $PROJECT_ID
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com
gcloud artifacts repositories create sme --repository-format=docker --location=asia-south1
gcloud auth configure-docker asia-south1-docker.pkg.dev
```
Then two service accounts, so that nothing runs with more power than it needs (one reads the secrets; one only starts the worker):

```
gcloud iam service-accounts create sme-run --display-name="SME services (read secrets only)"
gcloud iam service-accounts create sme-tick --display-name="Cloud Scheduler: start the worker"
export RUN_SA=sme-run@$PROJECT_ID.iam.gserviceaccount.com
export SCHEDULER_SA=sme-tick@$PROJECT_ID.iam.gserviceaccount.com
```
The secrets (generated or typed hidden; **no value is shown or saved**):

```
./deploy/cloudrun.sh secrets                  # dry run: read it
./deploy/cloudrun.sh secrets --execute        # asks you to type the scheduler's password hidden (the one from Part 3 step 6)
for s in sme-suppression-hmac-key sme-scheduler-password; do
  gcloud secrets add-iam-policy-binding $s --member serviceAccount:$RUN_SA --role roles/secretmanager.secretAccessor
done
```

## Part 5. Deploy: API, then web, then API again, then the worker

Set the public values for this run (these are public; none is a secret):

```
export SUPABASE_URL=https://<ref>.supabase.co
export SUPABASE_PUBLISHABLE_KEY=<the publishable key>
export WEB_ORIGIN=https://placeholder.invalid
./deploy/cloudrun.sh api                      # DRY RUN: read every line
./deploy/cloudrun.sh api --execute            # builds (10 to 20 minutes on a Mac with an Apple chip: it builds for Linux/Intel), pushes, deploys
```
Write down the API address it prints (`https://sme-api-....run.app`):
```
export API_URL=https://sme-api-<...>.run.app
./deploy/cloudrun.sh web --execute            # note the web address (https://sme-web-....run.app); this build takes longer
export WEB_ORIGIN=https://sme-web-<...>.run.app
./deploy/cloudrun.sh api --execute            # again, now with the real web address (the CORS fence)
```
(The web was built while `WEB_ORIGIN` still said the placeholder, so its `NEXT_PUBLIC_SITE_URL` does too. That only affects the sitemap and the share pictures, which stay switched off until the launch switch `SITE_LIVE=1`; build the web again with the final address before launch, never now.)
In Supabase, **Authentication > URL configuration**: **Site URL** = the web address; **Redirect URLs** = only `<web address>/auth/confirm`.

The worker (a Cloud Run job started every 5 minutes; it costs nothing while it waits):
```
export SCHEDULER_EMAIL=<the scheduler address from Part 3>
./deploy/cloudrun.sh worker                   # dry run
./deploy/cloudrun.sh worker --execute
gcloud run jobs add-iam-policy-binding sme-worker --region asia-south1 --member serviceAccount:$SCHEDULER_SA --role roles/run.invoker
gcloud run jobs execute sme-worker --region asia-south1 --wait      # one tick now; it must end "succeeded"
```

## Part 6. Smoke test and a first click-through

1. **The smoke test** (read-only; it prints PASS/FAIL lines and never a password):
   ```
   make hosted-smoke URL=$WEB_ORIGIN API_URL=$API_URL
   ```
   Every line must be PASS (one SKIP for the scheduler is expected until step 2). Keep the output.
2. **With the scheduler check** (sign in as the rehearsal owner; the password is typed hidden):
   ```
   SMOKE_EMAIL=<the rehearsal owner address> SMOKE_SUPABASE_URL=$SUPABASE_URL SMOKE_SUPABASE_PUBLISHABLE_KEY=$SUPABASE_PUBLISHABLE_KEY make hosted-smoke URL=$WEB_ORIGIN API_URL=$API_URL
   ```
   "the scheduler worker has ticked recently" must be PASS. If it says stopped: run `gcloud run jobs execute sme-worker --region asia-south1 --wait` and run the smoke again.
3. **By hand, in a browser** (private window): open the web address; sign in as the rehearsal owner; set up the authenticator when asked (MFA); create a workspace with a made-up business name; add one product and one lead with a made-up name and a phone starting `+00` (the gate is closed: only fictional contacts are accepted). If any page shows an error, copy the words on the page and the time, and tell me. **Do not type anything real.**
4. **The tests that cost nothing:** `curl -s https://<api address>/health` (ok), `curl -s -o /dev/null -w '%{http_code}\n' https://<api address>/docs` (404).

## Part 7. The custom-domain question: test Cloudflare Free in front of Cloud Run (optional, free, no domain needed)

The question (ADR 0072): can the web sit behind Cloudflare Free and still work? Cloudflare's Free plan cannot rewrite the Host header by rule, so the test uses a small **Worker** that forwards to Cloud Run. It gives you a free `workers.dev` address, which is a different host from `run.app`, exactly the situation a real domain would create.

1. Cloudflare dashboard > **Workers & Pages > Create > Worker**, name `sme-rehearsal`, **Deploy**, then **Edit code**: replace everything with the contents of `deploy/cloudflare-worker-proxy.js` (open the file on your Mac, copy all), **Deploy**.
2. Worker > **Settings > Variables and Secrets > Add** a plain **text** variable `ORIGIN` = your web address (`https://sme-web-....run.app`). Deploy. Your address is shown as `https://sme-rehearsal.<your name>.workers.dev`; `export WORKER_URL=` that.
3. **Check 1 (automatic):** `make hosted-smoke URL=$WORKER_URL API_URL=$API_URL`. The line "a signed-out visit to /app is sent to /login on the SAME host" must be PASS.
4. In the browser, through `$WORKER_URL` (private window), the other checks:
   * **Check 2:** sign in as the rehearsal owner. It must work, and in the browser's developer tools (Application > Cookies) the `sb-...` cookie belongs to the `workers.dev` host with HttpOnly and Secure ticked and no domain widening.
   * **Check 3:** do anything that saves (create a second workspace, or save a setting). It must not say "forbidden" or "Invalid Server Actions request".
   * **Check 4:** a big photo. Make a 4 MB synthetic picture: `cd services/ai-api && .venv/bin/python -c "from PIL import Image; import os; Image.frombytes('RGB',(1900,1900),os.urandom(1900*1900*3)).save('/tmp/big-photo.jpg', quality=95)"` (about 4.2 MB), then add it to a catalogue item in the web. It must be accepted.
   * **Check 5 (streaming):** needs the assistant on, which needs a paid model key: **not testable in this rehearsal**. Write "not tested".
   * **Check 6:** `curl -s -o /dev/null -D - -H 'X-Forwarded-Host: evil.example.test' $WORKER_URL/app | grep -i '^location'` must print a relative or the worker's own address, never `evil.example.test`.
5. Write down PASS or FAIL for each. If 1 to 4 and 6 pass, option D works and ADR 0072 recommends it for the custom domain; if any fails, send me the line: the fallback is Google's load balancer (about 18 dollars a month).

## Part 8. Measure, then record what you saw

1. **Cold start.** Wait 20 minutes without opening anything, then:
   ```
   curl -s -o /dev/null -w 'web %{time_total}s\n' $WEB_ORIGIN/login ; curl -s -o /dev/null -w 'api %{time_total}s\n' $API_URL/health
   ```
   The first number after idle is the cold start; run it again for the warm one. If the web's cold start is over about 6 seconds, tell me: the fixes are a smaller image (Next "standalone"), or one warm instance (about 8 dollars a month).
2. **Record**, in a note, with the date: the Part 6 smoke output; the Part 7 checks; the two timings; the browser pages that errored; the Google Cloud billing page's "cost so far" (Billing > Reports) after one day; and the output of `gcloud run services list --region asia-south1` and `gcloud run jobs list --region asia-south1`. **Send me these** (no passwords, no keys; the output does not contain any).

## Part 9. Tear it all down (the same day if you can)

In this order. Each step is small.

```
gcloud run services delete sme-web --region asia-south1 --quiet
gcloud run services delete sme-api --region asia-south1 --quiet
gcloud run jobs delete sme-worker --region asia-south1 --quiet
gcloud scheduler jobs delete sme-worker-tick --location asia-south1 --quiet
gcloud artifacts repositories delete sme --location asia-south1 --quiet
for s in sme-suppression-hmac-key sme-scheduler-password; do gcloud secrets delete $s --quiet; done
```
Then:
1. **Delete the Google Cloud project** (it stops everything at once, and nothing in it can bill you): `gcloud projects delete $PROJECT_ID`. (Google keeps it 30 days in a "pending deletion" state, then removes it.) Keep the billing account and the budget alert.
2. **Delete the Supabase project**: Project settings > General > Delete project. (Free; it removes the synthetic data.) The restore-drill project, if you made one, too.
3. **Delete the Cloudflare Worker** (Workers & Pages > `sme-rehearsal` > Settings > Delete).
4. Next day: open Billing > Reports once more and confirm it shows no new cost; keep the budget alert for the real deployment.

---

## What a pass looks like

* `make hosted-smoke` all PASS (with the scheduler line), from the web address;
* the click-through in Part 6 works with no error page;
* Part 7: checks 1 to 4 and 6 PASS (or a clear FAIL I can act on);
* the cold-start numbers and the bill, written down;
* everything in Part 9 done.

## Appendix: if you still want to try Vercel (not recommended; ADR 0072)

Vercel Hobby is free (no card) but "non-commercial, personal use only": acceptable only for a throwaway test with no customer. Import the repository (it needs your GitHub account), set the project's root to `apps/web`, add the `NEXT_PUBLIC_*` variables of `hosting-env-and-secrets.md`, set the function region to `bom1` (Mumbai) and deploy. The same Part 6 and Part 7 checks apply; **expect the 4 MB photo (check 4) to work and a 5 MB photo to fail**, because Vercel Functions refuse a request body over 4.5 MB. Pro (20 dollars per seat) asks for a card **[CARD]**.
