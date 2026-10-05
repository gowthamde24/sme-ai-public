"""The agent runtime is a sandbox (ADR 0013): the source of app/agents is read, not run.

* it may import nothing from the application except itself and `app.requirements` (T008: pure
  deterministic services, no I/O, no model, no database; scanned below by the SAME rules, and it may
  import nothing from the application but itself): no auth, tenancy, repository, review or
  configuration module;
* the HTTP client (httpx) exists only in the two modules that talk to the outside: db.py
  (the database) and
  llm/anthropic.py (the one real model adapter);
* the user's token is a word only db.py may use; no module reads the environment, spawns a
  process or opens a socket;
* no dynamic code (eval, exec, compile, __import__);
* a tool's handler takes exactly (context, arguments): nothing else can be smuggled in.
"""

from __future__ import annotations

import ast
import inspect
import re
from pathlib import Path

import pytest

from app.agents import selftest

ROOT = Path(__file__).resolve().parents[1] / "app" / "agents"
PURE_ROOT = Path(__file__).resolve().parents[1] / "app" / "requirements"
FILES = sorted(ROOT.rglob("*.py")) + sorted(PURE_ROOT.rglob("*.py"))
HTTP_ALLOWED = {"db.py", "anthropic.py"}
FORBIDDEN_MODULES = {
    "os",
    "subprocess",
    "socket",
    "sqlite3",
    "psycopg",
    "psycopg2",
    "asyncpg",
    "requests",
    "urllib.request",
    "ctypes",
    "importlib",
    "pickle",
    "shelve",
}
FORBIDDEN_CALLS = {"eval", "exec", "compile", "__import__", "open"}


def imports(path: Path) -> list[str]:
    found: list[str] = []
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Import):
            found += [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            found.append(node.module or "")
            found += [f"{node.module}.{alias.name}" for alias in node.names]
    return found


def test_the_package_is_found() -> None:
    assert len(FILES) >= 12, "the scan must actually see the runtime"


def rel(path: Path) -> str:
    base = PURE_ROOT.parent if PURE_ROOT in path.parents else ROOT
    return str(path.relative_to(base))


@pytest.mark.parametrize("path", FILES, ids=rel)
def test_nothing_is_imported_from_the_application_except_the_runtime_itself(path: Path) -> None:
    allowed = (
        ("app.requirements",) if PURE_ROOT in path.parents else ("app.agents", "app.requirements")
    )
    for module in imports(path):
        if module == "app" or module.startswith("app."):
            assert any(module == a or module.startswith(a + ".") for a in allowed), (
                f"{path.name} imports {module}: the sandbox may not reach the auth, tenancy, "
                "repository, review or configuration code"
            )


@pytest.mark.parametrize("path", FILES, ids=rel)
def test_no_process_environment_socket_or_dynamic_code(path: Path) -> None:
    for module in imports(path):
        assert not any(module == m or module.startswith(m + ".") for m in FORBIDDEN_MODULES), (
            f"{path.name} imports {module}"
        )
    for node in ast.walk(ast.parse(path.read_text())):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            assert node.func.id not in FORBIDDEN_CALLS, f"{path.name} calls {node.func.id}()"


@pytest.mark.parametrize("path", FILES, ids=rel)
def test_httpx_exists_only_in_the_two_modules_that_talk_to_the_outside(path: Path) -> None:
    uses_httpx = any(m.split(".")[0] == "httpx" for m in imports(path))
    assert not uses_httpx or path.name in HTTP_ALLOWED, f"{path.name} imports httpx"


@pytest.mark.parametrize("path", FILES, ids=rel)
def test_the_users_token_is_mentioned_only_by_the_database_module(path: Path) -> None:
    if path.name == "db.py":
        return
    tree = ast.parse(path.read_text())
    names = {n.id for n in ast.walk(tree) if isinstance(n, ast.Name)}
    names |= {n.attr for n in ast.walk(tree) if isinstance(n, ast.Attribute)}
    names |= {a.arg for n in ast.walk(tree) if isinstance(n, ast.arguments) for a in n.args}
    assert not {i for i in names if re.fullmatch(r"(user_)?token|jwt|authorization", i)}, (
        f"{path.name} handles a token"
    )


def test_a_tool_handler_takes_exactly_a_context_and_its_arguments() -> None:
    for tool in selftest.SELFTEST.tools:
        params = list(inspect.signature(tool.handler).parameters)
        assert params == ["ctx", "args"], (tool.name, params)


def test_the_tool_context_holds_no_token_tenant_or_table() -> None:
    from app.agents.tools import ToolContext

    # the run's database module, the run's own state and step key; and, for an agent that reads the
    # web, a PageFetcher plus the host scope the RUNTIME decided. No token, no tenant, no table.
    assert set(inspect.signature(ToolContext).parameters) == {
        "db",
        "state",
        "step_key",
        "fetcher",
        "host",
        "allowed_hosts",
    }
