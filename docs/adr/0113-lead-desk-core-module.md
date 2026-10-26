# ADR 0113: Lead Desk is a core module, on for every business (job DS, night 4 extra part E1)

Status: built on branch `api/ds-lead-desk-core` (27 Oct 2026). Source: the owner's decision of 26 Oct 2026: the new core is called **Lead Desk** and is on for the three deep packs and every template business.

## Decision
1. **A core module, not a pack module.** `lead_desk` joins the closed list of modules (`packages/packs/modules.json`, synced by `scripts/pack_migration.py`: guard `flag`, `exists_today` false) but no pack version lists it. Pack versions are immutable (a change is a new version of each of twelve packs and a re-pin of every workspace), and the default-pack test ties `exists_today` modules to the textiles version 1. `app.module_enabled(tenant, 'lead_desk')` is true for every workspace that has a pack (false for one without: default deny stays). Every other module is exactly as before.
2. **The readers say it.** `workspace_modules` returns it with the reason `core`; `workspace_pack_get` lists it among the modules. The web needs no pack knowledge: it reads the flag.
3. **One place for entitlements.** `app.module_enabled` is where a plan entitlement joins later (ADR 0084 part 6); Lead Desk being on for everyone is a decision in that one function.
4. **Schools keep their rules.** Lead Desk for a school is admission enquiries and campus visit booking. No lead finding (the `lead_finder` and `research` modules are not in the education pack). A school's batch plan or standing rule whose questions or WhatsApp text read as money (`app.outbox_content_flags` flag `money`, the same test as a school's task) is refused with SM951, which the API turns into `422 not_for_schools`.
5. **The calls plans are Lead Desk plans.** The plans catalogue goes to version 3 (names only; ids and allowances unchanged): "Pay as you go", "Lead Desk 300", "Lead Desk 1,000". The web's copy of the plans file and its tests are updated in the same change.
6. **Not done:** playbook templates for the three deep packs (they need pack contact fields, so new pack versions and new migrations of their own); listed in the contract as the next step.

## Consequences
- Where the module list is counted, it is one longer (27 modules, 18 for textiles); tests updated.
- A later "Lead Desk off" switch (for example a plan without calls) is one function change.
