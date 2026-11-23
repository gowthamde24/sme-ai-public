"""Job BN on the real stack: "download my data" end to end (the real API, the real Storage, a real signed link), the workspace export, the file clean-up by the worker, account and workspace deletion
with their cooling-off, retention and grievances, with the roles, the second factor and the other business each time, and the re-accept gate. All data is synthetic."""

# ruff: noqa: E501, S608

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from collections.abc import Iterator
from typing import Any

import httpx
import operator_sql
import pytest
from conftest import Stack, User, aal1_token, bearer
from crm_support import Tenant, World
from evidence_support import uid
from fastapi.testclient import TestClient

from app.catalogue.storage import HttpStorageClient
from app.config import Settings
from app.main import create_app
from app.privacy.export_builder import WORKSPACE_TABLES
from app.privacy.housekeeping import Housekeeping
from app.privacy.repository import PostgrestPrivacyRepository
from app.scheduler.session import PrincipalSession


def url(t: Tenant, path: str) -> str:
    return f"/v1/tenants/{t.id}{path}"


def h(user: User, *, weak: bool = False, stack: Stack | None = None) -> dict[str, str]:
    if weak:
        assert stack is not None
        return {"Authorization": f"Bearer {aal1_token(stack, user)}"}
    return bearer(user)


class Worker:
    """The scheduler's principal: an account registered by the operator, signed in like the worker process does."""

    def __init__(self, stack: Stack, user: User) -> None:
        self.stack, self.user = stack, user
        self.session = PrincipalSession(f"{stack.url}/auth/v1", stack.anon_key, user.email, user.password)
        self.house = Housekeeping(PostgrestPrivacyRepository(stack.rest, stack.anon_key), HttpStorageClient(f"{stack.url}/storage/v1", stack.anon_key))

    def run(self) -> Any:
        return self.house.run(self.session.token())


@pytest.fixture(scope="module")
def worker(stack: Stack, signup: Any) -> Iterator[Worker]:
    user = signup("bn-worker", mfa=False)
    operator_sql.sql(f"select app.operator_register_scheduler('{user.email}')")
    try:
        yield Worker(stack, user)
    finally:
        operator_sql.sql(f"select app.operator_remove_scheduler('{user.email}')")


@pytest.fixture(scope="module")
def world(eval_world: World) -> World:
    return eval_world


def add_member(world: World, stack: Stack, tenant: Tenant, user: User, role: str) -> None:
    r = httpx.post(f"{stack.rest}/memberships", headers=stack.headers(tenant.users["owner"].token), json={"tenant_id": tenant.id, "user_id": str(user.id), "role": role}, timeout=15)
    assert r.status_code == 201, r.text


def make_export(client: TestClient, path: str, headers: dict[str, str], **more: Any) -> dict[str, Any]:
    r = client.post(path, json={"export_id": uid(), **more}, headers=headers)
    assert r.status_code == 202, r.text
    export: dict[str, Any] = r.json()["export"]
    return export


def zip_of(client: TestClient, user: User, export_id: str) -> tuple[bytes, dict[str, Any]]:
    link = client.post(f"/v1/me/data-exports/{export_id}/link", headers=bearer(user))
    assert link.status_code == 200, link.text
    body = link.json()
    got = httpx.get(body["url"], timeout=30)
    assert got.status_code == 200, got.text[:200]
    return got.content, body


