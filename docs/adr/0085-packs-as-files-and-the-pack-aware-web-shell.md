# ADR 0085: business types as files, and the pack-aware web shell

Status: **ACCEPTED** by the owner's direction of 2026-10-14 (the Stack19 blueprint v1, sections 2 to 5 and 13; job CL). Builds on ADR 0084 (industry packs, proposed), 0061 (open sign-up) and 0066 (the outbox). Where this ADR and an ADR 0084 safety rule disagree, ADR 0084 wins.

## Decision

1. **A business type is a folder of data**, `packages/packs/<id>/pack.json`, checked in CI against `packages/packs/pack.schema.json`. The app's dictionary is the base; a pack lists only the words, modules, fields and checklist steps it changes. **No pack id appears in application code** (ESLint `no-restricted-syntax`, read from the folder names, and a grep test). **Modules are the only code extension point.** `make new-pack ID=<id>` starts one; `docs/runbooks/add-a-business-type.md` says how.
2. **The web shell reads the pack through one adapter** (`lib/api/pack.ts`, `GET /v1/tenants/{id}/pack`). Words come from the pack files; the module list comes from the API when it answers (pack default AND plan AND override), else from the file. A route that does not exist yet (404/501) gives the default pack, so a business that exists today sees no change.
3. **The default pack is a pack that says `"default": true`.** Its menu, phone tabs, words and first-run wizard are the product as it was; a test pins the equivalence.
4. **A module that is off is hidden and refused.** The menu offers only items whose module is on; a direct address answers a 403 page (`forbidden()`, from the workspace's template, which Next.js remakes on every move between pages). This is the screen's gate; the API and the database stay the real one.
5. **Two-step sign-up**: the kind of business, then Google, Facebook or e-mail with the line "By continuing you agree to the Terms and the Privacy Policy" (the acceptance is recorded with its version, job CF; for a provider account on the accept page after the first sign-in). The business gets a neutral name until the first checklist step asks the real one and the city.
6. **Activation steps are facts**, read from the backend (profile, catalogue, quote rules, WhatsApp, quotes). A step whose screen is not built shows "Not available yet" and is never counted as done.

## Consequences and what is not decided here

* `next.config.ts` turns on `experimental.authInterrupts` (Next.js 16) for `forbidden()`. It is documented as experimental; if a later Next.js drops it, the one call in `template.tsx` is replaced (the check itself is `moduleForPath` + `moduleOn`, both plain functions with tests).
* Three label families are real now (menu, helpers' names, the sign-up/Start/Fields screens). The ~60 web files with saree wording keep it; per-pack wording of those screens belongs to the jobs that build the screens (CN/CO construction, CR/CS education).
* The catalogue editor is still saree-shaped (`fabric`, `colours`): custom fields are shown on it, but a construction product form needs ADR 0084's `item_kind` (job CK/CN).
* `complete_setup` accepts `textiles | construction | other`: the education card completes sign-up only after job CK's migration accepts the pack codes.
* The telephone and children's-data rules are unchanged (ADR 0084 parts 4 and 5).
