"""Mark the demo workspaces of STAGING as exempt from the read-only lapse (job DP part 3, docs/runbooks/billing-exempt.md).

  python3 -I scripts/exempt_demo_workspaces.py            DRY RUN (the default): lists the demo workspaces and their flag
  python3 -I scripts/exempt_demo_workspaces.py --apply    sets billing_exempt on them (app.operator_billing_exempt)

Staging only: it runs through the linked Supabase project and refuses unless that is the stack19-staging project. The demo workspaces are the ones owned by the demo owners made by scripts/seed_staging.py."""

from __future__ import annotations

import json
import subprocess
import sys

STAGING_REF = "uiallwgywitryxatcqxf"
DEMO_OWNERS = ("demo-textiles@demo.example.test", "demo-construction-materials@demo.example.test", "demo-education@demo.example.test", "demo-real-estate@demo.example.test", "demo-coaching@demo.example.test")


def query(sql: str) -> list[dict[str, object]]:
    done = subprocess.run(["supabase", "db", "query", "--linked", sql, "-o", "json"], capture_output=True, text=True, check=False)
    if done.returncode != 0:
        raise SystemExit("exempt-demo-workspaces: the query failed (is `supabase login` done and the project linked?)")
    text = done.stdout
    start = text.index("{")
    data = json.JSONDecoder().raw_decode(text[start:])[0]
    return list(data.get("rows", []))


def main() -> int:
    ref = open("supabase/.temp/project-ref", encoding="utf-8").read().strip() if __import__("os").path.exists("supabase/.temp/project-ref") else ""
    if ref != STAGING_REF:
        print("exempt-demo-workspaces: refusing: the linked project is not stack19-staging", file=sys.stderr)
        return 2
    owners = ", ".join("'" + o + "'" for o in DEMO_OWNERS)
    select = (
        "select t.id, t.slug, t.billing_exempt from public.tenants t join public.memberships m on m.tenant_id = t.id and m.role = 'owner' "
        f"join auth.users u on u.id = m.user_id where u.email in ({owners}) order by t.slug"
    )
    rows = query(select)
    for r in rows:
        print(f"{'exempt' if r['billing_exempt'] else 'NOT exempt'}  {r['slug']}")
    if len(rows) != len(DEMO_OWNERS):
        print(f"exempt-demo-workspaces: found {len(rows)} demo workspaces, expected {len(DEMO_OWNERS)}", file=sys.stderr)
    if "--apply" not in sys.argv[1:]:
        print("dry run: nothing changed (add --apply to write)")
        return 0
    ids = ", ".join("'" + str(r["id"]) + "'" for r in rows)
    if ids:
        query(f"select app.operator_billing_exempt(t.id, true) from public.tenants t where t.id in ({ids})")
        query(f"select app.operator_set_demo(t.id, true) from public.tenants t where t.id in ({ids})")   # job DQ: a demo workspace is never lapse-erased and shows the demo banner
    print(f"applied: {len(rows)} workspaces are exempt and marked demo")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
