"""CRM API end to end: real JWTs, real PostgREST, real database rules.

Two tenants, seven users (A: owner/admin/sales/viewer, B: owner/sales/viewer). Every endpoint family
is looped over every role of every tenant: cross-tenant access is always 404 (never data), a role
that is too low inside its own tenant is 403, the rest succeeds. Also: idempotent create, identical
errors for foreign vs nonexistent references, keyset pagination under timestamp ties, archive rules,
opportunity transitions, the consent flows (including the opt-out withdrawal), and a PII canary that
must never appear in any response body or any log line.
"""

from __future__ import annotations

import json
import logging
import uuid
from pathlib import Path
from typing import Any

import httpx
import jsonschema
import pytest
from conftest import Stack, User, bearer
from fastapi.testclient import TestClient

SCHEMA = json.loads(
    (Path(__file__).resolve().parents[2] / "packages/contracts/crm.schema.json").read_text()
)

ENTITIES = ["companies", "contacts", "products", "leads", "opportunities"]
OUT_DEF = {
    "companies": "CompanyOut",
    "contacts": "ContactOut",
    "products": "ProductOut",
    "leads": "LeadOut",
    "opportunities": "OpportunityOut",
}
ADMIN_PLUS = {"owner", "admin"}
SALES_PLUS = {"owner", "admin", "sales"}
WRITERS = {
    "companies": SALES_PLUS,
    "contacts": SALES_PLUS,
    "products": ADMIN_PLUS,
    "leads": SALES_PLUS,
    "opportunities": SALES_PLUS,
}


def uid() -> str:
    return str(uuid.uuid4())


def check_schema(instance: Any, definition: str) -> None:
    jsonschema.Draft202012Validator(
        {"$schema": SCHEMA["$schema"], "$ref": f"#/$defs/{definition}", "$defs": SCHEMA["$defs"]},
        format_checker=jsonschema.FormatChecker(),
    ).validate(instance)


class Tenant:
    def __init__(self, label: str) -> None:
        self.label = label
        self.id = ""
        self.users: dict[str, User] = {}
        self.rows: dict[str, dict[str, Any]] = {}  # base row per entity, created by the owner


def create_payload(
    entity: str, t: Tenant, row_id: str | None = None, **over: Any
) -> dict[str, Any]:
    rid = row_id or uid()
    company = t.rows.get("companies", {}).get("id")
    contact = t.rows.get("contacts", {}).get("id")
    bases: dict[str, dict[str, Any]] = {
        "companies": {"id": rid, "name": f"Company {rid[:8]}"},
        "contacts": {
            "id": rid,
            "full_name": f"Person {rid[:8]}",
            "email": f"{rid}@it.example.test",
            "company_id": company,
        },
        "products": {"id": rid, "sku": f"SKU-{rid[:12]}", "name": f"Product {rid[:8]}"},
        "leads": {"id": rid, "company_id": company, "contact_id": contact},
        "opportunities": {
            "id": rid,
            "company_id": company,
            "contact_id": contact,
            "title": f"Deal {rid[:8]}",
        },
    }
    return {**bases[entity], **over}


UPDATES = {
    "companies": {"city": "Chennai"},
    "contacts": {"job_title": "Buyer"},
    "products": {"category": "silk"},
    "leads": {"source": "trade fair"},
    "opportunities": {"title": "Renamed deal"},
}


class World:
    def __init__(self, client: TestClient, stack: Stack, signup: Any) -> None:
        self.client, self.stack = client, stack
        self.a, self.b = Tenant("A"), Tenant("B")
        for tenant, roles in (
            (self.a, ["owner", "admin", "sales", "viewer"]),
            (self.b, ["owner", "sales", "viewer"]),
        ):
            for role in roles:
                tenant.users[role] = signup(f"crm-{tenant.label.lower()}-{role}")
            owner = tenant.users["owner"]
            created = client.post(
                "/v1/tenants",
                json={
                    "name": f"CRM {tenant.label}",
                    "slug": f"crm-{tenant.label.lower()}-{uid()[:8]}",
                },
                headers=bearer(owner),
            )
            assert created.status_code == 200, created.text
            tenant.id = created.json()["id"]
            for role, user in tenant.users.items():
                if role != "owner":
                    added = httpx.post(
                        f"{stack.rest}/memberships",
                        headers=stack.headers(owner.token),
                        json={"tenant_id": tenant.id, "user_id": str(user.id), "role": role},
                        timeout=15,
                    )
                    assert added.status_code == 201, added.text
            for entity in ENTITIES:  # one base row per entity, parents first
                r = self.call(owner, "POST", tenant, entity, json=create_payload(entity, tenant))
                assert r.status_code == 201, (entity, r.text)
                tenant.rows[entity] = r.json()

    def path(self, tenant: Tenant | str, entity: str, suffix: str = "") -> str:
        tid = tenant if isinstance(tenant, str) else tenant.id
        return f"/v1/tenants/{tid}/{entity}{suffix}"

    def call(
        self,
        user: User,
        method: str,
        tenant: Tenant | str,
        entity: str,
        suffix: str = "",
        **kw: Any,
    ) -> httpx.Response:
        response: httpx.Response = self.client.request(
            method, self.path(tenant, entity, suffix), headers=bearer(user), **kw
        )
        return response


@pytest.fixture(scope="module")
def world(client: TestClient, stack: Stack, signup: Any) -> World:
    return World(client, stack, signup)


