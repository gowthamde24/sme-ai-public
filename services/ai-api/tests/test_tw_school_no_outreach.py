"""Job test-workspaces (C2 -> C1, item 2): a school has no outreach. Every /outreach route, the report included, answers 403 `outreach_not_available` for a school; a shop is unaffected."""

# ruff: noqa: E501
from __future__ import annotations

from typing import Any

import pytest

from app.outreach.service import OutreachService
from app.tasks.service import TasksService
from tests.dr_outreach_fakes import FakeOutreachRepository
from tests.dr_tasks_fakes import FakeTasksRepository
from tests.fakes import TENANT_A, auth, make_client

URL = f"/v1/tenants/{TENANT_A.id}/outreach"


def _client(school: bool) -> Any:
    c, _ = make_client(outreach=OutreachService(FakeOutreachRepository()), tasks=TasksService(FakeTasksRepository(school=school)))
    return c


@pytest.mark.parametrize("method, path", [("get", "/policy"), ("get", "/batches"), ("post", "/batches"), ("get", "/rules"), ("post", "/rules"), ("get", "/handoffs"), ("get", "/reports")])
def test_a_school_gets_no_outreach_route(method: str, path: str) -> None:
    r = getattr(_client(True), method)(f"{URL}{path}", headers=auth("a_owner"), **({"json": {}} if method == "post" else {}))
    assert r.status_code == 403 and r.json()["error"]["code"] == "outreach_not_available", (path, r.text)


def test_a_shop_still_has_them() -> None:
    c = _client(False)
    assert c.get(f"{URL}/batches", headers=auth("a_owner")).status_code == 200
    assert c.get(f"{URL}/policy", headers=auth("a_owner")).status_code == 200


def test_a_non_member_still_gets_the_usual_answer_first() -> None:
    assert _client(True).get(f"{URL}/batches", headers=auth("outsider")).status_code == 404


def test_a_school_is_offered_its_own_lead_sources_only() -> None:
    from typing import get_args

    from app.lead_sources.models import SourceTag

    school = _client(True).get(f"/v1/tenants/{TENANT_A.id}/lead-sources/offered", headers=auth("a_sales")).json()
    assert school["school"] is True and school["tags"] == ["website_form", "meta_lead_ads", "excel_upload", "google_sheet", "pasted_list", "vcard"]
    assert not {"indiamart", "justdial", "99acres", "magicbricks", "housing"} & set(school["tags"])
    shop = _client(False).get(f"/v1/tenants/{TENANT_A.id}/lead-sources/offered", headers=auth("a_viewer")).json()
    assert shop["school"] is False and "indiamart" in shop["tags"] and set(shop["tags"]) <= set(get_args(SourceTag))
