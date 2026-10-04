"""A real uvicorn process (root logger at DEBUG) receives requests carrying a PII canary
(a malformed e-mail, an unknown field, a search term, bad JSON, a duplicate that makes Postgres
print the address). Everything the process writes (application, uvicorn access, httpx / httpcore)
must be free of the canary; this is the only test that sees the real access log."""

from __future__ import annotations

import os
import socket
import subprocess
import sys
import time
from collections.abc import Iterator
from pathlib import Path

import httpx
import pytest
from conftest import bearer
from crm_support import World, uid

API_DIR = Path(__file__).resolve().parents[2] / "services" / "ai-api"
CANARY_EMAIL = f"livecanary.qq77.{uid()[:8]}@it.example.test"
CANARY_NAME = "Livecanary Qq77"
LAUNCH = (
    "import logging, sys, uvicorn;"
    "logging.basicConfig(level=logging.DEBUG, stream=sys.stdout);"
    "uvicorn.run('app.main:app', port=int(sys.argv[1]), log_level='debug')"
)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@pytest.fixture
def server(tmp_path: Path) -> Iterator[tuple[str, Path]]:
    port = free_port()
    log = tmp_path / "server.log"
    env = {**os.environ, "API_ENV": "development"}
    with log.open("w") as sink:
        proc = subprocess.Popen(  # noqa: S603 - our own interpreter and a fixed script
            [sys.executable, "-c", LAUNCH, str(port)],
            cwd=API_DIR,
            env=env,
            stdout=sink,
            stderr=subprocess.STDOUT,
        )
        try:
            base = f"http://127.0.0.1:{port}"
            for _ in range(60):
                try:
                    if httpx.get(f"{base}/health", timeout=1).status_code == 200:
                        break
                except httpx.HTTPError:
                    time.sleep(0.25)
            else:
                pytest.fail("test server did not start")
            yield base, log
        finally:
            proc.terminate()  # our own child, by handle
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()


def test_no_log_line_of_a_real_server_contains_the_canary(
    crm_world: World, server: tuple[str, Path]
) -> None:
    base, log = server
    w = crm_world
    sales = w.a.users["sales"]
    h = bearer(sales)
    tenant = f"{base}/v1/tenants/{w.a.id}"
    company = w.a.rows["companies"]["id"]

    seeded = httpx.post(
        f"{tenant}/contacts",
        headers=h,
        timeout=15,
        json={"id": uid(), "full_name": CANARY_NAME, "email": CANARY_EMAIL, "company_id": company},
    )
    assert seeded.status_code == 201
    responses = [
        # validation failures
        httpx.post(
            f"{tenant}/contacts",
            headers=h,
            timeout=15,
            json={"id": uid(), "full_name": CANARY_NAME, "email": f"{CANARY_EMAIL} nope"},
        ),
        httpx.post(
            f"{tenant}/contacts",
            headers=h,
            timeout=15,
            json={"id": uid(), "full_name": CANARY_NAME, "bogus": CANARY_EMAIL},
        ),
        httpx.post(
            f"{tenant}/contacts",
            headers={**h, "Content-Type": "application/json"},
            timeout=15,
            content=f'{{"full_name": "{CANARY_NAME}", '.encode(),
        ),
        httpx.get(f"{tenant}/companies", headers=h, timeout=15, params={"q": CANARY_NAME}),
        httpx.get(f"{tenant}/companies", headers=h, timeout=15, params={"cursor": CANARY_EMAIL}),
        httpx.get(f"{tenant}/contacts", headers=h, timeout=15, params={"limit": CANARY_NAME}),
        # a database-level failure: Postgres prints the address in the unique-violation detail
        httpx.post(
            f"{tenant}/contacts",
            headers=h,
            timeout=15,
            json={"id": uid(), "full_name": "Other", "email": CANARY_EMAIL},
        ),
        # an unauthorised caller and a foreign tenant
        httpx.get(f"{tenant}/contacts?q={CANARY_NAME}", timeout=15),
        httpx.get(f"{base}/v1/tenants/{w.b.id}/contacts?q={CANARY_NAME}", headers=h, timeout=15),
    ]
    assert [r.status_code for r in responses] == [422, 422, 422, 200, 422, 422, 409, 401, 404]
    for r in responses:
        assert "canary" not in r.text.lower() and "qq77" not in r.text.lower()

    time.sleep(0.5)  # let the server flush
    text = log.read_text()
    assert "POST /v1/tenants" in text, "access logging was active"
    assert "<redacted>" in text, "query strings are redacted in the access log"
    assert "HTTP/1.1" in text
    lowered = text.lower()
    assert "canary" not in lowered and "qq77" not in lowered, (
        "PII canary found in the server's logs"
    )
    assert "nope" not in lowered, "a rejected value was logged"
