# Contract: "How your assistant speaks" (one panel for every business). C1 -> C2, 11 Nov 2026

Status: **fixed contract**, built after the tone/addressing PR (branch `c1/pack-tone`). Owner decision (project doc `claude/decision-how-assistant-speaks.md`): one panel; "How to address customers" is folded into **Tone**. Same error shape as everywhere `{error:{code,message,retry_after,request_id}}`. Base `/v1/tenants/{tenant_id}`.
Choice: a **new endpoint** that composes what is stored in two places (the speaking style per language, the Talk training document), so the panel reads and writes ONE object. `GET/PUT /speaking-style` keeps working unchanged (the panel does not need it).

## `GET /how-assistant-speaks`  (every member)
```json
{
  "tone":  { "value": "respectful | friendly", "source": "saved | migrated | pack_default", "pack_default": "respectful | friendly", "options": ["respectful", "friendly"] },
  "words": { "languages": { "te": { "style": "everyday_mixed | everyday_pure", "region": "neutral | coastal | telangana | rayalaseema", "saved": false, "examples": "approved | draft" }, "en": {}, "hi": {}, "kn": {}, "ta": {}, "ml": {} },
             "options": { "styles": ["everyday_mixed", "everyday_pure"], "regions": { "te": ["neutral", "coastal", "telangana", "rayalaseema"], "ta": ["neutral", "chennai", "kongu"], "kn": ["neutral", "bengaluru", "north_karnataka"], "hi": ["neutral"], "ml": ["neutral"], "en": ["neutral"] } } },
  "introduce_as": { "kind": "business | owner | custom", "text": "string | null", "options": ["business", "owner", "custom"], "owner_name": "Gowtham | null",
                    "preview": { "te": "హలో, నేను … AI assistant ని. …", "en": "Hello, this is … Is this a good time to talk?" } },
  "pack_defaults": { "tone": "respectful | friendly", "words": "everyday_mixed", "region": "neutral" },
  "legacy_address": "plain | sir_madam | garu | ji | null",
  "updated_at": "iso | null"
}
```
* **tone**: `value` is what is in force. `source`: `saved` (the Owner chose it), `migrated` (nothing saved yet; the old "How to address customers" value is mapped, see below), `pack_default` (nothing saved, nothing to migrate: the business type decides, `packages/packs/call_tones.json`: schools respectful, everything else friendly). **Casual is not an option here**: it exists only on the Owner's own test call (`tone` on `POST /calls/place`).
* **words**: `formal` is **hidden from `options.styles`** (the panel offers Everyday mixed and Everyday pure). A workspace that saved `formal` earlier is shown as `everyday_pure` with `saved: true` until it saves again.
* **introduce_as**: the rules and the preview are in docs/contracts/talk-training.md ("Introduce as"). `owner_name` is the Owner's own first name from their profile, or null (then `owner` cannot be previewed: disable that option). `preview` is the opening line as a customer would hear it TODAY: Lead Desk and customer calls keep the business name until the owner says the lawyer agreed otherwise, so the card should say "On your own test calls; customer calls say the business name for now" next to it.
* **legacy_address**: what the old setting said (kept so nothing is lost); null when it was never set. Show nothing for it; it is there for the migration note.

## `PUT /how-assistant-speaks`  (Owner, second factor)
Body, any subset (a key left out is not changed; `null` resets that part to the default):
```json
{ "tone": "respectful | friendly | null",
  "words": { "te": { "style": "everyday_mixed", "region": "telangana" }, "ta": { "style": "everyday_pure" } },
  "introduce_as": { "kind": "custom", "text": "Gowtham High School's AI assistant" } }
```
Answer 200: the same object as GET. Errors: `422 validation_error` with `fields` (`tone`, `words.te.style`, `words.te.region`, `introduce_as`) and for `introduce_as` a closed reason in `message` (no_ai_assistant, digit, link, person_word, too_short, too_long, missing_text ...); `403 mfa_required`; `403` for Admin and below. `tone: "casual"` is a 422 (`fields: ["tone"]`). Everything is audited (who, when).

## What the tones mean (words for the radio buttons; Telugu rules, Hindi uses "ji/aap" the same way)
* **Respectful**: "మీరు"; the person's name + "గారు" when the name is known; "sir"/"madam" only when the name is unknown AND the gender is known from the contact or the goal, sparingly (at most twice in a call); the polite particle "అండి" about once in two or three sentences; a child or a third person by name, or "మీ అబ్బాయి"/"మీ అమ్మాయి", never "వాడు", "అది" or "గారు".
* **Friendly (the default)**: "మీరు"; the name at most once; no "గారు", no sir/madam.
* The vocabulary rule (spoken Telugu, no bookish words, English loanwords, "మేము", short sentences) applies in every tone.

## The migration of the old "How to address customers" (Talk training `address`) — nothing is lost
No database migration. The old value stays in the Talk training document; the new one is mapped on read:
| old `address` | tone in force until the Owner saves the panel |
|---|---|
| `plain` (the default value, so "never chosen") | the **business type's default** (schools respectful, everything else friendly); a school that never touched the old setting is NOT forced to Friendly |
| `sir_madam`, `garu`, `ji` | Respectful |
The first save of the panel writes `tone` into the document and leaves `address` as it was (a rollback is a one-line change). `GET /talk-training` keeps returning `address` (deprecated) and `PUT /talk-training` keeps accepting it: if a client sends only `address`, the tone follows the same mapping until `tone` is saved. The panel replaces the old "How to address customers" control; do not show both.
