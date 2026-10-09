"""make seed-demo-manual: a clearly FAKE workspace for trying the manual-price quote by hand on a LOCAL stack.

What it makes (all invented, every name starts with "DEMO"):
  * a workspace named "DEMO Manual-Price Quotes (fictional)" with the demo owner of `make seed-demo`;
  * twelve item types, most with an invented lowest and highest price (the range only warns, it never stops a quote);
  * a published quote policy with the GST rate typed out (see GST_RATE_BPS below);
  * one company, one lead and one pasted enquiry with no contact details in it.

HOW IT TALKS TO THE SYSTEM
  * Only through OUR API, as the demo user, with the user's own access token and the public (publishable) key: the same
    functions `make seed-demo` uses (it reuses that script's sign-in with a second factor, which publishing a policy and
    saving item types need). There is NO service-role key and no new secret here. On later runs the demo user's
    authenticator secret is read from the LOCAL database container, exactly as `make seed-demo` does.
  * Refuses to run unless the Supabase URL AND the API URL are this machine (127.0.0.1 / localhost / ::1). The check runs
    before any network call.
  * Idempotent: every row has a fixed id, and item types are saved by code, so a second run changes nothing.
  * Never a migration, never imported by the application. Not part of `make check`.

Run: `make db-start`, `make dev-api` in one terminal, then `make seed-demo-manual`. Wipe: `make db-reset` (it empties the
whole local database; there is no narrower wipe, because workspaces and their audit records are never deleted).
"""

from __future__ import annotations

import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx  # noqa: E402
from seed_demo import (  # noqa: E402
    DEMO_EMAIL,
    Config,
    Seeder,
    SeedError,
    demo_id,
    load_config,
    local_allow_demo_workspaces,
    require_local,
)

WORKSPACE_NAME = "DEMO Manual-Price Quotes (fictional)"
WORKSPACE_SLUG = "demo-manual-price"

# DEMO VALUE ONLY: 5% is typed here so the demo policy has a rate to publish. It is NOT a default anywhere: the product has no
# default GST rate, and a real business types its own rate with its accountant. Nothing may copy this number into the product.
GST_RATE_BPS = 500
IST = timezone(timedelta(hours=5, minutes=30))  # the database's "today" for a policy's start date; a new version may not start in the past

# (code, name, position, lowest price in paise or None, highest price in paise or None). Every value is invented.
ITEM_TYPES: list[tuple[str, str, int, int | None, int | None]] = [
    ("DEMO-01", "DEMO Plain weave piece", 1, 80_000, 250_000),
    ("DEMO-02", "DEMO Border weave piece", 2, 150_000, 450_000),
    ("DEMO-03", "DEMO Woven stripe piece", 3, 100_000, 300_000),
    ("DEMO-04", "DEMO Printed piece", 4, 50_000, 180_000),
    ("DEMO-05", "DEMO Embroidered piece", 5, 250_000, 900_000),
    ("DEMO-06", "DEMO Festival set", 6, 400_000, 1_200_000),
    ("DEMO-07", "DEMO Plain dupatta", 7, 30_000, 120_000),
    ("DEMO-08", "DEMO Woven fabric by the metre", 8, 20_000, 90_000),
    ("DEMO-09", "DEMO Remnant lot", 9, None, None),
    ("DEMO-10", "DEMO Sample piece", 10, None, 60_000),
    ("DEMO-11", "DEMO Custom order piece", 11, 200_000, None),
    ("DEMO-12", "DEMO Gift wrapped piece", 12, 120_000, 350_000),
]

COMPANY_NAME = "DEMO Harbour Retail Pvt Ltd (fictional)"
ENQUIRY_SUBJECT = "DEMO enquiry for festival stock (synthetic)"
ENQUIRY_TEXT = (
    "DEMO: this is an invented enquiry. We would like prices for about forty plain weave pieces and twenty printed pieces "
    "for the festival season, delivered to Demoville in four weeks. Please quote each type separately."
)


