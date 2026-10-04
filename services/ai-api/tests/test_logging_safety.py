import logging

from app.logging_safety import RedactQueryFilter, install_log_redaction


def record(args: tuple[object, ...]) -> logging.LogRecord:
    return logging.LogRecord(
        "uvicorn.access", logging.INFO, __file__, 1, '%s - "%s %s HTTP/%s" %d', args, None
    )


def test_access_log_drops_the_query_string() -> None:
    rec = record(("127.0.0.1:1", "GET", "/v1/tenants/x/companies?q=Jane+Doe&limit=5", "1.1", 200))
    assert RedactQueryFilter().filter(rec)
    assert "Jane" not in rec.getMessage() and "limit" not in rec.getMessage()
    assert "/v1/tenants/x/companies?<redacted>" in rec.getMessage()


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