def everyone(w: World) -> list[tuple[Tenant, Tenant, str, User]]:
    """(own tenant, other tenant, role, user) for every user of both tenants."""
    out = [(w.a, w.b, role, user) for role, user in w.a.users.items()]
    out += [(w.b, w.a, role, user) for role, user in w.b.users.items()]
    return out


# ================================================================ role matrix, every endpoint
@pytest.mark.parametrize("entity", ENTITIES)
def test_role_matrix_for_every_user_of_both_tenants(world: World, entity: str) -> None:
    w = world
    for own, _, role, user in everyone(w):
        base = own.rows[entity]["id"]
        label = f"{own.label}/{role}/{entity}"

        listing = w.call(user, "GET", own, entity)
        assert listing.status_code == 200, label
        check_schema(listing.json(), f"Page_{OUT_DEF[entity]}_")
        got = w.call(user, "GET", own, entity, f"/{base}")
        assert got.status_code == 200, label
        check_schema(got.json(), OUT_DEF[entity])

        created = w.call(user, "POST", own, entity, json=create_payload(entity, own))
        assert created.status_code == (201 if role in WRITERS[entity] else 403), (
            label,
            created.text,
        )
        updated = w.call(user, "PATCH", own, entity, f"/{base}", json=UPDATES[entity])
        assert updated.status_code == (200 if role in WRITERS[entity] else 403), (
            label,
            updated.text,
        )

        archived = w.call(user, "POST", own, entity, f"/{base}/archive")
        assert archived.status_code == (200 if role in ADMIN_PLUS else 403), (label, archived.text)
        if role in ADMIN_PLUS:
            assert archived.json()["archived_at"] is not None
            restored = w.call(user, "POST", own, entity, f"/{base}/restore")
            assert restored.status_code == 200 and restored.json()["archived_at"] is None
        else:
            restored = w.call(user, "POST", own, entity, f"/{base}/restore")
            assert restored.status_code == 403, label
        # a failed or successful write by anyone never moves the row to another tenant
        assert w.call(user, "DELETE", own, entity, f"/{base}").status_code == 405


@pytest.mark.parametrize("role", ["owner", "admin", "sales", "viewer"])
def test_consent_endpoints_roles(world: World, role: str) -> None:
    w = world
    user = w.a.users[role]
    contact = w.a.rows["contacts"]["id"]
    ref = {"evidence_type": "web_form", "evidence_ref": "form:1"}
    grant = {"channel": "email", "status": "granted", "basis": "explicit_consent", **ref}
    r1 = w.call(user, "POST", w.a, "contacts", f"/{contact}/record-consent", json=grant)
    r2 = w.call(user, "POST", w.a, "contacts", f"/{contact}/suppress", json={"reason": "manual"})
    r3 = w.call(
        user,
        "POST",
        w.a,
        "contacts",
        f"/{contact}/lift-suppression",
        json={"evidence_type": "written", "evidence_ref": "letter:1"},
    )
    assert r1.status_code == (200 if role in SALES_PLUS else 403), r1.text
    assert r2.status_code == (200 if role in SALES_PLUS else 403), r2.text
    assert r3.status_code == (200 if role in ADMIN_PLUS else 403), r3.text
    for r in (r1, r2, r3):
        if r.status_code == 200:
            check_schema(r.json(), "ConsentResultOut")


# ==== cross-tenant: always 404, never data, no effect ====
@pytest.mark.parametrize("entity", ENTITIES)
def test_every_endpoint_answers_404_for_the_other_tenants_data(world: World, entity: str) -> None:
    w = world
    for own, other, role, user in everyone(w):
        foreign = other.rows[entity]["id"]
        before = w.call(other.users["owner"], "GET", other, entity, f"/{foreign}").json()
        before_count = len(
            w.call(
                other.users["owner"], "GET", other, entity, "?limit=100&include_archived=true"
            ).json()["items"]
        )
        label = f"{own.label}/{role}/{entity}"
        answers = [
            w.call(user, "GET", other, entity),
            w.call(user, "POST", other, entity, json=create_payload(entity, other)),
            w.call(user, "GET", other, entity, f"/{foreign}"),
            w.call(user, "PATCH", other, entity, f"/{foreign}", json=UPDATES[entity]),
            w.call(user, "POST", other, entity, f"/{foreign}/archive"),
            w.call(user, "POST", other, entity, f"/{foreign}/restore"),
            # the other tenant's row id through MY tenant's path
            w.call(user, "GET", own, entity, f"/{foreign}"),
            w.call(user, "PATCH", own, entity, f"/{foreign}", json=UPDATES[entity]),
            w.call(user, "POST", own, entity, f"/{foreign}/archive"),
        ]
        # OTHER tenant's path: always 404. MY tenant's path: my role first (403 if too low),
        # then the row (404). Never data either way.
        expected = [404] * 7 + [
            404 if role in WRITERS[entity] else 403,
            404 if role in ADMIN_PLUS else 403,
        ]
        assert [a.status_code for a in answers] == expected, (
            label,
            [a.status_code for a in answers],
        )
        assert len({a.text for a in answers[:6]}) == 1, label
        for a in answers:
            assert foreign not in a.text
        after = w.call(other.users["owner"], "GET", other, entity, f"/{foreign}").json()
        assert after == before, f"{label}: the other tenant's row changed"
        assert (
            len(
                w.call(
                    other.users["owner"], "GET", other, entity, "?limit=100&include_archived=true"
                ).json()["items"]
            )
            == before_count
        ), label


