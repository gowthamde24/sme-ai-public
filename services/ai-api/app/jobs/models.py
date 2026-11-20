"""The answers of the Jobs routes (jobs contract 1.1 part 1). The template shape is the shape of packages/packs/<pack>/jobs.json, which the web already parses; what the API adds is `examples_real`, a real prospect's
`fit` and `why {code, params}`, and the ETag. Absent means absent: the routes dump with `exclude_unset`, so a field is sent only when the code set it (`sample_audio: null` is set on purpose)."""

# ruff: noqa: E501

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

Texts = dict[str, str]
# the closed reasons a real prospect fits (contract 1.1 answer 3); an unknown code reads as a generic line on the web
WhyCode = Literal["sells_what_you_buy_from", "near_you", "well_rated", "open_business", "category_match"]


class _Out(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Why(_Out):
    code: WhyCode
    params: dict[str, str | int] = {}


class ExampleOut(_Out):
    name: str
    area: str
    # invented example: a sentence per language; real prospect: a closed code
    why: Texts | Why | None = None
    # a real prospect's fit, 0 to 100; never sent for an invented example
    fit: int | None = None


class PreviewOut(_Out):
    whatsapp: Texts | None = None
    call: Texts | None = None
    # null until a voice sample exists (contract 1.1 T6)
    sample_audio: Texts | None = None


class TemplateOut(_Out):
    id: str
    kind: str
    goal: str
    popular: bool
    title: Texts
    benefit: Texts
    ask: Texts
    needs: list[str]
    finds_out: list[str]
    season: str
    preview: PreviewOut | None = None
    sample_item: Texts | None = None
    examples: list[ExampleOut] | None = None
    # researcher only: true = the workspace's own best prospects, false = invented examples (no fit)
    examples_real: bool | None = None


class PackJobsOut(_Out):
    status: str
    pack: str
    version: int
    templates: list[TemplateOut]


class BusinessTypeOut(_Out):
    pack: str
    name: Texts


class SampleOut(_Out):
    item: Texts


class OtherPackOut(_Out):
    pack: str
    name: Texts
    jobs: PackJobsOut


class TemplatesOut(_Out):
    business_type: BusinessTypeOut
    sample: SampleOut | None = None
    own: PackJobsOut
    others: list[OtherPackOut]


class FestivalOut(_Out):
    season: Literal["diwali", "wedding_season", "new_year"]
    name: Texts
    date: str
    region: Literal["andhra", "telangana", "karnataka", "india"]


class FestivalsOut(_Out):
    region: Literal["andhra", "telangana", "karnataka", "india"]
    items: list[FestivalOut]
