"""Clear the synthetic leftovers of test runs on STAGING (job DG), through OUR API as the demo owners, with the same guards as the seed: the flag, the staging project ref and name, the real-data gate closed.

What it does (dry run unless --apply):
  * cancels every campaign whose name starts with "DF " (the click-through's) that is still a draft, approved, running or paused, so nothing stays planned for a future date;
  * erases the school's student record `DF-001` through the school's own erase path (what an owner would do for a leaver);
  * hides the old smoke-test product (the construction demo's one product is `Demo: ...`; a test must not leave a second, visible one).
What it CANNOT remove, by design (the app has no delete for these; the ledger and the audit trail are immutable): quotes, enquiries and their drafts, payments and receipts, customers and leads. They stay, labelled "DF" or "Smoke test", and say so.
Run:  python3 -I scripts/staging_cleanup.py --i-know-this-clears-staging-test-data --project-ref uiallwgywitryxatcqxf --api-url https://<api> [--apply]
"""

from __future__ import annotations

import argparse
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_staging as ss  # noqa: E402

SMOKE_NS = uuid.UUID("7b1d2c3e-5f40-4a6b-9c8d-0e1f2a3b4c5d")  # scripts/staging_smoke_api.py
OLD_SMOKE_ITEM = str(uuid.uuid5(SMOKE_NS, "cm-item"))


def owner(s: ss.Seeder, pack: str) -> tuple[str, str]:
    email = f"demo-{pack.replace('_', '-')}@{ss.DEMO_DOMAIN}"
    password = ss.secret_get(f"sme-demo-{pack}-password")
    if password is None:
        raise ss.SeedError(f"no stored password for {pack}")
    token = s.second_factor(pack, s.sign_in(email, password))
    st, setup = s.call(token, "GET", "/v1/account/setup")
    if st != 200 or setup.get("state") != "done":
        raise ss.SeedError(f"{pack}: no workspace")
    return token, str(setup["tenant_id"])


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--i-know-this-clears-staging-test-data", action="store_true")
    ap.add_argument("--project-ref", required=True)
    ap.add_argument("--api-url", required=True)
    ap.add_argument("--apply", action="store_true")
    args = ap.parse_args()
    try:
        ss.guard(argparse.Namespace(i_know_this_loads_demo_data_into_staging=args.i_know_this_clears_staging_test_data, project_ref=args.project_ref))
        s = ss.Seeder(args.api_url)
        verb = "" if args.apply else "WOULD "
        for pack in ("construction_materials", "education"):
            token, tenant = owner(s, pack)
            base = f"/v1/tenants/{tenant}"
            st, body = s.call(token, "GET", f"{base}/campaigns")
            for c in (body or {}).get("items", []) if st == 200 else []:
                if str(c.get("name", "")).startswith("DF ") and c.get("status") in ("draft", "approved", "running", "paused"):
                    if args.apply:
                        done = s.call(token, "POST", f"{base}/campaigns/{c['id']}/cancel")[0]
                        print(f"{pack}: cancelled campaign {c['name']!r} ({c['status']}) -> HTTP {done}")
                    else:
                        print(f"{pack}: {verb}cancel campaign {c['name']!r} ({c['status']})")
            if pack == "education":
                st, body = s.call(token, "GET", f"{base}/institution/students?limit=100")
                for x in (body or {}).get("items", []) if st == 200 else []:
                    if x.get("admission_no") == "DF-001" and not x.get("erased"):
                        if args.apply:
                            done = s.call(token, "POST", f"{base}/institution/students/{x['id']}/erase")[0]
                            print(f"{pack}: erased the student DF-001 -> HTTP {done}")
                        else:
                            print(f"{pack}: {verb}erase the student DF-001")
            if pack == "construction_materials":
                st, item = s.call(token, "GET", f"{base}/materials/items/{OLD_SMOKE_ITEM}")
                if st == 200 and item.get("active"):
                    if args.apply:
                        body = {"name": item["name"], "sell_unit": item["sell_unit"], "area_unit": item["area_unit"], "stock_status": item["stock_status"], "price_paise": item.get("price_paise"), "active": False}
                        done = s.call(token, "PUT", f"{base}/materials/items/{OLD_SMOKE_ITEM}", body)[0]
                        print(f"{pack}: hid the old smoke-test product -> HTTP {done}")
                    else:
                        print(f"{pack}: {verb}hide the old smoke-test product")
        if not args.apply:
            print("(dry run: nothing was changed. Add --apply.)")
    except ss.SeedError as e:
        print(f"staging-cleanup: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
