"""The developer API v1, D2 (docs/contracts/developer-api.md): GET /me, simulated calls (dry_run never dials, Idempotency-Key, the gates, the limits), campaigns, the API activity log, and the generated
OpenAPI document and Postman collection. The fake repository answers as the migration's functions do (pgTAP 168 pins the database side)."""

# ruff: noqa: E501

from __future__ import annotations

import json
import subprocess
import sys
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from app.developer_api import gates as G
from app.developer_api import keys as K
from app.developer_api.service import DeveloperApi
from tests.fakes import auth, make_client
from tests.test_da_developer_api import (
    SETTINGS,
    WORKER,
    FakeDeveloperRepo,
    lead_body,
    make_key,
    post_lead,
)

ROOT = Path(__file__).resolve().parents[3]
ALL = ["leads:write", "leads:read", "calls:write", "calls:read", "campaigns:write", "campaigns:read", "usage:read"]


class FakeV1Repo(FakeDeveloperRepo):
    def __init__(self) -> None:
        super().__init__()
        self.call_rows: list[dict[str, Any]] = []
        self.campaign_rows: list[dict[str, Any]] = []
        self.activity: list[dict[str, Any]] = []
        self.created_calls = 0

    def me(self, worker: str, key_hash: str) -> dict[str, Any] | None:
        k = self.keys.get(key_hash)
        if k is None or k["revoked_at"]:
            return None
        return {"mode": "test", "key": self._show(k), "workspace": {"id": str(k["tenant"]), "name": "Demo"}}

    def _lead(self, tenant: Any, lead_id: uuid.UUID) -> dict[str, Any] | None:
        return next((x for x in self.leads if x["tenant"] == tenant and x["out"]["id"] == str(lead_id)), None)

    @staticmethod
    def _active(c: dict[str, Any]) -> bool:
        return bool(c["scheduled_for"] + timedelta(seconds=30) > datetime.now(UTC))

    def call_context(self, worker: str, key_hash: str, lead_id: uuid.UUID) -> dict[str, Any]:
        k = self._live(key_hash, "calls:write")
        lead = self._lead(k["tenant"], lead_id)
        return {"lead": None if lead is None else {"id": lead["out"]["id"], "phone": lead["out"]["phone"], "consent_given": bool(lead["consent"] and lead["consent"].get("given"))},
                "active_calls": sum(1 for c in self.call_rows if c["tenant"] == k["tenant"] and self._active(c)),
                "calls_last_minute": sum(1 for c in self.call_rows if c["key"] == k["id"] and c["created_at"] > datetime.now(UTC) - timedelta(minutes=1))}

    def _call_json(self, c: dict[str, Any]) -> dict[str, Any]:
        now, start = datetime.now(UTC), c["scheduled_for"]
        st = "queued" if now < start else "in_progress" if now < start + timedelta(seconds=30) else "completed"
        oc = K.test_outcome(c["phone"])
        return {"id": c["id"], "mode": "test", "lead_id": c["lead_id"], "status": st, "outcome": oc if st == "completed" else None, "scheduled_for": start.isoformat(),
                "started_at": None if st == "queued" else start.isoformat(), "ended_at": (start + timedelta(seconds=30)).isoformat() if st == "completed" else None,
                "duration_seconds": (0 if oc == "no_answer" else 30) if st == "completed" else None, "summary": None, "transcript": None, "cost": {"minutes": 0, "paise": 0},
                "created_at": c["created_at"].isoformat()}

    def call_create(self, worker: str, key_hash: str, idem_key: str, body_sha: str, lead_id: uuid.UUID, scheduled_for: datetime) -> dict[str, Any]:
        k = self._live(key_hash, "calls:write")
        same = next((c for c in self.call_rows if c["key"] == k["id"] and c["idem"] == idem_key), None)
        if same is not None:
            return {"status": "replayed", "call": self._call_json(same)} if same["sha"] == body_sha else {"status": "conflict"}
        lead = self._lead(k["tenant"], lead_id)
        if lead is None:
            return {"status": "not_found"}
        if sum(1 for c in self.call_rows if c["tenant"] == k["tenant"] and self._active(c)) >= 10:
            return {"status": "too_many_calls", "retry_after": 30}
        if sum(1 for c in self.call_rows if c["key"] == k["id"] and c["created_at"] > datetime.now(UTC) - timedelta(minutes=1)) >= 10:
            return {"status": "rate_limited", "retry_after": 41}
        self.created_calls += 1
        row = {"id": str(uuid.uuid4()), "tenant": k["tenant"], "key": k["id"], "idem": idem_key, "sha": body_sha, "lead_id": str(lead_id), "phone": lead["out"]["phone"],
               "scheduled_for": scheduled_for, "created_at": datetime.now(UTC)}
        self.call_rows.append(row)
        lead["out"]["calls"].append(row["id"])
        return {"status": "created", "call": self._call_json(row)}

    def call_get(self, worker: str, key_hash: str, call_id: uuid.UUID) -> dict[str, Any] | None:
        k = self._live(key_hash, "calls:read")
        return next((self._call_json(c) for c in self.call_rows if c["tenant"] == k["tenant"] and c["id"] == str(call_id)), None)

    def calls_list(self, worker: str, key_hash: str, lead_id: uuid.UUID | None, after_at: datetime | None, after_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]:
        k = self._live(key_hash, "calls:read")
        rows = [c for c in self.call_rows if c["tenant"] == k["tenant"] and (lead_id is None or c["lead_id"] == str(lead_id))]
        rows.sort(key=lambda c: (c["created_at"], c["id"]))
        if after_at is not None:
            rows = [c for c in rows if (c["created_at"], c["id"]) > (after_at, str(after_id))]
        return [self._call_json(c) for c in rows[:limit]]

    def campaign_create(self, worker: str, key_hash: str, idem_key: str, body_sha: str, campaign: dict[str, Any]) -> dict[str, Any]:
        k = self._live(key_hash, "campaigns:write")
        same = next((c for c in self.campaign_rows if c["key"] == k["id"] and c["idem"] == idem_key), None)
        if same is not None:
            return {"status": "replayed", "campaign": self._camp_json(same, True)} if same["sha"] == body_sha else {"status": "conflict"}
        ids: list[str] = []
        added = dups = 0
        for contact in campaign["contacts"]:
            lead = next((x for x in self.leads if x["tenant"] == k["tenant"] and x["out"]["phone"] == contact["phone"]), None)
            if lead is None:
                added += 1
                now = datetime.now(UTC).isoformat()
                out = {"id": str(uuid.uuid4()), "mode": "test", **{f: contact.get(f) for f in ("name", "phone", "email", "source", "language", "notes", "custom_fields", "next_step", "next_step_at", "blocked")},
                       "status": "new", "outcome": None, "created_at": now, "updated_at": now, "calls": []}
                lead = {"key": k["id"], "tenant": k["tenant"], "idem": f"c:{len(self.leads)}", "sha": "x", "out": out, "consent": contact["consent"]}
                self.leads.append(lead)
            else:
                dups += 1
            ids.append(lead["out"]["id"])
        row = {"id": str(uuid.uuid4()), "tenant": k["tenant"], "key": k["id"], "idem": idem_key, "sha": body_sha, "name": campaign["name"], "language": campaign["language"],
               "job": {"name": campaign["job_name"], "goal": campaign["job_goal"]}, "ids": ids, "added": added, "dups": dups, "created_at": datetime.now(UTC)}
        self.campaign_rows.append(row)
        return {"status": "created", "campaign": self._camp_json(row, True)}

    @staticmethod
    def _camp_json(c: dict[str, Any], leads: bool) -> dict[str, Any]:
        out = {"id": c["id"], "mode": "test", "name": c["name"], "language": c["language"], "job": c["job"], "status": "draft", "contacts": len(c["ids"]), "added": c["added"],
               "duplicates": c["dups"], "created_at": c["created_at"].isoformat()}
        return {**out, "lead_ids": c["ids"]} if leads else out

    def campaign_get(self, worker: str, key_hash: str, campaign_id: uuid.UUID) -> dict[str, Any] | None:
        k = self._live(key_hash, "campaigns:read")
        return next((self._camp_json(c, True) for c in self.campaign_rows if c["tenant"] == k["tenant"] and c["id"] == str(campaign_id)), None)

    def campaigns_list(self, worker: str, key_hash: str, after_at: datetime | None, after_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]:
        k = self._live(key_hash, "campaigns:read")
        rows = sorted((c for c in self.campaign_rows if c["tenant"] == k["tenant"]), key=lambda c: (c["created_at"], c["id"]))
        if after_at is not None:
            rows = [c for c in rows if (c["created_at"], c["id"]) > (after_at, str(after_id))]
        return [self._camp_json(c, False) for c in rows[:limit]]

    def activity_log(self, worker: str, key_hash: str, method: str, route: str, status: int, latency_ms: int) -> bool:
        k = self.keys.get(key_hash)
        if k is None or k["revoked_at"]:
            return False
        self.activity.append({"id": str(uuid.uuid4()), "key_id": k["id"], "key_name": k["name"], "tenant": k["tenant"], "method": method, "route": route, "status": status,
                              "latency_ms": latency_ms, "at": datetime.now(UTC).isoformat()})
        return True

    def _page(self, tenant: Any, key_id: Any, before_at: datetime | None, before_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]:
        rows = [{k: v for k, v in a.items() if k != "tenant"} for a in reversed(self.activity) if a["tenant"] == tenant and (key_id is None or a["key_id"] == str(key_id))]
        if before_at is not None:
            rows = [r for r in rows if (r["at"], r["id"]) < (before_at.isoformat(), str(before_id))]
        return rows[:limit]

    def activity_list(self, worker: str, key_hash: str, before_at: datetime | None, before_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]:
        return self._page(self._live(key_hash, "usage:read")["tenant"], None, before_at, before_id, limit)

    def activity_for_settings(self, token: str, tenant_id: uuid.UUID, key_id: uuid.UUID | None, before_at: datetime | None, before_id: uuid.UUID | None, limit: int) -> list[dict[str, Any]]:
        self._manager(token)
        return self._page(tenant_id, key_id, before_at, before_id, limit)