def test_consent_endpoints_are_404_across_tenants(world: World) -> None:
    w = world
    foreign = w.b.rows["contacts"]["id"]
    record = {"channel": "email", "status": "withdrawn"}
    suppress = {"reason": "manual"}
    lift = {"evidence_type": "written", "evidence_ref": "letter:1"}
    for _, _, role, user in [e for e in everyone(w) if e[0] is w.a]:
        # the other tenant's path: always 404
        for action, body in (
            ("record-consent", record),
            ("suppress", suppress),
            ("lift-suppression", lift),
        ):
            r = w.call(user, "POST", w.b, "contacts", f"/{foreign}/{action}", json=body)
            assert r.status_code == 404, (role, action)
        # my tenant's path with the other tenant's contact id: my role first, then the row
        sales_plus, admin_plus = role in SALES_PLUS, role in ADMIN_PLUS
        r = w.call(user, "POST", w.a, "contacts", f"/{foreign}/record-consent", json=record)
        assert r.status_code == (404 if sales_plus else 403), role
        r = w.call(user, "POST", w.a, "contacts", f"/{foreign}/suppress", json=suppress)
        assert r.status_code == (404 if sales_plus else 403), role
        r = w.call(user, "POST", w.a, "contacts", f"/{foreign}/lift-suppression", json=lift)
        assert r.status_code == (404 if admin_plus else 403), role
    owner_b = w.call(w.b.users["owner"], "GET", w.b, "contacts", f"/{foreign}").json()
    assert owner_b["suppressed_at"] is None and owner_b["email_consent"] == "unknown"


# ======================================================================== idempotent create
@pytest.mark.parametrize("entity", ENTITIES)
def test_create_is_idempotent_and_ids_do_not_leak_across_tenants(world: World, entity: str) -> None:
    w = world
    owner_a, owner_b = w.a.users["owner"], w.b.users["owner"]
    payload = create_payload(entity, w.a)
    first = w.call(owner_a, "POST", w.a, entity, json=payload)
    again = w.call(owner_a, "POST", w.a, entity, json=payload)
    assert (first.status_code, again.status_code) == (201, 200), (first.text, again.text)
    assert first.json() == again.json()
    check_schema(first.json(), OUT_DEF[entity])

    other_field = {
        "companies": {"name": "Changed"},
        "contacts": {"full_name": "Changed"},
        "products": {"name": "Changed"},
        "leads": {"source": "Changed"},
        "opportunities": {"title": "Changed"},
    }[entity]
    mismatch = w.call(owner_a, "POST", w.a, entity, json={**payload, **other_field})
    assert mismatch.status_code == 409 and mismatch.json()["error"]["code"] == "conflict"

    # B tries to create a row with A's id: the SAME generic 409, and B learns nothing
    stolen = w.call(
        owner_b, "POST", w.b, entity, json=create_payload(entity, w.b, row_id=payload["id"])
    )
    assert stolen.status_code == 409
    assert stolen.json() == mismatch.json(), "foreign id and payload mismatch are indistinguishable"
    assert w.call(owner_b, "GET", w.b, entity, f"/{payload['id']}").status_code == 404
    assert w.call(owner_a, "GET", w.a, entity, f"/{payload['id']}").json() == first.json()


def test_unique_values_are_per_tenant(world: World) -> None:
    w = world
    email = f"shared-{uid()}@it.example.test"
    sku = f"SHARED-{uid()[:8]}"
    c1 = w.call(
        w.a.users["sales"],
        "POST",
        w.a,
        "contacts",
        json={"id": uid(), "full_name": "One", "email": email},
    )
    dup = w.call(
        w.a.users["sales"],
        "POST",
        w.a,
        "contacts",
        json={"id": uid(), "full_name": "Two", "email": email.upper()},
    )
    other_tenant = w.call(
        w.b.users["sales"],
        "POST",
        w.b,
        "contacts",
        json={"id": uid(), "full_name": "Three", "email": email},
    )
    assert (c1.status_code, other_tenant.status_code) == (201, 201)
    assert dup.status_code == 409 and dup.json()["error"]["code"] == "duplicate_value"
    assert "email" in dup.json()["error"]["message"] and email not in dup.text
    p1 = w.call(
        w.a.users["admin"], "POST", w.a, "products", json={"id": uid(), "sku": sku, "name": "P"}
    )
    p2 = w.call(
        w.a.users["admin"], "POST", w.a, "products", json={"id": uid(), "sku": sku, "name": "P2"}
    )
    p3 = w.call(
        w.b.users["owner"], "POST", w.b, "products", json={"id": uid(), "sku": sku, "name": "P3"}
    )
    assert (p1.status_code, p3.status_code) == (201, 201)
    assert p2.status_code == 409 and p2.json()["error"]["code"] == "duplicate_value"


def test_a_retried_contact_create_with_an_email_is_still_idempotent(world: World) -> None:
    w = world
    payload = {"id": uid(), "full_name": "Retry", "email": f"retry-{uid()}@it.example.test"}
    assert w.call(w.a.users["sales"], "POST", w.a, "contacts", json=payload).status_code == 201
    assert w.call(w.a.users["sales"], "POST", w.a, "contacts", json=payload).status_code == 200


