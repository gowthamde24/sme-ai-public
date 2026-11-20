# Put the new landing page on stack19.com, by hand (the owner's own commands)

For the day Claude is not available. This changes ONLY the public website service `sme-site` (the page people see at https://stack19.com). It does not touch the app, the API, the database or Cloudflare. Nothing here holds a secret: the project id is not a secret, and you must be signed in to Google Cloud as yourself (`gcloud auth login`, the account that owns the project).

How it stays safe: the new version is started **with no traffic** and a test address first. Only after the checks pass do you move the traffic. The old version stays ready, so going back is one command (step 6).

Open Terminal and paste the blocks one at a time. Lines starting with `#` are comments.

## 0. Settings used by every step

```
PROJECT=project-2757c07e-37d2-4167-88f
REGION=asia-south1
SERVICE=sme-site
OLD=sme-site-00011-qun        # the version that is live today (the way back)
CAND=https://candidate---sme-site-xdnvxjiara-el.a.run.app   # the test address of the new version
gcloud config set project $PROJECT
gcloud run services describe $SERVICE --region $REGION --format='value(status.traffic[0].revisionName, status.traffic[0].percent)'
# expect:  sme-site-00011-qun   100   (if it names another version, someone already switched: stop and look)
```

## 1. Which picture (image) to deploy

The landing is the same web image as the staging app, started in website mode. Use the image that is on staging now (it is the one that was checked):

```
IMAGE=$(gcloud run services describe sme-web --region $REGION --format='value(spec.template.spec.containers[0].image)')
echo $IMAGE
# expect a line like  asia-south1-docker.pkg.dev/project-2757c07e-37d2-4167-88f/sme/web:4384df49...  (or newer)
```

If Claude told you a different image or tag to use, set `IMAGE=...` to that instead.

## 2. Start the new version with NO traffic and a test address

```
gcloud run deploy $SERVICE --region $REGION --image "$IMAGE" \
  --no-traffic --tag candidate \
  --update-env-vars SITE_MODE=website,WAITLIST=off
# it prints the new version's name, e.g. sme-site-00012-abc and "0% of traffic". Copy that name:
NEW=$(gcloud run revisions list --service $SERVICE --region $REGION --format='value(name)' --limit 1)
echo $NEW
```

`SITE_MODE=website` and `WAITLIST=off` keep the site as a website only (no app, no sign-up form: the buttons lead to the contact page). Do not change them.

## 3. Test the test address (nothing is public yet)

```
for p in / /pricing /te /hi /kn /ta /privacy /terms /contact; do printf "%s  " $p; curl -s -o /dev/null -w "%{http_code}\n" $CAND$p; done
# every line: 200

curl -s $CAND/ | grep -c "Lead Desk"                     # expect 0   (the old name is gone)
curl -s $CAND/ | grep -ciE "yearly|annual|2 months free"  # expect 0   (monthly plans only)
curl -s $CAND/ | grep -o '<title>[^<]*</title>'          # expect a title with "Stack19" and no "Lead Desk"
curl -s $CAND/ | grep -o 'href="[^"]*contact#demo"' | head -2   # expect at least one (buttons lead to the contact page)
curl -s $CAND/pricing | grep -o "₹1,999" | head -1       # expect ₹1,999 (Pro)
```

Then look at it in a browser, on your phone and your computer: open `$CAND` (copy the address printed by `echo $CAND`). Check: the first screen, the demo phone, the plans, the footer with the dotted Stack19 name, the cookie bar at the bottom (small, one line), light and dark mode, and the language switch (English, Telugu, Hindi, Kannada, Tamil). If anything looks wrong, STOP here: nothing has changed for the public; leave it and ask Claude.

## 4. Move the traffic (this is the moment it goes public)

Only after step 3 looked right:

```
gcloud run services update-traffic $SERVICE --region $REGION --to-revisions $NEW=100
```

## 5. Check from outside (the real address)

```
for p in / /pricing /te /robots.txt /sitemap.xml; do printf "%s  " $p; curl -s -o /dev/null -w "%{http_code}\n" https://stack19.com$p; done
# every line: 200
curl -s https://stack19.com/ | grep -c "Lead Desk"          # expect 0
curl -s https://stack19.com/ | grep -o '<meta name="robots"[^>]*>'   # expect: index, follow
curl -s https://stack19.com/robots.txt | head -3            # expect: Allow: /
```

If stack19.com still shows the OLD page after a minute, Cloudflare may be keeping a copy: Cloudflare dashboard > the stack19.com site > Caching > Configuration > Purge Everything, then look again (private window).

## 6. Go back (if anything is wrong, at any time) : one command

```
gcloud run services update-traffic $SERVICE --region $REGION --to-revisions $OLD=100
```

That puts the old page back within seconds. Then tell Claude what you saw.

## 7. Tidy up (later, optional)

```
gcloud run services update-traffic $SERVICE --region $REGION --remove-tags candidate
```

Removes the test address. Old versions can stay: they cost nothing while they get no traffic.

## What this does NOT do

- It does not turn on the early-access form (`WAITLIST` stays `off`): that is a separate decision about real people's data.
- It does not change the app, the API or the database, and it does not touch Cloudflare settings.
- It does not turn Jobs, the new billing or any app setting on: the website does not use them.
