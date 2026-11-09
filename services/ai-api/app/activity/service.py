"""Shapes the timeline for the page: links to where each item lives, nothing else is added or invented."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

HREF = {"call": "office/live?call={id}", "lead": "leads/{id}"}


def _href(tenant_id: uuid.UUID, kind: str, ref_id: Any) -> str | None:
    path = HREF.get(kind)
    return f"/app/tenants/{tenant_id}/" + path.format(id=ref_id) if path and ref_id else None


def item_out(tenant_id: uuid.UUID, item: dict[str, Any]) -> dict[str, Any]:
    out = dict(item)
    if item.get("kind") == "call":
        out["href"] = _href(tenant_id, "call", item.get("id"))
    elif item.get("kind") == "message":
        out["href"] = _href(tenant_id, "lead", item.get("lead_id"))
    else:
        out["href"] = None
    return out


def activity_out(tenant_id: uuid.UUID, raw: dict[str, Any], encode_cursor: Callable[[dict[str, Any] | None], str | None]) -> dict[str, Any]:
    return {"items": [item_out(tenant_id, i) for i in raw.get("items") or []], "next_cursor": encode_cursor(raw.get("next"))}
