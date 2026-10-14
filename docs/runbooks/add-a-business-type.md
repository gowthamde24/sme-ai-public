# Runbook: add a business type (a pack)

A business type is **data**. You add one without writing application code. This is the rule of blueprint section 13 and ADR 0084 part 1:

* a pack lives in `packages/packs/<id>/pack.json` and is checked against `packages/packs/pack.schema.json` in CI;
* **no pack id appears in code** (a lint and a test refuse a string literal equal to a pack id in the API or in the web's non-test code);
* **modules are the only extension point**: a pack switches modules on; code reads module flags, never a pack id. A new *module* is a code change (a migration, a guard), a new *business type* is not;
* a module that is off for a pack is refused **in the database** (SM701), not only hidden in the screens.

## 1. Start it

```sh
make new-pack ID=clinics        # lower case, letters, digits and underscores
```

This writes `packages/packs/clinics/pack.json` as a `draft` that already passes `make packs-check`: the smallest set of modules every pack has (today, inbox, contacts, enquiries, followups, call_list, reports, office, integrations), the default pack's English words as placeholders, no custom fields, no example data.

## 2. Fill it in (the checks tell you what is wrong)

| Part | What to decide | Rules the checker enforces |
| --- | --- | --- |
| `modules` | which of the 25 in `packages/packs/modules.json` are ON; everything else is OFF | every code is in `modules.json`; `core_tab` is one of them |
| `labels` | the words, from the CLOSED list in `packages/packs/labels.json` (40 keys); English carries all of them, te, hi and kn may be partial | no key outside the list; mark `language_review` `draft` until a native reader has read it |
| `units` | the selling units the catalogue offers (`sq_ft`, `sq_m`, `piece`, `box`, `bag`, `tonne`, `cft`, `truckload`, `set`) | a pack with the `catalogue` module needs units and a default; one without needs none |
| `custom_fields` | extra fields on contacts and catalogue items | at most 20 per entity; unique codes; class `none` only (a child's data is never a custom field on a contact); no field the lawyer has not cleared |
| `example_data` | the labelled sample (names start `Example:`, no phone, no e-mail) | needs the modules it uses (companies, contacts, enquiries, catalogue) |

What a pack **cannot** do: add a price, a GST rate, a number of days, a consent or sending rule, or loosen any safety rule. It can only choose among the existing ones, and make a business stricter.

## 3. Put it in the database

```sh
make packs-check        # schema + rules + "nothing in code names a pack id" + "every pack is in a migration"
make pack-migration     # writes supabase/migrations/<stamp>_ck_pack_data.sql (modules and packs not yet synced)
make db-reset && make db-test     # on the agent stack
```

A migration on `main` is append-only, and so is a pack: **a synced version is never edited**. `make packs-check` and `tests/test_ck_packs_data.py` fail if you change a synced `pack.json`. To change a pack, raise its `version` (and keep the old folder content in git history; the database keeps every version's manifest, so a business stays pinned to the version it chose).

## 4. Review before anyone outside can choose it

A new pack is `draft`: nobody can choose it. When the words, fields and rules are written, a **real owner of that kind of business** reviews them (blueprint section 9). Until then the status is `preview`: it is offered at sign-up with the label "Not validated by a real owner yet". Only after the review does a new version carry `status: published` and `reviewed_by` (who, in a sentence). The real-data gate (ADR 0015) stays closed for every business regardless of its pack.

The web needs no change to **show** a new type: the sign-up cards come from `GET /v1/packs`, the words from `GET /v1/tenants/{id}/pack`, the screens from `GET /v1/tenants/{id}/modules`. A new **accent** or **owl prop** token needs art from the web job; until then the web falls back to the default look.

## 5. What to tell the owner

* the pack is a **suggestion of words and switches**, not a rule engine: prices, tax and terms come from the owner and the accountant;
* removing the example data is one button; real rows are never touched;
* moving a business between packs later is an operator act with a dry-run diff, not a button (ADR 0084 part 1).
