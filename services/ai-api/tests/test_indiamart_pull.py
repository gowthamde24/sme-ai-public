"""The scheduled IndiaMART pull (connectors plan C1 item 5): the worker pass with a fake provider, an in-memory secret store and an in-memory copy of the database's rules (migration 20261231992400):
the window, the same buyer twice = one lead, a refused key = `expired` and left alone, a new key = asked again, and the switch that keeps all of it off. No network, no key, no real buyer (the numbers start +00)."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from app.config import Settings
from app.connectors.errors import ProviderError
from app.connectors.indiamart import ExternalLead
from app.lead_sources import cards as cards_mod
from app.lead_sources.indiamart_pull import IndiaMartPuller, build_indiamart_puller
from app.lead_sources.service import LeadSourcesService
from app.tenancy.repository import TokenRejected
from app.workspace_secrets import FakeSecretStore, SecretStoreError
from tests.dr_sources_fakes import FakeLeadSourcesRepository, Receiver

TENANT = uuid.UUID("11111111-1111-1111-1111-111111111111")
SECRET = f"sme-ws-{TENANT}-indiamart"
KEY = "fake-key-0123456789abcdef"


class Clock:
    def __init__(self) -> None:
        self.now = datetime(2026, 11, 25, 9, 0, tzinfo=UTC)

    def advance(self, **kw: float) -> None:
        self.now += timedelta(**kw)


class FakeDb:
    """The database's side as migration 20261231992400 writes it, small: who is due, the window, the intake by query id, the key state."""

    def __init__(self, clock: Clock) -> None:
        self.clock = clock
        self.attempt: datetime | None = None
        self.last_end: datetime | None = None
        self.key_state: str | None = None
        self.key_state_at: datetime | None = None
        self.key_saved_at = clock.now - timedelta(days=1)
        self.items: set[str] = set()
        self.leads: list[dict[str, Any]] = []
        self.gate_open = True
        self.source_active = True
        self.windows: list[tuple[datetime, datetime]] = []
        self.refuse_blocked = False

    def links(self, _t: str, limit: int) -> list[dict[str, Any]]:
        now = self.clock.now
        due = self.source_active and self.gate_open and (self.attempt is None or self.attempt < now - timedelta(minutes=15)) \
            and (self.key_state != "expired" or self.key_saved_at > (self.key_state_at or now) or (self.key_state_at or now) < now - timedelta(hours=6))
        return [{"tenant_id": str(TENANT), "secret_name": SECRET, "consent_id": None}][:limit] if due else []

    def begin(self, _t: str, _tenant: uuid.UUID) -> dict[str, Any]:
        now = self.clock.now
        if not self.source_active:
            return {"status": "off"}
        if self.attempt is not None and self.attempt > now - timedelta(minutes=5):
            return {"status": "too_soon"}
        start = max(self.last_end - timedelta(minutes=5) if self.last_end else now - timedelta(hours=24), now - timedelta(days=7))
        self.attempt = now
        return {"status": "ok", "start": start.isoformat(), "end": now.isoformat()}

    def apply(self, _t: str, _tenant: uuid.UUID, rows: list[dict[str, Any]], end: datetime, fetched: int) -> dict[str, Any]:
        counts = {"ready": 0, "already_imported": 0, "duplicates_merged": 0, "blocked": 0, "invalid": 0}
        for row in rows:
            if self.refuse_blocked:
                counts["blocked"] += 1
            elif row["external_id"] in self.items:
                counts["already_imported"] += 1
            else:
                self.items.add(row["external_id"])
                self.leads.append(row)
                counts["ready"] += 1
        if counts["blocked"] == 0:
            self.last_end = max(self.last_end or end, end)
        self.key_state, self.key_state_at = "ok", self.clock.now
        return {"status": "done", "counts": counts}

    def key_state_set(self, _t: str, _tenant: uuid.UUID, state: str) -> bool:
        self.key_state, self.key_state_at = state, self.clock.now
        return True


