"""The team's dedicated refusals (job BY, ADR 0077). Each carries NO text from the data layer: the API maps it to a fixed sentence (app/main.py)."""

from __future__ import annotations

from app.tenancy.repository import RepositoryError


class RoleNotAllowedError(RepositoryError):
    """SM242: this role cannot be invited, granted or changed by the caller (nobody is invited as Owner; an Admin cannot grant Admin)."""


class NoSuchMemberError(RepositoryError):
    """SM243: no such member (or no such invitation) in this workspace."""


class KeepOwnerError(RepositoryError):
    """SM244: the workspace must keep an Owner."""


class OwnRoleError(RepositoryError):
    """SM245: nobody changes their own role."""


class TooManyPendingError(RepositoryError):
    """SM246: too many pending invitations (20)."""


class AlreadyMemberError(RepositoryError):
    """SM247: the person is already a member (only told after the code was proven valid)."""


class InvitationNotPendingError(RepositoryError):
    """SM248: the invitation is not pending (already accepted)."""
