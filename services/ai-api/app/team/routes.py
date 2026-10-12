"""The team under /v1 (job BY, ADR 0077): who is in the workspace, invitations by one-time code, role changes, removing and leaving.

  GET  /v1/tenants/{t}/team                                  any member   -> {members: [{user_id, display_name, role, joined_at, is_you}], pending_invitations}  (the count only for Owner/Admin)
  POST /v1/tenants/{t}/invitations                           Owner/Admin + 2FA   {invitation_id, role: admin|sales|viewer, days?: 1..30 (7), label?}   -> 201 {invitation: {..., code}}  (the code ONCE)
  GET  /v1/tenants/{t}/invitations                           Owner/Admin  -> {invitations: [...]}  (never a code)
  POST /v1/tenants/{t}/invitations/{id}/revoke               Owner/Admin + 2FA
  POST /v1/invitations/accept                                any signed-in person   {code}   -> {status: "joined", tenant_id, tenant_name, role}   (400 invitation_invalid, 429 invitation_locked)
  POST /v1/tenants/{t}/members/{user_id}/role                Owner/Admin + 2FA   {role, reason}
  POST /v1/tenants/{t}/members/{user_id}/remove              Owner/Admin + 2FA, or the person themselves ("left")   {reason}   -> counts of the open work tidied
The Owner role is never granted here (an Owner is added by the operator). Nothing here logs or returns a code after the one answer to its creation."""

from __future__ import annotations

import logging
import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.auth.deps import PrincipalDep, Runtime, TenantContext, get_runtime, require_tenant_role
from app.crm.models import parse_uuid
from app.errors import ApiError, not_found
from app.integrations.ratelimit import SlidingWindow
from app.team.models import AcceptInvitationIn, ChangeRoleIn, CreateInvitationIn, RemoveMemberIn
from app.team.repository import TeamRepository
from app.tenancy.models import Role

logger = logging.getLogger("app.team.audit")

router = APIRouter(prefix="/v1/tenants/{tenant_id}", tags=["team"])
public_router = APIRouter(prefix="/v1", tags=["team"])
RuntimeDep = Annotated[Runtime, Depends(get_runtime)]
AnyMember = Annotated[TenantContext, Depends(require_tenant_role())]
OwnerAdmin = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN))]
OwnerAdminStrong = Annotated[TenantContext, Depends(require_tenant_role(Role.OWNER, Role.ADMIN, strong=True))]

# the database locks a person after five wrong codes in an hour; this is a second, coarser fence per address (guessing from many accounts)
ACCEPT_PER_ADDRESS = SlidingWindow(30, 600)


def _team(runtime: Runtime) -> TeamRepository:
    if runtime.team is None:
        raise ApiError(503, "team_unavailable", "This is not available on this system.")
    return runtime.team


def _id(raw: str) -> uuid.UUID:
    parsed = parse_uuid(raw)
    if parsed is None:
        raise not_found()
    return parsed


@router.get("/team")
def get_team(ctx: AnyMember, runtime: RuntimeDep) -> dict[str, Any]:
    return _team(runtime).team(ctx.principal.token, ctx.tenant.id)


@router.post("/invitations", status_code=201)
def create_invitation(body: CreateInvitationIn, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> JSONResponse:
    invitation = _team(runtime).create_invitation(ctx.principal.token, ctx.tenant.id, uuid.UUID(str(body.invitation_id)), body.role, body.days, body.label)
    # who, which business, which invitation and role: never the code
    logger.info("invitation tenant=%s user=%s invitation=%s role=%s replayed=%s", ctx.tenant.id, ctx.principal.user_id, invitation.get("id"), invitation.get("role"), invitation.get("replayed"))
    return JSONResponse({"invitation": invitation}, status_code=201 if not invitation.get("replayed") else 200, headers={"Cache-Control": "no-store"})


@router.get("/invitations")
def list_invitations(ctx: OwnerAdmin, runtime: RuntimeDep) -> dict[str, Any]:
    return {"invitations": _team(runtime).list_invitations(ctx.principal.token, ctx.tenant.id)}


@router.post("/invitations/{invitation_id}/revoke")
def revoke_invitation(invitation_id: str, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> dict[str, Any]:
    return {"invitation": _team(runtime).revoke_invitation(ctx.principal.token, ctx.tenant.id, _id(invitation_id))}


@router.post("/members/{user_id}/role")
def change_role(user_id: str, body: ChangeRoleIn, ctx: OwnerAdminStrong, runtime: RuntimeDep) -> dict[str, Any]:
    return _team(runtime).change_role(ctx.principal.token, ctx.tenant.id, _id(user_id), body.role, body.reason)


@router.post("/members/{user_id}/remove")
def remove_member(user_id: str, body: RemoveMemberIn, ctx: AnyMember, runtime: RuntimeDep) -> dict[str, Any]:
    """Leaving ("left") is anyone's own; removing another person is the Owner's or an Admin's, with the second factor (the database asks)."""
    return _team(runtime).remove_member(ctx.principal.token, ctx.tenant.id, _id(user_id), body.reason)


@public_router.post("/invitations/accept")
def accept_invitation(body: AcceptInvitationIn, principal: PrincipalDep, runtime: RuntimeDep, request: Request) -> JSONResponse:
    address = request.client.host if request.client else "unknown"
    if not ACCEPT_PER_ADDRESS.allow(address):
        raise ApiError(429, "invitation_locked", "Too many tries. Wait a little and try again.")
    answer = _team(runtime).accept_invitation(principal.token, body.code)
    status = answer.get("status")
    if status == "locked":
        raise ApiError(429, "invitation_locked", "Too many wrong codes. Wait an hour and try again, or ask for a new code.")
    if status != "joined":
        raise ApiError(400, "invitation_invalid", "That code is not valid. Check it and try again, or ask for a new one.")
    logger.info("invitation accepted tenant=%s user=%s role=%s", answer.get("tenant_id"), principal.user_id, answer.get("role"))
    return JSONResponse(answer, headers={"Cache-Control": "no-store"})
