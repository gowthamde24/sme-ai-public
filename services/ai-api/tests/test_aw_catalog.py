"""A1 of job assistant-does-the-work: every operation of the API is decided (a tool with a level and an undo, or screen only with a reason), by rules over the live route list.

Pinned: the forbidden list is screen only; every request the billing gate calls a spend is a SENSITIVE tool; a body that carries a credential is a SECRETS tool (the secure card); a DELETE is deleting;
a settings PUT with a matching GET declares a snapshot undo; names are unique; the tool share of the non-forbidden operations is at least 90%; the committed table is what the routes give today."""

# ruff: noqa: E501

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

from app.assistant_tools import catalog
from app.billing.gate import classify as billing_classify
from tests.fakes import make_client

ROOT = Path(__file__).resolve().parents[3]


def decisions() -> list[catalog.Decision]:
    client, _ = make_client()
    return catalog.decide(catalog.operations(client.app.openapi()))  # type: ignore[attr-defined]


def test_every_operation_is_decided_and_the_tool_share_is_at_least_ninety_percent() -> None:
    ds = decisions()
    cov = catalog.coverage(ds)
    assert cov["operations"] >= 500 and cov["tools"] + cov["screen_only"] == cov["operations"]
    assert cov["tool_share_of_not_forbidden"] >= 90.0, cov
    assert all((d.tool and d.level is not None) or (not d.tool and d.screen_only is not None) for d in ds)
    names = [d.op.name for d in ds]
    assert len(names) == len(set(names)), "a tool name is unique"


def test_the_forbidden_list_is_screen_only() -> None:
    by = {(d.op.method, catalog.tail(d.op.path)): d for d in decisions()}
    for (method, path), reason in {("PUT", "/data-policy"): "real_data_gate"}.items():
        hits = [d for (m, p), d in by.items() if p.startswith(path)]
        assert hits and all(not d.tool and d.screen_only == reason for d in hits), path
        assert method
    for d in by.values():
        t = catalog.tail(d.op.path)
        if d.op.method != "GET" and t.startswith("/billing"):
            assert not d.tool and d.screen_only == "billing", t
        if d.op.method != "GET" and t.startswith("/deletion-requests"):
            assert not d.tool and d.screen_only == "workspace_deletion", t
        if t.startswith(("/assistant/", "/conversations")):
            assert not d.tool, t


def test_every_spend_of_the_billing_gate_is_a_sensitive_tool() -> None:
    for d in decisions():
        concrete = re.sub(r"\{[^}]+\}", "x", catalog.tail(d.op.path))
        if d.tool and billing_classify(d.op.method, concrete) == "spend":
            assert d.level == "sensitive", (d.op.method, concrete)


def test_a_credential_is_a_secrets_tool_and_a_delete_is_deleting() -> None:
    ds = decisions()
    secret = [d for d in ds if d.tool and any(catalog.SECRET_FIELD.search(f) for f in d.op.body_fields)]
    assert secret and all(d.sensitive == "secrets" for d in secret)
    assert all(d.sensitive == "deleting" for d in ds if d.tool and d.op.method == "DELETE")


def test_a_settings_put_with_a_read_declares_a_snapshot_undo() -> None:
    ds = decisions()
    gets = {d.op.path for d in ds if d.op.method == "GET"}
    for d in ds:
        if d.tool and d.op.method == "PUT" and d.op.path in gets:
            if d.op.path.endswith("/limits"):
                # the one deliberate exception: Limits can only be tightened over the API, so putting the old (looser) snapshot back would be refused; no undo is promised
                assert d.undo == "none", d.op.path
                continue
            assert d.undo == "snapshot" and d.undo_via, d.op.path
    assert catalog.coverage(ds)["write_tools_with_undo"] >= 40


def test_the_committed_table_is_what_the_routes_give_today() -> None:
    out = subprocess.run([sys.executable, str(ROOT / "scripts" / "assistant_coverage.py"), "--check"], cwd=ROOT / "services" / "ai-api", capture_output=True, text=True)  # noqa: S603 - our own script
    assert out.returncode == 0, out.stderr[-500:]


def test_the_tool_list_route_answers_the_catalogue_to_staff_only() -> None:
    from tests.fakes import TENANT_A, auth

    client, _ = make_client()
    r = client.get(f"/v1/tenants/{TENANT_A.id}/assistant/tools", headers=auth("a_sales"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["items"]) >= 400 and body["screen_only"]
    one = next(i for i in body["items"] if i["path"] == "/call-settings" and i["method"] == "PUT")
    assert one["level"] == "write" and one["undo"] == "snapshot"
    assert any(s["path"] == "/data-policy" and s["reason"] == "real_data_gate" for s in body["screen_only"])
    assert client.get(f"/v1/tenants/{TENANT_A.id}/assistant/tools", headers=auth("a_viewer")).status_code == 403
