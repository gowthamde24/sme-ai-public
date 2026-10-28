"""make seed-staging: SYNTHETIC demo workspaces for the three business types on the HOSTED stack19-staging project (job DC).

The local seeds (seed_demo.py and friends) refuse any host that is not this machine. This one is the opposite and just as strict: it talks ONLY to the
stack19-staging Supabase project and refuses to run unless you ask for it by name.

SAFETY (every one is checked before the first write)
  * the flag --i-know-this-loads-demo-data-into-staging must be given;
  * --project-ref must equal STAGING_REF below (a constant in this file, not an environment variable) and the project the CLI shows under that ref must be
    named exactly "stack19-staging"; the Supabase URL is built from the ref, never read from the environment;
  * the real-data gate is read for every workspace it makes: the script stops if any workspace of the project has the gate OPEN;
  * synthetic data only: the three owners are fake accounts on a reserved .test domain, the workspaces are called "DEMO ... (synthetic)", and the rows are the
    packs' own labelled example data (names start "Example:", no phone, no e-mail: nothing can ever be sent to them).

WHAT IT DOES (idempotent: a second run changes nothing)
  1. Creates three owner accounts through the Auth ADMIN API with the e-mail already confirmed (so public sign-up can stay OFF) and the terms accepted in the
     account's metadata (the database trigger records it, as at a real sign-up). The admin key (the project's service_role key) is read from the Supabase CLI
     into this process's memory only. It is never printed, written, put in an environment variable or sent anywhere except the Auth admin endpoint.
  2. Gives each owner a random password and an authenticator (TOTP) secret; BOTH are stored in Google Secret Manager (sme-demo-<pack>-password and
     sme-demo-<pack>-totp), never in a file, a log or the output. The owner may read them with `gcloud secrets versions access latest --secret=...`.
  3. Signs each owner in (with the second factor, aal2), runs the first-login setup through OUR API (business type + language), and loads the pack's example data
     through OUR API. Everything after step 1 runs as the demo owner under row-level security, like a real person.
  4. (job DG) A visible demo product for construction and a school with students, fake guardian phones and fees (scripts/demo_data.py; only what is absent, never an overwrite).
  5. With --scheduler: creates the scheduler's own account (random password in Secret Manager as sme-scheduler-password) and registers it with
     app.operator_register_scheduler, so the Cloud Run worker job can sign in.

It never calls: db reset, any delete, any wipe. Re-running with the accounts in place only signs in and reads.
Run:  python3 -I scripts/seed_staging.py --i-know-this-loads-demo-data-into-staging --project-ref uiallwgywitryxatcqxf --api-url https://<api> [--scheduler]
"""

from __future__ import annotations

import argparse
import os
import base64
import hashlib
import hmac
import json
import os
import secrets
import struct
import subprocess
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import demo_data  # noqa: E402

STAGING_REF = "uiallwgywitryxatcqxf"
STAGING_NAME = "stack19-staging"
GCP_PROJECT = "project-2757c07e-37d2-4167-88f"
STAGING_API_URL = "https://sme-api-620338396268.asia-south1.run.app"
DEMO_REFRESH_JOB = "sme-demo-refresh"   # the Cloud Run job that runs scripts/refresh_demo_leads.py every morning (docs/runbooks/demo-workspaces.md)
DEMO_DOMAIN = "demo.example.test"
SCHEDULER_EMAIL = f"scheduler@{DEMO_DOMAIN}"
SCHEDULER_SECRET = "sme-scheduler-password"

# pack id, workspace name (the account's metadata; the setup uses it as the business name), language
BUSINESSES = [
    ("textiles", "DEMO Staging Textiles (synthetic)", "en"),
    ("construction_materials", "DEMO Staging Construction Materials (synthetic)", "en"),
    ("education", "DEMO Staging Education (synthetic)", "en"),
    # night 4 (job DR part B2): two "Leads & calls" businesses with a working Lead Desk (leads from four sources, outcomes, a standing rule, a batch approved once, tasks)
    ("real_estate", "DEMO Sri Sai Homes (synthetic)", "en"),
    ("coaching", "DEMO Vidya Coaching Centre (synthetic)", "en"),
]
LEAD_DESK_PACKS = ("real_estate", "coaching")


class SeedError(Exception):
    """A readable failure. Messages never contain keys, tokens, passwords or response bodies."""


def run(argv: list[str], stdin: str | None = None) -> str:
    out = subprocess.run(argv, input=stdin, capture_output=True, text=True, timeout=120, check=False)  # noqa: S603 - fixed argv
    if out.returncode != 0:
        raise SeedError(f"{argv[0]} {argv[1] if len(argv) > 1 else ''} failed (exit {out.returncode}).")
    return out.stdout


