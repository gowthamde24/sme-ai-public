"""Make ONE fresh synthetic business on STAGING through the normal first-login code (a walk-through of the sign-up for C2 / the owner; 18 Nov 2026).

RUN IT YOURSELF (it makes a sign-in account on the staging project and two secrets): in Claude Code `! python3 scripts/staging_new_business.py --i-know-this-is-staging --key walk-c2 --name "Walk Silks (synthetic)"`.

Same method as scripts/seed_staging.py (the demo businesses): the sign-in account is made with the project's admin API (confirmed e-mail, a generated password), then the account is signed in, enrols its
authenticator and calls `POST /v1/account/setup` exactly like the first-login screen. NO flag is changed and NO table is written directly.
The password and the authenticator secret go ONLY to Secret Manager (`sme-demo-<key>-password`, `sme-demo-<key>-totp`), never to the screen or a file; whoever may read them signs in with the helpers of
`scripts/seed_staging.py` (`secret_get`). The e-mail is `demo-<key>@<the demo domain>`; the workspace starts empty (the walk adds its own synthetic rows).
Run it again with the same key: nothing is made twice.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_staging as ss


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--i-know-this-is-staging", action="store_true", required=True)
    ap.add_argument("--key", required=True, help="short id for the secrets and the e-mail (lowercase letters, digits, dashes)")
    ap.add_argument("--name", required=True)
    ap.add_argument("--pack", default="textiles")
    ap.add_argument("--language", default="en")
    args = ap.parse_args()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{1,30}", args.key):
        print("refused: --key must be lowercase letters, digits and dashes")
        return 2
    ss.guard(argparse.Namespace(i_know_this_loads_demo_data_into_staging=True, project_ref="uiallwgywitryxatcqxf"))
    s = ss.Seeder("https://sme-api-620338396268.asia-south1.run.app")
    terms = s.terms()
    email = f"demo-{args.key}@{ss.DEMO_DOMAIN}"
    password = ss.secret_get(f"sme-demo-{args.key}-password")
    if password is None:
        password = ss.new_password()
        ss.secret_put(f"sme-demo-{args.key}-password", password)
    created = s.create_user(email, password, {"terms_version": terms["terms"], "business_name": args.name})
    token = s.second_factor(args.key, s.sign_in(email, password))
    st, setup = s.call(token, "POST", "/v1/account/setup", {"business_type": args.pack, "language": args.language, "accepted_terms_version": terms["terms"], "accepted_privacy_version": terms["privacy"]})
    if st != 200 or not isinstance(setup, dict):
        print(f"the first-login setup failed (HTTP {st})")
        return 1
    print(f"account {'created' if created else 'already there'}: {email}")
    print(f"workspace {'created' if setup.get('created') else 'already there'}: tenant {setup.get('tenant_id')}")
    print(f"secrets in Secret Manager: sme-demo-{args.key}-password, sme-demo-{args.key}-totp (read them with seed_staging.secret_get; never print them)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
