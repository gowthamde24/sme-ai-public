"""The rehearsal's tools: a network guard, people (sign-up, second factor), a recorder, and an API caller that behaves like a person at a screen.

The caller sends requests to OUR application (in process, the real app wired to the local stack) with a person's own token. It never decides anything about the
business: it sends what a person would type, and records what came back (status, the fixed error code, the time it took, whether it was a replay).
Everything here is synthetic and local. Nothing is sent to anyone."""

# ruff: noqa: E501, S603, S607, S608

from __future__ import annotations

import base64
import hashlib
import hmac
import ipaddress
import json
import os
import shutil
import socket
import struct
import subprocess
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[2]
STATE_DIR = ROOT / ".rehearsal"
STATE_FILE = STATE_DIR / "state.json"
NAMESPACE = uuid.UUID(
    "5b0c1f6e-0d1e-4c53-9a53-2f4c8f0b7a11"
)  # fixed: the same names give the same ids on every run


ID_SCOPE = ""  # empty for the thin-slice rehearsal (the same ids on every run); the follow-up rehearsal sets one tag per run, so each run is a new workspace with new ids


def rid(*parts: object) -> str:
    """A deterministic id for a thing the driver creates ("enquiry", "E1"): a repeat run sends the very same ids, so every write is a retry."""
    scoped = (ID_SCOPE, *parts) if ID_SCOPE else parts
    return str(uuid.uuid5(NAMESPACE, "/".join(str(p) for p in scoped)))


# ============================================================================ no network but the local stack
class NetworkGuard:
    """Refuses every socket connection that is not to this machine, and counts the ones that are. The in-process app makes none of its own; the stack is 127.0.0.1."""

    def __init__(self) -> None:
        self.local: dict[str, int] = {}
        self.refused: list[str] = []

    @staticmethod
    def _is_local(host: str) -> bool:
        if host == "localhost":
            return True
        try:
            return ipaddress.ip_address(host).is_loopback
        except ValueError:
            return False

    def _check(self, address: Any) -> None:
        if not isinstance(address, tuple):
            return  # a unix socket path
        host, port = str(address[0]), address[1]
        if not self._is_local(host):
            self.refused.append(f"{host}:{port}")
            raise OSError(
                f"the rehearsal refuses a connection to {host}:{port}: only the local stack is allowed"
            )
        key = f"{host}:{port}"
        self.local[key] = self.local.get(key, 0) + 1

    def __enter__(self) -> NetworkGuard:
        guard = self
        self._connect, self._connect_ex, self._getaddrinfo = (
            socket.socket.connect,
            socket.socket.connect_ex,
            socket.getaddrinfo,
        )
        orig_connect, orig_ex, orig_gai = self._connect, self._connect_ex, self._getaddrinfo

        def connect(sock: socket.socket, address: Any) -> Any:
            guard._check(address)
            return orig_connect(sock, address)

        def connect_ex(sock: socket.socket, address: Any) -> Any:
            guard._check(address)
            return orig_ex(sock, address)

        def getaddrinfo(host: Any, *args: Any, **kwargs: Any) -> Any:
            if isinstance(host, str) and not guard._is_local(host):
                guard.refused.append(f"dns:{host}")
                raise OSError(
                    f"the rehearsal refuses to look up {host}: only the local stack is allowed"
                )
            return orig_gai(host, *args, **kwargs)

        socket.socket.connect = connect  # type: ignore[method-assign,assignment]
        socket.socket.connect_ex = connect_ex  # type: ignore[method-assign,assignment]
        socket.getaddrinfo = getaddrinfo
        return self

    def __exit__(self, *exc: object) -> None:
        socket.socket.connect = self._connect  # type: ignore[method-assign]
        socket.socket.connect_ex = self._connect_ex  # type: ignore[method-assign]
        socket.getaddrinfo = self._getaddrinfo


