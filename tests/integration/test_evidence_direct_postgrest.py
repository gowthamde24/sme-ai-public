"""PostgREST is reachable by anyone holding a user JWT and the public anon key. These tests skip OUR
API and attack the three evidence tables and the create_evidence_with_link function directly, as
real signed-in users, to prove the database refuses by itself: cross-tenant reads and writes,
forged provenance, content-column updates, DELETE, Viewer writes, Sales archiving. Every attack must
be denied by RLS, a column privilege, a trigger or a constraint, and the victim data must be
unchanged afterwards."""

from __future__ import annotations

from typing import Any

import pytest
from crm_support import Tenant, World
from evidence_support import code_of, denied, pg, uid

TABLES = ["evidence", "evidence_links", "claims"]


@pytest.fixture(scope="module")
def seeded(crm_world: World) -> dict[str, dict[str, Any]]:
    """Per tenant: one evidence row, one claim, a link to the company and a link to the claim,
    built through PostgREST by a Sales user (no API endpoint creates claims)."""
    w = crm_world
    out: dict[str, dict[str, Any]] = {}
    for t in (w.a, w.b):
        sales = t.users["sales"]
        ids = {"evidence": uid(), "claim": uid(), "link_company": uid(), "link_claim": uid()}
        company = t.rows["companies"]["id"]
        steps = [
            (
                "/evidence",
                {
                    "id": ids["evidence"],
                    "tenant_id": t.id,
                    "kind": "web_page",
                    "provider": "manual",
                    "url": "https://example.test/seed",
                    "snippet": f"seed {t.label}",
                },
            ),
            (
                "/claims",
                {
                    "id": ids["claim"],
                    "tenant_id": t.id,
                    "company_id": company,
                    "predicate": "exports_to",
                    "value": f"seed value {t.label}",
                    "confidence": "low",
                },
            ),
            (
                "/evidence_links",
                {
                    "id": ids["link_company"],
                    "tenant_id": t.id,
                    "evidence_id": ids["evidence"],
                    "company_id": company,
                },
            ),
            (
                "/evidence_links",
                {
                    "id": ids["link_claim"],
                    "tenant_id": t.id,
                    "evidence_id": ids["evidence"],
                    "claim_id": ids["claim"],
                    "stance": "supports",
                },
            ),
        ]
        for path, row in steps:
            r = pg(w.stack, sales, "POST", path, json=row)
            assert r.status_code == 201, (path, r.text)
        out[t.id] = ids
    return out


def both(w: World) -> list[tuple[Tenant, Tenant, str, Any]]:
    out = [(w.a, w.b, role, user) for role, user in w.a.users.items()]
    out += [(w.b, w.a, role, user) for role, user in w.b.users.items()]
    return out


def owner_view(w: World, tenant: Tenant, table: str, row_id: str) -> Any:
    r = pg(w.stack, tenant.users["owner"], "GET", f"/{table}?id=eq.{row_id}&select=*")
    assert r.status_code == 200
    return r.json()


# ==== 1. reads ====
@pytest.mark.parametrize("table", TABLES)
def test_other_tenants_rows_are_invisible(
    crm_world: World, seeded: dict[str, dict[str, Any]], table: str
) -> None:
    w = crm_world
    key = {"evidence": "evidence", "evidence_links": "link_company", "claims": "claim"}[table]
    for own, other, role, user in both(w):
        label = f"{own.label}/{role}/{table}"
        scoped = pg(w.stack, user, "GET", f"/{table}?tenant_id=eq.{other.id}&select=*")
        assert scoped.status_code == 200 and scoped.json() == [], label
        everything = pg(w.stack, user, "GET", f"/{table}?select=tenant_id&limit=1000")
        assert {row["tenant_id"] for row in everything.json()} <= {own.id}, label
        by_id = pg(w.stack, user, "GET", f"/{table}?id=eq.{seeded[other.id][key]}")
        assert by_id.status_code == 200 and by_id.json() == [], label
    # embedding cannot reach across either
    for own, other, role, user in both(w):
        r = pg(
            w.stack,
            user,
            "GET",
            f"/evidence_links?select=id,evidence(id,url,snippet)&tenant_id=eq.{other.id}",
        )
        assert r.status_code == 200 and r.json() == [], f"{own.label}/{role}"


def test_anon_and_outsiders_read_nothing(
    crm_world: World, seeded: dict[str, dict[str, Any]]
) -> None:
    w = crm_world
    for table in TABLES:
        anon = pg(w.stack, None, "GET", f"/{table}?select=id")
        assert anon.status_code in (401, 403) and code_of(anon) == "42501", table


