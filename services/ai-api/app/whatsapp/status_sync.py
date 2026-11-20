"""WhatsApp's decision on our templates, read by the worker (planner, 20 Nov 2026; Customer Zero code list item 3, part 2).

Right after "Connect WhatsApp" the catalogue is sent to the shop's account for review. Meta answers in minutes to a day, and nothing told us: a template stayed `submitted` until somebody pressed "Check WhatsApp's answer".
Now, every few minutes, the worker asks the database which connected accounts still have submitted templates (`scheduler_wa_templates_due`), asks Meta for the status of that account's templates (the same call as the
button) and tells the database (`scheduler_wa_templates_decided`: one call per account; the status changes only when Meta's word is different; a rejection is a "Needs you" item for the owner, see migration 986800).

Off by default (`TEMPLATE_SYNC`). The token of an account is read from the same token store as the sends; nothing about it is logged, only counts and closed words."""

from __future__ import annotations

import logging
from typing import Any, Protocol

from app.config import Settings
from app.whatsapp import first_templates

logger = logging.getLogger("app.whatsapp.status_sync")


class Rpc(Protocol):
    def object(self, token: str, function: str, args: dict[str, Any]) -> dict[str, Any]: ...
    def call(self, token: str, function: str, args: dict[str, Any]) -> Any: ...


class Graph(Protocol):
    def list_templates(self, waba_id: str, token: str) -> list[dict[str, Any]] | None: ...


class Tokens(Protocol):
    def get(self, ref: str) -> str | None: ...


def decisions(due: list[dict[str, Any]], theirs: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """For each submitted template of an account: what Meta says, as the database's words. A template Meta does not list yet stays `submitted` (it is only marked as asked)."""
    said = {(str(t["name"]), str(t["language"])[:2]): t for t in theirs}
    out: list[dict[str, Any]] = []
    for template in due:
        found = said.get((str(template.get("meta_name") or template["name"]), str(template["language"])))
        status = first_templates.META_STATUS.get(str(found["status"]).upper()) if found else None
        reason = str(found.get("rejected_reason") or "") if found else ""
        code = reason if status in ("rejected", "paused", "disabled") and reason.isascii() and reason.replace("_", "").isalnum() and reason.upper() == reason and reason not in ("NONE",) and 2 <= len(reason) <= 40 else None
        out.append({"id": str(template["id"]), "status": status or "submitted", "reject_code": code})
    return out


class TemplateStatusSync:
    def __init__(self, graph: Graph, tokens: Tokens, rpc: Rpc, *, limit: int = 20, minutes: int = 10) -> None:
        self._graph, self._tokens, self._rpc = graph, tokens, rpc
        self._limit, self._minutes = limit, minutes

    def run(self, token: str) -> int:
        """One pass (every tick; the database says which accounts are due, so most ticks do nothing). Returns how many templates changed status."""
        accounts = self._rpc.call(token, "scheduler_wa_templates_due", {"p_limit": self._limit, "p_minutes": self._minutes})
        changed = 0
        for account in accounts if isinstance(accounts, list) else []:
            access = self._tokens.get(str(account.get("token_ref") or ""))
            if access is None:
                logger.warning("template sync: no token for an account, skipped")
                continue
            theirs = self._graph.list_templates(str(account["waba_id"]), access)
            if theirs is None:
                continue   # Meta did not answer: the same accounts are asked again on the next tick
            result = self._rpc.object(token, "scheduler_wa_templates_decided", {"p_tenant_id": str(account["tenant_id"]), "p_decisions": decisions(account.get("templates") or [], theirs)})
            changed += int(result.get("changed") or 0)
        if changed:
            logger.info("template sync: %d template(s) changed status", changed)
        return changed


def build_template_sync(settings: Settings, rest_url: str, anon_key: str, *, graph: Graph | None = None, tokens: Tokens | None = None, rpc: Rpc | None = None) -> TemplateStatusSync | None:
    """The sync for the worker, or None while TEMPLATE_SYNC is off (the default)."""
    if not settings.template_sync:
        return None
    from app.rpc_base import RpcClient
    from app.whatsapp.factory import token_resolver
    from app.whatsapp.graph import GraphClient

    resolver = tokens or token_resolver(settings)
    return TemplateStatusSync(graph or GraphClient(settings.whatsapp_api_base, settings.whatsapp_graph_version), resolver, rpc or RpcClient(rest_url, anon_key, {}))