# ============================================================ references: foreign == nonexistent
def test_foreign_and_nonexistent_parents_give_identical_422s(world: World) -> None:
    w = world
    sales = w.a.users["sales"]
    foreign_company, foreign_contact = w.b.rows["companies"]["id"], w.b.rows["contacts"]["id"]
    foreign_lead = w.b.rows["leads"]["id"]
    foreign_owner = str(w.b.users["owner"].id)
    own_company, own_contact = w.a.rows["companies"]["id"], w.a.rows["contacts"]["id"]

    other_company = w.call(
        w.a.users["owner"], "POST", w.a, "companies", json={"id": uid(), "name": "Other co"}
    ).json()["id"]
    cases: list[tuple[str, str, dict[str, Any], dict[str, Any]]] = [
        (
            "contacts",
            "company",
            {"full_name": "x", "company_id": foreign_company},
            {"full_name": "x", "company_id": uid()},
        ),
        ("leads", "company", {"company_id": foreign_company}, {"company_id": uid()}),
        (
            "leads",
            "contact",
            {"company_id": own_company, "contact_id": foreign_contact},
            {"company_id": own_company, "contact_id": uid()},
        ),
        ("leads", "owner", {"owner_user_id": foreign_owner}, {"owner_user_id": uid()}),
        (
            "opportunities",
            "company",
            {"company_id": foreign_company, "title": "t"},
            {"company_id": uid(), "title": "t"},
        ),
        (
            "opportunities",
            "contact",
            {"company_id": own_company, "contact_id": foreign_contact, "title": "t"},
            {"company_id": own_company, "contact_id": uid(), "title": "t"},
        ),
        (
            "opportunities",
            "lead",
            {"company_id": own_company, "lead_id": foreign_lead, "title": "t"},
            {"company_id": own_company, "lead_id": uid(), "title": "t"},
        ),
        (
            "opportunities",
            "owner",
            {"company_id": own_company, "owner_user_id": foreign_owner, "title": "t"},
            {"company_id": own_company, "owner_user_id": uid(), "title": "t"},
        ),
        # same tenant, wrong company: the contact belongs to ANOTHER company of mine
        (
            "leads",
            "contact/company mismatch",
            {"company_id": other_company, "contact_id": own_contact},
            {"company_id": other_company, "contact_id": uid()},
        ),
        (
            "opportunities",
            "contact/company mismatch",
            {"company_id": other_company, "contact_id": own_contact, "title": "t"},
            {"company_id": other_company, "contact_id": uid(), "title": "t"},
        ),
    ]
    for entity, what, foreign_body, missing_body in cases:
        foreign_r = w.call(sales, "POST", w.a, entity, json={"id": uid(), **foreign_body})
        missing_r = w.call(sales, "POST", w.a, entity, json={"id": uid(), **missing_body})
        assert foreign_r.status_code == missing_r.status_code == 422, (
            entity,
            what,
            foreign_r.text,
            missing_r.text,
        )
        assert (
            foreign_r.json()
            == missing_r.json()
            == {
                "error": {
                    "code": "invalid_reference",
                    "message": "A referenced record does not exist.",
                }
            }
        ), (entity, what)
        for text in (foreign_r.text, missing_r.text):
            assert foreign_company not in text and foreign_owner not in text

    # updates behave the same
    base_lead = w.a.rows["leads"]["id"]
    for body in ({"company_id": foreign_company}, {"company_id": uid()}):
        r = w.call(sales, "PATCH", w.a, "leads", f"/{base_lead}", json=body)
        assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_reference"
    assert (
        w.call(w.a.users["owner"], "GET", w.a, "leads", f"/{base_lead}").json()["company_id"]
        == own_company
    )


def test_a_contact_without_a_company_cannot_be_linked(world: World) -> None:
    w = world
    free = w.call(
        w.a.users["sales"], "POST", w.a, "contacts", json={"id": uid(), "full_name": "No company"}
    ).json()["id"]
    r = w.call(
        w.a.users["sales"],
        "POST",
        w.a,
        "leads",
        json={"id": uid(), "company_id": w.a.rows["companies"]["id"], "contact_id": free},
    )
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid_reference"
    r = w.call(w.a.users["sales"], "POST", w.a, "leads", json={"id": uid(), "contact_id": free})
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error"


# ============================================================================== pagination
def _bulk_insert(w: World, tenant: Tenant, table: str, rows: list[dict[str, Any]]) -> None:
    r = httpx.post(
        f"{w.stack.rest}/{table}",
        headers=w.stack.headers(tenant.users["owner"].token, Prefer="return=minimal"),
        json=rows,
        timeout=30,
    )
    assert r.status_code == 201, r.text


def _walk(
    w: World, user: User, tenant: Tenant, entity: str, limit: int, between_pages: Any = None
) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    cursor = None
    while True:
        params: dict[str, Any] = {"limit": limit, "include_archived": "true"}
        if cursor:
            params["cursor"] = cursor
        page = w.call(user, "GET", tenant, entity, params=params)
        assert page.status_code == 200, page.text
        body = page.json()
        assert len(body["items"]) <= limit
        items += body["items"]
        cursor = body["next_cursor"]
        if between_pages and cursor:
            between_pages(len(items))
            between_pages = None
        if cursor is None:
            return items


