"""Tenant data access behind an interface (Supabase PostgREST today).

Every call carries the CALLER's JWT, so Postgres RLS decides what is visible or writable. This
layer has no privileged credential: only the public anon key, which identifies the project and
grants nothing on its own. Authorization is therefore enforced by the database even if a route
forgets a check.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Protocol

import httpx

from app.tenancy.models import (
    AuditEventListOut,
    AuditEventOut,
    MemberListOut,
    MemberOut,
    MembershipOut,
    MeOut,
    TenantOut,
    TenantPlanOut,
)

logger = logging.getLogger("app.tenancy.repository")


class RepositoryError(Exception):
    """Base class. Routes never see raw HTTP details from the data layer."""


class TokenRejected(RepositoryError):
    """The data layer refused the caller's token (e.g. it expired after we verified it)."""


class Forbidden(RepositoryError):
    pass


class MfaRequired(RepositoryError):
    """SM306: the database refused a privileged action to a password-only session (ADR 0016)."""


class InvalidInput(RepositoryError):
    pass


class SlugUnavailable(RepositoryError):
    pass


class WorkspaceLimitReached(RepositoryError):
    """SM307: the person already owns as many workspaces as their plan allows (job AD / D1)."""


class UpstreamError(RepositoryError):
    pass


class TenantRepository(Protocol):
    def get_me(self, token: str, user_id: uuid.UUID) -> MeOut: ...

    def get_membership(
        self, token: str, user_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> MembershipOut | None: ...

    def create_tenant(self, token: str, name: str, slug: str) -> TenantOut: ...

    def get_plan(self, token: str, tenant_id: uuid.UUID) -> TenantPlanOut: ...

    def list_members(self, token: str, tenant_id: uuid.UUID) -> MemberListOut: ...

    def list_audit_events(
        self, token: str, tenant_id: uuid.UUID, *, limit: int, before_id: int | None
    ) -> AuditEventListOut: ...


class PostgrestTenantRepository:
    def __init__(self, rest_url: str, anon_key: str, *, client: httpx.Client | None = None) -> None:
        self._anon_key = anon_key
        self._client = client or httpx.Client(
            base_url=rest_url, timeout=httpx.Timeout(10.0, connect=5.0)
        )

    def close(self) -> None:
        self._client.close()

    # ------------------------------------------------------------------ plumbing
    def _headers(self, token: str) -> dict[str, str]:
        return {
            "apikey": self._anon_key,
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
        }

    def _request(
        self,
        method: str,
        path: str,
        token: str,
        *,
        params: dict[str, str] | None = None,
        json: dict[str, Any] | None = None,
    ) -> Any:
        try:
            response = self._client.request(
                method, path, params=params, json=json, headers=self._headers(token)
            )
        except httpx.HTTPError as exc:
            logger.error("postgrest unreachable: %s", exc.__class__.__name__)
            raise UpstreamError("data layer unreachable") from exc

        if response.is_success:
            return response.json()

        code = ""
        try:
            body = response.json()
            if isinstance(body, dict):
                code = str(body.get("code", ""))
        except ValueError:
            pass

        if response.status_code == 401 or code.startswith("PGRST30"):
            raise TokenRejected(code or "401")
        if code == "SM307":
            raise WorkspaceLimitReached(code)
        if code == "23505":
            raise SlugUnavailable(code)
        if code in {"22023", "23514", "22P02"}:
            raise InvalidInput(code)
        if response.status_code == 403 or code == "42501":
            raise Forbidden(code or "403")
        logger.error("postgrest error status=%s code=%s", response.status_code, code)
        raise UpstreamError(f"unexpected data-layer response ({response.status_code})")

    # ------------------------------------------------------------------ reads
    def get_me(self, token: str, user_id: uuid.UUID) -> MeOut:
        rows = self._request(
            "GET",
            "/memberships",
            token,
            params={
                "select": "role,tenants(id,name,slug)",
                "user_id": f"eq.{user_id}",
                "order": "created_at.asc",
            },
        )
        return MeOut(
            user_id=user_id,
            memberships=[
                MembershipOut(tenant=TenantOut(**row["tenants"]), role=row["role"]) for row in rows
            ],
        )

    def get_membership(
        self, token: str, user_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> MembershipOut | None:
        rows = self._request(
            "GET",
            "/memberships",
            token,
            params={
                "select": "role,tenants(id,name,slug)",
                "user_id": f"eq.{user_id}",
                "tenant_id": f"eq.{tenant_id}",
                "limit": "1",
            },
        )
        if not rows:
            return None
        return MembershipOut(tenant=TenantOut(**rows[0]["tenants"]), role=rows[0]["role"])

    def get_plan(self, token: str, tenant_id: uuid.UUID) -> TenantPlanOut:
        rows = self._request(
            "GET",
            "/tenants",
            token,
            params={
                "select": "plan,workspace_limit,trial_started_at",
                "id": f"eq.{tenant_id}",
                "limit": "1",
            },
        )
        if not rows:  # a race with removal: the caller was a member a moment ago
            raise Forbidden("no tenant row")
        return TenantPlanOut(**rows[0])

    def list_members(self, token: str, tenant_id: uuid.UUID) -> MemberListOut:
        rows = self._request(
            "GET",
            "/memberships",
            token,
            params={
                "select": "user_id,role,users(display_name)",
                "tenant_id": f"eq.{tenant_id}",
                "order": "created_at.asc",
            },
        )
        return MemberListOut(
            members=[
                MemberOut(
                    user_id=row["user_id"],
                    role=row["role"],
                    display_name=(row.get("users") or {}).get("display_name"),
                )
                for row in rows
            ]
        )

    def list_audit_events(
        self, token: str, tenant_id: uuid.UUID, *, limit: int, before_id: int | None
    ) -> AuditEventListOut:
        params = {
            "select": (
                "id,actor_user_id,actor_type,action,entity_type,entity_id,"
                "old_values,new_values,request_id,created_at"
            ),
            "tenant_id": f"eq.{tenant_id}",
            "order": "id.desc",
            "limit": str(limit + 1),  # one extra row tells us whether another page exists
        }
        if before_id is not None:
            params["id"] = f"lt.{before_id}"
        rows = self._request("GET", "/audit_events", token, params=params)
        page = rows[:limit]
        return AuditEventListOut(
            events=[AuditEventOut(**row) for row in page],
            next_before_id=page[-1]["id"] if len(rows) > limit else None,
        )

    # ------------------------------------------------------------------ writes
    def create_tenant(self, token: str, name: str, slug: str) -> TenantOut:
        row = self._request(
            "POST", "/rpc/create_tenant", token, json={"p_name": name, "p_slug": slug}
        )
        return TenantOut(id=row["id"], name=row["name"], slug=row["slug"])
