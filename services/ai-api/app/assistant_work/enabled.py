"""Which workspaces have "the assistant does the work" (ASSISTANT_WORK_TENANTS).

Owner, 5 Nov 2026: on staging, the owner's three test workspaces only. Every door of it asks
here: the chat files, the plan cards, Settings > Activity and its undo (routes.py: a 404
elsewhere, as if it were not there) and the chat turn (app/turns/service.py: the router and the
file turn are skipped, the turn goes on exactly as before). The web reads the same list.

  unset                      every workspace (local development and the tests: unchanged)
  ids, separated by ; or ,   only those workspaces
  set but empty, or "none"   no workspace
"""

from __future__ import annotations

import re
import uuid
from typing import Any

_SEP = re.compile(r"[;,\s]+")


def parse_tenants(raw: str | None) -> frozenset[uuid.UUID] | None:
    """The setting as a set of workspace ids; None means every workspace.

    An entry that is not a workspace id stops the API at start: a typo must not switch it on or
    off unseen.
    """
    if raw is None:
        return None
    out: set[uuid.UUID] = set()
    for part in _SEP.split(raw.strip()):
        if not part or part.lower() == "none":
            continue
        try:
            out.add(uuid.UUID(part))
        except ValueError:
            raise ValueError(
                "ASSISTANT_WORK_TENANTS: every entry must be a workspace id (separated by ; or ,)"
            ) from None
    return frozenset(out)


def enabled(runtime: Any, tenant_id: uuid.UUID) -> bool:
    allowed: frozenset[uuid.UUID] | None = getattr(runtime, "assistant_work_tenants", None)
    return allowed is None or tenant_id in allowed
