# Search (the ⌘K palette): the API contract (C1 -> C2)

Status: **published 6 Nov 2026, with the route in the same PR.** Base `/v1/tenants/{tenant_id}`. Errors have the one shape `{error:{code,message,retry_after,request_id}}`.

## GET /search?q=
Any member. Each row is what that person may already see: the database's row-level security decides (a group the role cannot read comes back empty). Target < 150 ms.
- `q`: 2 to 80 characters after trimming, else `422 validation_error` with `fields: ["q"]`.
```json
{ "q": "ravi", "groups": [
  { "kind": "lead", "items": [ { "id": "uuid", "title": "Ravi Kumar", "sub": "Lakshmi Silks · Vijayawada · …3210", "at": "iso" } ] },
  { "kind": "customer", "items": [ { "id": "uuid", "title": "Lakshmi Silks", "sub": "Vijayawada" } ] },
  { "kind": "quote", "items": [ { "id": "uuid", "title": "Quote 42", "sub": "Lakshmi Silks · draft", "at": "iso" } ] },
  { "kind": "order", "items": [ { "id": "uuid", "title": "Order 17", "sub": "Lakshmi Silks · dispatched", "at": "iso" } ] },
  { "kind": "student", "items": [ { "id": "uuid", "title": "Anitha", "sub": "Adm. 2026/041", "at": "iso" } ] }
] }
```
- **Order:** groups come in this order; an empty group is left out. At most **5 items per kind**, newest first.
- **`student`:** only in a workspace that runs the school pack (`programmes`), and only for the roles that may read students.
- **What matches:**
  - **`lead`:** the contact's name or the company's name. Or, when `q` is digits (4 or more, spaces, `+` or `-` allowed), the **end** of the phone number.
  - **`customer`:** the company's name.
  - **`quote` / `order`:** the number (`42`, `Q42`, `#42`) or the company's name.
  - **`student`:** the student's name or the admission number.
- **How it matches:** case and spaces don't matter (`lakshmisilks` finds "Lakshmi Silks"). Unicode is normalised (NFC), so Telugu and other Indic text matches as typed. It is a contains-match, not fuzzy.
- `title` and `sub` are display text only; route by `kind` + `id`. Phone numbers are never returned whole, only `…` and the last four digits.
