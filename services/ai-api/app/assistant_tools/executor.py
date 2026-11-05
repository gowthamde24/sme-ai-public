"""Run ONE tool (job assistant-does-the-work, design 1): the route the screens call, called inside this process with the person's own token.

There is no second way in: the request goes through the whole application (the rate limits, the origin lock, the billing gate, the route's own role rule and validation, row-level security in the
database and the audit trigger), exactly as if the screen had sent it. The only differences: the request is made by the server, and it carries `X-Assistant-Message: <message id>` (the chat message
that asked for it) so the action log can name it.

Undo (declared by the catalogue):
  * snapshot  before a settings PUT, the matching GET is read and kept, reduced to the fields the PUT accepts; undo PUTs it back;
  * inverse   archive -> restore, pause -> resume, disable -> enable, with the same path; an import -> its undo (by its import_id);
  * none      no clean way back: the plan card says so before the OK.
A screen-only operation, or a name that is not in the catalogue, is refused here before anything is sent."""

# ruff: noqa: E501

from __future__ import annotations

import re
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal

import httpx

from app.assistant_tools import catalog

StepError = Literal["forbidden", "invalid", "conflict", "not_found", "limit", "down"]
PARAM = re.compile(r"\{([a-z_]+)\}")
MESSAGE_HEADER = "X-Assistant-Message"


class ToolRefused(Exception):
    """Not a tool (unknown, or screen only), or its arguments do not fit its route. Nothing was sent."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Call:
    tool: str
    path: dict[str, str] = field(default_factory=dict)       # the route's path parameters (not tenant_id)
    query: dict[str, str] = field(default_factory=dict)
    body: dict[str, Any] | None = None


@dataclass(frozen=True)
class Result:
    ok: bool
    status: int
    error: StepError | None
    answer: Any
    undo: dict[str, Any] | None   # what undo needs: {"kind": "snapshot", "tool": <put>, "path": {...}, "body": {...}} | {"kind": "inverse", "tool": <name>, "path": {...}} | None


def error_of(status: int) -> StepError | None:
    if status < 400:
        return None
    if status in (401, 403):
        return "forbidden"
    if status == 404:
        return "not_found"
    if status == 409:
        return "conflict"
    if status == 429:
        return "limit"
    if status in (400, 413, 415, 422):
        return "invalid"
    return "down"


class Catalogue:
    """The decided operations by tool name, from this application's own route list."""

    def __init__(self, openapi: dict[str, Any]) -> None:
        self.decisions = catalog.decide(catalog.operations(openapi))
        self.by_name = {d.op.name: d for d in self.decisions}
        self._top_fields = {d.op.name: _top_fields(openapi, d.op) for d in self.decisions if d.op.method in ("PUT", "PATCH")}

    def tool(self, name: str) -> catalog.Decision:
        d = self.by_name.get(name)
        if d is None or not d.tool:
            raise ToolRefused("not_a_tool")
        return d

    def put_fields(self, name: str) -> tuple[str, ...]:
        return self._top_fields.get(name, ())


def _top_fields(openapi: dict[str, Any], op: catalog.Operation) -> tuple[str, ...]:
    item = openapi.get("paths", {}).get(op.path, {}).get(op.method.lower(), {})
    schema = (((item.get("requestBody") or {}).get("content") or {}).get("application/json") or {}).get("schema") or {}
    ref = schema.get("$ref")
    if isinstance(ref, str) and ref.startswith("#/components/schemas/"):
        schema = openapi.get("components", {}).get("schemas", {}).get(ref.rsplit("/", 1)[1], {})
    return tuple(sorted((schema.get("properties") or {}).keys()))


def url_of(d: catalog.Decision, tenant_id: uuid.UUID, path: dict[str, str]) -> str:
    names = [n for n in PARAM.findall(d.op.path) if n != "tenant_id"]
    if set(path) != set(names):
        raise ToolRefused("path_parameters")
    out = d.op.path.replace("{tenant_id}", str(tenant_id))
    for n in names:
        value = str(path[n])
        if not re.fullmatch(r"[A-Za-z0-9._~-]{1,200}", value):
            raise ToolRefused("path_parameters")
        out = out.replace("{" + n + "}", value)
    return out


def inverse_path(cat: Catalogue, tool: str, call: Call) -> dict[str, str]:
    """The undo route's path parameters: the step's own, and any other from its body (an import's undo is addressed by the import's `import_id`)."""
    d = cat.by_name.get(tool)
    names = [n for n in PARAM.findall(d.op.path) if n != "tenant_id"] if d is not None else []
    out = {n: call.path[n] for n in names if n in call.path}
    for n in names:
        if n not in out and isinstance(call.body, dict) and call.body.get(n) is not None:
            out[n] = str(call.body[n])
    return out


async def run(client: httpx.AsyncClient, cat: Catalogue, tenant_id: uuid.UUID, token: str, call: Call, message_id: uuid.UUID | None = None) -> Result:
    """Send the tool's request through the application. `client` is an AsyncClient on the app's own ASGI transport (or, in a test, the TestClient's)."""
    d = cat.tool(call.tool)
    url = url_of(d, tenant_id, call.path)
    headers = {"Authorization": f"Bearer {token}"}
    if message_id is not None:
        headers[MESSAGE_HEADER] = str(message_id)
    undo: dict[str, Any] | None = None
    if d.undo == "snapshot" and d.undo_via:
        before = await client.get(url, params=call.query or None, headers=headers)
        state = before.json() if before.status_code == 200 and before.headers.get("content-type", "").startswith("application/json") else None
        if before.status_code == 404:
            pass   # nothing there yet: the write creates it (its undo is "none" for this step)
        elif not isinstance(state, dict):
            # the state before could not be read: the write would lose its declared undo, so it is not sent
            return Result(ok=False, status=before.status_code, error=error_of(before.status_code) or "down", answer=None, undo=None)
        else:
            keep = cat.put_fields(d.op.name)
            if not (set(keep) & state.keys()) and isinstance(state.get("settings"), dict):   # a read that wraps the saved shape (GET /call-settings -> {settings, defaults, ...})
                state = state["settings"]
            undo = {"kind": "snapshot", "tool": d.op.name, "path": dict(call.path), "body": {k: v for k, v in state.items() if k in keep}}
    elif d.undo == "inverse" and d.undo_via:
        undo = {"kind": "inverse", "tool": d.undo_via, "path": inverse_path(cat, d.undo_via, call)}
    response = await client.request(d.op.method, url, params=call.query or None, json=call.body if d.op.method != "GET" else None, headers=headers)
    try:
        answer: Any = response.json()
    except ValueError:
        answer = None
    ok = response.status_code < 400
    return Result(ok=ok, status=response.status_code, error=error_of(response.status_code), answer=answer, undo=undo if ok else None)


async def undo(client: httpx.AsyncClient, cat: Catalogue, tenant_id: uuid.UUID, token: str, how: dict[str, Any], message_id: uuid.UUID | None = None) -> Result:
    """Undo one done step from what `run` kept."""
    if how.get("kind") == "snapshot":
        return await run(client, cat, tenant_id, token, Call(tool=str(how["tool"]), path=dict(how.get("path") or {}), body=dict(how.get("body") or {})), message_id)
    if how.get("kind") == "inverse":
        return await run(client, cat, tenant_id, token, Call(tool=str(how["tool"]), path=dict(how.get("path") or {})), message_id)
    raise ToolRefused("no_undo")
