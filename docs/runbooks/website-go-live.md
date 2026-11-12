# Go live with the website only: stack19.com and www (job DQ, night of 27 Oct 2026)

Goal: the public website is live on **https://stack19.com** and **https://www.stack19.com** this week; the app stays closed. Nothing in this page has been run: it is the exact list for the owner and C1. Where a step changes Cloudflare, Google Cloud or the domain, the owner does it (the night run is not allowed to).

What "website only" is: the same web image, started with one setting, `SITE_MODE=website` (ADR 0110). It serves the home page, the three business pages, plans, contact, privacy, terms and data deletion in English, Telugu, Hindi and Kannada. `/app`, sign-in and sign-up answer "Opening soon — book a demo". The pages say they may be indexed only when they are served from stack19.com or www.stack19.com.

## Step 0. Decisions only the owner can make (before anything else)

1. **The waitlist stores real people.** "Book a demo / join the waitlist" saves a visitor's name, city, phone or e-mail and the consent they gave. Staging's database holds synthetic data only (ADR 0015, the real-data gate). Choose ONE:
   - **A (recommended, no gate change):** go live with `WAITLIST=off`. The form is not drawn; every "Book a demo" button leads to the contact page, which lists hello@stack19.com and the WhatsApp chat. Turn the form on later (step 7) when a production API and database exist. Nothing real is stored anywhere.
   - **B:** write down, in the repository (a short line in `docs/ops/staging.md`), that the owner opens the gate for the waitlist table alone, on staging, with DPDP consent records; then `WAITLIST=1` on the site service with the API's address. Staging has no backups of its own (Free plan); say so in the same line.
2. **The privacy notice** must be the new one (job DQ part 2, branch `web/dq-dpdp`) before the site goes live: the website links to it from the form and from every footer. Merge the night PR first.
3. **Native review.** The Telugu, Hindi and Kannada pages carry a visible "machine-written draft" banner. They can go live with it; remove the banner only after a native reader has signed the kit.
4. **The owner's WhatsApp number** (done, 6 Nov 2026): it is set once in the code, `SITE_WHATSAPP` in `apps/web/lib/site/whatsapp.ts`, for the home page's footer, the contact page's chat and the calculator. There is no setting for it on the service.

## Step 1. Merge the night PR and build the web image

```
make deploy-staging DRY=1 WHAT=web      # read what it would run
make deploy-staging WHAT=web            # builds the image and updates the staging web (the app, closed to the public)
```
The image tag it prints (`sme-web:<git tag>`) is the one the site service uses. Staging keeps running as before (it is on staging.stack19.com, which is not indexable).

## Step 2. A second Cloud Run service for the website (owner)

A separate service keeps the website's settings and the staging app apart: staging stays an app, the site is `SITE_MODE=website`. Same image, same region.

```
PROJECT=project-2757c07e-37d2-4167-88f ; REGION=asia-south1
IMAGE=asia-south1-docker.pkg.dev/$PROJECT/sme/web:<the tag from step 1>
gcloud run deploy sme-site --project $PROJECT --region $REGION --image $IMAGE \
  --cpu 1 --memory 512Mi --min-instances 0 --max-instances 3 --concurrency 40 --timeout 300 --port 8080 \
  --startup-probe=httpGet.path=/login,httpGet.port=8080,timeoutSeconds=1,periodSeconds=2,failureThreshold=30 \
  --allow-unauthenticated --service-account sme-web-run@$PROJECT.iam.gserviceaccount.com \
  --set-env-vars SITE_MODE=website,WAITLIST=off
```
Notes:
- The startup probe asks for `/login`: in website mode that address answers 200 with the "Opening soon" page, so the probe still passes.
- The `NEXT_PUBLIC_*` values (API address, Supabase address) were fixed when the image was built; the website does not use sign-in, so they do not matter to it. The canonical address of every page is https://stack19.com whatever the service's own address is.
- With option B add `WAITLIST=1` instead of `WAITLIST=off`; the web calls `POST /v1/public/waitlist` and `GET /v1/privacy/notice` on the API address baked into the image (`NEXT_PUBLIC_API_BASE_URL`). That API must be the one the owner decided on in step 0.
- Open `https://sme-site-620338396268.asia-south1.run.app` and check: home, `/pricing`, `/contact`, `/privacy`, `/te`; `/app` and `/login` show "Opening soon — book a demo"; `/robots.txt` says `Disallow: /` (it is not stack19.com yet, so it is closed: that is correct).

## Step 3. Cloudflare: a Worker for the new service, and the two names (owner)

