"""PostgREST is reachable by anyone holding a user JWT and the public anon key. These tests skip OUR
API and attack the T005 tables (icp_config_versions, lead_labels, data_exports, import_batches,
import_rows) and the definer function rpc/import_lead_rows directly, as real signed-in users: anon,
a foreign tenant, a Viewer, a Sales user where Admin+ is required, smuggled tenant_id /
created_via / created_by / server-assigned columns, UPDATE and DELETE on the append-only
tables, forged references to another tenant's ICP version or lead, and label rules bypassed by
inserting without the API.

Writes use `Prefer: return=minimal` (the weakest echo, so nothing is read back by accident); what
an attack must achieve is judged by the victim data afterwards, never by the response alone. Every
attack must be refused by RLS, a column privilege, a trigger, a constraint or the function's own
checks, and the victim data must be unchanged."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import User
from crm_support import Tenant, World
from evidence_support import code_of, pg, uid

TEMPLATE = json.loads(
    (Path(__file__).resolve().parents[2] / "config" / "icp" / "silk-wholesale.v1.json").read_text()
)
TABLES = ["icp_config_versions", "lead_labels", "data_exports", "import_batches", "import_rows"]
# who may INSERT directly (import_batches / import_rows: nobody, only the definer function)
WRITERS = {
    "icp_config_versions": {"owner", "admin"},
    "lead_labels": {"owner", "admin", "sales"},
    "data_exports": {"owner", "admin"},
    "import_batches": set(),
    "import_rows": set(),
}
# who may SELECT
READERS = {
    "icp_config_versions": {"owner", "admin", "sales", "viewer"},
    "lead_labels": {"owner", "admin", "sales", "viewer"},
    "data_exports": {"owner", "admin"},
    "import_batches": {"owner", "admin", "sales", "viewer"},
    "import_rows": {"owner", "admin", "sales", "viewer"},
}
REFUSED_BY_PRIVILEGE = (401, 403)


# ------------------------------------------------------------------------------ row builders
def icp_row(tenant_id: str, **over: Any) -> dict[str, Any]:
    return {
        "id": uid(),
        "tenant_id": tenant_id,
        "engine": "icp-rules",
        "schema_version": 1,
        "config": TEMPLATE,
        **over,
    }


def label_row(tenant_id: str, lead_id: str, **over: Any) -> dict[str, Any]:
    return {"id": uid(), "tenant_id": tenant_id, "lead_id": lead_id, "label": "maybe", **over}


def export_row(tenant_id: str, **over: Any) -> dict[str, Any]:
    return {
        "id": uid(),
        "tenant_id": tenant_id,
        "kind": "lead_labels",
        "format": "csv",
        "row_count": 0,
        "content_sha256": "0" * 64,
        **over,
    }


def batch_row(tenant_id: str, **over: Any) -> dict[str, Any]:
    return {
        "id": uid(),
        "tenant_id": tenant_id,
        "content_sha256": "1" * 64,
        "row_count": 1,
        "rejected_count": 1,
        **over,
    }


def rows_row(tenant_id: str, batch_id: str, **over: Any) -> dict[str, Any]:
    return {
        "id": uid(),
        "tenant_id": tenant_id,
        "batch_id": batch_id,
        "row_no": 1,
        "outcome": "rejected",
        "reason": "invalid_row",
        **over,
    }


def insert_body(table: str, t: Tenant, seeded: dict[str, Any], **over: Any) -> dict[str, Any]:
    mine = seeded[t.id]
    return {
        "icp_config_versions": lambda: icp_row(t.id, **over),
        "lead_labels": lambda: label_row(t.id, t.rows["leads"]["id"], **over),
        "data_exports": lambda: export_row(t.id, **over),
        "import_batches": lambda: batch_row(t.id, **over),
        "import_rows": lambda: rows_row(t.id, mine["batch"], **over),
    }[table]()


# ------------------------------------------------------------------------------ seeding
def import_rpc(
    w: World,
    user: User | None,
    tenant_id: str,
    rows: list[dict[str, Any]],
    *,
    batch: str | None = None,
    dry: bool = False,
    representation: bool = True,
    **extra: Any,
) -> httpx.Response:
    body = {
        "p_tenant_id": tenant_id,
        "p_batch_id": batch or uid(),
        "p_rows": rows,
        "p_label": None,
        "p_dry_run": dry,
        **extra,
    }
    return pg(
        w.stack, user, "POST", "/rpc/import_lead_rows", json=body, representation=representation
    )


@pytest.fixture(scope="module")
def seeded(crm_world: World) -> dict[str, dict[str, Any]]:
    """Per tenant: an ICP version, a label, an export, an import batch with its rows, built the way
    the product builds them (admin / sales through PostgREST, the import through its function)."""
    w = crm_world
    out: dict[str, dict[str, Any]] = {}
    for t in (w.a, w.b):
        ids: dict[str, Any] = {"icp": uid(), "label": uid(), "export": uid(), "batch": uid()}
        steps = [
            ("admin", "/icp_config_versions", icp_row(t.id, id=ids["icp"])),
            (
                "sales",
                "/lead_labels",
                label_row(t.id, t.rows["leads"]["id"], id=ids["label"], label="good"),
            ),
            ("admin", "/data_exports", export_row(t.id, id=ids["export"])),
        ]
        for role, path, row in steps:
            who = t.users.get(role) or t.users["owner"]
            r = pg(w.stack, who, "POST", path, json=row, representation=False)
            assert r.status_code == 201, (path, r.text)
        imported = import_rpc(
            w,
            t.users["sales"],
            t.id,
            [{"company_name": f"DEMO Direct {t.label} {ids['batch'][:6]}", "city": "Bengaluru"}],
            batch=ids["batch"],
        )
        assert imported.status_code == 200, imported.text
        rows = pg(w.stack, t.users["owner"], "GET", f"/import_rows?batch_id=eq.{ids['batch']}")
        assert rows.status_code == 200 and len(rows.json()) == 1
        ids["row"] = rows.json()[0]["id"]
        out[t.id] = ids
    return out


KEY = {
    "icp_config_versions": "icp",
    "lead_labels": "label",
    "data_exports": "export",
    "import_batches": "batch",
    "import_rows": "row",
}


def both(w: World) -> list[tuple[Tenant, Tenant, str, User]]:
    out = [(w.a, w.b, role, user) for role, user in w.a.users.items()]
    out += [(w.b, w.a, role, user) for role, user in w.b.users.items()]
    return out


def victim(w: World, t: Tenant, seeded: dict[str, Any], table: str) -> Any:
    r = pg(
        w.stack,
        t.users["owner"],
        "GET",
        f"/{table}?id=eq.{seeded[t.id][KEY[table]]}&select=*",
    )
    assert r.status_code == 200 and len(r.json()) == 1, (table, r.text)
    return r.json()[0]


def total(w: World, t: Tenant, table: str) -> int:
    r = pg(w.stack, t.users["owner"], "GET", f"/{table}?select=id&limit=1000")
    assert r.status_code == 200
    return len(r.json())


def refused(r: httpx.Response) -> bool:
    """Refused by a privilege or RLS: 401 / 403 with SQLSTATE 42501."""
    return r.status_code in REFUSED_BY_PRIVILEGE and code_of(r) == "42501"


def integrity(r: httpx.Response, sqlstate: str) -> bool:
    """Refused by a constraint: 4xx with the given SQLSTATE (nothing was written)."""
    return r.status_code in (400, 409) and code_of(r) == sqlstate


# ==== 1. reads ====
@pytest.mark.parametrize("table", TABLES)
def test_other_tenants_rows_are_invisible(
    crm_world: World, seeded: dict[str, dict[str, Any]], table: str
) -> None:
    w = crm_world
    for own, other, role, user in both(w):
        label = f"{own.label}/{role}/{table}"
        scoped = pg(w.stack, user, "GET", f"/{table}?tenant_id=eq.{other.id}&select=*")
        by_id = pg(w.stack, user, "GET", f"/{table}?id=eq.{seeded[other.id][KEY[table]]}")
        if role in READERS[table]:
            assert scoped.status_code == 200 and scoped.json() == [], label
            assert by_id.status_code == 200 and by_id.json() == [], label
            everything = pg(w.stack, user, "GET", f"/{table}?select=tenant_id&limit=1000")
            assert {row["tenant_id"] for row in everything.json()} <= {own.id}, label
        else:  # data_exports for Sales / Viewer: RLS filters everything, not just the other tenant
            assert scoped.json() == [] and by_id.json() == [], label
            mine = pg(w.stack, user, "GET", f"/{table}?tenant_id=eq.{own.id}&select=id")
            assert mine.status_code == 200 and mine.json() == [], label


def test_reads_inside_the_tenant_follow_the_role_matrix(
    crm_world: World, seeded: dict[str, dict[str, Any]]
) -> None:
    w = crm_world
    for t in (w.a, w.b):
        for role, user in t.users.items():
            for table in TABLES:
                r = pg(w.stack, user, "GET", f"/{table}?id=eq.{seeded[t.id][KEY[table]]}&select=id")
                assert r.status_code == 200, (t.label, role, table)
                assert (len(r.json()) == 1) == (role in READERS[table]), (t.label, role, table)


def test_embedding_cannot_reach_across_tenants(
    crm_world: World, seeded: dict[str, dict[str, Any]]
) -> None:
    w = crm_world
    for own, other, role, user in both(w):
        for path in (
            f"/lead_labels?select=id,lead:leads(id,company:companies(name))&tenant_id=eq.{other.id}",
            f"/import_rows?select=id,batch:import_batches(id,label)&tenant_id=eq.{other.id}",
            f"/lead_labels?select=id,icp:icp_config_versions(config)&tenant_id=eq.{other.id}",
        ):
            r = pg(w.stack, user, "GET", path)
            assert r.status_code == 200 and r.json() == [], f"{own.label}/{role} {path}"


# ==== 2. anon ====
@pytest.mark.parametrize("table", TABLES)
def test_anon_reads_and_writes_nothing(
    crm_world: World, seeded: dict[str, dict[str, Any]], table: str
) -> None:
    w = crm_world
    read = pg(w.stack, None, "GET", f"/{table}?select=*")
    assert refused(read), (table, read.status_code, read.text)
    for t in (w.a, w.b):
        write = pg(
            w.stack,
            None,
            "POST",
            f"/{table}",
            json=insert_body(table, t, seeded),
            representation=False,
        )
        assert refused(write), (table, write.status_code)
        for method in ("PATCH", "DELETE"):
            r = pg(
                w.stack,
                None,
                method,
                f"/{table}?id=eq.{seeded[t.id][KEY[table]]}",
                json={"tenant_id": t.id} if method == "PATCH" else None,
                representation=False,
            )
            assert refused(r), (table, method)
        assert victim(w, t, seeded, table)["tenant_id"] == t.id


# ==== 3. the role matrix on direct inserts ====
@pytest.mark.parametrize("table", TABLES)
def test_direct_inserts_follow_the_role_matrix(
    crm_world: World, seeded: dict[str, dict[str, Any]], table: str
) -> None:
    w = crm_world
    for t in (w.a, w.b):
        for role, user in t.users.items():
            body = insert_body(table, t, seeded)
            r = pg(w.stack, user, "POST", f"/{table}", json=body, representation=False)
            if role in WRITERS[table]:
                assert r.status_code == 201, (t.label, role, table, r.text)
            else:
                assert refused(r), (t.label, role, table, r.status_code, r.text)
                # ...and nothing was written
                owner_seen = pg(
                    w.stack, t.users["owner"], "GET", f"/{table}?id=eq.{body['id']}&select=id"
                )
                assert owner_seen.json() == [], (t.label, role, table)


@pytest.mark.parametrize("table", ["icp_config_versions", "lead_labels", "data_exports"])
def test_a_tenant_id_that_is_not_yours_is_refused_even_with_valid_foreign_references(
    crm_world: World, seeded: dict[str, dict[str, Any]], table: str
) -> None:
    """The strongest cross-tenant write: tenant A's best-placed writer names tenant B as the owner
    of the row, using tenant B's REAL lead and ICP version ids."""
    w = crm_world
    for own, other, role, user in both(w):
        if role not in WRITERS[table]:
            continue
        before = total(w, other, table)
        body = insert_body(table, other, seeded)
        if table == "lead_labels":
            body.update(icp_version_id=seeded[other.id]["icp"], score=50, score_max_reachable=100)
            body["snapshot"] = {"score": 50}
        r = pg(w.stack, user, "POST", f"/{table}", json=body, representation=False)
        assert refused(r), (own.label, role, table, r.status_code, r.text)
        assert total(w, other, table) == before, (own.label, role, table)


