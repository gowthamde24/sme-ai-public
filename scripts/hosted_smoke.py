"""A smoke test of a RUNNING deployment (job CE, ADR 0072): `make hosted-smoke URL=https://app.example.com API_URL=https://api.example.com`.

It answers one question after a deploy: does it work, as the shop will use it? It is the quick companion of `scripts/verify_hosted.py` (which audits the Supabase settings and the database). It sends only
GET and OPTIONS requests to YOUR web and API addresses, and one POST: the sign-in to Supabase, if you ask for the scheduler check. It writes nothing, creates nothing, and prints no token, key or password.

  --web URL       the web address the browser uses (https). Required.
  --api URL       the API address (https). Default: the same address as the web (use it when one address serves both).
  --allow-http    permit http:// addresses (for a deployment on this machine only; a hosted one must be https)

The scheduler check needs a person to sign in (the status is the Owner's or an Admin's to read). It is switched on by SMOKE_EMAIL; the password is typed hidden (or given in SMOKE_PASSWORD for one run, never
saved), with SMOKE_SUPABASE_URL and SMOKE_SUPABASE_PUBLISHABLE_KEY (both public). SMOKE_TENANT (a workspace id) picks the workspace; the first one is used otherwise. Without SMOKE_EMAIL that one check is SKIPPED
and says how to switch it on; every other check still runs.

Checks (PASS / FAIL / INFO / SKIP). Exit 0 = no FAIL; 1 = at least one FAIL; 2 = not configured.
  web   the login page answers 200 (and how long the first request took: a cold start shows here); the security headers; the framework is not advertised;
        THE HOST HEADER: an address that needs a sign-in redirects to the SAME public host (a proxy that rewrites the Host header sends the browser to the internal address instead);
        the session cookie, if any is set, is host-only (no Domain), HttpOnly and Secure
  api   /health says ok and not "development"; /ready says the database answers; the interactive documentation and /metrics are not served; an anonymous call is a 401 in the one error shape with a request id;
        no cookie is set; CORS allows at most the web's own origin and never "*"
  scheduler  signed in: the worker's last tick is recent (worker_running), with its age and interval
"""

from __future__ import annotations

import argparse
import getpass
import os
import re
import sys
import time
from dataclasses import dataclass, field
from urllib.parse import urlparse

import httpx

TIMEOUT = httpx.Timeout(30.0, connect=10.0)
EVIL_ORIGIN = "https://evil.example.invalid"


@dataclass
class Report:
    lines: list[tuple[str, str, str]] = field(default_factory=list)

    def add(self, status: str, name: str, detail: str = "") -> None:
        self.lines.append((status, name, detail))
        print(f"{status:5} {name}" + (f" :: {detail}" if detail else ""))

    @property
    def failed(self) -> bool:
        return any(status == "FAIL" for status, _, _ in self.lines)


def origin_of(url: str) -> str:
    p = urlparse(url)
    return f"{p.scheme}://{p.netloc}"


def _verdict(ok: bool) -> str:
    return "PASS" if ok else "FAIL"


def check_web(client: httpx.Client, web: str, report: Report) -> None:
    started = time.monotonic()
    try:
        login = client.get(f"{web}/login")
    except httpx.HTTPError as exc:
        report.add("FAIL", "the web answers", exc.__class__.__name__)
        return
    seconds = time.monotonic() - started
    report.add(_verdict(login.status_code == 200), "the login page answers 200", f"HTTP {login.status_code}")
    report.add("INFO", "time to answer the first request", f"{seconds:.1f} s (after idle time this is the cold start)")
    html = login.headers.get("content-type", "").startswith("text/html")
    report.add(_verdict(html and re.search(r"(?i)<form|type=\"password\"|name=\"password\"", login.text) is not None), "it is the sign-in form", "html with a form" if html else "not html")

    headers = login.headers
    csp = headers.get("content-security-policy", "")
    report.add(_verdict("frame-ancestors 'none'" in csp and "object-src 'none'" in csp), "Content-Security-Policy is set", "present" if csp else "missing")
    report.add(_verdict(headers.get("x-content-type-options", "").lower() == "nosniff"), "X-Content-Type-Options: nosniff")
    if web.startswith("https://"):
        report.add(_verdict("max-age=" in headers.get("strict-transport-security", "")), "Strict-Transport-Security is set")
    report.add(_verdict("x-powered-by" not in headers), "the framework is not advertised (no X-Powered-By)")

    # THE HOST HEADER QUESTION (docs/adr/0072): the app builds its redirects from the Host it receives. If a proxy in front rewrote it, the browser is sent to the internal address.
    gate = client.get(f"{web}/app", follow_redirects=False)
    location = gate.headers.get("location", "")
    target = urlparse(location)
    same_host = bool(location) and (target.netloc in ("", urlparse(web).netloc))
    to_login = target.path.startswith("/login")
    report.add(
        _verdict(gate.status_code in (302, 303, 307, 308) and same_host and to_login),
        "a signed-out visit to /app is sent to /login on the SAME host (the Host header reaches the app unchanged)",
        f"HTTP {gate.status_code}, Location host = {target.netloc or '(same host)'}, path = {target.path or '-'}",
    )

    cookies = [value for name, value in gate.headers.multi_items() if name.lower() == "set-cookie"] + [value for name, value in login.headers.multi_items() if name.lower() == "set-cookie"]
    session = [c for c in cookies if re.match(r"\s*sb-", c)]
    if not session:
        report.add("INFO", "session cookie attributes", "no session cookie is set for a visitor who is not signed in (nothing to check)")
    for c in session:
        low = c.lower()
        report.add(_verdict("domain=" not in low), "the session cookie is host-only (no Domain attribute)", c.split("=")[0])
        report.add(_verdict("httponly" in low), "the session cookie is HttpOnly", c.split("=")[0])
        report.add(_verdict(("secure" in low) or not web.startswith("https://")), "the session cookie is Secure", c.split("=")[0])


