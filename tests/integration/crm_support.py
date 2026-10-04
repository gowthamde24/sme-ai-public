"""Shared fixtures for the CRM integration tests: two tenants, seven real users, one base row per
entity. Built once per session (see conftest.crm_world)."""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import httpx
import jsonschema
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


def everyone(w: World) -> list[tuple[Tenant, Tenant, str, User]]:
    """(own tenant, other tenant, role, user) for every user of both tenants."""
    out = [(w.a, w.b, role, user) for role, user in w.a.users.items()]
    out += [(w.b, w.a, role, user) for role, user in w.b.users.items()]
    return out
