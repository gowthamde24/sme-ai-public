# Go live with the website only: stack19.com and www (job DQ, night of 27 Oct 2026)

Goal: the public website is live on **https://stack19.com** and **https://www.stack19.com** this week; the app stays closed. Nothing in this page has been run: it is the exact list for the owner and C1. Where a step changes Cloudflare, Google Cloud or the domain, the owner does it (the night run is not allowed to).

What "website only" is: the same web image, started with one setting, `SITE_MODE=website` (ADR 0101). It serves the home page, the three business pages, plans, contact, privacy, terms and data deletion in English, Telugu, Hindi and Kannada. `/app`, sign-in and sign-up answer "Opening soon — book a demo". The pages say they may be indexed only when they are served from stack19.com or www.stack19.com.

## Step 0. Decisions only the owner can make (before anything else)

1. **The waitlist stores real people.** "Book a demo / join the waitlist" saves a visitor's name, city, phone or e-mail and the consent they gave. Staging's database holds synthetic data only (ADR 0015, the real-data gate). Choose ONE:
   - **A (recommended, no gate change):** go live with `WAITLIST=off`. The form is not drawn; every "Book a demo" button leads to the contact page, which lists hello@stack19.com and the WhatsApp chat. Turn the form on later (step 7) when a production API and database exist. Nothing real is stored anywhere.
   - **B:** write down, in the repository (a short line in `docs/ops/staging.md`), that the owner opens the gate for the waitlist table alone, on staging, with DPDP consent records; then `WAITLIST=1` on the site service with the API's address. Staging has no backups of its own (Free plan); say so in the same line.
2. **The privacy notice** must be the new one (job DQ part 2, branch `web/dq-dpdp`) before the site goes live: the website links to it from the form and from every footer. Merge the night PR first.
3. **Native review.** The Telugu, Hindi and Kannada pages carry a visible "machine-written draft" banner. They can go live with it; remove the banner only after a native reader has signed the kit.
4. **The owner's WhatsApp number** for the contact page's chat (`STACK19_WHATSAPP`, digits with the country code). Without it the contact page says the chat is not available and shows the e-mail addresses.

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
  --set-env-vars SITE_MODE=website,WAITLIST=off,STACK19_WHATSAPP=<digits or leave this variable out>
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

## Step 7. Turning the form on later (option A to B)

`gcloud run services update sme-site --project $PROJECT --region $REGION --update-env-vars WAITLIST=1` (a new revision, no rebuild), after the API at the baked-in address has `POST /v1/public/waitlist` and the owner has done step 0 option B or the production API exists. Test by submitting one synthetic entry ("Test Person", phone 9000000000) and check that the API answered; delete nothing by hand (the API has no DELETE verb): ask C1 to remove the test row.

## Rollback (each is one command; use the first that is enough)

1. **The form misbehaves or the API is down:** `gcloud run services update sme-site --project $PROJECT --region $REGION --update-env-vars WAITLIST=off`. The buttons then lead to the contact page.
2. **A bad page after a new image:** `gcloud run services update-traffic sme-site --project $PROJECT --region $REGION --to-revisions <the earlier revision>=100` (`gcloud run revisions list --service sme-site ...` names them).
3. **Take the website down completely:** Cloudflare > Workers > `stack19-site-proxy` > Domains & Routes > delete the two Custom Domains (`stack19.com`, `www.stack19.com`). The names stop answering within a minute; nothing else is affected (staging.stack19.com and e-mail are separate). To put the old state back after step 3, there was no earlier website: the names had no record; e-mail records were not touched.
4. **Search engines indexed something wrong:** Search Console > Removals for the address; fix the page; the sitemap tells them again. Setting `SITE_MODE` back is NOT a rollback (it would open the app's sign-in on stack19.com): remove the domain from the Worker instead (3).
5. **Never** run the website service without `SITE_MODE=website`: that is the whole app, with sign-in.

## What this does not do
No Cloudflare, Google Cloud, Supabase or DNS setting was changed by the night run, and nothing was deployed to stack19.com. The waitlist is not storing anything until step 0 is decided.