# ============================================================================ my data
def test_a_person_downloads_their_own_data_through_a_real_signed_link(client: TestClient, stack: Stack, world: World) -> None:
    sales, viewer = world.a.users["sales"], world.a.users["viewer"]
    export = make_export(client, "/v1/me/data-exports", bearer(sales))
    got = client.get(f"/v1/me/data-exports/{export['id']}", headers=bearer(sales)).json()["export"]
    assert got["status"] == "ready" and got["scope"] == "person" and len(got["sha256"]) == 64
    content, link = zip_of(client, sales, export["id"])
    assert hashlib.sha256(content).hexdigest() == got["sha256"] == link["sha256"] and link["link_valid_seconds"] == 300 and len(content) == got["size_bytes"]
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        assert json.loads(z.read("profile.json"))["email"] == sales.email
        assert not [n for n in z.namelist() if n.startswith("tables/")], "a personal export holds no business record"
        assert viewer.email not in z.read("workspaces.json").decode() + z.read("profile.json").decode()
    # nobody else can reach it: the row, the link, or the file in storage
    assert client.get(f"/v1/me/data-exports/{export['id']}", headers=bearer(viewer)).status_code == 404
    assert client.post(f"/v1/me/data-exports/{export['id']}/link", headers=bearer(viewer)).status_code == 404
    path = f"exp-{sales.id}/{export['id']}.zip"
    assert httpx.get(f"{stack.url}/storage/v1/object/authenticated/{path}", headers=stack.headers(viewer.token), timeout=15).status_code in (400, 404)
    assert httpx.get(f"{stack.url}/storage/v1/object/authenticated/{path}", headers={"apikey": stack.anon_key}, timeout=15).status_code in (400, 401, 403, 404)
    # the same request again is a replay
    again = client.post("/v1/me/data-exports", json={"export_id": export["id"]}, headers=bearer(sales))
    assert again.status_code == 202 and again.json()["export"]["status"] == "ready"
    # the audit trail says so, without any file name or hash
    trail = operator_sql.sql(f"select string_agg(action, ',' order by id) from public.audit_events where tenant_id = '{world.a.id}' and entity_id = '{export['id']}'")
    assert "data_export.requested" in trail and "data_export.ready" in trail and "data_export.downloaded" in trail
    leak = operator_sql.sql(f"select count(*) from public.audit_events where entity_id = '{export['id']}' and (new_values::text ~* 'zip|sha|@')")
    assert leak == "0"


def test_the_workspace_export_is_the_owners_alone_and_holds_only_their_business(client: TestClient, stack: Stack, world: World) -> None:
    a, b = world.a, world.b
    typed = {"confirm_name": f"CRM {a.label}"}  # job DT (ADR 0115): the Owner types the business name
    for role in ("admin", "sales", "viewer"):
        assert client.post(url(a, "/data-exports"), json={"export_id": uid(), **typed}, headers=bearer(a.users[role])).status_code == 403, role
    assert client.post(url(a, "/data-exports"), json={"export_id": uid(), **typed}, headers=h(a.users["owner"], weak=True, stack=stack)).status_code == 403
    assert client.post(url(a, "/data-exports"), json={"export_id": uid(), **typed}, headers=bearer(b.users["owner"])).status_code == 404
    assert client.post(url(a, "/data-exports"), json={"export_id": uid(), "confirm_name": "wrong"}, headers=bearer(a.users["owner"])).status_code == 422, "a wrong name starts nothing"
    export = make_export(client, url(a, "/data-exports"), bearer(a.users["owner"]), **typed)
    assert client.get(f"/v1/me/data-exports/{export['id']}", headers=bearer(a.users["owner"])).json()["export"]["status"] == "ready"
    content, _ = zip_of(client, a.users["owner"], export["id"])
    with zipfile.ZipFile(io.BytesIO(content)) as z:
        manifest = json.loads(z.read("manifest.json"))
        assert manifest["workspace_id"] == a.id and set(manifest["tables"]) == set(WORKSPACE_TABLES)
        assert all(v != "not_readable" for v in manifest["tables"].values()), manifest["tables"]
        companies = json.loads(z.read("tables/companies.json"))
        assert a.rows["companies"]["id"] in {c["id"] for c in companies} and b.rows["companies"]["id"] not in {c["id"] for c in companies}
        everything = " ".join(z.read(n).decode() for n in z.namelist() if n.startswith("tables/"))
        assert b.id not in everything.replace(a.id, "") or b.id == a.id, "nothing of the other business is in the file"
    # a second export is a second request, and the Owner's own list shows both
    listed = client.get("/v1/me/data-exports", headers=bearer(a.users["owner"])).json()["exports"]
    assert export["id"] in {e["id"] for e in listed}


def test_every_table_with_a_workspace_column_is_in_the_export(stack: Stack) -> None:
    rows = operator_sql.sql("select c.table_name from information_schema.columns c join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE' where c.table_schema = 'public' and c.column_name = 'tenant_id' order by 1")
    tables = set(rows.split("\n"))
    assert tables == set(WORKSPACE_TABLES), f"missing from the export: {sorted(tables - set(WORKSPACE_TABLES))}; not tables: {sorted(set(WORKSPACE_TABLES) - tables)}"


