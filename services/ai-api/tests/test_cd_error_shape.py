"""Job CD: one error shape for every refusal (app/errors.py). The test WALKS THE OPENAPI DOCUMENT: every operation is called signed out, as a Viewer, and with a body of the wrong kind, and every answer of 400 or more must be

    {"error": {"code": str, "message": str, "retry_after": int | null, "request_id": str, ...}}   with request_id == the x-request-id header, and retry_after == the Retry-After header when there is one.

The 429s of the middleware and of the routes, the 500 of an unexpected failure, the unknown path and the wrong method are checked as well. A source scan fails if any module other than app/errors.py builds an error body. No database, no network."""

from __future__ import annotations

import re
import uuid
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.errors import ERROR_SCHEMA, ApiError, error_body
from tests.fakes import TENANT_A, TEST_REQUEST_ID, auth, make_client

METHODS = ("get", "post", "put", "patch", "delete")
FIXED_KEYS = {"code", "message", "retry_after", "request_id"}
KNOWN_EXTRAS = {"fields", "reason", "until"}


def operations(client: TestClient) -> list[tuple[str, str, dict[str, Any]]]:
    doc = client.app.openapi()  # type: ignore[attr-defined]
    return [(method.upper(), path, op) for path, item in sorted(doc["paths"].items()) for method, op in item.items() if method in METHODS]


def concrete(path: str) -> str:
    out = path.replace("{tenant_id}", str(TENANT_A.id))
    return re.sub(r"\{[^}]+\}", lambda m: str(uuid.UUID(int=0xC0FFEE)), out)


def assert_error_shape(response: Any, where: str) -> dict[str, Any]:
    assert response.headers["content-type"].startswith("application/json"), where
    body = response.json()
    assert set(body) <= {"error", "issues"} and "error" in body, f"{where}: {body}"
    error = body["error"]
    assert FIXED_KEYS <= set(error), f"{where}: missing {FIXED_KEYS - set(error)}"
    assert set(error) - FIXED_KEYS <= KNOWN_EXTRAS, f"{where}: unexpected {set(error) - FIXED_KEYS - KNOWN_EXTRAS}"
    assert isinstance(error["code"], str) and re.fullmatch(r"[a-z][a-z0-9_]*", error["code"]), where
    assert isinstance(error["message"], str) and error["message"], where
    assert error["retry_after"] is None or (isinstance(error["retry_after"], int) and error["retry_after"] >= 0), where
    assert error["request_id"] == response.headers["x-request-id"], f"{where}: the body and the header name different request ids"
    header = response.headers.get("retry-after")
    if header is not None and header.isdigit():
        assert error["retry_after"] == int(header), where
    if error["retry_after"] is not None:
        assert header == str(error["retry_after"]), f"{where}: retry_after without the Retry-After header"
    return error  # type: ignore[no-any-return]


def walk(client: TestClient, headers: dict[str, str], body: Any = None) -> dict[tuple[str, str], tuple[int, dict[str, Any] | None]]:
    seen: dict[tuple[str, str], tuple[int, dict[str, Any] | None]] = {}
    for method, path, _ in operations(client):
        if path == "/metrics":
            continue
        kwargs: dict[str, Any] = {"headers": headers}
        if method in ("POST", "PUT", "PATCH") and body is not None:
            kwargs["json"] = body
        response = client.request(method, concrete(path), **kwargs)
        where = f"{method} {path} -> {response.status_code}"
        error = assert_error_shape(response, where) if response.status_code >= 400 else None
        seen[(method, path)] = (response.status_code, error)
    return seen


# ------------------------------------------------------------------------------------------------------------------------ the walk
def test_every_operation_signed_out_answers_in_the_one_shape() -> None:
    client, _ = make_client()
    seen = walk(client, {}, body={})
    codes = [error["code"] for status, error in seen.values() if error is not None and status == 401]
    assert len(codes) >= 100 and set(codes) == {"unauthorized"}
    assert len(seen) >= 150, "the walk covered the API"


def test_every_operation_as_a_viewer_or_a_stranger_answers_in_the_one_shape() -> None:
    client, _ = make_client()
    viewer = walk(client, auth("a_viewer"), body={})
    forbidden = {error["code"] for status, error in viewer.values() if status == 403 and error is not None}
    assert sum(1 for status, _ in viewer.values() if status == 403) >= 25, "a Viewer is refused on many writes"
    assert forbidden <= {"forbidden", "mfa_required"} | {c for c in forbidden if re.fullmatch(r"[a-z_]+", c)}
    stranger = walk(client, auth("outsider"), body={})
    assert sum(1 for status, _ in stranger.values() if status == 404) >= 100, "a stranger to the workspace is told it does not exist"


def test_every_operation_with_a_body_of_the_wrong_kind_is_a_422_that_names_fields_never_values() -> None:
    client, _ = make_client()
    hostile = "CANARY-should-never-come-back"
    wrong = walk(client, auth("a_owner"), body=[hostile])
    refused = [(key, error) for key, (status, error) in wrong.items() if status == 422 and error is not None]
    assert len(refused) >= 80, "most writes validate a body"
    for key, error in refused:
        assert error["code"] == "validation_error" and error["fields"] and all(isinstance(f, str) for f in error["fields"]), key
        assert hostile not in error["message"] and hostile not in " ".join(error["fields"]), f"{key} echoed a submitted value"
    assert any(error["fields"] == ["body"] for _, error in refused), "a body of the wrong kind says `body`"


