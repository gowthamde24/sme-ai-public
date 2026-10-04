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
    repo: FakeRepository | None = None,
    crm: FakeCrmRepository | None = None,
    evidence: FakeEvidenceRepository | None = None,
    leads: FakeLeadsRepository | None = None,
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
        runtime=Runtime(
            verifier=verifier,
            repository=repo,
            crm=crm or FakeCrmRepository(),
            evidence=evidence or FakeEvidenceRepository(),
            leads=leads or FakeLeadsRepository(),
        ),
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
        self.claims: dict[tuple[uuid.UUID, uuid.UUID], list[dict[str, _Any]]] = {}

    def seed_claim(
        self, tenant_id: uuid.UUID, company_id: uuid.UUID, predicate: str, value: str
    ) -> None:
        """A researched / imported fact about a company (newest last)."""
        self.claims.setdefault((tenant_id, company_id), []).append(
            {
                "id": str(uuid.uuid4()),
                "company_id": str(company_id),
                "predicate": predicate,
                "value": value,
                "confidence": "unverified",
            }
        )

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

    def list_claims(
        self, token: str, tenant_id: uuid.UUID, *, company_id: uuid.UUID
    ) -> list[dict[str, _Any]]:
        self.tokens_seen.append(token)
        self.calls.append(("claims", "list"))
        return list(reversed(self.claims.get((tenant_id, company_id), [])))  # newest first

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


# ============================================================================ evidence fake
from app.evidence.models import (  # noqa: E402
    HUMAN_PROVIDER,
    EvidenceLinkOut,
    derive_link_id,
)
from app.evidence.repository import retry_matches  # noqa: E402