# ==== 4. smuggled provenance and server-assigned columns ====
SMUGGLED: dict[str, list[tuple[str, Any]]] = {
    "icp_config_versions": [
        ("created_via", "agent"),
        ("created_via", "import"),
        ("created_by", "00000000-0000-0000-0000-000000000001"),
        ("created_at", "2000-01-01T00:00:00Z"),
        ("version_no", 99),
        ("config_sha256", "f" * 64),
    ],
    "lead_labels": [
        ("created_via", "agent"),
        ("created_via", "import"),
        ("created_by", "00000000-0000-0000-0000-000000000001"),
        ("created_at", "2000-01-01T00:00:00Z"),
    ],
    "data_exports": [
        ("created_via", "agent"),
        ("created_by", "00000000-0000-0000-0000-000000000001"),
        ("created_at", "2000-01-01T00:00:00Z"),
    ],
}


@pytest.mark.parametrize("table", sorted(SMUGGLED))
def test_server_owned_columns_cannot_be_smuggled_into_an_insert(
    crm_world: World, seeded: dict[str, dict[str, Any]], table: str
) -> None:
    w = crm_world
    for t in (w.a, w.b):
        writer = t.users["admin"] if "admin" in t.users else t.users["owner"]
        for column, value in SMUGGLED[table]:
            body = insert_body(table, t, seeded, **{column: value})
            r = pg(w.stack, writer, "POST", f"/{table}", json=body, representation=False)
            assert refused(r), (t.label, table, column, r.status_code, r.text)
            seen = pg(w.stack, writer, "GET", f"/{table}?id=eq.{body['id']}&select=id")
            assert seen.json() == [], (t.label, table, column)


