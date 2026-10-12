"""Request bodies of the workspace routes (job BY). Strict; every field optional (what is left out is kept); at least one is required."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, StringConstraints, model_validator

from app.crm.models import _Strict

Language = Literal["en", "te", "hi", "kn", "ta"]


class ProfileIn(_Strict):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)] | None = None
    town: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80)] | None = None
    languages: Annotated[list[Language], Field(min_length=1, max_length=5)] | None = None

    @model_validator(mode="after")
    def _something(self) -> ProfileIn:
        if self.name is None and self.town is None and self.languages is None:
            raise ValueError("give at least one of name, town, languages")
        return self
