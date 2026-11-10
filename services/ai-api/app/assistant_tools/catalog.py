"""The assistant's tool catalogue (job assistant-does-the-work, design 1; owner decision 4 Nov 2026): EVERY user-facing action of the app, decided once.

Each operation of the API under /v1/tenants/{tenant_id} (the same routes the screens call: same row-level security, same validation, same audit) is either
  * a TOOL: a thin wrapper over that route, never a back door, with a LEVEL (read: runs at once; write: plan card -> the owner's OK -> run -> "Done · Undo"; sensitive: the plan card with an explicit
    confirm, Owner only) and, for a sensitive one, the REASON (money, sending, members, deleting, billing, secrets); and an UNDO method where the route has a clean way back; or
  * SCREEN ONLY, with a closed reason: never the assistant's, always a screen and a person (the real-data gate, billing changes, deleting the workspace or a person's data, the assistant's own
    plumbing, a binary upload that comes in through the chat's file drop instead).
The decision is made by RULES over the method and the path (below), plus the billing gate's own list of the requests that spend (app/billing/gate.py), so a new route is decided the day it is added and
the coverage table (scripts/assistant_coverage.py -> docs/assistant-tools-coverage.md) is generated from the live route list, never typed. tests/test_aw_catalog.py pins the rules and the numbers.
Nothing here runs a tool: this is the inventory the registry, the router and the plan card read."""

# ruff: noqa: E501

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, Literal

from app.billing.gate import classify as billing_classify

Level = Literal["read", "write", "sensitive"]
Sensitive = Literal["money", "sending", "members", "deleting", "billing", "secrets"]
ScreenOnly = Literal["real_data_gate", "billing", "workspace_deletion", "erasure", "assistant_itself", "internal", "binary_upload", "developer_keys", "safety_switch"]
Undo = Literal["snapshot", "inverse", "none"]

TENANT = "/v1/tenants/{tenant_id}"
WRITE_METHODS = ("POST", "PUT", "PATCH", "DELETE")

# ---- screen only: in order, the first rule that matches decides (path after the tenant)
SCREEN_ONLY_RULES: tuple[tuple[str, re.Pattern[str], ScreenOnly], ...] = (
    ("*", re.compile(r"^/data-policy"), "real_data_gate"),                                   # opening (or closing) the real-data gate: always a screen and the owner
    ("W", re.compile(r"^/billing(/|$)"), "billing"),                                         # a plan, a trial, a payment method, a cancel: never the assistant's
    ("W", re.compile(r"^/deletion-requests"), "workspace_deletion"),                         # deleting the workspace
    ("W", re.compile(r"^/erasure-requests"), "erasure"),                                     # erasing a person's data (DPDP): a person decides, with a reason
    ("W", re.compile(r"^/calls/take-over-setting$"), "safety_switch"),                     # the switch that lets a person listen in on or take over a live call: only the Owner, on a screen, never by the assistant (job 1)
    ("W", re.compile(r"^/developer/keys(/|$)"), "developer_keys"),                          # making, rotating or revoking an API key: its secret is shown once, on the screen, never in the chat
    ("*", re.compile(r"^/(assistant|conversations)(/|$)"), "assistant_itself"),              # the chat and the voice themselves (the assistant does not call its own door)
    ("*", re.compile(r"^/(scheduler|agent-runs|agent-claims|claims|agent-cost)(/|$)"), "internal"),   # the worker's and the agent runtime's own doors
    ("W", re.compile(r"/photos($|/)|/voice-clone/samples|/upload$|/files$|/audio$|/speech/transcribe$"), "binary_upload"),  # a file's bytes: they come in through the chat's file drop (A2), not as a tool argument
)

# ---- the level of a write (after screen-only): the first matching reason makes it SENSITIVE
# a body field with one of these names carries a credential: the value is asked for on the SECURE card only (never in the chat, never to the model)
SECRET_FIELD = re.compile(r"(^|_)(api_?key|key|token|secret|password|passphrase|credentials?)($|_)", re.IGNORECASE)
SENSITIVE_RULES: tuple[tuple[re.Pattern[str], Sensitive], ...] = (
    (re.compile(r"^/(members|invitations|team)(/|$)"), "members"),
    (re.compile(r"(/payment-links|/record-payment|/payments?(/|$)|/refunds?(/|$)|/ledger(/|$)|/price-lists|/pricelists|/quotes/[^/]+/approve|/orders/[^/]+/(accept|advance|payment|refund|cancel)|/fees?/|/fee-|/dues/)"), "money"),
    (re.compile(r"(/remove$|/delete$|/archive$|/erase$|/purge$|/example-data/(remove|reset)$)"), "deleting"),
    (re.compile(r"^/visits/[^/]+/confirm$"), "sending"),   # confirming a visit sends the customer its confirmation (through the outbox policy)
)


