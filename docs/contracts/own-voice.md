# The Owner's own voice, with consent: the API contract for Settings > AI assistant > "Use my own voice" (job DP, part 5)

**Status: the shapes are final for the web; the endpoints are built on branch `api/dp-own-voice`.** Until they are on a deployed API, build against the example payloads (`packages/contracts/own_voice.examples.json`, validated against the schema by a test). Files: `packages/contracts/own_voice.schema.json`, `own_voice.ts`, `own_voice.examples.json` (generated from `services/ai-api/app/ownvoice/models.py` by `make contracts`).

## The rules (owner brief)
- **Only the workspace Owner, with a second factor, can make or delete the voice.** An Admin can see the status; nobody else sees anything.
- The Owner records **a 15 to 60 second sample** and reads **one fixed consent sentence** aloud: *"I, <name>, allow Stack19 to create an AI voice of me for <business>"*. Get the exact sentence from `GET /voice-clone/sentence?name=`; the database checks it word for word.
- We store the **consent recording, the name, the time and the workspace** (in a private bucket only the Owner can read, and a record). Both recordings are kept while the voice exists. **No answer ever returns a recording or a link to one.**
- The cloned voice becomes selectable as the persona **`own_voice`** in Settings > AI assistant (`PUT /ai-assistant` with `voice_persona: "own_voice"`; `GET /ai-assistant` lists it among the personas, with `languages.<l>.available` true in en, te, hi and kn once it is ready, and false before).
- **The assistant still says it is the AI assistant.** The introduction is fixed wording; a voice of the owner does not change who is speaking. Say so on the screen.
- **"Delete my voice"** removes the voice at the provider, the sample, the consent recording, and the name from our records. An assistant that used the voice goes back to a stock one. The record keeps only that a voice existed (who consented, when, when it was deleted), with no name.
- **A fake provider only** today: no real voice is made. `fake: true` in every answer.

## Endpoints (JSON; errors `{error: {code, message}}`). Base `/v1/tenants/{tenant_id}/voice-clone`
| Method and path | Who | Answer |
|---|---|---|
| `GET /sentence?name=` | Owner | `SentenceOut` `{sentence}`: the exact words to read, with the name and the business filled in. Ask again when the name changes |
| `GET /` | Owner, Admin | `OwnVoiceOut`: `status` (`none`, `pending`, `ready`, `failed`, `deleted`), `consenting_name`, `consented_at`, `sample_seconds`, `consent_seconds`, `ready_at`, `deleted_at`, `languages`, `says_ai_assistant`, `fake` |
| `POST /` | **Owner, second factor** | body `OwnVoiceIn`: `{id, name, consent_sentence, sample_base64, sample_type, sample_seconds, consent_base64, consent_type, consent_seconds}` -> `OwnVoiceOut` (`ready`). `id` is a uuid the browser makes (a retry of the same request). The recordings are base64 in the JSON (no multipart); types `audio/webm`, `audio/ogg`, `audio/wav`, `audio/mpeg`, `audio/mp4`, `audio/x-m4a`, `video/webm`, `video/mp4` (what `MediaRecorder` makes); the sample at most 10 MB, the consent recording at most 3 MB |
| `POST /delete` | **Owner, second factor** | `OwnVoiceOut` (`deleted`). Safe to press again: nothing more happens (the API has no DELETE verb anywhere) |

## What the screen shows
1. *Name* -> `GET /sentence` -> show the sentence big, with a record button. 2. *Record the sentence* (2 to 30 s) and *record a sample* (15 to 60 s; suggest reading something natural for a minute). The browser measures both lengths and sends them (`sample_seconds`, `consent_seconds`); the server checks a WAV against its real length and the others against their size. 3. *Create* (second factor). 4. `ready` -> offer "Use it as my assistant's voice" (the persona `own_voice`). 5. A card "Your own voice" with the name, the date, a **Delete my voice** button (second factor) and a plain line: "Deleting removes the voice and both recordings."

## Errors the screen should word
| status, code | when |
|---|---|
| 403 `mfa_required` | making or deleting without a second factor; 403 for anyone but the Owner |
| 409 `voice_exists` | a voice already exists: delete it first |
| 422 `consent_sentence_mismatch` | the sentence is not the one to read (ask for it again) |
| 422 `recording_not_audio`, `recording_length_mismatch`, `recording_implausible_length`, `recording_not_base64` | a recording the server cannot accept; 413 `recording_too_large` |
| 422 `recording_missing` | a recording did not arrive: record again |
| 502 `voice_provider_refused` | the provider refused; **nothing was kept** |
| 502 `voice_provider_unreachable`, `recordings_not_removed` | a deletion stopped part-way; nothing changed that cannot be repeated: press delete again |
| 403 `workspace_read_only` | the plan ended (making or deleting are changes) |
