"""The live activity feed (owner decision, 31 Oct 2026: "Live now", replaces the usage widgets). What the assistant is doing right now in this workspace, as one item per piece of work.

  GET /v1/tenants/{t}/assistant/activity    any member -> {items: [{type, who, started_at, elapsed_s, target}], caught_up, updated_at, poll_after_s}

`type`: call | whatsapp_reply | follow_up | quote_draft | lead_read. `who`: the contact's display name (the name, else the number, else "New enquiry"; never an id; null for a Viewer). `target`: {kind: task | conversation | quote | lead, id}
for the link, or null. Only real in-flight work (a call in progress; replies, follow-ups, quotes and reads of the last ~60 s). No message content. At most 20 items, priority order (call, whatsapp_reply, follow_up,
quote_draft, lead_read), newest first inside a type. `caught_up` is true when there is nothing: the screen says "All caught up". Poll every `poll_after_s` seconds; the answer is never cached."""

# ruff: noqa: E501

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Response

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.display_name import lead_title
from app.errors import ApiError

router = APIRouter(prefix="/v1/tenants/{tenant_id}/assistant", tags=["assistant"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
TYPES = ("call", "whatsapp_reply", "follow_up", "quote_draft", "lead_read")
TARGETS = ("task", "conversation", "quote", "lead")
POLL_AFTER_S = 5


def shape(rows: list[dict[str, Any]], now: datetime) -> dict[str, Any]:
    items = []
    for r in rows:
        if r.get("type") not in TYPES:
            continue
        who = lead_title(r.get("name"), r.get("phone")) if (r.get("name") is not None or r.get("phone") is not None) else None
        target = {"kind": r["target_kind"], "id": str(r["target_id"])} if r.get("target_kind") in TARGETS and r.get("target_id") else None
        items.append({"type": r["type"], "who": who, "started_at": r.get("started_at"), "elapsed_s": int(r.get("elapsed_s") or 0), "target": target})
    return {"items": items, "caught_up": not items, "updated_at": now.isoformat().replace("+00:00", "Z"), "poll_after_s": POLL_AFTER_S}


@router.get("/activity")
def activity(ctx: AnyMember, runtime: RuntimeDep, response: Response) -> dict[str, Any]:
    if runtime.workspace is None:
        raise ApiError(503, "unavailable", "This is not available right now.")
    response.headers["Cache-Control"] = "no-store"
    rows = runtime.workspace.activity(ctx.principal.token, ctx.tenant.id)
    return shape(rows, datetime.now(UTC))
