"""The repository ICP template is accepted by the database exactly as a tenant would publish it.

Real PostgREST, real constraints (an object, 1..20 factors, at most 32 KB, no hidden Unicode),
by an Owner or Admin and by nobody else."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from conftest import Stack, User
from crm_support import World, uid

PATH = Path(__file__).resolve().parents[2] / "config" / "icp" / "silk-wholesale.v1.json"


@pytest.fixture
def w(crm_world: World) -> World:
    return crm_world


def publish(stack: Stack, user: User, tenant_id: str, config: dict[str, Any]) -> httpx.Response:
    return httpx.post(
        f"{stack.rest}/icp_config_versions",
        headers=stack.headers(user.token, Prefer="return=representation"),
        json={
            "id": uid(),
            "tenant_id": tenant_id,
            "engine": "icp-rules",
            "schema_version": 1,
            "config": config,
        },
        timeout=20,
    )


def test_the_template_is_accepted_and_numbered_by_the_server(w: World) -> None:
    config = json.loads(PATH.read_text(encoding="utf-8"))
    first = publish(w.stack, w.a.users["owner"], w.a.id, config)
    assert first.status_code == 201, first.text
    row = first.json()[0]
    assert row["version_no"] >= 1 and len(row["config_sha256"]) == 64
    assert row["created_via"] == "manual" and row["config"]["factors"][0]["id"] == "silk_saree_fit"
    second = publish(w.stack, w.a.users["admin"], w.a.id, config)
    assert second.status_code == 201
    assert second.json()[0]["version_no"] == row["version_no"] + 1, (
        "every publish is the next number"
    )
    # Telugu / Kannada / Devanagari survive the round trip verbatim
    stored = httpx.get(
        f"{w.stack.rest}/icp_config_versions?id=eq.{row['id']}&select=config",
        headers=w.stack.headers(w.a.users["viewer"].token),
        timeout=20,
    ).json()[0]["config"]
    terms = {t["term"] for t in stored["vocabularies"]["silk_saree_strong"]["terms"]}
    assert {"చీర", "ಸೀರೆ", "साड़ी"} <= terms


def test_only_owner_and_admin_publish_and_other_tenants_see_nothing(w: World) -> None:
    config = json.loads(PATH.read_text(encoding="utf-8"))
    for role in ("sales", "viewer"):
        r = publish(w.stack, w.a.users[role], w.a.id, config)
        assert r.status_code in (401, 403), (role, r.status_code)
    assert publish(w.stack, w.b.users["owner"], w.a.id, config).status_code in (401, 403)
    published = publish(w.stack, w.a.users["owner"], w.a.id, config).json()[0]["id"]
    seen = httpx.get(
        f"{w.stack.rest}/icp_config_versions?id=eq.{published}",
        headers=w.stack.headers(w.b.users["owner"].token),
        timeout=20,
    )
    assert seen.status_code == 200 and seen.json() == []


def test_a_config_the_database_must_refuse(w: World) -> None:
    config = json.loads(PATH.read_text(encoding="utf-8"))
    bad_configs: list[dict[str, Any]] = [
        {"factors": []},
        {"nothing": 1},
        {**config, "template": {**config["template"], "purpose": "x\u200by"}},
    ]
    for bad in bad_configs:
        r = publish(w.stack, w.a.users["owner"], w.a.id, bad)
        assert r.status_code == 400 and r.json()["code"] == "23514", bad.keys()
    huge = {**config, "padding": "p" * 33000}
    assert publish(w.stack, w.a.users["owner"], w.a.id, huge).status_code == 400
