"""The developer API's OpenAPI 3.1 document and Postman collection, generated from the code (no running server, no database).

  python scripts/developer_openapi.py           writes docs/contracts/developer-api.openapi.json and docs/contracts/developer-api.postman_collection.json
  python scripts/developer_openapi.py --check   exits 1 when the committed files are stale (a test runs this; `make contracts` writes them)

The routes of /api/v1 (app/developer_api/routes.py and v1.py) give the paths, parameters and operation ids; app/developer_api/schemas.py gives the request and answer shapes.
The Postman collection is made from the document: one request per operation, `{{base_url}}` and `{{api_key}}` variables (never a key), an `Idempotency-Key: {{$guid}}` header where one is needed."""

# ruff: noqa: E501

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "services/ai-api"))

from fastapi import FastAPI  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from app.developer_api import routes, v1  # noqa: E402
from app.developer_api.schemas import REQUESTS, RESPONSES, ErrorOut  # noqa: E402

OPENAPI = ROOT / "docs/contracts/developer-api.openapi.json"
POSTMAN = ROOT / "docs/contracts/developer-api.postman_collection.json"
SCOPE = {
    ("POST", "/api/v1/leads"): "leads:write", ("GET", "/api/v1/leads"): "leads:read", ("GET", "/api/v1/leads/{lead_id}"): "leads:read",
    ("POST", "/api/v1/calls"): "calls:write", ("GET", "/api/v1/calls"): "calls:read", ("GET", "/api/v1/calls/{call_id}"): "calls:read",
    ("POST", "/api/v1/campaigns"): "campaigns:write", ("GET", "/api/v1/campaigns"): "campaigns:read", ("GET", "/api/v1/campaigns/{campaign_id}"): "campaigns:read",
    ("GET", "/api/v1/usage"): "usage:read", ("GET", "/api/v1/activity"): "usage:read", ("GET", "/api/v1/me"): "any live key",
}
IDEMPOTENT = {("POST", "/api/v1/leads"), ("POST", "/api/v1/calls"), ("POST", "/api/v1/campaigns")}
ERRORS = {"400": "A bad Idempotency-Key, cursor or parameter.", "401": "invalid_key: the key is missing, unknown, rotated or revoked.", "403": "missing_scope or ip_not_allowed.",
          "404": "not_found: no such object in this workspace.", "409": "idempotency_conflict: the Idempotency-Key was used with a different body.", "422": "The body or a gate refused it (the code says which).",
          "429": "rate_limited or too_many_calls: wait Retry-After seconds."}
DESCRIPTION = (
    "The Stack19 developer API. TEST MODE only: keys start with `sk_test_`, every call is simulated, nothing is dialled or sent, and every answer carries `Stack19-Mode: test`. "
    "Send `Authorization: Bearer sk_test_...`. 60 requests a minute per key (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After` on 429). Every refusal has the one body "
    "`{error: {code, message, retry_after, request_id}}`; the codes are listed in docs/contracts/error-codes.md. Contract: docs/contracts/developer-api.md.")


def _ref(model: type[BaseModel], schemas: dict[str, Any]) -> dict[str, Any]:
    schema = model.model_json_schema(ref_template="#/components/schemas/{model}")
    for name, sub in schema.pop("$defs", {}).items():
        schemas[name] = sub
    schemas[model.__name__] = schema
    return {"$ref": f"#/components/schemas/{model.__name__}"}


