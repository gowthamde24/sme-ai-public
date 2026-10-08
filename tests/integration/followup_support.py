"""Shared helpers for the follow-up tests on the real stack (T010 part 2, ADR 0022): a lead with a keyed, consented contact made through OUR API (so the suppression keys are computed by the real
key ring), a cadence policy that makes the recipient's local clock read about noon NOW (so a test does not depend on the hour it runs), touches and drafts through OUR routes, and the operator
reads and plants (aging a lead, a touch at an exact time, invariants) that no client can do. All data is synthetic."""

# ruff: noqa: E501, S608, S603

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import httpx
import operator_sql
from conftest import User, bearer
from crm_support import Tenant, World
from evidence_support import pg, uid
from fastapi.testclient import TestClient


def noon_offset(now: datetime | None = None) -> int:
    """The fixed UTC offset (minutes) that makes the recipient's local clock read about 12:00 right now (the same rule as pgTAP 62's noon_offset)."""
    moment = (now or datetime.now(UTC)).astimezone(UTC)
    minute = moment.hour * 60 + moment.minute
    offset = (720 - minute + 1440) % 1440
    return offset - 1440 if offset > 840 else offset


def policy_body(**over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "id": uid(),
        "effective_from": operator_sql.sql("select app.quote_today()").strip(),
        "gap_days": [1, 2],
        "max_touches": 3,
        "quiet_start": "03:00",
        "quiet_end": "04:00",
        "allowed_weekdays": [0, 1, 2, 3, 4, 5, 6],
        "holidays": [],
        "min_gap_hours": 0,
        "recipient_utc_offset_minutes": noon_offset(),
    }
    body.update(over)
    return body


class Lead:
    def __init__(
        self, label: str, lead_id: str, contact_id: str, email: str | None, phone: str | None
    ) -> None:
        self.label, self.id, self.contact_id, self.email, self.phone = (
            label,
            lead_id,
            contact_id,
            email,
            phone,
        )

    def __repr__(self) -> str:
        return f"Lead({self.label})"


