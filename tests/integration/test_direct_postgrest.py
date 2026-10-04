"""The API is the intended single door, but not the only one: PostgREST is reachable by anyone
holding a user JWT and the (public) anon key. These tests skip OUR API entirely and attack the data
layer directly, as real signed-in users, to prove the database itself refuses. Every attack must be
denied by RLS, a column privilege or a trigger (HTTP 401/403 with SQLSTATE 42501, or a filtered
write that touches 0 rows), and the victim data must be unchanged afterwards."""

from __future__ import annotations

from typing import Any

import httpx
import pytest
from conftest import Stack, User
from crm_support import ENTITIES, Tenant, World, uid

CRM_TABLES = ["companies", "contacts", "products", "leads", "opportunities", "consent_events"]
SEE_ALSO = [*CRM_TABLES, "audit_events", "memberships"]


@pytest.fixture
def w(crm_world: World) -> World:
    return crm_world


def pg(
    stack: Stack,
    user: User | None,
    method: str,
    path: str,
    *,
    json: Any = None,
    representation: bool = True,
) -> httpx.Response:
    extra = {"Prefer": "return=representation"} if representation else {}
    return httpx.request(
        method,
        f"{stack.rest}{path}",
        headers=stack.headers(user.token if user else None, **extra),
        json=json,
        timeout=20,
    )


