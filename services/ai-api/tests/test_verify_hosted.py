"""scripts/verify_hosted.py: read-only by construction, fails closed, and never prints a key or a
connection string. The hosted checks run against an in-memory transport (no network)."""

from __future__ import annotations

import importlib.util
import re
import sys
from pathlib import Path
from typing import Any

import httpx
import pytest

SPEC = importlib.util.spec_from_file_location(
    "verify_hosted", Path(__file__).resolve().parents[3] / "scripts" / "verify_hosted.py"
)
assert SPEC and SPEC.loader
vh = importlib.util.module_from_spec(SPEC)
sys.modules["verify_hosted"] = vh
SPEC.loader.exec_module(vh)

SUPA, API, WEB = "https://abc.supabase.co", "https://api.example.app", "https://app.example.app"
ANON = "ANON-KEY-CANARY-8841"
ENV = {
    "HOSTED_SUPABASE_URL": SUPA,
    "HOSTED_SUPABASE_ANON_KEY": ANON,
    "HOSTED_API_URL": API,
    "HOSTED_WEB_ORIGIN": WEB,
}


GOOD_WEB_HEADERS = {
    "content-security-policy": (
        "default-src 'self'; script-src 'self' 'nonce-abc' 'strict-dynamic'; "
        "style-src 'self' 'nonce-abc'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"
    ),
    "strict-transport-security": "max-age=63072000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=()",
    "x-frame-options": "DENY",
}


class Hosted:
    """A fake deployment; flip an attribute to break one thing."""

    def __init__(self, **over: Any) -> None:
        self.settings: dict[str, Any] = {
            "disable_signup": True,
            "mailer_autoconfirm": False,
            "external": {"email": True, "google": False},
        }
        self.anon_rows = False
        self.schema_status = 406
        self.api_environment = "production"
        self.me_status = 401
        self.cors_ok = True
        self.cors_star = False
        self.rest_doc = "{}"
        self.methods: list[str] = []
        self.web_headers: dict[str, str] = dict(GOOD_WEB_HEADERS)
        self.web_status = 200
        self.__dict__.update(over)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.methods.append(request.method)
        url = str(request.url)
        if url.startswith(f"{SUPA}/auth/v1/settings"):
            return httpx.Response(200, json=self.settings)
        if (
            url.startswith(f"{SUPA}/rest/v1/tenants?limit=1")
            and "accept-profile" in request.headers
        ):
            return httpx.Response(self.schema_status, json={})
        if url.startswith(f"{SUPA}/rest/v1/?") or url == f"{SUPA}/rest/v1/":
            return httpx.Response(200, text=self.rest_doc)
        if url.startswith(f"{SUPA}/rest/v1/"):
            return httpx.Response(200, json=[{"id": "x"}] if self.anon_rows else [])
        if url == f"{API}/health":
            return httpx.Response(200, json={"status": "ok", "environment": self.api_environment})
        if url == f"{API}/v1/me" and request.method == "GET":
            return httpx.Response(self.me_status, json={})
        if url == f"{API}/v1/me" and request.method == "OPTIONS":
            origin = request.headers.get("origin")
            if self.cors_star:
                return httpx.Response(200, headers={"access-control-allow-origin": "*"})
            if origin == WEB and self.cors_ok or origin != WEB and not self.cors_ok:
                return httpx.Response(200, headers={"access-control-allow-origin": origin or ""})
            return httpx.Response(400)
        if url == f"{WEB}/login":
            return httpx.Response(self.web_status, headers=self.web_headers)
        if url == f"{API}/docs":
            return httpx.Response(404)
        return httpx.Response(404)


def go(hosted: Hosted, env: dict[str, str] | None = None) -> int:
    with httpx.Client(transport=httpx.MockTransport(hosted)) as client:
        return int(vh.run(env if env is not None else dict(ENV), client))


def test_a_correct_deployment_passes_and_sends_only_read_methods(
    capsys: pytest.CaptureFixture[str],
) -> None:
    hosted = Hosted()
    assert go(hosted) == 0
    assert set(hosted.methods) <= {"GET", "OPTIONS", "HEAD"}, hosted.methods
    out = capsys.readouterr().out
    assert "ALL CHECKS PASSED" in out and "FAIL" not in out.replace("FAILED", "")


