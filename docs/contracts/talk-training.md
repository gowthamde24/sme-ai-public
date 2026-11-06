# How I talk to customers: the API contract (C1 -> C2; owner, 5 Nov 2026; job calls-like-a-pro part 3)

Settings -> AI assistant -> "How I talk to customers". The Owner trains how the assistant speaks on calls. Base `/v1/tenants/{tenant_id}`. Errors: `{error:{code,message,...}}`.

| Method and path | Who | Answer |
|---|---|---|
| `GET /talk-training` | Owner, Admin | `TalkTrainingOut` |
| `PUT /talk-training` | Owner, second factor (`403 mfa_required`) | body = `TalkTraining` (the whole document) -> `TalkTrainingOut`. `422 talk_training_invalid` with `reason`: `price_or_promise`, `too_many_questions`, `too_many_never_say`, `too_many_objections`, `too_many_examples`, `duplicate`, `invalid` |
| `POST /talk-training/reset` | Owner, second factor | back to the defaults -> `TalkTrainingOut` |

`TalkTrainingOut`: `{ training: TalkTraining (in force: the saved one, else the defaults), saved: bool, defaults: TalkTraining, rules: [string] (the platform's own rules, always on, not editable: show them read-only), updated_at: ts | null, wording: "draft" }`

`TalkTraining`:
```json
{
  "greeting": { "en": "Namaste! Thanks for calling Lakshmi Silks, I am the AI assistant.", "te": "..." },
  "address": "plain",
  "questions": ["What is the saree for?", "Which colours do you like?", "When do you need it?"],
  "never_say": ["guaranteed", "free delivery"],
  "objections": [{ "hears": "Too costly", "answer": "We have sarees in many ranges; the team can show you options that fit." }],
  "examples": [{ "customer": "Do you have Kanjivaram?", "answer": "Yes, we keep Kanjivaram silks; would you like to visit or see photos?" }]
}
```
- `greeting`: per language (`en te hi kn ta ml`), 2 to 200 characters each, optional. `{business}` is replaced by the business name. **The assistant always says it is an AI**: a greeting without the word "AI" is followed by the standard opening, which says it.
- `address`: `plain` (default: the first name at most once, **never "sir / madam"**), `sir_madam`, `garu` (Telugu), `ji` (Hindi).
- `questions`: at most 8, 2 to 160 characters: what to find out, one at a time, in this order. Defaults per business type (sarees, building materials, school; others: generic).
- `never_say`: at most 20 phrases, 2 to 80 characters, no duplicates. **A hard rule enforced by code**: every line the assistant is about to speak is checked (case, spaces and punctuation don't matter, whole words); a line that holds one is not spoken, a short "let me check with the team" is said instead. Defaults: "guaranteed", "100% sure", "best price in the market".
- `objections`: at most 8 `{hears, answer}`; `examples`: at most 5 `{customer, answer}` (the Owner's good answers, used for tone and length only). Answers, examples and greetings **never state an amount, a percentage or a promise** (`price_or_promise`).
- Tone, language, discount limit and handover stay in `GET/PUT /ai-assistant` (unchanged).

Not yet: the practice call with "What I'd change" (next part), recorded example answers (typed only for now).

## App v4 additions (6 Nov 2026)

### "Say it like this": `say_like`
- **Shape:** a list in the training document (GET/PUT `/talk-training`), at most 20 items: `[{"say": "pattu cheera", "instead_of": "silk saree"}, {"say": "మా షాప్", "instead_of": null}]`.
- **Fields:** `say` is 2–80 characters and never a price or a promise; `instead_of` is optional (2–80 characters).
- **Errors:** on PUT, 422 `talk_training_invalid` with `reason`:
  - `too_many_say_like` for more than 20 items;
  - `duplicate` for the same `say` twice (case ignored);
  - `price_or_promise`.
- **In the call prompt:** "SAY IT LIKE THIS, the business's own words …", one line per item. This is the text to show in the prompt preview.
- `never_say` is unchanged: in the prompt, and enforced by code on every spoken line.

### Practice calls in text: `POST /talk-training/practice` (Owner, Admin)
- **Request:** `{"language": "te", "turns": [{"who": "customer" | "assistant", "text": "…"}], "training": <optional unsaved training document>}`.
  - 1–20 turns, each 1–400 characters.
  - The LAST turn must be the customer's; otherwise 422 `validation_error`.
- **Response:** `{"reply": "…", "ended": false, "handover": false, "simulated": true}`. Send the next request with the reply appended as an `assistant` turn.
- **Same as a real call:** the same call prompt, honesty, stop and hand-over rules. A "bye" is answered with the fixed closing line and `ended: true`.
- **Draft training:** `training` lets the owner try unsaved changes. Without it, the saved training (or the defaults) is used.
- **Nothing is stored or sent, and there is no voice.**
- **Errors:** 503 `practice_unavailable` when no model is configured or it did not answer; 429 `practice_busy` past 120 turns an hour in a workspace.

## Practice call by voice (app v4 [C1], 6 Nov 2026)

The same Live talk socket, `wss://<api>/v1/tenants/{t}/voice-chat`, with a new mode.
- **Start:** `{"type": "start", "access_token": "…", "language": "te", "mode": "practice_call"}`.
- **Who:** Owner and Admin. Anyone else gets close code 4403 (`forbidden`).
- **What the person hears:** the phone assistant exactly as a caller would.
  - It uses the call's prompt with the workspace's saved training ("Never say", "Say it like this").
  - It opens with the inbound opening line (it says it's an AI).
  - The recogniser is set to the chosen language.
  - A "bye" ends it, as on a call.
- **Voice:** Sarvam only. Cartesia is kept for real test calls.
- **Nothing is stored:** no conversation, no call row.
- **Limits:** it counts against the workspace's Live talk time like any session.
- **The rest of the protocol** (audio frames, `ready`, captions, `end`) is the same as Live talk.