class ManualDemoSeeder(Seeder):
    """The sign-in (with a second factor) and the API plumbing come from `make seed-demo`'s seeder."""

    tenant_id = ""

    def workspace(self) -> None:
        r = self._api("POST", "/v1/tenants", {"name": WORKSPACE_NAME, "slug": WORKSPACE_SLUG})
        if r.status_code != 200:
            raise SeedError(f"Could not create the demo workspace (HTTP {r.status_code}).")
        self.tenant_id = str(r.json()["id"])
        self.summary.tenant_id = self.tenant_id
        local_allow_demo_workspaces(self.user_id)  # the free trial allows one workspace per owner; the demo user has two

    def _put(self, path: str, body: dict[str, Any], what: str) -> None:
        r = self._api("PUT", path, body)
        if r.status_code != 200:
            raise SeedError(f"Could not save the demo {what} (HTTP {r.status_code}).")
        self.summary.created += 1

    def item_types(self) -> None:
        for code, name, position, low, high in ITEM_TYPES:
            self._put(
                f"/v1/tenants/{self.tenant_id}/item-types/{code}",
                {
                    "name": name,
                    "position": position,
                    "active": True,
                    "min_price_paise": low,
                    "max_price_paise": high,
                },
                "item type",
            )

    def policy(self) -> None:
        """Publish the demo policy once. A later run finds it by its fixed id and changes nothing (a new version cannot start in the past, so a replay on another day must not post again)."""
        version = demo_id("manual-quote-policy")
        listed = self._api("GET", f"/v1/tenants/{self.tenant_id}/quote-policy-versions")
        if listed.status_code != 200:
            raise SeedError(f"Could not read the quote policies (HTTP {listed.status_code}).")
        if any(v["id"] == version for v in listed.json()):
            self.summary.reused += 1
            return
        r = self._api(
            "POST",
            f"/v1/tenants/{self.tenant_id}/quote-policy-versions",
            {
                "id": version,
                "effective_from": datetime.now(IST).date().isoformat(),
                "discount_ceiling_bps": 500,
                "shipping_flat_fee_paise": 0,
                "validity_days": 15,
                "new_advance_bps": 5000,
                "repeat_advance_bps": 2500,
                "new_net_days": 0,
                "repeat_net_days": 30,
                "gst_rate_bps": GST_RATE_BPS,
                "seller_state": "TG",
            },
        )
        if r.status_code != 201:
            raise SeedError(f"Could not publish the demo quote policy (HTTP {r.status_code}).")
        self.summary.created += 1

    def enquiry(self) -> str:
        t = f"/v1/tenants/{self.tenant_id}"
        company, lead = demo_id("manual-company"), demo_id("manual-lead")
        self._create(
            f"{t}/companies",
            {
                "id": company,
                "name": COMPANY_NAME,
                "type": "prospect",
                "website": "https://demo.example.test/harbour",
                "country": "IN",
                "city": "Demoville",
                "tags": ["demo", "synthetic"],
            },
            "company",
        )
        self._create(
            f"{t}/leads",
            {"id": lead, "company_id": company, "source": "DEMO trade fair (synthetic)"},
            "lead",
        )
        enquiry = demo_id("manual-enquiry")
        self._create(
            f"{t}/leads/{lead}/enquiries",
            {
                "id": enquiry,
                "channel": "other",
                "received_at": "2026-10-01T09:00:00Z",
                "subject": ENQUIRY_SUBJECT,
                "text": ENQUIRY_TEXT,
            },
            "enquiry",
        )
        return enquiry


def run(config: Config, *, api: httpx.Client | None = None, http: httpx.Client | None = None) -> tuple[ManualDemoSeeder, str]:
    """Seed the manual-price demo. `api` / `http` can be injected (a test passes the in-process application as `api`)."""
    require_local(config.supabase_url, "Supabase URL")
    require_local(config.api_url, "API URL")
    api_client = httpx.Client() if api is None else api
    http_client = httpx.Client() if http is None else http
    try:
        seeder = ManualDemoSeeder(config, api_client, http_client)
        seeder.sign_in()
        seeder.workspace()
        seeder.item_types()
        seeder.policy()
        enquiry = seeder.enquiry()
        return seeder, enquiry
    finally:
        if api is None:
            api_client.close()
        if http is None:
            http_client.close()


def main() -> int:
    try:
        s, enquiry = run(load_config())
    except SeedError as exc:
        print(f"seed-demo-manual: {exc}", file=sys.stderr)
        return 1
    base = f"http://localhost:3000/app/tenants/{s.tenant_id}"
    print("seed-demo-manual: done (a clearly fictional workspace; nothing here is real).")
    print(f"  {len(ITEM_TYPES)} item types, 1 quote policy (GST {GST_RATE_BPS / 100:g}%, a demo value), 1 enquiry")
    print(f"  item types: {base}/item-types")
    print(f"  enquiry:    {base}/enquiries/{enquiry}")
    print(f"  sign in as {DEMO_EMAIL} (the fixed demo password is a constant in scripts/seed_demo.py)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