def test_what_a_legitimate_insert_records_is_decided_by_the_server(
    crm_world: World, seeded: dict[str, dict[str, Any]]
) -> None:
    w = crm_world
    for t in (w.a, w.b):
        for table, role in (("icp_config_versions", "owner"), ("lead_labels", "sales")):
            body = insert_body(table, t, seeded)
            user = t.users[role]
            assert (
                pg(w.stack, user, "POST", f"/{table}", json=body, representation=False).status_code
                == 201
            )
            row = pg(w.stack, user, "GET", f"/{table}?id=eq.{body['id']}&select=*").json()[0]
            assert row["created_via"] == "manual", (t.label, table)
            assert row["created_by"] == str(user.id), (t.label, table)
            if table == "icp_config_versions":
                assert isinstance(row["version_no"], int) and row["version_no"] >= 1
                assert len(row["config_sha256"]) == 64


# ==== 5. append-only: UPDATE and DELETE ====
UPDATES: dict[str, list[dict[str, Any]]] = {
    "icp_config_versions": [
        {"engine": "icp-rules-2"},
        {"config": {"factors": []}},
        {"version_no": 1},
    ],
    "lead_labels": [{"label": "bad"}, {"reason_code": "not_our_market"}, {"score": 1}],
    "data_exports": [{"row_count": 7}, {"content_sha256": "a" * 64}],
    "import_batches": [{"label": "renamed"}, {"created_count": 99}],
    "import_rows": [{"outcome": "created"}, {"reason": "invalid_row"}],
}


