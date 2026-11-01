"""What an operator can see without seeing a customer (job CB, ADR 0082): a request id on every response, one structured access line per request, and a few counters (the /metrics page).

NO PERSONAL DATA: the access line holds the request id, the method, the ROUTE (the pattern, e.g. /v1/tenants/{tenant_id}/orders, never the raw path with its ids), the status, the milliseconds, and a short hash
of the caller's address (to tell one noisy caller from another; the address cannot be recovered from it). No user id, no tenant id, no query string, no header, no body. The log formatter (JSON when LOG_FORMAT=json)
also masks anything in any log message that looks like an e-mail address or a long number, as a last line of defence for a message somebody wrote carelessly."""

from __future__ import annotations

import json
import logging
import re
import threading
import time
import uuid
from collections import defaultdict
from collections.abc import Awaitable, Callable, MutableMapping
from datetime import UTC, datetime
from typing import Any

from app.hardening.clientip import client_ip, short_hash

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]

_REQUEST_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")
BUCKETS = (0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0)
access_logger = logging.getLogger("app.access")


class Metrics:
    """Counters in this process's memory (like the limiters). Rendered in the Prometheus text format."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.started = time.time()
        self.requests: dict[tuple[str, str, str], int] = defaultdict(int)  # (method, route, status class)
        self.durations: dict[str, list[int]] = defaultdict(lambda: [0] * (len(BUCKETS) + 1))
        self.duration_sum: dict[str, float] = defaultdict(float)
        self.limited: dict[str, int] = defaultdict(int)

    def observe(self, method: str, route: str, status: int, seconds: float) -> None:
        with self._lock:
            self.requests[(method, route, f"{status // 100}xx")] += 1
            buckets = self.durations[route]
            for i, edge in enumerate(BUCKETS):
                if seconds <= edge:
                    buckets[i] += 1
            buckets[-1] += 1
            self.duration_sum[route] += seconds

    def limit_hit(self, rule: str) -> None:
        with self._lock:
            self.limited[rule] += 1

    def render(self) -> str:
        lines = [
            "# HELP app_uptime_seconds Seconds since this process started.",
            "# TYPE app_uptime_seconds gauge",
            f"app_uptime_seconds {time.time() - self.started:.0f}",
            "# HELP http_requests_total Requests by method, route pattern and status class.",
            "# TYPE http_requests_total counter",
        ]
        with self._lock:
            for (method, route, klass), n in sorted(self.requests.items()):
                lines.append(f'http_requests_total{{method="{method}",route="{route}",status="{klass}"}} {n}')
            lines += ["# HELP http_request_duration_seconds Request time by route pattern.", "# TYPE http_request_duration_seconds histogram"]
            for route, buckets in sorted(self.durations.items()):
                for edge, n in zip(BUCKETS, buckets, strict=False):
                    lines.append(f'http_request_duration_seconds_bucket{{route="{route}",le="{edge}"}} {n}')
                lines.append(f'http_request_duration_seconds_bucket{{route="{route}",le="+Inf"}} {buckets[-1]}')
                lines.append(f'http_request_duration_seconds_sum{{route="{route}"}} {self.duration_sum[route]:.4f}')
                lines.append(f'http_request_duration_seconds_count{{route="{route}"}} {buckets[-1]}')
            lines += ["# HELP rate_limited_total Requests refused by a rate limit, by rule.", "# TYPE rate_limited_total counter"]
            for rule, n in sorted(self.limited.items()):
                lines.append(f'rate_limited_total{{rule="{rule}"}} {n}')
        return "\n".join(lines) + "\n"


class ObserveMiddleware:
    def __init__(self, app: Any, *, metrics: Metrics, trusted_hops: int = 0) -> None:
        self.app = app
        self.metrics = metrics
        self.hops = trusted_hops

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        supplied = next((v.decode("latin-1") for k, v in scope["headers"] if k == b"x-request-id"), "")
        request_id = supplied if _REQUEST_ID.fullmatch(supplied) else uuid.uuid4().hex
        scope.setdefault("state", {})["request_id"] = request_id  # app/errors.py puts it in every error body
        started = time.perf_counter()
        status = 500

        async def respond(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = int(message["status"])
                message = dict(message)
                message["headers"] = [*message.get("headers", []), (b"x-request-id", request_id.encode())]
            await send(message)

        try:
            await self.app(scope, receive, respond)
        finally:
            seconds = time.perf_counter() - started
            route = getattr(scope.get("route"), "path", None) or "unmatched"
            self.metrics.observe(scope["method"], route, status, seconds)
            access_logger.info(
                "request",
                extra={"fields": {"request_id": request_id, "method": scope["method"], "route": route, "status": status, "ms": round(seconds * 1000, 1), "caller": short_hash(client_ip(scope, self.hops))}},
            )


# ---------------------------------------------------------------------------------------------------------------- the log format
_EMAIL = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
_LONG_NUMBER = re.compile(r"(?<![A-Za-z0-9])\+?\d[\d\s().-]{7,}\d(?![A-Za-z0-9])")


def _mask_number(match: re.Match[str]) -> str:
    digits = sum(ch.isdigit() for ch in match.group(0))
    return "[number]" if 9 <= digits <= 15 else match.group(0)  # a phone number has 9 to 15 digits; a long run of digits and dashes is an id


def scrub(text: str) -> str:
    """Mask anything in a log message that looks like an e-mail address or a phone-sized number."""
    return _LONG_NUMBER.sub(_mask_number, _EMAIL.sub("[email]", text))


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        doc: dict[str, Any] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname.lower(),
            "logger": record.name,
            "msg": scrub(record.getMessage()),
        }
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict):
            doc.update(fields)
        if record.exc_info and record.exc_info[0] is not None:
            doc["exc"] = record.exc_info[0].__name__  # the class only: a traceback can carry data
        return json.dumps(doc, ensure_ascii=False, separators=(",", ":"))


class ScrubFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str) and not record.args:
            record.msg = scrub(record.msg)
        elif record.args:
            record.msg = scrub(record.getMessage())
            record.args = ()
        return True


def install_logging(log_format: str) -> None:
    """LOG_FORMAT=json: every handler of the root logger writes the JSON line above; any format: messages are scrubbed. Idempotent."""
    root = logging.getLogger()
    if not root.handlers:
        root.addHandler(logging.StreamHandler())
    for handler in root.handlers:
        if not any(isinstance(f, ScrubFilter) for f in handler.filters):
            handler.addFilter(ScrubFilter())
        if log_format == "json":
            handler.setFormatter(JsonFormatter())
    access_logger.setLevel(logging.INFO)
    # the browser voice's own numbers lines (the per-session cost line and the speaker-check scores): numbers and ids, no words; the rest of the application stays at warnings
    logging.getLogger("app.browser_voice").setLevel(logging.INFO)
