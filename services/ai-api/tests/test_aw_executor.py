"""The executor runs ONE tool through the application itself (job assistant-does-the-work): the same route, the person's own token, the whole middleware and role rules; a settings write keeps a
snapshot and undo puts it back; a screen-only operation and arguments that do not fit the route are refused before anything is sent."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import uuid

import httpx
import pytest

from app.assistant_tools import executor
from app.lead_finder.service import LeadFinderService
from tests.fakes import TENANT_A, auth, make_client
from tests.lf_fakes import NOW, FakeLeadFinderRepo


def world() -> tuple[object, executor.Catalogue, FakeLeadFinderRepo]:
    repo = FakeLeadFinderRepo("textiles")
    client, _ = make_client(lead_finder=LeadFinderService(repo, mode="fixture", clock=lambda: NOW))
    return client, executor.Catalogue(client.app.openapi()), repo  # type: ignore[attr-defined]


def token(user: str) -> str:
    return auth(user)["Authorization"].split(" ", 1)[1]


async def _run(client: object, cat: executor.Catalogue, user: str, call: executor.Call) -> executor.Result:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=client.app), base_url="http://test") as http:  # type: ignore[attr-defined]
        return await executor.run(http, cat, TENANT_A.id, token(user), call, uuid.uuid4())


async def _undo(client: object, cat: executor.Catalogue, user: str, how: dict[str, object]) -> executor.Result:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=client.app), base_url="http://test") as http:  # type: ignore[attr-defined]
        return await executor.undo(http, cat, TENANT_A.id, token(user), how)


def test_a_settings_write_runs_through_the_route_keeps_a_snapshot_and_undo_puts_it_back() -> None:
    client, cat, repo = world()
    d = cat.tool("lead-finder.put_settings")
    assert d.level == "write" and d.undo == "snapshot"
    out = asyncio.run(_run(client, cat, "a_owner", executor.Call(tool="lead-finder.put_settings", body={"fit_bar": 85})))
    assert out.ok and out.status == 200 and repo.settings["fit_bar"] == 85
    assert out.undo is not None and out.undo["kind"] == "snapshot" and out.undo["body"]["fit_bar"] == 70, "the state before, reduced to what the PUT accepts"
    assert "updated_at" not in out.undo["body"], "a read-only field is not put back"
    back = asyncio.run(_undo(client, cat, "a_owner", out.undo))
    assert back.ok and repo.settings["fit_bar"] == 70


def test_a_write_whose_state_before_cannot_be_read_is_not_sent_so_it_never_loses_its_undo() -> None:
    from app.tenancy.repository import UpstreamError

    client, cat, repo = world()
    written: list[dict[str, object]] = []

    def down(token: str, tenant_id: uuid.UUID) -> dict[str, object]:
        raise UpstreamError("08000")

    def record(token: str, tenant_id: uuid.UUID, settings: dict[str, object]) -> dict[str, object]:
        written.append(settings)
        return {}

    repo.settings_get = down  # type: ignore[method-assign]
    repo.settings_set = record  # type: ignore[method-assign]
    out = asyncio.run(_run(client, cat, "a_owner", executor.Call(tool="lead-finder.put_settings", body={"fit_bar": 85})))
    assert not out.ok and out.undo is None and out.error in ("down", "invalid") and written == [], "no snapshot, no write"


def test_the_routes_own_role_rule_applies_a_sales_member_cannot_change_the_settings() -> None:
    client, cat, repo = world()
    out = asyncio.run(_run(client, cat, "a_sales", executor.Call(tool="lead-finder.put_settings", body={"fit_bar": 85})))
    assert not out.ok and out.status == 403 and out.error == "forbidden" and out.undo is None and repo.settings["fit_bar"] == 70


def test_a_read_tool_answers_at_once() -> None:
    client, cat, _ = world()
    out = asyncio.run(_run(client, cat, "a_sales", executor.Call(tool="lead-finder.availability")))
    assert out.ok and out.answer == {"available": True, "source": "fixture", "reason": "ok", "upgrade_to": None, "audience": "businesses"} and out.undo is None


def test_a_screen_only_operation_or_an_unknown_name_is_refused_before_anything_is_sent() -> None:
    client, cat, _ = world()
    screen_only = next(d.op.name for d in cat.decisions if not d.tool and d.screen_only == "real_data_gate")
    for name in (screen_only, "no.such_tool"):
        with pytest.raises(executor.ToolRefused) as info:
            asyncio.run(_run(client, cat, "a_owner", executor.Call(tool=name)))
        assert info.value.code == "not_a_tool"


def test_path_parameters_must_fit_the_route_exactly() -> None:
    client, cat, _ = world()
    for path in ({}, {"search_id": "a/b"}, {"search_id": str(uuid.uuid4()), "extra": "x"}):
        with pytest.raises(executor.ToolRefused):
            asyncio.run(_run(client, cat, "a_owner", executor.Call(tool="lead-finder.approve", path=path)))


@pytest.mark.parametrize("status, error", [(200, None), (403, "forbidden"), (404, "not_found"), (409, "conflict"), (422, "invalid"), (429, "limit"), (502, "down")])
def test_the_step_error_words(status: int, error: str | None) -> None:
    assert executor.error_of(status) == error
