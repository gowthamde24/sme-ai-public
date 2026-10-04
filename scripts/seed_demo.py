"""make seed-demo: build a clearly FAKE small business through our API, with evidence for its facts.

Acceptance test for T004 (ADR 0008 / 0009): "a synthetic SME can be represented end-to-end and every
researched fact can carry evidence". Everything here is invented (every name starts with "DEMO", every
address is on a reserved .test domain). No real person, no real company, no Customer Zero data.

HOW IT TALKS TO THE SYSTEM
  * Everything goes through OUR API (the demo user's own access token): workspace, company, contacts,
    products, lead, opportunity, and the evidence attached to the company and the lead.
  * EXCEPT claims. They have no API yet (the research-agent ticket decides how claims are written), so
    this script creates the demo claims and their evidence links through PostgREST using the demo
    user's OWN JWT and the public anon key, under row-level security like any signed-in user. There is
    NO service-role key anywhere in this script, in the repository, or in the environment it reads.

SAFETY
  * Refuses to run unless the Supabase URL AND the API URL point at this machine (127.0.0.1 / localhost
    / ::1). The check runs before any network call.
  * Idempotent: every row has a fixed id derived from a name, so re-running creates nothing twice
    (the API answers 200 for an identical retry; claims and links are looked up before being created).
  * Config comes from the environment, or from the usual env files (services/ai-api/.env and
    apps/web/.env.local), read for exactly the public values it needs: SUPABASE_URL, SUPABASE_ANON_KEY,
    NEXT_PUBLIC_API_BASE_URL / SEED_API_URL. No value is ever printed.
  * The demo login is a fixed fake user on a reserved domain; its password is a constant below that is
    only ever valid against a local stack (the script refuses any other host).

Run: `make dev-api` in one terminal, then `make seed-demo`.
"""

from __future__ import annotations

import os
import sys
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

ROOT = Path(__file__).resolve().parents[1]
LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1"}
DEFAULT_SUPABASE_URL = "http://127.0.0.1:54321"
DEFAULT_API_URL = "http://localhost:8000"

DEMO_EMAIL = "demo-owner@demo.example.test"
DEMO_PASSWORD = "Demo-Only-Local-Password-1!"  # noqa: S105 - synthetic user, local stack only
DEMO_WORKSPACE_NAME = "DEMO Synthetic Sarees Co (fictional)"
DEMO_WORKSPACE_SLUG = "demo-synthetic-sme"
_NAMESPACE = uuid.UUID("5d3f1c7e-9a3b-4a52-8f0e-0d3e6c1b7a11")  # arbitrary, fixed


class SeedError(Exception):
    """A readable failure. Messages never contain keys, tokens or response bodies."""


def demo_id(name: str) -> str:
    """Stable id for a demo row: the same name always gives the same id (idempotent seeding)."""
    return str(uuid.uuid5(_NAMESPACE, name))


@dataclass(frozen=True)
class Config:
    supabase_url: str
    anon_key: str = field(repr=False)
    api_url: str


@dataclass
class Summary:
    tenant_id: str
    company_id: str
    lead_id: str
    created: int = 0
    reused: int = 0
    contacts: int = 0
    products: int = 0
    company_evidence: int = 0
    lead_evidence: int = 0
    claims: int = 0
    claim_links: dict[str, int] = field(default_factory=dict)
    stances: set[str] = field(default_factory=set)


# ----------------------------------------------------------------------------- config and safety
def _read_env_file(path: Path, wanted: set[str]) -> dict[str, str]:
    """Read only the `wanted` KEY=VALUE pairs from an env file. Never prints, never raises."""
    found: dict[str, str] = {}
    try:
        lines = path.read_text().splitlines()
    except OSError:
        return found
    for line in lines:
        key, sep, value = line.partition("=")
        key = key.strip()
        if sep and key in wanted and not line.lstrip().startswith("#"):
            found[key] = value.strip().strip("'\"")
    return found