def test_an_expired_export_file_is_removed_by_the_worker_and_never_linked_again(client: TestClient, stack: Stack, world: World, worker: Worker) -> None:
    owner = world.a.users["owner"]
    export = make_export(client, "/v1/me/data-exports", bearer(owner))
    content, link = zip_of(client, owner, export["id"])
    path = f"exp-{owner.id}/{export['id']}.zip"
    assert httpx.get(f"{stack.url}/storage/v1/object/authenticated/{path}", headers=stack.headers(owner.token), timeout=15).status_code == 200
    # the worker may not touch a file that has not expired
    assert worker.run().export_files_removed == 0
    assert httpx.get(f"{stack.url}/storage/v1/object/authenticated/{path}", headers=stack.headers(owner.token), timeout=15).status_code == 200
    operator_sql.sql(f"update privacy.data_exports set expires_at = now() - interval '1 minute' where id = '{export['id']}'")
    assert client.post(f"/v1/me/data-exports/{export['id']}/link", headers=bearer(owner)).status_code == 409, "an expired export gives no link"
    result = worker.run()
    assert result.export_files_removed >= 1 and result.errors == 0
    assert httpx.get(f"{stack.url}/storage/v1/object/authenticated/{path}", headers=stack.headers(owner.token), timeout=15).status_code in (400, 404)
    assert httpx.get(link["url"], timeout=15).status_code in (400, 404), "the link that was handed out no longer works"
    assert client.get(f"/v1/me/data-exports/{export['id']}", headers=bearer(owner)).json()["export"]["status"] == "expired"
    assert worker.run().export_files_removed == 0, "a second pass finds nothing"


# ============================================================================ deletion
def test_an_account_is_deleted_after_the_cooling_off_and_a_sole_owner_is_refused(client: TestClient, stack: Stack, world: World, signup: Any, worker: Worker) -> None:
    leaver = signup("bn-leaver", mfa=False)
    add_member(world, stack, world.a, leaver, "viewer")
    assert client.post("/v1/me/deletion-requests", json={"request_id": uid(), "confirm_email": "wrong@example.test"}, headers=bearer(leaver)).status_code == 422
    first = uid()
    r = client.post("/v1/me/deletion-requests", json={"request_id": first, "confirm_email": leaver.email.upper()}, headers=bearer(leaver))
    assert r.status_code == 201 and r.json()["deletion"]["status"] == "scheduled", r.text
    assert client.post("/v1/me/deletion-requests", json={"request_id": first, "confirm_email": leaver.email}, headers=bearer(leaver)).json()["deletion"]["id"] == first
    assert client.post("/v1/me/deletion-requests", json={"request_id": uid(), "confirm_email": leaver.email}, headers=bearer(leaver)).status_code == 409
    assert client.post(f"/v1/me/deletion-requests/{first}/cancel", headers=bearer(world.a.users["viewer"])).status_code == 404
    assert client.post(f"/v1/me/deletion-requests/{first}/cancel", headers=bearer(leaver)).json()["deletion"]["status"] == "cancelled"
    second = uid()
    assert client.post("/v1/me/deletion-requests", json={"request_id": second, "confirm_email": leaver.email}, headers=bearer(leaver)).status_code == 201
    worker.run()
    assert operator_sql.sql(f"select count(*) from auth.users where id = '{leaver.id}'") == "1", "the cooling-off protects the account"
    operator_sql.sql(f"update privacy.deletion_requests set requested_at = now() - interval '15 days', execute_after = now() - interval '1 minute' where id = '{second}'")
    result = worker.run()
    assert result.accounts_deleted >= 1
    assert operator_sql.sql(f"select count(*) from auth.users where id = '{leaver.id}'") == "0"
    assert operator_sql.sql(f"select count(*) from public.users where id = '{leaver.id}'") + operator_sql.sql(f"select count(*) from public.memberships where user_id = '{leaver.id}'") == "00"
    assert operator_sql.sql(f"select count(*) from public.audit_events where tenant_id = '{world.a.id}' and action = 'account.deleted' and entity_id = '{leaver.id}'") == "1"
    assert httpx.post(f"{stack.url}/auth/v1/token?grant_type=password", headers={"apikey": stack.anon_key}, json={"email": leaver.email, "password": leaver.password}, timeout=15).status_code == 400
    # the only Owner of a workspace cannot leave it behind
    sole = world.b.users["owner"]
    refused = client.post("/v1/me/deletion-requests", json={"request_id": uid(), "confirm_email": sole.email}, headers=bearer(sole))
    assert refused.status_code == 409 and refused.json()["error"]["code"] == "sole_owner"
    assert client.post("/v1/me/deletion-requests", json={"request_id": uid(), "confirm_email": sole.email}, headers=h(sole, weak=True, stack=stack)).status_code == 403, "an Owner needs the second factor"


