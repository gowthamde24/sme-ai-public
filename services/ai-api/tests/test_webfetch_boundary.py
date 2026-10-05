"""Where the network code lives: one module opens sockets; nothing else in the web package can."""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1] / "app" / "webfetch"
FILES = sorted(ROOT.glob("*.py"))
NETWORK = {"socket", "ssl", "http.client", "http.cookiejar", "httpx", "urllib.request", "requests"}
NEVER = {
    "os", "subprocess", "pickle", "shelve", "ctypes", "importlib", "http.cookiejar", "requests",
    "urllib.request", "sqlite3", "psycopg", "psycopg2",
}  # fmt: skip


def imports(path: Path) -> set[str]:
    found: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            found |= {alias.name for alias in node.names}
        elif isinstance(node, ast.ImportFrom):
            found.add(node.module or "")
            found |= {f"{node.module}.{alias.name}" for alias in node.names}
    return found


def test_the_package_is_found() -> None:
    assert {p.name for p in FILES} >= {
        "fetcher.py",
        "fakes.py",
        "netguard.py",
        "urls.py",
        "sanitize.py",
    }


@pytest.mark.parametrize("path", FILES, ids=lambda p: p.name)
def test_only_the_fetcher_touches_the_network(path: Path) -> None:
    used = imports(path) & NETWORK
    assert used == set() or path.name == "fetcher.py", f"{path.name} imports {sorted(used)}"


@pytest.mark.parametrize("path", FILES, ids=lambda p: p.name)
def test_no_process_environment_cookie_jar_or_second_http_client(path: Path) -> None:
    used = {m for m in imports(path) if any(m == n or m.startswith(n + ".") for n in NEVER)}
    assert used == set(), f"{path.name} imports {sorted(used)}"


def test_the_fetcher_uses_the_standard_library_client_and_never_opens_a_connection_by_name() -> (
    None
):
    source = (ROOT / "fetcher.py").read_text()
    assert "create_connection((ip, port)" in source  # a pinned address, never a host name
    assert "HTTPSConnection" not in source and "urlopen" not in source and "cookiejar" not in source
    assert "follow_redirects" not in source  # redirects are followed by hand, hop by hop


def test_the_agent_sandbox_does_not_import_the_fetcher() -> None:
    for path in sorted((ROOT.parent / "agents").rglob("*.py")):
        assert not any(m.startswith("app.webfetch") for m in imports(path)), path.name
