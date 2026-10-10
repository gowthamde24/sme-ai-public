"""make seed-demo-outbox: a few OUTBOX rows and one call request in the ONE demo workspace, on a LOCAL stack (job AT, ADR 0066). Everything is invented; every name starts with "DEMO".

What it makes (through OUR API, as the demo owner, exactly as the web will):
  * automatic sending switched ON for the demo business (the global kill switch is the operator's: `make seed-demo-outbox` turns it on first, in the LOCAL database);
  * three customers with a phone number (clearly fake: +00 ...): two that agreed to WhatsApp and wrote to us first, one that did neither;
  * message 1, an ordinary reply within 24 hours  -> goes by itself (queued; sent by the LOCAL FAKE channel unless it is quiet hours, 21:00 to 09:00 India time);
  * message 2, a price in Telugu                  -> needs approval (money)                 [shows on Today and in the approval queue]
  * message 3, a reply to a customer who complained -> needs approval (complaint)           [shows on Today and in the approval queue]
  * message 4, a follow-up to a customer who never agreed -> blocked (no opt-in)
  * one call request                              -> waits for the Owner                    [shows on Today]
NOTHING IS SENT TO ANYONE: the only channel adapter is a stand-in inside the API process. Idempotent (fixed ids). Refuses a URL that is not this machine. Not part of `make check`.

The web's Today page must know the two new kinds of waiting item (outbox_approval, call_approval) before you run this against a web build that does not: an older web shows an error for Today
instead of the list while one of them waits. `make db-reset` wipes the demo.

Run: `make db-start`, `make dev-api-local` in one terminal, `make seed-demo-manual` once, then `make seed-demo-outbox`."""

from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import httpx  # noqa: E402
from seed_demo import DEMO_EMAIL, SeedError, demo_id, load_config, require_local  # noqa: E402
from seed_demo_manual import ManualDemoSeeder  # noqa: E402

CUSTOMERS: list[tuple[str, str, str, bool, str | None, int]] = [
    # (key, company, phone, agreed to WhatsApp, what they wrote to us (None = never wrote), hours ago)
    (
        "lakshmi",
        "DEMO Lakshmi Textiles",
        "+00 90001 00001",
        True,
        "Hello, do you have silk sarees for a wedding?",
        1,
    ),
    (
        "kavitha",
        "DEMO Kavitha Silks",
        "+00 90001 00002",
        True,
        "I want to complain: the saree I received is damaged.",
        2,
    ),
    ("ravi", "DEMO Ravi Stores", "+00 90001 00003", False, None, 0),
]
MESSAGES: list[tuple[str, str, str, str, str]] = [
    # (key, customer, text, category, language)
    (
        "m1",
        "lakshmi",
        "Yes, we have silk sarees in stock. You are welcome to visit our shop this Saturday, we are open from 10 am to 8 pm.",
        "reply_to_inbound",
        "en",
    ),
    ("m2", "lakshmi", "ఈ చీర ధర 500 రూపాయలు మాత్రమే. ఈ వారం డిస్కౌంట్ ఉంది.", "reply_to_inbound", "te"),
    (
        "m3",
        "kavitha",
        "We are sorry to hear that. We will look into it and come back to you.",
        "reply_to_inbound",
        "en",
    ),
    ("m4", "ravi", "Hello, would you like to see our new silk collection?", "followup", "en"),
]


