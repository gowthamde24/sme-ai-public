# Refreshing the voice catalogue (what Cartesia and Sarvam offer now)

The catalogue (`services/ai-api/app/conversation/data/voices.json`) holds EVERY voice we offer: the 45 Cartesia voices of `scripts/voice_catalogue_build.py` and every Sarvam Bulbul v4 Flash speaker documented for Telugu, Hindi, Kannada, English and Tamil. Nothing here needs a key typed in a shell.

## Cartesia: what is new or gone (free, read only)

`python -m app.conversation.cartesia_refresh` asks Cartesia's voice LIST for every call language and gender (no characters are spoken, nothing is billed) and prints `NEW <language> <gender> <voice id> <name>` for voices the catalogue does not have and `GONE ...` for catalogue voices Cartesia no longer lists. It writes nothing. It runs as a Cloud Run job on the API's image with the key bound from Secret Manager, the same pattern as the off-topic eval (docs/runbooks/offtopic-eval.md); the key is never typed in a shell.

One-time creation (staging; no IAM change):

    gcloud run jobs create sme-cartesia-voices --project project-2757c07e-37d2-4167-88f --region asia-south1 \
      --image asia-south1-docker.pkg.dev/project-2757c07e-37d2-4167-88f/sme/api:<tag> \
      --service-account sme-worker-run@project-2757c07e-37d2-4167-88f.iam.gserviceaccount.com \
      --set-secrets CARTESIA_API_KEY=sme-cartesia-api-key:latest --command python --args=-m,app.conversation.cartesia_refresh \
      --max-retries 0 --task-timeout 300

Run it and read the result:

    gcloud run jobs execute sme-cartesia-voices --project project-2757c07e-37d2-4167-88f --region asia-south1 --wait
    gcloud run jobs executions logs read <execution> --project project-2757c07e-37d2-4167-88f --region asia-south1

(Every API deploy moves the job to the new image only if `deploy/staging.sh` is told about it, as it is for the off-topic job; until then update the image by hand: `gcloud run jobs update sme-cartesia-voices --image ...`.)

Adding a voice it reports: run `scripts/voice_catalogue_build.py` (it scores candidates with Sarvam speech-to-text and renders the sample; it spends Cartesia and Sarvam characters, so it is run on purpose by someone who may), or add the entry to `voices.json` by hand in the file's own layout (id `<language>-<name>`, `provider: cartesia`, a same-language, same-gender Bulbul v4 voice as `fallback`, `listed: true`, `to_confirm_by_native_listener: true`), and render its sample with `scripts/voice_catalogue_samples.py --only <id>`.

## Sarvam: new speakers

Sarvam publishes its speakers on https://docs.sarvam.ai/api/api-guides-tutorials/text-to-speech/voices (and none carries a gender). A new `<name>_<language>_<style>` persona becomes an entry with `provider: sarvam`, model `bulbul:v4-flash`, `gender_source: name` and the Cartesia default of its language and gender as `fallback`. `tests/test_vl_all_voices.py` pins the documented counts: when Sarvam adds speakers, update the numbers there on purpose.

## What a play costs

A preview or sample of a Cartesia voice is covered by the subscription. A Sarvam voice costs about Rs 0.2 a play (about 100 characters at Rs 2 per 1,000). The per-workspace daily character cap of the preview (3,000 characters) and the minute limit stay as they are.
