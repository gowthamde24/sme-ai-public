"""Job BY on the real stack: the team (invitations by code, the failed-attempt lock that must SURVIVE the request, races, the second factor, roles, removal), the shop's basics, the weekly report and the
notification feed with web-push end to end (a fake push service decrypts what the worker sends). All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import json
import threading
import uuid
from collections.abc import Iterator
from typing import Any

import httpx
import operator_sql
import pytest
from conftest import Stack, User, aal1_token, bearer
from crm_support import Tenant, World
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from evidence_support import uid
from fastapi.testclient import TestClient
from push_support import decrypt_push

from app.notifications.repository import PostgrestNotificationsRepository
from app.notifications.runner import PushRunner
from app.notifications.webpush import VapidKeys, WebPushSender, b64e
from app.scheduler.session import PrincipalSession


def url(t: Tenant, path: str) -> str:
    return f"/v1/tenants/{t.id}{path}"


@pytest.fixture(scope="module")
def world(eval_world: World) -> World:
    return eval_world


def invite(client: TestClient, t: Tenant, who: str, role: str, **extra: Any) -> dict[str, Any]:
    r = client.post(url(t, "/invitations"), json={"invitation_id": uid(), "role": role, **extra}, headers=bearer(t.users[who]))
    assert r.status_code == 201, r.text
    body: dict[str, Any] = r.json()["invitation"]
    return body


def accept(client: TestClient, user: User, code: str, *, weak: bool = False, stack: Stack | None = None) -> httpx.Response:
    headers = {"Authorization": f"Bearer {aal1_token(stack, user)}"} if weak and stack else bearer(user)
    r: httpx.Response = client.post("/v1/invitations/accept", json={"code": code}, headers=headers)
    return r


# ============================================================================ the team
def test_an_invitation_is_made_shown_once_accepted_once_and_audited(client: TestClient, stack: Stack, world: World, signup: Any) -> None:
    t = world.a
    inv = invite(client, t, "owner", "sales", label="for the new cutter")
    code = inv["code"]
    assert code and inv["status"] == "pending" and operator_sql.sql(f"select count(*) from team.invitations where id = '{inv['id']}' and code_sha256 ~ '^[0-9a-f]{{64}}$'") == "1"
    assert operator_sql.sql(f"select count(*) from team.invitations where label = '{code}' or code_sha256 = '{code}'") == "0"
    listed = client.get(url(t, "/invitations"), headers=bearer(t.users["admin"])).json()["invitations"]
    assert any(i["id"] == inv["id"] and i["label"] == "for the new cutter" for i in listed) and code not in json.dumps(listed)
    newcomer = signup("by-newcomer", mfa=False)
    assert client.get(url(t, "/team"), headers=bearer(newcomer)).status_code == 404, "not a member yet"
    ok = accept(client, newcomer, code.lower().replace("-", " "), weak=True, stack=stack)
    assert ok.status_code == 200 and ok.json()["status"] == "joined" and ok.json()["role"] == "sales" and ok.headers["cache-control"] == "no-store"
    team = client.get(url(t, "/team"), headers=bearer(newcomer)).json()
    assert {m["user_id"] for m in team["members"]} >= {str(newcomer.id), str(t.users["owner"].id)} and team["pending_invitations"] is None
    assert accept(client, signup("by-late", mfa=False), code).status_code == 400, "a used code is the same as an unknown one"
    audit = operator_sql.sql(f"select string_agg(action, ',' order by id) from public.audit_events where tenant_id = '{t.id}' and entity_id = '{inv['id']}'")
    assert audit == "invitation.created,invitation.accepted"
    assert operator_sql.sql(f"select count(*) from public.audit_events where tenant_id = '{t.id}' and (new_values::text like '%{code[:5]}%' or metadata::text like '%{code[:5]}%')") == "0"


def test_five_wrong_codes_lock_the_person_and_the_lock_survives_the_request(client: TestClient, world: World, signup: Any) -> None:
    t = world.a
    guesser = signup("by-guesser", mfa=False)
    inv = invite(client, t, "owner", "viewer")
    for i in range(5):
        r = accept(client, guesser, f"AAAAA-AAAAA-AAAAA-AAAA{i + 1}")
        assert r.status_code == 400 and r.json()["error"]["code"] == "invitation_invalid", i
    assert operator_sql.sql(f"select count(*) from team.invitation_attempts where user_id = '{guesser.id}'") == "5", "the failed attempts were COMMITTED (they are not rolled back with an error)"
    locked = accept(client, guesser, inv["code"])
    assert locked.status_code == 429 and locked.json()["error"]["code"] == "invitation_locked"
    assert operator_sql.sql(f"select status from team.invitations where id = '{inv['id']}'") == "pending"
    other = signup("by-bystander", mfa=False)
    assert accept(client, other, inv["code"]).status_code == 200, "the lock is the guesser's alone"
    for text in ("x" * 90, "'; drop table team.invitations; --", "\u0000‮"):
        assert accept(client, signup("by-hostile", mfa=False), text).status_code in (400, 422)


def test_an_admin_invitation_needs_a_second_factor_session_and_loses_nothing_if_refused(client: TestClient, stack: Stack, world: World, signup: Any) -> None:
    t = world.a
    inv = invite(client, t, "owner", "admin")
    person = signup("by-admin-to-be")  # a person WITH an authenticator
    weak = accept(client, person, inv["code"], weak=True, stack=stack)
    assert weak.status_code == 403 and weak.json()["error"]["code"] == "mfa_required"
    assert operator_sql.sql(f"select count(*) from team.invitation_attempts where user_id = '{person.id}'") == "0", "no failure recorded for it"
    assert operator_sql.sql(f"select status from team.invitations where id = '{inv['id']}'") == "pending"
    strong = accept(client, person, inv["code"])
    assert strong.status_code == 200 and strong.json()["role"] == "admin"


def test_owner_is_never_a_role_here_and_an_admin_cannot_grant_admin(client: TestClient, stack: Stack, world: World) -> None:
    t = world.a
    assert client.post(url(t, "/invitations"), json={"invitation_id": uid(), "role": "owner"}, headers=bearer(t.users["owner"])).status_code == 422
    r = client.post(url(t, "/invitations"), json={"invitation_id": uid(), "role": "admin"}, headers=bearer(t.users["admin"]))
    assert r.status_code == 403 and r.json()["error"]["code"] == "role_not_allowed"
    assert client.post(url(t, "/invitations"), json={"invitation_id": uid(), "role": "sales"}, headers={"Authorization": f"Bearer {aal1_token(stack, t.users['owner'])}"}).status_code == 403
    assert client.post(url(t, "/invitations"), json={"invitation_id": uid(), "role": "sales"}, headers=bearer(t.users["sales"])).status_code == 403
    same = uid()
    first = client.post(url(t, "/invitations"), json={"invitation_id": same, "role": "viewer"}, headers=bearer(t.users["owner"]))
    again = client.post(url(t, "/invitations"), json={"invitation_id": same, "role": "viewer"}, headers=bearer(t.users["owner"]))
    assert first.status_code == 201 and again.status_code == 200 and again.json()["invitation"]["code"] is None


def test_two_people_presenting_one_code_at_once_make_one_member(client: TestClient, world: World, signup: Any) -> None:
    t = world.a
    inv = invite(client, t, "owner", "viewer")
    people = [signup(f"by-race-{i}", mfa=False) for i in range(4)]
    results: list[int] = []
    barrier = threading.Barrier(4)

    def go(person: User) -> None:
        barrier.wait()
        results.append(accept(client, person, inv["code"]).status_code)

    threads = [threading.Thread(target=go, args=(p,)) for p in people]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    assert sorted(results) == [200, 400, 400, 400], results
    assert operator_sql.sql(f"select count(*) from team.invitations where id = '{inv['id']}' and status = 'accepted'") == "1"
    assert operator_sql.sql(f"select count(*) from public.memberships where tenant_id = '{t.id}' and user_id in ({','.join(repr(str(p.id)) for p in people)})") == "1"


def race_accept_and_revoke(client: TestClient, t: Tenant, person: User, inv: dict[str, Any]) -> dict[str, int]:
    out: dict[str, int] = {}
    barrier = threading.Barrier(2)

    def a() -> None:
        barrier.wait()
        out["accept"] = accept(client, person, inv["code"]).status_code

    def b() -> None:
        barrier.wait()
        out["revoke"] = client.post(url(t, f"/invitations/{inv['id']}/revoke"), headers=bearer(t.users["owner"])).status_code

    threads = [threading.Thread(target=a), threading.Thread(target=b)]
    for th in threads:
        th.start()
    for th in threads:
        th.join()
    return out


def test_accepting_racing_a_revoke_ends_one_way_or_the_other_never_both(client: TestClient, world: World, signup: Any) -> None:
    t = world.a
    for _ in range(3):
        inv = invite(client, t, "owner", "viewer")
        person = signup("by-revrace", mfa=False)
        out = race_accept_and_revoke(client, t, person, inv)
        status = operator_sql.sql(f"select status from team.invitations where id = '{inv['id']}'")
        members = operator_sql.sql(f"select count(*) from public.memberships where tenant_id = '{t.id}' and user_id = '{person.id}'")
        assert (status, members) in (("accepted", "1"), ("revoked", "0")), (status, members, out)


def test_roles_removal_and_leaving(client: TestClient, stack: Stack, world: World, signup: Any) -> None:
    t = world.a
    person = signup("by-member", mfa=False)
    assert accept(client, person, invite(client, t, "owner", "sales")["code"]).status_code == 200
    owner, admin = t.users["owner"], t.users["admin"]
    to_admin = client.post(url(t, f"/members/{person.id}/role"), json={"role": "admin", "reason": "role_changed"}, headers=bearer(owner))
    assert to_admin.status_code == 200 and to_admin.json()["changed"] is True
    assert client.post(url(t, f"/members/{person.id}/role"), json={"role": "viewer"}, headers=bearer(admin)).status_code == 403, "an Admin cannot change an Admin"
    assert client.post(url(t, f"/members/{owner.id}/role"), json={"role": "sales"}, headers=bearer(owner)).json()["error"]["code"] == "own_role"
    assert client.post(url(t, f"/members/{t.users['viewer'].id}/role"), json={"role": "sales"}, headers=bearer(t.users["sales"])).status_code == 403
    client.post(url(t, f"/members/{person.id}/role"), json={"role": "sales"}, headers=bearer(owner))
    # open work goes with them
    operator_sql.sql(f"update public.leads set owner_user_id = '{person.id}' where id = '{t.rows['leads']['id']}'")
    gone = client.post(url(t, f"/members/{person.id}/remove"), json={"reason": "no_longer_works_here"}, headers=bearer(admin))
    assert gone.status_code == 200 and gone.json()["leads_unassigned"] == 1 and gone.json()["removed"] is True
    assert client.get(url(t, "/team"), headers=bearer(person)).status_code == 404, "with the same token the former member reads nothing at once"
    assert operator_sql.sql(f"select coalesce(owner_user_id::text, 'none') from public.leads where id = '{t.rows['leads']['id']}'") == "none"
    assert client.post(url(t, f"/members/{owner.id}/remove"), json={"reason": "no_longer_works_here"}, headers=bearer(admin)).json()["error"]["code"] == "role_not_allowed"
    leaver = signup("by-leaver", mfa=False)
    assert accept(client, leaver, invite(client, t, "owner", "viewer")["code"]).status_code == 200
    left = client.post(url(t, f"/members/{leaver.id}/remove"), json={"reason": "left"}, headers={"Authorization": f"Bearer {aal1_token(stack, leaver)}"})
    assert left.status_code == 200, left.text
    sole = world.b.users["owner"]
    refused = client.post(url(world.b, f"/members/{sole.id}/remove"), json={"reason": "left"}, headers=bearer(sole))
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "keep_owner"


# ============================================================================ the shop's basics and the report
def test_the_profile_and_the_weekly_report(client: TestClient, world: World) -> None:
    t = world.a
    first = client.get(url(t, "/profile"), headers=bearer(t.users["viewer"])).json()
    assert first["setup_complete"] is False and set(first["missing"]) == {"town", "languages"}
    assert client.put(url(t, "/profile"), json={"town": "Guntur"}, headers=bearer(t.users["sales"])).status_code == 403
    saved = client.put(url(t, "/profile"), json={"name": "Ravi Silks", "town": "Guntur", "languages": ["te", "en", "te"]}, headers=bearer(t.users["admin"]))
    assert saved.status_code == 200 and saved.json()["setup_complete"] is True and saved.json()["languages"] == ["en", "te"] and saved.json()["name"] == "Ravi Silks"
    assert client.get(url(t, ""), headers=bearer(t.users["owner"])).json()["name"] == "Ravi Silks", "the shop name IS the workspace name"
    assert client.get(url(world.b, "/profile"), headers=bearer(world.b.users["owner"])).json()["town"] is None
    for user in ("sales", "viewer"):
        assert client.get(url(t, "/reports/weekly"), headers=bearer(t.users[user])).status_code == 403
    now = client.get(url(t, "/reports/weekly"), headers=bearer(t.users["owner"])).json()
    assert now["current"] is True and now["timezone"] == "Asia/Kolkata" and set(now["visits"]) == {"booked", "arrived", "bought", "will_return", "not_interested", "no_show", "cancelled"}
    assert set(now["messages"]) == {"sent", "failed", "waiting", "blocked"} and set(now["response"]) == {"asked", "answered", "unanswered", "median_seconds"} and 0 <= now["ai_usage_percent"] <= 100
    past = client.get(url(t, "/reports/weekly?week_start=2026-09-28"), headers=bearer(t.users["admin"])).json()
    assert past["week_end"] == "2026-10-04" and past["ai_usage_percent"] is None
    assert client.get(url(t, "/reports/weekly?week_start=2026-09-29"), headers=bearer(t.users["owner"])).status_code == 422
    assert client.get(url(world.b, "/reports/weekly"), headers=bearer(t.users["owner"])).status_code == 404


# ============================================================================ notifications and web-push
class PushService:
    """A browser's keys and a push service that keeps what it was sent."""

    def __init__(self) -> None:
        self.private = ec.generate_private_key(ec.SECP256R1())
        self.auth = uuid.uuid4().bytes
        self.public = b64e(self.private.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
        self.bodies: list[bytes] = []
        self.status = 201

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.bodies.append(request.content)
        return httpx.Response(self.status)


@pytest.fixture
def worker_token(stack: Stack, signup: Any) -> Iterator[str]:
    user = signup("by-worker", mfa=False)
    operator_sql.sql(f"select app.operator_register_scheduler('{user.email}')")
    # daytime in India for the business's quiet hours
    operator_sql.sql("create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '' as $b$ select (date_trunc('day', now() at time zone 'Asia/Kolkata') + interval '14 hours') at time zone 'Asia/Kolkata' $b$")
    try:
        yield PrincipalSession(f"{stack.url}/auth/v1", stack.anon_key, user.email, user.password).token()
    finally:
        operator_sql.sql("create or replace function app.outbox_now() returns timestamptz language sql stable security definer set search_path = '' as $b$ select now() $b$")
        operator_sql.sql(f"select app.operator_remove_scheduler('{user.email}')")


def make_waiting_message(t: Tenant) -> str:
    mid = uid()
    operator_sql.sql(
        f"alter table public.outbox_messages disable trigger user; insert into public.outbox_messages (id, tenant_id, lead_id, contact_id, channel, body, language, category, status, reason, request_sha256, created_by, created_at) "
        f"select '{mid}', '{t.id}', l.id, l.contact_id, 'whatsapp', 'Hello there', 'en', 'info', 'needs_approval', 'money', repeat('a', 64), '{t.users['owner'].id}', now() from public.leads l where l.tenant_id = '{t.id}' limit 1; "
        f"alter table public.outbox_messages enable trigger user;"
    )
    return mid


def test_the_feed_and_the_unread_mark(client: TestClient, world: World) -> None:
    t = world.a
    h = bearer(t.users["owner"])
    before = client.get(url(t, "/notifications"), headers=h).json()
    mid = make_waiting_message(t)
    after = client.get(url(t, "/notifications"), headers=h).json()
    assert after["total"] == before["total"] + 1 and any(i["id"] == mid and i["kind"] == "outbox_approval" and i["unread"] for i in after["items"])
    assert client.get(url(t, "/notifications"), headers=bearer(t.users["sales"])).json()["total"] == 0, "Sales have nothing to decide"
    assert client.post(url(t, "/notifications/seen"), headers=h).status_code == 200
    seen = client.get(url(t, "/notifications"), headers=h).json()
    assert seen["unread_count"] == 0 and not any(i["unread"] for i in seen["items"]) and seen["total"] == after["total"]
    assert client.get(url(t, "/notifications"), headers=bearer(t.users["admin"])).json()["unread_count"] >= 1, "the Admin's mark is the Admin's own"
    assert client.get(url(world.b, "/notifications"), headers=h).status_code == 404


def test_push_end_to_end_only_new_items_only_the_opted_in_once(client: TestClient, stack: Stack, world: World, worker_token: str) -> None:
    t = world.a
    owner, admin = bearer(t.users["owner"]), bearer(t.users["admin"])
    browser = PushService()
    sub = {"endpoint": "https://push.example.test/send/" + uid(), "keys": {"p256dh": browser.public, "auth": b64e(browser.auth)}}
    assert client.post("/v1/me/push-subscriptions", json=sub, headers=owner).status_code == 200
    assert client.post("/v1/me/push-subscriptions", json=sub, headers=admin).status_code == 200, "a shared browser: each person's own"
    repo = PostgrestNotificationsRepository(stack.rest, stack.anon_key)
    sender = WebPushSender(VapidKeys.parse(b64e(uuid.uuid4().bytes * 2), "mailto:owner@example.test"), client=httpx.Client(transport=httpx.MockTransport(browser.handler)))
    runner = PushRunner(repo, sender)
    make_waiting_message(t)
    assert runner.run(worker_token).members == 0, "nobody opted in: nothing is sent"
    assert client.put(url(t, "/notifications/push"), json={"enabled": True}, headers=owner).json() == {"enabled": True, "subscriptions": 1, "server_ready": False}
    assert runner.run(worker_token).members == 0, "what already waited when they opted in is not pushed"
    make_waiting_message(t)
    done = runner.run(worker_token)
    assert (done.members, done.sent) == (1, 1) and len(browser.bodies) == 1
    payload = json.loads(decrypt_push(browser.bodies[0], browser.private, browser.auth))
    assert payload["count"] == 1 and payload["kinds"] == {"outbox_approval": 1} and payload["tenant_id"] == t.id and "Hello there" not in json.dumps(payload) and "Ravi" not in json.dumps(payload)
    assert runner.run(worker_token).members == 0, "told once: the same item is not pushed again"
    # a browser that forgot the subscription is deleted
    make_waiting_message(t)
    browser.status = 410
    assert runner.run(worker_token).gone == 1
    assert operator_sql.sql(f"select count(*) from notify.push_subscriptions where endpoint = '{sub['endpoint']}' and user_id = '{t.users['owner'].id}'") == "0"
    assert client.put(url(t, "/notifications/push"), json={"enabled": False}, headers=owner).json()["enabled"] is False
