"""Extra lines (26 Nov 2026): a workspace's "calls at once" is its own count, enforced by the call gate (inbound hears the line is busy, outbound is refused with a plain reason), the deployment's
cap stays above it; an Owner adds a line from the credits (refused plainly without credits), cancels it for the end of the month; the channel purchase goes through a port with a FAKE provider and the VoiceLink
adapter is a skeleton behind a switch that never buys. Fakes only: no network, no key, nobody is dialled and nothing is bought."""

# ruff: noqa: E501

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest

from app.extra_lines.channel import ChannelRefused, FakeChannels, VoicelinkChannels
from app.extra_lines.service import ExtraLinesService, LinesBlocked
from app.telephony import gate
from app.telephony.line_limits import WorkspaceLines
from app.telephony.live import LiveCalls
from app.telephony.plivo_api import FakePlivoApi
from app.telephony.plivo_outbound import OutboundRefused, PlivoOutbound
from app.telephony.voicelink_api import VoicelinkError
from app.telephony.voicelink_routes import admit
from tests.fakes import TENANT_A, auth, make_client
from tests.test_ph_inbound import FakeStore
from tests.test_pl_inbound import BASE, OWNER
from tests.test_pl_outbound import INDIA_10AM, FakeRepo

URL = f"/v1/tenants/{TENANT_A.id}/extra-lines"
LINES_URL = f"/v1/tenants/{TENANT_A.id}/phone-lines"
TENANT = TENANT_A.id
LINE = "+918065590140"
CALLER = "+919000000998"
NOW = datetime.now(UTC)
KEY = "press-0001-abcdef"


# ---------------------------------------------------------------------------------------------------------------------------------- the gate
def settings(max_concurrent: int = 8) -> gate.Settings:
    return gate.Settings(mode="live", live_confirmed=True, sandbox_numbers=frozenset(), max_concurrent=max_concurrent, outbound=True)


def inbound_facts(**kw: Any) -> gate.InboundFacts:
    return gate.InboundFacts(to_number=LINE, now=NOW, line_known=True, inbound_on=True, from_number=CALLER, **kw)


def test_an_inbound_call_beyond_the_workspaces_lines_hears_busy_and_below_it_is_answered() -> None:
    assert isinstance(gate.check_inbound(settings(), inbound_facts(workspace_lines=2, active_calls_workspace=1)), gate.InboundDecision)
    full = gate.check_inbound(settings(), inbound_facts(workspace_lines=2, active_calls_workspace=2))
    assert isinstance(full, gate.Refused) and full.reason == "too_many_calls"


def test_the_deployments_cap_stays_above_every_workspaces_lines() -> None:
    over = gate.check_inbound(settings(max_concurrent=3), inbound_facts(workspace_lines=20, active_calls_workspace=1, active_calls_total=3))
    assert isinstance(over, gate.Refused) and over.reason == "too_many_calls", "20 lines in this workspace do not lift the deployment's safety cap"


def test_a_workspace_without_a_count_is_limited_by_the_deployment_alone() -> None:
    assert isinstance(gate.check_inbound(settings(), inbound_facts(workspace_lines=None, active_calls_workspace=99)), gate.InboundDecision)


def test_the_gate_of_an_outbound_call_counts_the_workspaces_lines_too() -> None:
    placer, repo, _ = outbound(lines=2, active=2)
    with pytest.raises(OutboundRefused) as full:
        placer.place("tok", TENANT, OWNER, approval_kind="owner_test", business="Padma Silks")
    assert full.value.reason == "too_many_calls"
    assert [r["refuse_reason"] for r in repo.rows.values()] == ["too_many_calls"], "the refusal is kept on a call row with its closed word"