def json_from(text: str) -> Any:
    # the CLI may print a notice before or after the JSON
    return json.JSONDecoder().raw_decode(text[min(i for i in (text.find("["), text.find("{")) if i >= 0):])[0]


# ----------------------------------------------------------------------------- Secret Manager
def secret_get(name: str) -> str | None:
    out = subprocess.run(  # noqa: S603
        ["gcloud", "secrets", "versions", "access", "latest", f"--secret={name}", f"--project={GCP_PROJECT}"],
        capture_output=True, text=True, timeout=60, check=False,
    )
    return out.stdout if out.returncode == 0 and out.stdout else None


def secret_put(name: str, value: str) -> None:
    exists = subprocess.run(  # noqa: S603
        ["gcloud", "secrets", "describe", name, f"--project={GCP_PROJECT}"], capture_output=True, text=True, timeout=60, check=False
    ).returncode == 0
    if exists:
        run(["gcloud", "secrets", "versions", "add", name, f"--project={GCP_PROJECT}", "--data-file=-"], stdin=value)
    else:
        run(["gcloud", "secrets", "create", name, f"--project={GCP_PROJECT}", "--replication-policy=user-managed", "--locations=asia-south1", "--data-file=-"], stdin=value)


# ----------------------------------------------------------------------------- HTTP
def http(method: str, url: str, headers: dict[str, str], body: Any = None) -> tuple[int, Any]:
    data = None if body is None else json.dumps(body).encode()
    lock = os.environ.get("ORIGIN_LOCK_SECRET")   # the origin lock (docs/runbooks/origin-lock.md): when the API is locked it wants this header; unset = nothing added
    req = urllib.request.Request(url, method=method, data=data, headers={"Content-Type": "application/json", "User-Agent": "stack19-seed-staging", **({"X-Stack19-Origin": lock} if lock else {}), **headers})  # noqa: S310 - https only, checked
    try:
        with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            return e.code, json.loads(raw)
        except ValueError:
            return e.code, None