@pytest.mark.parametrize("entity", ["companies", "contacts"])
def test_keyset_pagination_has_no_duplicates_or_gaps_even_with_identical_timestamps(
    world: World, entity: str
) -> None:
    w = world
    viewer = w.a.users["viewer"]
    # 130 rows inserted by ONE statement share one created_at: only the id tiebreaker orders them
    ids = [uid() for _ in range(130)]
    if entity == "companies":
        rows = [{"id": i, "tenant_id": w.a.id, "name": f"Bulk {n:03d}"} for n, i in enumerate(ids)]
    else:
        rows = [
            {
                "id": i,
                "tenant_id": w.a.id,
                "full_name": f"Bulk {n:03d}",
                "email": f"{i}@bulk.example.test",
            }
            for n, i in enumerate(ids)
        ]
    _bulk_insert(w, w.a, entity, rows)

    everything = _walk(w, viewer, w.a, entity, limit=100)
    all_ids = [r["id"] for r in everything]
    assert len(all_ids) == len(set(all_ids)), "no duplicates"
    assert set(ids) <= set(all_ids)

    for limit in (7, 25, 50, 100):
        walked = _walk(w, viewer, w.a, entity, limit=limit)
        assert [r["id"] for r in walked] == all_ids, (
            f"limit={limit}: same rows, same order, none skipped"
        )
    keys = [(r["created_at"], r["id"]) for r in everything]
    assert keys == sorted(keys, reverse=True), "ordered by (created_at, id) descending"
    assert len({r["created_at"] for r in everything if r["id"] in set(ids)}) == 1, (
        "the bulk rows really did tie"
    )

    # rows created while someone is paging do not duplicate or hide older rows
    def insert_mid_walk(_: int) -> None:
        w.call(w.a.users["owner"], "POST", w.a, entity, json=create_payload(entity, w.a))

    mid = _walk(w, viewer, w.a, entity, limit=25, between_pages=insert_mid_walk)
    mid_ids = [r["id"] for r in mid]
    assert len(mid_ids) == len(set(mid_ids))
    assert set(all_ids) <= set(mid_ids)


def test_default_and_maximum_page_size_and_bad_parameters(world: World) -> None:
    w = world
    viewer = w.a.users["viewer"]
    assert len(w.call(viewer, "GET", w.a, "companies").json()["items"]) == 50
    assert (
        len(w.call(viewer, "GET", w.a, "companies", params={"limit": 100}).json()["items"]) == 100
    )
    for params in ({"limit": 0}, {"limit": 101}, {"cursor": "garbage"}, {"cursor": "e30"}):
        assert w.call(viewer, "GET", w.a, "companies", params=params).status_code == 422, params


def test_company_name_filter(world: World) -> None:
    w = world
    tag = uid()[:8]
    for name in (f"Alpha {tag} Textiles", f"Beta {tag} Mills", f"100%_{tag}"):
        assert (
            w.call(
                w.a.users["sales"], "POST", w.a, "companies", json={"id": uid(), "name": name}
            ).status_code
            == 201
        )

    def found(q: str) -> list[str]:
        r = w.call(w.a.users["viewer"], "GET", w.a, "companies", params={"q": q})
        return [row["name"] for row in r.json()["items"]]

    assert found(f"alpha {tag}") == [f"Alpha {tag} Textiles"]
    assert found(f"{tag} m") == [f"Beta {tag} Mills"]
    assert found(f"100%_{tag}") == [f"100%_{tag}"], "% and _ are literal"
    assert found("%") == [
        r["name"]
        for r in w.call(w.a.users["viewer"], "GET", w.a, "companies", params={"q": "%"}).json()[
            "items"
        ]
    ]
    assert all("%" in n for n in found("%")), "a lone % matches names containing %, not everything"
    assert found("zzz-" + tag) == []
    weird = w.call(w.a.users["viewer"], "GET", w.a, "companies", params={"q": "a,b)or(id.eq.1"})
    assert weird.status_code == 200 and weird.json()["items"] == []
    other_tenant = [
        r["name"]
        for r in w.call(w.b.users["viewer"], "GET", w.b, "companies", params={"q": tag}).json()[
            "items"
        ]
    ]
    assert other_tenant == [], "the filter never crosses tenants"


# ================================================================================ archive rules
def test_archive_lifecycle(world: World) -> None:
    w = world
    owner, admin, sales, viewer = (w.a.users[r] for r in ("owner", "admin", "sales", "viewer"))
    created = w.call(
        sales, "POST", w.a, "companies", json={"id": uid(), "name": "Lifecycle"}
    ).json()
    rid = created["id"]
    assert w.call(sales, "POST", w.a, "companies", f"/{rid}/archive").status_code == 403
    archived = w.call(admin, "POST", w.a, "companies", f"/{rid}/archive")
    assert archived.status_code == 200 and archived.json()["archived_at"] is not None
    assert w.call(admin, "POST", w.a, "companies", f"/{rid}/archive").status_code == 200, (
        "archiving twice is fine"
    )
    assert rid not in [
        r["id"]
        for r in w.call(viewer, "GET", w.a, "companies", params={"limit": 100}).json()["items"]
    ]
    assert rid in [
        r["id"]
        for r in w.call(
            viewer, "GET", w.a, "companies", params={"limit": 100, "include_archived": "true"}
        ).json()["items"]
    ]
    blocked = w.call(owner, "PATCH", w.a, "companies", f"/{rid}", json={"city": "Madurai"})
    assert blocked.status_code == 409 and blocked.json()["error"]["code"] == "archived"
    assert w.call(sales, "POST", w.a, "companies", f"/{rid}/restore").status_code == 403
    assert w.call(admin, "POST", w.a, "companies", f"/{rid}/restore").status_code == 200
    assert (
        w.call(sales, "PATCH", w.a, "companies", f"/{rid}", json={"city": "Madurai"}).json()["city"]
        == "Madurai"
    )