def test_a_workspace_is_deleted_by_its_owner_after_the_cooling_off(client: TestClient, stack: Stack, signup: Any) -> None:
    owner = signup("bn-shop-owner")
    made = client.post("/v1/tenants", json={"name": "Zed Silks", "slug": f"zed-{uid()[:8]}"}, headers=bearer(owner))
    assert made.status_code == 200, made.text
    t = Tenant("Z")
    t.id = made.json()["id"]
    t.users["owner"] = owner
    path = url(t, "/deletion-requests")
    first = uid()
    assert client.post(path, json={"request_id": first, "confirm_name": "zed"}, headers=bearer(owner)).status_code == 422
    assert client.post(path, json={"request_id": first, "confirm_name": "Zed Silks"}, headers=h(owner, weak=True, stack=stack)).status_code == 403
    r = client.post(path, json={"request_id": first, "confirm_name": "Zed Silks"}, headers=bearer(owner))
    assert r.status_code == 201 and r.json()["deletion"]["status"] == "scheduled", r.text
    assert operator_sql.sql(f"select status from public.erasure_requests where id = '{first}'") == "pending"
    assert client.post(path + f"/{first}/execute", headers=bearer(owner)).json()["error"]["code"] == "cooling_off"
    assert client.post(path + f"/{first}/cancel", headers=bearer(owner)).json()["deletion"]["status"] == "cancelled"
    assert operator_sql.sql(f"select status from public.erasure_requests where id = '{first}'") == "cancelled"
    second = uid()
    assert client.post(path, json={"request_id": second, "confirm_name": "Zed Silks"}, headers=bearer(owner)).status_code == 201
    listed = client.get(path, headers=bearer(owner)).json()["deletions"]
    assert {d["id"] for d in listed} == {first, second}
    # the grievance written in this workspace is erased with it
    gid = uid()
    assert client.post(url(t, "/grievances"), json={"grievance_id": gid, "kind": "access", "subject": "Priya wants her data", "details": "phone 9876543210"}, headers=bearer(owner)).status_code == 201
    operator_sql.sql(f"update public.erasure_requests set execute_after = now() - interval '1 minute' where id = '{second}'; update privacy.deletion_requests set requested_at = now() - interval '15 days', execute_after = now() - interval '1 minute' where id = '{second}'")
    done = client.post(path + f"/{second}/execute", headers=bearer(owner))
    assert done.status_code == 200, done.text
    assert done.json()["deletion"]["status"] == "executed" and done.json()["erasure"]["status"] == "executed"
    assert operator_sql.sql(f"select subject || '|' || details from privacy.grievances where id = '{gid}'") == "erased:1|"
    assert client.post(path + f"/{second}/execute", headers=bearer(owner)).status_code == 409