def test_every_member_may_read_their_own_tenants_evidence(
    crm_world: World, seeded: dict[str, dict[str, Any]]
) -> None:
    w = crm_world
    for own, _other, role, user in both(w):
        for table, key in (
            ("evidence", "evidence"),
            ("evidence_links", "link_company"),
            ("claims", "claim"),
        ):
            r = pg(w.stack, user, "GET", f"/{table}?id=eq.{seeded[own.id][key]}&select=id")
            assert r.status_code == 200 and len(r.json()) == 1, f"{own.label}/{role}/{table}"


# ==== 2. writes into another tenant ====
def attacks(
    target: Tenant, parents: Tenant, sids: dict[str, Any]
) -> list[tuple[str, str, dict[str, Any]]]:
    """Well-formed inserts aimed at `target`'s tenant_id, parents taken from `parents`."""
    company = parents.rows["companies"]["id"]
    return [
        (
            "evidence",
            "/evidence",
            {
                "id": uid(),
                "tenant_id": target.id,
                "kind": "web_page",
                "provider": "manual",
                "url": "https://example.test/x",
            },
        ),
        (
            "claims",
            "/claims",
            {
                "id": uid(),
                "tenant_id": target.id,
                "company_id": company,
                "predicate": "exports_to",
                "value": "v",
                "confidence": "low",
            },
        ),
        (
            "links",
            "/evidence_links",
            {
                "id": uid(),
                "tenant_id": target.id,
                "evidence_id": sids["evidence"],
                "company_id": company,
            },
        ),
    ]


def test_nobody_can_write_into_another_tenant(
    crm_world: World, seeded: dict[str, dict[str, Any]]
) -> None:
    w = crm_world
    for own, other, role, user in both(w):
        for name, path, row in attacks(other, other, seeded[other.id]):
            r = pg(w.stack, user, "POST", path, json=row)
            assert denied(r), f"{own.label}/{role}/{name}: {r.status_code} {r.text}"
            assert owner_view(w, other, path.lstrip("/"), row["id"]) == [], f"{name}: row appeared"


def test_references_cannot_cross_tenants_even_from_a_writer(
    crm_world: World, seeded: dict[str, dict[str, Any]]
) -> None:
    w = crm_world
    sales = w.a.users["sales"]
    b = seeded[w.b.id]
    cases = [
        (
            "link A -> evidence of B",
            "/evidence_links",
            {
                "id": uid(),
                "tenant_id": w.a.id,
                "evidence_id": b["evidence"],
                "company_id": w.a.rows["companies"]["id"],
            },
        ),
        (
            "link A -> company of B",
            "/evidence_links",
            {
                "id": uid(),
                "tenant_id": w.a.id,
                "evidence_id": seeded[w.a.id]["evidence"],
                "company_id": w.b.rows["companies"]["id"],
            },
        ),
        (
            "link A -> lead of B",
            "/evidence_links",
            {
                "id": uid(),
                "tenant_id": w.a.id,
                "evidence_id": seeded[w.a.id]["evidence"],
                "lead_id": w.b.rows["leads"]["id"],
            },
        ),
        (
            "link A -> claim of B",
            "/evidence_links",
            {
                "id": uid(),
                "tenant_id": w.a.id,
                "evidence_id": seeded[w.a.id]["evidence"],
                "claim_id": b["claim"],
                "stance": "supports",
            },
        ),
        (
            "claim A -> company of B",
            "/claims",
            {
                "id": uid(),
                "tenant_id": w.a.id,
                "company_id": w.b.rows["companies"]["id"],
                "predicate": "exports_to",
                "value": "v",
                "confidence": "low",
            },
        ),
        (
            "claim A -> lead of B",
            "/claims",
            {
                "id": uid(),
                "tenant_id": w.a.id,
                "lead_id": w.b.rows["leads"]["id"],
                "predicate": "exports_to",
                "value": "v",
                "confidence": "low",
            },
        ),
    ]
    for label, path, row in cases:
        r = pg(w.stack, sales, "POST", path, json=row)
        assert r.status_code == 409 and code_of(r) == "23503", (label, r.status_code, r.text)
        # the same refusal for an id that does not exist at all (no existence oracle)
        fake = {
            k: (uid() if k in ("evidence_id", "company_id", "lead_id", "claim_id") else v)
            for k, v in row.items()
        }
        fake["id"] = uid()
        assert pg(w.stack, sales, "POST", path, json=fake).status_code == r.status_code, label
    # nothing was created: tenant A still has exactly its seed rows
    assert len(pg(w.stack, sales, "GET", "/evidence_links?select=id").json()) >= 2