@dataclass(frozen=True)
class Operation:
    method: str
    path: str                 # the full path, with {tenant_id}
    name: str                 # the tool's name: <area>.<the route function's name>
    summary: str              # the route's own first docstring line (what the screens' route says it does)
    has_body: bool
    body_fields: tuple[str, ...] = ()   # the names of the request body's fields (from its schema)


@dataclass(frozen=True)
class Decision:
    op: Operation
    tool: bool
    level: Level | None = None
    sensitive: Sensitive | None = None
    screen_only: ScreenOnly | None = None
    undo: Undo = "none"
    undo_via: str | None = None   # inverse: the route that undoes it; snapshot: the GET that reads the state before


def tail(path: str) -> str:
    return path[len(TENANT):] if path.startswith(TENANT) else path


def area(path: str) -> str:
    parts = tail(path).strip("/").split("/")
    return parts[0] if parts and parts[0] else "workspace"


def _fields(openapi: dict[str, Any], op: dict[str, Any]) -> tuple[str, ...]:
    schema = (((op.get("requestBody") or {}).get("content") or {}).get("application/json") or {}).get("schema") or {}
    seen: set[str] = set()

    def walk(node: Any, depth: int) -> None:
        if depth > 4 or not isinstance(node, dict):
            return
        ref = node.get("$ref")
        if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
            node = openapi.get("components", {}).get("schemas", {}).get(ref.rsplit("/", 1)[1], {})
        for key, sub in (node.get("properties") or {}).items():
            seen.add(str(key))
            walk(sub, depth + 1)
        for k in ("anyOf", "oneOf", "allOf"):
            for sub in node.get(k) or []:
                walk(sub, depth + 1)
        walk(node.get("items"), depth + 1)

    walk(schema, 0)
    return tuple(sorted(seen))


def operations(openapi: dict[str, Any]) -> list[Operation]:
    """Every operation of the API under /v1/tenants/{tenant_id}, from the OpenAPI document (the same list the screens' client is generated from). Two routes with one function name in one area are
    told apart by their method."""
    out: list[Operation] = []
    for path, item in sorted(openapi.get("paths", {}).items()):
        if not path.startswith(TENANT + "/") and path != TENANT:
            continue
        for method, op in item.items():
            if method.upper() not in ("GET", *WRITE_METHODS):
                continue
            op_id = str(op.get("operationId") or "")
            fn = op_id.split("_v1_")[0] if "_v1_" in op_id else op_id
            summary = str(op.get("summary") or op.get("description") or fn).strip().split("\n")[0][:200]
            out.append(Operation(method=method.upper(), path=path, name=f"{area(path)}.{fn}", summary=summary, has_body="requestBody" in op, body_fields=_fields(openapi, op)))
    counts: dict[str, int] = {}
    for o in out:
        counts[o.name] = counts.get(o.name, 0) + 1

    def suffix(o: Operation) -> str:
        words = [w for w in tail(o.path).strip("/").split("/")[1:] if not w.startswith("{")]
        return re.sub(r"[^a-z0-9]+", "_", "_".join(words).lower()).strip("_") or o.method.lower()

    return [Operation(o.method, o.path, f"{o.name}.{suffix(o)}", o.summary, o.has_body, o.body_fields) if counts[o.name] > 1 else o for o in out]


def _screen_only(op: Operation) -> ScreenOnly | None:
    t = tail(op.path)
    for scope, rx, reason in SCREEN_ONLY_RULES:
        if (scope == "*" or op.method in WRITE_METHODS) and rx.search(t):
            return reason
    return None


def _sensitive(op: Operation) -> Sensitive | None:
    t = tail(op.path)
    concrete = re.sub(r"\{[^}]+\}", "x", t)
    if op.method == "DELETE":
        return "deleting"
    if any(SECRET_FIELD.search(f) for f in op.body_fields):
        return "secrets"
    for rx, reason in SENSITIVE_RULES:
        if rx.search(t):
            return reason
    if billing_classify(op.method, concrete) == "spend":
        return "sending"   # the billing gate's own list of the requests that send, call, run a model or reach an outside service
    return None


