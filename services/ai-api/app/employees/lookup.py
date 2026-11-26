# ruff: noqa: E501
"""The employee a task names, read with the owner's own token while the task runs (migration 992770: `public.task_employee`). None: no employee named, or the named one is not on: the default employee does the call."""

from __future__ import annotations

import uuid
from collections.abc import Callable
from typing import Any

from app.rpc_base import RpcClient


def task_employee_lookup(rest_url: str, anon_key: str) -> Callable[[str, uuid.UUID, uuid.UUID], dict[str, Any] | None]:
    rpc = RpcClient(rest_url, anon_key, {})

    def lookup(token: str, tenant_id: uuid.UUID, task_id: uuid.UUID) -> dict[str, Any] | None:
        out = rpc.call(token, "task_employee", {"p_tenant_id": str(tenant_id), "p_task_id": str(task_id)})
        return out if isinstance(out, dict) else None

    return lookup