def world() -> tuple[Any, FakeV1Repo]:
    repo = FakeV1Repo()
    client, _ = make_client(developer_api=DeveloperApi(repo, SimpleNamespace(token=lambda: WORKER)))
    return client, repo


def hdr(secret: str, idem: str | None = None) -> dict[str, str]:
    return {"Authorization": f"Bearer {secret}", **({"Idempotency-Key": idem} if idem else {})}


def lead_id_of(client: Any, secret: str, phone: str = "+919800000001") -> str:
    got = post_lead(client, secret, lead_body(phone=phone), idem="lead-" + phone)
    assert got.status_code in (200, 201), got.text
    return str(got.json()["id"])


def call(client: Any, secret: str, lead_id: str, idem: str | None = "call-1", **extra: Any) -> Any:
    return client.post("/api/v1/calls", json={"lead_id": lead_id, **extra}, headers=hdr(secret, idem))


# ============================================================================ me
def test_me_works_for_any_live_key_and_never_shows_the_secret() -> None:
    client, _ = world()
    secret = make_key(client, ["leads:read"])["secret"]
    got = client.get("/api/v1/me", headers=hdr(secret))
    assert got.status_code == 200 and got.json()["mode"] == "test" and got.json()["key"]["scopes"] == ["leads:read"] and got.json()["workspace"]["name"] == "Demo"
    assert secret not in got.text and "key_hash" not in got.text and got.headers["Stack19-Mode"] == "test"
    assert client.get("/api/v1/me").status_code == 401
    assert client.get("/api/v1/me", headers=hdr("sk_test_" + "q" * 40)).json()["error"]["code"] == "invalid_key"


