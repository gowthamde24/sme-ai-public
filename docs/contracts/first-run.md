# Contract: first run by business type (C1 -> C2), 25 Nov 2026
Status: **shapes fixed, built in one PR** ("live on staging" is added to this note when it is). Source: reports/first-run-by-business-type.md (gaps 5 and 6). Same error shape as everywhere. Base `/v1/tenants/{tenant_id}`.

## 1. Set the business type (pack) of an existing workspace
`PUT /pack` body `{"pack": "<code>"}` (Owner, second factor), `code` = one of `GET /packs/catalogue`'s codes (the 13 packs; the public word `other` is sent as `general_business`, as in the sign-up). Answer 200: the same object as `GET /pack` (`{pack: {code, version, source, ...}}`; the new `source` value is `owner`).
* Allowed any time, by the Owner only. Choosing the pack the workspace ALREADY holds counts as a choice when nobody typed it (source default or legacy: the source becomes owner and one audit line is written; migration 992660, 26 Nov 2026); with any other source it changes nothing. It switches the workspace to that pack's modules, labels and custom fields. It **adds** the new pack's custom fields and **never removes or changes** a field, a record or example data that exists (the old pack's fields stay as they are).
* The same pack again: 200, nothing changes, no new audit line. An unknown or unpublished code: 422 `validation_error` `fields:["pack"]`. Not the Owner: 403; no second factor: 403 `mfa_required`.
* Audited: `workspace_pack.choose` with `source: "owner"` (who, when, from and to; no personal data).

## 2. The first-run facts that are not saree-only
`GET /first-run` (any member):
```json
{ "pack": {"code": "textiles", "source": "default | signup | owner | legacy | operator", "typed": true},
  "needs_type": false,
  "items": {"count": 3} }
```
* `typed`: false only while `source` is `default` or `legacy` (nobody chose the type): then `needs_type` is true, and the web asks ONCE ("What kind of business?") before the wizard and the checklist. A workspace made at sign-up (`source: signup`) or changed by the Owner (`owner`) is typed.
* `items.count`: how many items the workspace holds so far: the CATALOGUE rows (every row, drafts included) plus the `what-you-sell` entries that are not removed (docs/contracts/what-you-sell.md). A non-textile business saves its first item as such an entry (services, courses, properties or a price list; the style comes from its pack), so `isFresh` can read `items.count === 0` for every pack.
* Nothing else is added (no names, no prices).

## 3. Name the business type when the workspace is created
`POST /v1/tenants` takes an OPTIONAL `pack`: `{"name": "...", "slug": "...", "pack": "clinic"}`. One of the codes of `GET /v1/packs` (the public word `other` = the generic pack); omitted = today's default pack, nothing else changes. An unknown or malformed code is 422 `validation_error` `fields:["pack"]` and **nothing is created** (checked first). The new workspace's pack `source` is `owner` (the creator chose it, as with `PUT /pack`; the web reads `typed`, not the word). It uses `workspace_pack_set`, so it needs the migration of this slice (20261231988000) on the database. The in-app "Create workspace" form can now ask the type; `/setup` (first login) keeps using `POST /account/setup`.
