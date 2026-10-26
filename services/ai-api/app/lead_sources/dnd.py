"""The Do-Not-Disturb register behind an interface (job DR / A2). A number on it is imported, but only WhatsApp is used for it and no promotional call is made. No real provider is chosen
yet (the national register has a paid lookup); the fake is for development and tests. With none configured the preview says `dnd_lookup: not_configured` and nobody is marked."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Protocol


class DndLookup(Protocol):
    def registered(self, numbers: Iterable[str]) -> set[str]:
        """The numbers (stored form, +91...) that are on the register."""
        ...


class FakeDnd:
    """Development and tests: the numbers it was given, plus any number whose last four digits are 0000."""

    def __init__(self, numbers: Iterable[str] = ()) -> None:
        self._numbers = set(numbers)
        self.asked: list[list[str]] = []

    def registered(self, numbers: Iterable[str]) -> set[str]:
        asked = list(numbers)
        self.asked.append(asked)
        return {n for n in asked if n in self._numbers or n.endswith("0000")}
