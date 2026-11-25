"""One-command smoke of the integration batch against a STAGING-backed API (local or deployed). Prints PASS / FAIL / SKIP per check and exits 1 on any FAIL. No secret is printed.

  python3 scripts/smoke_batch.py --i-know-this-is-staging --api-url http://localhost:8000 [--pack textiles] [--open-signup]

It signs in as a synthetic demo owner of staging (password and authenticator secret from Secret Manager, in memory only, exactly like scripts/staging_smoke_api.py), then through the API:
  1. sign-up status route                      2. trial claim path with the FAKE phone-code sender (needs SIGNUP_PHONE_SENDER=fake + SIGNUP_FAKE_CODE_ECHO on the API;
                                                  --open-signup opens the database switch on STAGING for the run and closes it again)
  3. a TEST-mode Razorpay order                4. wallet credit by the SIGNED webhook (the secret BILLING_RAZORPAY_WEBHOOK_SECRET is read from the owner's local file or the
                                                  environment; the API must hold the same secret: true for the local API from run-local-api.sh, not for the deployed staging one -> SKIP)
  5. a lead through a job's lead address       6. describe-the-job (the model is whatever the API has; "no model" is reported, not failed)
  7. phone-lines read                          8. developer API: a lead and a dry-run call with an Idempotency-Key (test-mode key made and revoked by the script)
Everything it creates is named "Smoke ..." and synthetic; nobody is called or messaged (fake channels, simulated calls)."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import seed_staging as ss  # noqa: E402

STAGING_REF = "uiallwgywitryxatcqxf"
ROOT = Path(__file__).resolve().parents[1]
SECRETS_FILE = Path("/Volumes/Stack19/stack19/.secrets-local/razorpay-test.env")
RESULTS: list[str] = []


def say(status: str, name: str, note: str = "") -> None:
    RESULTS.append(status)
    print(f"{status:<5} {name}" + (f" :: {note}" if note else ""))


def raw_post(url: str, body: bytes, headers: dict[str, str]) -> tuple[int, Any]:
    req = urllib.request.Request(url, method="POST", data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310
            data = r.read()
            return r.status, (json.loads(data) if data else None)
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except ValueError:
            return e.code, None


def webhook_secret() -> str | None:
    value = os.environ.get("BILLING_RAZORPAY_WEBHOOK_SECRET")
    if value:
        return value
    if SECRETS_FILE.exists():
        for line in SECRETS_FILE.read_text().splitlines():
            if line.startswith("BILLING_RAZORPAY_WEBHOOK_SECRET="):
                return line.split("=", 1)[1].strip().strip("'\"") or None
    return None


def code_of(out: Any) -> str:
    err = out.get("error") if isinstance(out, dict) else None
    return str(err.get("code")) if isinstance(err, dict) else "-"


class Run:
    def __init__(self, api: str, pack: str) -> None:
        self.api = api.rstrip("/")
        self.s = ss.Seeder("https://placeholder.invalid")   # the seeder only accepts https; the real (maybe local http) address is set next
        self.s.api = self.api
        email = f"demo-{pack.replace('_', '-')}@{ss.DEMO_DOMAIN}"
        password = ss.secret_get(f"sme-demo-{pack}-password")
        if password is None:
            raise ss.SeedError(f"no stored password for {pack}: run scripts/seed_staging.py first")
        self.token = self.s.second_factor(pack, self.s.sign_in(email, password))
        st, setup = self.s.call(self.token, "GET", "/v1/account/setup")
        if st != 200 or setup.get("state") != "done":
            raise ss.SeedError(f"{pack}: the workspace is not set up")
        self.tenant = str(setup["tenant_id"])
        self.t = f"/v1/tenants/{self.tenant}"

    def call(self, method: str, path: str, body: Any = None) -> tuple[int, Any]:
        return self.s.call(self.token, method, path, body)


def open_signup(value: bool) -> bool:
    """STAGING only: flips the database switch of sign-up (the operator's `ops_signup_set` needs a system account; this is the staging database owner's own statement)."""
    ref = (ROOT / "supabase" / ".temp" / "project-ref").read_text().strip() if (ROOT / "supabase" / ".temp" / "project-ref").exists() else ""
    if ref != STAGING_REF:
        return False
    r = subprocess.run(["supabase", "db", "query", "--linked", f"update signup.settings set open = {'true' if value else 'false'}"], cwd=ROOT, capture_output=True, text=True, timeout=120)
    return r.returncode == 0


def database_has(table: str) -> bool | None:
    """True/False when this checkout is linked to STAGING and can ask; None when it cannot (then every check is tried)."""
    ref = (ROOT / "supabase" / ".temp" / "project-ref").read_text().strip() if (ROOT / "supabase" / ".temp" / "project-ref").exists() else ""
    if ref != STAGING_REF:
        return None
    r = subprocess.run(["supabase", "db", "query", "--linked", f"select to_regclass('{table}') is not null as there"], cwd=ROOT, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        return None
    return '"there": true' in r.stdout


def check_signup(run: Run, opened: bool) -> None:
    st, out = run.call("GET", "/v1/signup/status")
    if st == 404:
        return say("SKIP", "1 sign-up status", "SIGNUP_OPEN is off on this API")
    keys = {"open", "terms_version", "privacy_version", "aup_version", "email_confirmed", "consent_done", "phone_verified", "trial_claimed"}
    say("PASS" if st == 200 and keys <= set(out) else "FAIL", "1 sign-up status", f"HTTP {st}, open={out.get('open') if isinstance(out, dict) else '?'}")
    if st != 200:
        return
    if not out.get("open"):
        return say("SKIP", "2 trial claim path", "the database switch is closed (use --open-signup on staging)")
    for kind in ("terms", "privacy", "aup"):
        run.call("POST", "/v1/signup/consent", {"kind": kind, "version": out[f"{kind}_version"]})
    st, start = run.call("POST", "/v1/signup/phone/start", {"phone": "+919000000" + str(100 + int(hashlib.sha256(run.tenant.encode()).hexdigest(), 16) % 899)})
    if st != 200 or not isinstance(start, dict) or "debug_code" not in start:
        return say("FAIL" if st not in (409, 429, 503) else "SKIP", "2 trial claim path", f"phone start: HTTP {st} {code_of(start)} (the fake sender with the echo must be on)")
    st, _ = run.call("POST", "/v1/signup/phone/verify", {"code": start["debug_code"]})
    st2, claim = run.call("POST", f"{run.t}/billing/trial-claim")
    reasons = {"already_granted", "email_used", "phone_used", "daily_cap"}
    good = st == 200 and st2 == 200 and isinstance(claim, dict) and (claim.get("granted") is True or claim.get("reason") in reasons)
    say("PASS" if good else "FAIL", "2 trial claim path", f"verify HTTP {st}, claim HTTP {st2}, granted={claim.get('granted') if isinstance(claim, dict) else '?'}, reason={claim.get('reason') if isinstance(claim, dict) else '?'}")


def check_razorpay(run: Run) -> None:
    st, order = run.call("POST", f"{run.t}/billing/credits/topups", {"amount_rupees": 100})
    if st == 404:
        return say("SKIP", "3 test-mode Razorpay order", "PRICING_V2 is off on this API")
    ok = st in (200, 201) and isinstance(order, dict) and isinstance(order.get("order_id"), str) and order.get("mode") in ("test", "fake")
    say("PASS" if ok else "FAIL", "3 test-mode Razorpay order", f"HTTP {st}, mode={order.get('mode') if isinstance(order, dict) else '?'}, key is test={str(order.get('key_id', '')).startswith('rzp_test_') if isinstance(order, dict) else '?'}")
    if not ok:
        return
    if database_has("pricing.refunds") is False:
        return say("SKIP", "4 wallet credit by signed webhook", "this database lacks migrations 992200 and 992210 (credits top-up) until the batch is pushed")
    secret = webhook_secret()
    if secret is None:
        return say("SKIP", "4 wallet credit by signed webhook", "no BILLING_RAZORPAY_WEBHOOK_SECRET here")
    if run.api.startswith("https://") and "localhost" not in run.api:
        return say("SKIP", "4 wallet credit by signed webhook", "the deployed API does not hold the owner's local test webhook secret")
    before = run.call("GET", f"{run.t}/billing/balance")[1]
    paid = int(order["amount_paise"])
    body = json.dumps({"event": "order.paid", "payload": {"order": {"entity": {"id": order["order_id"], "amount_paid": paid, "notes": {"tenant_id": run.tenant}}}, "payment": {"entity": {"id": "pay_SMOKE" + uuid.uuid4().hex[:10]}}}}).encode()
    sig = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    st, out = raw_post(f"{run.api}/v1/webhooks/razorpay-billing", body, {"Content-Type": "application/json", "X-Razorpay-Signature": sig, "X-Razorpay-Event-Id": "smoke-" + uuid.uuid4().hex})
    bad_st, _ = raw_post(f"{run.api}/v1/webhooks/razorpay-billing", body, {"Content-Type": "application/json", "X-Razorpay-Signature": "0" * 64})
    after = run.call("GET", f"{run.t}/billing/balance")[1]
    delta = int(after.get("balance_paise", 0)) - int(before.get("balance_paise", 0)) if isinstance(after, dict) and isinstance(before, dict) else 0
    say("PASS" if st in (200, 202) and bad_st in (400, 401, 403) and delta == int(order["added_paise"]) else "FAIL", "4 wallet credit by signed webhook", f"webhook HTTP {st}, a wrong signature HTTP {bad_st}, balance rose by {delta} paise (want {order.get('added_paise')})")


def check_lead_address(run: Run) -> None:
    job = "smoke_job"
    st, made = run.call("POST", f"{run.t}/jobs/{job}/lead-address", {"source_id": str(uuid.uuid5(uuid.NAMESPACE_URL, "smoke:" + run.tenant))})
    if st not in (200, 201) or not isinstance(made, dict):
        return say("FAIL", "5 lead through a lead address", f"make address: HTTP {st} {code_of(made)}")
    url = (made.get("secret") or {}).get("url") if isinstance(made.get("secret"), dict) else None
    if not url:
        run.call("POST", f"{run.t}/lead-sources/{made['source_id']}/rotate")
        made = run.call("GET", f"{run.t}/jobs/{job}/lead-address")[1] or made
        rot = run.call("POST", f"{run.t}/lead-sources/{made['source_id']}/rotate")[1]
        url = (rot.get("secret") or {}).get("url") if isinstance(rot, dict) else None
    if not url:
        return say("FAIL", "5 lead through a lead address", "no address URL")
    url = run.api + "/v1/lead-intake/" + url.rsplit("/", 1)[1]
    st, _ = raw_post(url, json.dumps({"name": "Smoke Lead", "phone": "9000000" + str(100 + uuid.uuid4().int % 899), "message": "smoke"}).encode(), {"Content-Type": "application/json"})
    items = run.call("GET", f"{run.t}/lead-sources/{made['source_id']}/activity")[1]
    rows = items.get("items", []) if isinstance(items, dict) else []
    seen = any(i.get("outcome") in ("accepted", "duplicate", "refused") for i in rows)   # a demo workspace's real-data gate is closed: its lead is refused as "blocked", which is the right answer there
    outcome = rows[0].get("reason") if rows else "-"
    tried = run.call("POST", f"{run.t}/lead-sources/{made['source_id']}/test-lead", {"sample": {"name": "T", "phone": "9000000333"}})
    say("PASS" if st == 202 and seen and tried[0] == 200 and tried[1].get("stored") is False else "FAIL", "5 lead through a lead address", f"intake HTTP {st}, activity row seen={seen} ({outcome}), test lead HTTP {tried[0]}")


def check_describe(run: Run) -> None:
    st, out = run.call("POST", f"{run.t}/jobs/describe", {"text": "Call every new customer within ten minutes and thank them on WhatsApp", "language": "en"})
    if st == 404:
        return say("SKIP", "6 describe the job", "JOBS is off on this API")
    if st == 503:
        return say("PASS", "6 describe the job", "no model on this API (503 describe_unavailable): the route and its refusal work")
    ok = st == 200 and isinstance(out, dict) and {"understood", "fields", "unclear", "nearest"} <= set(out)
    say("PASS" if ok else "FAIL", "6 describe the job", f"HTTP {st}, understood={out.get('understood') if isinstance(out, dict) else '?'}, fields={len(out.get('fields', [])) if isinstance(out, dict) else '?'}")


def check_lines(run: Run) -> None:
    st, out = run.call("GET", f"{run.t}/phone-lines")
    say("PASS" if st == 200 and isinstance(out, dict) and {"total", "in_use", "lines"} <= set(out) else "FAIL", "7 phone-lines read", f"HTTP {st}")


def check_developer_api(run: Run) -> None:
    st, made = run.call("POST", f"{run.t}/developer/keys", {"name": "Smoke key", "scopes": ["leads:write", "leads:read", "calls:write", "calls:read"]})
    if st == 404:
        return say("SKIP", "8 developer API dry run", "DEVELOPER_API is off on this API")
    if st == 422 and code_of(made) == "invalid_value":
        return say("SKIP", "8 developer API dry run", "the database does not have migration 992100 yet (the new key scopes are refused)")
    if st != 201 or not isinstance(made, dict) or "secret" not in made:
        return say("FAIL", "8 developer API dry run", f"make key: HTTP {st} {code_of(made)}")
    secret, key_id = made["secret"], made["key"]["id"]
    try:
        auth = {"Authorization": f"Bearer {secret}", "Content-Type": "application/json", "Idempotency-Key": "smoke-" + uuid.uuid4().hex}
        consent = {"given": True, "text": "I agree to be called about my enquiry", "at": "2026-11-25T10:00:00+00:00"}
        st, lead = raw_post(f"{run.api}/api/v1/leads", json.dumps({"name": "Smoke API Lead", "phone": "+9198000" + str(10000 + uuid.uuid4().int % 89999), "source": "smoke", "consent": consent}).encode(), auth)
        lead_id = (lead or {}).get("lead", {}).get("id") if isinstance(lead, dict) else None
        if st not in (200, 201) or not lead_id:
            return say("FAIL", "8 developer API dry run", f"post lead: HTTP {st} {code_of(lead)}")
        auth["Idempotency-Key"] = "smoke-" + uuid.uuid4().hex
        st, dry = raw_post(f"{run.api}/api/v1/calls", json.dumps({"lead_id": lead_id, "dry_run": True}).encode(), auth)
        ok = st == 200 and isinstance(dry, dict) and dry.get("dry_run") is True and isinstance(dry.get("gates"), list)
        say("PASS" if ok else "FAIL", "8 developer API dry run", f"HTTP {st}, would_place={dry.get('would_place') if isinstance(dry, dict) else '?'}, blocked_by={dry.get('blocked_by') if isinstance(dry, dict) else '?'}")
    finally:
        run.call("POST", f"{run.t}/developer/keys/{key_id}/revoke")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--api-url", default="http://localhost:8000")
    p.add_argument("--pack", default="textiles")
    p.add_argument("--i-know-this-is-staging", action="store_true")
    p.add_argument("--open-signup", action="store_true")
    a = p.parse_args()
    if not a.i_know_this_is_staging:
        print("refusing: pass --i-know-this-is-staging (this signs in to the STAGING project)")
        return 2
    run = Run(a.api_url, a.pack)
    opened = False
    try:
        if a.open_signup:
            opened = open_signup(True)
            print(("opened" if opened else "could not open") + " the sign-up switch on staging for this run")
        for name, fn in (("signup", lambda: check_signup(run, opened)), ("razorpay", lambda: check_razorpay(run)), ("lead", lambda: check_lead_address(run)), ("describe", lambda: check_describe(run)), ("lines", lambda: check_lines(run)), ("devapi", lambda: check_developer_api(run))):
            try:
                fn()
            except Exception as exc:  # noqa: BLE001 - one broken check never hides the others; only the class is printed
                say("FAIL", name, f"crashed: {exc.__class__.__name__}")
    finally:
        if opened:
            open_signup(False)
    print(f"\n{RESULTS.count('PASS')} PASS, {RESULTS.count('FAIL')} FAIL, {RESULTS.count('SKIP')} SKIP")
    return 1 if "FAIL" in RESULTS else 0


if __name__ == "__main__":
    sys.exit(main())