@pytest.mark.parametrize("table", TABLES)
def test_no_role_can_update_or_delete_an_append_only_row(
    crm_world: World, seeded: dict[str, dict[str, Any]], table: str
) -> None:
    w = crm_world
    for t in (w.a, w.b):
        before = victim(w, t, seeded, table)
        target = f"/{table}?id=eq.{seeded[t.id][KEY[table]]}"
        for role, user in t.users.items():
            for change in UPDATES[table]:
                r = pg(w.stack, user, "PATCH", target, json=change, representation=False)
                assert refused(r), (t.label, role, table, change, r.status_code, r.text)
            deleted = pg(w.stack, user, "DELETE", target, representation=False)
            assert refused(deleted), (t.label, role, table, deleted.status_code)
        assert victim(w, t, seeded, table) == before, (t.label, table)


@pytest.mark.parametrize("table", TABLES)
def test_there_is_no_archive_path_either(
    crm_world: World, seeded: dict[str, dict[str, Any]], table: str
) -> None:
    """Unlike the evidence tables these have no archived_at column: nothing can be hidden or
    revoked in place, a changed mind is a NEW row."""
    w = crm_world
    target = f"/{table}?id=eq.{seeded[w.a.id][KEY[table]]}"
    r = pg(
        w.stack,
        w.a.users["owner"],
        "PATCH",
        target,
        json={"archived_at": "2026-01-01T00:00:00Z"},
        representation=False,
    )
    assert r.status_code in (400, 401, 403), (table, r.status_code, r.text)
    assert code_of(r) in ("PGRST204", "42501"), (table, code_of(r))


