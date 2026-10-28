"""The business profile, the members' own profiles and their pictures under /v1/tenants/{t} (job DT, ADR 0115).

  GET   /workspace/profile          any member   {name, type, type_name, type_label, city, phone, languages, logo_url, name_used_in, updated_at}. The name is read live from the workspace (nothing stores a copy).
  PATCH /workspace/profile          OWNER only   any of name, type, type_label, city, phone, languages (what is left out is kept; a null clears city and phone). No second factor and no recent sign-in: the Owner may
                                                 fix the name at any time. `type` is a business type of GET /v1/packs or "other" (with `type_label`, 2 to 60 characters, the Owner's own words). A change inside the
                                                 Lead Desk types and Other is free; out of a deep pack only when it holds none of its records, into one only when the business has no leads: otherwise 409 `type_change_refused`
                                                 with `reason` (pack_data_present, lead_data_present, unknown_type). Audited (the keys, never the values).
  POST  /workspace/logo             Owner, Admin  the BODY is the image (jpeg, png or webp, at most 5 MB); it is re-drawn as a jpeg of at most 1280 px with every piece of metadata dropped.
  POST  /workspace/logo/remove      Owner, Admin
  GET   /me/profile                 any member   {display_name, language, picture, picture_url}   `picture` is own (their file), google (the Google photo, the default) or none
  PATCH /me/profile                 any member   {display_name?, language?}
  POST  /me/picture                 any member   the BODY is the image (as the logo, at most 320 px)        POST /me/picture/remove
  GET   /people                     any member   [{user_id, display_name, picture, picture_url}] for the menu, the team list and the hand-off messages

The files live in the business's private images bucket (the caller's own token; the storage rules decide). A picture is reached only through a signed URL that expires in minutes."""

from __future__ import annotations

import uuid
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Request
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.auth.deps import Runtime, TenantContext, get_runtime, require_tenant_role
from app.catalogue import images
from app.catalogue.errors import PhotoRejectedError
from app.catalogue.storage import StorageClient
from app.crm.models import _Strict
from app.errors import ApiError
from app.tenancy.models import Role
from app.workspace.errors import TypeChangeRefusedError
from app.workspace.models import Language
from app.workspace.repository import WorkspaceRepository

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["workspace"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
OwnerOnly = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER))]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]

MAX_UPLOAD_BYTES = images.MAX_UPLOAD_BYTES
Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
City = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80)]
Phone = Annotated[str, StringConstraints(strip_whitespace=True, pattern=r"^\+?[0-9 ()-]{6,20}$")]
TypeCode = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{1,30}$")]
TypeLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=60)]
PersonName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class BusinessPatch(_Strict):
    name: Name | None = None
    type: TypeCode | None = None
    type_label: TypeLabel | None = None
    city: City | None = None
    phone: Phone | None = None
    languages: Annotated[list[Language], Field(min_length=1, max_length=5)] | None = None

    @model_validator(mode="after")
    def _shape(self) -> BusinessPatch:
        if not self.model_fields_set:
            raise ValueError("give at least one field")
        # only city and phone may be sent as null (that clears them)
        for field in self.model_fields_set - {"city", "phone"}:
            if getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class _Out(BaseModel):
    model_config = ConfigDict(extra="forbid")


class BusinessOut(_Out):
    name: str
    type: str
    type_name: str | None
    type_label: str | None
    city: str | None
    phone: str | None
    languages: list[str]
    logo_url: str | None
    # where the name shows (closed words), so the screen can say it
    name_used_in: list[Literal["assistant_greeting", "voice_preview", "call_opening", "whatsapp_opening", "menu_header"]]
    updated_at: str | None


class MePatch(_Strict):
    display_name: PersonName | None = None
    language: Language | None = None

    @model_validator(mode="after")
    def _shape(self) -> MePatch:
        if not self.model_fields_set or any(getattr(self, f) is None for f in self.model_fields_set):
            raise ValueError("give at least one field, not null")
        return self


class MeOut(_Out):
    display_name: str | None
    language: str | None
    picture: Literal["own", "google", "none"]
    picture_url: str | None


class PersonOut(_Out):
    user_id: str
    display_name: str | None
    picture: Literal["own", "google", "none"]
    picture_url: str | None


class PeopleOut(_Out):
    people: list[PersonOut]


