# Describe the job in your own words (24 Nov 2026)

`POST /v1/tenants/{t}/jobs/describe` — Owner and Admin; behind `JOBS=on`. A DRAFT only: nothing is created or switched on; the owner confirms on the job page.

Body `{ text: 3..1000 characters, language: "en"|"te"|"hi"|"kn" (default en), source: "typed"|"voice" (default typed) }` (voice is the transcript from the existing recogniser).
The sentence is DATA to the model (between per-run delimiters, never instructions) and is NOT stored: the run's record keeps a fixed label and the length only.

200 `{ understood, template_id, kind, goal, fields:[{key, value, words}], unclear:[key], nearest:[template id], unclear_words }`
* `understood:false`: no template of this business type fits; `nearest` has the three closest template ids; `fields` is empty.
* `fields`: only keys and values that exist in the real settings catalogue for the template's kind (a choice value from its options, a toggle as true/false); anything else the model said is dropped. `words` is one plain English sentence per field (the screen localises by key and value).
* `unclear`: setting keys the owner touched that could not be settled; `unclear_words` is ONE neutral line to show ("A few things were not clear from what you said: ... Please choose them yourself."), null when nothing is open.
Errors: 429 `ai_limit` (30 a workspace a day, India's day; the count is in the database), 503 `describe_unavailable` (no model, or it failed), 422 `validation_error`, 403 role.
Log words (closed, no text): `describe_dropped_key`, `describe_unclear`. Cost: about 1.5k tokens in, 300 out on Haiku, recorded in the cost ledger like every assistant run.
