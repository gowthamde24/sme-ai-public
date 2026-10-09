"""make seed-demo-manual: the manual-price quote and a Today that is not empty, in the ONE demo workspace, on a LOCAL stack.

What it adds to the demo workspace of `make seed-demo` (the demo owner has exactly ONE workspace; this creates it if `seed-demo` has not run). All invented, every name
starts with "DEMO":
  * twelve item types, most with an invented lowest and highest price (the range only warns, it never stops a quote);
  * a published quote policy with the GST rate typed out (see GST_RATE_BPS below);
  * one company, one lead and one pasted enquiry with no contact details in it (the enquiry to make a quote from by hand);
  * so that Today has something in each list: one QUOTE waiting for approval (a typed-price draft), one FOLLOW-UP draft waiting for approval, and one order that
    took an advance, was cancelled, and still HOLDS the money (a recorded order step).

HOW IT TALKS TO THE SYSTEM
  * Only through OUR API, as the demo user, with the user's own access token and the public (publishable) key: the same functions `make seed-demo` uses (it reuses that
    script's sign-in with a second factor, which publishing a policy, approving a quote and cancelling an order with money need). There is NO service-role key and no
    new secret here. On later runs the demo user's authenticator secret is read from the LOCAL database container, exactly as `make seed-demo` does.
  * Refuses to run unless the Supabase URL AND the API URL are this machine (127.0.0.1 / localhost / ::1). The check runs before any network call.
  * Idempotent: every row has a fixed id, and item types are saved by code, so a second run changes nothing.
  * The follow-up draft needs the API to hold the suppression-key secret (`make dev-api-local` sets a synthetic one for local use). Without it that one step is skipped
    with a plain line, and everything else is still made.
  * Never a migration, never imported by the application. Not part of `make check`.

Run: `make db-start`, `make dev-api-local` in one terminal, then `make seed-demo-manual`. Wipe: `make db-reset` (it empties the whole local database; there is no
narrower wipe, because workspaces and their audit records are never deleted).
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx  # noqa: E402
from seed_demo import (  # noqa: E402
    DEMO_EMAIL,
    DEMO_WORKSPACE_NAME,
    DEMO_WORKSPACE_SLUG,
    Config,
    Seeder,
    SeedError,
    demo_id,
    load_config,
    require_local,
)

# the ONE demo workspace (the demo owner has exactly one): the same name and address as `make seed-demo`, so a creation here is a replay of that one
WORKSPACE_NAME = DEMO_WORKSPACE_NAME
WORKSPACE_SLUG = DEMO_WORKSPACE_SLUG

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
    followup_made = False
    followup_note = ""

    def workspace(self) -> None:
        super().workspace()  # the one demo workspace: created now, or found (a replay)
        self.tenant_id = self.summary.tenant_id

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

    # ---- Today is not empty: a quote waiting, a follow-up draft waiting, an order that holds money
    def _post(self, path: str, body: dict[str, Any], what: str, ok: tuple[int, ...] = (200, 201)) -> httpx.Response:
        r = self._api("POST", path, body)
        if r.status_code not in ok:
            raise SeedError(f"Could not make the demo {what} (HTTP {r.status_code}).")
        return r

    def _manual_quote(self, quote: str, enquiry: str, qty: int, price: int) -> None:
        self._post(
            f"/v1/tenants/{self.tenant_id}/enquiries/{enquiry}/manual-quotes",
            {"id": quote, "customer_kind": "new", "lines": [{"item_type_code": "DEMO-01", "qty": qty, "unit_price_paise": price}]},
            "quote",
        )

    def _enquiry_on_new_lead(self, key: str, text: str) -> str:
        t = f"/v1/tenants/{self.tenant_id}"
        lead, enquiry = demo_id(f"{key}-lead"), demo_id(f"{key}-enquiry")
        self._create(f"{t}/leads", {"id": lead, "company_id": demo_id("manual-company"), "source": "DEMO trade fair (synthetic)"}, "lead")
        self._create(
            f"{t}/leads/{lead}/enquiries",
            {"id": enquiry, "channel": "other", "received_at": "2026-10-01T09:00:00Z", "subject": "DEMO enquiry (synthetic)", "text": text},
            "enquiry",
        )
        return enquiry

    def waiting_quote(self, enquiry: str) -> None:
        """One quote waiting for approval: a typed-price draft (typed here by the demo owner, as a person would; the price is inside the item type's range)."""
        self._manual_quote(demo_id("waiting-quote"), enquiry, 40, 100_000)

    def held_money_order(self) -> None:
        """One order that took an advance, was cancelled by the Owner, and still holds the money (a recorded order step: Today shows it in amber)."""
        t = f"/v1/tenants/{self.tenant_id}"
        enquiry = self._enquiry_on_new_lead("order", "DEMO: this is an invented enquiry. We want about twenty plain weave pieces for a wedding, delivered in Demoville.")
        quote = demo_id("order-quote")
        self._manual_quote(quote, enquiry, 20, 100_000)
        self._post(f"{t}/quotes/{quote}/approve", {}, "approved quote")
        # an order policy may already exist from an earlier run (a new version cannot start in the past): a refusal here is not fatal, the order below says if it was
        self._api(
            "POST",
            f"{t}/order-policy-versions",
            {
                "id": demo_id("order-policy"),
                "effective_from": datetime.now(IST).date().isoformat(),
                "advance_required": True,
                "dispatch_requires_advance": True,
                "cancel_allowed_until_state": "in_preparation",
                "allow_zero_value_orders": False,
            },
        )
        order = demo_id("order")
        made = self._post(f"{t}/orders", {"id": order, "quote_id": quote}, "order")
        advance = int(made.json()["advance_paise"])
        detail = self._api("GET", f"{t}/orders/{order}")
        done = {e["type"] for e in detail.json().get("events", [])} if detail.status_code == 200 else set()
        for key, kind, amount in (
            ("send", "send_quote", None),
            ("accept", "customer_accept", None),
            ("ask", "request_advance", None),
            ("pay", "record_payment", advance),
            ("cancel", "cancel", None),
        ):
            if kind in done:  # a later run: the step is already recorded (the same step again would be refused as a conflict)
                continue
            body: dict[str, Any] = {"id": demo_id(f"order-event-{key}"), "type": kind}
            if amount is not None:
                body["amount_paise"], body["ledger_id"] = amount, demo_id(f"order-ledger-{key}")
            r = self._api("POST", f"{t}/orders/{order}/events", body)
            if r.status_code not in (200, 201):
                raise SeedError(f"Could not record the demo order step {kind} (HTTP {r.status_code}).")

    def follow_up_draft(self) -> bool:
        """One follow-up draft waiting for approval. Needs the API to hold the suppression-key secret; returns False (a plain note is printed) when it does not."""
        t = f"/v1/tenants/{self.tenant_id}"
        company, contact, lead = demo_id("manual-company"), demo_id("followup-contact"), demo_id("followup-lead")
        self._create(
            f"{t}/contacts",
            {"id": contact, "company_id": company, "full_name": "DEMO Buyer (fictional)", "email": "demo.buyer@demo.example.test", "phone": "+00 000 000 0701", "job_title": "Buyer"},
            "contact",
        )
        self._create(f"{t}/leads", {"id": lead, "company_id": company, "contact_id": contact, "source": "DEMO trade fair (synthetic)"}, "lead")
        self._post(
            f"{t}/contacts/{contact}/record-consent",
            {"channel": "email", "status": "granted", "basis": "explicit_consent", "evidence_type": "web_form", "evidence_ref": "ref:demo-followup"},
            "consent",
        )
        policies = self._api("GET", f"{t}/followup-policy-versions")
        if policies.status_code == 200 and not any(v["id"] == demo_id("followup-policy") for v in policies.json()):
            minute = datetime.now(UTC).hour * 60 + datetime.now(UTC).minute
            offset = (720 - minute + 1440) % 1440  # the recipient's clock reads about noon now: never in the quiet hours
            offset = offset - 1440 if offset > 840 else offset
            self._post(
                f"{t}/followup-policy-versions",
                {
                    "id": demo_id("followup-policy"),
                    "effective_from": datetime.now(IST).date().isoformat(),
                    "gap_days": [0, 0],  # the next message is due at once (a demo: the lead is brand new, so no first message can be dated in the past)
                    "max_touches": 3,
                    "quiet_start": "03:00",
                    "quiet_end": "04:00",
                    "allowed_weekdays": [0, 1, 2, 3, 4, 5, 6],
                    "holidays": [],
                    "min_gap_hours": 0,
                    "recipient_utc_offset_minutes": offset,
                },
                "follow-up policy",
            )
        touch = self._api(
            "POST",
            f"{t}/leads/{lead}/touches",
            {"id": demo_id("followup-touch"), "direction": "out", "channel": "email"},
        )
        if touch.status_code not in (200, 201, 409, 422):
            raise SeedError(f"Could not record the demo first message (HTTP {touch.status_code}).")
        draft = self._api("POST", f"{t}/leads/{lead}/followup-drafts", {"id": demo_id("followup-draft"), "channel": "email"})
        if draft.status_code in (200, 201):
            return True
        err = draft.json().get("error", {}) if draft.headers.get("content-type", "").startswith("application/json") else {}
        self.followup_note = f"{err.get('code', draft.status_code)}" + (f"/{err['reason']}" if err.get("reason") else "")
        return False


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
        seeder.waiting_quote(enquiry)
        seeder.held_money_order()
        seeder.followup_made = seeder.follow_up_draft()
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
    print("  on Today: 1 quote waiting for approval, 1 order step with money held" + (", 1 follow-up draft" if s.followup_made else ""))
    if not s.followup_made:
        print(f"  (no follow-up draft this time [{s.followup_note}]: it needs the API to hold the suppression-key secret; start it with `make dev-api-local` and run this again)")
    print(f"  item types: {base}/item-types")
    print(f"  enquiry:    {base}/enquiries/{enquiry}")
    print(f"  sign in as {DEMO_EMAIL} (the fixed demo password is a constant in scripts/seed_demo.py)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
