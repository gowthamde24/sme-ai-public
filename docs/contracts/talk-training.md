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
- `greeting`: per language (`en te hi kn ta ml mr`), 2 to 200 characters each, optional. `{business}` is replaced by the business name. **`defaults.greeting` has every language** (6 Nov): the standard inbound opening, which is exactly what an inbound call says when the Owner has no greeting. Show it as the suggestion; saving it unchanged changes nothing. **The assistant always says it is an AI**: a greeting without the word "AI" is followed by the standard opening, which says it.
- `address`: `plain` (default: the first name at most once, **never "sir / madam"**), `sir_madam`, `garu` (Telugu), `ji` (Hindi).
- `questions`: at most 8, 2 to 160 characters: what to find out, one at a time, in this order. Defaults per business type (sarees, building materials, school; others: generic).
- `never_say`: at most 20 phrases, 2 to 80 characters, no duplicates. **A hard rule enforced by code**: every line the assistant is about to speak is checked (case, spaces and punctuation don't matter, whole words); a line that holds one is not spoken, a short "let me check with the team" is said instead. Defaults: "guaranteed", "100% sure", "best price in the market".
- `objections`: at most 8 `{hears, answer}`; `examples`: at most 5 `{customer, answer}` (the Owner's good answers, used for tone and length only). Answers, examples and greetings **never state an amount, a percentage or a promise** (`price_or_promise`).
- Tone, language, discount limit and handover stay in `GET/PUT /ai-assistant` (unchanged).

Not yet: the practice call with "What I'd change" (next part), recorded example answers (typed only for now).
