"""The team's data access behind an interface (job BY, ADR 0077): invitations by one-time code, role changes, removal. Every function is SECURITY DEFINER in migration 20261118090000 and checks the caller
itself, so a route that forgets a check still cannot do more than the database allows."""

from __future__ import annotations

import uuid
from typing import Any, Protocol

from app.rpc_base import RpcClient
from app.team import errors as e
from app.tenancy.repository import RepositoryError

ERRORS: dict[str, type[RepositoryError]] = {
    "SM242": e.RoleNotAllowedError,
    "SM243": e.NoSuchMemberError,
    "SM244": e.KeepOwnerError,
    "SM245": e.OwnRoleError,
    "SM246": e.TooManyPendingError,
    "SM247": e.AlreadyMemberError,
    "SM248": e.InvitationNotPendingError,
}


class TeamRepository(Protocol):
    def team(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]: ...
    def create_invitation(self, token: str, tenant_id: uuid.UUID, invitation_id: uuid.UUID, role: str, days: int, label: str | None) -> dict[str, Any]: ...
    def list_invitations(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]: ...
    def revoke_invitation(self, token: str, tenant_id: uuid.UUID, invitation_id: uuid.UUID) -> dict[str, Any]: ...
    def accept_invitation(self, token: str, code: str) -> dict[str, Any]: ...
    def change_role(self, token: str, tenant_id: uuid.UUID, user_id: uuid.UUID, role: str, reason: str) -> dict[str, Any]: ...
    def remove_member(self, token: str, tenant_id: uuid.UUID, user_id: uuid.UUID, reason: str) -> dict[str, Any]: ...


class PostgrestTeamRepository:
    def __init__(self, rest_url: str, anon_key: str, *, rpc: RpcClient | None = None) -> None:
        self._rpc = rpc or RpcClient(rest_url, anon_key, ERRORS)

    def team(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "team_members", {"p_tenant_id": str(tenant_id)})

    def create_invitation(self, token: str, tenant_id: uuid.UUID, invitation_id: uuid.UUID, role: str, days: int, label: str | None) -> dict[str, Any]:
        return self._rpc.object(token, "create_invitation", {"p_id": str(invitation_id), "p_tenant_id": str(tenant_id), "p_role": role, "p_days": days, "p_label": label})

    def list_invitations(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return self._rpc.array(token, "list_invitations", {"p_tenant_id": str(tenant_id)})

    def revoke_invitation(self, token: str, tenant_id: uuid.UUID, invitation_id: uuid.UUID) -> dict[str, Any]:
        return self._rpc.object(token, "revoke_invitation", {"p_tenant_id": str(tenant_id), "p_id": str(invitation_id)})

    def accept_invitation(self, token: str, code: str) -> dict[str, Any]:
        return self._rpc.object(token, "accept_invitation", {"p_code": code})

    def change_role(self, token: str, tenant_id: uuid.UUID, user_id: uuid.UUID, role: str, reason: str) -> dict[str, Any]:
        return self._rpc.object(token, "change_member_role", {"p_tenant_id": str(tenant_id), "p_user_id": str(user_id), "p_role": role, "p_reason": reason})

    def remove_member(self, token: str, tenant_id: uuid.UUID, user_id: uuid.UUID, reason: str) -> dict[str, Any]:
        return self._rpc.object(token, "remove_member", {"p_tenant_id": str(tenant_id), "p_user_id": str(user_id), "p_reason": reason})