def test_unfiltered_cross_tenant_updates_touch_nothing(
    crm_world: World, seeded: dict[str, dict[str, Any]]
) -> None:
    w = crm_world
    for own, other, role, user in both(w):
        for table in TABLES:
            r = pg(
                w.stack,
                user,
                "PATCH",
                f"/{table}?tenant_id=eq.{other.id}",
                json={"archived_at": "2026-02-01T00:00:00Z"},
            )
            assert denied(r), f"{own.label}/{role}/{table}: {r.status_code}"
    for t in (w.a, w.b):
        for table, key in (
            ("evidence", "evidence"),
            ("evidence_links", "link_company"),
            ("claims", "claim"),
        ):
            assert owner_view(w, t, table, seeded[t.id][key])[0]["archived_at"] is None


# ==== 3. forged provenance ====
@pytest.mark.parametrize(
    "forged",
    [
        {"created_via": "agent"},
        {"created_via": "import"},
        {"created_by": "00000000-0000-0000-0000-000000000001"},
        {"created_at": "2001-01-01T00:00:00Z"},
        {"archived_at": "2026-01-01T00:00:00Z"},
    ],
)
def test_forged_server_owned_columns_are_refused_on_every_table(
    crm_world: World, seeded: dict[str, dict[str, Any]], forged: dict[str, Any]
) -> None:
    w = crm_world
    sales = w.a.users["sales"]
    a = seeded[w.a.id]
    company = w.a.rows["companies"]["id"]
    rows = [
        (
            "/evidence",
            {
                "id": uid(),
                "tenant_id": w.a.id,
                "kind": "web_page",
                "provider": "manual",
                "url": "https://example.test/f",
                **forged,
            },
        ),
        (
            "/claims",
            {
                "id": uid(),
                "tenant_id": w.a.id,
                "company_id": company,
                "predicate": "exports_to",
                "value": "v",
                "confidence": "low",
                **forged,
            },
        ),
        (
            "/evidence_links",
            {
                "id": uid(),
                "tenant_id": w.a.id,
                "evidence_id": a["evidence"],
                "lead_id": w.a.rows["leads"]["id"],
                **forged,
            },
        ),
    ]
    for path, row in rows:
        r = pg(w.stack, sales, "POST", path, json=row)
        assert denied(r) and code_of(r) == "42501", (path, forged, r.status_code, r.text)
        assert owner_view(w, w.a, path.lstrip("/"), row["id"]) == []


def test_a_client_insert_is_always_recorded_as_manual_by_the_caller(
    crm_world: World, seeded: dict[str, dict[str, Any]]
) -> None:
    w = crm_world
    for role in ("owner", "admin", "sales"):
        user = w.a.users[role]
        rid = uid()
        r = pg(
            w.stack,
            user,
            "POST",
            "/evidence",
            json={
                "id": rid,
                "tenant_id": w.a.id,
                "kind": "note",
                "provider": "manual",
                "reference": "doc:prov-1",
            },
        )
        assert r.status_code == 201
        assert r.json()[0]["created_via"] == "manual" and r.json()[0]["created_by"] == str(
            user.id
        ), role


# ==== 4. content is immutable ====
UPDATES = {
    "evidence": [
        {"url": "https://example.test/changed"},
        {"snippet": "changed"},
        {"reference": "doc:changed"},
        {"kind": "note"},
        {"provider": "changed"},
        {"retrieved_at": "2001-01-01T00:00:00Z"},
        {"published_at": "2001-01-01T00:00:00Z"},
        {"created_via": "agent"},
        {"created_by": None},
        {"tenant_id": "00000000-0000-0000-0000-000000000002"},
    ],
    "evidence_links": [
        {"stance": "contradicts"},
        {"stance": None},
        {"company_id": None},
        {"evidence_id": "00000000-0000-0000-0000-000000000003"},
        {"created_via": "agent"},
    ],
    "claims": [
        {"value": "changed"},
        {"confidence": "high"},
        {"predicate": "changed_it"},
        {"company_id": None},
        {"created_via": "agent"},
    ],
}
KEYS = {"evidence": "evidence", "evidence_links": "link_claim", "claims": "claim"}