def test_a_field_that_is_wrong_is_named_by_its_path() -> None:
    client, _ = make_client()
    response = client.post(f"/v1/tenants/{TENANT_A.id}/leads", json={"company_id": "not-a-uuid", "unknown_field": 1}, headers=auth("a_owner"))
    error = assert_error_shape(response, "wrong field")
    assert response.status_code == 422 and "company_id" in error["fields"] and "not-a-uuid" not in response.text


# ------------------------------------------------------------------------------------------------------------------------ 429, 500, 404, 405
def test_the_middleware_429_has_the_shape_the_header_and_the_wait() -> None:
    client, _ = make_client(rate_limit=True)
    last = None
    for _ in range(130):
        last = client.get("/health")
        if last.status_code == 429:
            break
    assert last is not None and last.status_code == 429
    error = assert_error_shape(last, "middleware 429")
    assert error["code"] == "rate_limited" and isinstance(error["retry_after"], int) and error["retry_after"] >= 1
    assert last.headers["retry-after"] == str(error["retry_after"]) and last.headers["x-request-id"] == TEST_REQUEST_ID


def test_a_route_429_with_a_wait_gets_the_header_and_the_field_from_either_side() -> None:
    from_header = ApiError(429, "rate_limited", "Slow down.", headers={"Retry-After": "7"})
    assert from_header.retry_after == 7 and from_header.headers["Retry-After"] == "7"
    from_field = ApiError(429, "rate_limited", "Slow down.", retry_after=9)
    assert from_field.retry_after == 9 and from_field.headers == {"Retry-After": "9"}
    none = ApiError(429, "invitation_locked", "Try later.")
    assert none.retry_after is None and none.headers == {}
    assert ApiError(429, "x", "y", headers={"retry-after": "Wed, 21 Oct 2026 07:28:00 GMT"}).retry_after is None, "only the seconds form"


def test_an_unexpected_failure_is_a_500_with_nothing_about_the_failure() -> None:
    client, _ = make_client()

    def boom() -> None:
        raise RuntimeError("the secret detail: postgres://user:pw@host")

    client.app.add_api_route("/boom", boom, methods=["GET"])  # type: ignore[attr-defined]
    quiet = TestClient(client.app, raise_server_exceptions=False, headers={"x-request-id": TEST_REQUEST_ID})
    response = quiet.get("/boom")
    error = assert_error_shape(response, "500")
    assert response.status_code == 500 and error["code"] == "internal_error" and "secret" not in response.text and "postgres" not in response.text


def test_an_unknown_path_and_a_wrong_method_use_the_shape() -> None:
    client, _ = make_client()
    missing = client.get("/v1/nothing-here")
    assert missing.status_code == 404 and assert_error_shape(missing, "404")["code"] == "not_found"
    wrong = client.delete("/health")
    assert wrong.status_code == 405 and assert_error_shape(wrong, "405")["code"] == "method_not_allowed"


def test_a_request_without_an_id_gets_one_and_it_is_the_same_in_the_header_and_the_body() -> None:
    client, _ = make_client()
    response = TestClient(client.app).get("/v1/me")  # no x-request-id sent
    error = assert_error_shape(response, "no id sent")
    assert error["request_id"] and error["request_id"] != TEST_REQUEST_ID


def test_extras_cannot_overwrite_the_fixed_keys() -> None:
    body = error_body("a_code", "A sentence.", retry_after=3, request_id="r1", extra={"code": "evil", "retry_after": 99, "reason": "why"})
    assert body == {"error": {"reason": "why", "code": "a_code", "message": "A sentence.", "retry_after": 3, "request_id": "r1"}}


# ------------------------------------------------------------------------------------------------------------------------ the document and the source
def test_the_openapi_document_names_the_error_body_on_every_operation() -> None:
    client, _ = make_client()
    doc = client.app.openapi()  # type: ignore[attr-defined]
    assert ERROR_SCHEMA in doc["components"]["schemas"] and "HTTPValidationError" not in doc["components"]["schemas"]
    ref = f"#/components/schemas/{ERROR_SCHEMA}"
    for method, path, op in operations(client):
        for status in ("429", "500"):
            assert op["responses"][status]["content"]["application/json"]["schema"]["$ref"] == ref, f"{method} {path}"
        if path.startswith("/v1/tenants"):
            assert {"401", "403", "404"} <= set(op["responses"]), f"{method} {path}"
        if "422" in op["responses"]:
            assert op["responses"]["422"]["content"]["application/json"]["schema"]["$ref"] == ref, f"{method} {path}"


def test_only_the_errors_module_builds_an_error_body() -> None:
    """A new `{"error": {...}}` anywhere else would be a second shape. (The two WhatsApp files READ or imitate Meta's own error object.)"""
    root = Path(__file__).resolve().parents[1] / "app"
    allowed = {"errors.py", "whatsapp/graph.py", "whatsapp/fake_graph.py"}
    pattern = re.compile(r"""["']error["']\s*:\s*\{""")
    offenders = [str(p.relative_to(root)) for p in root.rglob("*.py") if str(p.relative_to(root)) not in allowed and pattern.search(p.read_text(encoding="utf-8"))]
    assert offenders == []
    leftovers = [str(p.relative_to(root)) for p in root.rglob("*.py") if str(p.relative_to(root)) != "errors.py" and re.search(r"\bJSONResponse\(\s*\{\s*[\"']error", p.read_text(encoding="utf-8"))]
    assert leftovers == []


@pytest.mark.parametrize("name", ["tenancy.schema.json"])
def test_the_contract_schema_describes_the_new_fields(name: str) -> None:
    text = (Path(__file__).resolve().parents[3] / "packages" / "contracts" / name).read_text(encoding="utf-8")
    assert '"retry_after"' in text and '"request_id"' in text and '"fields"' in text