def load_config(environ: dict[str, str] | None = None) -> Config:
    env = dict(os.environ if environ is None else environ)
    wanted = {"SUPABASE_URL", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_API_BASE_URL"}
    files: dict[str, str] = {}
    for candidate in (ROOT / "apps/web/.env.local", ROOT / "services/ai-api/.env"):
        files.update(_read_env_file(candidate, wanted))
    merged = {**files, **{k: v for k, v in env.items() if v}}  # the environment wins
    return Config(
        supabase_url=merged.get("SUPABASE_URL", DEFAULT_SUPABASE_URL).rstrip("/"),
        anon_key=merged.get("SUPABASE_ANON_KEY", ""),
        api_url=(
            merged.get("SEED_API_URL") or merged.get("NEXT_PUBLIC_API_BASE_URL") or DEFAULT_API_URL
        ).rstrip("/"),
    )


def require_local(url: str, what: str) -> None:
    host = urlparse(url).hostname or ""
    if urlparse(url).scheme not in ("http", "https") or host not in LOCAL_HOSTS:
        raise SeedError(
            f"Refusing to run: the {what} is not on this machine. The demo seed only talks to a "
            "local stack (127.0.0.1 or localhost)."
        )


# ----------------------------------------------------------------------------- the fake business
COMPANY_NAME = "DEMO Meridian Textiles Pvt Ltd (fictional)"
CONTACTS = [
    (
        "contact-asha",
        "DEMO Asha Testperson",
        "asha.testperson@demo.example.test",
        "+00 000 000 0001",
        "DEMO Purchasing Lead",
    ),
    (
        "contact-ravi",
        "DEMO Ravi Samplename",
        "ravi.samplename@demo.example.test",
        "+00 000 000 0002",
        "DEMO Owner",
    ),
    (
        "contact-mei",
        "DEMO Mei Placeholder",
        "mei.placeholder@demo.example.test",
        "+00 000 000 0003",
        "DEMO Accounts",
    ),
]
PRODUCTS = [
    ("product-1", "DEMO-SKU-001", "DEMO Sample Silk Saree (fictional)", "piece", "silk"),
    ("product-2", "DEMO-SKU-002", "DEMO Sample Cotton Dupatta (fictional)", "piece", "cotton"),
    ("product-3", "DEMO-SKU-003", "DEMO Sample Brocade Fabric (fictional)", "metre", "silk"),
]

# Evidence on the company: (key, kind, url, reference, snippet, published)
COMPANY_EVIDENCE = [
    (
        "ev-about",
        "web_page",
        "https://demo.example.test/meridian/about",
        None,
        "DEMO: the about page of an invented company. Nothing here is real.",
        "2026-01-15",
    ),
    (
        "ev-registry",
        "registry",
        "https://registry.demo.example.test/entries/0000",
        "doc:demo-registry-extract",
        "DEMO: invented registry extract listing an ISO 9001 certificate.",
        "2026-02-01",
    ),
    (
        "ev-call",
        "note",
        None,
        "note:demo-call-log-1",
        "DEMO: invented call note: the certificate number could not be confirmed.",
        None,
    ),
    (
        "ev-listing",
        "listing",
        "https://marketplace.demo.example.test/listings/meridian",
        None,
        "DEMO: invented marketplace listing mentioning exports to Germany.",
        "2026-03-10",
    ),
]
LEAD_EVIDENCE = [
    (
        "ev-enquiry",
        "email",
        None,
        "email:demo-enquiry-1",
        "DEMO: invented enquiry mentioning orders before the festival season.",
        None,
    ),
    (
        "ev-fair",
        "web_page",
        "https://tradefair.demo.example.test/exhibitors/meridian",
        None,
        "DEMO: invented trade-fair exhibitor page.",
        "2026-04-01",
    ),
]

# Claims: (key, subject, predicate, value, confidence, [(evidence key, stance), ...])
CLAIMS = [
    ("claim-exports", "company", "exports_to", "DEMO: ships sample lots to Germany (invented)", "low",
     [("ev-listing", "supports")]),
    ("claim-iso", "company", "certifications.iso9001", "DEMO: holds an ISO 9001 certificate (invented)", "medium",
     [("ev-registry", "supports"), ("ev-call", "contradicts")]),
    ("claim-staff", "company", "employee_count_band", "DEMO: about 10 to 50 staff (invented)", "unverified",
     [("ev-about", "context")]),
    ("claim-season", "lead", "buying_season", "DEMO: orders before the festival season (invented)", "low",
     [("ev-enquiry", "supports")]),
]  # fmt: skip


# ----------------------------------------------------------------------------- the run
class Seeder:
    def __init__(self, config: Config, api: httpx.Client, http: httpx.Client) -> None:
        self.c = config
        self.api = api
        self.http = http
        self.token = ""
        self.user_id = ""
        self.summary = Summary("", "", "")

    # ---- plumbing
    def _api(self, method: str, path: str, body: dict[str, Any] | None = None) -> httpx.Response:
        try:
            return self.api.request(
                method,
                f"{self.c.api_url}{path}",
                json=body,
                headers={"Authorization": f"Bearer {self.token}"},
                timeout=30,
            )
        except httpx.HTTPError:
            raise SeedError(
                "The API is not reachable. Start it with `make dev-api`, then run this again."
            ) from None

    def _rest(self, method: str, path: str, body: Any = None) -> httpx.Response:
        try:
            return self.http.request(
                method,
                f"{self.c.supabase_url}/rest/v1{path}",
                json=body,
                headers={
                    "apikey": self.c.anon_key,
                    "Authorization": f"Bearer {self.token}",
                    "Prefer": "return=minimal",
                },
                timeout=30,
            )
        except httpx.HTTPError:
            raise SeedError(
                "The local Supabase stack is not reachable. Run `make db-start`."
            ) from None

    def _create(self, path: str, body: dict[str, Any], what: str) -> None:
        r = self._api("POST", path, body)
        if r.status_code == 201:
            self.summary.created += 1
        elif r.status_code == 200:
            self.summary.reused += 1
        else:
            raise SeedError(f"Could not create the demo {what} (HTTP {r.status_code}).")

    # ---- steps
    def sign_in(self) -> None:
        if not self.c.anon_key:
            raise SeedError(
                "SUPABASE_ANON_KEY is not set. Run `make seed-demo` (it takes the local stack's "
                "public key), or put it in services/ai-api/.env."
            )
        auth = f"{self.c.supabase_url}/auth/v1"
        headers = {"apikey": self.c.anon_key}
        creds = {"email": DEMO_EMAIL, "password": DEMO_PASSWORD}

        def token_request() -> httpx.Response:
            return self.http.post(
                f"{auth}/token?grant_type=password", json=creds, headers=headers, timeout=30
            )

        try:
            r = token_request()
            if r.status_code != 200:  # first run: create the demo user, then sign in
                self.http.post(f"{auth}/signup", json=creds, headers=headers, timeout=30)
                r = token_request()
        except httpx.HTTPError:
            raise SeedError(
                "The local Supabase stack is not reachable. Run `make db-start`."
            ) from None
        if r.status_code != 200:
            raise SeedError("Could not sign in the demo user on the local stack.")
        body = r.json()
        self.token = str(body["access_token"])
        self.user_id = str(body["user"]["id"])

    def workspace(self) -> None:
        r = self._api(
            "POST", "/v1/tenants", {"name": DEMO_WORKSPACE_NAME, "slug": DEMO_WORKSPACE_SLUG}
        )
        if r.status_code != 200:
            raise SeedError(f"Could not create the demo workspace (HTTP {r.status_code}).")
        self.summary.tenant_id = str(r.json()["id"])

    def records(self) -> None:
        t = f"/v1/tenants/{self.summary.tenant_id}"
        company = demo_id("company")
        self.summary.company_id = company
        self._create(
            f"{t}/companies",
            {
                "id": company,
                "name": COMPANY_NAME,
                "type": "prospect",
                "website": "https://demo.example.test/meridian",
                "country": "IN",
                "city": "Demoville",
                "industry": "Textiles (fictional)",
                "tags": ["demo", "synthetic"],
            },
            "company",
        )
        first_contact = ""
        for key, name, email, phone, title in CONTACTS:
            cid = demo_id(key)
            first_contact = first_contact or cid
            self._create(
                f"{t}/contacts",
                {
                    "id": cid,
                    "company_id": company,
                    "full_name": name,
                    "email": email,
                    "phone": phone,
                    "job_title": title,
                },
                "contact",
            )
            self.summary.contacts += 1
        for key, sku, name, unit, category in PRODUCTS:
            self._create(
                f"{t}/products",
                {
                    "id": demo_id(key),
                    "sku": sku,
                    "name": name,
                    "unit": unit,
                    "category": category,
                    "description": "DEMO: invented product for the synthetic business.",
                },
                "product",
            )
            self.summary.products += 1
        lead = demo_id("lead")
        self.summary.lead_id = lead
        self._create(
            f"{t}/leads",
            {
                "id": lead,
                "company_id": company,
                "contact_id": first_contact,
                "source": "DEMO trade fair (synthetic)",
            },
            "lead",
        )
        self._create(
            f"{t}/opportunities",
            {
                "id": demo_id("opportunity"),
                "company_id": company,
                "contact_id": first_contact,
                "lead_id": lead,
                "title": "DEMO festival-season enquiry (synthetic)",
            },
            "opportunity",
        )

    def evidence(self) -> None:
        t = f"/v1/tenants/{self.summary.tenant_id}"
        for target, segment, items in (
            (self.summary.company_id, "companies", COMPANY_EVIDENCE),
            (self.summary.lead_id, "leads", LEAD_EVIDENCE),
        ):
            for key, kind, url, reference, snippet, published in items:
                body: dict[str, Any] = {"id": demo_id(key), "kind": kind, "snippet": snippet}
                if url:
                    body["url"] = url
                if reference:
                    body["reference"] = reference
                if published:
                    body["published_at"] = f"{published}T00:00:00Z"
                self._create(f"{t}/{segment}/{target}/evidence", body, "evidence")
                if segment == "companies":
                    self.summary.company_evidence += 1
                else:
                    self.summary.lead_evidence += 1

    def claims(self) -> None:
        """Claims have no API: PostgREST with the demo user's own JWT and the anon key, under RLS."""
        tenant = self.summary.tenant_id
        for key, subject, predicate, value, confidence, links in CLAIMS:
            claim_id = demo_id(key)
            row = {
                "id": claim_id,
                "tenant_id": tenant,
                "company_id" if subject == "company" else "lead_id": (
                    self.summary.company_id if subject == "company" else self.summary.lead_id
                ),
                "predicate": predicate,
                "value": value,
                "confidence": confidence,
            }
            self._insert_once("claims", row, "claim")
            for evidence_key, stance in links:
                self._insert_once(
                    "evidence_links",
                    {
                        "id": demo_id(f"{key}:{evidence_key}"),
                        "tenant_id": tenant,
                        "evidence_id": demo_id(evidence_key),
                        "claim_id": claim_id,
                        "stance": stance,
                    },
                    "claim link",
                )
                self.summary.stances.add(stance)
            self.summary.claims += 1

    def _insert_once(self, table: str, row: dict[str, Any], what: str) -> None:
        r = self._rest("POST", f"/{table}", row)
        if r.status_code == 201:
            self.summary.created += 1
            return
        # Postgres reports a duplicate key as HTTP 409 (23505): the row from an earlier run.
        if r.status_code == 409:
            existing = self._rest_get(f"/{table}?id=eq.{row['id']}&select=id,tenant_id")
            if existing and existing[0]["tenant_id"] == row["tenant_id"]:
                self.summary.reused += 1
                return
        raise SeedError(f"Could not create the demo {what} (HTTP {r.status_code}).")

    def _rest_get(self, path: str) -> list[dict[str, Any]]:
        try:
            r = self.http.get(
                f"{self.c.supabase_url}/rest/v1{path}",
                headers={"apikey": self.c.anon_key, "Authorization": f"Bearer {self.token}"},
                timeout=30,
            )
        except httpx.HTTPError:
            raise SeedError(
                "The local Supabase stack is not reachable. Run `make db-start`."
            ) from None
        if r.status_code != 200 or not isinstance(r.json(), list):
            raise SeedError(f"Could not read back the demo data (HTTP {r.status_code}).")
        rows: list[dict[str, Any]] = r.json()
        return rows

    def verify(self) -> None:
        """The acceptance check: every claim has at least one evidence link."""
        links = self._rest_get(
            f"/evidence_links?tenant_id=eq.{self.summary.tenant_id}&claim_id=not.is.null&select=claim_id,stance"
        )
        per_claim: dict[str, int] = {}
        for link in links:
            per_claim[link["claim_id"]] = per_claim.get(link["claim_id"], 0) + 1
        for key, *_ in CLAIMS:
            count = per_claim.get(demo_id(key), 0)
            if count < 1:
                raise SeedError(f"Acceptance failed: the demo claim {key} has no evidence.")
            self.summary.claim_links[key] = count
        listed = self._api(
            "GET",
            f"/v1/tenants/{self.summary.tenant_id}/companies/{self.summary.company_id}/evidence?limit=100",
        )
        if listed.status_code != 200 or len(listed.json()["items"]) != len(COMPANY_EVIDENCE):
            raise SeedError("Acceptance failed: the company's evidence is not listed by the API.")


def run(
    config: Config, *, api: httpx.Client | None = None, http: httpx.Client | None = None
) -> Summary:
    """Seed the demo business. `api` / `http` can be injected (the integration test passes the
    in-process application as `api`)."""
    require_local(config.supabase_url, "Supabase URL")
    require_local(config.api_url, "API URL")
    own_api, own_http = api is None, http is None
    api_client = httpx.Client() if api is None else api
    http_client = httpx.Client() if http is None else http
    try:
        seeder = Seeder(config, api_client, http_client)
        seeder.sign_in()
        seeder.workspace()
        seeder.records()
        seeder.evidence()
        seeder.claims()
        seeder.verify()
        return seeder.summary
    finally:
        if own_api:
            api_client.close()
        if own_http:
            http_client.close()


def main() -> int:
    try:
        s = run(load_config())
    except SeedError as exc:
        print(f"seed-demo: {exc}", file=sys.stderr)
        return 1
    print("seed-demo: done (a clearly fictional business; nothing here is real).")
    print(f"  created {s.created} new rows, found {s.reused} already there")
    print(f"  {s.contacts} contacts, {s.products} products, 1 lead, 1 opportunity")
    print(f"  evidence: {s.company_evidence} on the company, {s.lead_evidence} on the lead")
    print(
        f"  claims: {s.claims}, each with evidence (stances used: {', '.join(sorted(s.stances))})"
    )
    base = "http://localhost:3000/app/tenants"
    print(f"  company page: {base}/{s.tenant_id}/companies/{s.company_id}")
    print(f"  lead page:    {base}/{s.tenant_id}/leads/{s.lead_id}")
    print(
        f"  sign in as {DEMO_EMAIL} (the fixed demo password is a constant in scripts/seed_demo.py)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