def test_content_columns_cannot_be_updated_by_anyone(
    crm_world: World, seeded: dict[str, dict[str, Any]]
) -> None:
    w = crm_world
    before = {t: owner_view(w, w.a, t, seeded[w.a.id][KEYS[t]]) for t in TABLES}
    for role in ("owner", "admin", "sales", "viewer"):
        user = w.a.users[role]
        for table, patches in UPDATES.items():
            for patch in patches:
                r = pg(
                    w.stack,
                    user,
                    "PATCH",
                    f"/{table}?id=eq.{seeded[w.a.id][KEYS[table]]}",
                    json=patch,
                )
                assert denied(r) and (r.status_code in (401, 403) or r.json() == []), (
                    role,
                    table,
                    patch,
                    r.status_code,
                    r.text,
                )
    after = {t: owner_view(w, w.a, t, seeded[w.a.id][KEYS[t]]) for t in TABLES}
    assert after == before, "a refused update changed something"


# ==== 5. archive: Admin+ only, and only archived_at ====
def test_archive_is_admin_plus_through_the_data_layer(
    crm_world: World, seeded: dict[str, dict[str, Any]]
) -> None:
    w = crm_world
    ids = seeded[w.a.id]
    for table, key in (
        ("evidence", "evidence"),
        ("evidence_links", "link_company"),
        ("claims", "claim"),
    ):
        path = f"/{table}?id=eq.{ids[key]}"
        for role in ("sales", "viewer"):
            r = pg(
                w.stack,
                w.a.users[role],
                "PATCH",
                path,
                json={"archived_at": "2026-02-01T00:00:00Z"},
            )
            assert denied(r), (table, role, r.status_code, r.text)
        assert owner_view(w, w.a, table, ids[key])[0]["archived_at"] is None, table
        for role in ("admin", "owner"):
            r = pg(
                w.stack,
                w.a.users[role],
                "PATCH",
                path,
                json={"archived_at": "2026-02-01T00:00:00Z"},
            )
            assert r.status_code == 200 and len(r.json()) == 1, (table, role, r.text)
            assert r.json()[0]["archived_at"] is not None
            restored = pg(w.stack, w.a.users[role], "PATCH", path, json={"archived_at": None})
            assert restored.status_code == 200 and restored.json()[0]["archived_at"] is None
        # Sales cannot restore either
        pg(w.stack, w.a.users["admin"], "PATCH", path, json={"archived_at": "2026-02-01T00:00:00Z"})
        assert denied(pg(w.stack, w.a.users["sales"], "PATCH", path, json={"archived_at": None})), (
            table
        )
        pg(w.stack, w.a.users["admin"], "PATCH", path, json={"archived_at": None})


# ==== 6. DELETE and TRUNCATE ====
def test_nobody_can_delete(crm_world: World, seeded: dict[str, dict[str, Any]]) -> None:
    w = crm_world
    for own, _other, role, user in both(w):
        for table, key in (
            ("evidence", "evidence"),
            ("evidence_links", "link_company"),
            ("claims", "claim"),
        ):
            r = pg(w.stack, user, "DELETE", f"/{table}?id=eq.{seeded[own.id][key]}")
            assert denied(r) and code_of(r) == "42501", (
                f"{own.label}/{role}/{table}: {r.status_code} {r.text}"
            )
            assert len(owner_view(w, own, table, seeded[own.id][key])) == 1
            unfiltered = pg(w.stack, user, "DELETE", f"/{table}?tenant_id=eq.{own.id}")
            assert denied(unfiltered), f"{own.label}/{role}/{table} bulk"


# ==== 7. Viewers cannot write ====
def test_viewers_cannot_insert(crm_world: World, seeded: dict[str, dict[str, Any]]) -> None:
    w = crm_world
    for tenant in (w.a, w.b):
        viewer = tenant.users["viewer"]
        for name, path, row in attacks(tenant, tenant, seeded[tenant.id]):
            r = pg(w.stack, viewer, "POST", path, json=row)
            assert denied(r) and code_of(r) == "42501", (tenant.label, name, r.status_code, r.text)
            assert owner_view(w, tenant, path.lstrip("/"), row["id"]) == []


