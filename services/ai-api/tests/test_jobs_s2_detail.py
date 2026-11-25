"""Jobs, slice S2: the job view (jobs contract 1.0 sections 1 to 3, 14 to 16; docs/contracts/jobs-detail.md). With fakes of every subsystem the job reads and writes through (no database): GET /jobs/{id} for every kind, every setting of the
catalogue read and written through its subsystem's own function, the switch (pause and resume), the name and what the helper asks, the real needs_you, the role matrix, the 404 and 422 paths and the ETag."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.assistant_settings import data as assistant_data
from app.assistant_settings.models import AssistantSettings, AssistantSettingsRead
from app.assistant_status.service import HeldBySupportError, NotReadyError
from app.jobs import catalogue, listing
from app.jobs.trust import REFUSALS, JobsRefused
from app.jobs.wiring import JobsRuntime
from app.outreach import models as om
from app.tenancy.repository import MfaRequired
from tests.fakes import TENANT_A, TENANT_B, auth, make_client

PACKS = Path(__file__).resolve().parents[3] / "packages" / "packs"
A = TENANT_A.id
JOBS = f"/v1/tenants/{A}/jobs"
KINDS = listing.KINDS
CUSTOMER = uuid.UUID(int=0xC1)


def url(kind: str) -> str:
    return f"{JOBS}/{listing.job_id(A, kind)}"


# ------------------------------------------------------------------------------------------------------------------ the fakes: each one keeps what it was told, like the real subsystem keeps its rows
def rule(n: int = 1, *, active: bool = True, reason: str | None = None, within: int = 0, channel: str = "call", language: str = "auto") -> Any:
    return SimpleNamespace(id=uuid.UUID(int=0x500 + n), source=f"src{n}", action="call_within_minutes", within_minutes=within, goal="general", channel=channel, language=language, questions=["Which item?"],
                           wa_first_template=None, wa_missed_template=None, max_calls_per_day=None, max_total_minutes=None, active=active, paused_reason=reason)


class Outreach:
    def __init__(self, *rules: Any, steps: list[dict[str, int]] | None = None) -> None:
        self.rows = list(rules)
        self.pol = SimpleNamespace(retry_steps=steps if steps is not None else [{"after_minutes": 10}, {"after_minutes": 120}, {"next_morning_minute": 600}])
        self.calls: list[tuple[str, Any]] = []
        self.refuse: Exception | None = None

    def rules(self, token: str, tenant_id: uuid.UUID) -> list[Any]:
        return list(self.rows)

    def policy(self, token: str, tenant_id: uuid.UUID) -> Any:
        return self.pol

    def policy_save(self, token: str, tenant_id: uuid.UUID, body: om.PolicyIn) -> Any:
        self.calls.append(("policy_save", body.as_settings()))
        if self.refuse:
            raise self.refuse
        self.pol.retry_steps = [dict(s) for s in body.as_settings()["retry_steps"]]
        return self.pol

    def rule_save(self, token: str, tenant_id: uuid.UUID, body: om.RuleIn) -> Any:
        self.calls.append(("rule_save", body.as_document()))
        if self.refuse:
            raise self.refuse
        row = next(r for r in self.rows if r.id == body.rule_id)
        row.within_minutes, row.channel, row.language = body.within_minutes, body.channel, body.language
        return row

    def rule_state(self, token: str, tenant_id: uuid.UUID, rule_id: uuid.UUID, action: str) -> Any:
        self.calls.append(("rule_state", (str(rule_id), action)))
        row = next(r for r in self.rows if r.id == rule_id)
        row.active, row.paused_reason = (action == "resume"), (None if action == "resume" else "owner")
        return row

    def report(self, token: str, tenant_id: uuid.UUID, start: Any, end: Any) -> Any:
        return SimpleNamespace(total=SimpleNamespace(calls=10, connected_rate=0.5, bookings=2))


class Status:
    def __init__(self, live: bool = True, held: bool = False) -> None:
        self.live, self.held, self.calls = live, held, []   # type: ignore[var-annotated]
        self.refuse: Exception | None = None

    def status(self, token: str, tenant_id: uuid.UUID) -> Any:
        return SimpleNamespace(state="live" if self.live else "in_training", held_by_support=self.held, missing=["phone_number"], can_go_live=True)

    def go_live(self, token: str, tenant_id: uuid.UUID) -> Any:
        self.calls.append("go_live")
        if self.refuse:
            raise self.refuse
        self.live = True

    def pause(self, token: str, tenant_id: uuid.UUID) -> Any:
        self.calls.append("pause")
        self.live = False


class Numbers:
    def line(self, token: str, tenant_id: uuid.UUID) -> Any:
        return SimpleNamespace(number="+912212345678", inbound_on=True)


class AssistantSettings_:
    """Settings > AI assistant: get (the saved settings, a name of its own) and save (the whole document)."""

    def __init__(self, saved: bool = True) -> None:
        self.read = AssistantSettingsRead.model_validate({**assistant_data.defaults_for(None), "name": "Priya", "main_language": "te", "call_from_minute": 600, "call_to_minute": 1260, "call_days": [1, 2, 3, 4, 5, 6]})
        self.saved, self.saves = saved, []   # type: ignore[var-annotated]

    def get(self, token: str, tenant_id: uuid.UUID) -> Any:
        return SimpleNamespace(settings=self.read, saved=self.saved)

    def save(self, token: str, tenant_id: uuid.UUID, body: AssistantSettings) -> Any:
        self.saves.append(body)
        self.read = AssistantSettingsRead.model_validate(body.model_dump())


def week(open_: str = "10:00", close: str = "20:30") -> dict[str, Any]:
    return {d: ({"open": open_, "close": close} if d != "sun" else None) for d in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")}


class Visits:
    def __init__(self, default: bool = False) -> None:
        self.raw: dict[str, Any] = {"weekly_hours": week(), "closed_dates": [], "slot_minutes": 30, "max_parallel": 2, "buffer_minutes": 0, "staff_count": 0, "is_default": default}
        self.saved: list[dict[str, Any]] = []

    def settings_get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return dict(self.raw)

    visits: list[dict[str, Any]] = []   # replaced per test

    def list_visits(self, token: str, tenant_id: uuid.UUID, *, date_from: Any, date_to: Any, open_only: bool, status: Any, lead_id: Any, visit_id: Any) -> dict[str, Any]:
        return {"from": date_from, "to": date_to, "items": list(self.visits)}

    def settings_set(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]:
        self.saved.append(args)
        self.raw = {**self.raw, "weekly_hours": args["p_weekly_hours"], "closed_dates": args["p_closed_dates"], "slot_minutes": args["p_slot_minutes"], "max_parallel": args["p_max_parallel"], "buffer_minutes": args["p_buffer_minutes"], "is_default": False}
        return dict(self.raw)


class Followups:
    """The follow-up policy: the latest version first, a new version on every save."""

    def __init__(self, none: bool = False) -> None:
        self.versions: list[dict[str, Any]] = [] if none else [{"id": str(uuid.uuid4()), "version_no": 1, "effective_from": "2026-01-01", "gap_days": [3, 3], "max_touches": 3, "quiet_start": "21:00:00", "quiet_end": "09:00:00", "allowed_weekdays": [0, 1, 2, 3, 4, 5], "holidays": [], "min_gap_hours": 24, "recipient_utc_offset_minutes": 330, "created_at": "2026-01-01T00:00:00+00:00"}]
        self.saved: list[dict[str, Any]] = []

    def list_policies(self, token: str, tenant_id: uuid.UUID, *, limit: int) -> list[dict[str, Any]]:
        return self.versions[:limit]

    drafts: list[dict[str, Any]] = []   # replaced per test

    def list_drafts(self, token: str, tenant_id: uuid.UUID, *, lead_id: Any, status: Any, limit: int) -> list[dict[str, Any]]:
        return list(self.drafts)

    def create_policy(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        self.saved.append(args)
        p = args["p_policy"]
        self.versions.insert(0, {"id": args["p_version_id"], "version_no": len(self.versions) + 1, "effective_from": args["p_effective_from"], "gap_days": p["gap_days"], "max_touches": p["max_touches"], "quiet_start": p["quiet_hours"]["start"], "quiet_end": p["quiet_hours"]["end"],
                                "allowed_weekdays": p["allowed_weekdays"], "holidays": p["holidays"], "min_gap_hours": p["min_gap_hours"], "recipient_utc_offset_minutes": p["recipient_utc_offset_minutes"], "created_at": "2026-11-20T00:00:00+00:00"})
        return {"version_id": args["p_version_id"], "version_no": len(self.versions), "effective_from": args["p_effective_from"], "replayed": False}


class Campaigns:
    def __init__(self, *rows: dict[str, Any]) -> None:
        self.rows = [dict(r) for r in rows]
        self.calls: list[tuple[str, Any]] = []

    def list_campaigns(self, token: str, tenant_id: uuid.UUID, status: Any, limit: int, after: Any) -> list[dict[str, Any]]:
        return [dict(r) for r in self.rows]

    def set_state(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, action: str) -> dict[str, Any]:
        self.calls.append(("set_state", (str(campaign_id), action)))
        row = next(r for r in self.rows if r["id"] == str(campaign_id))
        row["status"] = "paused" if action == "pause" else "running"
        return row

    def results(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID) -> dict[str, Any]:
        return {"by_state": {"sent": 3, "delivered": 5, "read": 2, "failed": 1}, "replied": 4}

    def offer_set(self, token: str, tenant_id: uuid.UUID, campaign_id: uuid.UUID, label: str, weekly_cap: int) -> dict[str, Any]:
        self.calls.append(("offer_set", (str(campaign_id), label, weekly_cap)))
        row = next(r for r in self.rows if r["id"] == str(campaign_id))
        row["weekly_cap"] = weekly_cap
        return {"campaign": row, "back_to_draft": False}


def offer(status: str = "draft", cap: int = 1, n: int = 1) -> dict[str, Any]:
    return {"id": str(uuid.UUID(int=0x700 + n)), "kind": "offer", "status": status, "weekly_cap": cap, "offer_label": "Diwali"}


class Finder:
    def __init__(self) -> None:
        self.s = SimpleNamespace(fit_bar=70, results_per_search=10, daily_call_cap=20, call_from_hour=10, call_to_hour=18, searches_per_day=2)
        self.saved: list[dict[str, Any]] = []

    def availability(self, token: str, tenant_id: uuid.UUID) -> Any:
        return SimpleNamespace(reason="ok", available=True, access="available")

    def settings(self, token: str, tenant_id: uuid.UUID) -> Any:
        return self.s

    found: list[Any] = []   # replaced per test

    def searches(self, token: str, tenant_id: uuid.UUID, limit: int) -> Any:
        return SimpleNamespace(items=list(self.found))

    def set_settings(self, token: str, tenant_id: uuid.UUID, body: Any) -> Any:
        changes = body.model_dump(exclude_none=True)
        self.saved.append(changes)
        for k, v in changes.items():
            setattr(self.s, k, v)
        return self.s


class Training:
    """Talk training: the saved document, or nothing saved."""

    def __init__(self, doc: dict[str, Any] | None = None) -> None:
        self.doc, self.saved = doc, []   # type: ignore[var-annotated]

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        return {"doc": self.doc, "updated_at": None} if self.doc is not None else None

    def save(self, token: str, tenant_id: uuid.UUID, doc: dict[str, Any]) -> dict[str, Any]:
        self.saved.append(doc)
        self.doc = doc
        return {"doc": doc}


class Workspace:
    def opening(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return {"mention_ai": False, "lines": [], "campaign_overrides": []}


class Trust:
    """jobs_meta (one row per kind, made on first need) and the FAQs hung on it."""

    def __init__(self) -> None:
        self.rows: dict[str, dict[str, Any]] = {}
        self.refuse: dict[str, Exception] = {}
        self.calls: list[tuple[str, Any]] = []
        self.faqs: list[dict[str, Any]] = []

    def meta_list(self, token: str, tenant_id: uuid.UUID) -> list[dict[str, Any]]:
        return list(self.rows.values())

    def meta_ensure(self, token: str, tenant_id: uuid.UUID, kind: str) -> dict[str, Any]:
        self.calls.append(("ensure", kind))
        return self.rows.setdefault(kind, {"id": str(uuid.UUID(int=0x900 + len(self.rows))), "kind": kind, "custom_name": None, "finds_out": {}, "enabled": True})

    def _row(self, meta_id: uuid.UUID) -> dict[str, Any]:
        return next(r for r in self.rows.values() if r["id"] == str(meta_id))

    def meta_set_name(self, token: str, tenant_id: uuid.UUID, meta_id: uuid.UUID, name: str | None) -> dict[str, Any]:
        self.calls.append(("name", name))
        if "name" in self.refuse:
            raise self.refuse["name"]
        self._row(meta_id)["custom_name"] = name
        return self._row(meta_id)

    def meta_set_enabled(self, token: str, tenant_id: uuid.UUID, meta_id: uuid.UUID, enabled: bool) -> dict[str, Any]:
        self.calls.append(("enabled", enabled))
        self._row(meta_id)["enabled"] = enabled
        return self._row(meta_id)

    def meta_set_finds_out(self, token: str, tenant_id: uuid.UUID, meta_id: uuid.UUID, finds_out: dict[str, bool]) -> dict[str, Any]:
        self.calls.append(("finds_out", finds_out))
        self._row(meta_id)["finds_out"] = {**self._row(meta_id)["finds_out"], **finds_out}
        return self._row(meta_id)

    def faq_list(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID) -> list[dict[str, Any]]:
        self.calls.append(("faq_list", str(job_id)))
        return [f for f in self.faqs if f["job_id"] == str(job_id)]

    def faq_add(self, token: str, tenant_id: uuid.UUID, job_id: uuid.UUID, faq_id: uuid.UUID, question: str, answer: str) -> dict[str, Any]:
        self.calls.append(("faq_add", str(job_id)))
        faq = {"id": str(faq_id), "job_id": str(job_id), "question": question, "answer": answer, "created_at": "2026-11-20T10:00:00+00:00", "updated_at": "2026-11-20T10:00:00+00:00"}
        self.faqs.append(faq)
        return faq


class Today:
    def __init__(self, *items: tuple[str, str]) -> None:
        self.items = items

    def today_summary(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        rows = [{"kind": kind, "id": str(uuid.UUID(int=0xD00 + i)), "customer": "Ravi", "city": None, "agent": "followup_desk", "ref": "x", "at": "2026-11-20T10:00:00+00:00", "amount_paise": None, "target": {"type": target, "id": str(CUSTOMER)}} for i, (kind, target) in enumerate(self.items)]
        return {"cards": {"waiting": len(rows), "money_held_paise": 0, "orders_open": 0}, "needs_you": rows, "recent": []}


class Billing:
    def usage(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return {"call_minutes": {"used": 12.3, "allowance": 60}, "whatsapp_messages": {"used": 4, "allowance": 100}}

    def ensure(self, token: str, tenant_id: uuid.UUID, kind: str) -> None:
        return None


class World:
    """Every subsystem the jobs read and write through, as fakes that keep what they are told."""

    def __init__(self, *, on: bool = True, outreach: Outreach | None = None, offers: tuple[dict[str, Any], ...] = (), today: Today | None = None, followups_none: bool = False, visits_default: bool = False, assistant_saved: bool = True,
                 live: bool = True, doc: dict[str, Any] | None = None, billing: bool = True, crm: Any = None, calls: Any = None) -> None:
        self.outreach = outreach or Outreach(rule(1), rule(2))
        self.status, self.assistant, self.visits, self.followups, self.campaigns = Status(live), AssistantSettings_(assistant_saved), Visits(visits_default), Followups(followups_none), Campaigns(*offers)
        self.finder, self.training, self.trust, self.today = Finder(), Training(doc), Trust(), today
        self.client, _ = make_client(jobs=JobsRuntime(directory=PACKS, trust=self.trust) if on else None, calls=calls, outreach=self.outreach, assistant_status=self.status, phone_numbers=Numbers(), assistant_settings=self.assistant, visits=self.visits,  # type: ignore[arg-type]
                                     followups=self.followups, campaigns=self.campaigns, lead_finder=self.finder, talk_training=self.training, workspace=Workspace(), today=self.today, billing=Billing() if billing else None, **({"crm": crm} if crm is not None else {}))  # type: ignore[arg-type]

    def get(self, kind: str, user: str | None = "a_owner") -> Any:
        return self.client.get(url(kind), headers=auth(user) if user else {})

    def patch(self, kind: str, body: Any, user: str = "a_owner", **claims: Any) -> Any:
        return self.client.patch(url(kind), json=body, headers=auth(user, **claims))

    def post(self, kind: str, action: str, user: str = "a_owner") -> Any:
        return self.client.post(f"{url(kind)}/{action}", headers=auth(user))


def writes(w: World) -> list[tuple[str, Any]]:
    return [c for c in w.trust.calls if c[0] in ("ensure", "name", "finds_out", "enabled")]


def setting(body: dict[str, Any], key: str) -> dict[str, Any]:
    return next(s for s in body["settings"]["main"] + body["settings"]["more"] if s["key"] == key)


# ------------------------------------------------------------------------------------------------------------------ off, ids, roles
@pytest.mark.parametrize("method", ["get", "patch", "post_pause", "post_resume"])
def test_with_jobs_off_the_job_page_routes_are_404(method: str) -> None:
    w = World(on=False)
    path = url("offers")
    r = {"get": lambda: w.client.get(path, headers=auth("a_owner")), "patch": lambda: w.client.patch(path, json={}, headers=auth("a_owner")),
         "post_pause": lambda: w.client.post(f"{path}/pause", headers=auth("a_owner")), "post_resume": lambda: w.client.post(f"{path}/resume", headers=auth("a_owner"))}[method]()
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


@pytest.mark.parametrize(("user", "status"), [("a_owner", 200), ("a_admin", 200), ("a_sales", 200), ("a_viewer", 200), ("outsider", 404), (None, 401)])
def test_every_member_reads_a_job(user: str | None, status: int) -> None:
    assert World().get("answer_calls", user).status_code == status


@pytest.mark.parametrize(("user", "status"), [("a_owner", 200), ("a_admin", 200), ("a_sales", 403), ("a_viewer", 403), ("outsider", 404)])
def test_only_owner_and_admin_change_a_job(user: str, status: int) -> None:
    w = World(offers=(offer("running"),))
    assert w.patch("offers", {"enabled": False}, user).status_code == status
    assert w.post("offers", "pause", user).status_code == status
    assert w.post("offers", "resume", user).status_code == status
    if status != 200:
        assert w.campaigns.calls == [] and writes(w) == []


def test_an_id_that_is_not_this_workspaces_job_is_404() -> None:
    w = World()
    other = listing.job_id(TENANT_B.id, "offers")   # a job of another workspace
    for path in (f"{JOBS}/{other}", f"{JOBS}/{uuid.uuid4()}", f"{JOBS}/not-a-uuid"):
        assert w.client.get(path, headers=auth("a_owner")).status_code == 404
        assert w.client.patch(path, json={"enabled": False}, headers=auth("a_owner")).status_code == 404
        assert w.client.post(f"{path}/pause", headers=auth("a_owner")).status_code == 404
    assert w.client.get(f"/v1/tenants/{TENANT_B.id}/jobs/{other}", headers=auth("a_owner")).status_code == 404   # not a member there


def test_the_word_paths_still_win_over_the_job_id() -> None:
    w = World()
    assert w.client.get(f"{JOBS}/today", headers=auth("a_owner")).status_code == 200
    assert w.client.get(f"{JOBS}/festivals", headers=auth("a_owner")).status_code == 200


def test_a_researcher_that_a_business_never_has_is_404() -> None:
    client, _ = make_client(jobs=JobsRuntime(directory=PACKS), lead_finder=SimpleNamespace(availability=lambda t, tid: SimpleNamespace(reason="not_for_this_business", available=False, access="hidden")))
    assert client.get(url("researcher"), headers=auth("a_owner")).status_code == 404


# ------------------------------------------------------------------------------------------------------------------ the detail of every kind
DETAIL_KEYS = {"id", "kind", "custom_name", "enabled", "status", "result", "needs_you", "last_run_at", "fix", "plan_gate", "business_name", "what_it_does", "says", "when", "settings", "effect", "finds_out", "faqs", "results", "failure", "test_channel", "cost"}


@pytest.mark.parametrize("kind", KINDS)
def test_every_kind_has_a_job_page(kind: str) -> None:
    w = World(offers=(offer(),))
    r = w.get(kind)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == DETAIL_KEYS and body["kind"] == kind and uuid.UUID(body["id"]) == listing.job_id(A, kind)
    assert body["business_name"] == "Tenant A" and body["what_it_does"] == {"code": kind}
    assert set(body["settings"]) == {"main", "more"} and len(body["settings"]["main"]) <= 4
    assert set(body["when"]) == {"from_hour", "to_hour", "days", "pace_per_hour"}
    assert body["effect"] == {"inputs": {"who": None, "event_at": None, "booked_at": None}}
    assert body["test_channel"] in ("call", "whatsapp") and body["failure"] is None
    assert set(body["results"]) == {"days", "numbers", "items"} and body["results"]["days"] == 7
    assert body["cost"] == {"minutes_used": 13, "minutes_included": 60, "rupees": None}
    for s in body["settings"]["main"] + body["settings"]["more"]:
        assert set(s) == ({"key", "type", "value", "options"} if s["type"] == "choice" else {"key", "type", "value"})


def test_a_kind_with_no_subsystem_still_has_a_page() -> None:
    client, _ = make_client(jobs=JobsRuntime(directory=PACKS), lead_finder=SimpleNamespace(availability=lambda t, tid: SimpleNamespace(reason="ok", available=True, access="available")))
    for kind in ("speed_to_lead", "answer_calls", "followups", "store_visits", "offers", "researcher"):
        r = client.get(url(kind), headers=auth("a_owner"))
        assert r.status_code == 200, (kind, r.text)
        assert all(s["value"] is None for s in r.json()["settings"]["main"] + r.json()["settings"]["more"] if s["type"] == "choice"), kind
        assert all(line["channel"] == "call" for line in r.json()["says"]) and r.json()["cost"] == {"minutes_used": 0, "minutes_included": None, "rupees": None}


def test_the_page_has_an_etag_and_a_304_on_a_repeat() -> None:
    w = World()
    first = w.get("speed_to_lead")
    assert first.headers["etag"] and first.headers["cache-control"] == "private, no-cache"
    again = w.client.get(url("speed_to_lead"), headers={**auth("a_owner"), "If-None-Match": first.headers["etag"]})
    assert again.status_code == 304 and again.content == b""
    changed = w.patch("speed_to_lead", {"settings": {"when": "after_10_min"}})
    assert changed.headers["etag"] != first.headers["etag"]


def test_speed_to_lead_reads_its_rules_its_policy_and_the_assistants_hours() -> None:
    body = World(outreach=Outreach(rule(1, within=10, channel="both", language="te"), rule(2, within=10, channel="both", language="te"), steps=[{"after_minutes": 10}, {"after_minutes": 120}])).get("speed_to_lead").json()
    values = {s["key"]: s["value"] for s in body["settings"]["main"] + body["settings"]["more"]}
    assert values == {"when": "after_10_min", "language": "te", "tries": "tries_2", "thank_you_whatsapp": True, "from_hour": "10:00", "to_hour": "21:00", "say_ai_when_greeting": "business"}
    assert [s["key"] for s in body["settings"]["main"]] == ["when", "language", "tries", "thank_you_whatsapp"]
    assert body["when"] == {"from_hour": "10:00", "to_hour": "21:00", "days": ["mon", "tue", "wed", "thu", "fri", "sat"], "pace_per_hour": None}
    assert body["results"]["numbers"] == {"called": 10, "picked_up": 5, "visits": 2}
    assert body["test_channel"] == "call"


def test_rules_that_disagree_read_as_null_not_as_the_first() -> None:
    body = World(outreach=Outreach(rule(1, within=0), rule(2, within=10), rule(3, language="te"))).get("speed_to_lead").json()
    assert setting(body, "when")["value"] is None and setting(body, "language")["value"] is None
    assert setting(body, "thank_you_whatsapp")["value"] is False


def test_the_other_kinds_read_their_own_places() -> None:
    w = World(offers=(offer(cap=2),))
    visits = w.get("store_visits").json()
    assert {s["key"]: s["value"] for s in visits["settings"]["main"] + visits["settings"]["more"]} == {"from_hour": "10:00", "to_hour": "20:30", "slot_minutes": "minutes_30", "buffer_minutes": "minutes_0", "say_ai_when_greeting": "business"}
    assert visits["when"] == {"from_hour": "10:00", "to_hour": "20:30", "days": ["mon", "tue", "wed", "thu", "fri", "sat"], "pace_per_hour": None}
    followups = w.get("followups").json()
    assert {s["key"]: s["value"] for s in followups["settings"]["main"]} == {"nudges": "nudges_2", "gap_days": "days_3"}
    assert followups["when"] == {"from_hour": "09:00", "to_hour": "21:00", "days": ["mon", "tue", "wed", "thu", "fri", "sat"], "pace_per_hour": None}
    assert {s["key"]: s["value"] for s in w.get("offers").json()["settings"]["main"]} == {"weekly_cap": "cap_2"}
    assert {s["key"]: s["value"] for s in w.get("researcher").json()["settings"]["main"]} == {"results_per_search": "results_10", "fit_bar": "fit_70"}
    assert w.get("answer_calls").json()["settings"] == {"main": [], "more": [{"key": "say_ai_when_greeting", "type": "choice", "value": "business", "options": ["business", "on", "off"]}]}


def test_a_value_the_options_have_no_word_for_reads_as_null() -> None:
    w = World()
    w.visits.raw["slot_minutes"], w.visits.raw["weekly_hours"] = 25, week("10:15", "20:45")
    body = w.get("store_visits").json()
    assert [setting(body, k)["value"] for k in ("slot_minutes", "from_hour", "to_hour")] == [None, None, None]


def test_the_catalogue_keeps_its_own_rules() -> None:
    for kind, specs in catalogue.CATALOGUE.items():
        assert sum(1 for s in specs if s.area == "main") <= catalogue.MAX_MAIN, kind
        assert len({s.key for s in specs}) == len(specs), kind
        for s in specs:
            assert (s.options == ()) == (s.type == "toggle"), (kind, s.key)
            assert len(set(s.options)) == len(s.options)
    assert set(catalogue.CATALOGUE) == set(KINDS)
    assert catalogue.LANGUAGES == ("auto", "en", "te", "hi", "kn", "ta", "ml", "mr")   # the seven languages and "the customer's own"


# ------------------------------------------------------------------------------------------------------------------ every setting is written through its subsystem and read back
def last(calls: list[tuple[str, Any]], name: str) -> Any:
    return [c for c in calls if c[0] == name][-1][1]


def test_when_language_and_thank_you_write_every_rule_with_the_rest_unchanged() -> None:
    w = World()
    r = w.patch("speed_to_lead", {"settings": {"when": "after_10_min", "language": "kn", "thank_you_whatsapp": True}})
    assert r.status_code == 200, r.text
    saves = [c[1] for c in w.outreach.calls if c[0] == "rule_save"]
    assert len(saves) == 6   # two rules, three settings, one save each
    final = saves[-2:]
    assert {d["rule_id"] for d in final} == {str(uuid.UUID(int=0x501)), str(uuid.UUID(int=0x502))}
    assert all(d["within_minutes"] == 10 and d["language"] == "kn" and d["channel"] == "both" and d["questions"] == ["Which item?"] and d["goal"] == "general" and d["action"] == "call_within_minutes" for d in final)
    body = r.json()
    assert [setting(body, k)["value"] for k in ("when", "language", "thank_you_whatsapp")] == ["after_10_min", "kn", True]
    assert w.client.get(f"/v1/tenants/{A}/jobs/{listing.job_id(A, 'speed_to_lead')}", headers=auth("a_owner")).json()["settings"] == body["settings"]   # the old rows say the same
    assert w.patch("speed_to_lead", {"settings": {"thank_you_whatsapp": "off"}}).json()["settings"]["main"][3]["value"] is False   # the web's "off" is a boolean on the wire


def test_a_toggle_accepts_on_and_off_and_answers_booleans() -> None:
    w = World(outreach=Outreach(rule(1, channel="both")))
    assert setting(w.patch("speed_to_lead", {"settings": {"thank_you_whatsapp": "off"}}).json(), "thank_you_whatsapp")["value"] is False
    assert setting(w.patch("speed_to_lead", {"settings": {"thank_you_whatsapp": "on"}}).json(), "thank_you_whatsapp")["value"] is True
    assert setting(w.patch("speed_to_lead", {"settings": {"thank_you_whatsapp": False}}).json(), "thank_you_whatsapp")["value"] is False


def test_tries_keeps_the_owners_own_steps_and_fills_only_the_gap() -> None:
    w = World(outreach=Outreach(rule(1), steps=[{"after_minutes": 30}]))
    assert setting(w.patch("speed_to_lead", {"settings": {"tries": "tries_3"}}).json(), "tries")["value"] == "tries_3"
    assert last(w.outreach.calls, "policy_save") == {"retry_steps": [{"after_minutes": 30}, {"after_minutes": 120}, {"next_morning_minute": 600}]}
    assert setting(w.patch("speed_to_lead", {"settings": {"tries": "tries_1"}}).json(), "tries")["value"] == "tries_1"
    assert last(w.outreach.calls, "policy_save") == {"retry_steps": [{"after_minutes": 30}]}


def test_the_calling_hours_are_the_assistants_hours() -> None:
    w = World()
    body = w.patch("speed_to_lead", {"settings": {"from_hour": "10:30", "to_hour": "20:00"}}).json()
    assert (setting(body, "from_hour")["value"], setting(body, "to_hour")["value"]) == ("10:30", "20:00")
    assert [(s.call_from_minute, s.call_to_minute) for s in w.assistant.saves] == [(630, 1260), (630, 1200)]
    assert w.assistant.saves[-1].name == "Priya"   # the rest of the document is as it was
    refused = w.patch("speed_to_lead", {"settings": {"from_hour": "20:30"}})   # from after to: the same refusal the old screen gives
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "setting_invalid" and refused.json()["error"]["fields"] == ["from_hour"]
    unsaved = World(assistant_saved=False)
    r = unsaved.patch("speed_to_lead", {"settings": {"to_hour": "20:00"}})
    assert r.status_code == 409 and r.json()["error"]["code"] == "job_not_set_up" and unsaved.assistant.saves == []


def test_rule_settings_with_no_rule_are_409_job_not_set_up_and_create_nothing() -> None:
    w = World(outreach=Outreach())
    r = w.patch("speed_to_lead", {"settings": {"when": "right_away"}})
    assert r.status_code == 409 and r.json()["error"]["code"] == "job_not_set_up"
    assert w.outreach.calls == []


def test_a_rule_that_cannot_be_saved_here_is_409_job_locked_and_nothing_is_written() -> None:
    old = rule(1)
    old.action = "whatsapp_first"   # a rule from before "call first": the old screen edits it, a job does not
    w = World(outreach=Outreach(rule(2), old))
    r = w.patch("speed_to_lead", {"settings": {"when": "after_10_min"}})
    assert r.status_code == 409 and r.json()["error"]["code"] == "job_locked" and w.outreach.calls == []


def test_the_second_factor_is_the_databases_and_comes_back_as_mfa_required() -> None:
    w = World()
    w.outreach.refuse = MfaRequired("SM306")
    r = w.patch("speed_to_lead", {"settings": {"when": "after_10_min"}}, aal="aal1")
    assert r.status_code == 403 and r.json()["error"]["code"] == "mfa_required"
    assert w.outreach.calls[0][0] == "rule_save"   # the caller's own token went to the same function the old screen uses
    assert w.patch("speed_to_lead", {"enabled": False}, aal="aal1").status_code == 200   # pausing never asks for it


def test_followups_write_a_new_policy_version_with_the_gaps_the_database_wants() -> None:
    w = World()
    body = w.patch("followups", {"settings": {"nudges": "nudges_3"}}).json()
    assert setting(body, "nudges")["value"] == "nudges_3"
    first = w.followups.saved[0]["p_policy"]
    assert first["max_touches"] == 4 and first["gap_days"] == [3, 3, 3] and first["quiet_hours"] == {"start": "21:00", "end": "09:00"} and first["allowed_weekdays"] == [0, 1, 2, 3, 4, 5] and first["min_gap_hours"] == 24   # cardinality(gap_days) = max_touches - 1
    body = w.patch("followups", {"settings": {"gap_days": "days_5", "nudges": "nudges_1"}}).json()
    assert (setting(body, "gap_days")["value"], setting(body, "nudges")["value"]) == ("days_5", "nudges_1")
    assert w.followups.saved[-1]["p_policy"]["gap_days"] == [5] and w.followups.saved[-1]["p_policy"]["max_touches"] == 2
    assert len(w.followups.versions) == 4   # the old versions stay as history (the first one and three new ones)


def test_followups_with_no_policy_are_409_job_not_set_up() -> None:
    w = World(followups_none=True)
    r = w.patch("followups", {"settings": {"gap_days": "days_2"}})
    assert r.status_code == 409 and r.json()["error"]["code"] == "job_not_set_up" and w.followups.saved == []


def test_store_visit_settings_go_through_the_visit_settings_and_keep_closed_days_closed() -> None:
    w = World()
    body = w.patch("store_visits", {"settings": {"from_hour": "09:30", "to_hour": "21:00", "slot_minutes": "minutes_45", "buffer_minutes": "minutes_10"}}).json()
    assert [setting(body, k)["value"] for k in ("from_hour", "to_hour", "slot_minutes", "buffer_minutes")] == ["09:30", "21:00", "minutes_45", "minutes_10"]
    saved = w.visits.saved[-1]
    assert saved["p_weekly_hours"]["sun"] is None and saved["p_weekly_hours"]["mon"] == {"open": "09:30", "close": "21:00"}
    assert (saved["p_slot_minutes"], saved["p_buffer_minutes"], saved["p_max_parallel"]) == (45, 10, 2)
    refused = w.patch("store_visits", {"settings": {"to_hour": "09:00"}})   # closes before it opens
    assert refused.status_code == 422 and refused.json()["error"]["code"] == "setting_invalid" and refused.json()["error"]["fields"] == ["to_hour"]


def test_an_offers_cap_changes_only_while_the_offer_is_a_draft() -> None:
    w = World(offers=(offer("draft", 1),))
    assert setting(w.patch("offers", {"settings": {"weekly_cap": "cap_3"}}).json(), "weekly_cap")["value"] == "cap_3"
    assert last(w.campaigns.calls, "offer_set") == (str(uuid.UUID(int=0x701)), "Diwali", 3)
    approved = World(offers=(offer("approved", 1),))
    r = approved.patch("offers", {"settings": {"weekly_cap": "cap_2"}})
    assert r.status_code == 409 and r.json()["error"]["code"] == "job_locked" and approved.campaigns.calls == []
    none = World()
    assert none.patch("offers", {"settings": {"weekly_cap": "cap_2"}}).json()["error"]["code"] == "job_not_set_up"


def test_the_researchers_settings_go_through_the_lead_finder_settings() -> None:
    w = World()
    body = w.patch("researcher", {"settings": {"results_per_search": "results_20", "fit_bar": "fit_90"}}).json()
    assert [setting(body, k)["value"] for k in ("results_per_search", "fit_bar")] == ["results_20", "fit_90"]
    assert w.finder.saved == [{"results_per_search": 20}, {"fit_bar": 90}]


def test_the_greeting_override_is_one_setting_of_every_job_that_speaks_and_the_preview_follows_it() -> None:
    w = World()
    for kind in ("speed_to_lead", "answer_calls", "followups", "store_visits", "offers"):
        assert setting(w.get(kind).json(), "say_ai_when_greeting")["options"] == ["business", "on", "off"]
    assert "say_ai_when_greeting" not in [s["key"] for s in w.get("researcher").json()["settings"]["main"] + w.get("researcher").json()["settings"]["more"]]
    plain = [s["text"] for s in w.get("speed_to_lead").json()["says"] if s["channel"] == "call"]
    assert plain and all("AI" in t for t in plain)   # the default is ON (the lawyer's opinion, 25 Nov 2026): the greeting says it is an AI assistant
    body = w.patch("speed_to_lead", {"settings": {"say_ai_when_greeting": "on"}}).json()
    assert setting(body, "say_ai_when_greeting")["value"] == "on" and (w.training.doc or {})["say_ai_by_job"] == {"speed_to_lead": "on"}
    assert all("AI" in s["text"] for s in body["says"])
    assert setting(w.get("followups").json(), "say_ai_when_greeting")["value"] == "business"   # another job is not touched
    assert setting(w.patch("speed_to_lead", {"settings": {"say_ai_when_greeting": "business"}}).json(), "say_ai_when_greeting")["value"] == "business"
    assert (w.training.doc or {})["say_ai_by_job"] == {}
    business_on = World(doc={"say_ai_when_greeting": True})
    assert all("AI" in s["text"] for s in business_on.get("followups").json()["says"])
    no_undertaking = World(doc={"say_ai_when_greeting": True, "say_ai_by_job": {"followups": "off"}})
    assert all("AI" in s["text"] for s in no_undertaking.get("followups").json()["says"]), "an off without the stored undertaking is read as on"
    off = World(doc={"say_ai_when_greeting": True, "say_ai_by_job": {"followups": "off"}, "ai_off_undertaking": {"at": "2026-11-26T09:00:00+00:00", "by": "u1"}})
    assert not any("AI" in s["text"] for s in off.get("followups").json()["says"]) and all("AI" in s["text"] for s in off.get("offers").json()["says"])


@pytest.mark.parametrize(("kind", "settings", "fields"), [
    ("speed_to_lead", {"when": "next_morning"}, ["when"]),                                   # a word the code cannot write is not offered
    ("speed_to_lead", {"when": "after_10_min", "tries": "tries_9"}, ["tries"]),
    ("speed_to_lead", {"thank_you_whatsapp": "maybe"}, ["thank_you_whatsapp"]),
    ("speed_to_lead", {"language": 5}, ["language"]),
    ("speed_to_lead", {"nothing": "x", "when": "right_away"}, ["nothing"]),
    ("followups", {"nudges": "nudges_0", "gap_days": "days_4"}, ["gap_days", "nudges"]),
    ("store_visits", {"from_hour": "10:15"}, ["from_hour"]),
    ("offers", {"weekly_cap": "cap_4"}, ["weekly_cap"]),
    ("researcher", {"fit_bar": "fit_50"}, ["fit_bar"]),
    ("answer_calls", {"say_ai_when_greeting": "yes"}, ["say_ai_when_greeting"]),
])
def test_a_value_outside_options_is_422_setting_invalid_and_nothing_is_written(kind: str, settings: dict[str, Any], fields: list[str]) -> None:
    w = World(offers=(offer(),))
    r = w.patch(kind, {"settings": settings, "enabled": False, "name": "Priya"})
    assert r.status_code == 422, r.text
    err = r.json()["error"]
    assert err["code"] == "setting_invalid" and err["fields"] == fields and set(err) >= {"code", "message", "retry_after", "request_id"}
    assert w.outreach.calls == [] and w.followups.saved == [] and w.visits.saved == [] and w.finder.saved == [] and w.campaigns.calls == [] and w.assistant.saves == [] and w.trust.calls == [] and w.training.saved == [] and w.status.calls == []


# ------------------------------------------------------------------------------------------------------------------ the switch
def test_pause_stops_every_rule_that_is_on_and_resume_turns_on_only_what_the_owner_paused() -> None:
    w = World(outreach=Outreach(rule(1), rule(2, active=False, reason="owner"), rule(3, active=False, reason="billing"), rule(4, active=False, reason="cap_calls")))
    r = w.post("speed_to_lead", "pause")
    assert r.status_code == 200 and r.json()["enabled"] is False and r.json()["kind"] == "speed_to_lead" and set(r.json()) == {"id", "kind", "custom_name", "enabled", "status", "result", "needs_you", "last_run_at", "fix", "plan_gate"}
    assert w.outreach.calls == [("rule_state", (str(uuid.UUID(int=0x501)), "pause"))]
    w.outreach.calls.clear()
    r = w.post("speed_to_lead", "resume")
    assert r.status_code == 200
    resumed = [c[1][0] for c in w.outreach.calls]
    assert resumed == [str(uuid.UUID(int=0x501)), str(uuid.UUID(int=0x502))] and all(c[0] == "rule_state" and c[1][1] == "resume" for c in w.outreach.calls)   # the billing and the cap pauses are not lifted by a tap
    assert {r.id: r.active for r in w.outreach.rows} == {uuid.UUID(int=0x501): True, uuid.UUID(int=0x502): True, uuid.UUID(int=0x503): False, uuid.UUID(int=0x504): False}
    assert w.get("speed_to_lead").json()["status"] == "waiting"   # not all on: the job says so


def test_resume_never_creates_an_approval() -> None:
    w = World(outreach=Outreach())
    r = w.patch("speed_to_lead", {"enabled": True})
    assert r.status_code == 200 and r.json()["enabled"] is False and r.json()["result"]["code"] == "not_set_up"
    assert w.outreach.calls == []   # no rule_save, no state change: a rule nobody approved stays off


def test_patch_enabled_is_the_same_as_pause_and_resume() -> None:
    w = World()
    assert w.patch("speed_to_lead", {"enabled": False}).json()["enabled"] is False
    assert w.patch("speed_to_lead", {"enabled": True}).json()["enabled"] is True
    assert [c[1][1] for c in w.outreach.calls] == ["pause", "pause", "resume", "resume"]


def test_a_pause_still_stops_the_rules_that_are_on_when_the_job_already_reads_as_off() -> None:
    w = World(outreach=Outreach(rule(1), rule(2, active=False, reason="owner")))   # one is on, so `enabled` is false: a pause must still stop it
    assert w.get("speed_to_lead").json()["enabled"] is False
    assert w.patch("speed_to_lead", {"enabled": False}).status_code == 200
    assert w.outreach.calls == [("rule_state", (str(uuid.UUID(int=0x501)), "pause"))]


def test_answer_calls_pause_and_resume_are_the_assistants_switch() -> None:
    w = World()
    assert w.get("answer_calls").json()["enabled"] is True
    r = w.post("answer_calls", "pause")
    assert r.json()["enabled"] is False and r.json()["result"]["code"] == "paused_by_owner" and w.status.calls == ["pause"]
    assert w.post("answer_calls", "resume").json()["enabled"] is True and w.status.calls == ["pause", "go_live"]
    w.status.refuse = HeldBySupportError("SM992")
    held = w.patch("answer_calls", {"enabled": True})
    assert held.status_code == 409 and held.json()["error"]["code"] == "held_by_support"
    w.status.refuse = NotReadyError("SM991")
    ready = w.patch("answer_calls", {"enabled": True})
    assert ready.status_code == 409 and ready.json()["error"]["code"] == "assistant_not_ready" and ready.json()["error"]["missing"] == ["phone_number"]


def test_offers_pause_and_resume_the_offers_that_run() -> None:
    w = World(offers=(offer("running", n=1), offer("paused", n=2), {**offer("running", n=3), "kind": "fee_due"}, offer("done", n=4)))
    assert w.post("offers", "pause").status_code == 200
    assert w.campaigns.calls == [("set_state", (str(uuid.UUID(int=0x701)), "pause"))]
    w.campaigns.calls.clear()
    assert w.post("offers", "resume").status_code == 200
    assert [c[1][1] for c in w.campaigns.calls] == ["resume", "resume"] and {c[1][0] for c in w.campaigns.calls} == {str(uuid.UUID(int=0x701)), str(uuid.UUID(int=0x702))}   # never the fee reminder, never a finished offer


@pytest.mark.parametrize("kind", ["followups", "store_visits", "researcher"])
def test_the_three_jobs_with_no_switch_of_their_own_are_switched_in_the_job_row(kind: str) -> None:
    w = World()
    assert w.get(kind).json()["enabled"] is True
    r = w.post(kind, "pause")
    assert r.status_code == 200 and r.json()["enabled"] is False and r.json()["status"] == "paused" and r.json()["result"] == {"code": "paused_by_owner", "params": {}}
    assert writes(w) == [("ensure", kind), ("enabled", False)]   # the row is made on the first switch; the database's work (due list, reminders, searches) reads it
    page = w.get(kind).json()
    assert page["enabled"] is False and page["status"] == "paused"
    assert w.client.get(JOBS, headers=auth("a_sales")).json()["items"][["speed_to_lead", "answer_calls", "followups", "store_visits", "offers", "researcher"].index(kind)]["enabled"] is False
    r = w.patch(kind, {"enabled": True})
    assert r.status_code == 200 and r.json()["enabled"] is True and r.json()["status"] == "running" and writes(w)[-1] == ("enabled", True)


def test_a_switch_the_database_refuses_is_the_databases_answer() -> None:
    w = World()

    class Refusing(Trust):
        def meta_set_enabled(self, token: str, tenant_id: uuid.UUID, meta_id: uuid.UUID, enabled: bool) -> dict[str, Any]:
            raise JobsRefused("SM986")

    client, _ = make_client(jobs=JobsRuntime(directory=PACKS, trust=Refusing()), followups=w.followups, outreach=w.outreach)  # type: ignore[arg-type]
    r = client.post(f"{url('followups')}/pause", headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "not_removable"
    no_trust, _ = make_client(jobs=JobsRuntime(directory=PACKS), followups=w.followups)  # type: ignore[arg-type]
    assert no_trust.post(f"{url('followups')}/pause", headers=auth("a_owner")).json()["error"]["code"] == "jobs_unavailable"


def test_a_job_that_is_off_because_it_is_not_set_up_is_still_not_made_running_by_a_resume() -> None:
    w = World(followups_none=True)
    r = w.patch("followups", {"enabled": True})
    assert r.status_code == 200 and r.json()["enabled"] is False and r.json()["result"]["code"] == "not_set_up"   # the switch is on, there is no policy: it stays off and says so


# ------------------------------------------------------------------------------------------------------------------ the name and what the helper asks
def test_the_name_is_set_through_the_database_and_comes_back_in_the_list_and_in_says() -> None:
    w = World()
    r = w.patch("speed_to_lead", {"name": "  Priya Sales  "})
    assert r.status_code == 200 and r.json()["custom_name"] == "Priya Sales"
    assert writes(w) == [("ensure", "speed_to_lead"), ("name", "Priya Sales")]
    english = [s["text"] for s in r.json()["says"] if s["language"] == "en" and s["channel"] == "whatsapp"]
    assert english and all("Priya Sales" in t for t in english)   # the real opening line, with the job's own name (a call we place names the business only: that is what the call line says)
    assert {j["kind"]: j["custom_name"] for j in w.client.get(JOBS, headers=auth("a_sales")).json()["items"]}["speed_to_lead"] == "Priya Sales"
    assert {j["kind"]: j["custom_name"] for j in w.client.get(f"{JOBS}/today", headers=auth("a_viewer")).json()["jobs"]}["speed_to_lead"] == "Priya Sales"
    assert w.get("followups").json()["custom_name"] is None
    long_name = "A" * 40
    assert w.patch("speed_to_lead", {"name": long_name}).json()["custom_name"] == long_name   # longer than the assistant's own 24: the job's name is up to 40
    assert any(long_name in s["text"] for s in w.get("speed_to_lead").json()["says"] if s["language"] == "en" and s["channel"] == "whatsapp")


@pytest.mark.parametrize("empty", ["", "   ", None])
def test_an_empty_name_clears_it(empty: str | None) -> None:
    w = World()
    w.patch("offers", {"name": "Diwali helper"})
    r = w.patch("offers", {"name": empty})
    assert r.status_code == 200 and r.json()["custom_name"] is None and writes(w)[-1] == ("name", None)


def test_a_name_the_database_refuses_is_422_name_invalid() -> None:
    w = World()
    w.trust.refuse["name"] = JobsRefused("SM983")
    r = w.patch("offers", {"name": "98450 20001"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "name_invalid" and r.json()["error"]["message"] == REFUSALS["SM983"][2]
    too_long = World().patch("offers", {"name": "B" * 41})
    assert too_long.status_code == 422 and too_long.json()["error"]["code"] == "name_invalid"


def test_what_the_helper_asks_is_set_per_kind_with_its_closed_keys() -> None:
    w = World()
    assert w.get("speed_to_lead").json()["finds_out"] == [{"key": k, "enabled": False} for k in ("need", "quantity", "when", "visit")]   # a key never set is off
    body = w.patch("speed_to_lead", {"finds_out": {"quantity": True, "visit": True}}).json()
    assert body["finds_out"] == [{"key": "need", "enabled": False}, {"key": "quantity", "enabled": True}, {"key": "when", "enabled": False}, {"key": "visit", "enabled": True}]
    assert last(w.trust.calls, "finds_out") == {"quantity": True, "visit": True}
    assert [f["key"] for f in w.get("followups").json()["finds_out"]] == ["still_interested", "budget_range"]
    assert w.get("offers").json()["finds_out"] == [] and w.get("researcher").json()["finds_out"] == []
    for kind, bad in (("speed_to_lead", {"budget_range": True}), ("offers", {"need": True})):
        r = w.patch(kind, {"finds_out": bad})
        assert r.status_code == 422 and r.json()["error"]["code"] == "setting_invalid" and r.json()["error"]["fields"] == [f"finds_out.{next(iter(bad))}"]
    assert w.patch("speed_to_lead", {"finds_out": {"need": "yes"}}).status_code == 422   # a word is not a boolean


def test_name_and_finds_out_need_the_trust_store() -> None:
    client, _ = make_client(jobs=JobsRuntime(directory=PACKS))
    r = client.patch(url("offers"), json={"name": "Priya"}, headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "jobs_unavailable"


def test_an_unknown_field_in_the_patch_is_422() -> None:
    assert World().patch("offers", {"kind": "researcher"}).status_code == 422


def test_the_faqs_of_the_job_page_hang_on_the_jobs_own_row() -> None:
    w = World()
    assert w.get("followups").json()["faqs"] == []
    faq_url = f"{url('followups')}/faqs"
    assert w.client.get(faq_url, headers=auth("a_viewer")).json() == {"items": []} and w.trust.rows == {}   # a read makes nothing
    added = w.client.post(faq_url, json={"question": "Do you deliver?", "answer": "Yes, in the city."}, headers=auth("a_owner"))
    assert added.status_code == 200, added.text
    meta_id = w.trust.rows["followups"]["id"]
    assert added.json()["job_id"] == meta_id   # the Job's id was turned into the row it hangs on
    assert w.client.get(faq_url, headers=auth("a_sales")).json()["items"][0]["question"] == "Do you deliver?"
    page = w.get("followups").json()
    assert page["faqs"] == [{"id": added.json()["id"], "question": "Do you deliver?", "answer": "Yes, in the city."}]
    assert w.get("speed_to_lead").json()["faqs"] == []


# ------------------------------------------------------------------------------------------------------------------ what waits for the owner
def test_the_same_promise_is_one_item_with_the_customer_and_when() -> None:
    """25 Nov 2026: two identical rows for one promise (the demo's 'paver blocks') are one item; a different kind or target still is its own."""
    w = World(today=Today(("followup_due", "lead"), ("followup_due", "lead"), ("followup_due", "order"), ("hot_lead_waiting", "lead")))
    items = w.client.get(f"{JOBS}/today", headers=auth("a_owner")).json()["needs_you"]
    assert [(i["kind"], i["target"]["type"]) for i in items] == [("followup_due", "lead"), ("followup_due", "order"), ("hot_lead_waiting", "lead")]
    assert all(i["customer"] == "Ravi" and i["at"].startswith("2026-11-20") for i in items)


def test_needs_you_is_the_list_today_shows_and_each_job_counts_its_own() -> None:
    w = World(today=Today(("hot_lead_waiting", "lead"), ("call_approval", "call_request"), ("visit_requested", "call_request"), ("campaign_approval", "campaign"), ("quote_approval", "quote"), ("fees_overdue", "fees")))
    body = w.client.get(f"{JOBS}/today", headers=auth("a_owner")).json()
    assert len(body["needs_you"]) == 6
    first = body["needs_you"][0]
    assert set(first) == {"id", "code", "kind", "at", "customer", "summary", "target"} and first["customer"] == "Ravi" and first["kind"] == "hot_lead_waiting" and first["code"] == "hot_lead_waiting" and first["target"] == {"type": "lead", "id": str(CUSTOMER)}
    assert [(i["kind"], i["target"]["type"]) for i in body["needs_you"][1:]] == [("call_approval", "call_request"), ("visit_requested", "call_request"), ("campaign_approval", "approval"), ("quote_approval", "approval"), ("fees_overdue", "fees")]
    jobs = {j["kind"]: j for j in body["jobs"]}
    assert (jobs["speed_to_lead"]["needs_you"], jobs["store_visits"]["needs_you"], jobs["offers"]["needs_you"], jobs["followups"]["needs_you"]) == (2, 1, 1, 0)
    assert jobs["speed_to_lead"]["status"] == "waiting"   # on, and something waits for the owner
    assert w.client.get(JOBS, headers=auth("a_owner")).json()["items"][0]["needs_you"] == 2
    assert w.get("speed_to_lead").json()["needs_you"] == 2
    again = w.client.get(f"{JOBS}/today", headers={**auth("a_owner"), "If-None-Match": w.client.get(f"{JOBS}/today", headers=auth("a_owner")).headers["etag"]})
    assert again.status_code == 304


def test_a_today_that_cannot_be_read_is_an_empty_list_not_a_failed_page() -> None:
    class Broken:
        def today_summary(self, token: str, tenant_id: uuid.UUID) -> Any:
            raise RuntimeError("down")

    w = World()
    client, _ = make_client(jobs=JobsRuntime(directory=PACKS), today=Broken())  # type: ignore[arg-type]
    r = client.get(f"{JOBS}/today", headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["needs_you"] == [] and w.get("offers").status_code == 200


def test_a_paused_job_is_not_made_waiting_by_what_waits() -> None:
    w = World(today=Today(("hot_lead_waiting", "lead")), outreach=Outreach(rule(1, active=False, reason="owner")))
    job = w.get("speed_to_lead").json()
    assert job["status"] == "paused" and job["needs_you"] == 1


# ------------------------------------------------------------------------------------------------ the docs' nullability (docs/contracts/jobs-detail.md), asserted on every answer
NULLABLE_JOB = {"custom_name", "last_run_at", "fix", "plan_gate"}
NULLABLE_DETAIL = NULLABLE_JOB | {"failure"}


def _nulls(body: dict[str, Any], allowed_top: set[str]) -> set[str]:
    found: set[str] = set()
    for key, value in body.items():
        if value is None and key not in allowed_top:
            found.add(key)
    return found


@pytest.mark.parametrize("kind", KINDS)
def test_the_answers_are_null_only_where_the_docs_say_so(kind: str) -> None:
    """A null anywhere else is a contract bug (the web crashed on `setting.value` once): top level of a Job and a JobDetail, the nested objects, and `value` of a Setting (null = "the stored value matches none of the options": never "the default")."""
    w = World(offers=(offer(),))
    detail = w.get(kind).json()
    assert _nulls(detail, NULLABLE_DETAIL) == set(), _nulls(detail, NULLABLE_DETAIL)
    for parent, key in (("when", "from_hour"), ("when", "to_hour"), ("when", "pace_per_hour")):
        assert key in detail[parent]
    assert {k for k, v in detail["when"].items() if v is None} <= {"from_hour", "to_hour", "pace_per_hour"}
    assert {k for k, v in detail["effect"]["inputs"].items() if v is None} <= {"who", "event_at", "booked_at"}
    assert {k for k, v in detail["cost"].items() if v is None} <= {"minutes_included", "rupees"} and detail["cost"]["minutes_used"] is not None
    assert detail["result"]["code"] and isinstance(detail["result"]["params"], dict) and detail["status"] and isinstance(detail["enabled"], bool) and isinstance(detail["needs_you"], int)
    assert isinstance(detail["results"]["days"], int)
    for s in detail["settings"]["main"] + detail["settings"]["more"]:
        assert isinstance(s["key"], str) and s["type"] in ("choice", "toggle")
        assert s["value"] is None or (isinstance(s["value"], str) if s["type"] == "choice" else isinstance(s["value"], bool))
        if s["type"] == "choice":
            assert isinstance(s["options"], list) and s["options"] and (s["value"] is None or s["value"] in s["options"])