def _repo(runtime: Runtime) -> WorkspaceRepository:
    if runtime.workspace is None:
        raise ApiError(503, "workspace_unavailable", "This is not available on this system.")
    return runtime.workspace


def _storage(runtime: Runtime) -> StorageClient:
    if runtime.catalogue_storage is None:
        raise ApiError(503, "workspace_unavailable", "This is not available on this system.")
    return runtime.catalogue_storage


def _bucket(tenant_id: uuid.UUID) -> str:
    return f"img-{tenant_id}"  # the name the database gives (app.images_bucket)


def _signed(runtime: Runtime, token: str, tenant_id: uuid.UUID, paths: list[str]) -> dict[str, str]:
    paths = [p for p in paths if p]
    if not paths:
        return {}
    return _storage(runtime).sign(token, _bucket(tenant_id), paths)


def _business_out(runtime: Runtime, ctx: TenantContext, row: dict[str, Any]) -> BusinessOut:
    path = row.get("logo_path")
    url = _signed(runtime, ctx.principal.token, ctx.tenant.id, [path] if isinstance(path, str) else []).get(path) if isinstance(path, str) else None
    return BusinessOut.model_validate({**{k: v for k, v in row.items() if k != "logo_path"}, "logo_url": url})


def _picture(row: dict[str, Any], signed: dict[str, str]) -> tuple[Literal["own", "google", "none"], str | None]:
    path = row.get("avatar_path")
    if isinstance(path, str) and path in signed:
        return "own", signed[path]
    google = row.get("google_picture")
    if isinstance(google, str) and google:
        return "google", google
    return "none", None


def _person(row: dict[str, Any], signed: dict[str, str]) -> PersonOut:
    kind, url = _picture(row, signed)
    return PersonOut(user_id=str(row.get("user_id")), display_name=row.get("display_name"), picture=kind, picture_url=url)


async def _read_body(request: Request) -> bytes:
    declared = request.headers.get("content-length")
    if declared is not None and declared.isdigit() and int(declared) > MAX_UPLOAD_BYTES + 65536:
        raise ApiError(413, "image_too_large", "That picture is bigger than 5 MB.")
    chunks: list[bytes] = []
    size = 0
    async for chunk in request.stream():
        size += len(chunk)
        if size > MAX_UPLOAD_BYTES + 65536:
            raise ApiError(413, "image_too_large", "That picture is bigger than 5 MB.")
        chunks.append(chunk)
    return b"".join(chunks)


def _process(data: bytes, content_type: str, *, thumb: bool) -> bytes:
    try:
        done = images.process(data, content_type or None)
    except PhotoRejectedError as exc:
        reason = exc.code
        code = {"too_large": 413, "unsupported_type": 415}.get(str(reason), 422)
        raise ApiError(code, "image_rejected", "Use a JPG, PNG or WebP picture of at most 5 MB.", extra={"reason": str(reason)}) from None
    return done.thumb if thumb else done.photo


# ----------------------------------------------------------------------------------------------------------------- the business
@router.get("/workspace/profile", response_model=BusinessOut)
def get_business(ctx: AnyMember, runtime: RuntimeDep) -> BusinessOut:
    return _business_out(runtime, ctx, _repo(runtime).business(ctx.principal.token, ctx.tenant.id))


@router.patch("/workspace/profile", response_model=BusinessOut)
def patch_business(body: BusinessPatch, ctx: OwnerOnly, runtime: RuntimeDep) -> BusinessOut:
    patch = {field: getattr(body, field) for field in body.model_fields_set}
    try:
        row = _repo(runtime).save_business(ctx.principal.token, ctx.tenant.id, patch)
    except TypeChangeRefusedError as exc:
        reason = getattr(exc, "detail", None) or "type_change_refused"
        raise ApiError(409, "type_change_refused", "This business type cannot be changed now.", extra={"reason": reason}) from None
    return _business_out(runtime, ctx, row)


@router.post("/workspace/logo", response_model=BusinessOut)
async def post_logo(request: Request, ctx: OwnerAdmin, runtime: RuntimeDep) -> BusinessOut:
    data = await _read_body(request)
    jpeg = await run_in_threadpool(_process, data, request.headers.get("content-type") or "", thumb=False)
    return await run_in_threadpool(_store_logo, runtime, ctx, jpeg)


