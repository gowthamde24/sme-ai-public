# ruff: noqa: E501
"""A short label typed by a person (the business's own type, 26 Nov 2026) as plain text: tags and angle brackets removed, spaces collapsed. Applied BEFORE the length rule, so `<b>Tailor</b>` is stored as `Tailor` and `<>` alone is too short."""

from __future__ import annotations

import re
from typing import Annotated, Any

from pydantic import BeforeValidator, StringConstraints

_TAG = re.compile(r"<[^<>]*>")


def plain(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    text = _TAG.sub("", value).replace("<", " ").replace(">", " ")
    return " ".join(text.split())


PlainLabel = Annotated[str, BeforeValidator(plain), StringConstraints(strip_whitespace=True, min_length=2, max_length=60)]