@pytest.mark.parametrize(
    "over",
    [
        {"settings": {"disable_signup": False, "mailer_autoconfirm": False, "external": {}}},
        {"settings": {"disable_signup": True, "mailer_autoconfirm": True, "external": {}}},
        {
            "settings": {
                "disable_signup": True,
                "mailer_autoconfirm": False,
                "external": {"google": True},
            }
        },
        {
            "settings": {
                "disable_signup": True,
                "mailer_autoconfirm": False,
                "external": {"phone": True},
            }
        },
        {"anon_rows": True},
        {"schema_status": 200},
        {"rest_doc": '{"paths": {"/rpc/operator_open_real_data_gate": {}}}'},
        {"api_environment": "development"},
        {"me_status": 200},
        {"cors_ok": False},
        {"cors_star": True},
        {"web_status": 500},
        {
            "web_headers": {
                **GOOD_WEB_HEADERS,
                "content-security-policy": GOOD_WEB_HEADERS["content-security-policy"].replace(
                    "'strict-dynamic'", "'strict-dynamic' 'unsafe-eval'"
                ),
            }
        },
        {
            "web_headers": {
                **GOOD_WEB_HEADERS,
                "content-security-policy": GOOD_WEB_HEADERS["content-security-policy"].replace(
                    "; frame-ancestors 'none'", ""
                ),
            }
        },
        {"web_headers": {**GOOD_WEB_HEADERS, "strict-transport-security": "max-age=300"}},
        {"web_headers": {**GOOD_WEB_HEADERS, "strict-transport-security": "max-age=63072000"}},
        {
            "web_headers": {
                k: v for k, v in GOOD_WEB_HEADERS.items() if k != "x-content-type-options"
            }
        },
        {"web_headers": {**GOOD_WEB_HEADERS, "referrer-policy": "unsafe-url"}},
        {"web_headers": {k: v for k, v in GOOD_WEB_HEADERS.items() if k != "permissions-policy"}},
        {"web_headers": {**GOOD_WEB_HEADERS, "x-frame-options": "SAMEORIGIN"}},
        {"web_headers": {**GOOD_WEB_HEADERS, "x-powered-by": "Next.js"}},
    ],
)
def test_each_misconfiguration_is_a_failure(
    over: dict[str, Any], capsys: pytest.CaptureFixture[str]
) -> None:
    assert go(Hosted(**over)) == 1, over
    assert "FAIL" in capsys.readouterr().out


def test_it_fails_closed_when_not_configured_or_not_https(
    capsys: pytest.CaptureFixture[str],
) -> None:
    assert go(Hosted(), {}) == 2
    assert go(Hosted(), {**ENV, "HOSTED_API_URL": "http://api.example.app"}) == 2
    assert go(Hosted(), {**ENV, "HOSTED_SUPABASE_URL": "http://127.0.0.1:54321"}) == 2
    assert "not configured" in capsys.readouterr().out


def test_no_key_and_no_connection_string_is_ever_printed(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv(
        "HOSTED_DATABASE_URL",
        "postgresql://postgres:DB-PASSWORD-CANARY@db.abc.supabase.co:5432/postgres",
    )
    monkeypatch.setattr(vh.shutil, "which", lambda _: None)
    go(Hosted(settings={"disable_signup": False, "mailer_autoconfirm": True, "external": {}}))
    out = capsys.readouterr().out
    assert ANON not in out and "DB-PASSWORD-CANARY" not in out and "db.abc.supabase.co" not in out


def test_the_database_connection_goes_through_the_environment_and_is_read_only() -> None:
    env = vh.psql_environment(
        "postgresql://postgres:p%40ss@db.abc.supabase.co:6543/postgres", {"PATH": "/bin"}
    )
    assert (
        env["PGHOST"] == "db.abc.supabase.co"
        and env["PGPORT"] == "6543"
        and env["PGUSER"] == "postgres"
    )
    assert (
        env["PGPASSWORD"] == "p@ss"
        and env["PGDATABASE"] == "postgres"
        and env["PGSSLMODE"] == "require"
    )
    assert "default_transaction_read_only=on" in env["PGOPTIONS"]


def test_without_a_database_url_the_sql_check_is_skipped_with_instructions(
    capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("HOSTED_DATABASE_URL", raising=False)
    assert go(Hosted()) == 0
    assert "SKIP" in capsys.readouterr().out


def test_the_sql_file_contains_no_statement_that_writes() -> None:
    sql = vh.SQL_FILE.read_text().lower()
    code = "\n".join(line for line in sql.splitlines() if not line.strip().startswith("--"))
    code = re.sub(
        r"'(?:[^']|'')*'", "''", code
    )  # words inside string literals are text, not statements
    for word in (
        "insert ",
        "update ",
        "delete ",
        "drop ",
        "alter ",
        "create ",
        "grant ",
        "revoke ",
        "truncate ",
        "set role",
        "copy ",
    ):
        assert word not in code, word
    assert code.lstrip().startswith("with")