def _undo(op: Operation, by_key: dict[tuple[str, str], Operation]) -> tuple[Undo, str | None]:
    if tail(op.path) == "/limits":
        return "none", None   # Limits can only be tightened over the API: putting the old (looser) snapshot back would be refused, so no undo is promised; loosening is done in the settings pages
    if op.method == "PUT" and ("GET", op.path) in by_key:
        return "snapshot", by_key[("GET", op.path)].name    # read it first, put it back
    # an import: its undo archives what it created (POST /lead-imports/{import_id}/undo; the id is the import's own `import_id`, from its body)
    if op.method == "POST" and tail(op.path) == "/lead-imports" and ("POST", op.path + "/{import_id}/undo") in by_key:
        return "inverse", by_key[("POST", op.path + "/{import_id}/undo")].name
    # a created thing whose id is the caller's (in the body) and that has its own discard route: About my business's sources (POST /knowledge/sources -> /knowledge/sources/{source_id}/discard)
    if op.method == "POST":
        discard = next((k for k in by_key if k[0] == "POST" and re.fullmatch(re.escape(op.path) + r"/\{[a-z_]+_id\}/discard", k[1])), None)
        if discard is not None:
            return "inverse", by_key[discard].name
    if op.method == "POST" and op.path.endswith("/archive"):
        back = op.path[: -len("/archive")] + "/restore"
        if ("POST", back) in by_key:
            return "inverse", by_key[("POST", back)].name
    for a, b in (("/pause", "/resume"), ("/resume", "/pause"), ("/disable", "/enable"), ("/enable", "/disable")):
        if op.method == "POST" and op.path.endswith(a) and ("POST", op.path[: -len(a)] + b) in by_key:
            return "inverse", by_key[("POST", op.path[: -len(a)] + b)].name
    return "none", None


def decide(ops: Iterable[Operation]) -> list[Decision]:
    ops = list(ops)
    by_key = {(o.method, o.path): o for o in ops}
    out: list[Decision] = []
    for op in ops:
        reason = _screen_only(op)
        if reason is not None:
            out.append(Decision(op=op, tool=False, screen_only=reason))
            continue
        if op.method == "GET":
            concrete = re.sub(r"\{[^}]+\}", "x", tail(op.path))
            if billing_classify(op.method, concrete) == "spend":   # a read that reaches a paid outside service (the outside lead search): it costs money, so the owner confirms it
                out.append(Decision(op=op, tool=True, level="sensitive", sensitive="money"))
            else:
                out.append(Decision(op=op, tool=True, level="read"))
            continue
        sens = _sensitive(op)
        undo, via = _undo(op, by_key)
        out.append(Decision(op=op, tool=True, level="sensitive" if sens else "write", sensitive=sens, undo=undo, undo_via=via))
    return out


def coverage(decisions: Iterable[Decision]) -> dict[str, Any]:
    """The A1 numbers: every operation, how many are tools, how many are screen only and why; the share of the non-forbidden ones that are tools."""
    ds = list(decisions)
    tools = [d for d in ds if d.tool]
    screen = [d for d in ds if not d.tool]
    forbidden = [d for d in screen if d.screen_only in ("real_data_gate", "billing", "workspace_deletion", "erasure", "safety_switch")]
    not_forbidden = len(ds) - len(forbidden)
    by_reason: dict[str, int] = {}
    for d in screen:
        by_reason[str(d.screen_only)] = by_reason.get(str(d.screen_only), 0) + 1
    by_level: dict[str, int] = {}
    for d in tools:
        key = str(d.level) if d.level != "sensitive" else f"sensitive:{d.sensitive}"
        by_level[key] = by_level.get(key, 0) + 1
    undoable = sum(1 for d in tools if d.level != "read" and d.undo != "none")
    writes = sum(1 for d in tools if d.level != "read")
    return {"operations": len(ds), "tools": len(tools), "screen_only": len(screen), "forbidden": len(forbidden), "not_forbidden": not_forbidden,
            "tool_share_of_not_forbidden": round(100.0 * len(tools) / not_forbidden, 1) if not_forbidden else 0.0,
            "screen_only_by_reason": dict(sorted(by_reason.items())), "tools_by_level": dict(sorted(by_level.items())), "write_tools": writes, "write_tools_with_undo": undoable}