@pytest.mark.parametrize("table", TABLES)
def test_a_foreign_row_is_equally_untouchable(
    crm_world: World, seeded: dict[str, dict[str, Any]], table: str
) -> None:
    """The other tenant's Owner, the strongest foreign role, cannot update / delete / re-parent."""
    w = crm_world
    for own, other, _role, _user in [(w.a, w.b, "owner", w.a.users["owner"])] + [
        (w.b, w.a, "owner", w.b.users["owner"])
    ]:
        before = victim(w, other, seeded, table)
        target = f"/{table}?id=eq.{seeded[other.id][KEY[table]]}"
        for change in (*UPDATES[table], {"tenant_id": own.id}):
            r = pg(w.stack, own.users["owner"], "PATCH", target, json=change, representation=False)
            assert refused(r), (own.label, table, change, r.status_code)
        d = pg(w.stack, own.users["owner"], "DELETE", target, representation=False)
        assert refused(d), (own.label, table)
        assert victim(w, other, seeded, table) == before


# ==== 6. forged references ====
def test_references_to_another_tenants_rows_fail_like_references_to_nothing(
    crm_world: World, seeded: dict[str, dict[str, Any]]
) -> None:
    w = crm_world
    results = {}
    for name, extra in {
        "foreign icp version": {"icp_version_id": seeded[w.b.id]["icp"]},
        "unknown icp version": {"icp_version_id": uid()},
    }.items():
        body = label_row(
            w.a.id,
            w.a.rows["leads"]["id"],
            score=40,
            score_max_reachable=100,
            snapshot={"score": 40},
            **extra,
        )
        r = pg(w.stack, w.a.users["sales"], "POST", "/lead_labels", json=body, representation=False)
        assert integrity(r, "23503"), (name, r.status_code, r.text)
        results[name] = (r.status_code, code_of(r))
        assert (
            pg(w.stack, w.a.users["owner"], "GET", f"/lead_labels?id=eq.{body['id']}").json() == []
        )
    assert results["foreign icp version"] == results["unknown icp version"]

    foreign_lead = label_row(w.a.id, w.b.rows["leads"]["id"])
    unknown_lead = label_row(w.a.id, uid())
    codes = []
    for body in (foreign_lead, unknown_lead):
        r = pg(w.stack, w.a.users["sales"], "POST", "/lead_labels", json=body, representation=False)
        assert integrity(r, "23503"), (r.status_code, r.text)
        codes.append((r.status_code, code_of(r)))
    assert codes[0] == codes[1], "a foreign lead id and a missing one look the same"