# ============================================================================ people (the public sign-up, a password, a second factor)
@dataclass(frozen=True)
class Stack:
    url: str
    anon_key: str

    @staticmethod
    def from_env() -> Stack:
        url = os.environ.get("SUPABASE_URL")
        anon = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY")
        if not url or not anon:
            raise SystemExit(
                "SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY are not set: run this through `make rehearse-thin-slice` (it wires the local stack's public values)"
            )
        if (httpx.URL(url).host or "") not in ("127.0.0.1", "localhost", "::1"):
            raise SystemExit(
                "refusing: SUPABASE_URL is not this machine; the rehearsal runs on the local stack only"
            )
        return Stack(url.rstrip("/"), anon)

    def hdr(self, token: str | None = None) -> dict[str, str]:
        return {"apikey": self.anon_key, "Authorization": f"Bearer {token or self.anon_key}"}

    def pg(self, token: str, method: str, path: str, **kw: Any) -> httpx.Response:
        return httpx.request(
            method,
            f"{self.url}/rest/v1{path}",
            headers={**self.hdr(token), "Content-Type": "application/json"},
            timeout=30,
            **kw,
        )


def totp_code(secret_b32: str, offset: int = 0) -> str:
    key = base64.b32decode(secret_b32.upper() + "=" * (-len(secret_b32) % 8))
    counter = int(time.time() // 30) + offset
    digest = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    cut = digest[-1] & 0x0F
    return f"{(struct.unpack('>I', digest[cut : cut + 4])[0] & 0x7FFFFFFF) % 10**6:06d}"


def _load_state() -> dict[str, Any]:
    try:
        data: dict[str, Any] = json.loads(STATE_FILE.read_text())
        return data
    except (OSError, ValueError):
        return {"users": {}}


def _save_state(state: dict[str, Any]) -> None:
    STATE_DIR.mkdir(exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=1))
    STATE_FILE.chmod(0o600)


class People:
    """Synthetic people of the rehearsal. A person's e-mail, password and authenticator secret are kept in `.rehearsal/state.json` (git-ignored, local only, invented) so that a
    repeat run on the same database signs the SAME people in. A second-factor session (aal2) is made by answering a real TOTP challenge."""

    def __init__(self, stack: Stack) -> None:
        self.stack = stack
        self.state = _load_state()
        self.tokens: dict[str, dict[str, str]] = {}
        self.ids: dict[str, str] = {}

    def _password_token(self, email: str, password: str) -> str:
        r = httpx.post(
            f"{self.stack.url}/auth/v1/token?grant_type=password",
            headers=self.stack.hdr(),
            json={"email": email, "password": password},
            timeout=20,
        )
        r.raise_for_status()
        return str(r.json()["access_token"])

    def _verify(self, token: str, factor_id: str, secret: str) -> str:
        last: httpx.Response | None = None
        for offset in (0, 1, -1):
            c = httpx.post(
                f"{self.stack.url}/auth/v1/factors/{factor_id}/challenge",
                headers=self.stack.hdr(token),
                json={},
                timeout=20,
            )
            c.raise_for_status()
            last = httpx.post(
                f"{self.stack.url}/auth/v1/factors/{factor_id}/verify",
                headers=self.stack.hdr(token),
                json={"challenge_id": c.json()["id"], "code": totp_code(secret, offset)},
                timeout=20,
            )
            if last.status_code == 200:
                return str(last.json()["access_token"])
        assert last is not None
        last.raise_for_status()
        raise AssertionError("unreachable")

    def sign_in(self, role: str) -> None:
        label = "rehearsal-" + role.replace("_", "-")
        users: dict[str, Any] = self.state["users"]
        if label not in users:
            email = f"{label}@rehearsal.example.test"
            password = uuid.uuid4().hex + "Aa1!"
            r = httpx.post(
                f"{self.stack.url}/auth/v1/signup",
                headers=self.stack.hdr(),
                json={"email": email, "password": password},
                timeout=20,
            )
            if r.status_code >= 400 or "access_token" not in r.json():
                raise SystemExit(
                    f"cannot sign {label} up ({r.status_code}): if this person exists from an earlier run whose .rehearsal/state.json was lost, run `make db-reset` and start again"
                )
            token = r.json()["access_token"]
            enrol = httpx.post(
                f"{self.stack.url}/auth/v1/factors",
                headers=self.stack.hdr(token),
                json={"factor_type": "totp", "friendly_name": "rehearsal"},
                timeout=20,
            )
            enrol.raise_for_status()
            factor, secret = enrol.json()["id"], enrol.json()["totp"]["secret"]
            self._verify(token, factor, secret)
            users[label] = {
                "email": email,
                "password": password,
                "totp_secret": secret,
                "user_id": r.json()["user"]["id"],
            }
            _save_state(self.state)
        user = users[label]
        try:
            weak = self._password_token(user["email"], user["password"])
        except httpx.HTTPStatusError:
            # the database was reset since this person was kept: they no longer exist, so they are signed up again
            del users[label]
            _save_state(self.state)
            self.sign_in(role)
            return
        factors = (
            httpx.get(f"{self.stack.url}/auth/v1/user", headers=self.stack.hdr(weak), timeout=20)
            .json()
            .get("factors", [])
        )
        factor_id = next(f["id"] for f in factors if f.get("status") == "verified")
        self.tokens[role] = {
            "aal1": weak,
            "aal2": self._verify(weak, factor_id, user["totp_secret"]),
        }
        self.ids[role] = str(user["user_id"])


