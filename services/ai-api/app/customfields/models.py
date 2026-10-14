"""Custom fields (job CK, ADR 0084 part 2): definitions per business and typed values on contacts and catalogue items. Mirrors packages/contracts/packs.schema.json.

Owner-added fields are always personal-data class `none`, kind text (100 characters at most), number, date, choice, multi choice or yes/no; a pack may add `personal` fields. A value is validated by the
database (SM711) and again here so a screen gets a field name, not a SQLSTATE. A model never reads these values."""

from __future__ import annotations

import re
import uuid
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

Entity = Literal["contact", "catalogue_item"]
FieldKind = Literal["text", "number", "date", "choice", "multi_choice", "yes_no"]
PiiClass = Literal["none", "personal"]
FieldSource = Literal["pack", "owner"]
FieldCode = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{1,39}$")]
ChoiceCode = Annotated[str, StringConstraints(pattern=r"^[a-z0-9][a-z0-9_]{0,39}$")]
_LANGS = ("en", "te", "hi", "kn")


class _Out(BaseModel):
    model_config = ConfigDict(extra="forbid")


class _In(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _label(v: dict[str, str]) -> dict[str, str]:
    if "en" not in v:
        raise ValueError("English is required")
    for lang, text in v.items():
        if lang not in _LANGS:
            raise ValueError("only en, te, hi and kn")
        if not 1 <= len(text.strip()) <= 80:
            raise ValueError("1 to 80 characters")
    return {k: t.strip() for k, t in v.items()}


class ChoiceIn(_In):
    code: ChoiceCode
    label: dict[str, str]

    _l = field_validator("label")(_label)


class ChoiceOut(_Out):
    code: str
    label: dict[str, str]


class CustomFieldDefOut(_Out):
    id: uuid.UUID
    entity: Entity
    code: str
    label: dict[str, str]
    kind: FieldKind
    choices: list[ChoiceOut] | None
    required: bool
    position: int
    pii_class: PiiClass
    mergeable: bool
    active: bool
    source: FieldSource


class CustomFieldListOut(_Out):
    fields: list[CustomFieldDefOut]


class CustomFieldCreateIn(_In):
    """POST /v1/tenants/{id}/custom-fields (Owner or Admin, second factor)."""

    entity: Entity
    code: FieldCode
    label: dict[str, str]
    kind: FieldKind
    choices: list[ChoiceIn] | None = None
    required: bool = False

    _l = field_validator("label")(_label)

    def model_post_init(self, _ctx: Any) -> None:
        wants = self.kind in ("choice", "multi_choice")
        if wants != (self.choices is not None):
            raise ValueError("choices are required for choice kinds and only for them")
        if self.choices is not None:
            codes = [c.code for c in self.choices]
            if not 1 <= len(codes) <= 30 or len(set(codes)) != len(codes):
                raise ValueError("1 to 30 choices with different codes")


class CustomFieldPatchIn(_In):
    """PATCH /v1/tenants/{id}/custom-fields/{field_id}: a field's label, required flag, order and active flag change; its choices only GROW; its code, kind and entity never change."""

    label: dict[str, str] | None = None
    required: bool | None = None
    active: bool | None = None
    position: Annotated[int, Field(ge=0, le=10000)] | None = None
    add_choices: list[ChoiceIn] | None = Field(default=None, min_length=1, max_length=30)

    @field_validator("label")
    @classmethod
    def _lab(cls, v: dict[str, str] | None) -> dict[str, str] | None:
        return None if v is None else _label(v)


# a value: text, number, yes/no, a date written YYYY-MM-DD, a choice code, a list of choice codes, or null to clear
FieldValue = str | int | float | bool | list[str] | None
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class CustomValuesIn(_In):
    """PUT .../contacts/{id}/custom and .../catalogue/{id}/custom: {code: value}. All or nothing."""

    values: dict[FieldCode, FieldValue] = Field(max_length=40)


class CustomValueOut(_Out):
    code: str
    kind: FieldKind
    active: bool
    value: FieldValue


class CustomValuesOut(_Out):
    entity: Entity
    entity_id: uuid.UUID
    values: list[CustomValueOut]