# ============================================================================ calls: dry_run
def test_dry_run_checks_everything_and_dials_nobody() -> None:
    client, repo = world()
    secret = make_key(client, ALL)["secret"]
    lid = lead_id_of(client, secret)
    got = call(client, secret, lid, idem=None, dry_run=True)   # no Idempotency-Key needed
    assert got.status_code == 200 and got.json()["dry_run"] is True and got.json()["would_place"] is True and got.json()["blocked_by"] is None
    assert [g["gate"] for g in got.json()["gates"]] == ["sandbox", "number", "consent", "dnd", "wallet", "capacity", "calling_hours"] and all(g["ok"] for g in got.json()["gates"])
    assert repo.created_calls == 0 and repo.call_rows == [], "a dry run writes nothing"
    # a number on the DND list and one with an empty wallet: shown, still nothing placed
    dnd = call(client, secret, lead_id_of(client, secret, "+919800010000"), idem=None, dry_run=True).json()
    assert dnd["would_place"] is False and dnd["blocked_by"] == "number_on_dnd"
    empty = call(client, secret, lead_id_of(client, secret, "+919800009999"), idem=None, dry_run=True).json()
    assert empty["would_place"] is False and empty["blocked_by"] == "wallet_empty"
    assert repo.created_calls == 0


def test_dry_run_of_another_workspaces_lead_is_404_and_a_bad_body_is_422() -> None:
    client, repo = world()
    secret = make_key(client, ALL)["secret"]
    assert call(client, secret, str(uuid.uuid4()), idem=None, dry_run=True).status_code == 404
    for bad in ({}, {"lead_id": "nope"}, {"lead_id": str(uuid.uuid4()), "extra": 1}, {"lead_id": str(uuid.uuid4()), "dry_run": "yes"}):
        got = client.post("/api/v1/calls", json=bad, headers=hdr(secret, "k"))
        assert got.status_code == 422 and got.json()["error"]["code"] == "invalid_call", bad
    assert repo.created_calls == 0