# =================================================================================== opportunities
def test_opportunity_status_rules(world: World) -> None:
    w = world
    sales, admin = w.a.users["sales"], w.a.users["admin"]
    own_company = w.a.rows["companies"]["id"]
    opp = w.call(
        sales,
        "POST",
        w.a,
        "opportunities",
        json={"id": uid(), "company_id": own_company, "title": "Status test"},
    ).json()
    rid = opp["id"]
    assert opp["status"] == "open" and opp["closed_at"] is None
    assert (
        w.call(
            sales,
            "POST",
            w.a,
            "opportunities",
            json={"id": uid(), "company_id": own_company, "title": "x", "status": "won"},
        ).status_code
        == 422
    )
    assert (
        w.call(sales, "POST", w.a, "leads", json={"id": uid(), "status": "qualified"}).status_code
        == 422
    )

    assert (
        w.call(sales, "PATCH", w.a, "opportunities", f"/{rid}", json={"status": "lost"}).status_code
        == 422
    ), "lost needs a reason"
    assert (
        w.call(
            sales, "PATCH", w.a, "opportunities", f"/{rid}", json={"lost_reason": "stray"}
        ).status_code
        == 422
    )
    lost = w.call(
        sales,
        "PATCH",
        w.a,
        "opportunities",
        f"/{rid}",
        json={"status": "lost", "lost_reason": "price too high"},
    )
    assert (
        lost.status_code == 200
        and lost.json()["status"] == "lost"
        and lost.json()["closed_at"] is not None
    )
    won = w.call(sales, "PATCH", w.a, "opportunities", f"/{rid}", json={"status": "won"})
    assert won.status_code == 409 and won.json()["error"]["code"] == "invalid_transition"
    assert (
        w.call(sales, "PATCH", w.a, "opportunities", f"/{rid}", json={"status": "open"}).status_code
        == 403
    ), "sales cannot reopen"
    reopened = w.call(admin, "PATCH", w.a, "opportunities", f"/{rid}", json={"status": "open"})
    assert (
        reopened.status_code == 200
        and reopened.json()["closed_at"] is None
        and reopened.json()["lost_reason"] is None
    )
    assert (
        w.call(sales, "PATCH", w.a, "opportunities", f"/{rid}", json={"status": "won"}).json()[
            "status"
        ]
        == "won"
    )
    again = w.call(
        sales,
        "PATCH",
        w.a,
        "opportunities",
        f"/{rid}",
        json={"status": "lost", "lost_reason": "changed mind"},
    )
    assert again.status_code == 409 and again.json()["error"]["code"] == "invalid_transition"

    lead = w.call(sales, "POST", w.a, "leads", json={"id": uid()}).json()
    assert lead["status"] == "new"
    assert (
        w.call(sales, "PATCH", w.a, "leads", f"/{lead['id']}", json={"status": "qualified"}).json()[
            "status"
        ]
        == "qualified"
    )


# ========================================================================== server-owned columns
@pytest.mark.parametrize("entity", ENTITIES)
@pytest.mark.parametrize(
    "field",
    [
        "created_by",
        "created_via",
        "closed_at",
        "tenant_id",
        "archived_at",
        "email_consent",
        "suppressed_at",
    ],
)
def test_server_owned_fields_can_never_be_sent(world: World, entity: str, field: str) -> None:
    w = world
    owner = w.a.users["owner"]
    value = (
        str(w.b.id)
        if field == "tenant_id"
        else "agent"
        if field == "created_via"
        else str(w.b.users["owner"].id)
    )
    r = w.call(owner, "POST", w.a, entity, json={**create_payload(entity, w.a), field: value})
    assert r.status_code == 422, (entity, field)
    r = w.call(
        owner,
        "PATCH",
        w.a,
        entity,
        f"/{w.a.rows[entity]['id']}",
        json={**UPDATES[entity], field: value},
    )
    assert r.status_code == 422, (entity, field)


def test_created_by_and_via_are_the_servers(world: World) -> None:
    w = world
    row = w.call(
        w.a.users["sales"], "POST", w.a, "companies", json=create_payload("companies", w.a)
    ).json()
    assert row["created_by"] == str(w.a.users["sales"].id)
    assert row["created_via"] == "manual"
    patched = w.call(
        w.a.users["owner"], "PATCH", w.a, "companies", f"/{row['id']}", json={"city": "Salem"}
    ).json()
    assert patched["created_by"] == row["created_by"] and patched["created_via"] == "manual"