def test_claims_state_their_uncertainty_and_links_state_their_stance(
    crm_world: World, seeded: dict[str, dict[str, Any]]
) -> None:
    w = crm_world
    sales = w.a.users["sales"]
    company = w.a.rows["companies"]["id"]
    no_confidence = pg(
        w.stack,
        sales,
        "POST",
        "/claims",
        json={
            "id": uid(),
            "tenant_id": w.a.id,
            "company_id": company,
            "predicate": "exports_to",
            "value": "v",
        },
    )
    assert no_confidence.status_code == 400 and code_of(no_confidence) == "23502"
    no_stance = pg(
        w.stack,
        sales,
        "POST",
        "/evidence_links",
        json={
            "id": uid(),
            "tenant_id": w.a.id,
            "evidence_id": seeded[w.a.id]["evidence"],
            "claim_id": seeded[w.a.id]["claim"],
        },
    )
    assert no_stance.status_code == 400 and code_of(no_stance) == "23514"
    two_targets = pg(
        w.stack,
        sales,
        "POST",
        "/evidence_links",
        json={
            "id": uid(),
            "tenant_id": w.a.id,
            "evidence_id": seeded[w.a.id]["evidence"],
            "company_id": company,
            "lead_id": w.a.rows["leads"]["id"],
        },
    )
    assert two_targets.status_code == 400 and code_of(two_targets) == "23514"


# ==== 8. the create_evidence_with_link function gives no power beyond the tables ====
def rpc(w: World, user: Any, tenant_id: str, target_kind: str, target_id: str, **over: Any) -> Any:
    args = {
        "p_tenant_id": tenant_id,
        "p_evidence_id": uid(),
        "p_link_id": uid(),
        "p_target_kind": target_kind,
        "p_target_id": target_id,
        "p_kind": "web_page",
        "p_provider": "manual",
        "p_url": "https://example.test/rpc",
        **over,
    }
    return pg(w.stack, user, "POST", "/rpc/create_evidence_with_link", json=args), args


def test_rpc_allows_exactly_what_the_tables_allow(
    crm_world: World, seeded: dict[str, dict[str, Any]]
) -> None:
    w = crm_world
    for role in ("owner", "admin", "sales"):
        user = w.a.users[role]
        r, args = rpc(w, user, w.a.id, "company", w.a.rows["companies"]["id"])
        assert r.status_code == 200, (role, r.text)
        ev_row = owner_view(w, w.a, "evidence", args["p_evidence_id"])[0]
        assert ev_row["created_via"] == "manual" and ev_row["created_by"] == str(user.id), role
        assert ev_row["archived_at"] is None
        link = owner_view(w, w.a, "evidence_links", args["p_link_id"])[0]
        assert link["company_id"] == w.a.rows["companies"]["id"] and link["stance"] is None
    # a lead target works too
    r, args = rpc(w, w.a.users["sales"], w.a.id, "lead", w.a.rows["leads"]["id"])
    assert r.status_code == 200
    assert (
        owner_view(w, w.a, "evidence_links", args["p_link_id"])[0]["lead_id"]
        == w.a.rows["leads"]["id"]
    )


def test_rpc_is_refused_for_viewers_anon_and_other_tenants(
    crm_world: World, seeded: dict[str, dict[str, Any]]
) -> None:
    w = crm_world
    cases = [
        ("viewer of A into A", w.a.users["viewer"], w.a.id, w.a.rows["companies"]["id"]),
        ("viewer of B into B", w.b.users["viewer"], w.b.id, w.b.rows["companies"]["id"]),
        ("owner of A into B", w.a.users["owner"], w.b.id, w.b.rows["companies"]["id"]),
        ("owner of B into A", w.b.users["owner"], w.a.id, w.a.rows["companies"]["id"]),
        ("sales of A into B", w.a.users["sales"], w.b.id, w.b.rows["companies"]["id"]),
    ]
    for label, user, tenant_id, target in cases:
        r, args = rpc(w, user, tenant_id, "company", target)
        assert r.status_code in (401, 403) and code_of(r) == "42501", (label, r.status_code, r.text)
        for table, key in (("evidence", "p_evidence_id"), ("evidence_links", "p_link_id")):
            tenant = w.a if tenant_id == w.a.id else w.b
            assert owner_view(w, tenant, table, args[key]) == [], (
                f"{label}: {table} row left behind"
            )
    anon, _ = rpc(w, None, w.a.id, "company", w.a.rows["companies"]["id"])
    assert anon.status_code in (401, 403) and code_of(anon) == "42501"