def build_openapi() -> dict[str, Any]:
    app = FastAPI(title="Stack19 developer API", version="1.0.0", description=DESCRIPTION,
                  servers=[{"url": "{base_url}", "variables": {"base_url": {"default": "http://localhost:8000", "description": "The API's address (no trailing slash)."}}}])
    app.include_router(routes.api_router)
    app.include_router(v1.v1_router)
    spec: dict[str, Any] = app.openapi()
    schemas: dict[str, Any] = {k: v for k, v in spec.get("components", {}).get("schemas", {}).items() if k not in ("HTTPValidationError", "ValidationError")}
    err = {"application/json": {"schema": _ref(ErrorOut, schemas)}}
    for path, item in spec["paths"].items():
        for method, op in item.items():
            key = (method.upper(), path)
            body = REQUESTS.get(key)
            if body is not None:
                example = (body.model_json_schema().get("examples") or [None])[0]
                media: dict[str, Any] = {"schema": _ref(body, schemas)}
                if example is not None:
                    media["example"] = example
                op["requestBody"] = {"required": True, "content": {"application/json": media}}
            responses: dict[str, Any] = {}
            for (m, p, status), model in RESPONSES.items():
                if (m, p) == key:
                    shapes = model if isinstance(model, tuple) else (model,)
                    refs = [_ref(x, schemas) for x in shapes]
                    responses[status] = {"description": "OK" if status == "200" else "Created", "content": {"application/json": {"schema": refs[0] if len(refs) == 1 else {"oneOf": refs}}}}
            op["responses"] = {**dict(sorted(responses.items())), **{c: {"description": d, "content": err} for c, d in ERRORS.items() if c in _codes(key)}}
            op["security"] = [{"bearerAuth": []}]
            op["description"] = f"Needs: {SCOPE[key]}." + (" Send an `Idempotency-Key` header (1 to 100 characters); the same key with the same body returns the first answer (200, `Idempotent-Replayed: true`)."
                                                             + (" Not needed with `dry_run: true`, which checks every gate and places nothing." if path.endswith("/calls") else "") if key in IDEMPOTENT else "")
            for param in op.get("parameters", []):
                if param.get("name") == "Idempotency-Key" and key != ("POST", "/api/v1/calls"):
                    param["required"] = True
    spec["components"] = {"schemas": dict(sorted(schemas.items())), "securitySchemes": {"bearerAuth": {"type": "http", "scheme": "bearer", "bearerFormat": "sk_test_..."}}}
    return spec


def _codes(key: tuple[str, str]) -> set[str]:
    out = {"401", "429"}
    if key[0] == "POST":
        out |= {"400", "422"}
    if key[0] == "POST" or key[1] != "/api/v1/me":
        out.add("403")
    if "{" in key[1] or key[0] == "POST":
        out.add("404")
    if key in IDEMPOTENT:
        out.add("409")
    if key[0] == "GET" and key[1] in ("/api/v1/leads", "/api/v1/calls", "/api/v1/activity", "/api/v1/campaigns"):
        out.add("400")
    return out


def build_postman(spec: dict[str, Any]) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for path, item in spec["paths"].items():
        for method, op in item.items():
            parts = [p for p in path.strip("/").split("/")]
            header = [{"key": "Authorization", "value": "Bearer {{api_key}}", "type": "text"}]
            request: dict[str, Any] = {"method": method.upper(), "header": header}
            if (method.upper(), path) in IDEMPOTENT:
                header.append({"key": "Idempotency-Key", "value": "{{$guid}}", "type": "text"})
            query = [{"key": p["name"], "value": "", "disabled": True} for p in op.get("parameters", []) if p["in"] == "query"]
            variables = [{"key": p["name"], "value": "", "description": "The id."} for p in op.get("parameters", []) if p["in"] == "path"]
            colon = [":" + x[1:-1] if x.startswith("{") else x for x in parts]
            raw = "{{base_url}}/" + "/".join(colon)
            if query:
                raw += "?" + "&".join(f"{q['key']}=" for q in query)
            request["url"] = {"raw": raw, "host": ["{{base_url}}"], "path": colon, "query": query, "variable": variables}
            body = op.get("requestBody", {}).get("content", {}).get("application/json")
            if body is not None:
                header.append({"key": "Content-Type", "value": "application/json", "type": "text"})
                request["body"] = {"mode": "raw", "raw": json.dumps(body.get("example", {}), indent=2), "options": {"raw": {"language": "json"}}}
            request["description"] = op["description"]
            items.append({"name": op["summary"], "request": request})
    return {"info": {"name": "Stack19 developer API (test mode)", "description": DESCRIPTION, "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"},
            "variable": [{"key": "base_url", "value": "http://localhost:8000"}, {"key": "api_key", "value": "", "description": "Your test key (sk_test_...). Keep it out of shared collections."}],
            "item": items}


def render() -> dict[Path, str]:
    spec = build_openapi()
    return {OPENAPI: json.dumps(spec, indent=2, sort_keys=True) + "\n", POSTMAN: json.dumps(build_postman(spec), indent=2, sort_keys=True) + "\n"}


def main(argv: list[str]) -> int:
    files = render()
    if "--check" in argv:
        stale = [str(p.relative_to(ROOT)) for p, text in files.items() if not p.exists() or p.read_text(encoding="utf-8") != text]
        if stale:
            print("stale (run `make contracts`): " + ", ".join(stale))
            return 1
        return 0
    for path, text in files.items():
        path.write_text(text, encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