def check_api(client: httpx.Client, api: str, web_origin: str, report: Report) -> None:
    try:
        health = client.get(f"{api}/health")
    except httpx.HTTPError as exc:
        report.add("FAIL", "the API answers", exc.__class__.__name__)
        return
    body = health.json() if health.headers.get("content-type", "").startswith("application/json") else {}
    report.add(_verdict(health.status_code == 200 and body.get("status") == "ok"), "API /health says ok", f"HTTP {health.status_code}")
    report.add(_verdict(body.get("environment") not in (None, "development")), "the API is not in development mode", f"environment = {body.get('environment')!r}")

    ready = client.get(f"{api}/ready")
    checks = ready.json().get("checks", {}) if ready.headers.get("content-type", "").startswith("application/json") else {}
    report.add(_verdict(ready.status_code == 200), "API /ready: the database answers", f"HTTP {ready.status_code}, checks = {checks}")

    for path in ("/docs", "/redoc", "/openapi.json", "/metrics"):
        r = client.get(f"{api}{path}")
        report.add(_verdict(r.status_code == 404), f"{path} is not served", f"HTTP {r.status_code}")

    anon = client.get(f"{api}/v1/me")
    error = anon.json().get("error", {}) if anon.headers.get("content-type", "").startswith("application/json") and isinstance(anon.json(), dict) else {}
    report.add(_verdict(anon.status_code == 401), "an anonymous API call is refused (401)", f"HTTP {anon.status_code}")
    report.add(
        _verdict({"code", "message", "retry_after", "request_id"} <= set(error) and bool(error.get("request_id"))),
        "and the refusal has the one error shape (code, message, retry_after, request_id)",
        f"code = {error.get('code')!r}",
    )
    report.add(_verdict(bool(anon.headers.get("x-request-id"))), "the API sends a request id header")
    report.add(_verdict("set-cookie" not in anon.headers and "set-cookie" not in health.headers), "the API sets no cookie")

    def preflight(origin: str) -> str | None:
        return client.options(f"{api}/v1/me", headers={"Origin": origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization"}).headers.get("access-control-allow-origin")

    own, evil = preflight(web_origin), preflight(EVIL_ORIGIN)
    report.add(_verdict(own in (None, "", web_origin)), "CORS allows at most the web's own origin (never '*')", f"allow-origin = {own!r}")
    report.add(_verdict(evil in (None, "")), "CORS refuses any other origin", f"allow-origin = {evil!r}")


def sign_in(client: httpx.Client, supabase_url: str, key: str, email: str, password: str) -> str | None:
    r = client.post(f"{supabase_url.rstrip('/')}/auth/v1/token?grant_type=password", headers={"apikey": key}, json={"email": email, "password": password})
    if r.status_code != 200:
        return None
    token = r.json().get("access_token")
    return token if isinstance(token, str) and token else None


def check_scheduler(client: httpx.Client, api: str, env: dict[str, str], report: Report, password_prompt=getpass.getpass) -> None:  # type: ignore[no-untyped-def]
    email = env.get("SMOKE_EMAIL", "")
    if not email:
        report.add("SKIP", "scheduler status", "to include it: SMOKE_EMAIL=<owner e-mail> SMOKE_SUPABASE_URL=https://<ref>.supabase.co SMOKE_SUPABASE_PUBLISHABLE_KEY=<public key> make hosted-smoke ... (the password is asked hidden)")
        return
    supabase, key = env.get("SMOKE_SUPABASE_URL", ""), env.get("SMOKE_SUPABASE_PUBLISHABLE_KEY", "")
    if not supabase or not key:
        report.add("FAIL", "scheduler status", "SMOKE_EMAIL is set but SMOKE_SUPABASE_URL or SMOKE_SUPABASE_PUBLISHABLE_KEY is not")
        return
    password = env.get("SMOKE_PASSWORD") or password_prompt(f"Password for {email} (typed hidden, used once, never saved): ")
    token = sign_in(client, supabase, key, email, password)
    if token is None:
        report.add("FAIL", "sign in to read the scheduler status", "Supabase refused the e-mail and password (or the sign-in is blocked)")
        return
    headers = {"Authorization": f"Bearer {token}"}
    me = client.get(f"{api}/v1/me", headers=headers)
    memberships = me.json().get("memberships", []) if me.status_code == 200 else []
    report.add(_verdict(me.status_code == 200 and bool(memberships)), "one signed-in API call: who am I, and in which workspaces", f"HTTP {me.status_code}, {len(memberships)} workspace(s)")
    if not memberships:
        return
    wanted = env.get("SMOKE_TENANT")
    tenant = next((m for m in memberships if str((m.get("tenant") or {}).get("id")) == wanted), None) if wanted else memberships[0]
    tenant_id = ((tenant or {}).get("tenant") or {}).get("id")
    if not tenant_id:
        report.add("FAIL", "the workspace to check", "SMOKE_TENANT is not one of this person's workspaces")
        return
    status = client.get(f"{api}/v1/tenants/{tenant_id}/scheduler/status", headers=headers)
    if status.status_code != 200:
        report.add("FAIL", "scheduler status", f"HTTP {status.status_code} (the person must be an Owner or Admin of that workspace)")
        return
    s = status.json()
    running = s.get("worker_running") is True
    report.add(
        _verdict(running),
        "the scheduler worker has ticked recently",
        f"last tick {s.get('last_run_at')}, interval {s.get('interval_seconds')} s" + ("" if running else " . Run it once: gcloud run jobs execute sme-worker --region asia-south1 --wait; if it still says stopped, WORKER_EVERY_MINUTES and the job's SCHEDULER_INTERVAL_SECONDS must agree"),
    )
    report.add("INFO", "what the scheduler may do now", f"global switch on = {s.get('platform_switch_on')}, this workspace's automatic sending = {s.get('auto_send_enabled')} (in a rehearsal the global switch stays off: nothing is sent to anyone)")


def run(web: str, api: str | None, *, allow_http: bool, env: dict[str, str], client: httpx.Client | None = None, password_prompt=getpass.getpass) -> Report:  # type: ignore[no-untyped-def]
    report = Report()
    web = web.rstrip("/")
    api = (api or web).rstrip("/")
    own = client or httpx.Client(timeout=TIMEOUT, follow_redirects=True)
    try:
        for name, url in (("web", web), ("api", api)):
            if not allow_http and not url.startswith("https://"):
                report.add("FAIL", f"the {name} address is https", url)
                return report
        check_web(own, web, report)
        check_api(own, api, origin_of(web), report)
        check_scheduler(own, api, env, report, password_prompt)
    finally:
        if client is None:
            own.close()
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Smoke test of a running deployment (read-only).")
    parser.add_argument("--web", required=True)
    parser.add_argument("--api")
    parser.add_argument("--allow-http", action="store_true")
    args = parser.parse_args(argv)
    for url in (args.web, args.api):
        if url and urlparse(url).scheme not in ("http", "https"):
            print("hosted-smoke: an address must start with https://", file=sys.stderr)
            return 2
    print(f"hosted-smoke: web {args.web}  api {args.api or args.web}  (read-only; nothing is created)")
    report = run(args.web, args.api, allow_http=args.allow_http, env=dict(os.environ))
    fails = sum(1 for status, _, _ in report.lines if status == "FAIL")
    passes = sum(1 for status, _, _ in report.lines if status == "PASS")
    print(f"\nhosted-smoke: {passes} passed, {fails} failed" + ("" if not fails else ". Read each FAIL line; the rehearsal runbook says what to look at."))
    return 1 if report.failed else 0


if __name__ == "__main__":
    sys.exit(main())