class Repo:
    def __init__(self, db: FakeDb) -> None:
        self.db = db
        self.links, self.begin, self.apply, self.key_state = db.links, db.begin, db.apply, db.key_state_set


class Provider:
    """The fake IndiaMART: gives the leads that fall inside the asked window, or says what it was told to say."""

    def __init__(self) -> None:
        self.leads: list[ExternalLead] = []
        self.error: str | None = None
        self.asked: list[tuple[datetime, datetime]] = []
        self.keys: list[str] = []

    def source_for(self, key: str) -> Provider:
        self.keys.append(key)
        return self

    def pull(self, start: datetime, end: datetime) -> list[ExternalLead]:
        self.asked.append((start, end))
        if self.error:
            raise ProviderError(self.error)
        return [lead for lead in self.leads if lead.received_at is None or start <= lead.received_at <= end]


def buyer(n: int, at: datetime) -> ExternalLead:
    return ExternalLead(f"QID-{n:04d}", "W", f"Invented Buyer {n}", f"+00 98765 {n:05d}", None, "IN", "Need 20 sarees", at)


class World:
    def __init__(self) -> None:
        self.clock = Clock()
        self.db = FakeDb(self.clock)
        self.provider = Provider()
        self.store = FakeSecretStore()
        self.store.put(SECRET, KEY)
        service = LeadSourcesService(FakeLeadSourcesRepository(), receiver=Receiver())
        self.puller = IndiaMartPuller(Repo(self.db), self.store, service, self.provider.source_for)

    def run(self) -> dict[str, int]:
        return self.puller.run("worker-token")

    def later(self, minutes: float) -> None:
        self.clock.advance(minutes=minutes)


def test_the_first_pass_asks_for_the_last_day_and_makes_one_lead_per_buyer() -> None:
    w = World()
    w.provider.leads = [buyer(1, w.clock.now - timedelta(hours=3)), buyer(2, w.clock.now - timedelta(hours=1))]
    out = w.run()
    assert out["created"] == 2 and out["leads_read"] == 2 and len(w.db.leads) == 2
    start, end = w.provider.asked[0]
    assert end - start == timedelta(hours=24) and w.provider.keys == [KEY]
    assert w.db.key_state == "ok" and w.db.last_end == end


def test_the_next_window_starts_five_minutes_before_the_last_one_ended_and_a_buyer_seen_twice_is_one_lead() -> None:
    w = World()
    first = w.clock.now - timedelta(hours=2)
    w.provider.leads = [buyer(1, first)]
    w.run()
    ended = w.db.last_end
    assert ended is not None
    w.later(20)
    w.provider.leads = [buyer(1, first), buyer(2, w.clock.now - timedelta(minutes=2))]
    w.provider.leads[0] = ExternalLead("QID-0001", "W", "Invented Buyer 1", "+00 98765 00001", None, "IN", "Need 20 sarees", ended - timedelta(minutes=3))   # inside the five-minute overlap: IndiaMART hands it back
    out = w.run()
    start, _ = w.provider.asked[1]
    assert start == ended - timedelta(minutes=5)
    assert out["created"] == 1 and out["existing"] == 1
    assert sorted(x["external_id"] for x in w.db.leads) == ["QID-0001", "QID-0002"]


def test_a_retry_after_a_crash_between_the_asking_and_the_taking_makes_no_second_lead() -> None:
    w = World()
    w.provider.leads = [buyer(1, w.clock.now - timedelta(hours=1))]
    real_apply = w.db.apply
    calls = {"n": 0}

    def flaky(*a: Any) -> dict[str, Any]:
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("the database went away")
        return real_apply(*a)

    w.puller._repo.apply = flaky   # type: ignore[assignment]  # noqa: SLF001
    assert w.run()["failed"] == 1 and w.db.leads == []
    w.later(20)
    assert w.run()["created"] == 1
    w.later(20)
    assert w.run()["created"] == 0 and len(w.db.leads) == 1


