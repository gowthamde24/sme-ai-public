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


def make_client(
    repo: FakeRepository | None = None, crm: FakeCrmRepository | None = None
) -> tuple[TestClient, FakeRepository]:
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
        runtime=Runtime(verifier=verifier, repository=repo, crm=crm or FakeCrmRepository()),
    )
    return TestClient(app), repo


def auth(user: str | uuid.UUID, **overrides: Any) -> dict[str, str]:
    sub = USERS[user] if isinstance(user, str) else user
    return {"Authorization": "Bearer " + mint(KEY, claims(str(sub), **overrides))}


# ============================================================================ CRM fake
import datetime as _dt  # noqa: E402
from typing import Any as _Any  # noqa: E402

from app.crm.models import Page, decode_cursor  # noqa: E402,F401
from app.crm.repository import (  # noqa: E402
    ENTITIES,
    ConflictError,
    NotFoundError,
    payload_matches,
)

_SERVER_DEFAULTS: dict[str, dict[str, _Any]] = {
    "companies": {
        "type": "prospect",
        "website": None,
        "country": None,
        "region": None,
        "city": None,
        "industry": None,
        "tags": [],
    },
    "contacts": {
        "company_id": None,
        "email": None,
        "phone": None,
        "job_title": None,
        "email_consent": "unknown",
        "whatsapp_consent": "unknown",
        "phone_consent": "unknown",
        "suppressed_at": None,
        "suppression_reason": None,
    },
    "products": {
        "description": None,
        "unit": None,
        "category": None,
        "attributes": {},
        "active": True,
    },
    "leads": {
        "company_id": None,
        "contact_id": None,
        "owner_user_id": None,
        "status": "new",
        "source": None,
        "disqualified_reason": None,
    },
    "opportunities": {
        "contact_id": None,
        "lead_id": None,
        "owner_user_id": None,
        "status": "open",
        "lost_reason": None,
        "closed_at": None,
    },
}


class FakeCrmRepository:
    """In-memory CrmRepository: just enough behaviour to exercise the routes (the integration
    suite exercises the real database rules)."""

    def __init__(self) -> None:
        self.rows: dict[tuple[str, uuid.UUID], dict[uuid.UUID, _Any]] = {}
        self.tokens_seen: list[str] = []
        self.calls: list[tuple[str, str]] = []
        self._tick = 0
        self.rpc_error: Exception | None = None

    def _store(self, entity: str, tenant_id: uuid.UUID) -> dict[uuid.UUID, _Any]:
        return self.rows.setdefault((entity, tenant_id), {})

    def seed(self, entity: str, tenant_id: uuid.UUID, row_id: uuid.UUID, **fields: _Any) -> _Any:
        row, _ = self.create_row("seed", entity, tenant_id, {"id": str(row_id), **fields})
        return row

    def list_rows(
        self,
        token: str,
        entity: str,
        tenant_id: uuid.UUID,
        *,
        limit: int,
        cursor: tuple[str, uuid.UUID] | None,
        q: str | None,
        include_archived: bool,
    ) -> _Any:
        self.tokens_seen.append(token)
        self.calls.append(("list", entity))
        rows = sorted(
            self._store(entity, tenant_id).values(),
            key=lambda r: (r.created_at, r.id),
            reverse=True,
        )
        if not include_archived:
            rows = [r for r in rows if r.archived_at is None]
        if cursor is not None:
            c_at, c_id = cursor
            rows = [r for r in rows if (r.created_at.isoformat(), str(r.id)) < (c_at, str(c_id))]
        if q:
            rows = [r for r in rows if q.lower() in r.name.lower()]
        from app.crm.models import encode_cursor

        page = rows[:limit]
        nxt = encode_cursor(page[-1].created_at, page[-1].id) if len(rows) > limit else None
        return Page[_Any](items=page, next_cursor=nxt)

    def get_row(
        self, token: str, entity: str, tenant_id: uuid.UUID, row_id: uuid.UUID
    ) -> _Any | None:
        self.tokens_seen.append(token)
        self.calls.append(("get", entity))
        return self._store(entity, tenant_id).get(row_id)

    def create_row(
        self, token: str, entity: str, tenant_id: uuid.UUID, payload: dict[str, _Any]
    ) -> tuple[_Any, bool]:
        self.tokens_seen.append(token)
        self.calls.append(("create", entity))
        rid = uuid.UUID(payload["id"])
        existing = self._store(entity, tenant_id).get(rid)
        if existing is not None:
            if payload_matches(payload, existing.model_dump(mode="json")):
                return existing, False
            raise ConflictError("23505")
        if any(rid in rows for (e, t), rows in self.rows.items() if e == entity and t != tenant_id):
            raise ConflictError("23505")  # another tenant's id: the same generic conflict
        self._tick += 1
        base = {
            "id": rid,
            "created_by": None,
            "created_via": "manual",
            "created_at": _dt.datetime(2026, 1, 1, tzinfo=_dt.UTC)
            + _dt.timedelta(seconds=self._tick),
            "updated_at": _dt.datetime(2026, 1, 1, tzinfo=_dt.UTC),
            "archived_at": None,
            **_SERVER_DEFAULTS[entity],
            **{k: v for k, v in payload.items() if k not in ("id", "tenant_id")},
        }
        row = ENTITIES[entity].out.model_validate(base)
        self._store(entity, tenant_id)[rid] = row
        return row, True

    def update_row(
        self,
        token: str,
        entity: str,
        tenant_id: uuid.UUID,
        row_id: uuid.UUID,
        changes: dict[str, _Any],
    ) -> _Any:
        self.tokens_seen.append(token)
        self.calls.append(("update", entity))
        row = self._store(entity, tenant_id).get(row_id)
        if row is None:
            raise NotFoundError("x")
        updated = ENTITIES[entity].out.model_validate({**row.model_dump(mode="json"), **changes})
        self._store(entity, tenant_id)[row_id] = updated
        return updated

    def set_archived(
        self, token: str, entity: str, tenant_id: uuid.UUID, row_id: uuid.UUID, archived: bool
    ) -> _Any:
        stamp = _dt.datetime(2026, 2, 1, tzinfo=_dt.UTC).isoformat() if archived else None
        return self.update_row(token, entity, tenant_id, row_id, {"archived_at": stamp})

    def consent_rpc(self, token: str, function: str, args: dict[str, _Any]) -> uuid.UUID | None:
        self.tokens_seen.append(token)
        self.calls.append(("rpc", function))
        self.last_rpc = (function, args)
        if self.rpc_error is not None:
            raise self.rpc_error
        tenant, contact = uuid.UUID(args["p_tenant_id"]), uuid.UUID(args["p_contact_id"])
        if contact not in self._store("contacts", tenant):
            raise NotFoundError("P0002")
        return uuid.uuid4()