# ==== 7. the label rules hold for a direct insert too ====
@pytest.mark.parametrize(
    ("name", "extra", "sqlstate"),
    [
        ("Bad without a reason", {"label": "bad"}, "23514"),
        ("an unknown reason code", {"label": "bad", "reason_code": "because_i_said_so"}, "22P02"),
        ("an unknown label", {"label": "excellent"}, "22P02"),
        (
            "a score without an ICP version",
            {"score": 10, "score_max_reachable": 100, "snapshot": {}},
            "23514",
        ),
        ("a score above 100", {"score": 101, "score_max_reachable": 100}, "23514"),
        ("a score above its own ceiling", {"score": 80, "score_max_reachable": 60}, "23514"),
        ("a snapshot that is not an object", {"snapshot": [1, 2, 3]}, "23514"),
        ("a missing label", {"label": None}, "23502"),
    ],
)
def test_label_rules_hold_without_the_api(
    crm_world: World,
    seeded: dict[str, dict[str, Any]],
    name: str,
    extra: dict[str, Any],
    sqlstate: str,
) -> None:
    w = crm_world
    body = label_row(w.a.id, w.a.rows["leads"]["id"], **extra)
    if "score" in extra and "snapshot" not in extra:
        body["icp_version_id"] = seeded[w.a.id]["icp"]
    if name == "a score without an ICP version":
        body["icp_version_id"] = None
    r = pg(w.stack, w.a.users["sales"], "POST", "/lead_labels", json=body, representation=False)
    assert integrity(r, sqlstate), (name, r.status_code, r.text)
    assert pg(w.stack, w.a.users["owner"], "GET", f"/lead_labels?id=eq.{body['id']}").json() == []


def test_an_oversized_or_unclean_snapshot_is_refused(
    crm_world: World, seeded: dict[str, dict[str, Any]]
) -> None:
    w = crm_world
    base = {
        "icp_version_id": seeded[w.a.id]["icp"],
        "score": 50,
        "score_max_reachable": 100,
    }
    for name, snapshot in (
        ("oversized", {"note": "x" * 5000}),
        ("zero-width space", {"note": "a​b"}),
        ("bidi override", {"note": "a‮b"}),
    ):
        body = label_row(w.a.id, w.a.rows["leads"]["id"], snapshot=snapshot, **base)
        r = pg(w.stack, w.a.users["sales"], "POST", "/lead_labels", json=body, representation=False)
        assert integrity(r, "23514"), (name, r.status_code, r.text)


def test_icp_config_must_be_a_valid_profile_even_when_sent_directly(
    crm_world: World,
) -> None:
    w = crm_world
    for name, config in (("empty", {}), ("not an object", [1]), ("no factors", {"bands": []})):
        r = pg(
            w.stack,
            w.a.users["admin"],
            "POST",
            "/icp_config_versions",
            json=icp_row(w.a.id, config=config),
            representation=False,
        )
        assert integrity(r, "23514"), (name, r.status_code, r.text)


# ==== 8. import_batches / import_rows: only the function writes them ====
@pytest.mark.parametrize("table", ["import_batches", "import_rows"])
def test_import_records_cannot_be_forged_directly(
    crm_world: World, seeded: dict[str, dict[str, Any]], table: str
) -> None:
    w = crm_world
    for t in (w.a, w.b):
        before = total(w, t, table)
        for role, user in t.users.items():
            r = pg(
                w.stack,
                user,
                "POST",
                f"/{table}",
                json=insert_body(table, t, seeded),
                representation=False,
            )
            assert refused(r), (t.label, role, table, r.status_code)
        assert total(w, t, table) == before


# ==== 9. rpc/import_lead_rows ====
def rows_for(label: str) -> list[dict[str, Any]]:
    return [{"company_name": f"DEMO Rpc {label} {uid()[:6]}", "city": "Bengaluru"}]


