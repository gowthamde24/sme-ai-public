# Contract: "How it talks to you" (C1 -> C2), 14 Nov 2026 (owner item G)

Saved **per user** (each staff or family member has their own), not per business. It changes how the assistant talks to THAT person in Talk live, in chat replies and in the owner persona everywhere; the customer-facing persona (calls, WhatsApp) is untouched ("How it talks to customers" stays as it is). Defaults for a new user: Respectful + Normal speed (by name, natural mix, the language's default voice). C2's proposal is accepted with the changes marked **(C1)**.

## 1. Routes (any signed-in member; the user is the token's user; no `tenant` in the path)
* `GET /v1/me/talk-prefs?language=te` ->
```
{ "voice":   {"id":"te-deepthi","name":"Deepthi","label":"Calm","gender":"female"},
  "style":   "friendly"|"respectful"|"very_formal"|"short_direct",
  "address": "by_name"|"garu"|"sir_madam"|"anna_akka",
  "words":   "pure"|"mix"|"more_english",
  "speed":   "slower"|"normal"|"faster",
  "is_default": true|false,
  "options": {                                  // (C1) the lists come from the server, so a new voice appears without a web change
     "voices":  [ {"id":"te-sindhu","name":"Sindhu","label":"Bright","gender":"female","sample":true}, ... ],     // the language's voice catalogue (app/conversation/data/voices.json), by label Warm|Calm|Bright
     "style":   ["friendly","respectful","very_formal","short_direct"],
     "address": ["by_name","garu","sir_madam","anna_akka"],      // `anna_akka` only when the language is te, kn or hi (else it is left out); `garu` only for te and kn
     "words":   ["pure","mix","more_english"],
     "speed":   ["slower","normal","faster"] } }
```
`language` (te|kn|hi|en|ta|ml|mr) picks the voice list and the address options; omit it for the user's current conversation language. The **labels are C2's** (per language, in the review CSV); C1 owns the ids above. The voice is stored per user AND language (the same person may have a Telugu and a Hindi voice); `voice` in the answer is the one for `language`.
* `PUT /v1/me/talk-prefs` `{language?, voice?: "te-sindhu", style?, address?, words?, speed?}` (partial; any subset) -> the same body + `undo_token` (valid 15 minutes) and `changed: ["speed"]`. 422 `validation_error` for an id outside the options.
* `POST /v1/me/talk-prefs/undo` `{undo_token}` -> the body again with the previous values. 404 when expired or already used; 409 when something changed since (then nothing is undone).
* `POST /v1/me/talk-prefs/preview` `{language, option: {voice|style|address|words|speed: value}}` -> `200 {text, content_type:"audio/wav", sample_rate:24000, audio_base64}` (a short sample sentence in the language, spoken with the chosen option applied to the user's other current choices; Cartesia; **cached per language + voice + option + the user's other choices**, so a repeat tap costs nothing). 404 `not_available` when voice is off or the language has no voice yet; 429 on too many previews (a handful per minute).

## 2. What each choice does (so the labels can say it)
| Choice | Effect |
|---|---|
| voice | the voice of Talk live and of spoken replies for this person (Cartesia); Warm / Calm / Bright are the catalogue's labels |
| style | Friendly: first-name warm, relaxed. Respectful (default): polite forms, a little more formal. Very formal: complete polite sentences, no slang. Short & direct: the answer first, as few words as possible |
| address (Calls you) | by name (default) = the person's own name, neutral polite forms; `garu` = "<name> గారు"; `sir_madam` = sir/madam (only because the person chose it); `anna_akka` = anna / akka (te, kn, hi). This replaces the profile's free-text `address_as` (the old field keeps working and is derived from this choice) |
| words | Pure = the language's own words where they exist; Natural mix (default) = English business words as people say them; More English = mostly English words inside the language's grammar |
| speed | the speaking speed of the voice (about 0.85 / 1.0 / 1.15) and, for Slower, shorter sentences |

## 3. By voice or chat
The same fields change by talking: "కొంచెం గౌరవంగా మాట్లాడు" (style: respectful), "speak slower" (speed: slower), "call me by my name". The assistant's settings tool applies a SMALL setting at once and answers with an undo chip: the turn's `action` / `work_card` carries `{kind:"talk_prefs", changed:[...], summary:"<sentence in the conversation's language>", undo:{state:"available", token, until}}`; undo = `POST /v1/me/talk-prefs/undo`. The audit log records the change (who, what, when). Casual chat never changes a setting by accident: only an explicit request does.
