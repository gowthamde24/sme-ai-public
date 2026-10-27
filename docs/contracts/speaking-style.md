# Contract: speaking style (job DS, night run 27 Oct; C1 -> C2)

How the assistant TALKS. The owner (a native Telugu speaker) said the samples sound like "an AI reading pure bookish Telugu"; customers talk everyday Telugu with English words mixed in. Generated schema: `packages/contracts/speaking_style.schema.json` / `.ts`.

## `GET /v1/tenants/{t}/speaking-style` (every member)
```json
{ "languages": { "te": { "style": "everyday_mixed", "region": "neutral", "saved": false, "examples": "approved" },
                 "en": {…}, "hi": {…}, "kn": {…}, "ta": {…}, "ml": {…} },
  "options": { "styles": ["everyday_mixed", "everyday_pure", "formal"], "default_style": "everyday_mixed",
               "regions": { "te": ["neutral","coastal","telangana","rayalaseema"], "ta": ["neutral","chennai","kongu"], "kn": ["neutral","bengaluru","north_karnataka"], "hi": ["neutral"], "ml": ["neutral"], "en": ["neutral"] } } }
```
- `style`: `everyday_mixed` (DEFAULT: how people talk, with the English words people use: saree, stock, offer, price, WhatsApp, photos, booking, site visit, fees, OK), `everyday_pure` (spoken, fewer English words), `formal` (written register; only if the Owner wants it).
- `region`: neutral spoken by default; Telugu coastal / telangana / rayalaseema; Tamil chennai / kongu; Kannada bengaluru / north_karnataka.
- `saved`: false = the default is shown. `examples`: `approved` (the owner read the example lines of that language: Telugu) or `draft` (waits for a native reader; show a "draft" mark).

## `PUT /v1/tenants/{t}/speaking-style` (Owner, second factor)
Body `{ "languages": { "te": { "style": "...", "region": "telangana" }, "ta": { "style": "everyday_pure" } } }`; a language left out goes back to the default. 422 for an unknown style/language/key or a region that is not that language's. The answer is the same as the GET.

## What changes elsewhere
- The sample lines in `GET /ai-assistant` (`intro`, preview samples) are now everyday spoken text in all six call languages (the English noun "assistant" stays in Latin letters in every language). `wording` stays `"draft"` except Telugu.
- WhatsApp message drafts (`POST …/leads/{id}/draft-message`) now carry the workspace's speaking style for the customer's language.
