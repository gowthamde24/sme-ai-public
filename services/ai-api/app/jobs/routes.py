"""Jobs, the read-only slice S2a (jobs contract 1.0 sections 0 and 3, 1.1 part 1 sections 1 and 7). All under /v1/tenants/{t}/jobs.

  GET /jobs/templates   Owner, Admin: the job templates of the workspace's business type and the other types' (an ETag on the answer, 304 on If-None-Match)
  GET /jobs/festivals   every member: the festivals of the workspace's region in the next 60 days, nearest first, one row per season
  (GET /jobs, GET /jobs/today and the job page `/jobs/{id}` with its settings, its switch and its name: this file and app/jobs/detail_routes.py)

With JOBS off (the default) every route answers 404 `not_found` as if it did not exist, before anything else is checked (sign-in included).

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

# ruff: noqa: E501

import base64
import binascii
import hashlib
import json
import re
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app import gstin as gstin_module
from app.auth.deps import AnyMember, OwnerOrAdmin, PrincipalDep, Runtime, get_runtime
from app.errors import ApiError, not_found
from app.jobs import festivals, listing, samples, templates
from app.jobs import needs as needs_mod
from app.jobs.models import FestivalOut, FestivalsOut
from app.jobs.wiring import JobsRuntime
from app.tenancy.repository import RepositoryError


def jobs_on(request: Request) -> JobsRuntime:
    """404 while JOBS is off: this runs first (a router dependency), so nothing about the route is revealed, not even to a caller who is not signed in."""
    jobs = getattr(getattr(request.app.state, "runtime", None), "jobs", None)
    if jobs is None:
        raise not_found()
    return jobs  # type: ignore[no-any-return]


router = APIRouter(prefix="/v1/tenants/{tenant_id}/jobs", tags=["jobs"], dependencies=[Depends(jobs_on)])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
JobsDep = Annotated[JobsRuntime, Depends(jobs_on)]


def _etag(body: Any) -> str:
    return '"' + hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")).hexdigest()[:32] + '"'


def _matches(header: str | None, etag: str) -> bool:
    if not header:
        return False
    wanted = [part.strip().removeprefix("W/") for part in header.split(",")]
    return "*" in wanted or etag in wanted


def _answer(request: Request, body: dict[str, Any]) -> Response:
    """The JSON with its ETag; 304 and no body when the caller already holds this exact answer. `private, no-cache`: the answer is for this workspace (it may carry its own prospects), and is checked again each time."""
    etag = _etag(body)
    headers = {"ETag": etag, "Cache-Control": "private, no-cache"}
    if _matches(request.headers.get("if-none-match"), etag):
        return Response(status_code=304, headers=headers)
    return JSONResponse(body, headers=headers)


@router.get("")
def list_jobs(request: Request, ctx: AnyMember, runtime: RuntimeDep) -> Response:
    """GET /jobs: every job of the workspace (thin version: what already runs, read from its own subsystem; see app/jobs/listing.py)."""
    return _answer(request, {"items": listing.jobs_of(runtime, ctx.principal.token, ctx.tenant.id)})


@router.get("/today")
def jobs_today(request: Request, ctx: AnyMember, runtime: RuntimeDep) -> Response:
    """GET /jobs/today: the Today first paint in one call: the jobs, what waits for the owner (the items Today shows, read once: `{id, code, kind, at, target {type, id}}`) and the assistant's name."""
    token, tenant_id = ctx.principal.token, ctx.tenant.id
    items = needs_mod.items_of(runtime, token, tenant_id)
    assistant = runtime.repository.get_assistant_name(token, tenant_id)
    return _answer(request, {"jobs": listing.jobs_of(runtime, token, tenant_id, items), "needs_you": items, "assistant": {"name": assistant}})


@router.get("/templates")
def get_templates(request: Request, ctx: OwnerOrAdmin, runtime: RuntimeDep, jobs: JobsDep) -> Response:
    if runtime.packs is None:
        raise ApiError(503, "packs_unavailable", "Business types are not available on this system.")
    token, tenant_id = ctx.principal.token, ctx.tenant.id
    row = runtime.packs.workspace_pack(token, tenant_id)
    manifest = row.get("manifest") or {}
    names = manifest.get("names") if isinstance(manifest, dict) else None
    out = templates.build(
        pack_id=str(row["pack_id"]),
        manifest_names={k: v for k, v in names.items() if isinstance(v, str)} if isinstance(names, dict) else {},
        directory=jobs.directory,
        get_paid=jobs.get_paid,
        item_name=templates.first_item_name(runtime.catalogue, token, tenant_id),
        real=templates.real_prospects(runtime.lead_finder, token, tenant_id),
    )
    body = out.model_dump(mode="json", exclude_unset=True)
    _attach_samples(body, jobs, token)
    return _answer(request, body)


def _region(runtime: Runtime, token: str, tenant_id: Any) -> str:
    """The workspace's region from the state of its business profile (the GSTIN's state); no profile, no GSTIN or anything unreadable is india."""
    if runtime.business_profile is None:
        return festivals.FALLBACK_REGION
    try:
        gstin = gstin_module.parse(runtime.business_profile.get(token, tenant_id).get("gstin"))
    except Exception:  # noqa: BLE001 - the region is a nicety: the national calendar answers instead
        return festivals.FALLBACK_REGION
    return festivals.region_for_state(gstin_module.state_of(gstin) if gstin else None)


@router.get("/festivals", response_model=FestivalsOut)
def get_festivals(ctx: AnyMember, runtime: RuntimeDep, jobs: JobsDep) -> FestivalsOut:
    region = _region(runtime, ctx.principal.token, ctx.tenant.id)
    cal = festivals.calendar(jobs.directory)
    rows = festivals.upcoming(cal, region, festivals.today_in_india(jobs.clock)) if cal is not None else []
    return FestivalsOut(region=region, items=[FestivalOut(season=r.season, name=r.name, date=r.date.isoformat(), region=r.region) for r in rows])  # type: ignore[arg-type]