def totp_code(secret_b32: str) -> str:
    key = base64.b32decode(secret_b32.upper() + "=" * (-len(secret_b32) % 8))
    digest = hmac.new(key, struct.pack(">Q", int(time.time() // 30)), hashlib.sha1).digest()  # noqa: S324 - RFC 6238
    off = digest[-1] & 0x0F
    return f"{(struct.unpack('>I', digest[off:off + 4])[0] & 0x7FFFFFFF) % 10**6:06d}"


def new_password() -> str:
    return secrets.token_urlsafe(18) + "aA1"  # the project requires 12+ characters with lower, upper and a digit


# ----------------------------------------------------------------------------- the run
class Seeder:
    def __init__(self, api_url: str) -> None:
        if not api_url.startswith("https://"):
            raise SeedError("--api-url must be https.")
        self.api = api_url.rstrip("/")
        self.sb = f"https://{STAGING_REF}.supabase.co"
        # The publishable key is public (it is in the web's pages). In the Cloud Run job there is no logged-in CLI, so the job's environment carries it; everywhere else it is read from the CLI.
        env_key = os.environ.get("SUPABASE_PUBLISHABLE_KEY") if os.environ.get("CLOUD_RUN_JOB") == DEMO_REFRESH_JOB else None
        if env_key:
            self._keys: list[dict[str, Any]] = []
            self.pub = env_key
        else:
            self._keys = json_from(run(["supabase", "projects", "api-keys", "--project-ref", STAGING_REF, "--agent", "no", "-o", "json"]))
            self.pub = next(k["api_key"] for k in self._keys if k.get("type") == "publishable")

    @property
    def admin(self) -> str:
        """The project's service_role key, read only when an account has to be CREATED (memory only; a sign-in, as the daily refresh does, never needs it). The Cloud Run job never has it."""
        if not self._keys:
            raise SeedError("The admin key is not available here (the Cloud Run job only signs in).")
        return str(next(k["api_key"] for k in self._keys if k.get("id") == "service_role"))

    def admin_headers(self) -> dict[str, str]:
        return {"apikey": self.admin, "Authorization": f"Bearer {self.admin}"}

    def pub_headers(self, token: str | None = None) -> dict[str, str]:
        return {"apikey": self.pub, **({"Authorization": f"Bearer {token}"} if token else {})}

    def terms(self) -> dict[str, str]:
        st, body = http("GET", f"{self.api}/v1/policies/current", {})
        if st != 200 or not isinstance(body, dict):
            raise SeedError(f"The API does not answer /v1/policies/current (HTTP {st}).")
        return {"terms": body["terms"]["version"], "privacy": body["privacy"]["version"]}

    def create_user(self, email: str, password: str, meta: dict[str, str]) -> bool:
        st, _ = http("POST", f"{self.sb}/auth/v1/admin/users", self.admin_headers(),
                     {"email": email, "password": password, "email_confirm": True, "user_metadata": meta})
        if st in (200, 201):
            return True
        if st == 422:  # already registered
            return False
        raise SeedError(f"Could not create {email} (HTTP {st}).")

    def sign_in(self, email: str, password: str) -> dict[str, Any]:
        st, body = http("POST", f"{self.sb}/auth/v1/token?grant_type=password", self.pub_headers(), {"email": email, "password": password})
        if st != 200 or not isinstance(body, dict):
            raise SeedError(f"Could not sign {email} in (HTTP {st}).")
        return body

    def second_factor(self, pack: str, session: dict[str, Any]) -> str:
        """An aal2 access token. First run: enrol a TOTP factor and keep its secret in Secret Manager; later runs read the secret back."""
        token = session["access_token"]
        secret = secret_get(f"sme-demo-{pack}-totp")
        factor_id = next((f["id"] for f in session["user"].get("factors", []) or [] if f.get("factor_type") == "totp" and f.get("status") == "verified"), None)
        if factor_id is None:
            st, enrol = http("POST", f"{self.sb}/auth/v1/factors", self.pub_headers(token), {"factor_type": "totp", "friendly_name": f"demo-{pack}", "issuer": "stack19-staging-demo"})
            if st != 200 or not isinstance(enrol, dict):
                raise SeedError(f"Could not enrol the authenticator for {pack} (HTTP {st}).")
            factor_id, secret = enrol["id"], enrol["totp"]["secret"]
            secret_put(f"sme-demo-{pack}-totp", secret)
        if not secret:
            raise SeedError(f"The authenticator for {pack} exists but its secret is not in Secret Manager.")
        st, ch = http("POST", f"{self.sb}/auth/v1/factors/{factor_id}/challenge", self.pub_headers(token), {})
        if st != 200 or not isinstance(ch, dict):
            raise SeedError(f"Challenge failed for {pack} (HTTP {st}).")
        st, ver = http("POST", f"{self.sb}/auth/v1/factors/{factor_id}/verify", self.pub_headers(token), {"challenge_id": ch["id"], "code": totp_code(secret)})
        if st != 200 or not isinstance(ver, dict):
            raise SeedError(f"The authenticator code was refused for {pack} (HTTP {st}).")
        return str(ver["access_token"])

    def call(self, token: str, method: str, path: str, body: Any = None, raw: tuple[bytes, str] | None = None) -> tuple[int, Any]:
        if raw is not None:  # a file: the body is the file itself with its own type (a photo)
            req = urllib.request.Request(f"{self.api}{path}", method=method, data=raw[0], headers={"Authorization": f"Bearer {token}", "Content-Type": raw[1], "User-Agent": "stack19-seed-staging"})  # noqa: S310 - https only, checked
            try:
                with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310
                    return r.status, json.loads(r.read() or b"null")
            except urllib.error.HTTPError as e:
                try:
                    return e.code, json.loads(e.read())
                except ValueError:
                    return e.code, None
        return http(method, f"{self.api}{path}", {"Authorization": f"Bearer {token}"}, body)

    def business(self, pack: str, name: str, language: str, terms: dict[str, str]) -> dict[str, Any]:
        email = f"demo-{pack.replace('_', '-')}@{DEMO_DOMAIN}"
        password = secret_get(f"sme-demo-{pack}-password")
        created = False
        if password is None:
            password = new_password()
            secret_put(f"sme-demo-{pack}-password", password)
        created = self.create_user(email, password, {"terms_version": terms["terms"], "business_name": name})
        token = self.second_factor(pack, self.sign_in(email, password))
        st, setup = self.call(token, "POST", "/v1/account/setup", {
            "business_type": pack, "language": language, "accepted_terms_version": terms["terms"], "accepted_privacy_version": terms["privacy"]})
        if st != 200 or not isinstance(setup, dict):
            raise SeedError(f"The first-login setup failed for {pack} (HTTP {st}).")
        tenant = str(setup["tenant_id"])
        counts = None
        if pack not in LEAD_DESK_PACKS:   # the Lead Desk businesses have their own demo data below, not the packs' labelled example rows
            st, ex = self.call(token, "POST", f"/v1/tenants/{tenant}/example-data")
            if st not in (201, 409):
                raise SeedError(f"Loading the example data failed for {pack} (HTTP {st}).")
            st, status = self.call(token, "GET", f"/v1/tenants/{tenant}/example-data")
            counts = status.get("counts") if st == 200 and isinstance(status, dict) else None
        # job DG: what example data cannot give (a visible construction product; a school with students, fake guardian phones and fees). Each piece only when absent: a re-seed never overwrites.
        def call(method: str, path: str, body: Any = None, raw: tuple[bytes, str] | None = None) -> tuple[int, Any]:
            return self.call(token, method, f"/v1/tenants/{tenant}{path}", body, raw)

        extra: dict[str, str] = {}
        try:
            if pack == "construction_materials":
                extra = demo_data.construction_materials(call)
            elif pack == "education":
                extra = demo_data.education(call, datetime.now(timezone(timedelta(hours=5, minutes=30))).date())
            elif pack in LEAD_DESK_PACKS:
                today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date()
                extra = (demo_data.real_estate if pack == "real_estate" else demo_data.coaching)(call, today)
        except demo_data.DemoError as e:
            raise SeedError(f"the demo data of {pack} failed: {e}") from None
        return {"pack": pack, "email": email, "account_created": created, "workspace_created": bool(setup.get("created")), "tenant_id": tenant, "example_data": counts, "demo_data": extra}

    def scheduler(self) -> str:
        password = secret_get(SCHEDULER_SECRET)
        if password is None:
            password = new_password()
            secret_put(SCHEDULER_SECRET, password)
        self.create_user(SCHEDULER_EMAIL, password, {})
        sql = f"select app.operator_register_scheduler('{SCHEDULER_EMAIL}');"  # noqa: S608 - a constant
        run(["supabase", "db", "query", "--linked", "--agent", "no", sql])
        return SCHEDULER_EMAIL


def guard(args: argparse.Namespace) -> None:
    if not args.i_know_this_loads_demo_data_into_staging:
        raise SeedError("Refusing to run: pass --i-know-this-loads-demo-data-into-staging. This loads synthetic demo data into the HOSTED stack19-staging project.")
    if args.project_ref != STAGING_REF:
        raise SeedError("Refusing to run: --project-ref is not the stack19-staging project.")
    listed = json_from(run(["supabase", "projects", "list", "--agent", "no", "-o", "json"]))
    match = [p for p in listed if p.get("id") == STAGING_REF or p.get("ref") == STAGING_REF]
    if len(match) != 1 or match[0].get("name") != STAGING_NAME:
        raise SeedError(f"Refusing to run: the project under that ref is not named {STAGING_NAME}.")


def guard_demo_refresh_job(args: argparse.Namespace) -> None:
    """The guard of the daily refresh when it runs as the Cloud Run job `sme-demo-refresh`: that job has no logged-in `supabase` CLI, so the project is checked by the two constants instead of by listing projects.
    Cloud Run sets CLOUD_RUN_JOB itself; the job's service account can read only the four demo secrets, and the run is sign-in only (no admin key), so it can touch nothing but the two demo owners' workspaces."""
    if not args.i_know_this_loads_demo_data_into_staging:
        raise SeedError("Refusing to run: pass --i-know-this-loads-demo-data-into-staging. This loads synthetic demo data into the HOSTED stack19-staging project.")
    if os.environ.get("CLOUD_RUN_JOB") != DEMO_REFRESH_JOB:
        raise SeedError(f"Refusing to run: this guard is only for the Cloud Run job {DEMO_REFRESH_JOB}.")
    if args.project_ref != STAGING_REF:
        raise SeedError("Refusing to run: --project-ref is not the stack19-staging project.")
    if args.api_url.rstrip("/") != STAGING_API_URL:
        raise SeedError("Refusing to run: --api-url is not the stack19-staging API.")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--i-know-this-loads-demo-data-into-staging", action="store_true")
    ap.add_argument("--project-ref", required=True)
    ap.add_argument("--api-url", required=True, help="the deployed API, https")
    ap.add_argument("--scheduler", action="store_true", help="also create and register the scheduler account for the worker job")
    args = ap.parse_args()
    try:
        guard(args)
        s = Seeder(args.api_url)
        rows = json_from(run(["supabase", "db", "query", "--linked", "--agent", "no", "-o", "json",
                              "select count(*)::int as open_gates from public.tenant_data_policy where real_data_allowed"]))
        if rows[0]["open_gates"] != 0:
            raise SeedError("Refusing to run: a workspace in this project has the real-data gate OPEN.")
        terms = s.terms()
        for pack, name, language in BUSINESSES:
            r = s.business(pack, name, language, terms)
            print(json.dumps(r))
        if args.scheduler:
            print(json.dumps({"scheduler_account": s.scheduler(), "password": "in Secret Manager as " + SCHEDULER_SECRET}))
    except SeedError as e:
        print(f"seed-staging: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
