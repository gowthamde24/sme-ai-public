"""Keep personal data out of log lines.

Request URLs can carry personal data in their query string (e.g. ?q=<a person's name>), and the HTTP
client logs full URLs at INFO. Two measures:
  * the uvicorn access log keeps the method, path and status but drops the query string;
  * httpx / httpcore are held at WARNING (their INFO line prints the whole request URL).
Application code additionally never logs request bodies, data-layer messages, details or hints.
"""

from __future__ import annotations

import logging
from typing import Any


class RedactQueryFilter(logging.Filter):
    """uvicorn.access args are (client_addr, method, full_path, http_version, status_code)."""

    def filter(self, record: logging.LogRecord) -> bool:
        args: Any = record.args
        if (
            isinstance(args, tuple)
            and len(args) >= 3
            and isinstance(args[2], str)
            and "?" in args[2]
        ):
            record.args = (*args[:2], args[2].split("?", 1)[0] + "?<redacted>", *args[3:])
        return True


_installed = False


def install_log_redaction() -> None:
    global _installed
    for name in ("httpx", "httpcore"):
        logging.getLogger(name).setLevel(logging.WARNING)
    if not _installed:
        logging.getLogger("uvicorn.access").addFilter(RedactQueryFilter())
        _installed = True
