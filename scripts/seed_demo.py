"""make seed-demo: build a clearly FAKE small business through our API, with evidence for its facts.

Acceptance test for T004 (ADR 0008 / 0009): "a synthetic SME can be represented end-to-end and every
researched fact can carry evidence". Everything here is invented (every name starts with "DEMO", every
address is on a reserved .test domain). No real person, no real company, no Customer Zero data.

T005 adds the review walkthrough: the generic ICP template (config/icp/silk-wholesale.v1.json, no real
values) is published as the DEMO workspace's active ICP version, and 20 synthetic leads are imported
through the import API, so a human can review 20 leads and label them straight away.

HOW IT TALKS TO THE SYSTEM
  * Everything goes through OUR API (the demo user's own access token): workspace, company, contacts,
    products, lead, opportunity, and the evidence attached to the company and the lead.
  * EXCEPT claims. They have no API yet (the research-agent ticket decides how claims are written), so
    this script creates the demo claims and their evidence links through PostgREST using the demo
    user's OWN JWT and the public (publishable) key, under row-level security like any signed-in user. There is
    NO service-role key anywhere in this script, in the repository, or in the environment it reads.

SAFETY
  * Refuses to run unless the Supabase URL AND the API URL point at this machine (127.0.0.1 / localhost
    / ::1). The check runs before any network call.
  * Idempotent: every row has a fixed id derived from a name, so re-running creates nothing twice
    (the API answers 200 for an identical retry; claims and links are looked up before being created).
  * Config comes from the environment, or from the usual env files (services/ai-api/.env and
    apps/web/.env.local), read for exactly the public values it needs: SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY (or the legacy SUPABASE_ANON_KEY),
    NEXT_PUBLIC_API_BASE_URL / SEED_API_URL. No value is ever printed.
  * The demo login is a fixed fake user on a reserved domain; its password is a constant below that is
    only ever valid against a local stack (the script refuses any other host).

T006 adds the agent walkthrough (`make seed-demo` runs it as its last step, `--agents`): the operator switches are turned on
for the DEMO workspace only (scripts/dev-enable-selftest.sh, local database container), the workspace switch is turned on through
the API, and ONE selftest run is started on the demo company under the scripted fake model. It needs the API to be started with
`AGENTS_ENABLED=true` (the fake model is refused outside development). The run's note and observations appear on the company
page as "agent suggestion, unreviewed"; nothing counts toward a score until an owner accepts it.

Run: `make dev-api` (with AGENTS_ENABLED=true for the agent step) in one terminal, then `make seed-demo`.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import time
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
ICP_TEMPLATE = ROOT / "config" / "icp" / "silk-wholesale.v1.json"
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
    icp_version_id: str = ""
    leads_imported: int = 0


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
    wanted = {"SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY", "NEXT_PUBLIC_API_BASE_URL"}
    files: dict[str, str] = {}
    for candidate in (ROOT / "apps/web/.env.local", ROOT / "services/ai-api/.env"):
        files.update(_read_env_file(candidate, wanted))
    merged = {**files, **{k: v for k, v in env.items() if v}}  # the environment wins
    return Config(
        supabase_url=merged.get("SUPABASE_URL", DEFAULT_SUPABASE_URL).rstrip("/"),
        anon_key=merged.get("SUPABASE_PUBLISHABLE_KEY") or merged.get("SUPABASE_ANON_KEY", ""),
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


# ~20 fully synthetic leads for the review walkthrough. Fictional names ("DEMO ..."), reserved .test
# domains, the reserved +00 phone prefix; real PLACES (Bengaluru, Dharmavaram, Chennai ...) because the
# ICP's geography tiers are about places. A spread of fits on purpose: strong silk businesses, partial
# fits, clearly non-silk businesses, and rows that are not businesses at all.
def _lead(
    n: int,
    name: str,
    city: str | None,
    industry: str | None = None,
    tags: tuple[str, ...] = (),
    *,
    buyer: str | None = None,
    size: str | None = None,
    scale: str | None = None,
    status: str | None = None,
    contact: tuple[str, str] | None = None,
    website: bool = True,
) -> dict[str, Any]:
    row: dict[str, Any] = {
        "company_name": f"DEMO {name}",
        "country": "IN",
        "source": "DEMO trade fair (synthetic)",
    }
    if city:
        row["city"] = city
    if industry:
        row["industry"] = industry
    if tags:
        row["categories"] = list(tags)
    if website:
        row["website"] = f"https://demo-lead-{n:02d}.example.test"
    for key, value in (
        ("buyer_type", buyer),
        ("size_band", size),
        ("order_scale", scale),
        ("operating_status", status),
    ):
        if value:
            row[key] = value
    if contact:
        first, title = contact
        row["contact_name"] = f"DEMO {first} Testperson"
        row["contact_email"] = f"buyer@demo-lead-{n:02d}.example.test"
        row["contact_phone"] = f"+00 000 000 {100 + n:04d}"
        row["contact_job_title"] = title
    return row


DEMO_LEADS: list[dict[str, Any]] = [
    _lead(1, "Sri Lakshmi Silk House", "Bengaluru", "Silk sarees wholesale", ("saree", "silk"),
          buyer="saree_shop", size="large", scale="five_or_more_per_order", status="active", contact=("Asha", "Owner")),
    _lead(2, "Dharmavaram Pattu Emporium", "Dharmavaram", "Silk sarees", ("saree", "silk", "pattu"),
          buyer="saree_shop", size="medium", scale="five_or_more_per_order", status="active", contact=("Ravi", "Proprietor")),
    _lead(3, "Chennai Kanchi Silks Wholesale", "Chennai", "Silk sarees wholesale", ("silk", "saree"),
          buyer="wholesaler", size="large", scale="five_or_more_per_order", contact=("Mei", "Director")),
    _lead(4, "Kanchipuram Weavers Collective", "Kanchipuram", "Handloom silk", ("silk", "handloom"),
          buyer="boutique", size="small", scale="fewer_than_five_per_order"),
    _lead(5, "Hyderabad Boutique Sarees", "Hyderabad", "Boutique sarees", ("saree",),
          buyer="boutique", size="small", contact=("Sam", "Manager")),
    _lead(6, "Mysuru Silk Traders", "Mysuru", "Silk fabric trading", ("silk",), buyer="wholesaler", size="medium"),
    _lead(7, "Varanasi Brocade Bazaar", "Varanasi", "Brocade and silk", ("brocade", "silk"),
          buyer="wholesaler", size="medium", scale="five_or_more_per_order"),
    _lead(8, "Surat Synthetic Textiles", "Surat", "Polyester textiles", ("textile",), buyer="other", size="medium"),
    _lead(9, "Mumbai Multi-Brand Fashion", "Mumbai", "Fashion retail", ("apparel",),
          buyer="multi_brand_store", size="large", contact=("Kim", "Buyer")),
    _lead(10, "Delhi Ethnic Wear Chain", "Delhi", "Ethnic wear retail chain", ("apparel", "saree"),
          buyer="regional_chain", size="large"),
    _lead(11, "Pune Cotton Mart", "Pune", "Cotton textiles", ("cotton", "textile"), buyer="boutique", size="small"),
    _lead(12, "Kolkata Handloom House", "Kolkata", "Handloom sarees", ("saree", "handloom"),
          buyer="saree_shop", size="micro", contact=("Lee", "Partner")),
    _lead(13, "Coimbatore Uniform Cloth", "Coimbatore", "School uniform cloth", ("uniform",), buyer="other", size="small"),
    _lead(14, "Jaipur Block Print Studio", "Jaipur", "Block-print home decor", ("print",), buyer="consumer", size="micro"),
    _lead(15, "Anantapur Saree Centre", "Anantapur", "Saree retail", ("saree",), buyer="saree_shop", size="small"),
    _lead(16, "Madurai Pattu Mahal", "Madurai", "Silk sarees", ("silk", "saree"),
          buyer="saree_shop", size="medium", status="active", contact=("Dev", "Owner")),
    _lead(17, "Bolt and Nut Hardware", "Bengaluru", "Hardware and tools", ("hardware",),
          buyer="other", size="small", contact=("Jo", "Manager")),
    _lead(18, "Happy Paws Pet Store", "Chennai", "Pet supplies", ("pets",), buyer="consumer", size="micro"),
    _lead(19, "Neighbourhood Cricket Club (not a business)", "Dharmavaram", website=False),
    _lead(20, "Test Residence (not a business)", "Bengaluru", website=False),
]  # fmt: skip

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

def totp_code(secret_b32: str, offset_steps: int = 0) -> str:
    """RFC 6238 (SHA-1, 6 digits, 30 s), written out so the seed needs no dependency."""
    key = base64.b32decode(secret_b32.upper() + "=" * (-len(secret_b32) % 8))
    digest = hmac.new(key, struct.pack(">Q", int(time.time() // 30) + offset_steps), hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    return f"{(struct.unpack('>I', digest[offset : offset + 4])[0] & 0x7FFFFFFF) % 10**6:06d}"


def local_factor_secret(user_id: str) -> str:
    """The demo user's authenticator secret, read from the LOCAL database container (never a hosted database)."""
    docker = shutil.which("docker")
    config = (Path(__file__).resolve().parents[1] / "supabase" / "config.toml").read_text()
    match = re.search(r'^project_id\s*=\s*"([^"]+)"', config, re.M)
    if docker is None or match is None or not re.fullmatch(r"[0-9a-f-]{36}", user_id):
        raise SeedError("Cannot read the demo authenticator from the local database container.")
    out = subprocess.run(  # noqa: S603 - fixed argv; the id is a validated uuid
        [docker, "exec", "-i", f"supabase_db_{match.group(1)}", "psql", "-U", "postgres", "-d", "postgres", "-X", "-At", "-c",
         f"select secret from auth.mfa_factors where user_id = '{user_id}' and status = 'verified' order by created_at limit 1"],  # noqa: S608
        capture_output=True, text=True, timeout=30, check=False,
    )
    secret = out.stdout.strip()
    if out.returncode != 0 or not secret:
        raise SeedError("Cannot read the demo authenticator from the local database container.")
    return secret

