# Contract: Lead Desk is the core (night 4 extra, part E1; C1 -> C2)

OWNER DECISION (26 Oct 2026): **Lead Desk** is the name of the core of Stack19 (lead sources -> AI calls -> WhatsApp -> outcome -> follow-ups -> reports, plus "Ask Vijaya to do it") and it is **ON for every business**: the three deep packs (textiles, construction materials, schools) and every template business. Stack19 = Vijaya (the assistant everywhere) + Lead Desk (the core) + industry packs (extra depth). Published before the code; shapes are final unless a line says "draft".

## 1. The switch (what the web reads)
- `GET /v1/tenants/{t}/modules` (any member) now lists the module **`lead_desk`**: `{ "module": "lead_desk", "enabled": true, "reason": "core" }`. Every other module keeps `reason: "pack"`. It is `enabled: true` for every workspace that has a pack (so for every workspace); a workspace with no pack row has nothing on (default deny stays).
- `GET /v1/tenants/{t}/pack` (`modules` array) includes `"lead_desk"` for every pack.
- Pack-specific modules (quotes, orders, materials, programmes, fees, dues, lead_finder, research, ...) are unchanged: still default-deny, still listed by the pack that has them. Schools still have no `lead_finder` and no `research` (no lead finding), and still no fees, marks or dues talk by the assistant.
- Nothing is written into pack versions (they are immutable); the database turns `lead_desk` on. The place where a plan entitlement can join later is `app.module_enabled`.

## 2. What is Lead Desk in the API (the routes, unchanged paths)
`/v1/tenants/{t}/lead-playbook`, `/knowledge/*`, `/lead-imports*`, `/lead-sheet-links*`, `/lead-sources*`, `/v1/lead-intake/*`, `/outreach/*` (batches, rules, items, hand-offs, reports, source costs, policy), `/tasks/*`, `/outcomes*`. The paths keep their names; "Lead Desk" is the product name for them.

## 3. Schools (admission enquiries)
Lead Desk works for a school as speed to lead on admission enquiries and campus visit booking. The goals a school's standing rule may use stay `counselling`, `site_visit`, `callback`. A school's batch plan or standing rule whose **questions or WhatsApp text read as money (fees, marks, dues, amounts)** is refused with `422 not_for_schools` (the same code as a school's task). Other workspaces may talk about an amount in the owner's own words (the Owner approves the plan).

## 4. Plan names (the calls plans are Lead Desk plans)
`GET /v1/plans` (catalogue version 3): the ids are unchanged; the names change: `calls_payg` = "Pay as you go", `calls_300` = "Lead Desk 300", `calls_1000` = "Lead Desk 1,000". The main plans (Starter, Growth, Business) keep their names; "workforce plans = Lead Desk + industry pack + lead finding + research" is how the web describes them. Prices stay null ("at launch"). Names are the same in every language. A synced catalogue version is never edited: workspaces that read version 2 keep reading the names they saw.

## 5. Not built here (next steps, noted)
- Lead Desk playbook templates for the three deep packs (what to ask, objections, follow-ups for sarees / building materials / school admissions): `GET /v1/lead-templates/{pack_id}` still answers 404 for them, and `GET /lead-playbook` says `template_pack: null`. The deep packs use the same Lead Desk routes with the owner's own questions until their templates are written (they need contact fields in the pack, which means new pack versions).
