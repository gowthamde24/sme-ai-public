"""The rehearsal tools (tests/rehearsal/harness.py): ids, the network guard, TOTP."""

from __future__ import annotations

import importlib
import socket
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "tests" / "rehearsal"))
harness = importlib.import_module("harness")


def test_ids_are_deterministic_and_distinct() -> None:
    assert harness.rid("order", "A") == harness.rid("order", "A")
    assert harness.rid("order", "A") != harness.rid("order", "B")
    assert harness.rid("event", "A", 1) != harness.rid("event", "A", 1, "refused")


def test_the_guard_refuses_anything_but_this_machine_and_counts_the_rest() -> None:
    with harness.NetworkGuard() as guard:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            with pytest.raises(OSError, match="only the local stack"):
                s.connect(("93.184.216.34", 443))
            with pytest.raises(OSError, match="only the local stack"):
                socket.getaddrinfo("example.com", 443)
        finally:
            s.close()
        closed = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            closed.settimeout(0.2)
            closed.connect_ex(
                ("127.0.0.1", 9)
            )  # discard port: refused or filtered, but it is this machine
        finally:
            closed.close()
    assert guard.refused == ["93.184.216.34:443", "dns:example.com"]
    assert guard.local == {"127.0.0.1:9": 1}
    # and the guard is lifted afterwards
    assert socket.getaddrinfo("localhost", 80)  # the guard is lifted: a lookup works again


def test_totp_matches_the_rfc_6238_vector(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(harness.time, "time", lambda: 59.0)
    assert harness.totp_code("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ") == "287082"
