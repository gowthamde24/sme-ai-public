"""make seed-demo-school: the construction and school demo workspaces on the LOCAL stack (job DG), the local twin of what scripts/seed_staging.py does on staging, from the same module (scripts/demo_data.py).

Two fictional owners (demo-construction@ and demo-school@demo.example.test), each with one workspace made through the first-login setup like a real sign-up, the pack's example data loaded, and then: a visible
construction product with a placeholder picture; a school with a class, three students with fake +00 guardian phones and a fee plan with dues. Idempotent. Everything is invented; the only provider is this machine.

Refuses any Supabase or API address that is not this machine (the same rule as seed_demo.py). Needs `make agent-db-up` (or `make db-start`) and the API: `make dev-api-local` (agent stack: API_PORT=8001).
Run: make seed-demo-school"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import demo_data  # noqa: E402
import httpx  # noqa: E402
import seed_demo  # noqa: E402
from local_confirm import confirm_email  # noqa: E402

IST = timezone(timedelta(hours=5, minutes=30))
OWNERS = [
    ("construction_materials", "demo-construction@demo.example.test", "DEMO Construction Materials (fictional)"),
    ("education", "demo-school@demo.example.test", "DEMO School (fictional)"),
]


def session(config: seed_demo.Config, http: httpx.Client, email: str, name: str) -> seed_demo.Seeder:
    """Sign up (the terms accepted in the account's data, as the sign-up form does), confirm the address (local stack only), sign in, and get a second-factor session."""
    seed_demo.DEMO_EMAIL, seed_demo.DEMO_PASSWORD = email, seed_demo.DEMO_PASSWORD  # the module's own sign-in helper reads these
    auth = f"{config.supabase_url}/auth/v1"
    headers = {"apikey": config.anon_key}
    creds = {"email": email, "password": seed_demo.DEMO_PASSWORD}

    def token() -> httpx.Response:
        return http.post(f"{auth}/token?grant_type=password", json=creds, headers=headers, timeout=30)

    r = token()
    if r.status_code != 200:
        http.post(f"{auth}/signup", json={**creds, "data": {"terms_version": "draft-1", "business_name": name}}, headers=headers, timeout=30)
        confirm_email(email)
        r = token()
    if r.status_code != 200:
        raise seed_demo.SeedError(f"Could not sign {email} in on the local stack.")
    seeder = seed_demo.Seeder(config, httpx.Client(), http)
    seeder.token, seeder.user_id = str(r.json()["access_token"]), str(r.json()["user"]["id"])
    seeder.token = seeder._second_factor(auth, headers)
    return seeder


class Tenant:
    """`call(method, path_after_the_tenant, body=None, raw=(bytes, content_type))` for one workspace: what scripts/demo_data.py expects."""

    def __init__(self, config: seed_demo.Config, seeder: seed_demo.Seeder) -> None:
        self.config, self.seeder, self.id = config, seeder, ""

    def __call__(self, method: str, path: str, body: Any = None, raw: tuple[bytes, str] | None = None) -> tuple[int, Any]:
        headers = {"Authorization": f"Bearer {self.seeder.token}"}
        url = f"{self.config.api_url}/v1/tenants/{self.id}{path}"
        if raw is not None:
            r = self.seeder.api.request(method, url, content=raw[0], headers={**headers, "Content-Type": raw[1]}, timeout=60)
        else:
            r = self.seeder.api.request(method, url, json=body, headers=headers, timeout=60)
        return r.status_code, (r.json() if r.content else None)


def main() -> int:
    try:
        config = seed_demo.load_config()
        seed_demo.require_local(config.supabase_url, "Supabase URL")
        seed_demo.require_local(config.api_url, "API URL")
        with httpx.Client() as http:
            for pack, email, name in OWNERS:
                seeder = session(config, http, email, name)
                setup = seeder.api.post(f"{config.api_url}/v1/account/setup", json={"business_type": pack, "language": "en"}, headers={"Authorization": f"Bearer {seeder.token}"}, timeout=30)
                if setup.status_code != 200:
                    raise seed_demo.SeedError(f"{pack}: the first-login setup failed (HTTP {setup.status_code}).")
                call = Tenant(config, seeder)
                call.id = str(setup.json()["tenant_id"])
                call("POST", "/example-data")  # the pack's labelled sample; 409 when it is already there
                made = demo_data.construction_materials(call) if pack == "construction_materials" else demo_data.education(call, datetime.now(IST).date())
                print(f"seed-demo-school: {pack}: {email} -> workspace {call.id}")
                for k, v in made.items():
                    print(f"  {k}: {v}")
    except (seed_demo.SeedError, demo_data.DemoError) as exc:
        print(f"seed-demo-school: {exc}", file=sys.stderr)
        return 1
    print("seed-demo-school: done (fictional; the guardians' numbers are +00, which no phone can dial).")
    print("  sign in as demo-school@demo.example.test or demo-construction@demo.example.test (the demo password of seed_demo.py); `make demo-code` gives the second-step code.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
