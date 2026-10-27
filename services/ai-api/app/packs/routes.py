"""Packs, modules, example data, the sign-up providers and the second-factor status (job CK, ADR 0084 part 1, blueprint sections 3 and 4).

  GET    /v1/packs                              no sign-in: the business types a new person may choose (the sign-up cards). From the files in packages/packs.
  GET    /v1/auth/providers                     no sign-in: which ways to sign up are on (e-mail always; Google and Facebook only when their keys are configured).
  GET    /v1/account/security                   the session's second-factor level and which groups of actions need one. A second factor is NOT asked at sign-up.
  GET    /v1/tenants/{t}/pack                   every member: the pack this business runs (pinned version), its words, units and modules.
  GET    /v1/tenants/{t}/modules                every member: the 25 modules and which are on.
  GET    /v1/tenants/{t}/example-data           every member: is the labelled sample loaded.
  POST   /v1/tenants/{t}/example-data           Owner or Admin: load the sample (409 `example_data_loaded` when it already is).
  POST   /v1/tenants/{t}/example-data/remove    Owner or Admin: remove the sample rows that are untouched and unused; the others are KEPT and counted. (A POST, not a DELETE: this API has no
                                                DELETE endpoint at all, tests/test_crm_routes.py; this removes only rows the load itself made.)

The module check itself is in the database (default deny, SM701 -> 403 `module_off`); a screen hides what is off, the database refuses it. Code never branches on a pack id.

NOTE: no `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

from datetime import UTC, datetime
from typing import Annotated, Any, cast

from fastapi import APIRouter, Depends

from app.auth.deps import (
    RECENT_SIGN_IN_SECONDS,
    AnyMember,
    OwnerOrAdmin,
    PrincipalDep,
    Runtime,
    get_runtime,
)
from app.errors import ApiError
from app.packs.models import (
    AccountSecurityOut,
    AuthProvidersOut,
    ExampleCountsOut,
    ExampleDataRemoveOut,
    ExampleDataStatusOut,
    LanguageReview,
    ModuleStateOut,
    PackListOut,
    WorkspaceModulesOut,
    WorkspacePackOut,
)
from app.packs.repository import PacksRepository

public_router = APIRouter(prefix="/v1", tags=["packs"])
router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["packs"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]


def _repo(runtime: Runtime) -> PacksRepository:
    if runtime.packs is None:
        raise ApiError(503, "packs_unavailable", "Business types are not available on this system.")
    return runtime.packs


@public_router.get("/packs", response_model=PackListOut)
def list_packs(runtime: RuntimeDep) -> PackListOut:
    if runtime.pack_registry is None:
        raise ApiError(503, "packs_unavailable", "Business types are not available on this system.")
    listed = runtime.pack_registry.selectable()
    if not listed.packs:
        raise ApiError(503, "packs_unavailable", "Business types are not available on this system.")
    return listed


@public_router.get("/auth/providers", response_model=AuthProvidersOut)
def auth_providers(runtime: RuntimeDep) -> AuthProvidersOut:
    return runtime.auth_providers or AuthProvidersOut(email=True, google=False, facebook=False)


@public_router.get("/account/security", response_model=AccountSecurityOut)
def account_security(principal: PrincipalDep, runtime: RuntimeDep) -> AccountSecurityOut:
    status: dict[str, Any] = {}
    if runtime.workspace is not None:
        try:
            status = runtime.workspace.account_security(principal.token)
        except Exception:  # the status is a convenience: the sign-in facts of the token below stand on their own
            status = {}
    provider = status.get("provider")
    return AccountSecurityOut(
        session_level="aal2" if principal.aal == "aal2" else "aal1",
        asked_at_sign_up=False,
        second_factor_on=status.get("second_factor_on") if isinstance(status.get("second_factor_on"), bool) else None,
        signed_in_at=datetime.fromtimestamp(principal.signed_in_at, tz=UTC) if principal.signed_in_at else None,
        recent_sign_in=principal.signed_in_within(RECENT_SIGN_IN_SECONDS),
        provider=provider if provider in ("email", "google", "facebook") else None,
        needed_for=["approvals", "whatsapp_connect", "rules_and_prices", "imports_and_exports", "team_and_privacy"],
    )


def _words(manifest: dict[str, Any], key: str) -> dict[str, str]:
    value = manifest.get(key)
    return {str(k): str(v) for k, v in value.items()} if isinstance(value, dict) else {}


def _has_example_data(manifest: dict[str, Any]) -> bool:
    sample = manifest.get("example_data")
    return isinstance(sample, dict) and any(isinstance(rows, list) and rows for rows in sample.values())


@router.get("/pack", response_model=WorkspacePackOut)
def get_pack(ctx: AnyMember, runtime: RuntimeDep) -> WorkspacePackOut:
    row = _repo(runtime).workspace_pack(ctx.principal.token, ctx.tenant.id)
    manifest = row.get("manifest") or {}
    labels = {lang: {str(k): str(v) for k, v in words.items()} for lang, words in (manifest.get("labels") or {}).items() if isinstance(words, dict)}
    return WorkspacePackOut(
        pack_id=row["pack_id"], version=row["version"], status=row["status"], validated=bool(row["validated"]), source=row["source"], chosen_at=row["chosen_at"],
        names=_words(manifest, "names"), summary=_words(manifest, "summary"), accent=manifest.get("accent", ""), owl_prop=manifest.get("owl_prop", ""),
        core_tab=manifest.get("core_tab", ""), modules=[str(m) for m in row.get("modules") or []], units=[str(u) for u in manifest.get("units") or []],
        default_unit=manifest.get("default_unit"), labels=labels, language_review=cast("dict[str, LanguageReview]", _words(manifest, "language_review")),
        has_example_data=_has_example_data(manifest),
    )  # fmt: skip


@router.get("/modules", response_model=WorkspaceModulesOut)
def get_modules(ctx: AnyMember, runtime: RuntimeDep) -> WorkspaceModulesOut:
    rows = _repo(runtime).workspace_modules(ctx.principal.token, ctx.tenant.id)
    return WorkspaceModulesOut(modules=[ModuleStateOut(module=r["module"], enabled=bool(r["enabled"]), reason="core" if r.get("reason") == "core" else "pack") for r in rows])


def _counts(raw: Any) -> ExampleCountsOut:
    src = raw if isinstance(raw, dict) else {}
    return ExampleCountsOut(**{k: int(src.get(k, 0) or 0) for k in ("companies", "contacts", "leads", "products")})


def _status(row: dict[str, Any]) -> ExampleDataStatusOut:
    return ExampleDataStatusOut(
        loaded=bool(row.get("loaded")), batch_id=row.get("batch_id"), pack_id=row.get("pack_id"), loaded_at=row.get("loaded_at"),
        removed_at=row.get("removed_at"), counts=_counts(row.get("counts")),
    )  # fmt: skip


@router.get("/example-data", response_model=ExampleDataStatusOut)
def example_status(ctx: AnyMember, runtime: RuntimeDep) -> ExampleDataStatusOut:
    return _status(_repo(runtime).example_status(ctx.principal.token, ctx.tenant.id))


@router.post("/example-data", response_model=ExampleDataStatusOut, status_code=201)
def example_load(ctx: OwnerOrAdmin, runtime: RuntimeDep) -> ExampleDataStatusOut:
    return _status(_repo(runtime).example_load(ctx.principal.token, ctx.tenant.id))


@router.post("/example-data/remove", response_model=ExampleDataRemoveOut)
def example_remove(ctx: OwnerOrAdmin, runtime: RuntimeDep) -> ExampleDataRemoveOut:
    row = _repo(runtime).example_remove(ctx.principal.token, ctx.tenant.id)
    return ExampleDataRemoveOut(batch_id=row.get("batch_id"), removed=_counts(row.get("removed")), kept=_counts(row.get("kept")))


__all__ = ["public_router", "router"]