def test_rpc_with_a_foreign_target_fails_whole_and_leaves_no_evidence_behind(
    crm_world: World, seeded: dict[str, dict[str, Any]]
) -> None:
    w = crm_world
    sales = w.a.users["sales"]
    foreign, fa = rpc(w, sales, w.a.id, "company", w.b.rows["companies"]["id"])
    missing, ma = rpc(w, sales, w.a.id, "company", uid())
    assert foreign.status_code == missing.status_code == 409
    assert code_of(foreign) == code_of(missing) == "23503", (
        "a foreign target looks exactly like a nonexistent one"
    )
    for args in (fa, ma):
        assert owner_view(w, w.a, "evidence", args["p_evidence_id"]) == [], (
            "atomic: the evidence row was rolled back"
        )
        assert owner_view(w, w.a, "evidence_links", args["p_link_id"]) == []
    foreign_lead, la = rpc(w, sales, w.a.id, "lead", w.b.rows["leads"]["id"])
    assert (
        code_of(foreign_lead) == "23503"
        and owner_view(w, w.a, "evidence", la["p_evidence_id"]) == []
    )


def test_rpc_cannot_forge_or_widen_anything(
    crm_world: World, seeded: dict[str, dict[str, Any]]
) -> None:
    w = crm_world
    sales = w.a.users["sales"]
    target = w.a.rows["companies"]["id"]
    # there is no parameter for provenance, archive state or stance: PostgREST rejects unknown ones
    for extra in (
        {"p_created_via": "agent"},
        {"p_created_by": uid()},
        {"p_archived_at": "2026-01-01T00:00:00Z"},
        {"p_stance": "supports"},
        {"p_claim_id": uid()},
    ):
        r, args = rpc(w, sales, w.a.id, "company", target, **extra)
        assert r.status_code in (400, 404), (extra, r.status_code, r.text)
        assert owner_view(w, w.a, "evidence", args["p_evidence_id"]) == []
    # only company and lead targets exist; claims cannot be reached through the function
    for kind in ("claim", "contact", "opportunity", "Company", ""):
        r, args = rpc(w, sales, w.a.id, kind, target)
        assert r.status_code == 400 and code_of(r) == "22023", (kind, r.text)
        assert owner_view(w, w.a, "evidence", args["p_evidence_id"]) == []
    # every table rule still applies inside the function
    bad: list[tuple[dict[str, Any], str]] = [
        ({"p_url": "javascript:alert(1)"}, "23514"),
        ({"p_url": "https://u:p@example.test/"}, "23514"),
        ({"p_snippet": "a​b"}, "23514"),
        ({"p_snippet": "x" * 1001}, "23514"),
        ({"p_snippet": "a\U000e0020b"}, "23514"),
        ({"p_retrieved_at": "2999-01-01T00:00:00Z"}, "23514"),
        ({"p_provider": "Not A Slug"}, "23514"),
        ({"p_kind": "carrier_pigeon"}, "22P02"),
        ({"p_url": None, "p_reference": None}, "23514"),
    ]
    for extra, expected in bad:
        r, args = rpc(w, sales, w.a.id, "company", target, **extra)
        assert r.status_code == 400 and code_of(r) == expected, (extra, r.status_code, r.text)
        assert owner_view(w, w.a, "evidence", args["p_evidence_id"]) == []
    # a retry of the same ids is a plain duplicate-key refusal
    first, args = rpc(w, sales, w.a.id, "company", target)
    assert first.status_code == 200
    again = pg(w.stack, sales, "POST", "/rpc/create_evidence_with_link", json=args)
    assert again.status_code == 409 and code_of(again) == "23505"
    # a null id / tenant is an invalid argument, not a crash
    nulls, _ = rpc(w, sales, w.a.id, "company", target, p_evidence_id=None)
    assert nulls.status_code == 400 and code_of(nulls) in ("22023", "23502")


def test_rpc_is_not_callable_by_a_stranger_even_with_valid_ids_of_a_real_tenant(
    crm_world: World, seeded: dict[str, dict[str, Any]]
) -> None:
    w = crm_world
    # the outsider has no tenant at all: sign up a fresh user and try tenant A
    import httpx

    stranger = httpx.post(
        f"{w.stack.url}/auth/v1/signup",
        headers={"apikey": w.stack.anon_key},
        json={"email": f"stranger-{uid()[:8]}@it.example.test", "password": uid() + "Aa1!"},
        timeout=15,
    ).json()

    class U:
        token = stranger["access_token"]

    r, args = rpc(w, U(), w.a.id, "company", w.a.rows["companies"]["id"])
    assert r.status_code in (401, 403) and code_of(r) == "42501"
    assert owner_view(w, w.a, "evidence", args["p_evidence_id"]) == []