# ============================================================================ calls: real, idempotency, gates
def test_a_call_is_simulated_and_idempotent() -> None:
    client, repo = world()
    secret = make_key(client, ALL)["secret"]
    lid = lead_id_of(client, secret)
    first = call(client, secret, lid)
    assert first.status_code == 201 and first.json()["mode"] == "test" and first.json()["lead_id"] == lid and first.json()["cost"] == {"minutes": 0, "paise": 0}
    again = call(client, secret, lid)
    assert again.status_code == 200 and again.json()["id"] == first.json()["id"] and again.headers["Idempotent-Replayed"] == "true" and repo.created_calls == 1
    other = call(client, secret, lead_id_of(client, secret, "+919800000002"))
    assert other.status_code == 409 and other.json()["error"]["code"] == "idempotency_conflict"
    missing = call(client, secret, lid, idem=None)
    assert missing.status_code == 400 and missing.json()["error"]["code"] == "idempotency_key_required"
    seen = client.get(f"/api/v1/leads/{lid}", headers=hdr(secret)).json()
    assert seen["calls"] == [first.json()["id"]]


def test_the_gates_refuse_with_plain_codes_and_nothing_is_placed() -> None:
    client, repo = world()
    secret = make_key(client, ALL)["secret"]
    dnd = call(client, secret, lead_id_of(client, secret, "+919800010000"), idem="a")
    assert dnd.status_code == 422 and dnd.json()["error"]["code"] == "number_on_dnd"
    wallet = call(client, secret, lead_id_of(client, secret, "+919800009999"), idem="b")
    assert wallet.status_code == 402 and wallet.json()["error"]["code"] == "wallet_empty"
    mail = post_lead(client, secret, {"name": "Mail Only", "email": "a@b.co", "consent": {"given": True}}, idem="m").json()["id"]
    nonum = call(client, secret, mail, idem="c")
    assert nonum.status_code == 422 and nonum.json()["error"]["code"] == "lead_has_no_number"
    repo.leads[0]["consent"] = None   # a lead whose consent was erased
    lost = call(client, secret, repo.leads[0]["out"]["id"], idem="d")
    assert lost.status_code == 422 and lost.json()["error"]["code"] == "consent_required"
    assert call(client, secret, str(uuid.uuid4()), idem="e").status_code == 404
    assert repo.created_calls == 0


def test_calling_hours_queue_the_call_for_the_next_opening() -> None:
    sun = datetime(2026, 11, 8, 6, 0, tzinfo=UTC)   # a Sunday: closed
    plan = G.plan({"phone": "+919800000001", "consent_given": True}, 0, 0, sun)
    assert plan.starts == "at_opening" and plan.starts_at > sun and plan.refusal is None and plan.blocked_by is None
    mon = datetime(2026, 11, 9, 5, 0, tzinfo=UTC)   # Monday 10:30 IST
    assert G.plan({"phone": "+919800000001", "consent_given": True}, 0, 0, mon).starts == "now"
    full = G.plan({"phone": "+919800000001", "consent_given": True}, 10, 0, mon)
    assert full.blocked_by == "too_many_calls" and full.refusal is None, "capacity is the database's to enforce (a replay must still work)"


