"""Job test-workspaces (C2 -> C1, item 3): the lead sources a business type uses; a school gets its own short list."""

# ruff: noqa: E501
from __future__ import annotations

from typing import Any

from app.tasks.service import TasksService
from tests.dr_tasks_fakes import FakeTasksRepository
from tests.fakes import TENANT_A, auth, make_client


def _client(school: bool) -> Any:
    c, _ = make_client(tasks=TasksService(FakeTasksRepository(school=school)))
    return c


def test_a_school_is_offered_its_own_lead_sources_only() -> None:
    from typing import get_args

    from app.lead_sources.models import SourceTag

    school = _client(True).get(f"/v1/tenants/{TENANT_A.id}/lead-sources/offered", headers=auth("a_sales")).json()
    assert school["school"] is True and school["tags"] == ["website_form", "meta_lead_ads", "excel_upload", "google_sheet", "pasted_list", "vcard"]
    assert not {"indiamart", "justdial", "99acres", "magicbricks", "housing"} & set(school["tags"])
    shop = _client(False).get(f"/v1/tenants/{TENANT_A.id}/lead-sources/offered", headers=auth("a_viewer")).json()
    assert shop["school"] is False and "indiamart" in shop["tags"] and set(shop["tags"]) <= set(get_args(SourceTag))