# ===================================================================================== consent
def test_consent_flows_including_the_optout_withdrawal(world: World) -> None:
    w = world
    sales, admin, viewer = w.a.users["sales"], w.a.users["admin"], w.a.users["viewer"]
    cid = w.call(
        sales,
        "POST",
        w.a,
        "contacts",
        json={
            "id": uid(),
            "full_name": "Consent Flow",
            "email": f"cf-{uid()}@it.example.test",
            "phone": "+91 90000 33333",
            "company_id": w.a.rows["companies"]["id"],
        },
    ).json()["id"]

    def grant(channel: str, ref: str) -> httpx.Response:
        return w.call(
            sales,
            "POST",
            w.a,
            "contacts",
            f"/{cid}/record-consent",
            json={
                "channel": channel,
                "status": "granted",
                "basis": "explicit_consent",
                "evidence_type": "web_form",
                "evidence_ref": ref,
            },
        )

    g1, g2 = grant("email", "form:1"), grant("phone", "form:2")
    assert g1.status_code == g2.status_code == 200
    assert (
        g1.json()["contact"]["email_consent"] == "granted"
        and g2.json()["contact"]["phone_consent"] == "granted"
    )
    assert g1.json()["event_id"] is not None
    assert grant("email", "form:1").json()["event_id"] == g1.json()["event_id"], (
        "a retry returns the same ledger row"
    )

    # an opt-out withdraws every granted channel in one call (R1)
    opted = w.call(
        sales,
        "POST",
        w.a,
        "contacts",
        f"/{cid}/suppress",
        json={"reason": "opted_out", "evidence_type": "verbal", "evidence_ref": "call:7"},
    )
    assert opted.status_code == 200
    c = opted.json()["contact"]
    assert (c["email_consent"], c["phone_consent"], c["whatsapp_consent"]) == (
        "withdrawn",
        "withdrawn",
        "unknown",
    )
    assert c["suppression_reason"] == "opted_out" and c["suppressed_at"] is not None
    check_schema(opted.json(), "ConsentResultOut")

    # lifting does NOT revive consent
    assert (
        w.call(
            sales,
            "POST",
            w.a,
            "contacts",
            f"/{cid}/lift-suppression",
            json={"evidence_type": "written", "evidence_ref": "letter:1"},
        ).status_code
        == 403
    )
    lifted = w.call(
        admin,
        "POST",
        w.a,
        "contacts",
        f"/{cid}/lift-suppression",
        json={"evidence_type": "written", "evidence_ref": "letter:1"},
    )
    assert lifted.status_code == 200
    c = lifted.json()["contact"]
    assert c["suppressed_at"] is None and c["suppression_reason"] is None
    assert (c["email_consent"], c["phone_consent"]) == ("withdrawn", "withdrawn"), (
        "lift never revives consent"
    )
    assert grant("email", "form:3").json()["contact"]["email_consent"] == "granted", (
        "only a fresh grant does"
    )

    # bounced / manual: consent untouched, lifting restores contactability
    cid2 = w.call(
        sales,
        "POST",
        w.a,
        "contacts",
        json={
            "id": uid(),
            "full_name": "Bounce",
            "email": f"b-{uid()}@it.example.test",
            "company_id": w.a.rows["companies"]["id"],
        },
    ).json()["id"]
    w.call(
        sales,
        "POST",
        w.a,
        "contacts",
        f"/{cid2}/record-consent",
        json={
            "channel": "email",
            "status": "granted",
            "basis": "contractual",
            "evidence_type": "written",
            "evidence_ref": "contract:5",
        },
    )
    bounced = w.call(
        sales, "POST", w.a, "contacts", f"/{cid2}/suppress", json={"reason": "bounced"}
    ).json()["contact"]
    assert bounced["email_consent"] == "granted" and bounced["suppression_reason"] == "bounced"
    after = w.call(
        admin,
        "POST",
        w.a,
        "contacts",
        f"/{cid2}/lift-suppression",
        json={"evidence_type": "other", "evidence_ref": "note:9"},
    ).json()["contact"]
    assert after["email_consent"] == "granted" and after["suppressed_at"] is None

    # validation and permissions
    assert (
        w.call(
            viewer,
            "POST",
            w.a,
            "contacts",
            f"/{cid}/record-consent",
            json={"channel": "email", "status": "withdrawn"},
        ).status_code
        == 403
    )
    for bad in (
        {"channel": "email", "status": "granted"},
        {"channel": "sms", "status": "withdrawn"},
        {
            "channel": "email",
            "status": "granted",
            "basis": "explicit_consent",
            "evidence_type": "web_form",
            "evidence_ref": "no colon here",
        },
    ):
        assert (
            w.call(sales, "POST", w.a, "contacts", f"/{cid}/record-consent", json=bad).status_code
            == 422
        ), bad
    assert (
        w.call(
            sales,
            "POST",
            w.a,
            "contacts",
            f"/{uuid.uuid4()}/record-consent",
            json={"channel": "email", "status": "withdrawn"},
        ).status_code
        == 404
    )

    # consent state cannot be written any other way
    assert (
        w.call(
            w.a.users["owner"],
            "PATCH",
            w.a,
            "contacts",
            f"/{cid}",
            json={"email_consent": "granted"},
        ).status_code
        == 422
    )
    direct = httpx.patch(
        f"{w.stack.rest}/contacts?id=eq.{cid}",
        headers=w.stack.headers(w.a.users["owner"].token),
        json={"email_consent": "unknown"},
        timeout=15,
    )
    assert direct.status_code in (401, 403), (
        "not even PostgREST lets a client write consent columns"
    )


# ============================================================================= PII canary
CANARY_EMAIL = "canary.zq91@it.example.test"
CANARY_NAME = "Canary Zq91"
CANARY_PHONE = "+91 98765 00091"


