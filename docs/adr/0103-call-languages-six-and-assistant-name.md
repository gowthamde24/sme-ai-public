# ADR 0103: six call and WhatsApp languages, and the assistant's name for every member (job DQ, part 3)

Status: built on branch `api/dq-languages` (night run 27 Oct 2026).

## Decision
1. **The call and WhatsApp languages are en, te, hi, kn, ta, ml** (owner, 26 Oct). The app's own screens stay en/te/hi/kn (sign-up, pack activation, the account language): those lists were deliberately NOT touched, and a test says so.
2. **The database lists are rewritten from the catalog, not re-typed.** About 60 CHECK constraints and functions listed `'kn', 'ta'`. Migration `20261202090000` re-creates each from its own definition with `'ml'` added (owner, grants, settings and body stay exactly as they were) and a pgTAP test (`124`) fails if a later migration brings a five-language list back. Why not copy 60 functions by hand: each copy is code another job owns, and a hand copy is where a list gets dropped.
3. **What decides "a person must read this" learns Malayalam.** `app.outbox_content_flags` (money, commitment, complaint words and the Malayalam digits in the currency rule) and `app.outbox_disclosure` (the AI line of every WhatsApp message) get Malayalam entries in the same migration; without them a Malayalam message about a price would pass as an automatic one. The voice catalogue gets a synthetic `fake-ml` voice, the four personas map to it, and the spoken AI line has a Malayalam first draft.
4. **Every Malayalam and every Tamil text is a draft for a native reader** (`wording: "draft"` where the API says so, `language_review: draft` on a quote, `CHECKED_LANGUAGES` stays `{en}` for visits). The tables: assistant introductions and sample lines, fixed replies of the Ask assistant, visit confirmations, trip updates, quote words and units, payment-request and missed-call lines, marks messages. Nothing was machine-translated by a model at run time.
5. **The assistant's name is public inside the workspace.** `GET /v1/tenants/{id}` carries `assistant_name` (null before the first save) for Owner, Admin, Sales and Viewer, through `public.assistant_name_get`, which returns that one field and nothing else of the settings. The settings themselves stay Owner/Admin only.

## Not done
- Own-voice cloning stays at four languages (it is the Owner's recording; no provider speaks Malayalam from a clone yet).
- The Sarvam speech engine's Malayalam is part of `voice/sarvam` (job DQ part 1).
