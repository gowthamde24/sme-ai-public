"""Add the day's fresh leads to the two Lead Desk demo workspaces of STAGING (job DR part B2): three new website-form leads dated today in each. Run it once a day (any scheduler the owner likes, or by hand).

  python3 -I scripts/refresh_demo_leads.py --i-know-this-loads-demo-data-into-staging --project-ref uiallwgywitryxatcqxf --api-url https://<api>

It signs the demo owners in with the passwords and authenticator secrets that scripts/seed_staging.py keeps in Secret Manager (sme-demo-<pack>-password and -totp); it never creates an account and never needs the admin key. Same safety checks as the seed. Idempotent for one day."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import demo_data  # noqa: E402
import seed_staging as ss  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--i-know-this-loads-demo-data-into-staging", action="store_true")
    ap.add_argument("--project-ref", required=True)
    ap.add_argument("--api-url", required=True)
    args = ap.parse_args()
    try:
        ss.guard(args)
        seeder = ss.Seeder(args.api_url)
        today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()
        for pack, spec in (("real_estate", demo_data.REAL_ESTATE), ("coaching", demo_data.COACHING)):
            email = f"demo-{pack.replace('_', '-')}@{ss.DEMO_DOMAIN}"
            password = ss.secret_get(f"sme-demo-{pack}-password")
            if password is None:
                raise ss.SeedError(f"No password for {pack} in Secret Manager: run the seed first.")
            token = seeder.second_factor(pack, seeder.sign_in(email, password))
            st, setup = seeder.call(token, "POST", "/v1/account/setup", {"business_type": pack, "language": "en", "accepted_terms_version": seeder.terms()["terms"], "accepted_privacy_version": seeder.terms()["privacy"]})
            if st != 200 or not isinstance(setup, dict):
                raise ss.SeedError(f"Could not find the workspace of {pack} (HTTP {st}).")
            tenant = str(setup["tenant_id"])

            def call(method: str, path: str, body: object = None, raw: object = None, _t: str = token, _id: str = tenant) -> tuple[int, object]:
                return seeder.call(_t, method, f"/v1/tenants/{_id}{path}", body)

            print(json.dumps({"pack": pack, **demo_data.fresh_leads(call, spec, today)}))
    except (ss.SeedError, demo_data.DemoError) as e:
        print(f"refresh-demo-leads: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
