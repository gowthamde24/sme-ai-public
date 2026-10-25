# Outcomes: the API contract for the customer timeline and Today (job DM, C1 part)

**Status: the shapes are final for the web; the endpoints are built on branch `api/dm-outcomes-trial-assistant`.** Until they are on a deployed API, build against the example payloads (`packages/contracts/outcomes.examples.json`, validated against the schema by a test).

Files (generated from `services/ai-api/app/outcomes/models.py` by `make contracts`; a test fails if they are stale):
- `packages/contracts/outcomes.schema.json` (JSON Schema, the source of truth)
- `packages/contracts/outcomes.ts` (TypeScript interfaces)
- `packages/contracts/outcomes.examples.json` (mock payloads)

## What an outcome is
What came of **one call** or **one WhatsApp follow-up conversation**: `outcome` = `positive` | `negative` | `unclear`, a `category` and a one-line `reason`. The AI records it; the owner (or an admin) can correct it.

| outcome | categories (closed words) | shown as |
|---|---|---|
| `positive` | `interested`, `visit_booked`, `order_likely` | interested / visit booked / order likely |
| `negative` | `not_interested`, `wrong_number`, `too_costly` | not interested / wrong number / too costly |
| `unclear` | `call_back_later`, or `null` | call back later / unclear |

The category always belongs to its outcome (the API answers 422 for a wrong pair; so does the database). Words for the screens are yours (the API sends only the closed words); `reason` is a plain sentence (English today, fixed per category when the AI read a WhatsApp reply).

**No child data.** Nothing in any shape refers to a student. In an **education workspace `reason` is always `null`**: show the category's fixed words instead (the same for a person's text: it is dropped there). Outcomes are about the adult who enquired or the adult we write to.

## Endpoints (all JSON, errors `{error: {code, message, ...}}`)
| Method and path | Who | Answer |
|---|---|---|
| `GET /v1/tenants/{tenant_id}/outcomes` | any member (a Viewer too) | `OutcomeListOut` `{items, has_more, next_cursor}`, newest first. Query: `contact_id` (the **customer's timeline**), `day` (`YYYY-MM-DD`, an India day), `limit` (1 to 100, default 50), `cursor` (the previous page's `next_cursor`) |
| `GET /v1/tenants/{tenant_id}/outcomes/totals` | any member | `OutcomeTotalsOut`: per India day, **zero-filled**, with `total`. Query: `from`, `to` (`YYYY-MM-DD`; both default to today; at most 92 days). **Today's line** "[N] positive . [N] not interested" = `total.positive` and `days[0].by_category.not_interested` for today |
| `POST /v1/tenants/{tenant_id}/outcomes` | Owner, Admin, Sales | body `OutcomeIn` -> `OutcomeRecordedOut` (201). The same `(kind, source_id)` twice is one outcome (`replayed: true`, nothing changed) |
| `PATCH /v1/tenants/{tenant_id}/outcomes/{outcome_id}` | Owner, Admin | body `OutcomeCorrectionIn` `{outcome, category, reason}` -> `OutcomeOut` with `corrected: true`; `ai_outcome` / `ai_category` keep what the AI said |

`OutcomeOut`: `id`, `contact_id`, `lead_id` (or null), `kind` (`call` | `whatsapp_followup`), `source_id`, `outcome`, `category`, `reason`, `recorded_by` (`ai` | `person`), `corrected`, `corrected_at`, `ai_outcome`, `ai_category`, `occurred_at`, `recorded_at`.

## How the AI records them (today and later)
- **WhatsApp follow-ups, built:** when a customer replies and we wrote to them in the last 14 days, the webhook reads the reply with a cautious word list (English, Hindi, Telugu, Kannada; a first draft for native review) and records `positive` / `negative` / `unclear` only when the signal is clear (a mixed or vague reply records nothing). **One AI outcome per customer per conversation (24 hours):** a later reply can only turn an unclear or positive word into a negative one (for example "interested" then "stop"). A person's correction is never overwritten. An opt-out ("STOP") is a negative `not_interested`.
- **Calls:** telephony is not built. The call pipeline will `POST` the outcome with `kind: "call"` and the call's id as `source_id`. Until then an Owner, Admin or Sales person can record one by hand with the same call (the screens can offer it).
- Dues call results (`paid`, `promised`, `call_later`, `wrong_number`, `stop`) on the call list are a different thing and are unchanged.

## For the screens
- Customer timeline: `GET .../outcomes?contact_id=...`; show a coloured word (positive / negative / unclear), the category's words and the reason; show "corrected by the owner" when `corrected` is true. Offer a correction control to Owner and Admin only.
- Today: `GET .../outcomes/totals` once; empty day = all zeros, show nothing or "no calls yet".
- A Viewer may read both; do not offer them the controls.
- A **read-only** workspace (`access: "read_only"`, billing switch) refuses the POST and the PATCH with 403 `workspace_read_only`; reads keep working.
