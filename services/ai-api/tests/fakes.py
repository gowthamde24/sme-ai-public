"""In-memory TenantRepository that mimics what RLS exposes to the caller, plus app wiring."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from fastapi.testclient import TestClient

from app.auth.deps import Runtime
from app.auth.jwt import StaticKeyProvider, TokenVerifier
from app.config import Settings
from app.main import create_app
from app.tenancy.models import (
    AuditEventListOut,
    AuditEventOut,
    MemberListOut,
    MemberOut,
    MembershipOut,
    MeOut,
    Role,
    TenantOut,
)
from app.tenancy.repository import RepositoryError
from tests.keys import AUDIENCE, ISSUER, claims, make_ec_key, mint

KEY = make_ec_key()

TENANT_A = TenantOut(id=uuid.UUID(int=0xA), name="Tenant A", slug="tenant-a")
TENANT_B = TenantOut(id=uuid.UUID(int=0xB), name="Tenant B", slug="tenant-b")

USERS = {
    name: uuid.UUID(int=0x1000 + i)
    for i, name in enumerate(["a_owner", "a_admin", "a_sales", "a_viewer", "b_owner", "outsider"])
}


@dataclass
class FakeRepository:
    """Returns only what the calling user may see, like RLS. Records the token it was given."""

    memberships: dict[tuple[uuid.UUID, uuid.UUID], Role] = field(default_factory=dict)
    tenants: dict[uuid.UUID, TenantOut] = field(default_factory=dict)
    tokens_seen: list[str] = field(default_factory=list)
    membership_lookups: list[tuple[uuid.UUID, uuid.UUID]] = field(default_factory=list)
    raise_on_next: RepositoryError | None = None
    created: dict[str, tuple[uuid.UUID, TenantOut]] = field(default_factory=dict)

    def _maybe_raise(self) -> None:
        if self.raise_on_next is not None:
            err, self.raise_on_next = self.raise_on_next, None
            raise err

    def get_me(self, token: str, user_id: uuid.UUID) -> MeOut:
        self.tokens_seen.append(token)
        self._maybe_raise()
        return MeOut(
            user_id=user_id,
            memberships=[
                MembershipOut(tenant=self.tenants[t], role=r)
                for (u, t), r in self.memberships.items()
                if u == user_id
            ],
        )

    def get_membership(
        self, token: str, user_id: uuid.UUID, tenant_id: uuid.UUID
    ) -> MembershipOut | None:
        self.tokens_seen.append(token)
        self.membership_lookups.append((user_id, tenant_id))
        self._maybe_raise()
        role = self.memberships.get((user_id, tenant_id))
        return MembershipOut(tenant=self.tenants[tenant_id], role=role) if role else None

    def create_tenant(self, token: str, name: str, slug: str) -> TenantOut:
        self.tokens_seen.append(token)
        self._maybe_raise()
        if slug in self.created:
            return self.created[slug][1]
        tenant = TenantOut(id=uuid.uuid4(), name=name, slug=slug)
        self.created[slug] = (uuid.uuid4(), tenant)
        return tenant

    def list_members(self, token: str, tenant_id: uuid.UUID) -> MemberListOut:
        self.tokens_seen.append(token)
        self._maybe_raise()
        return MemberListOut(
            members=[
                MemberOut(user_id=u, role=r, display_name=None)
                for (u, t), r in self.memberships.items()
                if t == tenant_id
            ]
        )

    def list_audit_events(
        self, token: str, tenant_id: uuid.UUID, *, limit: int, before_id: int | None
    ) -> AuditEventListOut:
        self.tokens_seen.append(token)
        self._maybe_raise()
        event = AuditEventOut(
            id=1,
            actor_user_id=None,
            actor_type="system",
            action="tenant.create",
            entity_type="tenant",
            entity_id=tenant_id,
            old_values=None,
            new_values={"name": "Tenant A"},
            request_id=None,
            created_at=datetime(2026, 1, 1, tzinfo=UTC),
        )
        return AuditEventListOut(events=[event], next_before_id=None)


def seeded_repository() -> FakeRepository:
    repo = FakeRepository(tenants={TENANT_A.id: TENANT_A, TENANT_B.id: TENANT_B})
    repo.memberships = {
        (USERS["a_owner"], TENANT_A.id): Role.OWNER,
        (USERS["a_admin"], TENANT_A.id): Role.ADMIN,
        (USERS["a_sales"], TENANT_A.id): Role.SALES,
        (USERS["a_viewer"], TENANT_A.id): Role.VIEWER,
        (USERS["b_owner"], TENANT_B.id): Role.OWNER,
    }
    return repo


def make_client(repo: FakeRepository | None = None) -> tuple[TestClient, FakeRepository]:
    repo = repo or seeded_repository()
    verifier = TokenVerifier(
        issuer=ISSUER,
        audience=AUDIENCE,
        algorithms=("ES256",),
        asymmetric_keys=StaticKeyProvider(KEY.public_key()),
        hs256_secret=None,
    )
    app = create_app(
        Settings(_env_file=None, api_env="development"),  # type: ignore[call-arg]
        runtime=Runtime(verifier=verifier, repository=repo),
    )
    return TestClient(app), repo


def auth(user: str | uuid.UUID, **overrides: Any) -> dict[str, str]:
    sub = USERS[user] if isinstance(user, str) else user
    return {"Authorization": "Bearer " + mint(KEY, claims(str(sub), **overrides))}