def outbound(*, lines: int | None, active: int, total_calls: int = 0, rpc_down: bool = False) -> tuple[PlivoOutbound, FakeRepo, FakePlivoApi]:
    repo, api = FakeRepo(), FakePlivoApi()
    gs = gate.Settings(mode="sandbox", sandbox_numbers=frozenset({OWNER}), max_concurrent=8, outbound=True)
    limits = None
    if lines is not None:
        rpc = SimpleNamespace(call=lambda token, fn, args: (_ for _ in ()).throw(RuntimeError("down")) if rpc_down else lines)
        limits = WorkspaceLines(rpc, lambda: "system")
    placer = PlivoOutbound(api=api, repo=repo, gate_settings=gs, public_base=BASE, active_calls=lambda: total_calls, clock=lambda: INDIA_10AM, lines=limits, active_for_tenant=(lambda t: active) if limits else None)
    return placer, repo, api


def test_an_outbound_call_is_placed_while_the_workspace_has_a_free_line() -> None:
    placer, repo, api = outbound(lines=3, active=2)
    placed = placer.place("tok", TENANT, OWNER, approval_kind="owner_test", business="Padma Silks")
    assert repo.rows[placed.call_id]["state"] == "ringing" and len(api.placed) == 1


def test_a_lookup_of_the_lines_that_fails_never_refuses_a_call() -> None:
    placer, repo, api = outbound(lines=3, active=99, rpc_down=True)
    placer.place("tok", TENANT, OWNER, approval_kind="owner_test", business="Padma Silks")
    assert len(api.placed) == 1, "an unreadable count falls back to the deployment's own cap"


# ---------------------------------------------------------------------------------------------------------------------------------- the VoiceLink inbound admission
def admit_with(lines: int | None, active_here: int, total: int = 0, max_concurrent: int = 8) -> Any:
    line = {"tenant_id": str(TENANT), "inbound_on": True, "provider": "voicelink", "kyc_blocked": False}
    if lines is not None:
        line["lines"] = lines
    start = SimpleNamespace(from_number=CALLER, to_number=LINE)
    live = LiveCalls()
    for _ in range(active_here):
        live.add(TENANT, uuid.uuid4(), SimpleNamespace())  # type: ignore[arg-type]
    return asyncio.run(admit(start, settings(max_concurrent), find_line=FakeStore(line=line).line_find, active_calls=total, now=NOW, tenant_active=live.count_for_tenant))


def test_the_voicelink_admission_reads_the_workspaces_lines_from_the_line_row() -> None:
    assert admit_with(lines=2, active_here=1).tenant_id == TENANT
    refused = admit_with(lines=2, active_here=2)
    assert isinstance(refused, gate.Refused) and refused.reason == "too_many_calls"
    assert admit_with(lines=None, active_here=5).tenant_id == TENANT, "the old behaviour when no count is given"
    other = admit_with(lines=3, active_here=3)
    assert isinstance(other, gate.Refused)


# ---------------------------------------------------------------------------------------------------------------------------------- the counters
def test_live_calls_count_per_workspace_from_this_process_and_from_the_database() -> None:
    live = LiveCalls()
    other = uuid.uuid4()
    live.add(TENANT, uuid.uuid4(), SimpleNamespace())  # type: ignore[arg-type]
    live.add(other, uuid.uuid4(), SimpleNamespace())  # type: ignore[arg-type]
    assert live.count_for_tenant(TENANT) == 1 and live.count_for_tenant(other) == 1
    live.tenant_live, live.tenant_at = {str(TENANT): 3}, 1.0e12   # a far-future monotonic stamp stands for "just refreshed"
    assert live.count_for_tenant(TENANT) == 3, "a call on another instance is counted from the database"
    live.tenant_at = 0.0
    assert live.count_for_tenant(TENANT) == 1, "a stale database count is ignored"


