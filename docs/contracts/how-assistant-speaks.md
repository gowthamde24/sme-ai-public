# Contract: "How your assistant speaks" (one panel for every business). C1 -> C2, 11 Nov 2026

Status: **fixed contract**, built after the tone/addressing PR (branch `c1/pack-tone`). Owner decision (project doc `claude/decision-how-assistant-speaks.md`): one panel; "How to address customers" is folded into **Tone**. Same error shape as everywhere `{error:{code,message,retry_after,request_id}}`. Base `/v1/tenants/{tenant_id}`.
Choice: a **new endpoint** that composes what is stored in two places (the speaking style per language, the Talk training document), so the panel reads and writes ONE object. `GET/PUT /speaking-style` keeps working unchanged (the panel does not need it).

## `GET /how-assistant-speaks`  (Owner, Admin)
Built (branch `c1/how-speaks`, 11 Nov 2026). **Owner and Admin only**, not every member: the Talk training document that holds the tone and the introduction is readable by them only, and showing Sales or Viewer the business type's default instead of what is saved would be wrong. Sales and Viewer get 403. `Cache-Control: no-store`.
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
* **introduce_as**: the rules and the preview are in docs/contracts/talk-training.md ("Introduce as"). `owner_name` is the Owner's own first name from their profile, or null (also null when an Admin reads: an Admin's profile is not the Owner's) (then `owner` cannot be previewed: disable that option). `preview` is the opening line as a customer would hear it TODAY: Lead Desk and customer calls keep the business name until the owner says the lawyer agreed otherwise, so the card should say "On your own test calls; customer calls say the business name for now" next to it.
* **legacy_address**: what the old setting said (kept so nothing is lost); null when it was never set. Show nothing for it; it is there for the migration note.

## `PUT /how-assistant-speaks`  (Owner, second factor)
Body, any subset (a key left out is not changed; `null` resets that part to the default):
```json
{ "tone": "respectful | friendly | null",
  "words": { "te": { "style": "everyday_mixed", "region": "telangana" }, "ta": { "style": "everyday_pure" } },
  "introduce_as": { "kind": "custom", "text": "Gowtham High School's AI assistant" } }
```
Answer 200: the same object as GET. Errors: `422 validation_error` with `error.fields` (`tone`, `words.te.style`, `words.te.region`, `introduce_as`) and, for `introduce_as` and for a region that does not belong to its language, **`error.reason`** (a closed word; the message is a fixed sentence): `no_ai_assistant`, `digit`, `link`, `brace`, `person_word`, `too_short`, `too_long`, `missing_text`, `text_not_allowed`, `not_a_name`, `unknown_kind`, `region_not_of_language`. Every part is checked before anything is written, so a refused body changes nothing; `403 mfa_required`; `403` for Admin and below. `tone: "casual"` is a 422 (`fields: ["tone"]`). Everything is audited (who, when).

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


## Notes from the build
* `words` accepts the six languages te, en, hi, kn, ta, ml (Marathi stays in `GET/PUT /speaking-style` only). `words.<lang>: null` puts that language back to the default; a language not in the body is not touched (a `formal` saved earlier in an untouched language stays as it is). `formal` in a PUT is a 422.
* The first save of `tone` or `introduce_as` on a workspace that never saved its Talk training writes the whole document with the business type's defaults (questions, examples ...) and only those two parts changed, exactly as `PUT /talk-training` does, so nothing the calls use today disappears.
* `preview` is the opening line of the Owner's own test call with the tone in force and the saved introduction; Lead Desk and customer calls keep the business name for now.
* Two stores are written (the Talk training document, then the speaking style), each audited by its own function; if the second fails the first stays (the PUT answers an error; a retry is safe, it is idempotent).
