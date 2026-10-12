"""Job CE: scripts/hosted_smoke.py (`make hosted-smoke`) against an in-memory deployment (no network). A good deployment passes; each thing a real deployment can get wrong fails the one check that names it; the script
sends nothing but GET and OPTIONS (and the one sign-in POST to Supabase when asked), and prints no password, token or key."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path
from typing import Any

import httpx
import pytest

SPEC = importlib.util.spec_from_file_location("hosted_smoke", Path(__file__).resolve().parents[3] / "scripts" / "hosted_smoke.py")
assert SPEC and SPEC.loader
hs = importlib.util.module_from_spec(SPEC)
sys.modules["hosted_smoke"] = hs
SPEC.loader.exec_module(hs)

WEB, API, SUPA = "https://app.example.test", "https://api.example.test", "https://abc.supabase.co"
TENANT = "11111111-1111-4111-8111-111111111111"
PASSWORD, TOKEN, KEY = "pw-CANARY-77123", "token-CANARY-55021", "publishable-CANARY-90417"
CSP = "default-src 'self'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'nonce-x'"
ERROR = {"error": {"code": "unauthorized", "message": "Sign in.", "retry_after": None, "request_id": "r-1"}}


class Deployment:
    """A fake deployment; set an attribute to break one thing."""

    def __init__(self, **over: Any) -> None:
        self.login_status = 200
        self.csp = CSP
        self.powered_by = False
        self.redirect_to = f"{WEB}/login?next=%2Fapp"
        self.session_cookie: str | None = None
        self.environment = "production"
        self.ready = 200
        self.docs = 404
        self.metrics = 404
        self.api_cookie = False
        self.cors_own: str | None = None
        self.cors_any: str | None = None
        self.error_body: dict[str, Any] = ERROR
        self.worker_running = True
        self.sign_in_status = 200
        self.me_memberships: list[dict[str, Any]] = [{"tenant": {"id": TENANT}, "role": "owner"}]
        self.scheduler_status = 200
        self.requests: list[tuple[str, str]] = []
        self.sign_in_body: dict[str, Any] | None = None
        self.__dict__.update(over)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append((request.method, str(request.url)))
        host, path = request.url.host, request.url.path
        if host == "abc.supabase.co":
            self.sign_in_body = httpx.Response(200, content=request.content).json() if request.content else None
            return httpx.Response(self.sign_in_status, json={"access_token": TOKEN} if self.sign_in_status == 200 else {"error": "invalid"})
        if host == "app.example.test":
            if path == "/login":
                headers = {"content-type": "text/html; charset=utf-8", "content-security-policy": self.csp, "x-content-type-options": "nosniff", "strict-transport-security": "max-age=63072000"}
                if self.powered_by:
                    headers["x-powered-by"] = "Next.js"
                if self.session_cookie:
                    headers["set-cookie"] = self.session_cookie
                return httpx.Response(self.login_status, headers=headers, text='<form><input type="password" name="password"></form>')
            if path == "/app":
                return httpx.Response(307, headers={"location": self.redirect_to})
        if host == "api.example.test":
            auth = request.headers.get("authorization")
            if request.method == "OPTIONS":
                origin = request.headers.get("origin", "")
                allow = self.cors_own if origin == WEB else self.cors_any
                return httpx.Response(200, headers={"access-control-allow-origin": allow} if allow else {})
            if path == "/health":
                return httpx.Response(200, json={"status": "ok", "service": "api", "version": "1", "environment": self.environment})
            if path == "/ready":
                return httpx.Response(self.ready, json={"status": "ready", "checks": {"auth": "ok", "database": "ok"}})
            if path in ("/docs", "/redoc", "/openapi.json"):
                return httpx.Response(self.docs, text="")
            if path == "/metrics":
                return httpx.Response(self.metrics, text="")
            if path == "/v1/me":
                if auth == f"Bearer {TOKEN}":
                    return httpx.Response(200, json={"user_id": TENANT, "memberships": self.me_memberships})
                headers = {"x-request-id": "r-1"}
                if self.api_cookie:
                    headers["set-cookie"] = "a=b"
                return httpx.Response(401, json=self.error_body, headers=headers)
            if path == f"/v1/tenants/{TENANT}/scheduler/status" and auth == f"Bearer {TOKEN}":
                body = {"worker_running": self.worker_running, "last_run_at": "2026-10-12T10:00:00Z", "interval_seconds": 300, "platform_switch_on": False, "auto_send_enabled": False}
                return httpx.Response(self.scheduler_status, json=body)
        return httpx.Response(404, text="")


def run(dep: Deployment, env: dict[str, str] | None = None) -> Any:
    client = httpx.Client(transport=httpx.MockTransport(dep), follow_redirects=True)
    return hs.run(WEB, API, allow_http=False, env=env or {}, client=client, password_prompt=lambda _: PASSWORD)


def statuses(report: Any) -> dict[str, str]:
    return {name: status for status, name, _ in report.lines}


SIGNED_IN = {"SMOKE_EMAIL": "owner@example.test", "SMOKE_SUPABASE_URL": SUPA, "SMOKE_SUPABASE_PUBLISHABLE_KEY": KEY}


def test_a_good_deployment_passes_every_check_and_skips_only_the_scheduler_without_a_login() -> None:
    report = run(Deployment())
    assert not report.failed, report.lines
    skipped = [name for status, name, _ in report.lines if status == "SKIP"]
    assert skipped == ["scheduler status"]


def test_signed_in_the_scheduler_is_checked() -> None:
    dep = Deployment()
    report = run(dep, SIGNED_IN)
    assert not report.failed, report.lines
    assert statuses(report)["the scheduler worker has ticked recently"] == "PASS"


@pytest.mark.parametrize(
    ("over", "failing"),
    [
        ({"login_status": 502}, "the login page answers 200"),
        ({"csp": ""}, "Content-Security-Policy is set"),
        ({"powered_by": True}, "the framework is not advertised (no X-Powered-By)"),
        ({"redirect_to": "https://sme-web-abc-el.a.run.app/login?next=%2Fapp"}, "a signed-out visit to /app is sent to /login on the SAME host (the Host header reaches the app unchanged)"),
        ({"redirect_to": f"{WEB}/somewhere-else"}, "a signed-out visit to /app is sent to /login on the SAME host (the Host header reaches the app unchanged)"),
        ({"session_cookie": "sb-abc-auth-token=1; Path=/; Domain=example.test; HttpOnly; Secure"}, "the session cookie is host-only (no Domain attribute)"),
        ({"session_cookie": "sb-abc-auth-token=1; Path=/; Secure"}, "the session cookie is HttpOnly"),
        ({"session_cookie": "sb-abc-auth-token=1; Path=/; HttpOnly"}, "the session cookie is Secure"),
        ({"environment": "development"}, "the API is not in development mode"),
        ({"ready": 503}, "API /ready: the database answers"),
        ({"docs": 200}, "/docs is not served"),
        ({"metrics": 200}, "/metrics is not served"),
        ({"error_body": {"detail": "Not authenticated"}}, "and the refusal has the one error shape (code, message, retry_after, request_id)"),
        ({"api_cookie": True}, "the API sets no cookie"),
        ({"cors_own": "*"}, "CORS allows at most the web's own origin (never '*')"),
        ({"cors_any": "https://evil.example.invalid"}, "CORS refuses any other origin"),
    ],
)
def test_each_thing_a_deployment_can_get_wrong_fails_the_check_that_names_it(over: dict[str, Any], failing: str) -> None:
    report = run(Deployment(**over))
    assert statuses(report)[failing] == "FAIL"
    assert report.failed


def test_the_cors_origin_of_the_web_itself_is_accepted() -> None:
    assert not run(Deployment(cors_own=WEB)).failed


def test_a_stopped_worker_fails_and_says_how_to_run_it_once() -> None:
    report = run(Deployment(worker_running=False), SIGNED_IN)
    (line,) = [x for x in report.lines if x[1] == "the scheduler worker has ticked recently"]
    assert line[0] == "FAIL" and "gcloud run jobs execute sme-worker" in line[2] and "WORKER_EVERY_MINUTES" in line[2]


def test_a_refused_sign_in_a_missing_key_and_a_non_owner_each_fail_plainly() -> None:
    assert statuses(run(Deployment(sign_in_status=400), SIGNED_IN))["sign in to read the scheduler status"] == "FAIL"
    assert statuses(run(Deployment(), {"SMOKE_EMAIL": "x@example.test"}))["scheduler status"] == "FAIL"
    assert statuses(run(Deployment(scheduler_status=403), SIGNED_IN))["scheduler status"] == "FAIL"
    assert statuses(run(Deployment(me_memberships=[]), SIGNED_IN))["one signed-in API call: who am I, and in which workspaces"] == "FAIL"


def test_smoke_tenant_picks_the_workspace_and_an_unknown_one_fails() -> None:
    assert not run(Deployment(), {**SIGNED_IN, "SMOKE_TENANT": TENANT}).failed
    assert statuses(run(Deployment(), {**SIGNED_IN, "SMOKE_TENANT": "22222222-2222-4222-8222-222222222222"}))["the workspace to check"] == "FAIL"


def test_only_get_and_options_are_sent_and_the_one_post_goes_to_supabase_only() -> None:
    dep = Deployment()
    run(dep, SIGNED_IN)
    assert {m for m, _ in dep.requests} == {"GET", "OPTIONS", "POST"}
    assert [u for m, u in dep.requests if m == "POST"] == [f"{SUPA}/auth/v1/token?grant_type=password"]
    assert dep.sign_in_body == {"email": "owner@example.test", "password": PASSWORD}


def test_no_password_token_or_key_is_printed(capsys: pytest.CaptureFixture[str]) -> None:
    report = run(Deployment(), SIGNED_IN)
    out = capsys.readouterr().out + repr(report.lines)
    for secret in (PASSWORD, TOKEN, KEY):
        assert secret not in out


def test_a_hosted_address_must_be_https_unless_told_otherwise() -> None:
    client = httpx.Client(transport=httpx.MockTransport(Deployment()))
    report = hs.run("http://app.example.test", API, allow_http=False, env={}, client=client)
    assert report.lines[0][:2] == ("FAIL", "the web address is https") and len(report.lines) == 1
    assert hs.main(["--web", "ftp://x.example.test"]) == 2


def test_an_unreachable_web_is_one_clear_failure_not_a_crash() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused")

    report = hs.run(WEB, API, allow_http=False, env={}, client=httpx.Client(transport=httpx.MockTransport(down)))
    assert statuses(report)["the web answers"] == "FAIL" and statuses(report)["the API answers"] == "FAIL"
