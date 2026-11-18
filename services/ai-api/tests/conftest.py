# ruff: noqa: E501
"""Unit tests must not depend on the caller's local-stack choice.

CI exports SME_STACK=owner and OWNER_OK=1 (its one stack is the repository's own,
docs/runbooks/two-local-stacks.md), a person's shell may export STACK or SME_DB_CONTAINER, and the
default everywhere else is the AGENT stack. So every test starts with these variables absent; a
test that cares sets exactly what it needs (and the stack tests pass an explicit environment to
the code under test)."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

STACK_VARIABLES = ("SME_STACK", "OWNER_OK", "STACK", "SME_DB_CONTAINER")


@pytest.fixture(autouse=True)
def _no_stack_choice_from_the_caller(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in STACK_VARIABLES:
        monkeypatch.delenv(name, raising=False)


_READS_DOCS = re.compile(r"""docs/|["']docs["']""")


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    """Mark every test of a file that reads docs/ with `docs` (CI, 18 Nov 2026): a change to documents only runs just these, not the whole API suite (scripts/ci/lanes.sh, `docs`).
    Decided from the file's own text, so a new test that reads a document is in the lane without anyone listing it."""
    seen: dict[str, bool] = {}
    for item in items:
        path = str(item.fspath)
        if path not in seen:
            try:
                seen[path] = bool(_READS_DOCS.search(Path(path).read_text(encoding="utf-8")))
            except OSError:
                seen[path] = True   # unreadable: fail closed, it counts as reading docs
        if seen[path]:
            item.add_marker(pytest.mark.docs)
