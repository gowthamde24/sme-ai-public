# ruff: noqa: E501
"""AI employees (26 Nov 2026; contract docs/contracts/employees.md). Behind EMPLOYEES (404 while off).
  GET  /v1/tenants/{t}/employees                             any member: {employees: [...], limit}
  POST /v1/tenants/{t}/employees                             Owner/Admin: {id, role_code, name} -> 201 a draft with the role's starting responsibilities (the same id again is a retry)
  GET  /v1/tenants/{t}/employees/{id}                        any member
  PUT  /v1/tenants/{t}/employees/{id}                        Owner/Admin: a patch of the editable fields (what is left out is kept)
  POST /v1/tenants/{t}/employees/{id}/status                 Owner/Admin: {status: on|paused|archived}
  PUT  /v1/tenants/{t}/employees/{id}/voices/{language}      Owner/Admin: {voice_code} (a voice of the catalogue for that language)
  PUT  /v1/tenants/{t}/employees/{id}/phone                  Owner/Admin: {phone_number_id|null} the line this employee answers
  GET  /v1/tenants/{t}/employees/{id}/activity?limit&before  any member: the calls of this employee
  POST /v1/tenants/{t}/employees/{id}/preview                Owner/Admin: {language, text?} the employee's opening line (or a sample) spoken in ITS voice (the chosen voice or an error)
NOTE: no `from __future__ import annotations` (request models are attached to the endpoint signatures at registration time)."""

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from app.auth.deps import AnyMember, Runtime, TenantContext, get_runtime, require_tenant_role
from app.employees.repository import EmployeeRefused
from app.errors import ApiError, not_found
from app.plain_label import plain
from app.tenancy.models import Role

router = APIRouter(prefix="/v1/tenants/{tenant_id}/employees", tags=["employees"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
OwnerAdminStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, strong=True))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
RoleCode = Literal["receptionist", "sales", "follow_up", "collections", "support", "appointments", "custom"]
Lang = Literal["en", "te", "hi", "kn", "ta", "ml", "mr"]
AskFirst = Literal["send_message", "make_call", "give_discount", "promise_date", "book_visit", "share_price", "send_media"]
Id = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{1,40}$")]

WORDS = {
    "employee_limit": ("Your plan has the most AI employees it allows.", 409),
    "name_taken": ("Another AI employee already has that name. Please pick another.", 409),
    "last_default": ("The main assistant cannot be paused or removed.", 409),
    "hours_wider": ("An AI employee can work only inside the calling hours: 10:00 to 21:00.", 422),
    "settings_elsewhere": ("The main assistant is set up in My assistant, not here.", 409),
    "invalid": ("That is not valid. Please check it.", 422),
}


class EmployeeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: uuid.UUID
    role_code: RoleCode
    name: Annotated[str, StringConstraints(min_length=1, max_length=60)]


class Autonomy(BaseModel):
    model_config = ConfigDict(extra="forbid")
    may_answer_prices: bool | None = None
    may_book_visits: bool | None = None
    may_send_media: bool | None = None
    may_talk_dues: bool | None = None
    max_discount_percent: Annotated[int, Field(ge=0, le=100)] | None = None
    handover_owner_asked: bool | None = None
    handover_upset: bool | None = None
    handover_order_above_paise: Annotated[int, Field(ge=0, le=100_000_000_000)] | None = None


class Hours(BaseModel):
    model_config = ConfigDict(extra="forbid")
    days: Annotated[list[Annotated[int, Field(ge=1, le=7)]], Field(min_length=1, max_length=7)]   # 1 = Monday ... 7 = Sunday (as in My assistant's call days)
    from_minute: Annotated[int, Field(ge=0, le=1439)]
    to_minute: Annotated[int, Field(ge=1, le=1440)]


class EmployeePatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: Annotated[str, StringConstraints(min_length=1, max_length=60)] | None = None
    role_code: RoleCode | None = None
    role_title: Annotated[str, StringConstraints(max_length=80)] | None = None
    responsibilities: Annotated[list[Id], Field(max_length=20)] | None = None
    extra_instructions: Annotated[str, StringConstraints(max_length=1500)] | None = None
    never_say: Annotated[list[Annotated[str, StringConstraints(min_length=1, max_length=60)]], Field(max_length=30)] | None = None
    languages: Annotated[list[Lang], Field(min_length=1, max_length=7)] | None = None
    auto_switch_language: bool | None = None
    allow_english_mixing: bool | None = None
    style: Literal["friendly", "respectful", "quick", "casual"] | None = None
    speed: Annotated[float, Field(ge=0.7, le=1.3)] | None = None
    opening_line: dict[Lang, Annotated[str, StringConstraints(min_length=10, max_length=300)]] | None = None
    autonomy: Autonomy | None = None
    ask_first: list[AskFirst] | None = None
    hours: Hours | None = None


class StatusIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["on", "paused", "archived"]


class VoiceIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    voice_code: Annotated[str, StringConstraints(pattern=r"^[a-z]{2}-[a-z0-9_]{1,40}$")]


class PhoneIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    phone_number_id: uuid.UUID | None


class PreviewIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    language: Lang
    text: Annotated[str, StringConstraints(min_length=1, max_length=300)] | None = None


def _repo(runtime: Runtime) -> Any:
    repo = getattr(runtime, "employees", None)
    if repo is None:
        raise not_found()
    return repo