def test_the_call_finishes_after_thirty_seconds_with_the_outcome_of_the_last_digit() -> None:
    client, repo = world()
    secret = make_key(client, ALL)["secret"]
    ids = {d: lead_id_of(client, secret, f"+91980000000{d}") for d in "135"}
    made = {d: call(client, secret, lid, idem=f"c{d}").json() for d, lid in ids.items()}
    assert all(m["status"] in ("queued", "in_progress") and m["outcome"] is None for m in made.values())
    for row in repo.call_rows:
        row["scheduled_for"] = datetime.now(UTC) - timedelta(seconds=31)
    for d, expected in (("1", "interested"), ("3", "callback"), ("5", "visit_booked")):
        got = client.get(f"/api/v1/calls/{made[d]['id']}", headers=hdr(secret)).json()
        assert got["status"] == "completed" and got["outcome"] == expected and got["duration_seconds"] == 30
    listed = client.get(f"/api/v1/calls?lead_id={ids['3']}", headers=hdr(secret)).json()
    assert [c["id"] for c in listed["items"]] == [made["3"]["id"]]
    page = client.get("/api/v1/calls?limit=2", headers=hdr(secret)).json()
    assert len(page["items"]) == 2 and page["next_after"]
    rest = client.get(f"/api/v1/calls?limit=2&after={page['next_after']}", headers=hdr(secret)).json()
    assert len(rest["items"]) == 1 and rest["next_after"] is None
    assert client.get(f"/api/v1/calls/{uuid.uuid4()}", headers=hdr(secret)).status_code == 404
    assert client.get("/api/v1/calls/not-a-uuid", headers=hdr(secret)).status_code == 404


def test_scopes_and_workspace_isolation_for_calls() -> None:
    client, repo = world()
    secret = make_key(client, ALL)["secret"]
    lid = lead_id_of(client, secret)
    cid = call(client, secret, lid).json()["id"]
    read_only = make_key(client, ["calls:read"])["secret"]
    denied = call(client, read_only, lid, idem="z")
    assert denied.status_code == 403 and denied.json()["error"]["code"] == "missing_scope"
    assert client.get(f"/api/v1/calls/{cid}", headers=hdr(read_only)).status_code == 200
    other = K.new_key()
    repo.keys[other.hash] = {"id": str(uuid.uuid4()), "tenant": uuid.uuid4(), "name": "B", "mode": "test", "prefix": other.prefix, "last4": other.last4, "scopes": ALL, "ip_allow": [], "created_at": "", "revoked_at": None}
    assert client.get(f"/api/v1/calls/{cid}", headers=hdr(other.secret)).status_code == 404
    assert call(client, other.secret, lid, idem="y").status_code == 404, "another workspace's lead is not on this sandbox list"


def test_ten_open_calls_and_ten_calls_a_minute_are_the_limits() -> None:
    client, repo = world()
    secret = make_key(client, ALL)["secret"]
    ids = [lead_id_of(client, secret, f"+9198000{i + 10:05d}") for i in range(11)]
    assert len(set(ids)) == 11
    for i in range(10):
        assert call(client, secret, ids[i], idem=f"n{i}").status_code == 201
    over = call(client, secret, ids[10], idem="n10")
    assert over.status_code == 429 and over.json()["error"]["code"] == "too_many_calls" and over.headers["Retry-After"] == "30"
    for row in repo.call_rows:   # all finished: the open-call limit clears, the per-minute limit does not
        row["scheduled_for"] = datetime.now(UTC) - timedelta(minutes=5)
    limited = call(client, secret, ids[10], idem="n11")
    assert limited.status_code == 429 and limited.json()["error"]["code"] == "rate_limited" and limited.headers["Retry-After"] == "41"
    assert call(client, secret, ids[0], idem="n0").status_code == 200, "a replay is still answered"


# ============================================================================ campaigns
def campaign_body(**extra: Any) -> dict[str, Any]:
    return {"name": "Diwali", "language": "te", "job": {"name": "Follow up", "goal": "Ask about the catalogue"},
            "contacts": [lead_body("+919800000001"), lead_body("+919800000002"), lead_body("+919800010000"), lead_body("+919800000003", consent={"given": False}), {"name": "x"}], **extra}


