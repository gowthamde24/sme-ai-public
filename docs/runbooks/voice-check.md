# Does every voice speak? (staging job `sme-voice-check`)

A Cloud Run **job** on the API image (module `app.conversation.voice_check`, planner brief 23 Nov 2026). For each voice of te, hi, kn, en it speaks the voice's own sample line once on its PRIMARY engine (no fallback), checks audio came back, is longer than 1 s and is not silent, and prints one line per voice id plus the characters sent per engine. No audio is kept. Cost = the characters: about 19,900 Sarvam + 3,950 Cartesia for all 222 voices. The run stops by itself at 40,000 Sarvam / 12,000 Cartesia characters (`--sarvam-cap`, `--cartesia-cap`).

Create once (reuses the nightly pronunciation job's service account, which already reads both keys; no new IAM, no key typed anywhere):
```
P=project-2757c07e-37d2-4167-88f; TAG=<the API image tag>
gcloud run jobs create sme-voice-check --project $P --region asia-south1 --image asia-south1-docker.pkg.dev/$P/sme/api:$TAG \
  --service-account sme-pron-qa-run@$P.iam.gserviceaccount.com --set-secrets CARTESIA_API_KEY=sme-cartesia-api-key:latest,SARVAM_API_KEY=sme-sarvam-api-key:latest \
  --command python --args=-m,app.conversation.voice_check --task-timeout 1800 --max-retries 0 --cpu 1 --memory 512Mi
```
Run (this is the paid step; owner's word first): `gcloud run jobs execute sme-voice-check --project $P --region asia-south1 --wait`, then read the log: `gcloud logging read 'resource.labels.job_name="sme-voice-check"' --project $P --freshness=1h --format='value(textPayload)'`. A small run: add `--args=-m,app.conversation.voice_check,--only-recommended` (about 8 voices per language). Each API deploy should move the job to the new image (`gcloud run jobs update sme-voice-check --image ...`).

## The style previews job `sme-style-previews` (owner 24 Nov 2026)
`app.conversation.style_previews`: for each RECOMMENDED voice of te, hi, kn, en (16 voices) x the 7 styles it speaks the style's shop line (data/style_lines.json, from reports/tone-samples-draft.csv; en final, te/hi/kn drafts) with the style's real voice settings (`app/conversation/style_voice.py`), keeps each good clip as WAV + manifest.json in the pron-qa bucket (`style-samples/`), prints ok/FAIL per file and the characters per engine (about 5,900 Sarvam + 2,800 Cartesia for 112 clips; caps 12,000 / 6,000). Create like `sme-voice-check` with `--args=-m,app.conversation.style_previews,--keep,/mnt/pron-qa/style-samples`; executing it is the paid step (owner's word). Then pull, encode (mono mp3 48 kbps) into `app/conversation/data/samples/styles/<voice>.<style>.<language>.mp3`; the public route `/v1/voice-style-samples/<file>` serves them.