def code_of(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return ""
    return str(body.get("code", "")) if isinstance(body, dict) else ""


def denied(response: httpx.Response) -> bool:
    """Refused by privilege/RLS (401/403 + 42501), or a filtered write that touched nothing."""
    if response.status_code in (401, 403):
        return code_of(response) == "42501"
    return response.status_code == 200 and response.json() == []


def failed(response: httpx.Response) -> bool:
    """Denied, or refused by an integrity rule (the write did not happen either way)."""
    return denied(response) or (response.status_code in (400, 409) and code_of(response) != "")


def snapshot(w: World, tenant: Tenant, entity: str, row_id: str) -> Any:
    r = w.call(tenant.users["owner"], "GET", tenant, entity, f"/{row_id}")
    assert r.status_code == 200
    return r.json()


def count(w: World, tenant: Tenant, entity: str) -> int:
    r = w.call(
        tenant.users["owner"],
        "GET",
        tenant,
        entity,
        params={"limit": 100, "include_archived": "true"},
    )
    return len(r.json()["items"])


def insert_payload(
    entity: str, tenant: Tenant, target_tenant_id: str, parents: Tenant
) -> dict[str, Any]:
    """A well-formed insert for `entity` aimed at `target_tenant_id` (parents from `parents`)."""
    rid = uid()
    company = parents.rows["companies"]["id"]
    return {
        "companies": {"id": rid, "tenant_id": target_tenant_id, "name": f"Direct {rid[:6]}"},
        "contacts": {
            "id": rid,
            "tenant_id": target_tenant_id,
            "full_name": "Direct",
            "company_id": company,
        },
        "products": {
            "id": rid,
            "tenant_id": target_tenant_id,
            "sku": f"D-{rid[:8]}",
            "name": "Direct",
        },
        "leads": {"id": rid, "tenant_id": target_tenant_id, "company_id": company},
        "opportunities": {
            "id": rid,
            "tenant_id": target_tenant_id,
            "company_id": company,
            "title": "Direct",
        },
        "consent_events": {
            "id": rid,
            "tenant_id": target_tenant_id,
            "contact_id": parents.rows["contacts"]["id"],
            "event_type": "withdrawn",
            "channel": "email",
        },
    }[entity]


def both_directions(w: World) -> list[tuple[Tenant, Tenant, str, User]]:
    out = [(w.a, w.b, role, user) for role, user in w.a.users.items()]
    out += [(w.b, w.a, role, user) for role, user in w.b.users.items()]
    return out


# ==== 1. reading another tenant's rows ====
@pytest.mark.parametrize("table", SEE_ALSO)
def test_other_tenants_rows_are_invisible(w: World, table: str) -> None:
    for own, other, role, user in both_directions(w):
        label = f"{own.label}/{role}/{table}"
        scoped = pg(w.stack, user, "GET", f"/{table}?tenant_id=eq.{other.id}&select=*")
        assert scoped.status_code == 200 and scoped.json() == [], label
        everything = pg(w.stack, user, "GET", f"/{table}?select=tenant_id&limit=1000")
        assert everything.status_code == 200, label
        assert {row["tenant_id"] for row in everything.json()} <= {own.id}, (
            f"{label}: saw another tenant"
        )
        if table in ENTITIES:
            foreign = other.rows[table]["id"]
            by_id = pg(w.stack, user, "GET", f"/{table}?id=eq.{foreign}")
            assert by_id.status_code == 200 and by_id.json() == [], label
        embed = pg(
            w.stack,
            user,
            "GET",
            f"/{table}?select=*&order=created_at.desc&limit=1000"
            if table != "memberships"
            else "/memberships?select=*&limit=1000",
        )
        assert all(row.get("tenant_id") == own.id for row in embed.json()), label


def test_other_tenants_row_is_invisible_via_embedding_and_filters(w: World) -> None:
    for own, other, role, user in both_directions(w):
        # try to reach the other tenant through relationships and OR-filters
        r = pg(
            w.stack,
            user,
            "GET",
            f"/leads?select=id,companies(id,name)&or=(tenant_id.eq.{other.id},tenant_id.eq.{own.id})",
        )
        assert r.status_code == 200, role
        assert all(row["id"] != other.rows["leads"]["id"] for row in r.json()), role
        r = pg(w.stack, user, "GET", f"/tenants?id=eq.{other.id}")
        assert r.status_code == 200 and r.json() == [], role
        r = pg(w.stack, user, "GET", f"/users?select=id&id=eq.{other.users['owner'].id}")
        assert r.status_code == 200 and r.json() == [], role


# ========================================== 2. inserting with another tenant's tenant_id
@pytest.mark.parametrize("entity", CRM_TABLES)
def test_cannot_insert_a_row_into_another_tenant(w: World, entity: str) -> None:
    for own, other, role, user in both_directions(w):
        before = count(w, other, entity) if entity != "consent_events" else None
        body = insert_payload(entity, own, other.id, other)
        r = pg(w.stack, user, "POST", f"/{entity}", json=body, representation=False)
        assert denied(r), (own.label, role, entity, r.status_code, r.text[:80])
        if before is not None:
            assert count(w, other, entity) == before, "nothing landed in the other tenant"


@pytest.mark.parametrize("entity", ["contacts", "leads", "opportunities"])
def test_cannot_smuggle_a_foreign_parent_into_my_own_tenant(w: World, entity: str) -> None:
    owner = w.a.users["owner"]
    body = insert_payload(entity, w.a, w.a.id, w.b)  # my tenant_id, but tenant B's company
    r = pg(w.stack, owner, "POST", f"/{entity}", json=body, representation=False)
    assert failed(r) and r.status_code != 201, (entity, r.status_code)
    assert code_of(r) == "23503", "the composite foreign key refuses it"
    assert pg(w.stack, owner, "GET", f"/{entity}?id=eq.{body['id']}").json() == []


def test_cannot_move_a_row_to_another_tenant(w: World) -> None:
    owner = w.a.users["owner"]
    row = w.a.rows["companies"]["id"]
    before = snapshot(w, w.a, "companies", row)
    r = pg(w.stack, owner, "PATCH", f"/companies?id=eq.{row}", json={"tenant_id": w.b.id})
    assert denied(r), r.text[:80]
    assert snapshot(w, w.a, "companies", row) == before
    assert w.call(w.b.users["owner"], "GET", w.b, "companies", f"/{row}").status_code == 404


# =============================================================== 3. forging provenance
@pytest.mark.parametrize("field", ["created_via", "created_by", "created_at", "updated_at"])
@pytest.mark.parametrize("entity", ENTITIES)
def test_cannot_forge_server_owned_columns(w: World, entity: str, field: str) -> None:
    for role in ("owner", "admin", "sales"):
        user = w.a.users[role]
        value = {
            "created_via": "agent",
            "created_by": str(w.b.users["owner"].id),
            "created_at": "2001-01-01T00:00:00Z",
            "updated_at": "2001-01-01T00:00:00Z",
        }[field]
        insert = insert_payload(entity, w.a, w.a.id, w.a)
        r = pg(
            w.stack, user, "POST", f"/{entity}", json={**insert, field: value}, representation=False
        )
        assert denied(r), (role, entity, field, r.status_code)
        assert pg(w.stack, user, "GET", f"/{entity}?id=eq.{insert['id']}").json() == []
        row = w.a.rows[entity]["id"]
        before = snapshot(w, w.a, entity, row)
        r = pg(w.stack, user, "PATCH", f"/{entity}?id=eq.{row}", json={field: value})
        assert denied(r), (role, entity, field, r.status_code)
        assert snapshot(w, w.a, entity, row) == before


# =========================================== 4. consent / suppression columns on contacts
CONSENT_COLUMNS = {
    "email_consent": "granted",
    "whatsapp_consent": "granted",
    "phone_consent": "granted",
    "suppressed_at": "2026-01-01T00:00:00Z",
    "suppression_reason": "manual",
}


@pytest.mark.parametrize("column", list(CONSENT_COLUMNS))
def test_consent_and_suppression_columns_are_not_writable(w: World, column: str) -> None:
    contact = w.a.rows["contacts"]["id"]
    before = snapshot(w, w.a, "contacts", contact)
    for role in ("owner", "admin", "sales"):
        user = w.a.users[role]
        r = pg(
            w.stack,
            user,
            "PATCH",
            f"/contacts?id=eq.{contact}",
            json={column: CONSENT_COLUMNS[column]},
        )
        assert denied(r), (role, column, r.status_code)
        insert = insert_payload("contacts", w.a, w.a.id, w.a)
        r = pg(
            w.stack,
            user,
            "POST",
            "/contacts",
            json={**insert, column: CONSENT_COLUMNS[column]},
            representation=False,
        )
        assert denied(r), (role, column, r.status_code)
    assert snapshot(w, w.a, "contacts", contact) == before


def test_the_consent_ledger_cannot_be_written_directly(w: World) -> None:
    owner = w.a.users["owner"]
    body = insert_payload("consent_events", w.a, w.a.id, w.a)
    assert denied(pg(w.stack, owner, "POST", "/consent_events", json=body, representation=False))
    assert denied(
        pg(
            w.stack,
            owner,
            "PATCH",
            f"/consent_events?contact_id=eq.{w.a.rows['contacts']['id']}",
            json={"channel": "phone"},
        )
    )


# ================================================================================ 5. DELETE
@pytest.mark.parametrize("table", CRM_TABLES)
def test_delete_is_denied_on_every_crm_table(w: World, table: str) -> None:
    for own, _, role, user in both_directions(w):
        if table == "consent_events":
            continue_ids = []
        else:
            continue_ids = [own.rows[table]["id"]]
        before = count(w, own, table) if table != "consent_events" else None
        for row_id in continue_ids:
            r = pg(w.stack, user, "DELETE", f"/{table}?id=eq.{row_id}")
            assert denied(r), (own.label, role, table, r.status_code, r.text[:80])
        r = pg(w.stack, user, "DELETE", f"/{table}?tenant_id=eq.{own.id}")
        assert denied(r), (own.label, role, table, "bulk", r.status_code)
        r = pg(w.stack, user, "DELETE", f"/{table}?id=not.is.null")
        assert denied(r), (own.label, role, table, "no scope", r.status_code)
        if before is not None:
            assert count(w, own, table) == before, (
                f"{own.label}/{role}: rows disappeared from {table}"
            )


def test_anon_key_alone_can_do_nothing(w: World) -> None:
    for table in CRM_TABLES:
        for method, body in (
            ("GET", None),
            ("POST", {"tenant_id": w.a.id}),
            ("PATCH", {"tenant_id": w.a.id}),
            ("DELETE", None),
        ):
            scope = f"?tenant_id=eq.{w.a.id}" if method in ("PATCH", "DELETE") else ""
            r = pg(w.stack, None, method, f"/{table}{scope}", json=body)
            assert r.status_code in (401, 403) and code_of(r) == "42501", (
                table,
                method,
                r.status_code,
            )


# ============================================= 6. consent functions on another tenant's contact
@pytest.mark.parametrize("function", ["record_consent", "suppress_contact", "lift_suppression"])
def test_consent_functions_refuse_another_tenants_contact(w: World, function: str) -> None:
    target = w.b.rows["contacts"]["id"]
    before = snapshot(w, w.b, "contacts", target)
    args: dict[str, dict[str, Any]] = {
        "record_consent": {"p_channel": "email", "p_status": "withdrawn"},
        "suppress_contact": {"p_reason": "manual"},
        "lift_suppression": {"p_evidence_type": "written", "p_evidence_ref": "letter:1"},
    }
    for role, user in w.a.users.items():
        # naming tenant B: I am not a member there -> 42501
        r = pg(
            w.stack,
            user,
            "POST",
            f"/rpc/{function}",
            json={"p_tenant_id": w.b.id, "p_contact_id": target, **args[function]},
        )
        assert r.status_code in (401, 403) and code_of(r) == "42501", (
            role,
            function,
            r.status_code,
            r.text[:80],
        )
        # naming MY tenant but B's contact -> not found (or refused by role), never success
        r = pg(
            w.stack,
            user,
            "POST",
            f"/rpc/{function}",
            json={"p_tenant_id": w.a.id, "p_contact_id": target, **args[function]},
        )
        assert r.status_code >= 400 and code_of(r) in ("P0002", "42501"), (
            role,
            function,
            r.status_code,
            r.text[:80],
        )
    anon = pg(
        w.stack,
        None,
        "POST",
        f"/rpc/{function}",
        json={"p_tenant_id": w.b.id, "p_contact_id": target, **args[function]},
    )
    assert anon.status_code in (401, 403)
    assert snapshot(w, w.b, "contacts", target) == before
    ledger = pg(
        w.stack, w.b.users["owner"], "GET", f"/consent_events?contact_id=eq.{target}&select=id"
    ).json()
    assert not [
        e for e in ledger if e.get("recorded_by") in {str(u.id) for u in w.a.users.values()}
    ]


def test_consent_functions_refuse_a_viewer_in_their_own_tenant(w: World) -> None:
    viewer = w.a.users["viewer"]
    target = w.a.rows["contacts"]["id"]
    before = snapshot(w, w.a, "contacts", target)
    for function, extra in (
        ("record_consent", {"p_channel": "email", "p_status": "withdrawn"}),
        ("suppress_contact", {"p_reason": "manual"}),
        ("lift_suppression", {"p_evidence_type": "written", "p_evidence_ref": "letter:1"}),
    ):
        r = pg(
            w.stack,
            viewer,
            "POST",
            f"/rpc/{function}",
            json={"p_tenant_id": w.a.id, "p_contact_id": target, **extra},
        )
        assert r.status_code in (401, 403) and code_of(r) == "42501", (function, r.status_code)
    assert snapshot(w, w.a, "contacts", target) == before


# ===================================================================== 7. a Viewer writing
@pytest.mark.parametrize("entity", ENTITIES)
def test_a_viewer_cannot_write_anything_directly(w: World, entity: str) -> None:
    for tenant in (w.a, w.b):
        viewer = tenant.users["viewer"]
        row = tenant.rows[entity]["id"]
        before = snapshot(w, tenant, entity, row)
        n = count(w, tenant, entity)
        assert denied(
            pg(
                w.stack,
                viewer,
                "POST",
                f"/{entity}",
                json=insert_payload(entity, tenant, tenant.id, tenant),
                representation=False,
            )
        ), (tenant.label, entity)
        changes = {
            "companies": {"city": "X"},
            "contacts": {"job_title": "X"},
            "products": {"category": "x"},
            "leads": {"source": "x"},
            "opportunities": {"title": "x"},
        }[entity]
        assert denied(pg(w.stack, viewer, "PATCH", f"/{entity}?id=eq.{row}", json=changes)), (
            tenant.label,
            entity,
        )
        assert denied(
            pg(
                w.stack,
                viewer,
                "PATCH",
                f"/{entity}?id=eq.{row}",
                json={"archived_at": "2026-01-01T00:00:00Z"},
            )
        ), (tenant.label, entity)
        assert denied(pg(w.stack, viewer, "DELETE", f"/{entity}?id=eq.{row}")), (
            tenant.label,
            entity,
        )
        assert snapshot(w, tenant, entity, row) == before
        assert count(w, tenant, entity) == n


# ===================================================================== 8. Sales archiving
@pytest.mark.parametrize("entity", ["companies", "contacts", "leads", "opportunities"])
def test_sales_cannot_archive_or_restore_directly(w: World, entity: str) -> None:
    sales, admin = w.a.users["sales"], w.a.users["admin"]
    row = w.a.rows[entity]["id"]
    before = snapshot(w, w.a, entity, row)
    r = pg(
        w.stack,
        sales,
        "PATCH",
        f"/{entity}?id=eq.{row}",
        json={"archived_at": "2026-01-01T00:00:00Z"},
    )
    assert r.status_code in (401, 403) and code_of(r) == "42501", (
        entity,
        r.status_code,
        r.text[:80],
    )
    assert snapshot(w, w.a, entity, row) == before and before["archived_at"] is None

    archived = w.call(admin, "POST", w.a, entity, f"/{row}/archive")
    assert archived.status_code == 200
    try:
        r = pg(w.stack, sales, "PATCH", f"/{entity}?id=eq.{row}", json={"archived_at": None})
        assert r.status_code in (401, 403) and code_of(r) == "42501", (
            entity,
            "restore",
            r.status_code,
        )
        assert snapshot(w, w.a, entity, row)["archived_at"] is not None, "still archived"
    finally:
        assert w.call(admin, "POST", w.a, entity, f"/{row}/restore").status_code == 200


def test_sales_cannot_touch_products_at_all(w: World) -> None:
    sales = w.a.users["sales"]
    row = w.a.rows["products"]["id"]
    before = snapshot(w, w.a, "products", row)
    assert denied(
        pg(
            w.stack,
            sales,
            "PATCH",
            f"/products?id=eq.{row}",
            json={"archived_at": "2026-01-01T00:00:00Z"},
        )
    )
    assert denied(pg(w.stack, sales, "PATCH", f"/products?id=eq.{row}", json={"name": "x"}))
    assert denied(
        pg(
            w.stack,
            sales,
            "POST",
            "/products",
            json=insert_payload("products", w.a, w.a.id, w.a),
            representation=False,
        )
    )
    assert snapshot(w, w.a, "products", row) == before


def test_an_opportunity_cannot_be_reopened_or_jumped_directly_by_sales(w: World) -> None:
    sales, admin = w.a.users["sales"], w.a.users["admin"]
    company = w.a.rows["companies"]["id"]
    opp = w.call(
        sales,
        "POST",
        w.a,
        "opportunities",
        json={"id": uid(), "company_id": company, "title": "Direct status"},
    ).json()["id"]
    r = pg(
        w.stack,
        sales,
        "PATCH",
        f"/opportunities?id=eq.{opp}",
        json={"status": "lost", "lost_reason": "x"},
    )
    assert r.status_code == 200 and r.json()[0]["status"] == "lost"
    r = pg(w.stack, sales, "PATCH", f"/opportunities?id=eq.{opp}", json={"status": "won"})
    assert r.status_code == 400 and code_of(r) == "SM001", (
        "terminal: the dedicated SQLSTATE comes through PostgREST"
    )
    r = pg(w.stack, sales, "PATCH", f"/opportunities?id=eq.{opp}", json={"status": "open"})
    assert r.status_code in (401, 403) and code_of(r) == "42501"
    r = pg(w.stack, admin, "PATCH", f"/opportunities?id=eq.{opp}", json={"status": "open"})
    assert r.status_code == 200 and r.json()[0]["status"] == "open"
    forged = pg(
        w.stack,
        sales,
        "PATCH",
        f"/opportunities?id=eq.{opp}",
        json={"closed_at": "2001-01-01T00:00:00Z"},
    )
    assert denied(forged)


def test_a_suppressed_contact_cannot_be_granted_even_directly(w: World) -> None:
    sales, admin = w.a.users["sales"], w.a.users["admin"]
    cid = w.call(
        sales,
        "POST",
        w.a,
        "contacts",
        json={
            "id": uid(),
            "full_name": "Direct SM002",
            "email": f"sm2-{uid()}@it.example.test",
            "company_id": w.a.rows["companies"]["id"],
        },
    ).json()["id"]
    assert (
        w.call(
            sales, "POST", w.a, "contacts", f"/{cid}/suppress", json={"reason": "manual"}
        ).status_code
        == 200
    )
    r = pg(
        w.stack,
        sales,
        "POST",
        "/rpc/record_consent",
        json={
            "p_tenant_id": w.a.id,
            "p_contact_id": cid,
            "p_channel": "email",
            "p_status": "granted",
            "p_basis": "explicit_consent",
            "p_evidence_type": "web_form",
            "p_evidence_ref": "form:1",
        },
    )
    assert r.status_code == 400 and code_of(r) == "SM002"
    assert w.call(admin, "GET", w.a, "contacts", f"/{cid}").json()["email_consent"] == "unknown"


def test_postgrest_never_exposes_other_schemas_to_these_users(w: World) -> None:
    user = w.a.users["owner"]
    for schema in ("app", "auth", "extensions", "storage"):
        r = httpx.get(
            f"{w.stack.rest}/companies",
            headers={**w.stack.headers(user.token), "Accept-Profile": schema},
            timeout=15,
        )
        assert r.status_code == 406, schema