class FakeEvidenceRepository:
    """In-memory EvidenceRepository (links with the evidence embedded), per tenant. Cross-tenant
    ids behave like RLS: invisible, and the same generic conflict on create."""

    def __init__(self) -> None:
        self.links: dict[uuid.UUID, dict[uuid.UUID, EvidenceLinkOut]] = {}
        self.targets: dict[
            uuid.UUID, tuple[uuid.UUID, str, uuid.UUID]
        ] = {}  # link -> (tenant, kind, target)
        self.tokens_seen: list[str] = []
        self.calls: list[str] = []
        self.payloads: list[dict[str, _Any]] = []
        self._tick = 0
        self.error: Exception | None = None

    def _store(self, tenant_id: uuid.UUID) -> dict[uuid.UUID, EvidenceLinkOut]:
        return self.links.setdefault(tenant_id, {})

    def _maybe_raise(self) -> None:
        if self.error is not None:
            err, self.error = self.error, None
            raise err

    def list_for_target(
        self,
        token: str,
        tenant_id: uuid.UUID,
        target_kind: str,
        target_id: uuid.UUID,
        *,
        limit: int,
        cursor: tuple[str, uuid.UUID] | None,
        include_archived: bool,
    ) -> _Any:
        self.tokens_seen.append(token)
        self.calls.append("list")
        self._maybe_raise()
        rows = [
            link
            for link_id, link in self._store(tenant_id).items()
            if self.targets[link_id][1:] == (target_kind, target_id)
        ]
        rows.sort(key=lambda r: (r.created_at, r.id), reverse=True)
        if not include_archived:
            rows = [r for r in rows if r.archived_at is None and r.evidence.archived_at is None]
        if cursor is not None:
            c_at, c_id = cursor
            rows = [r for r in rows if (r.created_at.isoformat(), str(r.id)) < (c_at, str(c_id))]
        from app.crm.models import encode_cursor

        page = rows[:limit]
        nxt = encode_cursor(page[-1].created_at, page[-1].id) if len(rows) > limit else None
        return Page[EvidenceLinkOut](items=page, next_cursor=nxt)

    def get_link(
        self, token: str, tenant_id: uuid.UUID, link_id: uuid.UUID
    ) -> EvidenceLinkOut | None:
        self.tokens_seen.append(token)
        self.calls.append("get")
        self._maybe_raise()
        return self._store(tenant_id).get(link_id)

    def create_for_target(
        self,
        token: str,
        tenant_id: uuid.UUID,
        target_kind: str,
        target_id: uuid.UUID,
        payload: dict[str, _Any],
    ) -> tuple[EvidenceLinkOut, bool]:
        self.tokens_seen.append(token)
        self.calls.append("create")
        self.payloads.append(payload)
        self._maybe_raise()
        evidence_id = uuid.UUID(payload["id"])
        link_id = derive_link_id(evidence_id, target_kind, target_id)
        existing = self._store(tenant_id).get(link_id)
        if existing is not None:
            if retry_matches(payload, existing):
                return existing, False
            raise ConflictError("23505")
        taken_here = any(x.evidence.id == evidence_id for x in self._store(tenant_id).values())
        taken_elsewhere = any(
            x.evidence.id == evidence_id
            for t, links in self.links.items()
            if t != tenant_id
            for x in links.values()
        )
        if taken_here or taken_elsewhere:
            raise ConflictError("23505")  # the same generic conflict either way
        self._tick += 1
        stamp = _dt.datetime(2026, 1, 1, tzinfo=_dt.UTC) + _dt.timedelta(seconds=self._tick)
        link = EvidenceLinkOut.model_validate(
            {
                "id": link_id,
                "company_id": target_id if target_kind == "company" else None,
                "lead_id": target_id if target_kind == "lead" else None,
                "claim_id": None,
                "stance": None,
                "created_by": None,
                "created_via": "manual",
                "created_at": stamp,
                "archived_at": None,
                "evidence": {
                    "id": evidence_id,
                    "kind": payload["kind"],
                    "provider": HUMAN_PROVIDER,
                    "url": payload.get("url"),
                    "reference": payload.get("reference"),
                    "snippet": payload.get("snippet"),
                    "retrieved_at": payload.get("retrieved_at", stamp),
                    "published_at": payload.get("published_at"),
                    "created_by": None,
                    "created_via": "manual",
                    "created_at": stamp,
                    "archived_at": None,
                },
            }
        )
        self._store(tenant_id)[link_id] = link
        self.targets[link_id] = (tenant_id, target_kind, target_id)
        return link, True

    def set_link_archived(
        self, token: str, tenant_id: uuid.UUID, link_id: uuid.UUID, archived: bool
    ) -> EvidenceLinkOut:
        self.tokens_seen.append(token)
        self.calls.append("archive" if archived else "restore")
        self._maybe_raise()
        link = self._store(tenant_id).get(link_id)
        if link is None:
            raise NotFoundError("x")
        stamp = _dt.datetime(2026, 2, 1, tzinfo=_dt.UTC) if archived else None
        updated = link.model_copy(update={"archived_at": stamp})
        self._store(tenant_id)[link_id] = updated
        return updated


# ========================================================================== Leads fake
import hashlib as _hashlib  # noqa: E402
import json as _json  # noqa: E402

from app.crm.models import RecordOrigin, encode_cursor  # noqa: E402
from app.leads.models import (  # noqa: E402
    ExportFormat,
    ExportKind,
    ExportRecordOut,
    IcpConfigOut,
    ImportBatchCounts,
    ImportBatchReport,
    ImportOutcome,
    ImportRowOutcome,
    LeadLabelOut,
    ReviewQueueLeadOut,
)


