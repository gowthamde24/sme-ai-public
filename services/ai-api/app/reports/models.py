"""The ONE shape of every pack's reports (job CV, ADR 0088; module `reports`).

A report is figures (`kpis`, each with a unit), tables with typed columns (a row is an array in the order of the columns) and series by day. Every figure is a sum or a count of entries a person made: a model never
computes one. The catalogue tells a screen which reports THIS business may run (the modules each needs are on, the caller's role allows it) and what kind of date window each takes."""

from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Unit = Literal["paise", "count", "percent", "seconds"]
ColumnType = Literal["text", "count", "paise", "percent"]
Window = Literal["range", "day", "week"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class KpiOut(_Strict):
    key: str
    value: float | int | None
    unit: Unit


class ColumnOut(_Strict):
    key: str
    type: ColumnType


class TableOut(_Strict):
    key: str
    columns: list[ColumnOut]
    rows: list[list[Any]]


class PointOut(_Strict):
    day: date
    value: int


class SeriesOut(_Strict):
    key: str
    points: list[PointOut]


class ReportOut(_Strict):
    """Figures, typed tables and series by day. `from` and `to` are the India days the figures cover (`as_of` the day they are as of)."""

    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    report: str
    as_of: date
    from_: date = Field(alias="from")
    to: date
    kpis: list[KpiOut]
    tables: list[TableOut]
    series: list[SeriesOut]


class CatalogueItemOut(_Strict):
    """A report the caller may run: its code, the key of its title (the words are the web's, in four languages), the kind of window it takes and the modules it needs."""

    code: str
    title_key: str
    window: Window
    modules: list[str]


class CatalogueOut(_Strict):
    items: list[CatalogueItemOut]
