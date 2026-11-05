"""The developer API, D1 (ADR 0121; docs/contracts/developer-api.md): keys made by an Owner or an Admin (the secret shown once, never stored, logged or echoed), the program's key check (401, 403
scope and IP, 429 with Retry-After), and the TEST sandbox leads (Idempotency-Key, dedupe, consent required, calling hours and the DND test list). The fake repository answers as the migration's
functions do (pgTAP 167 pins the database side)."""

# ruff: noqa: E501

from __future__ import annotations

import hashlib
import ipaddress
import logging
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from app.developer_api import keys as K
from app.developer_api.service import DeveloperApi
from app.tenancy.repository import Forbidden
from tests.aw_fakes import _uid
from tests.fakes import TENANT_A, auth, make_client

SETTINGS = f"/v1/tenants/{TENANT_A.id}/developer"
WORKER = "worker-token"


class FakeDeveloperRepo:
    def __init__(self) -> None:
        self.keys: dict[str, dict[str, Any]] = {}   # by hash
        self.leads: list[dict[str, Any]] = []
        self.minute: dict[str, int] = {}
        self.calls: list[str] = []

    @staticmethod
    def _manager(token: str) -> None:
        if _uid(token) not in ("a_owner", "a_admin"):
            raise Forbidden("42501")

    def _show(self, k: dict[str, Any]) -> dict[str, Any]:
        return {x: k[x] for x in ("id", "name", "mode", "prefix", "last4", "scopes", "ip_allow", "created_at", "revoked_at")}

    def keys_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        self._manager(token)
        return [self._show(k) for k in self.keys.values() if k["tenant"] == tenant_id]

    def key_create(self, token: str, tenant_id: uuid.UUID, name: str, scopes: list[str], ip_allow: list[str], key_hash: str, prefix: str, last4: str) -> dict[str, Any] | None:
        self._manager(token)
        if sum(1 for k in self.keys.values() if k["tenant"] == tenant_id and not k["revoked_at"]) >= 10:
            return None
        k = {"id": str(uuid.uuid4()), "tenant": tenant_id, "name": name, "mode": "test", "prefix": prefix, "last4": last4, "scopes": scopes, "ip_allow": ip_allow,
             "created_at": datetime.now(UTC).isoformat(), "revoked_at": None}
        self.keys[key_hash] = k
        return self._show(k)

    def _by_id(self, tenant_id: uuid.UUID, key_id: uuid.UUID) -> tuple[str, dict[str, Any]] | None:
        return next(((h, k) for h, k in self.keys.items() if k["id"] == str(key_id) and k["tenant"] == tenant_id), None)

    def key_rotate(self, token: str, tenant_id: uuid.UUID, key_id: uuid.UUID, key_hash: str, prefix: str, last4: str) -> dict[str, Any] | None:
        self._manager(token)
        found = self._by_id(tenant_id, key_id)
        if found is None or found[1]["revoked_at"]:
            return None
        old, k = found
        del self.keys[old]
        k.update(prefix=prefix, last4=last4)
        self.keys[key_hash] = k
        return self._show(k)

    def key_revoke(self, token: str, tenant_id: uuid.UUID, key_id: uuid.UUID) -> dict[str, Any] | None:
        self._manager(token)
        found = self._by_id(tenant_id, key_id)
        if found is None:
            return None
        found[1]["revoked_at"] = found[1]["revoked_at"] or datetime.now(UTC).isoformat()
        return self._show(found[1])

    def usage(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        self._manager(token)
        return {"mode": "test", "month": {"leads": len(self.leads)}}

    def _live(self, key_hash: str, scope: str) -> dict[str, Any]:
        k = self.keys.get(key_hash)
        if k is None or k["revoked_at"] or scope not in k["scopes"]:
            raise Forbidden("42501")
        return k

    def auth(self, worker: str, key_hash: str, scope: str, ip: str | None) -> dict[str, Any]:
        assert worker == WORKER
        self.calls.append(scope)
        k = self.keys.get(key_hash)
        if k is None or k["revoked_at"]:
            return {"ok": False, "code": "invalid_key"}
        if scope not in k["scopes"]:
            return {"ok": False, "code": "missing_scope"}
        if k["ip_allow"]:
            try:
                addr = ipaddress.ip_address(ip or "")
            except ValueError:   # the test client's address is "testclient": not an IP, so outside every list (as the database's cast)
                addr = None
            if addr is None or not any(addr in ipaddress.ip_network(n) for n in k["ip_allow"]):
                return {"ok": False, "code": "ip_not_allowed"}
        n = self.minute[k["id"]] = self.minute.get(k["id"], 0) + 1
        if n > 60:
            return {"ok": False, "code": "rate_limited", "retry_after": 17}
        return {"ok": True, "tenant_id": str(k["tenant"]), "key_id": k["id"], "name": k["name"], "remaining": 60 - n}

    def lead_create(self, worker: str, key_hash: str, idem_key: str, body_sha: str, lead: dict[str, Any]) -> dict[str, Any]:
        k = self._live(key_hash, "leads:write")
        same = next((x for x in self.leads if x["key"] == k["id"] and x["idem"] == idem_key), None)
        if same is not None:
            return {"status": "replayed", "lead": same["out"]} if same["sha"] == body_sha else {"status": "conflict", "lead": None}
        dup = next((x for x in self.leads if x["tenant"] == k["tenant"] and lead.get("phone") and x["out"]["phone"] == lead.get("phone")), None)
        if dup is not None:
            return {"status": "duplicate", "lead": dup["out"]}
        now = datetime.now(UTC).isoformat()
        out = {"id": str(uuid.uuid4()), "mode": "test", **{f: lead.get(f) for f in ("name", "phone", "email", "source", "language", "notes", "custom_fields", "next_step", "next_step_at", "blocked")},
               "status": "new", "outcome": None, "created_at": now, "updated_at": now, "calls": []}
        self.leads.append({"key": k["id"], "tenant": k["tenant"], "idem": idem_key, "sha": body_sha, "out": out, "consent": lead["consent"]})
        return {"status": "created", "lead": out}

    def lead_get(self, worker: str, key_hash: str, lead_id: uuid.UUID) -> dict[str, Any] | None:
        k = self._live(key_hash, "leads:read")
        return next((x["out"] for x in self.leads if x["tenant"] == k["tenant"] and x["out"]["id"] == str(lead_id)), None)

    def leads_list(self, worker: str, key_hash: str, updated_since: datetime | None, after_at: datetime | None, after_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]:
        k = self._live(key_hash, "leads:read")
        rows = sorted((x["out"] for x in self.leads if x["tenant"] == k["tenant"]), key=lambda o: (o["updated_at"], o["id"]))
        if after_id is not None:
            rows = [r for r in rows if (r["updated_at"], r["id"]) > (after_at.isoformat() if after_at else "", str(after_id))]
        return rows[:limit]

    def api_usage(self, worker: str, key_hash: str) -> dict[str, Any]:
        self._live(key_hash, "usage:read")
        return {"mode": "test", "today": {"leads": len(self.leads)}}


def world(on: bool = True) -> tuple[Any, FakeDeveloperRepo]:
    repo = FakeDeveloperRepo()
    api = DeveloperApi(repo, SimpleNamespace(token=lambda: WORKER)) if on else None
    client, _ = make_client(developer_api=api)
    return client, repo


def make_key(client: Any, scopes: list[str] | None = None, user: str = "a_owner", **extra: Any) -> dict[str, Any]:
    got = client.post(f"{SETTINGS}/keys", json={"name": "Website", "scopes": scopes or ["leads:write", "leads:read", "usage:read"], **extra}, headers=auth(user))
    assert got.status_code == 201, got.text
    return dict(got.json())


def lead_body(phone: str = "+919800000001", **extra: Any) -> dict[str, Any]:
    return {"name": "Ravi Kumar", "phone": phone, "source": "website", "language": "te", "consent": {"given": True, "text": "I agree to be called"}, **extra}


def post_lead(client: Any, secret: str, body: dict[str, Any], idem: str | None = "idem-1") -> Any:
    headers = {"Authorization": f"Bearer {secret}"}
    if idem is not None:
        headers["Idempotency-Key"] = idem
    return client.post("/api/v1/leads", json=body, headers=headers)


# ============================================================================ keys
def test_the_owner_makes_a_key_and_sees_the_secret_once() -> None:
    client, repo = world()
    made = make_key(client)
    secret = made["secret"]
    assert K.looks_like_key(secret) and made["key"]["prefix"] == secret[:12] and made["key"]["last4"] == secret[-4:] and made["key"]["mode"] == "test"
    assert list(repo.keys) == [hashlib.sha256(secret.encode()).hexdigest()], "the database gets the hash"
    listed = client.get(f"{SETTINGS}/keys", headers=auth("a_owner")).json()["items"]
    assert len(listed) == 1 and secret not in str(listed) and "key_hash" not in listed[0]


def test_only_an_owner_or_admin_and_live_keys_do_not_exist() -> None:
    client, _ = world()
    assert client.post(f"{SETTINGS}/keys", json={"name": "X", "scopes": ["leads:read"]}, headers=auth("a_admin")).status_code == 201
    assert client.post(f"{SETTINGS}/keys", json={"name": "X", "scopes": ["leads:read"]}, headers=auth("a_sales")).status_code == 403
    live = client.post(f"{SETTINGS}/keys", json={"name": "X", "scopes": ["leads:read"], "mode": "live"}, headers=auth("a_owner"))
    assert live.status_code == 422 and live.json()["error"]["code"] == "live_not_available"
    assert client.post(f"{SETTINGS}/keys", json={"name": "X", "scopes": ["root"]}, headers=auth("a_owner")).status_code == 422
    assert client.post(f"{SETTINGS}/keys", json={"name": "X", "scopes": []}, headers=auth("a_owner")).status_code == 422
    bad_ip = client.post(f"{SETTINGS}/keys", json={"name": "X", "scopes": ["leads:read"], "ip_allow": ["nope"]}, headers=auth("a_owner"))
    assert bad_ip.status_code == 422 and bad_ip.json()["error"]["code"] == "invalid_ip"


def test_ten_keys_at_most() -> None:
    client, _ = world()
    for _ in range(10):
        make_key(client)
    over = client.post(f"{SETTINGS}/keys", json={"name": "X", "scopes": ["leads:read"]}, headers=auth("a_owner"))
    assert over.status_code == 409 and over.json()["error"]["code"] == "too_many_keys"


def test_rotate_stops_the_old_secret_and_revoke_stops_the_key() -> None:
    client, _ = world()
    made = make_key(client)
    key_id, old = made["key"]["id"], made["secret"]
    rotated = client.post(f"{SETTINGS}/keys/{key_id}/rotate", headers=auth("a_owner")).json()
    assert rotated["secret"] != old and post_lead(client, old, lead_body()).status_code == 401
    assert post_lead(client, rotated["secret"], lead_body()).status_code == 201
    assert client.post(f"{SETTINGS}/keys/{key_id}/revoke", headers=auth("a_owner")).json()["key"]["revoked_at"]
    gone = post_lead(client, rotated["secret"], lead_body(), idem="idem-2")
    assert gone.status_code == 401 and gone.json()["error"]["code"] == "invalid_key"
    assert client.post(f"{SETTINGS}/keys/{uuid.uuid4()}/revoke", headers=auth("a_owner")).status_code == 404
    assert client.post(f"{SETTINGS}/keys/not-a-uuid/rotate", headers=auth("a_owner")).status_code == 404


def test_off_means_not_there() -> None:
    client, _ = world(on=False)
    assert client.get(f"{SETTINGS}/keys", headers=auth("a_owner")).status_code == 404
    assert client.post("/api/v1/leads", json=lead_body(), headers={"Authorization": "Bearer sk_test_" + "a" * 40, "Idempotency-Key": "x"}).status_code == 404


# ============================================================================ the key check
def test_no_key_a_wrong_key_or_a_bad_header_is_401() -> None:
    client, _ = world()
    make_key(client)
    for headers in ({}, {"Authorization": "Bearer sk_test_" + "b" * 40}, {"Authorization": "Basic abc"}, {"Authorization": "Bearer sk_live_" + "c" * 40}):
        got = client.get("/api/v1/usage", headers=headers)
        assert got.status_code == 401 and got.json()["error"]["code"] == "invalid_key" and got.headers["WWW-Authenticate"] == "Bearer", headers


def test_a_scope_it_lacks_is_403_and_an_ip_outside_the_list_is_403() -> None:
    client, _ = world()
    read_only = make_key(client, ["leads:read"])["secret"]
    got = post_lead(client, read_only, lead_body())
    assert got.status_code == 403 and got.json()["error"]["code"] == "missing_scope"
    fenced = make_key(client, ["usage:read"], ip_allow=["203.0.113.0/24"])["secret"]
    got = client.get("/api/v1/usage", headers={"Authorization": f"Bearer {fenced}"})
    assert got.status_code == 403 and got.json()["error"]["code"] == "ip_not_allowed", "the test client is not in 203.0.113.0/24"


def test_the_61st_request_in_a_minute_is_429_with_retry_after() -> None:
    client, _ = world()
    secret = make_key(client)["secret"]
    for _ in range(60):
        ok = client.get("/api/v1/usage", headers={"Authorization": f"Bearer {secret}"})
        assert ok.status_code == 200
    assert ok.headers["X-RateLimit-Remaining"] == "0" and ok.headers["Stack19-Mode"] == "test"
    limited = client.get("/api/v1/usage", headers={"Authorization": f"Bearer {secret}"})
    assert limited.status_code == 429 and limited.json()["error"]["code"] == "rate_limited" and limited.headers["Retry-After"] == "17"


def test_the_key_is_never_logged_or_echoed(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(logging.DEBUG)
    client, _ = world()
    secret = make_key(client)["secret"]
    got = post_lead(client, secret, lead_body(phone="12345"))
    assert got.status_code == 422 and secret not in got.text
    wrong = "sk_test_" + "Z" * 40
    assert wrong not in client.get("/api/v1/usage", headers={"Authorization": f"Bearer {wrong}"}).text
    seen = " ".join(r.getMessage() for r in caplog.records)
    assert secret not in seen and secret[8:] not in seen and wrong not in seen


# ============================================================================ the sandbox leads
def test_a_lead_lands_in_the_sandbox_with_its_next_step() -> None:
    client, repo = world()
    secret = make_key(client)["secret"]
    got = post_lead(client, secret, lead_body())
    lead = got.json()
    assert got.status_code == 201 and lead["mode"] == "test" and lead["duplicate"] is False and lead["status"] == "new" and lead["next_step"] in ("call", "call_at")
    assert got.headers["Stack19-Mode"] == "test" and got.headers["X-RateLimit-Limit"] == "60"
    assert client.get(f"/api/v1/leads/{lead['id']}", headers={"Authorization": f"Bearer {secret}"}).json()["name"] == "Ravi Kumar"
    assert repo.leads[0]["consent"]["given"] is True


def test_idempotency_same_key_same_body_one_lead_another_body_409() -> None:
    client, repo = world()
    secret = make_key(client)["secret"]
    first = post_lead(client, secret, lead_body())
    again = post_lead(client, secret, {**lead_body(), "consent": {"text": "I agree to be called", "given": True}})   # the same body, keys in another order
    assert again.status_code == 200 and again.json()["id"] == first.json()["id"] and again.headers["Idempotent-Replayed"] == "true" and len(repo.leads) == 1
    other = post_lead(client, secret, lead_body(phone="+919800000002"))
    assert other.status_code == 409 and other.json()["error"]["code"] == "idempotency_conflict"
    missing = post_lead(client, secret, lead_body(), idem=None)
    assert missing.status_code == 400 and missing.json()["error"]["code"] == "idempotency_key_required"


def test_the_same_phone_is_the_existing_lead() -> None:
    client, repo = world()
    secret = make_key(client)["secret"]
    first = post_lead(client, secret, lead_body()).json()
    dup = post_lead(client, secret, lead_body(name="Ravi K"), idem="idem-2")
    assert dup.status_code == 200 and dup.json()["duplicate"] is True and dup.json()["id"] == first["id"] and len(repo.leads) == 1


def test_consent_is_required_and_the_body_is_checked() -> None:
    client, repo = world()
    secret = make_key(client)["secret"]
    no = post_lead(client, secret, lead_body(consent={"given": False}))
    assert no.status_code == 422 and no.json()["error"]["code"] == "consent_required"
    for bad in (lead_body(phone="9800000001"), lead_body(extra_field=1), {**lead_body(), "name": ""}, {"name": "X", "consent": {"given": True}}, lead_body(language="fr"),
                lead_body(custom_fields={f"k{i}": "v" for i in range(21)})):
        got = post_lead(client, secret, bad, idem=str(uuid.uuid4()))
        assert got.status_code == 422 and got.json()["error"]["code"] == "invalid_lead", bad
    assert repo.leads == []


def test_the_list_pages_oldest_change_first() -> None:
    client, _ = world()
    secret = make_key(client)["secret"]
    for i in range(3):
        assert post_lead(client, secret, lead_body(phone=f"+91980000000{i + 1}"), idem=f"i{i}").status_code == 201
    first = client.get("/api/v1/leads?limit=2", headers={"Authorization": f"Bearer {secret}"}).json()
    assert len(first["items"]) == 2 and first["next_after"]
    rest = client.get(f"/api/v1/leads?limit=2&after={first['next_after']}", headers={"Authorization": f"Bearer {secret}"}).json()
    assert len(rest["items"]) == 1 and rest["next_after"] is None
    assert {x["id"] for x in first["items"]}.isdisjoint({x["id"] for x in rest["items"]})
    assert client.get("/api/v1/leads?after=%%%", headers={"Authorization": f"Bearer {secret}"}).status_code == 400


def test_another_workspaces_lead_is_not_found() -> None:
    client, repo = world()
    secret = make_key(client)["secret"]
    lead = post_lead(client, secret, lead_body()).json()
    other = K.new_key()
    repo.keys[other.hash] = {"id": str(uuid.uuid4()), "tenant": uuid.uuid4(), "name": "B", "mode": "test", "prefix": other.prefix, "last4": other.last4, "scopes": ["leads:read"], "ip_allow": [],
                             "created_at": "", "revoked_at": None}
    assert client.get(f"/api/v1/leads/{lead['id']}", headers={"Authorization": f"Bearer {other.secret}"}).status_code == 404
    assert client.get("/api/v1/leads", headers={"Authorization": f"Bearer {other.secret}"}).json()["items"] == []


# ============================================================================ the sandbox rules (pure)
@pytest.mark.parametrize(("when", "step"), [
    ("2026-11-05T05:00:00+00:00", "call"),       # Thursday 10:30 IST: inside
    ("2026-11-05T14:00:00+00:00", "call_at"),    # Thursday 19:30 IST: after closing
    ("2026-11-08T06:00:00+00:00", "call_at"),    # Sunday: closed
])
def test_calling_hours_decide_now_or_the_next_opening(when: str, step: str) -> None:
    got = K.first_step("+919800000001", datetime.fromisoformat(when))
    assert got["next_step"] == step
    if step == "call_at":
        opening = datetime.fromisoformat(str(got["next_step_at"])).astimezone(K.IST)
        assert opening.hour == 10 and opening.minute == 0 and opening.isoweekday() in K.TEST_DAYS and got["blocked"] == "calling_hours"


def test_the_dnd_test_list_and_the_outcome_digits() -> None:
    assert K.first_step("+919800010000", datetime(2026, 11, 5, 5, tzinfo=UTC)) == {"next_step": "none", "next_step_at": None, "blocked": "dnd"}
    assert K.first_step(None, datetime(2026, 11, 5, 5, tzinfo=UTC))["next_step"] == "follow_up"
    assert [K.test_outcome(f"+91980000000{d}") for d in "123459"] == ["interested", "not_interested", "callback", "no_answer", "visit_booked", "interested"]
    assert K.body_sha({"a": 1, "b": {"c": 2}}) == K.body_sha({"b": {"c": 2}, "a": 1})
    assert K.bearer("Bearer " + "sk_test_" + "a" * 40) and not K.bearer("Bearer sk_test_short") and not K.bearer(None)