def test_personal_data_never_appears_in_an_error_body_or_a_log_line(
    world: World, caplog: pytest.LogCaptureFixture
) -> None:
    w = world
    sales, viewer, owner_b = w.a.users["sales"], w.a.users["viewer"], w.b.users["owner"]
    caplog.set_level(logging.DEBUG)

    contact = w.call(
        sales,
        "POST",
        w.a,
        "contacts",
        json={
            "id": uid(),
            "full_name": CANARY_NAME,
            "email": CANARY_EMAIL,
            "phone": CANARY_PHONE,
            "company_id": w.a.rows["companies"]["id"],
        },
    )
    assert contact.status_code == 201
    cid = contact.json()["id"]
    responses = [
        # unique violation: PostgreSQL prints the e-mail address in its DETAIL
        w.call(
            sales,
            "POST",
            w.a,
            "contacts",
            json={"id": uid(), "full_name": "Other", "email": CANARY_EMAIL},
        ),
        w.call(
            sales,
            "PATCH",
            w.a,
            "contacts",
            f"/{w.a.rows['contacts']['id']}",
            json={"email": CANARY_EMAIL},
        ),
        # foreign key violations referencing the canary contact from another tenant
        w.call(
            owner_b,
            "POST",
            w.b,
            "leads",
            json={"id": uid(), "company_id": w.b.rows["companies"]["id"], "contact_id": cid},
        ),
        w.call(
            owner_b,
            "POST",
            w.b,
            "opportunities",
            json={
                "id": uid(),
                "company_id": w.b.rows["companies"]["id"],
                "contact_id": cid,
                "title": CANARY_NAME,
            },
        ),
        # forbidden, not found, validation, conflict, transitions
        w.call(viewer, "PATCH", w.a, "contacts", f"/{cid}", json={"full_name": CANARY_NAME}),
        w.call(owner_b, "GET", w.a, "contacts", f"/{cid}"),
        w.call(owner_b, "PATCH", w.b, "contacts", f"/{cid}", json={"full_name": CANARY_NAME}),
        w.call(
            sales,
            "POST",
            w.a,
            "contacts",
            json={
                "id": uid(),
                "full_name": CANARY_NAME,
                "email": f"{CANARY_EMAIL} nope",
                "bogus": CANARY_PHONE,
            },
        ),
        w.call(
            sales,
            "POST",
            w.a,
            "contacts",
            f"/{cid}/record-consent",
            json={
                "channel": "email",
                "status": "granted",
                "basis": "explicit_consent",
                "evidence_type": "web_form",
                "evidence_ref": CANARY_EMAIL,
            },
        ),
        w.call(
            sales,
            "POST",
            w.a,
            "contacts",
            f"/{cid}/suppress",
            json={
                "reason": "manual",
                "evidence_type": "verbal",
                "evidence_ref": f"call:{CANARY_PHONE}",
            },
        ),
        w.call(sales, "GET", w.a, "companies", params={"q": CANARY_NAME}),
        w.call(
            sales,
            "POST",
            w.a,
            "contacts",
            json={
                "id": contact.json()["id"],
                "full_name": CANARY_NAME + "x",
                "email": CANARY_EMAIL,
            },
        ),
    ]
    assert {r.status_code for r in responses} >= {403, 404, 409, 422}
    erroring = [r for r in responses if r.status_code >= 400]
    bodies = "\n".join(r.text + str(dict(r.headers)) for r in erroring)
    assert CANARY_EMAIL not in bodies and CANARY_NAME not in bodies and CANARY_PHONE not in bodies
    assert "canary" not in bodies.lower() and "zq91" not in bodies.lower() and "98765" not in bodies
    for r in erroring:
        body = r.json()
        assert set(body) == {"error"} and set(body["error"]) <= {"code", "message"}, r.text

    logs = "\n".join(rec.getMessage() + str(rec.exc_text or "") for rec in caplog.records)
    assert logs, "logging was captured"
    assert "canary" not in logs.lower() and "zq91" not in logs.lower() and "98765" not in logs


def test_the_audit_trail_holds_no_canary_either(world: World) -> None:
    w = world
    events = w.call(w.a.users["owner"], "GET", w.a, "contacts")  # warm-up: tenants route below
    assert events.status_code == 200
    audit = w.client.get(
        f"/v1/tenants/{w.a.id}/audit-events",
        headers=bearer(w.a.users["owner"]),
        params={"limit": 100},
    )
    assert audit.status_code == 200
    text = audit.text.lower()
    assert "canary" not in text and "zq91" not in text and "98765" not in text
    created = [e for e in audit.json()["events"] if e["action"] == "contact.create"]
    assert created and all("email" not in (e["new_values"] or {}) for e in created)


# ======================================================================================= misc
def test_unauthenticated_and_invalid_tokens_get_401(world: World) -> None:
    w = world
    rid = w.a.rows["companies"]["id"]
    for headers in (
        {},
        {"Authorization": "Bearer not.a.jwt"},
        {"Authorization": f"Bearer {w.stack.anon_key}"},
    ):
        for method, path in (
            ("GET", w.path(w.a, "companies")),
            ("GET", w.path(w.a, "companies", f"/{rid}")),
            ("POST", w.path(w.a, "companies")),
        ):
            assert w.client.request(method, path, headers=headers).status_code == 401


def test_there_are_no_delete_endpoints(world: World) -> None:
    w = world
    spec = w.client.get("/openapi.json").json()
    assert [p for p, ops in spec["paths"].items() if "delete" in ops] == []
