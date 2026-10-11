"""Unit tests must not depend on the caller's local-stack choice. CI exports SME_STACK=owner and OWNER_OK=1 (its one stack is the repository's own, docs/runbooks/two-local-stacks.md), a person's shell may
export STACK or SME_DB_CONTAINER, and the default everywhere else is the AGENT stack. So every test starts with these variables absent; a test that cares sets exactly what it needs (and the stack tests pass
an explicit environment to the code under test)."""

from __future__ import annotations

import pytest

STACK_VARIABLES = ("SME_STACK", "OWNER_OK", "STACK", "SME_DB_CONTAINER")


@pytest.fixture(autouse=True)
def _no_stack_choice_from_the_caller(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in STACK_VARIABLES:
        monkeypatch.delenv(name, raising=False)