DEMO_WORKSPACE_LIMIT = 5


def local_allow_demo_workspaces(user_id: str, limit: int = DEMO_WORKSPACE_LIMIT) -> None:
    """Let the demo user own up to `limit` workspaces on this LOCAL stack. The free trial allows one workspace per owner (job AD, D1), and
    the demo user has more than one (this seed, `make seed-demo-manual`). A plan limit is the operator's to change, never a client's, so it is
    set through the local database container exactly as the authenticator secret is read (never a hosted database, no key)."""
    docker = shutil.which("docker")
    config = (Path(__file__).resolve().parents[1] / "supabase" / "config.toml").read_text()
    match = re.search(r'^project_id\s*=\s*"([^"]+)"', config, re.M)
    if docker is None or match is None or not re.fullmatch(r"[0-9a-f-]{36}", user_id) or not 1 <= limit <= 100:
        raise SeedError("Cannot raise the demo user's workspace limit on the local database container.")
    out = subprocess.run(  # noqa: S603 - fixed argv; the id is a validated uuid and the limit a checked integer
        [docker, "exec", "-i", f"supabase_db_{match.group(1)}", "psql", "-U", "postgres", "-d", "postgres", "-X", "-At", "-c",
         f"update public.tenants set workspace_limit = {limit} where id in (select tenant_id from public.memberships where user_id = '{user_id}' and role = 'owner')"],  # noqa: S608
        capture_output=True, text=True, timeout=30, check=False,
    )
    if out.returncode != 0:
        raise SeedError("Cannot raise the demo user's workspace limit on the local database container.")


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
                "SUPABASE_PUBLISHABLE_KEY (or the legacy SUPABASE_ANON_KEY) is not set. Run `make seed-demo` (it takes the local stack's "
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
        self.token = self._second_factor(auth, headers)

    def _second_factor(self, auth: str, headers: dict[str, str]) -> str:
        """A second-factor (aal2) session for the demo owner (ADR 0016: an Owner needs one to publish the profile, switch agents on...).
        LOCAL ONLY: the first run enrols an authenticator for the demo user; later runs read its secret from the local database
        container (the same `docker exec` the dev scripts use), so the e2e walkthroughs can do the same."""
        bearer = {**headers, "Authorization": f"Bearer {self.token}"}
        try:
            factors = self.http.get(f"{auth}/user", headers=bearer, timeout=30).json().get("factors") or []
            verified = [f for f in factors if f.get("status") == "verified"]
            if verified:
                factor_id, secret = str(verified[0]["id"]), local_factor_secret(self.user_id)
            else:
                for stale in factors:  # an unverified leftover from an interrupted run
                    self.http.delete(f"{auth}/factors/{stale['id']}", headers=bearer, timeout=30)
                enrolled = self.http.post(
                    f"{auth}/factors", json={"factor_type": "totp", "friendly_name": "demo"}, headers=bearer, timeout=30
                ).json()
                factor_id, secret = str(enrolled["id"]), str(enrolled["totp"]["secret"])
            for offset in (0, 1, -1):
                challenge = self.http.post(f"{auth}/factors/{factor_id}/challenge", json={}, headers=bearer, timeout=30).json()
                done = self.http.post(
                    f"{auth}/factors/{factor_id}/verify",
                    json={"challenge_id": challenge["id"], "code": totp_code(secret, offset)},
                    headers=bearer,
                    timeout=30,
                )
                if done.status_code == 200:
                    return str(done.json()["access_token"])
        except (httpx.HTTPError, KeyError, ValueError, TypeError):
            pass
        raise SeedError("Could not set up the demo user's authenticator on the local stack.")

    def workspace(self) -> None:
        r = self._api(
            "POST", "/v1/tenants", {"name": DEMO_WORKSPACE_NAME, "slug": DEMO_WORKSPACE_SLUG}
        )
        if r.status_code != 200:
            raise SeedError(f"Could not create the demo workspace (HTTP {r.status_code}).")
        self.summary.tenant_id = str(r.json()["id"])
        local_allow_demo_workspaces(self.user_id)

    def template(self) -> dict[str, Any]:
        """The generic ICP template shipped in the repository (no customer values)."""
        loaded = json.loads(ICP_TEMPLATE.read_text(encoding="utf-8"))
        if not isinstance(loaded, dict):
            raise SeedError("The ICP template file is not a JSON object.")
        return loaded

    def icp(self) -> None:
        """Publish the template as the workspace's ACTIVE ICP version, unless the active one already
        IS the template. A changed template becomes the next version; versions are never edited."""
        t = f"/v1/tenants/{self.summary.tenant_id}"
        template = self.template()
        active = self._api("GET", f"{t}/icp-configs/active")
        if active.status_code == 200 and active.json()["config"] == template:
            self.summary.icp_version_id = str(active.json()["id"])
            self.summary.reused += 1
            return
        if active.status_code not in (200, 404):
            raise SeedError(f"Could not read the active ICP profile (HTTP {active.status_code}).")
        published = self._api("POST", f"{t}/icp-configs", {"config": template})
        if published.status_code != 201:
            raise SeedError(f"Could not publish the ICP profile (HTTP {published.status_code}).")
        self.summary.icp_version_id = str(published.json()["id"])
        self.summary.created += 1

    def leads(self) -> None:
        """Import the 20 synthetic leads through the import API. The batch id is derived from the
        rows, so re-running replays the same batch (HTTP 200) and changes nothing."""
        t = f"/v1/tenants/{self.summary.tenant_id}"
        digest = hashlib.sha256(json.dumps(DEMO_LEADS, sort_keys=True).encode()).hexdigest()
        r = self._api(
            "POST",
            f"{t}/leads/import",
            {
                "batch_id": demo_id(f"lead-import:{digest}"),
                "label": "DEMO seed leads",
                "rows": DEMO_LEADS,
            },
        )
        if r.status_code == 201:
            self.summary.created += 1
        elif r.status_code == 200:
            self.summary.reused += 1
        else:
            raise SeedError(f"Could not import the demo leads (HTTP {r.status_code}).")
        counts = r.json()["counts"]
        if counts["rejected"] or counts["ambiguous"]:
            raise SeedError("Some demo leads were refused by the import; see the review queue.")
        self.summary.leads_imported = int(counts["rows"])

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
        # evidence an AGENT added later (the agent walkthrough) is not part of the seeded facts
        seeded = [i for i in listed.json()["items"] if i["evidence"]["created_via"] != "agent"] if listed.status_code == 200 else []
        if listed.status_code != 200 or len(seeded) != len(COMPANY_EVIDENCE):
            raise SeedError("Acceptance failed: the company's evidence is not listed by the API.")
        queue = self._api(
            "GET",
            f"/v1/tenants/{self.summary.tenant_id}/leads/review-queue?blind=false&limit=100",
        )
        names = (
            {item["company"].get("name") for item in queue.json()["items"]}
            if queue.status_code == 200
            else set()
        )
        missing = [row["company_name"] for row in DEMO_LEADS if row["company_name"] not in names]
        if missing:
            raise SeedError(
                f"Acceptance failed: {len(missing)} demo leads are not in the review queue."
            )


    def agents(self) -> str:
        """Turn the workspace switch on (through the API) and start ONE selftest run on the demo company. Returns the run's
        final state. The run id is fixed, so a second `make seed-demo` replays the same run instead of starting another."""
        base = f"/v1/tenants/{self.summary.tenant_id}"
        on = self._api("PUT", f"{base}/agent-settings", {"enabled": True})
        if on.status_code != 200:
            raise SeedError(f"Could not turn agents on for the demo workspace (HTTP {on.status_code}).")
        run_id = demo_id("agent-run-selftest")
        started = self._api(
            "POST",
            f"{base}/agent-runs",
            {"id": run_id, "agent": "selftest", "target_kind": "company", "target_id": self.summary.company_id},
        )
        if started.status_code == 503:
            raise SeedError(
                "The API is not running agents. Restart it with `AGENTS_ENABLED=true make dev-api` "
                "(the scripted fake model is for local development only), then run this again."
            )
        if started.status_code == 409:
            code = started.json().get("error", {}).get("code", "")
            if code == "agents_disabled":
                raise SeedError(
                    "The platform switch is off for this workspace. Run `./scripts/dev-enable-selftest.sh demo-synthetic-sme`."
                )
        if started.status_code not in (200, 202):
            raise SeedError(f"Could not start the demo agent run (HTTP {started.status_code}).")
        status = started.json().get("status", "running")
        for _ in range(60):
            if status != "running":
                break
            time.sleep(0.5)
            polled = self._api("GET", f"{base}/agent-runs/{run_id}")
            if polled.status_code != 200:
                raise SeedError(f"Could not read the demo agent run (HTTP {polled.status_code}).")
            status = polled.json().get("status", "running")
        return str(status)