The way staging does it (`docs/ops/staging.md`, "Custom domain"): Cloud Run domain mappings do not exist in `asia-south1`, so a Cloudflare Worker forwards every request to the run.app address. It is free (Workers Free: 100,000 requests a day).
1. Cloudflare dashboard > Workers & Pages > Create > Worker, name **`stack19-site-proxy`**, paste `deploy/cloudflare-worker-proxy.js` (the same code staging uses), Deploy.
2. Settings > Variables: add the plain variable **`ORIGIN`** = `https://sme-site-620338396268.asia-south1.run.app` (the address printed in step 2).
3. Settings > Domains & Routes > Add > **Custom Domain**: `stack19.com`, then again `www.stack19.com`. Cloudflare creates the proxied DNS records itself. If it says a record already exists for the name, look at it before deleting anything: do NOT touch the **MX, TXT (SPF, DKIM, DMARC) and verification records**; they carry hello@, privacy@, billing@ and support@ (Zoho) and the e-mail sender (Resend).
4. Rules > Redirect Rules > Create: "www to the bare name": if hostname equals `www.stack19.com` then redirect (301, dynamic) to `concat("https://stack19.com", http.request.uri.path)`, keep the query string. (Or leave both names serving the site: the canonical link of every page is already `https://stack19.com/...`.)
5. SSL/TLS mode: Full (strict) (the Worker talks to Cloud Run over https).
The Worker adds `X-Forwarded-Host: stack19.com`; the web reads it to know the request came from the public name, which is what lets the pages say "index me" (nothing else does).

## Step 4. Check it from outside

```
curl -sI https://stack19.com/ | head -5                                  # 200
curl -s  https://stack19.com/robots.txt                                   # Allow: / ... Disallow: /app ... Sitemap: https://stack19.com/sitemap.xml
curl -s  https://stack19.com/sitemap.xml | head -20                       # home, pricing, contact, the three business types, in four languages
curl -s  https://stack19.com/ | grep -o '<meta name="robots"[^>]*>'       # index, follow
curl -sI https://stack19.com/app | head -3                                # 200, and the page says "Opening soon"
curl -s  https://stack19.com/login | grep -o 'Opening soon[^<]*'
curl -sI https://stack19.com/how-it-works | head -1                       # 404
curl -s  https://staging.stack19.com/robots.txt                           # Disallow: /  (staging stays closed)
```
Then in a browser, on a phone and on a computer: the home page in all four languages, the three business pages, "Book a demo" (the form, or the contact page with option A), the privacy page, the cookie notice.

## Step 5. Tell the search engines (owner, optional)

Google Search Console: add the domain property `stack19.com` (a DNS TXT record: Cloudflare, DNS), submit `https://stack19.com/sitemap.xml`. Bing Webmaster Tools can import from it. Nothing else is needed: the pages carry titles, descriptions, canonical links, the four language alternates and the share picture already.

## Step 6. After it is live

- The Supabase Site URL and the redirect list stay on staging.stack19.com: the app is not on stack19.com.
- Do not point `app.stack19.com` or any `/app` address at the site service; the app is a different service when it opens.
- When the app opens: deploy the web WITHOUT `SITE_MODE` (the same image, a normal service), move stack19.com (or app.stack19.com) to it, and remove the site service. That is a separate job.

## Step 7. Turning the form on in PRODUCTION (the switch-on day; target 20-22 Nov 2026, once the production DB and the owner's privacy text are approved)

**Until then nothing real is collected anywhere:** `sme-site` runs `WAITLIST=off` and staging holds synthetic data only. The image `sme-site` runs today was built against the STAGING API address, and it predates the guard of `WAITLIST_API_BASE` (`lib/waitlist/api-base.ts`): **with that image, never set `WAITLIST=1` or remove `WAITLIST=off`** (the form would post real people to staging). From the first image that carries the guard, the form is drawn only when `WAITLIST_API_BASE` names a production https address (not staging, not local), and every public read of the site then goes to that address.

**Before the day (each line is a yes/no the owner or C1 answers; nothing here is run by this page):**
1. Production database (Supabase Pro) exists with all migrations applied, including the waitlist table `privacy.waitlist_entries` and its operator functions (`20261202090200_dq_dpdp.sql`, `20261231490000_wl_operator_delete_waitlist.sql`), and the real-data gate (ADR 0015) is opened for production by the owner in writing.
2. Production API is deployed and answers `GET /v1/privacy/notice` (the version the form sends) and `POST /v1/public/waitlist`; `CAPTCHA_PROVIDER=turnstile` with `CAPTCHA_SECRET`, `HELLO_EMAIL` and the sending mail key are set on it (hosting-env-and-secrets.md); the API's own limit (5 an hour per address) is on.
3. The owner's privacy text is approved and merged (`apps/web/lib/legal/privacy-text.ts`; the API's notice version matches the text the form links to).
4. A Cloudflare Turnstile widget exists for stack19.com and www.stack19.com (its PUBLIC site key is `TURNSTILE_SITE_KEY`).
5. A new `sme-site` image is built from the commit the owner chooses (it must contain the `WAITLIST_API_BASE` guard and the approved privacy text; production is not `main`, so list what the image would carry first, as the table below says) and deployed with the owner's yes, still with `WAITLIST=off`. Check the pages; the form is still absent.

