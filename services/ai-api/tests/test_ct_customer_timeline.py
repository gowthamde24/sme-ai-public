"""One customer's timeline (app v4, part 3; migration 20261231320000; the rows are proven by pgTAP 179): the route pages it, any member reads it, and the database's answer is passed on as it is."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from tests.fakes import TENANT_A, auth, make_client

LEAD = uuid.UUID(int=77)


class FakeTimeline:
    def __init__(self, n: int) -> None:
        self.n = n
        self.asked: list[tuple[Any, ...]] = []

    def timeline(self, token: str, tenant_id: Any, lead_id: uuid.UUID, before: datetime | None, limit: int) -> list[dict[str, Any]]:
        self.asked.append((tenant_id, lead_id, before, limit))
        return [{"kind": "call", "at": f"2026-11-06T1{i}:00:00+00:00", "text": "Wants a red Kanchi silk", "target": {"type": "phone_call", "id": str(uuid.UUID(int=i))}, "detail": {}}
                for i in range(min(self.n, limit))]


def test_a_member_reads_the_timeline_in_pages() -> None:
    repo = FakeTimeline(3)
    client, _ = make_client(timeline=repo)
    url = f"/v1/tenants/{TENANT_A.id}/customers/{LEAD}/timeline"
    page = client.get(f"{url}?limit=2", headers=auth("a_viewer")).json()
    assert len(page["items"]) == 2 and page["next_before"] == page["items"][-1]["at"], "a full page says where the next one starts"
    last = client.get(url, params={"limit": 2, "before": page["next_before"]}, headers=auth("a_sales")).json()
    assert repo.asked[-1][2] is not None and last["next_before"] == last["items"][-1]["at"], "the next page is asked from where the last one ended"
    assert client.get(f"{url}?limit=500", headers=auth("a_owner")).status_code == 422
    assert client.get(f"/v1/tenants/{TENANT_A.id}/customers/not-a-uuid/timeline", headers=auth("a_owner")).status_code == 422
    assert client.get(url, headers=auth("outsider")).status_code in (403, 404)