class OutboxDemoSeeder(ManualDemoSeeder):
    leads: dict[str, str]
    lines: list[str]

    def customers(self) -> None:
        t = f"/v1/tenants/{self.tenant_id}"
        self.leads = {}
        for key, company_name, phone, agreed, wrote, hours in CUSTOMERS:
            company, contact, lead = (
                demo_id(f"ob-{key}-company"),
                demo_id(f"ob-{key}-contact"),
                demo_id(f"ob-{key}-lead"),
            )
            self._create(
                f"{t}/companies",
                {
                    "id": company,
                    "name": company_name,
                    "type": "customer",
                    "country": "IN",
                    "city": "Demoville",
                    "tags": ["demo", "synthetic"],
                },
                "company",
            )
            self._create(
                f"{t}/contacts",
                {
                    "id": contact,
                    "company_id": company,
                    "full_name": f"{company_name} contact",
                    "phone": phone,
                },
                "contact",
            )
            self._create(
                f"{t}/leads",
                {
                    "id": lead,
                    "company_id": company,
                    "contact_id": contact,
                    "source": "DEMO WhatsApp (synthetic)",
                },
                "lead",
            )
            self.leads[key] = lead
            if agreed:
                r = self._api(
                    "POST",
                    f"{t}/contacts/{contact}/record-consent",
                    {
                        "channel": "whatsapp",
                        "status": "granted",
                        "basis": "explicit_consent",
                        "evidence_type": "web_form",
                        "evidence_ref": f"demo:{key}",
                    },
                )
                if r.status_code != 200:
                    raise SeedError(f"Could not record the demo consent (HTTP {r.status_code}).")
            if wrote:
                when = (
                    (datetime.now(UTC) - timedelta(hours=hours))
                    .replace(microsecond=0)
                    .isoformat()
                    .replace("+00:00", "Z")
                )
                r = self._api(
                    "POST",
                    f"{t}/leads/{lead}/enquiries",
                    {
                        "id": demo_id(f"ob-{key}-enquiry"),
                        "channel": "whatsapp",
                        "received_at": when,
                        "subject": None,
                        "text": wrote,
                    },
                )
                if r.status_code not in (200, 201, 409):  # 409: a replay with another clock
                    raise SeedError(
                        f"Could not record the demo inbound message (HTTP {r.status_code})."
                    )

    def settings(self) -> None:
        r = self._api(
            "PUT",
            f"/v1/tenants/{self.tenant_id}/outbox/settings",
            {"auto_send_enabled": True, "per_customer_daily_limit": 3},
        )
        if r.status_code != 200:
            raise SeedError(
                f"Could not switch automatic sending on for the demo business (HTTP {r.status_code}). Is the API recent and the kill switch on (`make seed-demo-outbox` does it)?"
            )

    def messages(self) -> None:
        self.lines = []
        for key, customer, text, category, language in MESSAGES:
            r = self._api(
                "POST",
                f"/v1/tenants/{self.tenant_id}/outbox/messages",
                {
                    "message_id": demo_id(f"ob-{key}"),
                    "lead_id": self.leads[customer],
                    "text": text,
                    "language": language,
                    "category": category,
                    "source": "assistant",
                },
            )
            if r.status_code != 200:
                raise SeedError(f"Could not make the demo message {key} (HTTP {r.status_code}).")
            m: dict[str, Any] = r.json()["message"]
            self.lines.append(f"  {key}: {m['status']} ({m['reason']}) to {m['customer']}")

    def call(self) -> None:
        r = self._api(
            "POST",
            f"/v1/tenants/{self.tenant_id}/call-requests",
            {
                "request_id": demo_id("ob-call"),
                "lead_id": self.leads["lakshmi"],
                "reason": "The customer asked for a call about a large wedding order.",
                "script_draft": "Hello, this is the DEMO shop. You asked about silk sarees for a wedding. How many pieces do you need?",
                "language": "en",
            },
        )
        if r.status_code != 200:
            raise SeedError(f"Could not make the demo call request (HTTP {r.status_code}).")
        self.lines.append(f"  call request: {r.json()['request']['status']}")


def run(
    config: Any, *, api: httpx.Client | None = None, http: httpx.Client | None = None
) -> OutboxDemoSeeder:
    require_local(config.supabase_url, "Supabase URL")
    require_local(config.api_url, "API URL")
    api_client = httpx.Client() if api is None else api
    http_client = httpx.Client() if http is None else http
    try:
        seeder = OutboxDemoSeeder(config, api_client, http_client)
        seeder.sign_in()
        seeder.workspace()
        seeder.customers()
        seeder.settings()
        seeder.messages()
        seeder.call()
        return seeder
    finally:
        if api is None:
            api_client.close()
        if http is None:
            http_client.close()


def main() -> int:
    try:
        s = run(load_config())
    except SeedError as exc:
        print(f"seed-demo-outbox: {exc}", file=sys.stderr)
        return 1
    print(
        "seed-demo-outbox: done (a clearly fictional workspace; nothing was sent to anyone: the only channel is a local stand-in)."
    )
    print("\n".join(s.lines))
    print(
        f"  outbox log:   GET http://localhost:8000/v1/tenants/{s.tenant_id}/outbox/messages   (and /outbox/approvals)"
    )
    print(f"  sign in as {DEMO_EMAIL}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