**The switch (one revision, no rebuild; the owner's yes):**
```
gcloud run services update sme-site --project $PROJECT --region $REGION \
  --update-env-vars WAITLIST=1,WAITLIST_API_BASE=https://<the production API>,TURNSTILE_SITE_KEY=<the public key>
```
**Check at once:** the form is drawn on `/` and `/contact` in all four languages; submit ONE synthetic entry ("Test Person", phone 9000000000, no marketing box) and see the thank-you; the API logged `waitlist status=joined`; the hello inbox got the mail; ask C1 to remove the test row (the API has no DELETE verb). Look at the `Referer`/Network of the page: the browser never calls the API itself (a server action does).
**Rollback (seconds):** `--update-env-vars WAITLIST=off` (the buttons lead to the contact page again). Early-access requests that arrive by hand meanwhile stay on hello@stack19.com and WhatsApp.

## What `sme-site` runs right now (keep this table current: one row per production deploy)

| Date | Image | Source | Revision | What it is |
|---|---|---|---|---|
| 9 Nov 2026 | `web:6bb471e3` | `main` at 6bb471e3 (#423) | `sme-site-00007-2px` | the website as first put live |
| 11 Nov 2026 | `web:d1f6dc21` | **`6bb471e3` + #464 + #465 only**: branch `c2/cartesia-on-production` (cherry-picks b05b1ae9, d1f6dc21; the diff against 6bb471e3 is the "Supported by" + Cartesia Startups logo row, eight files, nothing else) | `sme-site-00008-rus` (served 11 Nov 2026 until the next row) | owner's go, 11 Nov 2026 |
| 11 Nov 2026 (later) | `web:9415c0cc` | **`6bb471e3` + #464 + #465 + #467 + #468 only**: branch `c2/cartesia-bar-on-production` (cherry-picks b05b1ae9, d1f6dc21, 46db9d0c, 9415c0cc; the diff against 6bb471e3 is eight files, all the "Supported by" + Cartesia row: the two footers, `SupportedBy` and its test, one CSS rule, one string, the two official SVGs) | `sme-site-00011-qun` (100% of traffic; verified live on stack19.com and www) | the row moved into the footer's bottom bar, right side (Outpero's layout); light = Cartesia's official primary lockup (green symbol, dark name), dark = their white file; owner's go, 11 Nov 2026 |

Production is NOT `main`. `main` carries about twenty more web commits (the staging-only screens: test call, Introduce as, Tone, weekly search, How your assistant speaks, plan tiers, take-over, and the rest) that have not been put on stack19.com. Before the next production deploy, list what it would carry (`git log --no-merges 6bb471e3..origin/main -- apps/web packages/contracts packages/quote-engine/ts deploy/Dockerfile.web`) and have the owner choose: everything, or a cherry-pick again.
The service settings did not change: `SITE_MODE=website`, `WAITLIST=off`, no screen flag (`SPEAKS_PANEL_SCREENS`, `SWEEP_SCREENS`, `TEST_CALL_SCREENS`, `TEST_CALL_TONE`, `TALK_TRAINING_SCREENS`, `PLAN_TIER_SCREENS` and the rest stay unset = off). The image is built with the same public values as the 9 Nov build (`_SITE_URL=https://staging.stack19.com`, `_SIGNUP_OPEN=0`). Rollback: to the previous row `--to-revisions sme-site-00008-rus=100`, to the first row `--to-revisions sme-site-00007-2px=100` (`gcloud run services update-traffic sme-site --project project-2757c07e-37d2-4167-88f --region asia-south1 --to-revisions <revision>=100`).

## Rollback (each is one command; use the first that is enough)

1. **The form misbehaves or the API is down:** `gcloud run services update sme-site --project $PROJECT --region $REGION --update-env-vars WAITLIST=off`. The buttons then lead to the contact page.
2. **A bad page after a new image:** `gcloud run services update-traffic sme-site --project $PROJECT --region $REGION --to-revisions <the earlier revision>=100` (`gcloud run revisions list --service sme-site ...` names them).
3. **Take the website down completely:** Cloudflare > Workers > `stack19-site-proxy` > Domains & Routes > delete the two Custom Domains (`stack19.com`, `www.stack19.com`). The names stop answering within a minute; nothing else is affected (staging.stack19.com and e-mail are separate). To put the old state back after step 3, there was no earlier website: the names had no record; e-mail records were not touched.
4. **Search engines indexed something wrong:** Search Console > Removals for the address; fix the page; the sitemap tells them again. Setting `SITE_MODE` back is NOT a rollback (it would open the app's sign-in on stack19.com): remove the domain from the Worker instead (3).
5. **Never** run the website service without `SITE_MODE=website`: that is the whole app, with sign-in.

## What this does not do
No Cloudflare, Google Cloud, Supabase or DNS setting was changed by the night run, and nothing was deployed to stack19.com. The waitlist is not storing anything until step 0 is decided.
