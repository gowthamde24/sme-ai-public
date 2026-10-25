"""Error reporting to Sentry, off unless SENTRY_DSN is set (job DP part 6).

WHAT LEAVES THE SERVER when it is on: the exception's CLASS NAME and its stack frames (module, function, line: no source lines, no local variables), the release, the environment and a request id. NOTHING else:
no exception message (it may hold a name, a number or a sentence a person said), no request URL, query, header, cookie or body, no user, no IP address, no breadcrumbs, no tags a request could set, no log lines.
The scrubbing runs in `before_send` on every event and is tested with a capturing transport; an event that cannot be scrubbed is dropped, not sent as it is.

OFF: with no DSN `init_sentry` returns False and does not even import the SDK."""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger("app.observability")

_FRAME_KEYS = ("module", "function", "lineno", "in_app")


def _frames(frames: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    if isinstance(frames, list):
        for frame in frames:
            if isinstance(frame, dict):
                out.append({k: frame[k] for k in _FRAME_KEYS if k in frame})
    return out


def scrub_event(event: dict[str, Any], hint: dict[str, Any] | None = None) -> dict[str, Any] | None:
    """The event reduced to what may leave. Returns None (drop it) for anything not understood."""
    try:
        exceptions = []
        for value in ((event.get("exception") or {}).get("values") or []):
            exceptions.append({"type": str(value.get("type") or "Exception")[:100], "module": str(value.get("module") or "")[:100], "stacktrace": {"frames": _frames((value.get("stacktrace") or {}).get("frames"))}})
        if not exceptions:
            return None   # a log message or a transaction: not what this is for
        request_id = ((event.get("tags") or {}).get("request_id")) if isinstance(event.get("tags"), dict) else None
        clean: dict[str, Any] = {
            "event_id": event.get("event_id"),
            "timestamp": event.get("timestamp"),
            "platform": event.get("platform", "python"),
            "level": "error",
            "release": event.get("release"),
            "environment": event.get("environment"),
            "server_name": "api",
            "exception": {"values": exceptions},
        }
        if isinstance(request_id, str) and len(request_id) <= 64:
            clean["tags"] = {"request_id": request_id}
        return clean
    except Exception:  # noqa: BLE001 - never let reporting break, never send what we could not scrub
        return None


def init_sentry(dsn: str | None, *, environment: str, release: str, transport: Any = None) -> bool:
    """Start error reporting when there is a DSN. Safe to call twice. `transport` is for tests."""
    if not dsn:
        return False
    import sentry_sdk

    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=release,
        send_default_pii=False,
        max_request_body_size="never",
        include_local_variables=False,
        include_source_context=False,
        attach_stacktrace=False,
        send_client_reports=False,
        traces_sample_rate=0.0,
        profiles_sample_rate=0.0,
        max_breadcrumbs=0,
        default_integrations=False,
        auto_enabling_integrations=False,
        integrations=[],
        before_send=scrub_event,   # type: ignore[arg-type]
        before_breadcrumb=lambda crumb, hint: None,
        transport=transport,
    )
    logger.info("error reporting is on")   # no address in the log
    return True


def capture(exc: BaseException, request_id: str | None = None) -> None:
    """Report an unexpected exception (the handler for a 500). A no-op when reporting is off."""
    import sys

    if "sentry_sdk" not in sys.modules:
        return
    import sentry_sdk

    if not sentry_sdk.is_initialized():
        return
    with sentry_sdk.new_scope() as scope:
        if request_id:
            scope.set_tag("request_id", request_id[:64])
        sentry_sdk.capture_exception(exc)