def _refused(exc: EmployeeRefused) -> ApiError:
    text, status = WORDS.get(exc.reason, WORDS["invalid"])
    return ApiError(status, exc.reason, text, extra={"reason": exc.reason, "fields": [exc.reason]})


def _run(fn: Any, *args: Any) -> Any:
    try:
        return fn(*args)
    except EmployeeRefused as exc:
        raise _refused(exc) from None


def _json(body: Any, status: int = 200) -> JSONResponse:
    return JSONResponse(body, status_code=status, headers={"Cache-Control": "no-store"})


@router.get("")
def my_employees(ctx: AnyMember, runtime: RuntimeDep) -> JSONResponse:
    return _json(_run(_repo(runtime).employees, ctx.principal.token, ctx.tenant.id))


@router.post("")
def create_employee(body: EmployeeIn, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> JSONResponse:
    return _json(_run(_repo(runtime).create, ctx.principal.token, ctx.tenant.id, body.id, body.role_code, plain(body.name)), 201)


@router.get("/{employee_id}")
def one_employee(employee_id: uuid.UUID, ctx: AnyMember, runtime: RuntimeDep) -> JSONResponse:
    return _json(_run(_repo(runtime).get, ctx.principal.token, ctx.tenant.id, employee_id))


@router.put("/{employee_id}")
def update_employee(employee_id: uuid.UUID, body: EmployeePatch, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> JSONResponse:
    patch = body.model_dump(exclude_unset=True)
    for key in ("name", "role_title", "extra_instructions"):
        if isinstance(patch.get(key), str):
            patch[key] = plain(patch[key])
    if isinstance(patch.get("never_say"), list):
        patch["never_say"] = [plain(w) for w in patch["never_say"]]
    return _json(_run(_repo(runtime).update, ctx.principal.token, ctx.tenant.id, employee_id, patch))


@router.post("/{employee_id}/status")
def set_status(employee_id: uuid.UUID, body: StatusIn, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> JSONResponse:
    return _json(_run(_repo(runtime).status, ctx.principal.token, ctx.tenant.id, employee_id, body.status))


@router.put("/{employee_id}/voices/{language}")
def set_voice(employee_id: uuid.UUID, language: Lang, body: VoiceIn, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> JSONResponse:
    from app.conversation.voices import default_config

    choice = default_config().catalogue.get(body.voice_code)
    if choice is None or choice.language != language:   # a voice that is not in the catalogue for that language is never saved
        raise _refused(EmployeeRefused("22023"))
    return _json(_run(_repo(runtime).voice, ctx.principal.token, ctx.tenant.id, employee_id, language, body.voice_code))


@router.put("/{employee_id}/phone")
def set_phone(employee_id: uuid.UUID, body: PhoneIn, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> JSONResponse:
    return _json(_run(_repo(runtime).phone, ctx.principal.token, ctx.tenant.id, employee_id, body.phone_number_id))


@router.get("/{employee_id}/activity")
def activity(employee_id: uuid.UUID, ctx: AnyMember, runtime: RuntimeDep, limit: Annotated[int, Query(ge=1, le=100)] = 30, before: Annotated[str | None, Query(max_length=40)] = None) -> JSONResponse:
    return _json(_run(_repo(runtime).activity, ctx.principal.token, ctx.tenant.id, employee_id, limit, before))


class PreviewAudio(BaseModel):
    mime: str
    base64: str


class PreviewOut(BaseModel):
    spoken_text: str
    audio: PreviewAudio
    engine: str
    voice_id: str


@router.post("/{employee_id}/preview")
async def preview(employee_id: uuid.UUID, body: PreviewIn, ctx: OwnerAdmin, runtime: RuntimeDep) -> JSONResponse:
    """Hear this employee: its opening line for the language (or the words sent, or a short sample) in ITS voice for that language. The chosen voice or an error (503 `voice_unavailable`): another voice never stands in."""
    import base64

    from fastapi.concurrency import run_in_threadpool

    from app.conversation.picker import voice_state
    from app.conversation.voices import sample_text
    from app.voice.interface import VoiceError

    repo = _repo(runtime)
    service = getattr(runtime, "call_voice", None)
    if service is None:
        raise ApiError(503, "voice_unavailable", "Voice samples are not available right now.")
    emp = await run_in_threadpool(_run, repo.get, ctx.principal.token, ctx.tenant.id, employee_id)
    voices = emp.get("voices") if isinstance(emp.get("voices"), dict) else {}
    opening = emp.get("opening_line") if isinstance(emp.get("opening_line"), dict) else {}
    text = body.text or opening.get(body.language) or sample_text(body.language)
    _, gender = await run_in_threadpool(voice_state, runtime, ctx)
    try:
        wav, engine, voice_id = await service.speak(ctx.tenant.id, body.language, voices.get(body.language), plain(text), gender)
    except VoiceError as err:
        code = "rate_limited" if getattr(err, "code", "") == "rate_limited" else "voice_unavailable"
        raise ApiError(429 if code == "rate_limited" else 503, code, "That sample cannot be played right now." if code == "voice_unavailable" else "Too many samples today.") from None
    return _json({"spoken_text": plain(text), "audio": {"mime": "audio/wav", "base64": base64.b64encode(wav).decode("ascii")}, "engine": engine, "voice_id": voice_id})

