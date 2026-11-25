"""Jobs S3a (closing S2's gaps): (1) every path that speaks to a customer reads the per-job "say AI when greeting" override, and what a call opens with equals what the job page's `says` shows, for the override on, off and business;
(2) the switch of follow-ups, store visits and the researcher (the API half: the database half is pgTAP 264); (3) the results of the other kinds. With fakes, no database, no network."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest

from app.opening import greeting
from app.tasks.runner import TaskRunner
from app.telephony.inbound_routes import OutboundCall, phone_parts
from app.telephony.plivo_outbound import PENDING, OutboundRefused, PlivoDialer, opening_for
from app.telephony.plivo_tasks import PlivoTaskDialer
from app.telephony.wiring import call_greeting_lookup
from tests.fakes import auth
from tests.test_jobs_s2_detail import Followups, World, offer, url
from tests.test_outbound_frame import voice
from tests.test_pl_inbound import OWNER
from tests.test_pl_outbound import placer

TENANT = uuid.UUID(int=0xA)
BUSINESS = "Tenant A"   # the name of the workspace of the fakes
OVERRIDES = ("business", "on", "off")


def doc_of(business: bool | None, job: str, word: str) -> dict[str, Any]:
    doc: dict[str, Any] = {"ai_off_undertaking": {"at": "2026-11-26", "by": "owner"}}   # an OFF counts only with the Owner's stored written undertaking (lawyer's opinion, 25 Nov 2026)
    if business is not None:
        doc["say_ai_when_greeting"] = business
    if word != "business":
        doc["say_ai_by_job"] = {job: word}
    return doc


def effective(business: bool | None) -> bool:
    return True if business is None else business   # the default is ON


def expected(business: bool | None, word: str) -> bool:
    return True if word == "on" else False if word == "off" else effective(business)


# ------------------------------------------------------------------------------------------------------------------ the one rule
@pytest.mark.parametrize("business", [None, False, True])
@pytest.mark.parametrize("word", OVERRIDES)
@pytest.mark.parametrize("job", greeting.JOB_KINDS)
def test_the_resolved_setting_of_a_job_is_its_override_else_the_business_else_on(business: bool | None, word: str, job: str) -> None:
    doc = doc_of(business, job, word)
    assert greeting.resolved_for_job(doc, job) is expected(business, word)
    other = next(k for k in greeting.JOB_KINDS if k != job)
    assert greeting.resolved_for_job(doc, other) is effective(business)   # another job is not touched
    assert greeting.resolved_for_job(doc, None) is effective(business)    # a call that belongs to no job follows the business


def test_a_word_that_is_not_on_or_off_or_a_job_that_is_not_one_is_no_override() -> None:
    assert greeting.job_word({"say_ai_by_job": {"followups": "yes"}}, "followups") is None
    assert greeting.job_word({"say_ai_by_job": {"researcher": "on"}}, "researcher") is None   # the researcher never speaks to anyone
    assert greeting.job_word({"say_ai_by_job": "x"}, "followups") is None and greeting.job_word(None, "followups") is None
    assert greeting.resolved_for_job({"say_ai_when_greeting": True, "say_ai_by_job": {"followups": 3}}, "followups") is True


def test_the_task_templates_and_the_message_categories_name_their_jobs() -> None:
    assert greeting.JOB_OF_TASK_TEMPLATE == {"call_new_leads": "speed_to_lead", "reengage_old_leads": "followups", "confirm_appointments": "store_visits", "offer_invite": "offers"}
    assert greeting.JOB_OF_OUTBOX_CATEGORY == {"followup": "followups", "visit": "store_visits"}
    assert set(greeting.JOB_OF_TASK_TEMPLATE.values()) <= set(greeting.JOB_KINDS)


# ------------------------------------------------------------------------------------------------------------------ the inbound line: the call opening equals the job page's `says`
def call_line(page: dict[str, Any], language: str = "en") -> str:
    return str(next(s["text"] for s in page["says"] if s["channel"] == "call" and s["language"] == language))


@pytest.mark.parametrize("business", [False, True])
@pytest.mark.parametrize("word", OVERRIDES)
def test_an_inbound_call_opens_as_the_answer_calls_page_says(business: bool, word: str) -> None:
    doc = doc_of(business, "answer_calls", word)
    parts, _ = phone_parts(voice(), BUSINESS, "en", "haiku", doc, assistant="Priya")   # no `mention_ai` forced: the call resolves it itself, for its job
    heard = str(parts.greeting_for("en"))
    page = World(doc=doc).get("answer_calls").json()
    assert call_line(page) == heard
    assert greeting.resolved_for_job(doc, "answer_calls") is expected(business, word)
    assert ("AI" in heard) is expected(business, word)   # on: it says it; off: the name only


# ------------------------------------------------------------------------------------------------------------------ calls we place: the job that placed it
def outbound_for(job: str, language: str = "en", tone: str = "friendly") -> OutboundCall:
    return OutboundCall(row_id=uuid.uuid4(), language=language, purpose="sales_followup", goal=None, opening_line=opening_for("task", language, tone), kind="task", tone=tone, job=job)


@pytest.mark.parametrize("business", [False, True])
@pytest.mark.parametrize("word", OVERRIDES)
@pytest.mark.parametrize("job", ["speed_to_lead", "followups", "store_visits", "offers"])
def test_a_call_we_place_opens_with_its_jobs_setting(business: bool, word: str, job: str) -> None:
    doc = doc_of(business, job, word)
    parts, _ = phone_parts(voice(), BUSINESS, "en", "haiku", doc, assistant="Priya", outbound=outbound_for(job))
    heard = str(parts.greeting_for("en"))
    assert ("AI" in heard) is expected(business, word), (job, word, business, heard)
    other = next(k for k in ("speed_to_lead", "followups", "store_visits", "offers") if k != job)
    elsewhere, _ = phone_parts(voice(), BUSINESS, "en", "haiku", doc, assistant="Priya", outbound=outbound_for(other))
    assert ("AI" in str(elsewhere.greeting_for("en"))) is effective(business)   # another job's call does not follow this job's word


@pytest.mark.parametrize("word", OVERRIDES)
@pytest.mark.parametrize("business", [False, True])
@pytest.mark.parametrize("language", ["en", "te"])
def test_a_speed_to_lead_call_opens_as_the_page_says(business: bool, word: str, language: str) -> None:
    doc = doc_of(business, "speed_to_lead", word)
    parts, _ = phone_parts(voice(), BUSINESS, language, "haiku", doc, assistant="Priya", outbound=outbound_for("speed_to_lead", language))
    world = World(doc=doc)
    assert call_line(world.get("speed_to_lead").json(), language) == str(parts.greeting_for(language))


def test_a_call_that_belongs_to_no_job_follows_the_business_setting() -> None:
    doc = {"ai_off_undertaking": {"at": "2026-11-26", "by": "owner"}, "say_ai_when_greeting": False, "say_ai_by_job": {"speed_to_lead": "on", "followups": "on", "store_visits": "on", "offers": "on", "answer_calls": "on"}}
    call = OutboundCall(row_id=uuid.uuid4(), language="en", purpose="sales_followup", goal=None, opening_line=opening_for("task", "en"), kind="task", tone="friendly")   # job None
    parts, _ = phone_parts(voice(), BUSINESS, "en", "haiku", doc, assistant="Priya", outbound=call)
    assert "AI" not in str(parts.greeting_for("en"))


# ------------------------------------------------------------------------------------------------------------------ the placing paths carry the job
class Recording:
    """An outbound placer that refuses every call (so nothing waits) and remembers what it was asked."""

    def __init__(self) -> None:
        self.asked: list[dict[str, Any]] = []

    def place(self, token: str, tenant_id: uuid.UUID, to_number: str, **kw: Any) -> Any:
        self.asked.append(kw)
        raise OutboundRefused("outside_window")


@pytest.mark.parametrize("business", [False, True])
@pytest.mark.parametrize("word", OVERRIDES)
@pytest.mark.parametrize("template", ["call_new_leads", "reengage_old_leads", "confirm_appointments", "offer_invite", "collect_feedback", "custom"])
def test_a_task_call_is_placed_for_its_templates_job_with_that_jobs_setting(business: bool, word: str, template: str) -> None:
    job = greeting.JOB_OF_TASK_TEMPLATE.get(template)
    doc = doc_of(business, job or "followups", word)
    lookups: list[str | None] = []

    def say_ai_for(token: str, tenant_id: uuid.UUID, j: str | None = None) -> bool:
        lookups.append(j)
        return greeting.resolved_for_job(doc, j)

    out = Recording()
    PlivoTaskDialer(out, SimpleNamespace(), say_ai_for=say_ai_for).call(business=BUSINESS, language="en", questions=[], template=template, seed="s", phone="+919876543210", token="t", tenant_id=TENANT, goal="Follow up.", task_id=uuid.uuid4())  # type: ignore[arg-type]
    asked = out.asked[0]
    assert asked["job"] == job and asked["say_ai"] is greeting.resolved_for_job(doc, job)
    assert lookups == [job]
    if job is None:
        assert asked["say_ai"] is effective(business)   # a custom or feedback task: the business setting, whatever any job says


def test_the_job_travels_from_placing_to_answering() -> None:
    out, _, _ = placer()
    placed = out.place("tok", TENANT, OWNER, approval_kind="owner_test", business="Padma Silks", goal="A test goal.", job="followups")
    assert PENDING.take_job(placed.call_id) == "followups" and PENDING.take_job(placed.call_id) is None   # once
    no_goal = out.place("tok", TENANT, OWNER, approval_kind="owner_test", business="Padma Silks", job="speed_to_lead")   # a rule's call has no typed goal: it still carries its job
    assert PENDING.take_job(no_goal.call_id) == "speed_to_lead"
    none = out.place("tok", TENANT, OWNER, approval_kind="owner_test", business="Padma Silks")
    assert PENDING.take_job(none.call_id) is None


def test_a_job_nobody_took_is_forgotten_after_the_pending_time() -> None:
    clock = [0.0]
    from app.telephony.plivo_outbound import PendingGoals

    pending = PendingGoals(ttl_s=10, clock=lambda: clock[0])
    a, b = uuid.uuid4(), uuid.uuid4()
    pending.keep_job(a, "offers")
    clock[0] = 11
    pending.keep_job(b, "followups")
    assert pending.take_job(a) is None and pending.take_job(b) == "followups"


@pytest.mark.parametrize("word", OVERRIDES)
def test_the_standing_rules_dialer_places_its_calls_for_the_speed_to_lead_job(word: str) -> None:
    doc = doc_of(False, "speed_to_lead", word)
    out = Recording()
    dialer = PlivoDialer(out, SimpleNamespace(), lambda: "tok", say_ai_for=lambda tok, tid, j: greeting.resolved_for_job(doc, j))  # type: ignore[arg-type]
    answer = dialer.dial({"tenant_id": str(TENANT), "phone": "+919876543210", "language": "en", "owner_kind": "rule", "item_id": str(uuid.uuid4()), "lead_id": str(uuid.uuid4())})
    assert answer.result == "failed" and out.asked[0]["job"] == "speed_to_lead" and out.asked[0]["say_ai"] is expected(False, word)
    dialer.dial({"tenant_id": str(TENANT), "phone": "+919876543210", "language": "en", "owner_kind": "batch", "item_id": str(uuid.uuid4())})
    assert out.asked[1]["job"] is None and out.asked[1]["say_ai"] is False   # a list the owner approved is no job's: the business setting
    plain = PlivoDialer(Recording(), SimpleNamespace(), lambda: "tok")  # type: ignore[arg-type]
    plain.dial({"tenant_id": str(TENANT), "phone": "+919876543210", "language": "en"})
    assert plain._outbound.asked[0]["say_ai"] is True   # type: ignore[attr-defined]   # no setting wired: it says so, the strict side


def test_the_phone_servers_lookup_reads_the_job_override_from_the_saved_document(monkeypatch: pytest.MonkeyPatch) -> None:
    import app.talk_training.repository as repository

    saved: dict[str, Any] = {"doc": {"ai_off_undertaking": {"at": "2026-11-26", "by": "owner"}, "say_ai_when_greeting": False, "say_ai_by_job": {"followups": "on"}}}

    class Fake:
        def __init__(self, *a: Any, **k: Any) -> None: ...
        def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
            return saved

    monkeypatch.setattr(repository, "PostgrestTalkTraining", Fake)
    lookup = call_greeting_lookup("http://rest.invalid", "anon")
    assert lookup("t", TENANT, "followups") is True and lookup("t", TENANT, "offers") is False and lookup("t", TENANT) is False and lookup("t", TENANT, None) is False


def test_a_task_message_follows_its_jobs_setting_too() -> None:
    doc = doc_of(False, "followups", "on")
    def say_ai_for(token: str, tenant_id: uuid.UUID, job: str | None = None) -> bool:
        return greeting.resolved_for_job(doc, job)

    runner = TaskRunner(SimpleNamespace(), SimpleNamespace(), None, say_ai_for=say_ai_for)
    assert runner._say_ai("t", TENANT, {"template": "reengage_old_leads"}) is True
    assert runner._say_ai("t", TENANT, {"template": "offer_invite"}) is False
    assert runner._say_ai("t", TENANT, {"template": "custom"}) is False and runner._say_ai("t", TENANT, None) is False and runner._say_ai("t", TENANT) is False


# ------------------------------------------------------------------------------------------------------------------ the switch (the page)
def test_the_page_and_the_list_say_a_paused_job_is_paused_and_a_resume_turns_it_on_again() -> None:
    w = World()
    w.post("store_visits", "pause")
    assert w.get("store_visits").json()["status"] == "paused"
    assert w.post("store_visits", "resume").json()["status"] == "running"


# ------------------------------------------------------------------------------------------------------------------ results
class People:
    """The contacts' names (the CRM's get_row): a real name, and a placeholder the display-name helper refuses."""

    def __init__(self) -> None:
        self.names = {str(uuid.UUID(int=0xE1)): "Ravi Kumar", str(uuid.UUID(int=0xE2)): "WhatsApp customer 84407a", str(uuid.UUID(int=0xE3)): "Meena (demo)"}

    def get_row(self, token: str, entity: str, tenant_id: uuid.UUID, row_id: uuid.UUID) -> Any:
        assert entity == "contacts"
        return SimpleNamespace(full_name=self.names[str(row_id)], phone="+919845020001")


def ago(**kw: float) -> str:
    return (datetime.now(UTC) - timedelta(**kw)).isoformat()


def draft(n: int, status: str, contact: int, created: str, approved: str | None = None) -> dict[str, Any]:
    return {"id": str(uuid.UUID(int=0xF00 + n)), "lead_id": str(uuid.UUID(int=0xF10 + n)), "contact_id": str(uuid.UUID(int=0xE0 + contact)), "touch_number": 2, "status": status, "channel": "whatsapp", "created_at": created, "approved_at": approved}


def test_followups_results_are_the_drafts_of_the_last_seven_days_with_the_display_name() -> None:
    w = World(crm=People())
    w.followups.drafts = [
        draft(1, "recorded_sent", 1, ago(days=3), ago(days=2)), draft(2, "approved", 3, ago(days=1), ago(hours=5)), draft(3, "draft", 2, ago(hours=2)),
        draft(4, "discarded", 1, ago(days=1)), draft(5, "recorded_sent", 1, ago(days=20), ago(days=19)),
    ]
    res = w.get("followups").json()["results"]
    assert res["days"] == 7 and res["numbers"] == {"drafted": 4, "approved": 2, "sent": 1, "waiting": 1}
    assert [(i["customer"], i["status"], i["detail_code"]) for i in res["items"]] == [("New enquiry", "waiting", "draft_draft"), ("Meena", "waiting", "draft_approved"), ("Ravi Kumar", "done", "draft_recorded_sent")]
    assert all(set(i) == {"customer", "status", "detail_code", "params", "at"} and i["params"] == {"touch": 2, "channel": "whatsapp"} for i in res["items"])
    assert "9845" not in str(res) and "WhatsApp customer" not in str(res)   # never a phone number, never a placeholder made of an id


def test_followup_items_are_at_most_five_and_a_missing_crm_still_gives_a_page() -> None:
    w = World()
    w.followups.drafts = [draft(n, "draft", 1, ago(hours=n)) for n in range(1, 9)]
    items = w.get("followups").json()["results"]["items"]
    assert len(items) == 5 and all(i["customer"] == "New enquiry" for i in items)   # the default CRM of the fakes does not know these contacts: "no name", never an error


def visit_row(n: int, status: str, days_ago: float, who: str | None = "Ravi K.") -> dict[str, Any]:
    start = datetime.now(UTC) - timedelta(days=days_ago)
    return {"id": str(uuid.UUID(int=0xA00 + n)), "lead_id": str(uuid.UUID(int=0xA10 + n)), "contact_id": None, "contact_name": who, "company_name": None, "city": None, "visit_date": start.date().isoformat(),
            "starts_at": start.isoformat(), "ends_at": (start + timedelta(minutes=30)).isoformat(), "party_size": 1, "purpose": None, "note": None, "status": status, "source": "assistant", "outcome": None,
            "order_id": None, "advance_requested": False, "advance_paise": None, "confirmation_message_id": None, "reminder_message_id": None, "confirmation_sent": True, "reminder_sent": False,
            "cancel_reason": None, "created_at": start.isoformat(), "confirmed_at": None, "arrived_at": None, "closed_at": None}


def test_store_visits_results_count_booked_done_no_show_and_cancelled() -> None:
    w = World()
    w.visits.visits = [visit_row(1, "completed", 1), visit_row(2, "no_show", 2), visit_row(3, "cancelled", 3), visit_row(4, "confirmed", 0.1), visit_row(5, "booked", 4, None)]
    res = w.get("store_visits").json()["results"]
    assert res["numbers"] == {"booked": 4, "done": 1, "no_show": 1, "cancelled": 1}
    assert [(i["customer"], i["status"], i["detail_code"]) for i in res["items"]] == [("Ravi K.", "waiting", "visit_confirmed"), ("Ravi K.", "done", "visit_completed"), ("Ravi K.", "noanswer", "visit_no_show"), ("Ravi K.", "failed", "visit_cancelled"), ("A customer", "waiting", "visit_booked")]
    assert set(res["items"][0]) == {"customer", "status", "detail_code", "params", "at"}


def test_offers_results_count_what_was_sent_and_who_replied() -> None:
    w = World(offers=(offer("running", n=1), offer("draft", n=2), {**offer("running", n=3), "kind": "fee_due"}))
    assert w.get("offers").json()["results"] == {"days": 7, "numbers": {"sent": 10, "replied": 4}, "items": []}   # the one running offer: 3 sent + 5 delivered + 2 read; a draft and a fee reminder are not offers that went out


def finder_search(state: str, found: int, days_ago: float) -> Any:
    at = datetime.now(UTC) - timedelta(days=days_ago)
    return SimpleNamespace(state=state, found=found, created_at=at, finished_at=at)


def test_researcher_results_count_the_searches_and_the_prospects_found() -> None:
    w = World()
    w.finder.found = [finder_search("done", 12, 1), finder_search("done", 5, 2), finder_search("failed", 0, 1), finder_search("planned", 0, 0), finder_search("done", 9, 20)]
    res = w.get("researcher").json()["results"]
    assert res["numbers"]["searches"] == 2 and res["numbers"]["prospects_found"] == 17 and res["numbers"]["last_search_at"] and res["items"] == []


def test_a_kind_without_results_yet_and_a_subsystem_that_fails_give_empty_results_not_an_error() -> None:
    w = World()
    assert w.get("answer_calls").json()["results"] == {"days": 7, "numbers": {}, "items": []}

    class Broken(Followups):
        def list_drafts(self, token: str, tenant_id: uuid.UUID, *, lead_id: Any, status: Any, limit: int) -> list[dict[str, Any]]:
            raise RuntimeError("down")

    w.followups.list_drafts = Broken().list_drafts   # type: ignore[method-assign]
    r = w.client.get(url("followups"), headers=auth("a_viewer"))
    assert r.status_code == 200 and r.json()["results"] == {"days": 7, "numbers": {}, "items": []}
