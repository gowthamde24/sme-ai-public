# Contract: "What you sell" lists (C1 -> C2), 28 Nov 2026
Status: built on a branch (slice 2 of reports/what-you-sell-lists-design.md); API flag `WHAT_YOU_SELL_LISTS` (404 on every route while off). Tables: migration 20261231990000.

A **list** has a name, a kind, columns and items (rows). The existing catalogue and the four fixed styles are not listed here yet (slice 4 adds them as built-in lists).

## Routes (prefix `/v1/tenants/{t}/lists`; Owner or Admin write, with the second factor when they turned the authenticator on; every member reads)
* `GET ""` -> `{lists: [{id, name, kind, is_main, row_count, columns: [{key, label, type, choices, role, billing_period, quote_default}]}]}`
* `POST ""` `{id (the web mints it once per opening: the same id again is a retry), name 1..60, kind}` -> 201 the list with the kind's default columns. kind: products, digital, services, bookings, courses, subscriptions, rentals, food, events, other.
* `GET /{id}`; `PUT /{id}` `{name, make_main}`; `POST /{id}/remove` -> `{removed: true}` (its items go with it).
* `PUT /{id}/columns` `{columns: [{key?, label 1..40, type, choices? (type choice: 1..20 words), role?, billing_period? (price only; default one_time), quote_default?}], confirm?}`: the WHOLE ordered set, at most 12. A column with a `key` is an existing one (rename, reorder, change role or choices); without a key it is new (the server makes its key). An existing column missing from the set is hidden; if items hold information in it the call answers `column_has_data` unless `confirm: true` (the information is kept). A column's type can change only while no item holds information in it.
  * types: text, number, rupees (whole paise), yes_no, choice, photo, link (https only), date (YYYY-MM-DD), datetime, duration (whole minutes).
  * roles: `price` (type rupees; SEVERAL allowed, each with its own label and `billing_period` one_time | per_month | per_year | per_hour | per_day | per_unit | from; exactly ONE has `quote_default: true`, the first is made the default when none is named), `availability` (type choice), `quantity` (number), `how_to_buy` (link), `description` (text): one column each (`role_taken`).
* `GET /{id}/rows?limit<=50&cursor&q` -> `{items: [{id, name, cells: {<column key>: value}, active}], next_cursor}`.
* `PUT /{id}/rows/{row_id}` `{name 1..120, cells, active}` -> 201 new / 200 the same id again. A cell must fit its column (text <= 200 characters; number; rupees: a whole number of paise from 100; yes_no true/false; choice: one of the column's words; link: https; date; duration 1..525600). **Only the Owner sets or changes a rupee amount** (an Admin saving a price gets 403).
* `POST /{id}/rows/{row_id}/remove` -> `{removed: true}`.

## Closed refusals (`error.code`, also in `error.reason` and `error.fields`); plain sentences are the API's `message`
409: `list_limit` (10 lists, 3 on a trial), `column_limit` (12), `row_limit` (1,000), `name_taken` (a list, a column or an item of that list), `one_default_price`, `role_taken`, `column_has_data`. 422: `value_not_allowed`, `not_a_price`, `validation_error` (a shape the API does not take: unknown kind, role, type or period; a cell key that is not a column slug). 403 `forbidden`, 404 for a list or item that is not this workspace's or while the flag is off.

## What the assistants may do with a list (slice 4; stated now so screens do not promise more)
Amounts come only from `price` columns with an exact value; a `from` period is never spoken as an exact amount; each amount is named with its column's label and period. `how_to_buy` links may be shared when the caller asks; a paid download or access link is NEVER sent by the assistant and delivery stays outside it. A missing fact is "I will ask the owner".