def _attach_samples(body: dict[str, Any], jobs: JobsRuntime, token: str) -> None:
    """`preview.sample_audio` becomes {language: link} for the samples that exist (jobs contract 1.1 part 1 T6); a template with none keeps null and the web shows no player. A failure here never fails the list."""
    if jobs.samples is None:
        return
    try:
        have = {(r["pack"], r["template_id"], r["language"]): str(r["sha8"]) for r in jobs.samples.listing(token)}
    except Exception:  # noqa: BLE001 - samples are a nicety
        return
    if not have:
        return
    blocks = [(body.get("own") or {})] + [(o.get("jobs") or {}) for o in body.get("others") or []]
    for block in blocks:
        pack_id = block.get("pack")
        for t in block.get("templates") or []:
            links = {lang: f"/v1/job-samples/{pack_id}/{t['id']}_{sha8}.{lang}.mp3" for (p, tid, lang), sha8 in have.items() if p == pack_id and tid == t["id"]}
            if links and isinstance(t.get("preview"), dict):
                t["preview"]["sample_audio"] = links


# --- the spoken samples themselves (platform data, not tenant data): one file per template and language, played by the New job sheet through the web's same-origin proxy
samples_router = APIRouter(prefix="/v1/job-samples", tags=["jobs"], dependencies=[Depends(jobs_on)])
ops_router = APIRouter(prefix="/v1/ops/job-samples", tags=["jobs"], dependencies=[Depends(jobs_on)])
_PACK_ID = re.compile(r"^[a-z][a-z0-9_]{1,30}$")


@samples_router.get("/{pack}/{file}")
def get_sample(pack: str, file: str, principal: PrincipalDep, jobs: JobsDep) -> Response:
    """The sound of one sample. Any signed-in person (it is invented example words, nothing about a customer); immutable: the link carries the first 8 characters of the hash of the words."""
    parsed = samples.parse_file(file)
    if jobs.samples is None or parsed is None or not _PACK_ID.fullmatch(pack):
        raise not_found()
    template_id, sha8, language = parsed
    try:
        found = jobs.samples.get(principal.token, pack, template_id, language)
        audio = base64.b64decode("".join(str((found or {}).get("audio_b64") or "").split()), validate=True) if found else b""   # Postgres encode(..., 'base64') wraps its lines every 76 characters
    except (RepositoryError, binascii.Error):
        raise not_found() from None
    if not found or not audio or found.get("sha8") != sha8:
        raise not_found()
    return Response(content=audio, media_type=str(found.get("content_type") or "audio/wav"), headers={"Cache-Control": "private, max-age=31536000, immutable", "Accept-Ranges": "none"})


class GenerateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    languages: list[Literal["en", "te", "hi", "kn"]] = Field(default=["en", "te"], min_length=1, max_length=4)
    limit: int = Field(default=10, ge=1, le=samples.MAX_PER_RUN)
    dry_run: bool = False


@ops_router.post("/generate")
def generate_samples(body: GenerateIn, principal: PrincipalDep, runtime: RuntimeDep, jobs: JobsDep) -> dict[str, Any]:
    """Make the missing samples (the system account only: the database checks it; a workspace owner is refused). Spends voice credits: at most `limit` samples, never past the cap in samples.CAP_CHARS (Rs 300), and never for words already recorded."""
    service = runtime.voice_sample
    if jobs.samples is None or service is None or not service.available() or service.tts is None:
        raise ApiError(503, "voice_unavailable", "The voice service is not available on this system.")
    try:
        return samples.run(jobs.samples, service.tts, principal.token, jobs.directory, body.languages, body.limit, dry_run=body.dry_run, get_paid=False)
    except RepositoryError:
        raise ApiError(403, "forbidden", "Your role does not allow this action.") from None


@ops_router.get("/index")
def sample_index(principal: PrincipalDep, jobs: JobsDep) -> dict[str, Any]:
    """What exists (the system account only: the database checks it): every sample's key, the hash of its words and its characters, and the characters spent in all."""
    if jobs.samples is None:
        raise ApiError(503, "voice_unavailable", "The voice service is not available on this system.")
    try:
        return jobs.samples.index(principal.token)
    except RepositoryError:
        raise ApiError(403, "forbidden", "Your role does not allow this action.") from None


class RecodeIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    pack: str = Field(pattern=r"^[a-z][a-z0-9_]{1,30}$")
    template_id: str = Field(pattern=r"^[a-z][a-z0-9_]{2,40}$")
    language: Literal["en", "te", "hi", "kn", "ta", "ml", "mr"]
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    content_type: Literal["audio/mpeg", "audio/ogg", "audio/wav"]
    audio_b64: str = Field(min_length=4, max_length=2_000_000)


@ops_router.post("/recode")
def recode_sample(body: RecodeIn, principal: PrincipalDep, jobs: JobsDep) -> dict[str, Any]:
    """Replace the sound of a sample whose words are the same (a smaller encoding of the same recording; the system account only). Spends nothing: no voice credits, no characters counted."""
    if jobs.samples is None:
        raise ApiError(503, "voice_unavailable", "The voice service is not available on this system.")
    try:
        return jobs.samples.recode(principal.token, body.pack, body.template_id, body.language, body.sha256, body.content_type, body.audio_b64)
    except RepositoryError:
        raise ApiError(403, "forbidden", "Your role does not allow this action.") from None


__all__ = ["ops_router", "router", "samples_router"]