@dataclass
class FakeLeadsRepository:
    icp_configs: dict[uuid.UUID, list[IcpConfigOut]] = field(default_factory=dict)
    labels: dict[uuid.UUID, list[LeadLabelOut]] = field(default_factory=dict)
    exports: dict[uuid.UUID, list[ExportRecordOut]] = field(default_factory=dict)
    review_queue_leads: dict[uuid.UUID, list[ReviewQueueLeadOut]] = field(default_factory=dict)
    tokens_seen: list[str] = field(default_factory=list)
    calls: list[str] = field(default_factory=list)
    queue_calls: list[dict[str, Any]] = field(default_factory=list)
    label_list_viewers: list[uuid.UUID] = field(default_factory=list)
    raise_on_next: Exception | None = None

    def _maybe_raise(self) -> None:
        if self.raise_on_next is not None:
            err, self.raise_on_next = self.raise_on_next, None
            raise err

    def publish_icp_config(
        self, token: str, tenant_id: uuid.UUID, payload: dict[str, Any]
    ) -> IcpConfigOut:
        self.tokens_seen.append(token)
        self.calls.append("publish_icp_config")
        self._maybe_raise()
        configs = self.icp_configs.setdefault(tenant_id, [])
        v_no = len(configs) + 1
        raw_cfg = payload["config"]
        sha = _hashlib.sha256(_json.dumps(raw_cfg, sort_keys=True).encode()).hexdigest()
        cfg_out = IcpConfigOut(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            version_no=v_no,
            engine=payload.get("engine", "icp-rules"),
            schema_version=payload.get("schema_version", 1),
            config=raw_cfg,
            config_sha256=sha,
            created_by=None,
            created_via=RecordOrigin.MANUAL,
            created_at=_dt.datetime.now(_dt.UTC),
        )
        configs.append(cfg_out)
        return cfg_out

    def list_icp_configs(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        limit: int,
        cursor: tuple[str, uuid.UUID] | None,
    ) -> Page[IcpConfigOut]:
        self.tokens_seen.append(token)
        self.calls.append("list_icp_configs")
        self._maybe_raise()
        configs = list(reversed(self.icp_configs.get(tenant_id, [])))
        page = configs[:limit]
        nxt = encode_cursor(page[-1].created_at, page[-1].id) if len(configs) > limit else None
        return Page(items=page, next_cursor=nxt)

    def get_icp_config(
        self, token: str, tenant_id: uuid.UUID, version_id: uuid.UUID
    ) -> IcpConfigOut | None:
        self.tokens_seen.append(token)
        self.calls.append("get_icp_config")
        self._maybe_raise()
        for cfg in self.icp_configs.get(tenant_id, []):
            if cfg.id == version_id:
                return cfg
        return None

    def get_active_icp_config(self, token: str, tenant_id: uuid.UUID) -> IcpConfigOut | None:
        self.tokens_seen.append(token)
        self.calls.append("get_active_icp_config")
        self._maybe_raise()
        configs = self.icp_configs.get(tenant_id, [])
        return configs[-1] if configs else None

    def import_leads(
        self,
        token: str,
        tenant_id: uuid.UUID,
        batch_id: uuid.UUID,
        rows: list[dict[str, Any]],
        *,
        dry_run: bool,
        label: str | None,
    ) -> ImportBatchReport:
        self.tokens_seen.append(token)
        self.calls.append("import_leads")
        self._maybe_raise()
        outcomes = []
        for i, r in enumerate(rows):
            has_contact = bool(
                r.get("contact_name") or r.get("contact_email") or r.get("contact_phone")
            )
            outcomes.append(
                ImportRowOutcome(
                    row=i + 1,
                    outcome=ImportOutcome.CREATED,
                    company_created=True,
                    contact_created=has_contact,
                    attributes_written=0,
                    attributes_kept=0,
                    company_id=uuid.uuid4(),
                    contact_id=uuid.uuid4() if has_contact else None,
                    lead_id=uuid.uuid4(),
                )
            )
        contacts_num = sum(1 for o in outcomes if o.contact_created)
        counts = ImportBatchCounts(
            rows=len(rows),
            created=len(rows),
            skipped_duplicate=0,
            ambiguous=0,
            rejected=0,
            companies_created=len(rows),
            contacts_created=contacts_num,
            claims_created=0,
        )
        return ImportBatchReport(
            batch_id=batch_id if not dry_run else None,
            replayed=False,
            dry_run=dry_run,
            counts=counts,
            rows=outcomes,
        )

    def create_lead_label(
        self,
        token: str,
        tenant_id: uuid.UUID,
        lead_id: uuid.UUID,
        payload: dict[str, Any],
        score_snapshot: dict[str, Any] | None,
        icp_version_id: uuid.UUID | None,
    ) -> LeadLabelOut:
        self.tokens_seen.append(token)
        self.calls.append("create_lead_label")
        self._maybe_raise()
        label_out = LeadLabelOut(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            lead_id=lead_id,
            label=payload["label"],
            reason_code=payload.get("reason_code"),
            icp_version_id=icp_version_id,
            score=score_snapshot.get("score") if score_snapshot else None,
            score_max_reachable=(
                score_snapshot.get("score_max_reachable") if score_snapshot else None
            ),
            snapshot=score_snapshot,
            created_by=None,
            created_via=RecordOrigin.MANUAL,
            created_at=_dt.datetime.now(_dt.UTC),
        )
        self.labels.setdefault(tenant_id, []).append(label_out)
        return label_out

    def list_lead_labels(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        viewer_id: uuid.UUID,
        lead_id: uuid.UUID,
        limit: int,
        cursor: tuple[str, uuid.UUID] | None,
    ) -> Page[LeadLabelOut]:
        self.tokens_seen.append(token)
        self.calls.append("list_lead_labels")
        self.label_list_viewers.append(viewer_id)
        self._maybe_raise()
        lbls = [
            label_row
            for label_row in reversed(self.labels.get(tenant_id, []))
            if lead_id is None or label_row.lead_id == lead_id
        ]
        page = lbls[:limit]
        nxt = encode_cursor(page[-1].created_at, page[-1].id) if len(lbls) > limit else None
        return Page(items=page, next_cursor=nxt)

    def get_review_queue(
        self,
        token: str,
        tenant_id: uuid.UUID,
        *,
        caller_id: uuid.UUID,
        limit: int,
        cursor: tuple[str, uuid.UUID] | None,
        score_band: str | None,
        include_blind_scores: bool,
    ) -> Page[ReviewQueueLeadOut]:
        self.tokens_seen.append(token)
        self.calls.append("get_review_queue")
        self.queue_calls.append(
            {
                "caller_id": caller_id,
                "score_band": score_band,
                "include_blind_scores": include_blind_scores,
            }
        )
        self._maybe_raise()
        leads = self.review_queue_leads.get(tenant_id, [])
        if score_band:
            leads = [item for item in leads if item.score_band == score_band]
        page = leads[:limit]
        nxt = encode_cursor(page[-1].created_at, page[-1].lead_id) if len(leads) > limit else None
        return Page(items=page, next_cursor=nxt)

    def record_data_export(
        self,
        token: str,
        tenant_id: uuid.UUID,
        kind: str,
        export_format: str,
        row_count: int,
        content_sha256: str,
    ) -> ExportRecordOut:
        self.tokens_seen.append(token)
        self.calls.append("record_data_export")
        self._maybe_raise()
        rec = ExportRecordOut(
            id=uuid.uuid4(),
            tenant_id=tenant_id,
            kind=ExportKind(kind),
            format=ExportFormat(export_format),
            row_count=row_count,
            content_sha256=content_sha256,
            created_by=None,
            created_via=RecordOrigin.MANUAL,
            created_at=_dt.datetime.now(_dt.UTC),
        )
        self.exports.setdefault(tenant_id, []).append(rec)
        return rec

    def fetch_export_rows(
        self, token: str, tenant_id: uuid.UUID, kind: ExportKind
    ) -> list[dict[str, Any]]:
        self.tokens_seen.append(token)
        self.calls.append("fetch_export_rows")
        self._maybe_raise()
        lbls = self.labels.get(tenant_id, [])
        rows: list[dict[str, Any]] = []
        for label_row in lbls:
            rows.append(
                {
                    "lead_id": str(label_row.lead_id),
                    "company_name": "Test Co",
                    "company_city": "Bengaluru",
                    "lead_source": "manual",
                    "label": label_row.label.value,
                    "reason_code": label_row.reason_code.value if label_row.reason_code else "",
                    "score": label_row.score if label_row.score is not None else "",
                    "score_max_reachable": (
                        label_row.score_max_reachable
                        if label_row.score_max_reachable is not None
                        else ""
                    ),
                    "score_band": "priority" if (label_row.score or 0) >= 80 else "low_priority",
                    "created_at": label_row.created_at.isoformat(),
                }
            )
        return rows