def test_a_pass_inside_the_fifteen_minutes_asks_nothing() -> None:
    w = World()
    w.run()
    w.later(10)
    assert w.run()["businesses"] == 0 and len(w.provider.asked) == 1
    w.later(6)
    assert w.run()["businesses"] == 1 and len(w.provider.asked) == 2


def test_a_key_indiamart_refuses_is_expired_and_left_alone_until_a_new_one_is_saved() -> None:
    w = World()
    w.provider.error = "unauthorized"
    assert w.run()["expired"] == 1 and w.db.key_state == "expired"
    asked = len(w.provider.asked)
    for _ in range(4):   # nothing for six hours but one look: the key is not hammered
        w.later(20)
        assert w.run()["businesses"] == 0
    assert len(w.provider.asked) == asked
    w.db.key_saved_at = w.clock.now   # the owner pastes a new key
    w.later(16)
    w.provider.error = None
    w.provider.leads = [buyer(3, w.clock.now - timedelta(minutes=30))]
    assert w.run()["created"] == 1 and w.db.key_state == "ok"


def test_an_expired_key_is_looked_at_once_after_six_hours() -> None:
    w = World()
    w.provider.error = "unauthorized"
    w.run()
    w.later(6 * 60 + 1)
    assert w.run()["businesses"] == 1 and len(w.provider.asked) == 2


def test_a_saved_key_that_cannot_be_found_is_expired_not_a_crash() -> None:
    w = World()
    w.store.delete(SECRET)
    assert w.run()["expired"] == 1 and w.db.key_state == "expired" and w.provider.asked == []


@pytest.mark.parametrize("code", ["timeout", "unavailable", "rate_limited", "bad_response"])
def test_a_failure_that_is_not_the_keys_changes_nothing_and_is_asked_again_for_the_same_window(code: str) -> None:
    w = World()
    w.provider.error = code
    assert w.run()["failed"] == 1 and w.db.key_state is None and w.db.last_end is None
    w.later(16)
    w.provider.error = None
    w.provider.leads = [buyer(1, w.clock.now - timedelta(hours=20))]
    assert w.run()["created"] == 1   # the window is still the last 24 hours: nothing was lost


def test_an_unreadable_secret_store_is_not_the_keys_fault() -> None:
    w = World()

    class Down(FakeSecretStore):
        def access(self, name: str) -> str | None:
            raise SecretStoreError("read_refused")

    w.puller._store = Down()   # noqa: SLF001
    assert w.run()["failed"] == 1 and w.db.key_state is None and w.provider.asked == []


def test_a_window_with_a_refused_buyer_is_asked_for_again() -> None:
    w = World()
    w.provider.leads = [buyer(1, w.clock.now - timedelta(hours=1))]
    w.db.refuse_blocked = True
    w.run()
    assert w.db.last_end is None
    w.db.refuse_blocked = False
    w.later(16)
    assert w.run()["created"] == 1


def test_a_business_with_no_active_source_or_a_closed_real_data_gate_is_not_asked() -> None:
    w = World()
    w.db.gate_open = False
    assert w.run()["businesses"] == 0
    w.db.gate_open, w.db.source_active = True, False
    assert w.run()["businesses"] == 0 and w.provider.asked == []


def test_a_refused_token_reaches_the_worker_and_other_crashes_do_not() -> None:
    w = World()

    def refused(*_a: Any) -> list[dict[str, Any]]:
        raise TokenRejected()

    w.puller._repo.links = refused   # type: ignore[assignment]  # noqa: SLF001
    with pytest.raises(TokenRejected):
        w.run()


