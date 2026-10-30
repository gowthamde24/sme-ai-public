# Nightly pronunciation round trip (staging)

What it is: a Cloud Run **job** (`sme-pron-qa`) that Cloud Scheduler starts every night at 02:30 India time. It takes a small slice of the pronunciation lexicon, speaks it with the same speech path as live talk (normaliser, lexicon, Cartesia), has Sarvam write it back, scores it, and keeps the report and the clips in a bucket for the weekly review. Code: `services/ai-api/app/pronunciation/nightly.py`. The recogniser cannot hear accent, so a pass means the right words came back, not that the sound is perfect; the weekly human-ear pack (`scripts/pronunciation_review_export.py`) covers that.

**Cost.** Cartesia is paid by the character. A night is capped at 600 characters (about 12 short clips, three languages, the canaries Dharmavaram and Anantapur always included) and a calendar month at 20,000, counted in code before anything is sent (`usage-YYYY-MM.txt` in the bucket). Sarvam speech-to-text for ~12 short clips a night is small. Change the caps with `PRON_QA_CAP` / `PRON_QA_MONTH_CAP` (see below).

**What the log carries.** Only clip ids, `ok`/`LIST`, scores, the language list and character counts. No key, no transcript. The transcripts are in `report.md` / `results.json` in the bucket.

## One-time setup (the owner runs these; staging project)

```bash
P=project-2757c07e-37d2-4167-88f; R=asia-south1
SA=sme-pron-qa-run@$P.iam.gserviceaccount.com
B=$P-pron-qa

# 1. its own service account, and a private bucket only that account can write
gcloud iam service-accounts create sme-pron-qa-run --project $P --display-name "Pronunciation nightly QA (staging)"
gcloud storage buckets create gs://$B --project $P --location $R --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets add-iam-policy-binding gs://$B --member serviceAccount:$SA --role roles/storage.objectAdmin

# 2. it may read exactly the two keys it needs
for s in sme-cartesia-api-key sme-sarvam-api-key; do
  gcloud secrets add-iam-policy-binding $s --project $P --member serviceAccount:$SA --role roles/secretmanager.secretAccessor
done

# 3. the job: the API's image (it already holds the code), the bucket mounted at /mnt/pron-qa
IMAGE=$(gcloud run services describe sme-api --project $P --region $R --format='value(spec.template.spec.containers[0].image)')
gcloud run jobs deploy sme-pron-qa --project $P --region $R --image "$IMAGE" \
  --command python --args=-m,app.pronunciation.nightly,--out,/mnt/pron-qa \
  --service-account $SA --cpu 1 --memory 512Mi --max-retries 0 --task-timeout 600s \
  --set-secrets CARTESIA_API_KEY=sme-cartesia-api-key:latest,SARVAM_API_KEY=sme-sarvam-api-key:latest \
  --add-volume "name=pron-qa,type=cloud-storage,bucket=$B,mount-options=uid=10001;gid=10001;implicit-dirs" \
  --add-volume-mount volume=pron-qa,mount-path=/mnt/pron-qa

# 4. Cloud Scheduler starts it (the same account that starts the other jobs)
gcloud run jobs add-iam-policy-binding sme-pron-qa --project $P --region $R \
  --member serviceAccount:sme-tick@$P.iam.gserviceaccount.com --role roles/run.invoker
gcloud scheduler jobs create http sme-pron-qa-nightly --project $P --location $R \
  --schedule "30 2 * * *" --time-zone Asia/Kolkata \
  --uri "https://run.googleapis.com/v2/projects/$P/locations/$R/jobs/sme-pron-qa:run" --http-method POST \
  --oauth-service-account-email sme-tick@$P.iam.gserviceaccount.com
```

The image must be one that contains `app/pronunciation/nightly.py` (any API deploy from `main` after job pronunciation-quality part 2). From then on `deploy/staging.sh deploy api` moves the job to each new image by itself.

## Try it once now, then read the result

```bash
gcloud run jobs execute sme-pron-qa --project $P --region $R --wait
gcloud run jobs executions list --project $P --region $R --job sme-pron-qa --limit 1
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="sme-pron-qa"' --project $P --limit 30 --format='value(textPayload)'
gcloud storage ls -r gs://$B/ | head -30
gcloud storage cp -r gs://$B/$(date -u +%F) ~/Desktop/stack19-jobs/pron-review/   # the report, results and the clips
```

The last log line reads `pronunciation-nightly <date>: N clips in <langs>, M passed, K to listen to: <ids>; characters sent S; month X of 20000`.

## Operate

| Want | Command |
|---|---|
| pause / resume | `gcloud scheduler jobs pause sme-pron-qa-nightly --project $P --location $R` / `resume` |
| change the caps or the keep time | `gcloud run jobs update sme-pron-qa --project $P --region $R --update-env-vars PRON_QA_CAP=600,PRON_QA_MONTH_CAP=20000,PRON_QA_KEEP_DAYS=30` |
| a different slice by hand | `gcloud run jobs execute sme-pron-qa --project $P --region $R --args=-m,app.pronunciation.nightly,--out,/mnt/pron-qa,--languages,te,kn` |
| remove it all | `gcloud scheduler jobs delete sme-pron-qa-nightly ...; gcloud run jobs delete sme-pron-qa ...; gcloud storage rm -r gs://$B; gcloud iam service-accounts delete $SA` |

Folders in the bucket older than `PRON_QA_KEEP_DAYS` (30) are removed by the job itself. Only `YYYY-MM-DD` folders are touched.

## When a line is wrong

`LIST` ids in the log are the clips to listen to first. Fix the word in the lexicon (`services/ai-api/app/pronunciation/data/lexicon.json`) or let the owner add it under Settings > AI assistant > Pronunciation; for the weekly human review use `scripts/pronunciation_review_export.py` and `..._import.py` (a verdict marks only the language that was heard).
