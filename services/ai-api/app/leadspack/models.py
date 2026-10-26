"""Models of the "Leads & calls" business types and of a workspace's lead playbook (job DR / A1). Strict: an unknown field is a 422. The contract is docs/contracts/leads-pack.md and packages/contracts/leads_pack.*"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

Code = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{1,39}$")]
Channel = Literal["call", "whatsapp"]
When = Literal["no_answer", "interested", "callback", "booked", "not_interested"]
# a lead playbook states no price and no promise (prices only come from the facts the owner approved); the pack checker (scripts/packs_check.py) uses the same words
PRICE_OR_PROMISE = re.compile(
    r"₹|\brs\.?\s?\d|\d\s?%|\d+\s*(lakh|crore|rupees)"
    r"|(?<!not )(?<!cannot )(?<!never )(?<!n't )(?<!no )\b(guarantee|guaranteed|promise|promised|assure|assured|warranty)\b",
    re.IGNORECASE,
)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class TextEn(_Strict):
    en: Annotated[str, StringConstraints(strip_whitespace=True, min_length=5, max_length=400)]

    @field_validator("en")
    @classmethod
    def _no_price_or_promise(cls, value: str) -> str:
        if PRICE_OR_PROMISE.search(value):
            raise ValueError("price_or_promise")
        return value


class Label4(_Strict):
    en: str
    te: str
    hi: str
    kn: str


class ChoiceOut(_Strict):
    code: str
    label: dict[str, str]


class FieldDefinitionOut(_Strict):
    kind: Literal["text", "number", "date", "choice", "multi_choice", "yes_no"]
    label: dict[str, str]
    choices: list[ChoiceOut] | None = None


class QuestionOut(_Strict):
    code: str
    field: str
    ask: TextEn
    required: bool
    field_definition: FieldDefinitionOut


class ObjectionBody(_Strict):
    code: Code
    hears: Annotated[list[Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80)]], Field(min_length=1, max_length=6)]
    answer: TextEn


class FollowupBody(_Strict):
    when: When
    after_minutes: Annotated[int, Field(strict=True, ge=-10080, le=43200)]
    channel: Channel
    max_attempts: Annotated[int, Field(strict=True, ge=1, le=5)]
    message: TextEn | None = None


class ReasonBody(_Strict):
    code: Code
    label: dict[str, str]


class OutcomeReasonsBody(_Strict):
    not_interested: Annotated[list[ReasonBody], Field(min_length=2, max_length=12)]
    interested: Annotated[list[ReasonBody], Field(min_length=2, max_length=12)]


class GoalOut(_Strict):
    code: str
    label: Label4
    ask: TextEn


class GoalSummaryOut(_Strict):
    code: str
    label: Label4


class TemplateSummaryOut(_Strict):
    pack_id: str
    version: int
    names: dict[str, str]
    summary: dict[str, str]
    goal: GoalSummaryOut
    question_count: int
    accent: str
    owl_prop: str
    validated: bool


class TemplatesOut(_Strict):
    templates: list[TemplateSummaryOut]


class TemplateOut(_Strict):
    pack_id: str
    version: int
    names: dict[str, str]
    goal: GoalOut
    questions: list[QuestionOut]
    objections: list[ObjectionBody]
    followups: list[FollowupBody]
    outcome_reasons: OutcomeReasonsBody
    safety: list[str]


# ------------------------------------------------------------------------------------------------ the workspace's playbook
class PlaybookQuestion(_Strict):
    field: Code
    ask: TextEn
    required: bool


class PlaybookBody(_Strict):
    """What the Owner edits: the goal sentence, the questions (a subset and an order of the pack's contact fields), the objections, the follow-ups and the outcome reasons."""

    goal_ask: TextEn
    questions: Annotated[list[PlaybookQuestion], Field(min_length=1, max_length=8)]
    objections: Annotated[list[ObjectionBody], Field(max_length=8)]
    followups: Annotated[list[FollowupBody], Field(max_length=10)]
    outcome_reasons: OutcomeReasonsBody

    @field_validator("followups")
    @classmethod
    def _followups_make_sense(cls, value: list[FollowupBody]) -> list[FollowupBody]:
        for f in value:
            if f.after_minutes < 0 and f.when != "booked":
                raise ValueError("bad_followup")
            if f.channel == "whatsapp" and f.message is None:
                raise ValueError("bad_followup")
        return value

    @field_validator("questions")
    @classmethod
    def _one_question_per_field(cls, value: list[PlaybookQuestion]) -> list[PlaybookQuestion]:
        fields = [q.field for q in value]
        if len(fields) != len(set(fields)):
            raise ValueError("duplicate_field")
        return value


class PlaybookOut(_Strict):
    # the business type's pack when it has a template; null for a deep pack (then there is no playbook)
    template_pack: str | None
    saved: bool
    playbook: dict[str, Any] | None
    defaults: dict[str, Any] | None
    safety: list[str]
    updated_at: datetime | None
    wording: Literal["draft"] = "draft"