def _store_logo(runtime: Runtime, ctx: TenantContext, jpeg: bytes) -> BusinessOut:
    repo, storage, token = _repo(runtime), _storage(runtime), ctx.principal.token
    bucket = repo.ensure_images_bucket(token, ctx.tenant.id)
    path = f"logo/{uuid.uuid4()}.jpg"
    storage.upload(token, bucket, path, jpeg, "image/jpeg")
    try:
        done = repo.set_logo(token, ctx.tenant.id, path)
    except Exception:
        storage.remove(token, bucket, [path])
        raise
    old = done.get("old_path")
    if isinstance(old, str) and old != path:
        storage.remove(token, bucket, [old])
    return _business_out(runtime, ctx, repo.business(token, ctx.tenant.id))


@router.post("/workspace/logo/remove", response_model=BusinessOut)
def remove_logo(ctx: OwnerAdmin, runtime: RuntimeDep) -> BusinessOut:
    repo, token = _repo(runtime), ctx.principal.token
    done = repo.set_logo(token, ctx.tenant.id, None)
    old = done.get("old_path")
    if isinstance(old, str):
        _storage(runtime).remove(token, _bucket(ctx.tenant.id), [old])
    return _business_out(runtime, ctx, repo.business(token, ctx.tenant.id))


# ----------------------------------------------------------------------------------------------------------------- the person
def _me(runtime: Runtime, ctx: TenantContext, row: dict[str, Any]) -> MeOut:
    path = row.get("avatar_path")
    signed = _signed(runtime, ctx.principal.token, ctx.tenant.id, [path] if isinstance(path, str) else [])
    kind, url = _picture(row, signed)
    return MeOut(display_name=row.get("display_name"), language=row.get("language"), picture=kind, picture_url=url)


@router.get("/me/profile", response_model=MeOut)
def get_me(ctx: AnyMember, runtime: RuntimeDep) -> MeOut:
    return _me(runtime, ctx, _repo(runtime).my_profile(ctx.principal.token, ctx.tenant.id))


@router.patch("/me/profile", response_model=MeOut)
def patch_me(body: MePatch, ctx: AnyMember, runtime: RuntimeDep) -> MeOut:
    patch = {field: getattr(body, field) for field in body.model_fields_set}
    row = _repo(runtime).save_my_profile(ctx.principal.token, ctx.tenant.id, patch)
    return _me(runtime, ctx, row)


@router.post("/me/picture", response_model=MeOut)
async def post_picture(request: Request, ctx: AnyMember, runtime: RuntimeDep) -> MeOut:
    data = await _read_body(request)
    jpeg = await run_in_threadpool(_process, data, request.headers.get("content-type") or "", thumb=True)
    return await run_in_threadpool(_store_picture, runtime, ctx, jpeg)


def _store_picture(runtime: Runtime, ctx: TenantContext, jpeg: bytes) -> MeOut:
    repo, storage, token = _repo(runtime), _storage(runtime), ctx.principal.token
    bucket = repo.ensure_images_bucket(token, ctx.tenant.id)
    path = f"member/{ctx.principal.user_id}/{uuid.uuid4()}.jpg"
    storage.upload(token, bucket, path, jpeg, "image/jpeg")
    try:
        row = repo.save_my_profile(token, ctx.tenant.id, {"avatar_path": path})
    except Exception:
        storage.remove(token, bucket, [path])
        raise
    old = row.get("old_avatar_path")
    if isinstance(old, str) and old != path:
        storage.remove(token, bucket, [old])
    return _me(runtime, ctx, row)


@router.post("/me/picture/remove", response_model=MeOut)
def remove_picture(ctx: AnyMember, runtime: RuntimeDep) -> MeOut:
    token = ctx.principal.token
    row = _repo(runtime).save_my_profile(token, ctx.tenant.id, {"avatar_path": None})
    old = row.get("old_avatar_path")
    if isinstance(old, str):
        _storage(runtime).remove(token, _bucket(ctx.tenant.id), [old])
    return _me(runtime, ctx, {**row, "avatar_path": None})


@router.get("/people", response_model=PeopleOut)
def get_people(ctx: AnyMember, runtime: RuntimeDep) -> PeopleOut:
    rows = _repo(runtime).people(ctx.principal.token, ctx.tenant.id)
    signed = _signed(runtime, ctx.principal.token, ctx.tenant.id, [r["avatar_path"] for r in rows if isinstance(r.get("avatar_path"), str)])
    return PeopleOut(people=[_person(r, signed) for r in rows])


__all__ = ["router"]
