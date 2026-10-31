"""The live activity feed (owner decision, 31 Oct 2026): GET /assistant/activity. Against a fake data layer: the shape, the display-name rule, the empty state, the roles, no caching. The database's own rules are pgTAP 146."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from app.assistant_activity.routes import POLL_AFTER_S, shape
from tests.by_fakes import FakeWorkspace
from tests.fakes import TENANT_A, auth, make_client

LEAD = str(uuid.UUID(int=0x1EAD))
TASK = str(uuid.UUID(int=0x7A5C))


def rows(*extra: dict[str, Any]) -> list[dict[str, Any]]:
    base = {"started_at": "2026-10-31T10:00:00+00:00", "elapsed_s": 12, "target_kind": "lead", "target_id": LEAD}
    return [{**base, **e} for e in extra]


def test_the_feed_is_one_item_per_piece_of_work_with_a_display_name_and_a_link() -> None:
    from datetime import UTC, datetime

    out = shape(rows({"type": "call", "name": "Ramesh", "phone": "+919876543210", "target_kind": "task", "target_id": TASK, "elapsed_s": 134}, {"type": "whatsapp_reply", "name": "WhatsApp 4407", "phone": "+0091234567801", "target_kind": "conversation"},
                     {"type": "lead_read", "name": "Enquiry 8a297f", "phone": None}), datetime(2026, 10, 31, tzinfo=UTC))
    assert out["caught_up"] is False and out["poll_after_s"] == POLL_AFTER_S == 5 and out["updated_at"].endswith("Z")
    call, reply, read = out["items"]
    assert call == {"type": "call", "who": "Ramesh", "started_at": "2026-10-31T10:00:00+00:00", "elapsed_s": 134, "target": {"kind": "task", "id": TASK}}
    assert reply["who"] == "+0091234567801" and reply["target"] == {"kind": "conversation", "id": LEAD}, "the name, else the number"
    assert read["who"] == "New enquiry", "an internal id is never a name"
    assert "phone" not in out["items"][0] and "9876543210" not in str(out), "the number itself is never returned except as the display fallback"


def test_nothing_in_flight_is_all_caught_up() -> None:
    from datetime import UTC, datetime

    out = shape([], datetime(2026, 10, 31, tzinfo=UTC))
    assert out["items"] == [] and out["caught_up"] is True


def test_a_viewer_s_items_have_no_who_and_a_made_up_type_or_target_is_ignored() -> None:
    from datetime import UTC, datetime

    out = shape(rows({"type": "lead_read", "name": None, "phone": None}, {"type": "mystery", "name": "X"}, {"type": "quote_draft", "name": "A", "target_kind": "elsewhere", "target_id": LEAD}), datetime(2026, 10, 31, tzinfo=UTC))
    assert [i["type"] for i in out["items"]] == ["lead_read", "quote_draft"] and out["items"][0]["who"] is None and out["items"][1]["target"] is None


def test_the_route_answers_members_only_and_is_never_cached() -> None:
    ws = FakeWorkspace()
    ws.activity = lambda token, tenant_id: rows({"type": "lead_read", "name": "Gowtham Reddy", "phone": "+919876543210"})  # type: ignore[attr-defined]
    client, _ = make_client(workspace=ws)
    url = f"/v1/tenants/{TENANT_A.id}/assistant/activity"
    for user in ("a_owner", "a_admin", "a_sales", "a_viewer"):
        r = client.get(url, headers=auth(user))
        assert r.status_code == 200 and r.headers["cache-control"] == "no-store", user
        assert r.json()["items"][0]["who"] == "Gowtham Reddy" and "+919876543210" not in r.text
    assert client.get(url).status_code == 401 or client.get(url).status_code == 403
    assert client.get(url, headers=auth("outsider")).status_code in (403, 404)