class FollowWorld:
    """One tenant of a World, with helpers that go through OUR API (the routes under test) and, where a client could not, the operator's SQL on the local stack."""

    def __init__(self, client: TestClient, w: World, tenant: Tenant) -> None:
        self.client, self.w, self.t = client, w, tenant
        self.owner, self.sales, self.viewer = (
            tenant.users[r] for r in ("owner", "sales", "viewer")
        )
        self.admin = tenant.users.get(
            "admin", self.owner
        )  # a workspace without an Admin (B) falls back to its Owner
        self.users = {
            "owner": self.owner,
            "admin": self.admin,
            "sales": self.sales,
            "viewer": self.viewer,
        }
        self.n = 0

    # ------------------------------------------------------------------------------ plumbing
    def url(self, path: str, tenant: Tenant | None = None) -> str:
        return f"/v1/tenants/{(tenant or self.t).id}{path}"

    def call(
        self,
        method: str,
        path: str,
        user: User | str | None,
        body: Any = None,
        *,
        tenant: Tenant | None = None,
        token: str | None = None,
    ) -> httpx.Response:
        who: User | None = self.users[user] if isinstance(user, str) else user
        bearer_token = token or (who.token if who is not None else None)
        headers = {} if bearer_token is None else {"Authorization": f"Bearer {bearer_token}"}
        r: httpx.Response = self.client.request(
            method, self.url(path, tenant), json=body, headers=headers
        )
        return r

    @staticmethod
    def sql(statement: str) -> str:
        return operator_sql.sql(statement).strip()

    # ------------------------------------------------------------------------------ people and leads
    def lead(
        self,
        label: str | None = None,
        *,
        consent: bool = True,
        email: bool = True,
        phone: bool = True,
        age_days: int = 30,
        phone_number: str | None = None,
        keyed: bool = True,
    ) -> Lead:
        """A contact and a lead made through our API (so the contact is keyed by the real key ring), consent granted for e-mail and WhatsApp, the lead aged `age_days` days."""
        self.n += 1
        label = label or f"fl{self.n}"
        cid, lid = uid(), uid()
        em = f"{label}-{uuid.uuid4().hex[:8]}@it.example.test" if email else None
        ph = phone_number or (f"+00 9{uuid.uuid4().int % 10**9:09d}" if phone else None)
        contact = {
            "id": cid,
            "full_name": f"Person {label}",
            "company_id": self.t.rows["companies"]["id"],
        }
        if em:
            contact["email"] = em
        if ph:
            contact["phone"] = ph
        if keyed:
            r = self.w.call(self.owner, "POST", self.t, "contacts", json=contact)
            assert r.status_code == 201, r.text
        else:  # straight through PostgREST: nothing computes a key, the contact stays UNKEYED
            r2 = pg(
                self.w.stack,
                self.owner,
                "POST",
                "/contacts",
                json={**contact, "tenant_id": self.t.id},
                representation=False,
            )
            assert r2.status_code == 201, r2.text
        made = self.w.call(
            self.owner,
            "POST",
            self.t,
            "leads",
            json={"id": lid, "company_id": self.t.rows["companies"]["id"], "contact_id": cid},
        )
        assert made.status_code == 201, made.text
        if consent:
            for channel in (("email",) if em else ()) + (("whatsapp",) if ph else ()):
                c = self.w.call(
                    self.owner,
                    "POST",
                    self.t,
                    "contacts",
                    f"/{cid}/record-consent",
                    json={
                        "channel": channel,
                        "status": "granted",
                        "basis": "explicit_consent",
                        "evidence_type": "web_form",
                        "evidence_ref": f"ref:{label}",
                    },
                )
                assert c.status_code == 200, c.text
        if age_days:
            self.sql(
                f"update public.leads set created_at = now() - interval '{age_days} days' where id = '{lid}'"
            )
        return Lead(label, lid, cid, em, ph)

    def suppress(
        self, lead: Lead, reason: str = "opted_out", user: str = "sales"
    ) -> httpx.Response:
        return self.w.call(
            self.users[user],
            "POST",
            self.t,
            "contacts",
            f"/{lead.contact_id}/suppress",
            json={"reason": reason, "evidence_type": "other", "evidence_ref": "ref:it"},
        )

    def archive_lead(self, lead: Lead) -> None:
        r = self.w.call(self.owner, "POST", self.t, "leads", f"/{lead.id}/archive")
        assert r.status_code == 200, r.text

    # ------------------------------------------------------------------------------ the policy
    def policy(self, **over: Any) -> str:
        body = policy_body(**over)
        r = self.call("POST", "/followup-policy-versions", self.owner, body)
        assert r.status_code in (200, 201), r.text
        return str(body["id"])

    # ------------------------------------------------------------------------------ touches and drafts (through OUR routes)
    def touch(
        self,
        user: User | str,
        lead: Lead,
        direction: str = "out",
        channel: str = "email",
        *,
        days_ago: float | None = None,
        touch_id: str | None = None,
    ) -> httpx.Response:
        body: dict[str, Any] = {"id": touch_id or uid(), "direction": direction, "channel": channel}
        # days_ago == 0 means "now": send no time, so the database stamps its OWN now() (public.record_touch refuses a stated time later than its clock, and the host clock can run a few ms ahead of
        # the Docker VM's). Any other offset is days in the past and cannot be later than the database's now().
        if days_ago is not None and days_ago != 0:
            body["occurred_at"] = (datetime.now(UTC) - timedelta(days=days_ago)).isoformat()
        return self.call("POST", f"/leads/{lead.id}/touches", user, body)

    def due_lead(self, label: str | None = None, *, outs: int = 1, **kw: Any) -> Lead:
        """A lead with `outs` outbound touches (5, 4, 3 ... days ago): due under the default policy."""
        lead = self.lead(label, **kw)
        for i in range(outs):
            r = self.touch("sales", lead, days_ago=5 - i)
            assert r.status_code == 201, r.text
        return lead

    def draft(
        self, user: User | str, lead: Lead, channel: str = "email", draft_id: str | None = None
    ) -> httpx.Response:
        return self.call(
            "POST",
            f"/leads/{lead.id}/followup-drafts",
            user,
            {"id": draft_id or uid(), "channel": channel},
        )

    def get_draft(self, draft_id: str, user: str = "owner") -> dict[str, Any]:
        r = self.call("GET", f"/followup-drafts/{draft_id}", user)
        assert r.status_code == 200, r.text
        return dict(r.json())

    def approve(self, user: User | str, draft_id: str, *, aal1: bool = False) -> httpx.Response:
        state_hash = self.get_draft(draft_id)["state_hash"]
        return self.call(
            "POST", f"/followup-drafts/{draft_id}/approve", user, {"state_hash": state_hash}
        )

    def sent(self, user: User | str, draft_id: str, touch_id: str | None = None) -> httpx.Response:
        return self.call(
            "POST", f"/followup-drafts/{draft_id}/sent", user, {"touch_id": touch_id or uid()}
        )

    def made_draft(self, lead: Lead, channel: str = "email") -> str:
        r = self.draft("sales", lead, channel)
        assert r.status_code == 201, r.text
        return str(r.json()["draft_id"])

    # ------------------------------------------------------------------------------ honest SQL for a held session (the request is built NOW from the recorded state, as the API does)
    def create_sql(self, lead: Lead, draft_id: str | None = None, channel: str = "email") -> str:
        from datetime import UTC as _utc  # noqa: N811

        from app.followups import cadence_port
        from app.followups.builder import build_request
        from app.followups.repository import PostgrestFollowupsRepository

        repo = PostgrestFollowupsRepository(self.w.stack.rest, self.w.stack.anon_key)
        try:
            snapshot = repo.lead_snapshot(
                self.owner.token, uuid.UUID(self.t.id), uuid.UUID(lead.id)
            )
        finally:
            repo.close()
        assert snapshot is not None
        request = build_request(snapshot, as_of=datetime.now(_utc))
        result = cadence_port.run_decide(request)
        return (
            f"select public.create_followup_draft('{draft_id or uid()}', '{lead.id}', '{channel}', '{cadence_port.cadence_version()}', "
            f"$q${cadence_port.canonical_json(request)}$q$, $q${cadence_port.canonical_json(result)}$q$)"
        )

    def approve_sql(self, draft_id: str) -> str:
        return f"select public.approve_followup_draft('{draft_id}', '{self.get_draft(draft_id)['state_hash']}')"

    def touch_sql(
        self,
        lead: Lead,
        direction: str = "out",
        channel: str = "email",
        touch_id: str | None = None,
    ) -> str:
        return f"select public.record_touch('{touch_id or uid()}', '{lead.id}', '{direction}', '{channel}', null)"

    def suppress_sql(self, lead: Lead, reason: str = "opted_out") -> str:
        return f"select public.suppress_contact('{self.t.id}', '{lead.contact_id}', '{reason}', 'other', 'ref:it')"

    def key_of(self, lead: Lead, kind: str = "email") -> str:
        return self.sql(
            f"select {kind}_hmac from suppression.contact_keys where contact_id = '{lead.contact_id}'"
        )

    def erase_request(self, lead: Lead) -> str:
        """A pending contact-erasure request (returns its id); executing it is a separate step."""
        rid = uid()
        r = httpx.post(
            f"{self.w.stack.rest}/rpc/request_erasure",
            headers=self.w.stack.headers(self.owner.token),
            json={
                "p_request_id": rid,
                "p_tenant_id": self.t.id,
                "p_scope": "contact",
                "p_subject_id": lead.contact_id,
            },
            timeout=60,
        )
        assert r.status_code == 200, r.text
        return rid

    def execute_erasure(self, request_id: str) -> httpx.Response:
        return httpx.post(
            f"{self.w.stack.rest}/rpc/execute_erasure",
            headers=self.w.stack.headers(self.owner.token),
            json={"p_request_id": request_id, "p_dry_run": False},
            timeout=120,
        )

    # ------------------------------------------------------------------------------ the operator's view
    def drafts_of(self, lead: Lead) -> list[dict[str, Any]]:
        raw = self.sql(
            f"select coalesce(json_agg(d order by created_at), '[]') from (select id, touch_number, status, discard_code, channel, created_at from public.followup_drafts where lead_id = '{lead.id}') d"
        )
        return list(json.loads(raw))

    def touches_of(self, lead: Lead) -> list[dict[str, Any]]:
        raw = self.sql(
            f"select coalesce(json_agg(t order by occurred_at, id), '[]') from (select id, direction, channel, occurred_at, draft_id from public.lead_touches where lead_id = '{lead.id}') t"
        )
        return list(json.loads(raw))

    def plant_touch(
        self,
        lead: Lead,
        direction: str,
        occurred_sql: str,
        *,
        recorded_sql: str | None = None,
        touch_id: str | None = None,
        channel: str = "email",
    ) -> str:
        """A touch at an exact time, written the way only the operator can (the functions bound the time): `occurred_sql` is a SQL timestamp expression."""
        tid = touch_id or uid()
        self.sql(
            f"insert into public.lead_touches (id, tenant_id, lead_id, contact_id, direction, channel, occurred_at, recorded_at) "
            f"select '{tid}', tenant_id, id, contact_id, '{direction}', '{channel}', {occurred_sql}, {recorded_sql or 'now()'} from public.leads where id = '{lead.id}'"
        )
        return tid

    def invariants(self) -> None:
        """The follow-up tables of THIS tenant agree with themselves: nothing open for a suppressed or erased contact, one active draft per touch, every recorded draft has its touch."""
        t = self.t.id
        checks = {
            "open draft for a suppressed or erased contact": f"select count(*) from public.followup_drafts d join public.contacts c on c.id = d.contact_id where d.tenant_id = '{t}' and d.status in ('draft', 'approved') and (c.suppressed_at is not null or c.erased_at is not null)",
            "two active drafts for one touch": f"select count(*) from (select lead_id, touch_number from public.followup_drafts where tenant_id = '{t}' and status in ('draft', 'approved') group by 1, 2 having count(*) > 1) x",
            "a recorded draft without its touch": f"select count(*) from public.followup_drafts d where d.tenant_id = '{t}' and d.status = 'recorded_sent' and not exists (select 1 from public.lead_touches x where x.draft_id = d.id)",
            "a touch naming a draft that is not recorded": f"select count(*) from public.lead_touches x where x.tenant_id = '{t}' and x.draft_id is not null and not exists (select 1 from public.followup_drafts d where d.id = x.draft_id and d.status = 'recorded_sent')",
            "a discarded draft without a reason": f"select count(*) from public.followup_drafts where tenant_id = '{t}' and status = 'discarded' and discard_code is null",
            "an approved draft without its approver": f"select count(*) from public.followup_drafts where tenant_id = '{t}' and status in ('approved', 'recorded_sent') and (approved_at is null or approved_by is null)",
            "an outbound touch before its lead's earlier outbound touch": f"select count(*) from (select occurred_at, max(occurred_at) over (partition by lead_id order by recorded_at, id rows between unbounded preceding and 1 preceding) as m, direction from public.lead_touches where tenant_id = '{t}') x where x.direction = 'out' and x.m is not null and x.occurred_at < x.m",
        }
        for name, query in checks.items():
            assert self.sql(query) == "0", name


__all__ = ["FollowWorld", "Lead", "bearer", "noon_offset", "policy_body"]