def test_the_import_function_refuses_anon(crm_world: World) -> None:
    w = crm_world
    r = import_rpc(w, None, w.a.id, rows_for("anon"), representation=False)
    assert r.status_code in REFUSED_BY_PRIVILEGE, (r.status_code, r.text)
    assert code_of(r) == "42501"


def test_the_import_function_is_tenant_and_role_checked(crm_world: World) -> None:
    w = crm_world
    attempts = {
        "Viewer of A into A": (w.a.users["viewer"], w.a.id),
        "Sales of B into A": (w.b.users["sales"], w.a.id),
        "Owner of A into B": (w.a.users["owner"], w.b.id),
        "Owner of A into an unknown tenant": (w.a.users["owner"], uid()),
        "Viewer of B into B": (w.b.users["viewer"], w.b.id),
    }
    seen = {}
    for name, (user, tenant_id) in attempts.items():
        marker = f"DEMO Rpc Refused {uid()[:8]}"
        r = import_rpc(w, user, tenant_id, [{"company_name": marker}], representation=False)
        assert refused(r), (name, r.status_code, r.text)
        seen[name] = (r.status_code, code_of(r))
        for t in (w.a, w.b):
            found = pg(w.stack, t.users["owner"], "GET", f"/companies?name=eq.{marker}&select=id")
            assert found.json() == [], (name, t.label)
    # a foreign tenant and a tenant that does not exist are indistinguishable
    assert seen["Owner of A into B"] == seen["Owner of A into an unknown tenant"]


def test_smuggled_parameters_do_not_reach_the_function(crm_world: World) -> None:
    """There is no parameter for provenance or identity: naming one is a different function, which
    does not exist."""
    w = crm_world
    smuggled: list[dict[str, Any]] = [
        {"p_created_via": "agent"},
        {"p_created_by": str(w.b.users["owner"].id)},
        {"p_content_sha256": "0" * 64},
        {"p_actor": str(w.b.users["owner"].id)},
    ]
    for extra in smuggled:
        marker = f"DEMO Rpc Smuggle {uid()[:8]}"
        r = import_rpc(
            w, w.a.users["sales"], w.a.id, [{"company_name": marker}], representation=False, **extra
        )
        assert r.status_code in (400, 404), (extra, r.status_code, r.text)
        assert code_of(r) in ("PGRST202", "PGRST203"), (extra, code_of(r))
        found = pg(w.stack, w.a.users["owner"], "GET", f"/companies?name=eq.{marker}&select=id")
        assert found.json() == []


def test_the_function_decides_provenance_and_the_gate_holds_over_http(crm_world: World) -> None:
    w = crm_world
    sales = w.a.users["sales"]
    batch = uid()
    good, real = f"DEMO Rpc Good {uid()[:6]}", f"DEMO Rpc Real {uid()[:6]}"
    r = import_rpc(
        w,
        sales,
        w.a.id,
        [
            {"company_name": good, "buyer_type": "saree_shop"},
            {
                "company_name": real,
                "contact_name": "Real Looking Person",
                "contact_email": "real.person@gmail.com",
            },
        ],
        batch=batch,
    )
    assert r.status_code == 200, r.text
    report = r.json()
    assert [row["outcome"] for row in report["rows"]] == ["created", "rejected"]
    assert report["rows"][1]["reason"] == "contact_domain_not_reserved"

    company = pg(w.stack, sales, "GET", f"/companies?name=eq.{good}&select=*").json()[0]
    assert company["created_via"] == "import" and company["created_by"] == str(sales.id)
    assert pg(w.stack, sales, "GET", f"/companies?name=eq.{real}&select=id").json() == []
    assert (
        pg(w.stack, sales, "GET", "/contacts?email=eq.real.person@gmail.com&select=id").json() == []
    )

    # provenance of the claim it wrote: one import evidence row, linked, no cell values
    ev = pg(
        w.stack,
        sales,
        "GET",
        f"/evidence?reference=eq.import:{batch}&select=id,kind,provider,snippet",
    ).json()
    assert len(ev) == 1 and ev[0]["kind"] == "import_batch" and ev[0]["provider"] == "import.csv"
    assert good not in json.dumps(ev) and "saree_shop" not in json.dumps(ev)
    claim = pg(
        w.stack, sales, "GET", f"/claims?company_id=eq.{company['id']}&select=id,value"
    ).json()
    assert len(claim) == 1
    links = pg(
        w.stack,
        sales,
        "GET",
        f"/evidence_links?claim_id=eq.{claim[0]['id']}&select=evidence_id,stance",
    ).json()
    assert links == [{"evidence_id": ev[0]["id"], "stance": "supports"}]
    # nothing about the refused person reached the batch records or the audit trail
    for path in (
        f"/import_rows?batch_id=eq.{batch}&select=*",
        f"/import_batches?id=eq.{batch}&select=*",
        "/audit_events?select=*&limit=1000",
    ):
        text = json.dumps(pg(w.stack, w.a.users["owner"], "GET", path).json()).lower()
        assert "real.person" not in text and "real looking" not in text, path


