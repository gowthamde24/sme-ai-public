# Typing by voice: `POST /v1/tenants/{t}/speech/transcribe` (9 Nov 2026)

One mic on every free-text field. The browser records, posts the recording, and puts the words into the field.

## Request
`multipart/form-data`:
- **`audio`:** the recording, whatever `MediaRecorder` gives. WebM/Opus (Android Chrome), MP4/AAC (iPhone Safari), Ogg, WAV, FLAC and MP3 are accepted, and all of them were checked against the real speech service.
- **`language`:** `te`, `kn`, `hi`, `en` or `auto` (default `auto`).
  - **A named language** gives clean punctuation. English words are written in that language's script ("వాట్సాప్").
  - **`auto`** is for speech that mixes languages. English words stay in Latin letters ("WhatsApp", "photos"), and the language is detected.
  - Pick `auto` when the field's language isn't known. Pick the app's language when it is.

Who: Owner, Admin and Sales (the same as the assistant's mic). A Viewer gets 403.

## Answer
`200 {"text": "…", "language": "te" | "kn" | … | null}`

`text` is ready to put in the field: the brand is written `Stack19`, and an amount has Indian grouping (`₹2,600`, `₹1,25,000`).

## Limits
| What | Limit |
|---|---|
| One recording | **30 seconds** and 1.5 MB (WAV 12 MB) |
| One person | 20 minutes a day (India time), 12 recordings a minute |
| One business | the workspace's daily talking time (the same seconds as Live talk and dictation) |

- **Why 30 s and not 60:** the speech service itself refuses more (tested: HTTP 400 at 40 s). The API image has no ffmpeg by design, so it cannot cut a WebM or MP4. A longer note is two recordings: the web stops at about 28 s and starts the next one.
- **Counting:** the seconds are counted when the speech service has been asked, and given back if it failed. The business total is exact. The per-person count is kept in memory per server, so with two servers a person could reach at most twice the allowance.

## Errors
The usual shape `{"error": {"code", "message", "retry_after", "request_id"}}`. Show the `message`.

| `code` | Status | When |
|---|---|---|
| `too_long` | 422 | over 30 s, or too big a file |
| `empty` | 422 | too short, silence, or nothing could be heard |
| `cap_reached` | 429 | the person's or the business's talking time for today is used up, or more than 12 in a minute. `retry_after` is the seconds to wait (to India midnight for the daily ones) |
| `unsupported` | 415 | not a recording the speech service can read, a bad language, or not multipart |
| `unavailable` | 503 | typing by voice is not switched on |
| `timeout` | 504 | the speech service took too long; try again |

## Privacy
The recording is held in memory for the request and never stored. The words are never logged: a log line holds only the seconds, the number of characters, the language, the milliseconds and the cost.

## Cost
List price at Sarvam: Rs 0.49 per minute of audio, pay as you go (sarvam.ai/api-pricing, 9 Nov 2026). A recording is billed by its length: a 10-second field costs about 8 paise. The per-person day cap is under Rs 10, and the business cap under Rs 30 at the staging default of 60 minutes.

## What the speech service gets wrong (synthetic clips; real speech will be worse)
- A large amount said in words may come back as words ("ఒక లక్షా ఇరవై ఐదు వేలు రూపీస్") instead of digits. `auto` gives digits more often.
- `auto` can drop the question mark and commas, and may turn "one" into "1" ("1 ಕೆಂಪು ಸೀರೆ") or "six o'clock evening" into "6:00 PM".
- Spoken dates, names of people and products, and noisy shops were not tested.
