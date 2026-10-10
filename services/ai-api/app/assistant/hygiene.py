"""The owner is not a programmer: an answer must not name a tool, a function or an internal field ("the find_price tool", "the refused_call function").

The system prompt forbids it; this is the check that holds WHATEVER the model does. The closed set of internal names is built from the tool list itself (every tool's name
and every argument name that is written with an underscore), plus the names of the steps the runner records. An answer that contains one of them as a whole identifier is
not shown: the runner replaces it with a fixed sentence in the owner's language (`language.PLAIN_WORDS`) and logs THAT it happened, never the answer's text."""

from __future__ import annotations

import re

from app.assistant.tools import TOOLS

# the steps the runner records for a call it refused or that failed (runner.REFUSED_TOOL, runner.FAILED_TOOL; a test keeps the two lists equal)
STEP_NAMES: tuple[str, ...] = ("refused_call", "tool_error")


def internal_names() -> frozenset[str]:
    names = {t.name for t in TOOLS} | set(STEP_NAMES)
    for tool in TOOLS:
        names.update(field for field in tool.args.model_fields if "_" in field)
    return frozenset(n for n in names if "_" in n)


_NAMES = internal_names()
# a whole identifier: not the middle of a longer word or identifier (customer_kind_x is a different word; "my_find_price" is not find_price)
_IDENTIFIER = re.compile(
    r"(?<![A-Za-z0-9_])("
    + "|".join(sorted(map(re.escape, _NAMES), key=len, reverse=True))
    + r")(?![A-Za-z0-9_])",
    re.IGNORECASE,
)


def leaked_names(text: str) -> int:
    """How many times a text names an internal tool, function or field."""
    return len(_IDENTIFIER.findall(text))