def test_a_dry_run_over_http_leaves_nothing_behind(crm_world: World) -> None:
    w = crm_world
    marker = f"DEMO Rpc Dry {uid()[:8]}"
    batch = uid()
    before = total(w, w.a, "import_batches")
    r = import_rpc(
        w,
        w.a.users["sales"],
        w.a.id,
        [{"company_name": marker, "buyer_type": "boutique"}],
        batch=batch,
        dry=True,
    )
    assert r.status_code == 200 and r.json()["dry_run"] is True
    assert pg(w.stack, w.a.users["owner"], "GET", f"/companies?name=eq.{marker}").json() == []
    assert total(w, w.a, "import_batches") == before
    assert (
        pg(w.stack, w.a.users["owner"], "GET", f"/evidence?reference=eq.import:{batch}").json()
        == []
    )


def test_a_batch_id_cannot_be_hijacked_across_tenants_or_payloads(
    crm_world: World, seeded: dict[str, dict[str, Any]]
) -> None:
    w = crm_world
    foreign_batch = seeded[w.b.id]["batch"]
    mine = seeded[w.a.id]["batch"]
    a = import_rpc(
        w, w.a.users["sales"], w.a.id, rows_for("hijack"), batch=foreign_batch, representation=False
    )
    b = import_rpc(
        w, w.a.users["sales"], w.a.id, rows_for("other payload"), batch=mine, representation=False
    )
    for r in (a, b):
        assert r.status_code == 409 and code_of(r) == "23505", (r.status_code, r.text)
    assert (a.status_code, code_of(a)) == (b.status_code, code_of(b)), "no tenant oracle"
    assert (
        pg(w.stack, w.a.users["owner"], "GET", f"/import_batches?id=eq.{foreign_batch}").json()
        == []
    )


def test_import_input_limits_are_enforced_in_the_function(crm_world: World) -> None:
    w = crm_world
    for name, rows in (
        ("no rows", []),
        ("501 rows", [{"company_name": f"DEMO Many {i}"} for i in range(501)]),
        ("not an array", {"company_name": "x"}),
    ):
        r = import_rpc(w, w.a.users["sales"], w.a.id, rows, representation=False)  # type: ignore[arg-type]
        assert r.status_code == 400 and code_of(r) == "22023", (name, r.status_code, r.text)


# ==== 10. import evidence cannot be forged either ====
def test_import_provenance_cannot_be_forged_by_a_client(crm_world: World) -> None:
    w = crm_world
    for role in ("owner", "admin", "sales"):
        body = {
            "id": uid(),
            "tenant_id": w.a.id,
            "kind": "import_batch",
            "provider": "import.csv",
            "reference": f"import:{uid()}",
        }
        r = pg(w.stack, w.a.users[role], "POST", "/evidence", json=body, representation=False)
        assert r.status_code in (400, 401, 403), (role, r.status_code, r.text)
        assert pg(w.stack, w.a.users["owner"], "GET", f"/evidence?id=eq.{body['id']}").json() == []
