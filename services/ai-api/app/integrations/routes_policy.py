"""Terms and privacy-notice acceptance (job BI, ADR 0073).

  GET  /v1/policies/current           no sign-in: {terms: {version}, privacy: {version}}   (the sign-up page shows and sends these)
  GET  /v1/me/policy-acceptances      the signed-in person: {current, accepted: [{kind, version, accepted_at, via}], needs_acceptance: {terms, privacy}}
  POST /v1/me/policy-acceptances      {terms_version?, privacy_version?}: record that the person accepted the CURRENT version(s) (409 policy_version_outdated for any other); idempotent
  POST /v1/account/setup              also takes accepted_terms_version / accepted_privacy_version (see app/tenancy): recorded first, with via = setup
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import ConfigDict, StringConstraints

from app.auth.deps import PrincipalDep, Runtime, get_runtime
from app.crm.models import _Strict
from app.errors import ApiError
from app.integrations.policy import PolicyVersions

router = APIRouter(prefix="/v1", tags=["policy"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
Version = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$")]


class PolicyAcceptanceIn(_Strict):
    model_config = ConfigDict(extra="forbid")

    terms_version: Version | None = None
    privacy_version: Version | None = None


def versions_of(runtime: Runtime) -> PolicyVersions:
    return runtime.policies or PolicyVersions()


def record_acceptance(runtime: Runtime, token: str, terms: str | None, privacy: str | None, via: str) -> list[dict[str, Any]]:
    """Refuse any version that is not the current one, then record. Used by the standalone route and by the first-login setup."""
    if terms is None and privacy is None:
        raise ApiError(422, "validation_error", "Say which version you accepted.")
    if not versions_of(runtime).matches(terms, privacy):
        raise ApiError(409, "policy_version_outdated", "The terms or the privacy notice changed. Reload and read the current version.")
    if runtime.integrations is None:
        raise ApiError(503, "integrations_unavailable", "This is not available on this system.")
    return runtime.integrations.policy_accept(token, terms, privacy, via)


def status_of(runtime: Runtime, accepted: list[dict[str, Any]]) -> dict[str, Any]:
    current = versions_of(runtime)
    have = {(a["kind"], a["version"]) for a in accepted}
    return {
        "current": current.current(),
        "accepted": accepted,
        "needs_acceptance": {"terms": ("terms", current.terms) not in have, "privacy": ("privacy", current.privacy) not in have},
    }


@router.get("/policies/current")
def current_policies(runtime: RuntimeDep) -> dict[str, dict[str, str]]:
    return versions_of(runtime).current()


@router.get("/me/policy-acceptances")
def my_acceptances(principal: PrincipalDep, runtime: RuntimeDep) -> dict[str, Any]:
    if runtime.integrations is None:
        raise ApiError(503, "integrations_unavailable", "This is not available on this system.")
    return status_of(runtime, runtime.integrations.policy_mine(principal.token))


@router.post("/me/policy-acceptances")
def accept_policies(body: PolicyAcceptanceIn, principal: PrincipalDep, runtime: RuntimeDep) -> dict[str, Any]:
    accepted = record_acceptance(runtime, principal.token, body.terms_version, body.privacy_version, "prompt")
    return status_of(runtime, accepted)