def test_the_lines_are_remembered_for_a_few_seconds_and_forgotten_when_one_is_bought() -> None:
    asked: list[str] = []
    clock = [0.0]

    def call(token: str, fn: str, args: dict[str, Any]) -> int:
        asked.append(fn)
        return 4

    limits = WorkspaceLines(SimpleNamespace(call=call), lambda: "system", clock=lambda: clock[0])
    assert limits.total(TENANT) == 4 and limits.total(TENANT) == 4 and asked == ["phone_workspace_lines"]
    clock[0] = 20.0
    assert limits.total(TENANT) == 4 and len(asked) == 2
    limits.forget(TENANT)
    limits.total(TENANT)
    assert len(asked) == 3


# ---------------------------------------------------------------------------------------------------------------------------------- the service and the routes
class Repo:
    """The database's rules in miniature: charge, record, refund, cancel."""

    def __init__(self, *, balance: int = 50000, enabled: bool = True, numbers: int = 1, cap: int = 20) -> None:
        self.balance, self.enabled, self.numbers, self.cap = balance, enabled, numbers, cap
        self.rows: dict[uuid.UUID, dict[str, Any]] = {}
        self.keys: dict[str, uuid.UUID] = {}
        self.price = 14900
        self.released_ids: list[uuid.UUID] = []
        self.renew_answer: dict[str, Any] = {"renewed": 0, "grace": 0, "paused": 0, "ended": 0, "pending": [], "release": []}

    def _json(self, r: dict[str, Any], replayed: bool = False) -> dict[str, Any]:
        return {**r, "working": r["status"] in ("active", "grace") and r["channel_state"] == "bought", "replayed": replayed}

    def get(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        live = [r for r in self.rows.values() if r["status"] != "ended"]
        working = [r for r in live if r["channel_state"] == "bought"]
        return {"enabled": self.enabled, "price_paise": self.price, "cap": self.cap, "numbers": self.numbers, "included": 2 * self.numbers, "total": 2 * self.numbers + len(working),
                "can_add": self.enabled and self.numbers > 0 and 2 * self.numbers + len(live) < self.cap, "extra": [self._json(r) for r in live]}

    def buy(self, token: str, tenant_id: uuid.UUID, key: str) -> dict[str, Any]:
        if key in self.keys:
            return self._json(self.rows[self.keys[key]], True)
        if not self.enabled:
            raise LinesBlocked("paused")
        if self.numbers == 0:
            raise LinesBlocked("no_number")
        if 2 * self.numbers + len([r for r in self.rows.values() if r["status"] != "ended"]) + 1 > self.cap:
            raise LinesBlocked("at_limit")
        if self.balance < self.price:
            raise LinesBlocked("not_enough_credits")
        self.balance -= self.price
        row = {"id": str(uuid.uuid4()), "status": "active", "price_paise": self.price, "paid_until": "2026-12-26T00:00:00Z", "cancel_at_period_end": False, "grace_until": None, "channel_state": "pending"}
        self.rows[uuid.UUID(str(row["id"]))] = row
        self.keys[key] = uuid.UUID(str(row["id"]))
        return self._json(row)

    def channel_result(self, token: str, line_id: uuid.UUID, ok: bool, ref: str | None) -> dict[str, Any]:
        row = self.rows[line_id]
        if row["channel_state"] == "pending":
            row["channel_state"] = "bought" if ok else "failed"
            if not ok:
                row["status"] = "ended"
                self.balance += row["price_paise"]
        return self._json(row)

    def cancel(self, token: str, tenant_id: uuid.UUID, line_id: uuid.UUID, cancel: bool) -> dict[str, Any]:
        if line_id not in self.rows:
            raise LinesBlocked("not_found")
        self.rows[line_id]["cancel_at_period_end"] = cancel
        return self._json(self.rows[line_id])

    def renew(self, token: str, limit: int) -> dict[str, Any]:
        return self.renew_answer

    def released(self, token: str, line_id: uuid.UUID) -> None:
        self.released_ids.append(line_id)


def world(repo: Repo | None = None, channels: FakeChannels | None = None, forgotten: list[uuid.UUID] | None = None, alerts: list[str] | None = None, production: bool = False) -> tuple[Any, Repo, FakeChannels, ExtraLinesService]:
    repo, channels = repo or Repo(), channels or FakeChannels()
    service = ExtraLinesService(repo, channels, alert=(alerts.append if alerts is not None else None), forget=(forgotten.append if forgotten is not None else None), is_production=production)
    client, _ = make_client(extra_lines=service)
    return client, repo, channels, service


def test_the_overview_gives_the_price_in_rupees_the_limit_and_the_lines() -> None:
    client, *_ = world()
    r = client.get(URL, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json() == {"enabled": True, "price_rupees": 149, "cap": 20, "numbers": 1, "included": 2, "total": 2, "can_add": True, "extra": []}
    assert r.headers["cache-control"] == "no-store"
    assert client.get(URL, headers=auth("a_admin")).status_code == 200
    for user in ("a_sales", "a_viewer"):
        assert client.get(URL, headers=auth(user)).status_code == 403


def test_the_routes_answer_404_when_the_switch_is_off() -> None:
    client, _ = make_client()
    assert client.get(URL, headers=auth("a_owner")).status_code == 404
    assert client.post(URL, json={"key": KEY}, headers=auth("a_owner")).status_code == 404


def test_an_owner_adds_a_line_it_is_paid_then_the_channel_is_bought_and_the_line_works() -> None:
    forgotten: list[uuid.UUID] = []
    client, repo, channels, _ = world(forgotten=forgotten)
    r = client.post(URL, json={"key": KEY}, headers=auth("a_owner"))
    assert r.status_code == 201 and r.json()["working"] is True and r.json()["status"] == "active"
    assert repo.balance == 50000 - 14900, "Rs 149 left the credits"
    assert len(channels.bought) == 1, "the channel was asked for after the charge"
    assert forgotten == [TENANT], "the call gate asks again for this workspace's lines"
    assert client.get(URL, headers=auth("a_owner")).json()["total"] == 3


def test_the_same_press_twice_is_one_line_and_one_charge() -> None:
    client, repo, channels, _ = world()
    a = client.post(URL, json={"key": KEY}, headers=auth("a_owner")).json()
    b = client.post(URL, json={"key": KEY}, headers=auth("a_owner")).json()
    assert a["id"] == b["id"] and repo.balance == 50000 - 14900 and len(channels.bought) == 1


def test_only_the_owner_adds_or_cancels() -> None:
    client, repo, _, _ = world()
    for user in ("a_admin", "a_sales", "a_viewer"):
        assert client.post(URL, json={"key": KEY}, headers=auth(user)).status_code == 403
    assert repo.balance == 50000 and repo.rows == {}


def test_without_enough_credits_it_is_refused_in_plain_words_and_nothing_is_taken_or_bought() -> None:
    client, repo, channels, _ = world(Repo(balance=100))
    r = client.post(URL, json={"key": KEY}, headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "lines_unavailable" and r.json()["error"]["reason"] == "not_enough_credits"
    assert "Add credits" in r.json()["error"]["message"] and "Rs" not in r.json()["error"]["message"]
    assert repo.balance == 100 and channels.bought == [] and repo.rows == {}


@pytest.mark.parametrize(("repo", "reason"), [(Repo(enabled=False), "paused"), (Repo(numbers=0), "no_number"), (Repo(cap=2), "at_limit")])
def test_every_other_refusal_is_a_closed_word_with_a_sentence(repo: Repo, reason: str) -> None:
    client, *_ = world(repo)
    r = client.post(URL, json={"key": KEY}, headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["reason"] == reason and r.json()["error"]["message"]


def test_a_channel_that_could_not_be_bought_gives_the_money_back_and_the_line_never_counts() -> None:
    alerts: list[str] = []
    client, repo, channels, _ = world(channels=FakeChannels(refuse="not_built"), alerts=alerts)
    r = client.post(URL, json={"key": KEY}, headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["reason"] == "unavailable" and "not charged" in r.json()["error"]["message"]
    assert repo.balance == 50000, "the first month went back"
    assert client.get(URL, headers=auth("a_owner")).json()["total"] == 2
    assert len(alerts) == 1 and "not_built" in alerts[0] and "@" not in alerts[0]


def test_in_production_with_the_fake_provider_the_team_is_told_to_buy_the_channel_by_hand() -> None:
    alerts: list[str] = []
    client, *_ = world(alerts=alerts, production=True)
    assert client.post(URL, json={"key": KEY}, headers=auth("a_owner")).status_code == 201
    assert len(alerts) == 1 and "by hand" in alerts[0]


def test_cancel_works_to_the_end_of_the_month_and_keep_takes_it_back() -> None:
    client, *_ = world()
    line = client.post(URL, json={"key": KEY}, headers=auth("a_owner")).json()
    gone = client.post(f"{URL}/{line['id']}/cancel", headers=auth("a_owner"))
    assert gone.status_code == 200 and gone.json()["cancel_at_period_end"] is True and gone.json()["working"] is True
    assert client.get(URL, headers=auth("a_owner")).json()["total"] == 3, "it still works until the month ends"
    assert client.post(f"{URL}/{line['id']}/keep", headers=auth("a_owner")).json()["cancel_at_period_end"] is False
    assert client.post(f"{URL}/{uuid.uuid4()}/cancel", headers=auth("a_owner")).status_code == 404
    assert client.post(f"{URL}/{line['id']}/cancel", headers=auth("a_admin")).status_code == 403


def test_the_lines_card_shows_this_workspaces_lines_and_its_own_calls() -> None:
    live = LiveCalls()
    live.add(TENANT, uuid.uuid4(), SimpleNamespace())  # type: ignore[arg-type]
    live.add(uuid.uuid4(), uuid.uuid4(), SimpleNamespace())  # type: ignore[arg-type]   # another workspace's call is not shown here
    service = ExtraLinesService(Repo(), FakeChannels())
    client, _ = make_client(extra_lines=service, live_calls=live, phone_inbound=SimpleNamespace(gate_settings=SimpleNamespace(max_concurrent=8)))
    r = client.get(LINES_URL, headers=auth("a_owner"))
    assert r.json() == {"total": 2, "in_use": 1, "lines": [{"n": 1, "state": "on_call"}, {"n": 2, "state": "open"}]}, "the workspace's own two lines, not the deployment's eight"


def test_with_the_switch_off_the_card_is_the_deployments_count_as_before() -> None:
    client, _ = make_client(live_calls=LiveCalls(), phone_inbound=SimpleNamespace(gate_settings=SimpleNamespace(max_concurrent=3)))
    assert client.get(LINES_URL, headers=auth("a_owner")).json()["total"] == 3


# ---------------------------------------------------------------------------------------------------------------------------------- the worker's pass
def test_the_monthly_pass_retries_a_paid_line_without_a_channel_and_gives_a_channel_back() -> None:
    repo = Repo()
    pending, ended = uuid.uuid4(), uuid.uuid4()
    repo.rows[pending] = {"id": str(pending), "status": "active", "price_paise": 14900, "paid_until": "x", "cancel_at_period_end": False, "grace_until": None, "channel_state": "pending"}
    repo.renew_answer = {"renewed": 1, "grace": 0, "paused": 0, "ended": 1, "pending": [{"id": str(pending), "tenant_id": str(TENANT)}], "release": [{"id": str(ended), "tenant_id": str(TENANT)}]}
    _, _, channels, service = world(repo)
    assert service.renew("system") == 2
    assert repo.rows[pending]["channel_state"] == "bought" and channels.bought == [pending]
    assert channels.released == [ended] and repo.released_ids == [ended]


def test_a_channel_that_cannot_be_given_back_stays_in_the_list_and_the_team_is_told_once() -> None:
    repo = Repo()
    ended = uuid.uuid4()
    repo.renew_answer = {"renewed": 0, "grace": 0, "paused": 0, "ended": 0, "pending": [], "release": [{"id": str(ended), "tenant_id": str(TENANT)}]}
    alerts: list[str] = []
    skeleton = VoicelinkChannels(SimpleNamespace(), enabled=True, client_for=lambda token, tenant: 1)  # type: ignore[arg-type]
    service = ExtraLinesService(repo, skeleton, alert=alerts.append)
    service.renew("system")
    service.renew("system")
    assert repo.released_ids == [] and len(alerts) == 1


# ---------------------------------------------------------------------------------------------------------------------------------- the VoiceLink adapter never buys
class WalletOnly:
    """Everything a purchase would need is missing: a call to anything but the wallet read fails the test."""

    def __init__(self, balance: float = 5000.0, error: bool = False) -> None:
        self.balance, self.error = balance, error
        self.calls: list[str] = []

    def wallet(self) -> Any:
        self.calls.append("wallet")
        if self.error:
            raise VoicelinkError("unreachable")
        return SimpleNamespace(balance=self.balance, currency="INR")

    def __getattr__(self, name: str) -> Any:
        if name.startswith("__"):
            raise AttributeError(name)
        raise AssertionError(f"the channel adapter must not call {name}")


def adapter(api: Any, *, enabled: bool = True, client: int | None = 77) -> VoicelinkChannels:
    return VoicelinkChannels(api, enabled=enabled, client_for=lambda token, tenant: client)


@pytest.mark.parametrize(("kw", "api", "reason"), [
    (dict(enabled=False), WalletOnly(), "switch_off"),
    (dict(client=None), WalletOnly(), "no_account"),
    (dict(), WalletOnly(balance=10.0), "wallet_low"),
    (dict(), WalletOnly(error=True), "vendor_unavailable"),
    (dict(), WalletOnly(), "not_built"),
])
def test_the_voicelink_adapter_is_a_skeleton_every_path_refuses_and_nothing_is_bought(kw: dict[str, Any], api: WalletOnly, reason: str) -> None:
    with pytest.raises(ChannelRefused) as refused:
        adapter(api, **kw).buy(tenant_id=TENANT, line_id=uuid.uuid4(), token="t")
    assert refused.value.reason == reason
    assert set(api.calls) <= {"wallet"}, "only the read-only wallet check was made"
    with pytest.raises(ChannelRefused):
        adapter(api, **kw).release(tenant_id=TENANT, line_id=uuid.uuid4(), ref=None, token="t")


def test_the_wiring_uses_the_fake_provider_unless_the_switch_and_the_login_are_both_given() -> None:
    from app.extra_lines.wiring import build_extra_lines

    base = dict(voicelink_username=None, voicelink_password=None, picker_wallet_floor_inr=1000, admin_environment="staging", voicelink_api_base="https://example.test/api/v1")
    off = SimpleNamespace(extra_lines=False, voicelink_channel_buy=False, is_development=True, **base)
    assert build_extra_lines(off, "https://db.test/rest/v1", "anon") is None  # type: ignore[arg-type]
    on = SimpleNamespace(extra_lines=True, voicelink_channel_buy=True, is_development=True, **base)
    service = build_extra_lines(on, "https://db.test/rest/v1", "anon")  # type: ignore[arg-type]
    assert service is not None and isinstance(service._channels, FakeChannels), "the switch without a login stays on the fake provider"


def test_a_line_that_could_not_be_renewed_is_a_needs_you_item_with_one_plain_sentence() -> None:
    from app.today.service import needs_item

    item = needs_item({"kind": "line_renewal", "id": str(uuid.uuid4()), "customer": "Balance", "city": None, "agent": "followup_desk", "ref": "lines", "amount_paise": None, "at": NOW.isoformat(),
                       "target": {"type": "billing", "id": str(TENANT)}})
    assert item.kind == "line_renewal" and item.target.type == "billing"
    assert "not enough credits" in item.summary and "Add credits" in item.summary
