"""POST /v1/tenants/{t}/jobs/describe (Owner, Admin; behind JOBS): docs/contracts/jobs-describe.md. The sentence is data, a draft comes back, nothing is created.

NOTE: no `from __future__ import annotations` here (request models are attached at registration time)."""

# ruff: noqa: E501

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, StringConstraints

from app.assistant.routes import _refusal
from app.auth.deps import OwnerOrAdmin, Runtime, get_runtime
from app.errors import ApiError
from app.jobs import packdata, templates
from app.jobs.describe import (
    DAILY_LIMIT,
    FEATURE,
    MAX_TEXT,
    Describer,
    DescribeRefused,
    catalogue_facts,
)
from app.jobs.routes import JobsDep

router = APIRouter(prefix="/v1/tenants/{tenant_id}/jobs", tags=["jobs"])   # JOBS is checked by the `jobs` parameter AFTER the role (a read-only workspace is refused first)
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]


class DescribeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: Annotated[str, StringConstraints(strip_whitespace=True, min_length=3, max_length=MAX_TEXT)]
    language: Literal["en", "te", "hi", "kn"] = "en"
    source: Literal["typed", "voice"] = "typed"


class FieldOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    key: str
    value: str | bool
    words: str


class DescribeOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    understood: bool
    template_id: str | None
    kind: str | None
    goal: str | None
    fields: list[FieldOut]
    unclear: list[str]
    nearest: list[str]
    unclear_words: str | None = None   # one neutral line when the model left something open


@router.post("/describe", response_model=DescribeOut)
def describe(body: DescribeIn, ctx: OwnerOrAdmin, runtime: RuntimeDep, jobs: JobsDep) -> dict[str, Any]:
    if runtime.packs is None:
        raise ApiError(503, "packs_unavailable", "Business types are not available on this system.")
    token, tenant_id = ctx.principal.token, ctx.tenant.id
    row = runtime.packs.workspace_pack(token, tenant_id)
    own = packdata.for_pack(str(row["pack_id"]), jobs.directory)
    shown = templates.pack_jobs_out(own, get_paid=jobs.get_paid).templates if own is not None else []
    items, kinds = catalogue_facts(list(shown))
    cap_rpc = getattr(runtime, "daily_cap", None)

    def cap(tok: str, tid: Any) -> bool:
        if cap_rpc is None:
            return True
        return bool(cap_rpc(tok, tid, FEATURE, DAILY_LIMIT))

    try:
        draft = Describer(runtime, cap, _refusal).describe(token, tenant_id, body.text, items, kinds)
    except DescribeRefused as refused:
        if refused.reason == "ai_limit":
            raise ApiError(429, "ai_limit", "That is enough describing for today. Try again tomorrow.", extra={"reason": "ai_limit"}) from None
        raise ApiError(503, "describe_unavailable", "We could not read that just now. Please try again.") from None
    if draft["unclear"]:
        draft["unclear_words"] = "A few things were not clear from what you said: " + ", ".join(k.replace("_", " ") for k in draft["unclear"]) + ". Please choose them yourself."
    return draft
