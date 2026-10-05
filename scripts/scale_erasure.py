"""LOCAL-ONLY scale check for the workspace-wide erasure (T006b review fix 3, ADR 0014).

Creates a scratch workspace on the LOCAL stack, bulk-inserts about 50,000 rows across the sweep columns (as the database owner, with
triggers off for speed), then runs a workspace-wide erasure through PostgREST as the Owner, exactly as the API does, and prints the
durations. The `authenticated` role has a statement_timeout (8s on hosted Supabase, the same locally); a 57014 here means the real
thing would be cut off too. Refuses any URL that is not local. Leaves the scratch workspace behind: `make db-reset` removes it.

    cd services/ai-api && ../../scripts/with-local-supabase-env.sh .venv/bin/python ../../scripts/scale_erasure.py [rows_per_unit]
"""

from __future__ import annotations

import os
import sys
import time
import uuid
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests" / "integration"))
import operator_sql  # noqa: E402  (talks to the LOCAL database container only)

URL = os.environ["SUPABASE_URL"].rstrip("/")
ANON = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ["SUPABASE_ANON_KEY"]
if not URL.startswith(("http://127.0.0.1", "http://localhost")):
    sys.exit("scale_erasure: refusing a non-local stack")
UNIT = int(sys.argv[1]) if len(sys.argv) > 1 else 1000  # 1000 -> about 53,000 rows


def rest(method: str, path: str, token: str | None = None, **kw: object) -> httpx.Response:
    headers = {"apikey": ANON, "Authorization": f"Bearer {token or ANON}", "Content-Type": "application/json"}
    return httpx.request(method, f"{URL}{path}", headers=headers, timeout=120, **kw)  # type: ignore[arg-type]


email = f"scale-{uuid.uuid4().hex[:10]}@it.example.test"
signup = rest("POST", "/auth/v1/signup", json={"email": email, "password": uuid.uuid4().hex + "Aa1!"})
signup.raise_for_status()
token, owner = signup.json()["access_token"], signup.json()["user"]["id"]
tenant = rest("POST", "/rest/v1/rpc/create_tenant", token, json={"p_name": "Scale scratch", "p_slug": f"scale-{uuid.uuid4().hex[:8]}"})
tenant.raise_for_status()
tid = tenant.json()["id"]

n = UNIT
seed = f"""
set session_replication_role = replica;  -- no audit/guard triggers while seeding (the erasure itself runs with them on)
insert into public.companies (tenant_id, id, name, website, city, tags)
  select '{tid}', gen_random_uuid(), 'Scale Co ' || g, 'https://scale-' || g || '.test', 'City ' || g, array['tag' || g, 'zed' || g || '@scale.test']
  from generate_series(1, {2 * n}) g;
create temp table cs as select id, row_number() over () as rn from public.companies where tenant_id = '{tid}';
insert into public.contacts (tenant_id, id, company_id, full_name, email, phone, job_title)
  select '{tid}', gen_random_uuid(), (select id from cs where rn = 1 + g % {2 * n}), 'Person ' || g, 'p' || g || '@scale.test',
         '+91 9' || lpad(g::text, 9, '0'), 'Buyer ' || g from generate_series(1, {10 * n}) g;
insert into public.leads (tenant_id, id, company_id, source, disqualified_reason)
  select '{tid}', gen_random_uuid(), (select id from cs where rn = 1 + g % {2 * n}), 'Intro by Person ' || g, 'Reason about p' || g || '@scale.test'
  from generate_series(1, {10 * n}) g;
insert into public.opportunities (tenant_id, id, company_id, title)
  select '{tid}', gen_random_uuid(), (select id from cs where rn = 1 + g % {2 * n}), 'Deal with Person ' || g from generate_series(1, {4 * n}) g;
insert into public.products (tenant_id, id, sku, name, description)
  select '{tid}', gen_random_uuid(), 'SKU-' || g, 'Product ' || g, 'Made for Person ' || g from generate_series(1, {5 * n}) g;
insert into public.evidence (tenant_id, id, kind, provider, url, reference, snippet)
  select '{tid}', gen_random_uuid(), 'note', 'manual', 'https://scale.test/p' || g, 'note:s' || g, 'Snippet about Person ' || g || ' 9' || lpad(g::text, 9, '0')
  from generate_series(1, {12 * n}) g;
insert into public.claims (tenant_id, id, company_id, predicate, value, confidence)
  select '{tid}', gen_random_uuid(), (select id from cs where rn = 1 + g % {2 * n}), 'exports_to', 'Claim about Person ' || g, 'low'
  from generate_series(1, {8 * n}) g;
"""
t0 = time.monotonic()
operator_sql.sql(seed)
rows = operator_sql.sql(
    "select (select count(*) from public.companies where tenant_id = '%s') + (select count(*) from public.contacts where tenant_id = '%s')"
    " + (select count(*) from public.leads where tenant_id = '%s') + (select count(*) from public.opportunities where tenant_id = '%s')"
    " + (select count(*) from public.products where tenant_id = '%s') + (select count(*) from public.evidence where tenant_id = '%s')"
    " + (select count(*) from public.claims where tenant_id = '%s')" % ((tid,) * 7)
)
print(f"seeded {rows} rows in {time.monotonic() - t0:.1f}s (workspace {tid})")

rid = str(uuid.uuid4())
r = rest("POST", "/rest/v1/rpc/request_erasure", token, json={"p_request_id": rid, "p_tenant_id": tid, "p_scope": "tenant"})
r.raise_for_status()
operator_sql.sql(f"update public.erasure_requests set execute_after = now() - interval '1 minute' where id = '{rid}'")

for dry in (True, False):
    t0 = time.monotonic()
    r = rest("POST", "/rest/v1/rpc/execute_erasure", token, json={"p_request_id": rid, "p_dry_run": dry})
    took = time.monotonic() - t0
    label = "dry run " if dry else "execute "
    if r.status_code == 200:
        body = r.json()
        changed = sum(body["counts"].values())
        print(f"{label}: HTTP 200 in {took:.1f}s, {changed} column values changed, status {body['status']}")
    else:
        print(f"{label}: HTTP {r.status_code} after {took:.1f}s, sqlstate {r.json().get('code')} ({r.json().get('message')})")
        break
print("authenticated statement_timeout:", operator_sql.sql("select rolconfig from pg_roles where rolname = 'authenticated'"))
print("request status now:", operator_sql.sql(f"select status from public.erasure_requests where id = '{rid}'"))
