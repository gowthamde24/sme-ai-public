# Demo workspaces of staging: the three deep packs and the two Lead Desk businesses

All synthetic. Accounts are fake owners on the reserved domain `demo.example.test`; phone numbers are in the app's fake convention (`+00 000 000 NNNN`, which cannot ring or message anyone); the workspaces are called `DEMO ... (synthetic)`, exempt from the read-only lapse and marked demo. Their passwords and authenticator secrets are in Secret Manager (`sme-demo-<pack>-password`, `sme-demo-<pack>-totp`), nowhere else.

| Pack | Workspace | Owner login |
|---|---|---|
| textiles | DEMO Staging Textiles (synthetic) | demo-textiles@demo.example.test |
| construction_materials | DEMO Staging Construction Materials (synthetic) | demo-construction-materials@demo.example.test |
| education | DEMO Staging Education (synthetic) | demo-education@demo.example.test |
| real_estate | DEMO Sri Sai Homes (synthetic), a builder in Hyderabad | demo-real-estate@demo.example.test |
| coaching | DEMO Vidya Coaching Centre (synthetic), tuition in Vijayawada | demo-coaching@demo.example.test |

## What the two Lead Desk businesses hold (night 4, part B2)
- Five **approved facts** the assistant may state (product, place, hours, policy, FAQ).
- **Leads from four sources**, as files: Meta lead ads (8), IndiaMART (5), website form (4), Excel upload (10), dated over the last six days, with a cost per lead per source.
- A **standing rule**: new leads from `meta_lead_ads` get a call within two minutes in calling hours (not retroactive).
- **One batch approved once** (the Excel leads) with eight outcomes reported: no answer, interested (with budget and area, so two hand-offs), not interested, call back later, voicemail, already bought, wrong number (stops), visit booked.
- **Two tasks** ("Ask Vijaya to do it", planned by Claude): a supplier price enquiry to four supplier contacts, and a call-the-new-leads task; both approved once and run by the fake dialer (every call result says `simulated`). The second may still be running when you look.

## Commands (staging only; both refuse any other project)
- Create or complete everything (idempotent; needs the admin key, read into memory only, and Secret Manager access):
  `python3 -I scripts/seed_staging.py --i-know-this-loads-demo-data-into-staging --project-ref uiallwgywitryxatcqxf --api-url https://<api>`
- Then mark the new workspaces exempt and demo: `python3 -I scripts/exempt_demo_workspaces.py --apply`.
- **Fresh leads of the day** (three new website-form leads in each Lead Desk workspace; sign-in only, no admin key): `python3 -I scripts/refresh_demo_leads.py --i-know-this-loads-demo-data-into-staging --project-ref uiallwgywitryxatcqxf --api-url https://<api>`. There was no daily "demo freshness" job in the repository when this was written; run this once a day (or from any scheduler the owner chooses).

## The owner's three TEST workspaces (4 Nov 2026, job test-workspaces)
Owned by the owner's OWN staging account (sodanapalligowthamreddy@gmail.com), synthetic only (real-data gate closed), billing-exempt, on the assistant's allow-list:

| Pack | Workspace | Made by (helper, leaves at hand-over) |
|---|---|---|
| textiles | Lakshmi Silks (test) | owner-test-textiles@demo.example.test |
| construction_materials | Sri Sai Cements (test) | owner-test-construction-materials@demo.example.test |
| education | Vidya Public School (test) | owner-test-education@demo.example.test |

The owner's account has an authenticator on, so no script acts as the owner: a helper account makes each workspace (its secrets: `sme-owner-test-<pack>-password` / `-totp`), the operator adds the owner as Owner (`app.operator_add_owner_exception`, reason recorded), and the helper fills the week through the API. The three workspaces carry `workspace_limit = 4` (the owner's one + these three). The owner's profile in each: display name "Gowtham", the language pill on Auto.
- Make or complete them (idempotent): `python3 -I scripts/seed_owner_test.py --i-know-this-loads-demo-data-into-staging --project-ref uiallwgywitryxatcqxf --api-url https://<api> --phase provision` then `--phase seed` (the week: `scripts/owner_test_data.py`; realistic names, fake `+00` phones, `example.test` e-mails, nothing sent).
- Hand-over (last): `--phase handover`: each helper leaves its workspace. To seed again later, add the helper back first: `select app.operator_add_member('<slug>', '<helper>', 'admin', '<reason>')`.
- Look at them in a browser (as the helper, before the hand-over): `node e2e/staging-owner-test.mjs [--mode shots|dump|switcher]`; pictures in /Volumes/Stack19/stack19/v2-overnight/shots-tw.
- "Remove example data" / "Remove and load it again" on Today reach only the pack's labelled sample (names start "Example:"), not the week: widening that needs the API (asked in ~/Desktop/stack19-jobs/c2-to-c1.md).
