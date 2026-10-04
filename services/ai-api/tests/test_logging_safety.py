import logging
import uuid

from app.logging_safety import ROUTE_WORDS, RedactQueryFilter, install_log_redaction, redact_path
from tests.fakes import make_client

TENANT = uuid.UUID(int=0xA)


def record(args: tuple[object, ...]) -> logging.LogRecord:
    return logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d', args, None
    )


def test_access_log_drops_the_query_string() -> None:
    path = f"/v1/tenants/{TENANT}/companies?q=Jane+Doe&limit=5"
    rec = record(("127.0.0.1:1", "GET", path, "1.1", 200))
    assert RedactQueryFilter().filter(rec)
    assert "Jane" not in rec.getMessage() and "limit" not in rec.getMessage()
    assert f"/v1/tenants/{TENANT}/companies?<redacted>" in rec.getMessage()


def test_access_log_without_a_query_is_untouched() -> None:
    rec = record(("127.0.0.1:1", "GET", "/health", "1.1", 200))
    RedactQueryFilter().filter(rec)
    assert "/health" in rec.getMessage() and "redacted" not in rec.getMessage()


def test_http_client_loggers_are_held_at_warning() -> None:
    logging.getLogger("httpx").setLevel(logging.DEBUG)
    install_log_redaction()
    assert logging.getLogger("httpx").level == logging.WARNING
    assert logging.getLogger("httpcore").level == logging.WARNING


def test_the_filter_is_installed_on_the_uvicorn_access_logger() -> None:
    install_log_redaction()
    assert any(
        isinstance(f, RedactQueryFilter) for f in logging.getLogger("uvicorn.access").filters
    )


def test_a_pasted_value_in_an_id_position_is_not_logged() -> None:
    for pasted in [
        "https%3A//canary-host.example/in/jane-canary",
        "jane.canary@example.test",
        "Jane%20Canary",
        "not-a-uuid",
        "0" * 32,
    ]:
        rec = record(
            (
                "127.0.0.1:1",
                "POST",
                f"/v1/tenants/{TENANT}/evidence-links/{pasted}/archive",
                "1.1",
                404,
            )
        )
        RedactQueryFilter().filter(rec)
        message = rec.getMessage()
        assert (
            "canary" not in message.lower()
            and "jane" not in message.lower()
            and "0" * 32 not in message
        )
        assert (
            f"/v1/tenants/{TENANT}/evidence-links/<redacted>" in message or "<redacted>" in message
        )
    assert "/evidence-links/<redacted>/archive" in redact_path(
        "/v1/tenants/" + str(TENANT) + "/evidence-links/jane.canary@example.test/archive"
    )


def test_route_words_and_uuids_survive() -> None:
    path = f"/v1/tenants/{TENANT}/companies/{uuid.uuid4()}/evidence"
    assert redact_path(path) == path
    assert redact_path("/health") == "/health" and redact_path("/") == "/"
    assert redact_path("/v1/me") == "/v1/me"


def registered_paths() -> list[str]:
    """Every path the application serves. From the OpenAPI schema, NOT `app.routes`: routers are
    mounted as `_IncludedRouter` objects, which expose no `.path`, so walking `app.routes` silently
    sees only the handful of top-level routes (this test once passed while checking five words)."""
    client, _ = make_client()
    return sorted(client.app.openapi()["paths"])  # type: ignore[attr-defined]


def test_the_guard_sees_the_routers_of_every_module() -> None:
    paths = registered_paths()
    assert len(paths) >= 40, f"only {len(paths)} paths: the guard has gone blind again"
    for needle in (
        "/v1/me",
        "/v1/tenants/{tenant_id}/companies",
        "/v1/tenants/{tenant_id}/companies/{target_id}/evidence",
        "/v1/tenants/{tenant_id}/leads/review-queue",
        "/v1/tenants/{tenant_id}/leads/import",
        "/v1/tenants/{tenant_id}/icp-configs/active",
        "/v1/tenants/{tenant_id}/exports",
    ):
        assert needle in paths, needle


def test_every_literal_route_segment_is_on_the_allow_list() -> None:
    """A new route word that is missing here would be logged as <redacted>: safe, but unhelpful.
    This test makes the omission loud."""
    words: set[str] = set()
    for path in registered_paths():
        for segment in path.split("/"):
            if segment and not segment.startswith("{"):
                words.add(segment)
    assert words - ROUTE_WORDS == set(), f"add to ROUTE_WORDS: {sorted(words - ROUTE_WORDS)}"


def test_the_t005_routes_are_logged_with_their_words_and_never_their_ids_or_terms() -> None:
    tenant = uuid.uuid4()
    lead = uuid.uuid4()
    for path in (
        f"/v1/tenants/{tenant}/leads/review-queue",
        f"/v1/tenants/{tenant}/leads/import",
        f"/v1/tenants/{tenant}/leads/import/preview",
        f"/v1/tenants/{tenant}/leads/{lead}/labels",
        f"/v1/tenants/{tenant}/icp-configs",
        f"/v1/tenants/{tenant}/icp-configs/active",
        f"/v1/tenants/{tenant}/exports",
    ):
        assert redact_path(path) == path, path
    # an unknown word in the same position (a search term, a name) is still redacted
    assert redact_path(f"/v1/tenants/{tenant}/leads/jane.canary@example.test/labels").endswith(
        "/leads/<redacted>/labels"
    )