def test_the_switch_is_off_by_default_and_on_needs_a_secret_store() -> None:
    service = LeadSourcesService(FakeLeadSourcesRepository(), receiver=Receiver())
    off = Settings(_env_file=None, api_env="development")   # type: ignore[call-arg]
    assert off.indiamart_pull == "off" and build_indiamart_puller(off, "http://x", "k", service) is None
    on = Settings(_env_file=None, api_env="development", indiamart_pull="on")   # type: ignore[call-arg]
    assert build_indiamart_puller(on, "http://x", "k", service) is None, "no secret store: nothing is pulled"
    assert build_indiamart_puller(on, "http://x", "k", service, store=FakeSecretStore()) is not None
    fake = Settings(_env_file=None, api_env="development", indiamart_pull="on", workspace_secrets="fake")   # type: ignore[call-arg]
    assert build_indiamart_puller(fake, "http://x", "k", service) is not None


def test_the_worker_runs_the_pass_after_its_tick_and_a_crash_does_not_fail_the_tick() -> None:
    from app.outbox.adapter import LocalFakeAdapter
    from app.scheduler.worker import Worker
    from tests.scheduler_fakes import FakeScheduler
    from tests.test_scheduler_tick import FakeSession

    w = World()
    w.provider.leads = [buyer(1, w.clock.now - timedelta(hours=1))]
    assert Worker(FakeScheduler(), LocalFakeAdapter(), FakeSession(), interval_seconds=60, indiamart_pull=w.puller).tick_once() is not None
    assert len(w.db.leads) == 1

    def boom(*_a: Any) -> list[dict[str, Any]]:
        raise RuntimeError("down")

    w.puller._repo.links = boom   # type: ignore[assignment]  # noqa: SLF001
    assert Worker(FakeScheduler(), LocalFakeAdapter(), FakeSession(), interval_seconds=60, indiamart_pull=w.puller).tick_once() is not None


def test_the_card_asks_for_a_new_key_when_the_pull_found_it_refused_and_says_nothing_otherwise() -> None:
    sources = [{"kind": "indiamart", "status": "active"}]
    on = cards_mod.Available(indiamart=True)
    card = next(c for c in cards_mod.build_cards(sources, {"indiamart_pull": {"key_state": "expired"}}, on) if c["kind"] == "indiamart")
    assert card["status"] == "needs_attention" and card["state"] == "needs_attention" and card["problem"]["code"] == "key_expired"
    assert card["problem"]["fix"]["type"] == "paste_key" and card["text"]["problem_message"]["code"] == "problem.indiamart_key_expired" and card["text"]["headline"]["code"] == "card.needs_new_key"
    for stats in ({}, {"indiamart_pull": {"key_state": "ok"}}, {"indiamart_pull": {"key_state": None}}):
        ok = next(c for c in cards_mod.build_cards(sources, stats, on) if c["kind"] == "indiamart")
        assert ok["status"] == "connected" and ok["problem"] is None
    gone = next(c for c in cards_mod.build_cards([], {"indiamart_pull": {"key_state": "expired"}}, on) if c["kind"] == "indiamart")
    assert gone["status"] == "not_connected"


def test_the_card_list_reads_the_pull_state_only_for_a_business_with_an_active_source_and_never_fails_for_it() -> None:
    repo = FakeLeadSourcesRepository()
    repo.indiamart_answer = {"key_state": "expired"}
    service = LeadSourcesService(repo, receiver=Receiver(), indiamart_available=True)
    assert service.cards("t", TENANT) and repo.status_asked == 0
    repo.sources_["s1"] = {"id": str(uuid.uuid4()), "kind": "indiamart", "status": "active", "tag": "indiamart", "label": "IndiaMART", "received_count": 0, "token_hint": None, "consent_id": None}
    card = next(c for c in service.cards("t", TENANT) if c["kind"] == "indiamart")
    assert repo.status_asked == 1 and card["status"] == "needs_attention"
    repo.indiamart_answer = RuntimeError("down")
    assert next(c for c in service.cards("t", TENANT) if c["kind"] == "indiamart")["status"] == "connected"
