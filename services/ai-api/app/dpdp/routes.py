"""The DPDP routes (job DQ part 4, ADR 0104). The contract is docs/contracts/dpdp.md.

  PUBLIC (no sign-in)
    GET  /v1/privacy/notice          {privacy_version, terms_version, contact, grievance, retention, purposes}
    GET  /v1/privacy/subprocessors   {version, updated_on, wording, subprocessors: [...]}   the companies that process personal data, as data
    POST /v1/privacy/grievance       {grievance_id?, name, contact, kind, details, language?, captcha_token?}   -> 201 {reference, status, received_at, answer_due_on, answer_within_days}
    POST /v1/public/waitlist         {name, business_type, city, phone?, email?, language, marketing_opt_in, notice_version, captcha_token?}   -> 201 {status: joined} | 200 {status: already_joined}
  A SIGNED-IN PERSON
    GET  /v1/me/consents             the state of each purpose and the history
    PUT  /v1/me/consents/marketing   {given, via?}   give and withdraw are the same call
    GET  /v1/me/profile  ·  PUT /v1/me/profile {display_name}

No `from __future__ import annotations` here (request models are attached to the endpoint signatures at registration time)."""

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth.deps import PrincipalDep, Runtime, get_runtime
from app.dpdp.models import MarketingConsentIn, ProfileIn, PublicGrievanceIn, WaitlistIn
from app.dpdp.runtime import ANSWER_WITHIN_DAYS, DpdpRuntime
from app.errors import ApiError

logger = logging.getLogger("app.dpdp")
DATA = Path(__file__).resolve().parent / "data" / "subprocessors.json"

public_router = APIRouter(prefix="/v1", tags=["dpdp"])
me_router = APIRouter(prefix="/v1/me", tags=["dpdp"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]


@lru_cache(maxsize=1)
def subprocessors_document() -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(DATA.read_text(encoding="utf-8"))
    return loaded


def _dpdp(runtime: Runtime) -> DpdpRuntime:
    if runtime.dpdp is None:
        raise ApiError(503, "privacy_unavailable", "This is not available on this system.")
    return runtime.dpdp


def _versions(runtime: Runtime) -> tuple[str, str]:
    if runtime.policies is None:
        raise ApiError(503, "privacy_unavailable", "This is not available on this system.")
    current = runtime.policies.current()
    return current["privacy"]["version"], current["terms"]["version"]


def _address(request: Request) -> str:
    return request.client.host if request.client else "unknown"


# ------------------------------------------------------------------------------------------------ public
@public_router.get("/privacy/notice")
def notice(runtime: RuntimeDep) -> JSONResponse:
    dpdp = _dpdp(runtime)
    privacy, terms = _versions(runtime)
    body = {
        "privacy_version": privacy,
        "terms_version": terms,
        "contact": {"privacy_email": dpdp.privacy_email, "hello_email": dpdp.hello_email},
        "grievance": {"acknowledged": "at once", "answer_within_days": ANSWER_WITHIN_DAYS},
        "retention": {
            "lapsed_read_only_days": 90,
            "erasure_warning_hours": 48,
            "account_deletion_cancel_days": 7,
            "security_log_days": 365,
        },
        "purposes": [
            {"purpose": "service", "required": True},
            {"purpose": "marketing", "required": False, "default": "off"},
        ],
    }
    return JSONResponse(body, headers={"Cache-Control": "public, max-age=300"})


@public_router.get("/privacy/subprocessors")
def subprocessors() -> JSONResponse:
    return JSONResponse(subprocessors_document(), headers={"Cache-Control": "public, max-age=300"})


@public_router.post("/privacy/grievance")
def grievance(body: PublicGrievanceIn, request: Request, runtime: RuntimeDep) -> JSONResponse:
    dpdp = _dpdp(runtime)
    address = _address(request)
    dpdp.guard(address, body.contact, body.captcha_token)
    args = {
        "p_id": str(body.grievance_id) if body.grievance_id else dpdp.new_id(),
        "p_name": body.name,
        "p_contact": body.contact,
        "p_kind": body.kind,
        "p_details": body.details,
        "p_language": body.language,
    }
    answer = dpdp.repository.grievance_submit(args)
    replayed = bool(answer.pop("replayed", False))
    # never the person's words in a log: the reference and the kind only
    logger.info("grievance received reference=%s kind=%s replayed=%s", answer.get("reference"), body.kind, replayed)
    return JSONResponse(answer, status_code=200 if replayed else 201, headers={"Cache-Control": "no-store"})


@public_router.post("/public/waitlist")
def waitlist(body: WaitlistIn, request: Request, runtime: RuntimeDep) -> JSONResponse:
    dpdp = _dpdp(runtime)
    privacy, _ = _versions(runtime)
    if body.notice_version != privacy:
        raise ApiError(409, "policy_version_outdated", "The privacy notice has changed. Please read it again and send the form again.")
    dpdp.guard(address=_address(request), contact=body.email or body.phone or "", token=body.captcha_token)
    answer = dpdp.repository.waitlist_join(
        {
            "p_name": body.name,
            "p_business_type": body.business_type,
            "p_city": body.city,
            "p_phone": body.phone,
            "p_email": body.email,
            "p_language": body.language,
            "p_marketing_opt_in": body.marketing_opt_in,
            "p_notice_version": body.notice_version,
        }
    )
    logger.info("waitlist status=%s marketing=%s", answer.get("status"), body.marketing_opt_in)
    return JSONResponse(answer, status_code=201 if answer.get("status") == "joined" else 200, headers={"Cache-Control": "no-store"})


# ------------------------------------------------------------------------------------------------ the person
def _with_version(runtime: Runtime, answer: dict[str, Any]) -> dict[str, Any]:
    privacy, _ = _versions(runtime)
    return {"notice_version": privacy, **answer}


@me_router.get("/consents")
def consents(principal: PrincipalDep, runtime: RuntimeDep) -> JSONResponse:
    answer = _dpdp(runtime).repository.consents(principal.token)
    return JSONResponse(_with_version(runtime, answer), headers={"Cache-Control": "no-store"})


@me_router.put("/consents/marketing")
def set_marketing(body: MarketingConsentIn, principal: PrincipalDep, runtime: RuntimeDep) -> JSONResponse:
    privacy, _ = _versions(runtime)
    answer = _dpdp(runtime).repository.set_marketing(principal.token, body.given, body.via, privacy)
    return JSONResponse(_with_version(runtime, answer), headers={"Cache-Control": "no-store"})


@me_router.get("/profile")
def profile(principal: PrincipalDep, runtime: RuntimeDep) -> JSONResponse:
    return JSONResponse(_dpdp(runtime).repository.profile_get(principal.token), headers={"Cache-Control": "no-store"})


@me_router.put("/profile")
def set_profile(body: ProfileIn, principal: PrincipalDep, runtime: RuntimeDep) -> JSONResponse:
    return JSONResponse(_dpdp(runtime).repository.profile_set(principal.token, body.display_name), headers={"Cache-Control": "no-store"})