def test_a_campaign_is_a_list_of_consented_contacts_and_a_job() -> None:
    client, repo = world()
    secret = make_key(client, ALL)["secret"]
    got = client.post("/api/v1/campaigns", json=campaign_body(), headers=hdr(secret, "camp-1"))
    assert got.status_code == 201, got.text
    out = got.json()
    assert out["campaign"]["mode"] == "test" and out["campaign"]["status"] == "draft" and out["campaign"]["contacts"] == 2 and out["campaign"]["job"]["name"] == "Follow up"
    assert out["refused"] == [{"index": 2, "code": "number_on_dnd"}, {"index": 3, "code": "consent_required"}, {"index": 4, "code": "invalid_lead"}]
    cid = out["campaign"]["id"]
    again = client.post("/api/v1/campaigns", json=campaign_body(), headers=hdr(secret, "camp-1"))
    assert again.status_code == 200 and again.headers["Idempotent-Replayed"] == "true" and again.json()["campaign"]["id"] == cid and len(repo.campaign_rows) == 1
    assert client.post("/api/v1/campaigns", json=campaign_body(name="Other"), headers=hdr(secret, "camp-1")).json()["error"]["code"] == "idempotency_conflict"
    assert client.post("/api/v1/campaigns", json=campaign_body(), headers=hdr(secret)).json()["error"]["code"] == "idempotency_key_required"
    one = client.get(f"/api/v1/campaigns/{cid}", headers=hdr(secret)).json()
    assert len(one["lead_ids"]) == 2 and client.get(f"/api/v1/leads/{one['lead_ids'][0]}", headers=hdr(secret)).status_code == 200
    listed = client.get("/api/v1/campaigns", headers=hdr(secret)).json()
    assert [c["id"] for c in listed["items"]] == [cid] and "lead_ids" not in listed["items"][0] and listed["next_after"] is None
    # the same numbers in another campaign are the same sandbox leads: duplicates
    second = client.post("/api/v1/campaigns", json=campaign_body(name="Again"), headers=hdr(secret, "camp-2")).json()
    assert second["campaign"]["duplicates"] == 2 and second["campaign"]["added"] == 0
    assert client.get(f"/api/v1/campaigns/{uuid.uuid4()}", headers=hdr(secret)).status_code == 404


def test_a_campaign_with_no_usable_contact_or_a_bad_shape_is_422() -> None:
    client, repo = world()
    secret = make_key(client, ALL)["secret"]
    none = client.post("/api/v1/campaigns", json=campaign_body(contacts=[lead_body(consent={"given": False})]), headers=hdr(secret, "a"))
    assert none.status_code == 422 and none.json()["error"]["code"] == "no_usable_contacts" and none.json()["error"]["refused"] == [{"index": 0, "code": "consent_required"}]
    for bad in ({"name": "X"}, campaign_body(contacts=[]), campaign_body(job={"name": ""}), campaign_body(extra=1), campaign_body(contacts=[lead_body()] * 501)):
        got = client.post("/api/v1/campaigns", json=bad, headers=hdr(secret, "b"))
        assert got.status_code == 422 and got.json()["error"]["code"] == "invalid_campaign", bad
    assert repo.campaign_rows == []
    read_only = make_key(client, ["campaigns:read"])["secret"]
    assert client.post("/api/v1/campaigns", json=campaign_body(), headers=hdr(read_only, "c")).status_code == 403


# ============================================================================ the API activity log
def test_every_request_is_logged_by_template_status_and_latency_never_a_body() -> None:
    client, repo = world()
    secret = make_key(client, ALL)["secret"]
    lid = lead_id_of(client, secret, "+919800000007")
    client.get(f"/api/v1/leads/{lid}", headers=hdr(secret))
    client.get(f"/api/v1/leads/{uuid.uuid4()}", headers=hdr(secret))
    client.post("/api/v1/calls", json={"lead_id": "bad"}, headers=hdr(secret, "k"))
    client.get("/api/v1/leads/x", headers=hdr("sk_test_" + "u" * 40))   # an unknown key leaves no row (no workspace to file it under)
    got = client.get("/api/v1/activity", headers=hdr(secret))
    assert got.status_code == 200
    items = got.json()["items"]
    routes = [(i["method"], i["route"], i["status"]) for i in items]
    assert ("GET", "/api/v1/leads/{lead_id}", 200) in routes and ("GET", "/api/v1/leads/{lead_id}", 404) in routes and ("POST", "/api/v1/calls", 422) in routes and ("POST", "/api/v1/leads", 201) in routes
    assert all(set(i) == {"id", "key_id", "key_name", "method", "route", "status", "latency_ms", "at"} and i["latency_ms"] >= 0 for i in items)
    text = json.dumps(items)
    assert lid not in text and "+919800000007" not in text and secret not in text and "Ravi" not in text, "no ids from the path, no body, no key"
    assert len(repo.activity) >= 5 and all("u" * 40 not in str(a) for a in repo.activity)