# ============================================================================ the recorder
class Deviation(Exception):
    """A step did not do what the hand-worked expectation said it must. The run stops here; the report says where."""


@dataclass
class Call:
    step: str
    who: str
    method: str
    kind: str  # action | replay | probe | read
    status: int
    code: str | None
    ms: float
    lead: str | None = None


@dataclass
class Check:
    name: str
    expected: Any
    actual: Any
    ok: bool


@dataclass
class Recorder:
    calls: list[Call] = field(default_factory=list)
    checks: list[Check] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def check(self, name: str, expected: Any, actual: Any) -> bool:
        ok = bool(expected == actual)
        self.checks.append(Check(name, expected, actual, ok))
        return ok

    def failed(self) -> list[Check]:
        return [c for c in self.checks if not c.ok]


@dataclass
class Resp:
    status: int
    body: Any
    code: str | None
    reason: str | None


def _error_of(body: Any) -> tuple[str | None, str | None]:
    if isinstance(body, dict):
        err = body.get("error")
        if isinstance(err, dict):
            return (
                str(err["code"]) if "code" in err else None,
                str(err["reason"]) if "reason" in err else None,
            )
        if "code" in body:
            return str(body["code"]), None
    return None, None


class Api:
    """One screen's worth of API calls as a person. `who` is a role label: owner, admin, sales, viewer (workspace A) or b_owner (workspace B)."""

    def __init__(
        self, client: TestClient, people: People, tenants: dict[str, str], rec: Recorder
    ) -> None:
        self.client, self.people, self.tenants, self.rec = client, people, tenants, rec

    def _headers(self, who: str, weak: bool, anon: bool) -> dict[str, str]:
        if anon:
            return {}
        return {"Authorization": f"Bearer {self.people.tokens[who]['aal1' if weak else 'aal2']}"}

    def _send(
        self, method: str, url: str, body: Any, headers: dict[str, str]
    ) -> tuple[Resp, float]:
        t0 = time.perf_counter()
        r = self.client.request(method, url, json=body, headers=headers)
        ms = (time.perf_counter() - t0) * 1000
        try:
            parsed: Any = r.json()
        except ValueError:
            parsed = None
        code, reason = _error_of(parsed) if r.status_code >= 400 else (None, None)
        return Resp(r.status_code, parsed, code, reason), ms

    def call(
        self,
        step: str,
        who: str,
        method: str,
        path: str,
        body: Any = None,
        *,
        tenant: str = "a",
        expect: tuple[int, ...] = (200, 201),
        kind: str = "action",
        lead: str | None = None,
        weak: bool = False,
        anon: bool = False,
        replay: bool | None = None,
        code: str | None = None,
        reason: str | None = None,
    ) -> Resp:
        """One request. `kind` says what a person was doing: action (a write), probe (an attempt that must be refused), read. A write is sent a second time with the same body (a retry): the second must be accepted and, where the answer says so, say `replayed`."""
        url = path if path.startswith("/v1") else f"/v1/tenants/{self.tenants[tenant]}{path}"
        headers = self._headers(who, weak, anon)
        resp, ms = self._send(method, url, body, headers)
        self.rec.calls.append(Call(step, who, method, kind, resp.status, resp.code, ms, lead))
        if resp.status not in expect:
            raise Deviation(
                f"{step}: {who} {method} {path.split('?')[0]} gave {resp.status} {resp.code or ''} {resp.reason or ''}; expected one of {expect}"
            )
        if code is not None:
            self.rec.check(f"{step}: {who}'s refusal code", code, resp.code)
        if reason is not None:
            self.rec.check(f"{step}: {who}'s refusal reason", reason, resp.reason)
        do_replay = (kind == "action" and method == "POST") if replay is None else replay
        if do_replay:
            again, ms2 = self._send(method, url, body, headers)
            self.rec.calls.append(
                Call(step, who, method, "replay", again.status, again.code, ms2, lead)
            )
            if again.status not in expect:
                raise Deviation(
                    f"{step}: the retry of {who} {method} {path.split('?')[0]} gave {again.status} {again.code or ''}; a retry must be accepted"
                )
            if (
                isinstance(again.body, dict)
                and "replayed" in again.body
                and again.body["replayed"] is not True
            ):
                raise Deviation(f"{step}: the retry did not say replayed")
        return resp

    def get(
        self,
        step: str,
        who: str,
        path: str,
        *,
        tenant: str = "a",
        expect: tuple[int, ...] = (200,),
        lead: str | None = None,
        anon: bool = False,
        weak: bool = False,
    ) -> Resp:
        # a look-up that may find nothing (a person checking whether a thing is already there) is not a refusal
        return self.call(
            step,
            who,
            "GET",
            path,
            None,
            tenant=tenant,
            expect=expect,
            kind="lookup" if 404 in expect else "read",
            lead=lead,
            anon=anon,
            weak=weak,
            replay=False,
        )

    def probe(
        self,
        step: str,
        who: str,
        method: str,
        path: str,
        body: Any = None,
        *,
        expect: tuple[int, ...],
        tenant: str = "a",
        weak: bool = False,
        anon: bool = False,
        code: str | None = None,
        reason: str | None = None,
    ) -> Resp:
        return self.call(
            step,
            who,
            method,
            path,
            body,
            tenant=tenant,
            expect=expect,
            kind="probe",
            weak=weak,
            anon=anon,
            replay=False,
            code=code,
            reason=reason,
        )