# ============================================================================ retention
def test_retention_erases_old_text_and_old_rows_for_the_chosen_ages_only(client: TestClient, stack: Stack, world: World, worker: Worker) -> None:
    t = world.a
    owner = t.users["owner"]
    assert client.get(url(t, "/retention"), headers=bearer(t.users["admin"])).status_code == 200
    assert client.get(url(t, "/retention"), headers=bearer(t.users["sales"])).status_code == 403
    assert client.put(url(t, "/retention"), json={"chats_days": 60}, headers=bearer(t.users["admin"])).status_code == 403
    assert client.put(url(t, "/retention"), json={"chats_days": 60}, headers=h(owner, weak=True, stack=stack)).status_code == 403
    assert client.put(url(t, "/retention"), json={"chats_days": 10}, headers=bearer(owner)).status_code == 422
    conv, old, new, other = uid(), uid(), uid(), uid()
    operator_sql.sql(
        f"insert into public.assistant_conversations (id, tenant_id, created_by) values ('{conv}', '{t.id}', '{owner.id}');"
        f"insert into public.assistant_messages (id, tenant_id, conversation_id, seq, role, body, created_by, created_at) values "
        f"('{old}', '{t.id}', '{conv}', 1, 'user', 'a question from long ago', '{owner.id}', now() - interval '90 days'),"
        f"('{new}', '{t.id}', '{conv}', 2, 'user', 'a question from today', '{owner.id}', now() - interval '1 day');"
        f"insert into public.scheduler_runs (id, tenant_id, run_at) values ('{uid()}', '{t.id}', now() - interval '200 days'), ('{uid()}', '{t.id}', now() - interval '1 day');"
    )
    audit_old = operator_sql.sql(f"alter table public.audit_events disable trigger user; insert into public.audit_events (tenant_id, actor_type, action, entity_type, entity_id, created_at) values ('{t.id}', 'system', 'test.bn_old', 'thing', '{other}', now() - interval '900 days') returning entity_id; alter table public.audit_events enable trigger user;")
    assert other in audit_old
    # nothing is purged before an age is chosen
    worker.run()
    assert operator_sql.sql(f"select body from public.assistant_messages where id = '{old}'") == "a question from long ago"
    pre = client.post(url(t, "/retention/preview"), json={"chats_days": 60, "scheduler_days": 90, "audit_days": 730}, headers=bearer(t.users["admin"]))
    assert pre.status_code == 200 and pre.json()["counts"]["chat_messages"] >= 1 and pre.json()["counts"]["audit_events"] >= 1
    saved = client.put(url(t, "/retention"), json={"chats_days": 60, "scheduler_days": 90, "audit_days": 730}, headers=bearer(owner))
    assert saved.status_code == 200 and saved.json()["chats_days"] == 60 and saved.json()["voice_days"] is None
    result = worker.run()
    assert result.retention_workspaces >= 1 and result.errors == 0
    assert operator_sql.sql(f"select body from public.assistant_messages where id = '{old}'") == "erased:1"
    assert operator_sql.sql(f"select body from public.assistant_messages where id = '{new}'") == "a question from today"
    assert operator_sql.sql(f"select count(*) from public.scheduler_runs where tenant_id = '{t.id}' and run_at < now() - interval '100 days'") == "0"
    assert operator_sql.sql(f"select count(*) from public.scheduler_runs where tenant_id = '{t.id}'") == "1"
    assert operator_sql.sql(f"select count(*) from public.audit_events where entity_id = '{other}'") == "0"
    assert operator_sql.sql(f"select count(*) from public.audit_events where tenant_id = '{t.id}' and action = 'retention.run'") != "0"
    # the other business keeps everything
    assert operator_sql.sql(f"select count(*) from privacy.retention_settings where tenant_id = '{world.b.id}'") == "0"
    # a second pass in the same hour does nothing
    assert worker.run().retention_workspaces == 0
    # and audit rows still cannot be deleted by anybody else
    forbidden = operator_sql.sql_result(f"set role authenticated; delete from public.audit_events where tenant_id = '{t.id}'")
    assert forbidden[0] != 0 or "DELETE 0" in forbidden[1]


