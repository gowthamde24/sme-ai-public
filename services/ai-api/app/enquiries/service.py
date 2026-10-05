"""Assemble what the review screen shows from the rows of one enquiry's requirement (no I/O): typed values, flags, `confirmable`,
`ready_for_quote` and the derived questions, all by the deterministic services of app/requirements (never a model)."""

from __future__ import annotations

from datetime import date
from typing import Any

from app.enquiries.models import (
    FieldValueOut,
    FlagOut,
    QuestionOut,
    RequirementFieldOut,
    RequirementOut,
    RequirementViewOut,
)
from app.requirements.display import display
from app.requirements.normalise import Value
from app.requirements.policy import FieldView, assess
from app.requirements.questions import derive_questions


def value_of(row: dict[str, Any]) -> Value:
    raw_date = row.get("value_date")
    return Value(
        code=row.get("value_code"),
        int_value=row.get("value_int"),
        date_value=date.fromisoformat(str(raw_date)) if raw_date else None,
        text=row.get("value_text"),
        basis=row.get("basis"),
    )


def field_out(row: dict[str, Any]) -> RequirementFieldOut:
    value = value_of(row)
    return RequirementFieldOut(
        id=row["id"],
        line_no=row["line_no"],
        field_key=row["field_key"],
        value=FieldValueOut(
            code=value.code,
            int_value=value.int_value,
            date_value=value.date_value,
            text=value.text,
            basis=value.basis,
        ),
        display=display(row["field_key"], value),
        certainty=row["certainty"],
        state=row["state"],
        conflict=row["conflict"],
        created_via=row["created_via"],
        quote=row["quote"],
        quote_start=row["quote_start"],
        quote_end=row["quote_end"],
        decided_by=row["decided_by"],
        decided_at=row["decided_at"],
    )


def build_view(
    requirement: dict[str, Any] | None, rows: list[dict[str, Any]]
) -> RequirementViewOut:
    fields = [field_out(r) for r in rows]
    views = [
        FieldView(
            line=f.line_no,
            key=f.field_key,
            value=value_of(r),
            certainty=f.certainty,
            state=f.state,
            conflict=f.conflict,
            id=str(f.id),
        )
        for f, r in zip(fields, rows, strict=True)
    ]
    assessment = assess(views)
    questions = derive_questions(views, assessment)
    return RequirementViewOut(
        requirement=RequirementOut.model_validate(requirement) if requirement else None,
        fields=sorted(fields, key=lambda f: (f.line_no is not None, f.line_no or 0, f.field_key)),
        lines=list(assessment.lines),
        confirmable=assessment.confirmable,
        ready_for_quote=assessment.ready_for_quote,
        flags=[FlagOut(kind=x.kind, field_key=x.key, line_no=x.line) for x in assessment.flags],  # type: ignore[arg-type]
        questions=[
            QuestionOut(code=q.code, text=q.text, field_key=q.key, line_no=q.line)  # type: ignore[arg-type]
            for q in questions
        ],
    )