# ============================================================================ the local database, as the operator (counts only)
def _container() -> str:
    for line in (ROOT / "supabase" / "config.toml").read_text().splitlines():
        if line.strip().startswith("project_id"):
            return f"supabase_db_{line.split('=')[1].strip().strip(chr(34))}"
    raise SystemExit("supabase/config.toml has no project_id")


def operator_sql(statement: str) -> str:
    docker = shutil.which("docker")
    if docker is None:
        raise SystemExit("docker is required (the local stack runs in it)")
    r = subprocess.run(
        [
            docker,
            "exec",
            "-i",
            _container(),
            "psql",
            "-U",
            "postgres",
            "-d",
            "postgres",
            "-X",
            "-q",
            "-v",
            "ON_ERROR_STOP=1",
            "-At",
            "-c",
            statement,
        ],
        capture_output=True,
        text=True,
        timeout=60,
    )
    if r.returncode != 0:
        raise SystemExit("the local database did not answer: is `supabase start` running?")
    return r.stdout.strip()


COUNTED = (
    "public.companies", "public.contacts", "public.leads", "public.import_batches", "public.import_rows", "public.evidence", "public.claims", "public.enquiries",
    "public.requirements", "public.requirement_fields", "public.requirement_line_picks", "public.quotes", "public.quote_lines", "public.orders", "public.order_events",
    "public.order_policy_versions", "public.price_list_versions", "public.price_list_items", "public.price_list_breaks", "public.consent_events", "public.erasure_requests", "public.audit_events", "public.memberships", "suppression.contact_keys", "suppression.key_events",
)  # fmt: skip


def snapshot(tenant_id: str) -> dict[str, int]:
    """How many rows of each business table the workspace has. Counts only: no value of any row is read."""
    parts = " , ".join(
        f"'{t}', (select count(*) from {t} where tenant_id = '{tenant_id}')" for t in COUNTED
    )
    return {
        k: int(v)
        for k, v in json.loads(operator_sql(f"select jsonb_build_object({parts})::text")).items()
    }
