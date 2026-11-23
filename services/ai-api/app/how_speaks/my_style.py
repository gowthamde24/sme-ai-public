"""GET/PUT /v1/me/assistant-style ("To you", docs/contracts/voice-styles.md section 1B): the style the signed-in person wants THEIR OWN assistant to talk in with them.

A setting of one person, not of a workspace: any signed-in person reads and writes only their own (the database keeps one row per user and has no other way in). It never changes what the assistant says to customers (that is the
workspace's `tone`, GET/PUT how-assistant-speaks). The options are the same seven objects as `tone.options`. `PUT {"value": null}` goes back to "not chosen" (the screen then shows the workspace's default).

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

# ruff: noqa: E501

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict

from app.auth.deps import PrincipalDep, Runtime, get_runtime
from app.how_speaks import styles
from app.how_speaks.models import Tone
from app.talk_training.routes import _repo

router = APIRouter(prefix="/v1/me", tags=["how-assistant-speaks"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]


class MyStyleIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: Tone | None


def _answer(stored: dict[str, Any]) -> JSONResponse:
    value = stored.get("value") if isinstance(stored.get("value"), str) else None
    return JSONResponse({"value": value or "friendly", "saved": value is not None, "options": styles.options()}, headers={"Cache-Control": "no-store"})


@router.get("/assistant-style")
def get_style(principal: PrincipalDep, runtime: RuntimeDep) -> JSONResponse:
    return _answer(_repo(runtime).my_style_get(principal.token))


@router.put("/assistant-style")
def put_style(body: MyStyleIn, principal: PrincipalDep, runtime: RuntimeDep) -> JSONResponse:
    return _answer(_repo(runtime).my_style_set(principal.token, body.value))