def run_agents(
    config: Config, *, api: httpx.Client | None = None, http: httpx.Client | None = None
) -> tuple[Summary, str]:
    """The agent step on its own (the data must already be seeded): sign in, find the workspace, run the demo agent."""
    require_local(config.supabase_url, "Supabase URL")
    require_local(config.api_url, "API URL")
    api_client = httpx.Client() if api is None else api
    http_client = httpx.Client() if http is None else http
    try:
        seeder = Seeder(config, api_client, http_client)
        seeder.sign_in()
        seeder.workspace()
        seeder.summary.company_id = demo_id("company")  # the fixed id records() gave the demo company
        return seeder.summary, seeder.agents()
    finally:
        if api is None:
            api_client.close()
        if http is None:
            http_client.close()


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
        seeder.icp()
        seeder.leads()
        seeder.verify()
        return seeder.summary
    finally:
        if own_api:
            api_client.close()
        if own_http:
            http_client.close()


def main_agents() -> int:
    try:
        s, status = run_agents(load_config())
    except SeedError as exc:
        print(f"seed-demo (agents): {exc}", file=sys.stderr)
        return 1
    base = "http://localhost:3000/app/tenants"
    print(f"seed-demo (agents): the demo selftest run finished as '{status}' (scripted fake model, local only).")
    print(f"  agents page:  {base}/{s.tenant_id}/agents")
    print(f"  company page: {base}/{s.tenant_id}/companies/{s.company_id}  (see 'Agent suggestions')")
    return 0 if status == "succeeded" else 1


def main() -> int:
    if "--agents" in sys.argv[1:]:
        return main_agents()
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
    print(f"  review walkthrough: ICP profile published (version id {s.icp_version_id[:8]}...) and")
    print(f"    {s.leads_imported} synthetic leads imported: {base}/{s.tenant_id}/review")
    print(f"  company page: {base}/{s.tenant_id}/companies/{s.company_id}")
    print(f"  lead page:    {base}/{s.tenant_id}/leads/{s.lead_id}")
    print(
        f"  sign in as {DEMO_EMAIL} (the fixed demo password is a constant in scripts/seed_demo.py)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
