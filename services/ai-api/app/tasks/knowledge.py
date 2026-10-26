"""The approved facts the assistant may state (job DR B1). The knowledge base is built in part A1 (the owner approves each fact; prices only if approved). B1 reads it through this interface so the tasks engine does not depend on how it is stored: `NoKnowledge` (nothing approved: the assistant states no price, no promise, nothing but the owner's own instruction) is the default; the wiring swaps in the real table when it exists."""

from __future__ import annotations

import uuid
from typing import Protocol


class KnowledgeBase(Protocol):
    def approved_facts(self, token: str, tenant_id: uuid.UUID) -> list[str]: ...


class NoKnowledge:
    def approved_facts(self, token: str, tenant_id: uuid.UUID) -> list[str]:
        return []


class FixedKnowledge:
    """For tests and the demo: a fixed list."""

    def __init__(self, facts: list[str]) -> None:
        self._facts = list(facts)

    def approved_facts(self, token: str, tenant_id: uuid.UUID) -> list[str]:
        return list(self._facts)
