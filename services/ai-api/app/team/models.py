"""Request bodies of the team routes (job BY). Strict: an unknown field is a 422. There is no field for an Owner role and none that names a status."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from app.crm.models import ApiUuid, _Strict

InvitedRole = Literal["admin", "sales", "viewer"]
Reason = Literal["left", "role_changed", "no_longer_works_here", "access_no_longer_needed", "security_concern", "other"]


class CreateInvitationIn(_Strict):
    invitation_id: ApiUuid
    role: InvitedRole
    days: Annotated[int, Field(ge=1, le=30, strict=True)] = 7
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)] | None = None


class AcceptInvitationIn(_Strict):
    code: Annotated[str, StringConstraints(min_length=1, max_length=100)]


class ChangeRoleIn(_Strict):
    role: InvitedRole
    reason: Reason = "role_changed"


class RemoveMemberIn(_Strict):
    reason: Reason
