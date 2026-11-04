"""Rebuild ONE of the owner's test workspaces on STAGING (owner answer 1 to the Lead Finder report, 4 Nov 2026): NO purge. The old workspace is ARCHIVED (read-only, hidden from the switcher,
kept as it was), and a fresh one is provisioned, seeded and handed over by scripts/seed_owner_test.py's own phases, with the owner as Owner again. docs/runbooks/rebuild-test-workspace.md.

Why a new helper account each time: a helper's first-login setup makes ONE workspace (and answers that one again), so a fresh workspace needs a fresh helper. Generation 1 is
`owner-test-<pack>@demo.example.test` (seed_owner_test.py); generation g >= 2 is `owner-test-<pack>-g<g>@demo.example.test`, with its own secrets `sme-owner-test-<pack>-g<g>-password` / `-totp`
in Secret Manager (made on first use, never printed). The generation is 1 + how many workspaces of that name are archived, so a run that stopped half way picks up the same generation again.

Guards: staging only (scripts/seed_staging.py's guard: the flag, the project ref); the database refuses to archive a workspace whose real-data gate is open, a demo workspace, or one without a reason of
20+ characters (app.operator_archive_workspace); every row of the fresh workspace goes in through OUR API as the helper. Nothing is deleted.

Run:  python3 -I scripts/rebuild_owner_test.py --i-know-this-loads-demo-data-into-staging --project-ref uiallwgywitryxatcqxf --api-url https://<api> --pack textiles \
          --reason "the owner asked for a fresh test week (4 Nov 2026)" [--dry-run]"""

# ruff: noqa: E501, S608 - long lines like the other seed scripts; the SQL is the operator's, built only from constants and q()-quoted values

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_staging as ss  # noqa: E402
from seed_staging import SeedError  # noqa: E402

PACKS = ("textiles", "construction_materials", "education")


def q(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def generation_email(pack: str, generation: int, domain: str = ss.DEMO_DOMAIN) -> str:
    base = f"owner-test-{pack.replace('_', '-')}"
    return f"{base}@{domain}" if generation <= 1 else f"{base}-g{generation}@{domain}"


def generation_key(pack: str, generation: int) -> str:
    """The key of the generation's secrets: sme-owner-test-<key>-password / -totp."""
    return pack if generation <= 1 else f"{pack}-g{generation}"


def next_generation(archived: int) -> int:
    return archived + 1


def plan(sql: Any, name: str) -> dict[str, Any]:
    """What a run would do, read-only: the workspace in use (if any) and the generation the fresh one gets."""
    current = sql(f"select t.id, t.slug, coalesce(p.real_data_allowed, false) as gate_open, t.demo from public.tenants t left join public.tenant_data_policy p on p.tenant_id = t.id "
                  f"where t.name = {q(name)} and t.archived_at is null")
    if len(current) > 1:
        raise SeedError(f"{len(current)} workspaces in use are named {name!r}: refusing (rename one first)")
    archived = sql(f"select count(*)::int as n from public.tenants t where t.archived_at is not null and starts_with(t.name, {q(name + ' (archived ')})")[0]["n"]
    in_use = current[0] if current else None
    if in_use and (in_use["gate_open"] or in_use["demo"]):
        raise SeedError(f"{name!r} has an open real-data gate or is a demo: it is not archived this way")
    return {"in_use": in_use, "archived_before": archived, "generation": next_generation(archived + (1 if in_use else 0))}


def rebuild(pack: str, reason: str, api_url: str, *, dry_run: bool = False) -> dict[str, Any]:
    try:
        import seed_owner_test as sot  # type: ignore[import-not-found,unused-ignore]  # noqa: PLC0415 - C2's script (PR #293); needed only here
    except ImportError:
        raise SeedError("scripts/seed_owner_test.py is not here yet (it comes with the test-workspaces PR)") from None
    name = dict(sot.WORKSPACES)[pack]
    p = plan(sot.sql, name)
    out: dict[str, Any] = {"pack": pack, "workspace": name, "archive": p["in_use"]["slug"] if p["in_use"] else None, "generation": p["generation"],
                           "helper": generation_email(pack, p["generation"]), "dry_run": dry_run}
    if dry_run:
        return out
    if len(reason.strip()) < 20:
        raise SeedError("the reason must be 20 characters or more (it goes in the audit log)")
    if p["in_use"]:
        done = sot.sql(f"select app.operator_archive_workspace({q(str(p['in_use']['id']))}::uuid, {q(reason)}) as r")[0]["r"]
        out["archived_as"] = (json.loads(done) if isinstance(done, str) else done).get("name")
    g = p["generation"]
    key = generation_key(pack, g)

    class Generation(sot.OwnerTest):  # type: ignore[misc,unused-ignore]  # the fresh helper account: its own address and its own secrets
        def helper_token(self, pack_: str, name_: str, terms: dict[str, str]) -> str:
            pw_name = f"sme-owner-test-{key}-password"
            password = ss.secret_get(pw_name)
            if password is None:
                password = ss.new_password()
                ss.secret_put(pw_name, password)
            email = generation_email(pack_, g)
            self.create_user(email, password, {"terms_version": terms["terms"], "business_name": name_})
            return str(self.second_factor_for(key, self.sign_in(email, password)))

    sot.helper_email = lambda pack_: generation_email(pack_, g)   # the phases below look the helper up by its address
    s = Generation(api_url)
    terms = s.terms()
    out["provisioned"] = s.provision(pack, name, terms)
    tenant = str(out["provisioned"]["tenant_id"])
    import owner_test_data  # type: ignore[import-not-found,unused-ignore]  # noqa: PLC0415 - C2's week of data

    token = s.helper_token(pack, name, terms)
    out["seeded"] = owner_test_data.seed(pack, lambda m, path, b=None, raw=None: s.call(token, m, f"/v1/tenants/{tenant}{path}", b, raw))
    helper_id = sot.sql(f"select id from auth.users where email = {q(generation_email(pack, g))}")[0]["id"]
    st, _ = s.call(token, "POST", f"/v1/tenants/{tenant}/members/{helper_id}/remove", {"reason": "left"})
    out["helper_removed"] = st in (200, 204)
    gate = sot.sql(f"select coalesce(bool_or(real_data_allowed), false) as open from public.tenant_data_policy where tenant_id = {q(tenant)}::uuid")
    if gate and gate[0]["open"]:
        raise SeedError("the fresh workspace's real-data gate is OPEN: stop and look (it must stay closed)")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--i-know-this-loads-demo-data-into-staging", action="store_true")
    ap.add_argument("--project-ref", required=True)
    ap.add_argument("--api-url", required=True)
    ap.add_argument("--pack", required=True, choices=PACKS)
    ap.add_argument("--reason", default="")
    ap.add_argument("--dry-run", action="store_true", help="say what would be archived and which helper makes the fresh one; change nothing")
    args = ap.parse_args()
    try:
        ss.guard(args)
        print(json.dumps(rebuild(args.pack, args.reason, args.api_url, dry_run=args.dry_run), default=str))
    except SeedError as e:
        print(f"rebuild-owner-test: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
