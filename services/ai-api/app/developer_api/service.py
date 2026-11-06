"""What the routes need: the repository, the worker account's sign-in (the program's requests run as it) and the caller's address (for a key's IP allow-list)."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Any

from starlette.requests import Request

from app.developer_api.repository import DeveloperRepository
from app.hardening.clientip import client_ip


class DeveloperApi:
    def __init__(self, repo: DeveloperRepository, receiver: Any, *, trusted_hops: int = 0) -> None:
        self.repo, self._receiver, self._hops = repo, receiver, trusted_hops

    def worker(self) -> str:
        if self._receiver is None:
            raise RuntimeError("no worker account")
        return str(self._receiver.token())

    def client_ip(self, request: Request) -> str:
        return client_ip(request.scope, self._hops)