def test_the_activity_log_pages_newest_first_and_the_owner_reads_it_in_settings() -> None:
    client, _ = world()
    made = make_key(client, ALL)
    secret = made["secret"]
    for _ in range(4):
        client.get("/api/v1/me", headers=hdr(secret))
    first = client.get("/api/v1/activity?limit=2", headers=hdr(secret)).json()
    assert len(first["items"]) == 2 and first["next_before"]
    rest = client.get(f"/api/v1/activity?limit=2&before={first['next_before']}", headers=hdr(secret)).json()
    assert {i["id"] for i in first["items"]}.isdisjoint({i["id"] for i in rest["items"]}) and rest["items"]
    assert client.get("/api/v1/activity?before=%%%", headers=hdr(secret)).status_code == 400
    seen = client.get(f"{SETTINGS}/activity?key_id={made['key']['id']}", headers=auth("a_owner"))
    assert seen.status_code == 200 and seen.json()["items"] and all(i["key_id"] == made["key"]["id"] for i in seen.json()["items"])
    assert client.get(f"{SETTINGS}/activity", headers=auth("a_sales")).status_code == 403
    assert secret not in seen.text


def test_a_rate_limited_request_is_in_the_log_too() -> None:
    client, repo = world()
    secret = make_key(client, ["usage:read"])["secret"]
    for _ in range(61):
        last = client.get("/api/v1/usage", headers=hdr(secret))
    assert last.status_code == 429
    assert [a["status"] for a in repo.activity].count(429) == 1 and [a["status"] for a in repo.activity].count(200) == 60


def test_usage_and_settings_keys_know_the_new_scopes() -> None:
    client, _ = world()
    for scope in ("calls:write", "campaigns:read"):
        assert client.post(f"{SETTINGS}/keys", json={"name": "N", "scopes": [scope]}, headers=auth("a_owner")).status_code == 201
    assert K.SCOPES == ("leads:write", "leads:read", "calls:read", "calls:write", "campaigns:write", "campaigns:read", "webhooks", "usage:read")


# ============================================================================ the generated documents
def test_the_openapi_document_and_the_postman_collection_are_current_and_complete() -> None:
    script = ROOT / "scripts/developer_openapi.py"
    out = subprocess.run([sys.executable, "-I", str(script), "--check"], capture_output=True, text=True, cwd=ROOT, check=False, env=_env())  # noqa: S603
    assert out.returncode == 0, out.stdout + out.stderr
    spec = json.loads((ROOT / "docs/contracts/developer-api.openapi.json").read_text())
    ops = {(m.upper(), p) for p, item in spec["paths"].items() for m in item}
    assert ops == {("GET", "/api/v1/me"), ("POST", "/api/v1/leads"), ("GET", "/api/v1/leads"), ("GET", "/api/v1/leads/{lead_id}"), ("POST", "/api/v1/calls"), ("GET", "/api/v1/calls"),
                   ("GET", "/api/v1/calls/{call_id}"), ("POST", "/api/v1/campaigns"), ("GET", "/api/v1/campaigns"), ("GET", "/api/v1/campaigns/{campaign_id}"), ("GET", "/api/v1/usage"),
                   ("GET", "/api/v1/activity")}
    assert spec["components"]["securitySchemes"]["bearerAuth"]["scheme"] == "bearer"
    for item in spec["paths"].values():
        for op in item.values():
            assert op["operationId"] and "401" in op["responses"] and "429" in op["responses"]
    post = json.loads((ROOT / "docs/contracts/developer-api.postman_collection.json").read_text())
    names = [i["name"] for i in post["item"]]
    assert len(names) == 12 and post["info"]["schema"].endswith("v2.1.0/collection.json")
    assert {v["key"] for v in post["variable"]} == {"base_url", "api_key"} and not K.looks_like_key(next((w for w in json.dumps(post).replace('"', " ").split() if w.startswith("sk_test_")), None))
    create = next(i for i in post["item"] if i["request"]["method"] == "POST" and i["request"]["url"]["path"][-1] == "calls")
    assert any(h["key"] == "Idempotency-Key" for h in create["request"]["header"]) and json.loads(create["request"]["body"]["raw"])["dry_run"] is True


def _env() -> dict[str, str]:
    return {"PATH": "/usr/bin:/bin"}