# ============================================================================ grievances
def test_grievances_end_to_end(client: TestClient, world: World) -> None:
    a, b = world.a, world.b
    gid = uid()
    body = {"grievance_id": gid, "kind": "correction", "subject": "My name is spelt wrongly", "details": "Please correct it", "on_behalf": True, "requester_name": "Lakshmi", "requester_contact": "lakshmi@example.test"}
    assert client.post(url(a, "/grievances"), json=body, headers=bearer(a.users["viewer"])).status_code == 403
    assert client.post(url(a, "/grievances"), json=body, headers=bearer(b.users["owner"])).status_code == 404
    r = client.post(url(a, "/grievances"), json=body, headers=bearer(a.users["sales"]))
    assert r.status_code == 201 and r.json()["grievance"]["status"] == "received" and r.json()["grievance"]["on_behalf"] is True
    assert client.post(url(a, "/grievances"), json=body, headers=bearer(a.users["sales"])).json()["grievance"]["id"] == gid
    mine = client.get(url(a, "/grievances"), headers=bearer(a.users["sales"])).json()["grievances"]
    assert [g["id"] for g in mine] == [gid]
    assert gid in {g["id"] for g in client.get(url(a, "/grievances?status=open"), headers=bearer(a.users["admin"])).json()["grievances"]}
    assert client.get(url(b, "/grievances"), headers=bearer(b.users["owner"])).json()["grievances"] == []
    assert client.get(url(b, f"/grievances/{gid}"), headers=bearer(b.users["owner"])).status_code == 404
    assert client.get(url(a, f"/grievances/{gid}"), headers=bearer(a.users["owner"])).json()["grievance"]["events"][0]["status"] == "received"
    assert client.post(url(a, f"/grievances/{gid}/status"), json={"status": "acknowledged"}, headers=bearer(a.users["sales"])).status_code == 403
    assert client.post(url(a, f"/grievances/{gid}/status"), json={"status": "resolved"}, headers=bearer(a.users["admin"])).status_code == 422
    assert client.post(url(a, f"/grievances/{gid}/status"), json={"status": "acknowledged"}, headers=bearer(a.users["admin"])).json()["grievance"]["status"] == "acknowledged"
    done = client.post(url(a, f"/grievances/{gid}/status"), json={"status": "resolved", "note": "Corrected on 5 October"}, headers=bearer(a.users["owner"]))
    assert done.status_code == 200 and done.json()["grievance"]["closed_at"] is not None
    assert client.post(url(a, f"/grievances/{gid}/status"), json={"status": "rejected", "note": "no"}, headers=bearer(a.users["owner"])).status_code == 409
    audit = operator_sql.sql(f"select string_agg(action, ',' order by id) from public.audit_events where entity_id = '{gid}'")
    assert audit == "grievance.submitted,grievance.updated,grievance.updated"
    assert operator_sql.sql(f"select count(*) from public.audit_events where entity_id = '{gid}' and new_values::text ~* 'lakshmi|spelt|corrected'") == "0"


# ============================================================================ the re-accept gate
def test_the_gate_stops_a_person_who_has_not_accepted_a_new_version(stack: Stack, world: World) -> None:
    settings = Settings(_env_file=None, api_env="development", supabase_url=stack.url, supabase_anon_key=stack.anon_key, terms_version="2099-01-01", policy_enforce=True)  # type: ignore[call-arg]
    owner = world.a.users["owner"]
    with TestClient(create_app(settings)) as gated:
        blocked = gated.get(url(world.a, "/retention"), headers=bearer(owner))
        assert blocked.status_code == 403 and blocked.json()["error"]["code"] == "policy_acceptance_required", blocked.text
        assert gated.get(f"/v1/tenants/{uid()}/retention", headers=bearer(owner)).status_code == 404, "a stranger still gets the plain 404"
        status = gated.get("/v1/me/policy-acceptances", headers=bearer(owner)).json()
        assert status["blocking"] is True and status["needs_acceptance"]["terms"] is True
        assert gated.get("/v1/me/data-exports", headers=bearer(owner)).status_code == 200, "a person's own data is never behind the gate"
        assert gated.post("/v1/me/policy-acceptances", json={"terms_version": "2000-01-01"}, headers=bearer(owner)).status_code == 409
        half = gated.post("/v1/me/policy-acceptances", json={"terms_version": "2099-01-01"}, headers=bearer(owner))
        assert half.status_code == 200 and half.json()["blocking"] is True, "the privacy notice is still to be accepted"
        accepted = gated.post("/v1/me/policy-acceptances", json={"terms_version": "2099-01-01", "privacy_version": "2026-10-01"}, headers=bearer(owner))
        assert accepted.status_code == 200 and accepted.json()["blocking"] is False, accepted.text
        assert gated.get(url(world.a, "/retention"), headers=bearer(owner)).status_code == 200
        assert gated.get(url(world.a, "/retention"), headers=bearer(world.a.users["admin"])).status_code == 403, "the admin has not accepted it"
