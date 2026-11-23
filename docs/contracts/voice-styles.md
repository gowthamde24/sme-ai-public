# Contract: 7 speaking styles, 10 background sounds, pre-recorded previews, "How it talks to you" (C1 -> C2), 24 Nov 2026
Status: **shapes fixed, built in stages** (each stage says "live on staging" in docs/contracts/voices-tones.md when done). Source: reports/voice-style-spec.md (owner's three screenshots). Same error shape as everywhere. Base `/v1/tenants/{tenant_id}`. Language words in `label`/`hint`: `{en, te, hi, kn, ta, ml, mr}`; te/hi/kn/ta/ml/mr are **drafts** (the response says `"reviewed": false`; the screen may show English meanwhile).

## 1. Styles (one list, two settings)
`GET /how-assistant-speaks` -> `tone` becomes (the old `options` strings become objects, like `background.options`):
```json
"tone": { "value": "friendly", "source": "saved | migrated | pack_default", "pack_default": "friendly", "saved": true,
          "options": [ { "id": "friendly", "label": {"en": "Friendly", "te": "...", ...}, "hint": {"en": "Warm and relaxed", ...}, "best_for": ["retail","clinic"], "reviewed": false }, ... 7 items ] }
```
The 7 ids, in this order: `friendly` (default), `respectful`, `quick` (the three that exist today, unchanged), `professional`, `calm_caring`, `cheerful`, `confident`. `PUT {"tone": "<id>"}` accepts the 7; `null` = back to the pack default; anything else 422 `fields:["tone"]`. `casual` stays test-call-only and is not in the list. The four new styles are one wording block + pace each on top of a base register (professional -> respectful, the others -> friendly), so greetings, the honest "I am an AI" line and the goodbye of the base register are unchanged; they never change what is promised, never an amount, never the AI disclosure.
**Two settings, same ids:** (A) customers: `tone` above (business default in Settings, per-job override as today); (B) the owner's own assistant: `GET/PUT /me/assistant-style` (any member, own value only):
```json
GET -> { "value": "friendly", "saved": false, "options": [ same 7 objects ] }     PUT {"value": "calm_caring"} | {"value": null}   -> same object
```
**Status 25 Nov 2026 (C1): built, HELD** (PR c1/assistant-style; migration 20261231988200 is NOT in the 30 Nov production push, planner's decision: it goes in a later push, target 7 Dec; until then production answers 500/404 on this route, so the screen keeps the browser-kept test version when the call fails). GET answer `{value, saved, options}` (`value` = the person's own choice, else `friendly`; `saved` false = not chosen); PUT `{value: <one of the 7> | null}` -> same object, 422 for anything else (`casual` too). Stored per USER on the server (a new small table `user_assistant_style`, RLS: a user reads and writes only their own row). The screen's "Test version: kept in this browser" note goes away once this is live.

## 2. Background sounds: 10 (was 3)
`background.options[]` has the same item shape as today plus the sample: `{ "id", "label": {...}, "sample_url": "/v1/background-samples/<id>.mp3" | null }` (`off` has `null`). Ids, in order: `off`, `quiet_office` (default stays Off? **No: default stays `quiet_office`** as in force today; the spec's "Off always the default" is for NEW businesses only and is a product decision, ask the planner), `busy_office`, `call_centre`, `shop`, `market`, `showroom`, `clinic_reception`, `home`, `street`. `PUT {"background": "<id>"}` accepts the 10. Each sample is a 6 s voice-free loop preview (public, long cache). Sources of every recording are listed in docs/licences/background-sounds.md; until real CC0 recordings replace them the beds are synthetic own-made placeholders.

## 3. "Hear it" is a stored file, never live for the listener
* `GET /v1/voice-samples/<voice_id>.mp3` (public, `Cache-Control: public, max-age=31536000, immutable`): ONE fixed sentence per language, the same for every voice ("Hello, I'm {name}, your assistant. How can I help you today?" and te/hi/kn equivalents), recorded once per voice (222 voices in te/hi/kn/en). `sample_ready` tells whether the file exists; the list's `sample_url` is this address.
* Style previews: `GET /v1/voice-style-samples/<voice_id>.<style>.<language>.mp3` (public, immutable). The 8 recommended voices per language x 7 styles x te/hi/kn/en are pre-recorded; **any other voice+style+language is made on the FIRST press and cached forever** (key = voice + style + language + text hash; the first press is `POST /ai-assistant/voices/style-preview {voice_id, style, language}` -> `{url, cached: false|true}`, counted against the business's daily AI allowance only when `cached` is false; the answer to a cached one is instant and free). The text of a style preview is the style's shop line (reports/tone-samples-draft.csv), not the customer's own text.
* Preview with the setting's own combination: saving a style/voice/speed/background changes the file the next "Hear it" fetches (the URL carries the combination; there is no browser-side cache of an old one).
* Custom text (the owner's own greeting) and "Test call to my phone" stay live and paid; the screen says so ("uses a little of your allowance").

## 4. Two-sided sample CALLS (per business type x tone x language, text in C2's #1049)
Text only for now; audio for them is NOT planned before 3 Dec.

## Stages (each its own PR, in this order)
1. This note. 2. The 7 styles + `GET/PUT /me/assistant-style` + the table. 3. The 10 backgrounds + their sample files + licences file. 4. The fixed-sentence voice files (the paid run) + `voice-style-samples` + the first-press cache (Postgres, capped at 3,000 rows, each audio <= 60 KB).
