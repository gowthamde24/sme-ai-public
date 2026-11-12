"""Job test-workspaces (C2 -> C1, item 3): the lead sources a business type uses; a school gets its own short list."""

# ruff: noqa: E501
from __future__ import annotations

from pathlib import Path
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


PROPERTY = {"99acres", "magicbricks", "housing"}


class _Packs:
    def __init__(self, pack_id: str | None = None, error: bool = False) -> None:
        self.pack_id, self.error = pack_id, error

    def workspace_pack(self, token: str, tenant_id: Any) -> dict[str, Any]:
        if self.error:
            raise RuntimeError("down")
        return {"pack_id": self.pack_id}


def _offered(pack: _Packs | None) -> dict[str, Any]:
    c, _ = make_client(tasks=TasksService(FakeTasksRepository(school=False)), packs=pack)
    body: dict[str, Any] = c.get(f"/v1/tenants/{TENANT_A.id}/lead-sources/offered", headers=auth("a_sales")).json()
    return body


def test_property_portals_are_offered_to_property_and_general_businesses_only() -> None:
    """Owner via C2, 12 Nov: a saree shop's "Where from" filter showed 99acres, MagicBricks and Housing.com."""
    for pack in ("textiles", "construction_materials", "wholesale_b2b", "clinic", "gym", "auto_dealer", "travel"):
        tags = set(_offered(_Packs(pack))["tags"])
        assert not PROPERTY & tags, pack
        assert {"indiamart", "justdial", "website_form", "excel_upload"} <= tags, pack
    for pack in ("real_estate", "general_business"):
        assert PROPERTY <= set(_offered(_Packs(pack))["tags"]), pack


def test_a_pack_that_is_unknown_or_cannot_be_read_gets_the_full_list_not_a_broken_filter() -> None:
    for pack in (None, _Packs(None), _Packs(error=True)):
        body = _offered(pack)
        assert PROPERTY <= set(body["tags"]) and "indiamart" in body["tags"] and body["school"] is False


def test_every_pack_id_and_tag_in_the_offered_by_pack_data_is_real() -> None:
    from typing import get_args

    from app.lead_sources.models import SourceTag
    from app.lead_sources.routes import only_for_packs

    packs_dir = Path(__file__).resolve().parents[3] / "packages" / "packs"
    real = {p.name for p in packs_dir.iterdir() if p.is_dir()}
    for tag, packs in only_for_packs().items():
        assert tag in get_args(SourceTag), tag
        assert packs and packs <= real, (tag, packs - real)
