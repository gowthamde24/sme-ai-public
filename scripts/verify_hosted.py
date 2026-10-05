"""READ-ONLY verification of a hosted deployment (T006b M2, ADR 0015). Run it from your laptop after a deploy and before opening the
real-data gate. It never writes: it sends only GET and OPTIONS requests (a test proves that), and its one database step runs the SELECT-only
supabase/hosted/verify.sql with default_transaction_read_only forced on.

Everything comes from the environment YOU set for this run (never from a .env file, never from the repository):

  HOSTED_SUPABASE_URL        https://<ref>.supabase.co                  (public)
  HOSTED_SUPABASE_ANON_KEY   the project's public anon / publishable key (public)
  HOSTED_API_URL             https://<your API>                         (public)
  HOSTED_WEB_ORIGIN          https://<your web app>                     (the ONLY origin the API may allow)
  HOSTED_DATABASE_URL        optional: a postgres:// URL as the postgres role. Without it (or without psql) the script prints how to
                             run supabase/hosted/verify.sql in the SQL editor instead. The URL is never printed.

    python scripts/verify_hosted.py            # exit 0 = every check passed; 1 = at least one FAIL; 2 = not configured

Checks (PASS / FAIL / INFO / SKIP): sign-up closed and e-mail confirmation on; anon reads nothing and cannot see private schemas; the API is
up, refuses an anonymous call, and allows CORS from the web origin only (never "*"); and the database checks of verify.sql.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import unquote, urlparse

import httpx

ROOT = Path(__file__).resolve().parents[1]
SQL_FILE = ROOT / "supabase" / "hosted" / "verify.sql"
SAFE_METHODS = {"GET", "OPTIONS", "HEAD"}


@dataclass
class Report:
    lines: list[tuple[str, str, str]] = field(default_factory=list)

    def add(self, status: str, name: str, detail: str = "") -> None:
        self.lines.append((status, name, detail))
        print(f"{status:5} {name}" + (f" :: {detail}" if detail else ""))

    @property
    def failed(self) -> bool:
        return any(status == "FAIL" for status, _, _ in self.lines)


def _is_https(url: str) -> bool:
    return url.startswith("https://")


def check_auth_settings(
    client: httpx.Client, supabase_url: str, anon_key: str, report: Report
) -> None:
    r = client.get(f"{supabase_url}/auth/v1/settings", headers={"apikey": anon_key})
    if r.status_code != 200:
        report.add("FAIL", "auth settings readable", f"HTTP {r.status_code}")
        return
    body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
    report.add(
        "PASS" if body.get("disable_signup") is True else "FAIL",
        "open sign-up is OFF",
        f"disable_signup = {body.get('disable_signup')!r}",
    )
    report.add(
        "PASS" if body.get("mailer_autoconfirm") is False else "FAIL",
        "e-mail confirmation is ON",
        f"mailer_autoconfirm = {body.get('mailer_autoconfirm')!r}",
    )
    external = body.get("external") or {}
    enabled = sorted(k for k, v in external.items() if v is True and k not in ("email",))
    report.add(
        "PASS" if not enabled else "FAIL",
        "no social / phone sign-in providers enabled",
        ", ".join(enabled) or "only e-mail",
    )
    if body.get("sms_provider") or external.get("phone") is True:
        report.add("FAIL", "phone sign-in is off", "enabled")


def check_anon_surface(
    client: httpx.Client, supabase_url: str, anon_key: str, report: Report
) -> None:
    h = {"apikey": anon_key, "Authorization": f"Bearer {anon_key}"}
    for table in ("tenants", "contacts", "audit_events", "erasure_requests", "tenant_data_policy"):
        r = client.get(f"{supabase_url}/rest/v1/{table}?select=*&limit=1", headers=h)
        rows = r.json() if r.status_code == 200 and isinstance(r.json(), list) else None
        ok = r.status_code in (401, 403, 404) or rows == []
        report.add(
            "PASS" if ok else "FAIL",
            f"anon reads nothing from {table}",
            f"HTTP {r.status_code}" + (f", {len(rows)} rows" if rows else ""),
        )
    for schema in ("app", "auth", "erasure"):
        r = client.get(
            f"{supabase_url}/rest/v1/tenants?limit=1", headers={**h, "Accept-Profile": schema}
        )
        report.add(
            "PASS" if r.status_code == 406 else "FAIL",
            f"schema {schema} is not exposed",
            f"HTTP {r.status_code}",
        )
    doc = client.get(f"{supabase_url}/rest/v1/", headers=h)
    leaked = [
        name
        for name in (
            "operator_open_real_data_gate",
            "operator_add_member",
            "execute_erasure_internal",
            "erasure.registry",
        )
        if name in doc.text
    ]
    report.add(
        "PASS" if not leaked else "FAIL",
        "the API description lists no private objects",
        ", ".join(leaked) or "clean",
    )


def check_api(client: httpx.Client, api_url: str, web_origin: str, report: Report) -> None:
    r = client.get(f"{api_url}/health")
    report.add(
        "PASS" if r.status_code == 200 and r.json().get("status") == "ok" else "FAIL",
        "API /health",
        f"HTTP {r.status_code}",
    )
    if r.status_code == 200:
        env = r.json().get("environment")
        report.add(
            "PASS" if env not in (None, "development") else "FAIL",
            "API runs outside development mode",
            f"environment = {env!r}",
        )
    anon = client.get(f"{api_url}/v1/me")
    report.add(
        "PASS" if anon.status_code == 401 else "FAIL",
        "API refuses an anonymous call",
        f"HTTP {anon.status_code}",
    )
    pre = client.options(
        f"{api_url}/v1/me",
        headers={
            "Origin": web_origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    allowed = pre.headers.get("access-control-allow-origin")
    report.add(
        "PASS" if allowed == web_origin else "FAIL",
        "CORS allows the web origin",
        f"allow-origin = {allowed!r}",
    )
    evil = client.options(
        f"{api_url}/v1/me",
        headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "GET"},
    )
    got = evil.headers.get("access-control-allow-origin")
    report.add(
        "PASS" if got in (None, "") else "FAIL",
        "CORS refuses another origin (and is never '*')",
        f"allow-origin = {got!r}",
    )
    docs = client.get(f"{api_url}/docs")
    report.add(
        "INFO",
        "API documentation page",
        f"HTTP {docs.status_code} ({'public' if docs.status_code == 200 else 'not served'})",
    )


def psql_environment(url: str, base: dict[str, str]) -> dict[str, str]:
    """The connection goes to psql through PG* variables, never on its command line (a command line is visible to every process on the
    machine), and the session is read-only whatever the SQL says."""
    u = urlparse(url)
    env = {
        **base,
        "PGOPTIONS": "-c default_transaction_read_only=on",
        "PGSSLMODE": "require",
        "PGCONNECT_TIMEOUT": "15",
    }
    if u.hostname:
        env["PGHOST"] = u.hostname
    if u.port:
        env["PGPORT"] = str(u.port)
    if u.username:
        env["PGUSER"] = unquote(u.username)
    if u.password:
        env["PGPASSWORD"] = unquote(u.password)
    if u.path and u.path != "/":
        env["PGDATABASE"] = unquote(u.path.lstrip("/"))
    return env


def check_database(report: Report) -> None:
    url = os.environ.get("HOSTED_DATABASE_URL", "")
    psql = shutil.which("psql")
    if not url or not psql:
        report.add(
            "SKIP",
            "database checks",
            f"run {SQL_FILE.relative_to(ROOT)} in the Supabase SQL editor as postgres; every row must be ok = true",
        )
        return
    result = subprocess.run(  # noqa: S603 - fixed argv, our own SQL file; connection and read-only mode travel in the environment
        [psql, "-X", "-A", "-t", "-F", "\t", "-v", "ON_ERROR_STOP=1", "-f", str(SQL_FILE)],
        env=psql_environment(url, dict(os.environ)),
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if result.returncode != 0:
        report.add(
            "FAIL", "database checks ran", "psql failed (the connection details are not shown)"
        )
        return
    for line in result.stdout.splitlines():
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        name, ok, detail = parts
        report.add("INFO" if ok == "" else ("PASS" if ok == "t" else "FAIL"), name, detail)


def run(env: dict[str, str] | None = None, client: httpx.Client | None = None) -> int:
    env = env if env is not None else dict(os.environ)
    needed = [
        "HOSTED_SUPABASE_URL",
        "HOSTED_SUPABASE_ANON_KEY",
        "HOSTED_API_URL",
        "HOSTED_WEB_ORIGIN",
    ]
    missing = [k for k in needed if not env.get(k)]
    if missing:
        print(
            "verify_hosted: not configured. Set "
            + ", ".join(missing)
            + " (see the top of this file)."
        )
        return 2
    supabase_url, api_url = (
        env["HOSTED_SUPABASE_URL"].rstrip("/"),
        env["HOSTED_API_URL"].rstrip("/"),
    )
    web_origin, anon_key = env["HOSTED_WEB_ORIGIN"].rstrip("/"), env["HOSTED_SUPABASE_ANON_KEY"]
    insecure = [u for u in (supabase_url, api_url, web_origin) if not _is_https(u)]
    if insecure:
        print(
            "verify_hosted: refusing a URL that is not https (this script is for a hosted deployment)."
        )
        return 2
    report = Report()
    c = client or httpx.Client(timeout=20, follow_redirects=False)
    try:
        check_auth_settings(c, supabase_url, anon_key, report)
        check_anon_surface(c, supabase_url, anon_key, report)
        check_api(c, api_url, web_origin, report)
    finally:
        if client is None:
            c.close()
    check_database(report)
    print("\nRESULT:", "FAIL" if report.failed else "ALL CHECKS PASSED")
    return 1 if report.failed else 0


if __name__ == "__main__":
    sys.exit(run())
