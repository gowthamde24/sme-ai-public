"""Job DS part E2: running out before the month ends. The routes (roles, the second factor, strict input, fixed refusals), the service (the FAKE payment before the record, a retry never charges twice), the fake provider's
one-off charge and plan change, the alerts (words in three languages, a channel is marked after it went, a failed send is not marked), the worker, Today's new kinds and the contract. The database's own rules (the
order of consumption, expiry, caps, pro-rata, GST, queueing) are proved in supabase/tests/database/129_ds_topups.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import logging
import uuid
from datetime import date
from typing import Any

import pytest

from app.billing import fake
from app.billing.alerts import (
    FakeOwnerWhatsApp,
    UsageAlerts,
    compose_usage_alert,
    compose_usage_whatsapp,
)
from app.billing.errors import PaymentMethodDeclinedError
from app.billing.fake import FakeBillingProvider
from app.billing.mail import FakeEmailSender
from app.billing.provider import OneOffCharge
from app.billing.service import BillingService
from app.outbox.adapter import LocalFakeAdapter
from app.scheduler.worker import Worker
from app.tenancy.repository import UpstreamError
from app.today.models import NeedsYouItem
from app.today.service import needs_item
from tests.di_fakes import FakeBillingRepository
from tests.fakes import TENANT_A, auth, make_client
from tests.scheduler_fakes import FakeScheduler
from tests.test_scheduler_tick import FakeSession

A = TENANT_A.id
B = f"/v1/tenants/{A}/billing"
ALL = ("a_owner", "a_admin", "a_sales", "a_viewer")
OK = fake.OK


def world() -> tuple[Any, FakeBillingRepository, FakeBillingProvider]:
    repo = FakeBillingRepository()
    provider = FakeBillingProvider()
    client, _ = make_client(billing=BillingService(repo, provider))
    return client, repo, provider


def start(client: Any, plan: str = "starter") -> None:
    assert client.post(f"{B}/trial", json={"plan_id": plan, "checkout_ref": OK}, headers=auth("a_owner")).status_code == 200


def buy_body(pack: str = "minutes_300", pid: uuid.UUID | None = None, ref: str = OK) -> dict[str, Any]:
    return {"purchase_id": str(pid or uuid.uuid4()), "pack_code": pack, "checkout_ref": ref}


SETTINGS = {"auto_minutes_pack": "minutes_100", "auto_messages_pack": None, "auto_monthly_cap_paise": 200000, "overage_minutes": True, "overage_messages": False, "overage_monthly_cap_paise": 50000}


# ============================================================================ who may do what
@pytest.mark.parametrize(("method", "path", "who"), [("GET", f"{B}/topups", ("a_owner", "a_admin")), ("GET", f"{B}/invoices", ("a_owner", "a_admin")),
                                                      ("GET", f"{B}/upgrade-preview?plan_id=growth", ("a_owner", "a_admin"))])
def test_owner_and_admin_read(method: str, path: str, who: tuple[str, ...]) -> None:
    for user in ALL:
        client, _repo, _p = world()
        start(client)
        r = client.request(method, path, headers=auth(user))
        assert r.status_code == (200 if user in who else 403), (user, r.status_code, r.text)
    client, _repo, _p = world()
    assert client.request(method, path, headers=auth("b_owner")).status_code == 404
    assert client.request(method, path).status_code == 401


def test_only_the_owner_with_a_second_factor_buys_changes_settings_or_upgrades() -> None:
    for user in ("a_admin", "a_sales", "a_viewer"):
        client, repo, _p = world()
        start(client)
        before = len(repo.calls)
        assert client.post(f"{B}/topups", json=buy_body(), headers=auth(user)).status_code == 403
        assert client.put(f"{B}/topups/settings", json=SETTINGS, headers=auth(user)).status_code == 403
        assert client.post(f"{B}/upgrade", json={"plan_id": "growth", "checkout_ref": OK}, headers=auth(user)).status_code == 403
        assert len(repo.calls) == before, "a refused caller never reaches the data layer"
    client, repo, provider = world()
    start(client)
    assert client.post(f"{B}/topups", json=buy_body(), headers=auth("a_owner", aal="aal1")).status_code == 403
    assert client.put(f"{B}/topups/settings", json=SETTINGS, headers=auth("a_owner", aal="aal1")).status_code == 403
    assert client.post(f"{B}/upgrade", json={"plan_id": "growth", "checkout_ref": OK}, headers=auth("a_owner", aal="aal1")).status_code == 403
    assert provider.charges == {}, "nothing was charged"


# ============================================================================ buying
def test_a_purchase_is_201_then_200_with_the_same_answer_and_charges_once() -> None:
    client, repo, provider = world()
    start(client)
    pid = uuid.uuid4()
    first = client.post(f"{B}/topups", json=buy_body("minutes_300", pid), headers=auth("a_owner"))
    assert first.status_code == 201, first.text
    assert first.json()["purchase"]["pack_code"] == "minutes_300" and first.json()["invoice"]["total_paise"] == 127440 and first.json()["invoice"]["fake"] is True
    again = client.post(f"{B}/topups", json=buy_body("minutes_300", pid), headers=auth("a_owner"))
    assert again.status_code == 200 and again.json() == first.json()
    assert len(provider.charges) == 1, "the fake provider took ONE payment"
    assert list(provider.charges.values())[0].amount_paise == 127440
    assert [c for c in repo.calls if c[0] == "buy_topup"].__len__() == 2


def test_the_same_id_for_another_pack_is_refused_and_the_payment_is_not_taken_for_an_unknown_pack() -> None:
    client, _repo, provider = world()
    start(client)
    pid = uuid.uuid4()
    client.post(f"{B}/topups", json=buy_body("minutes_100", pid), headers=auth("a_owner"))
    r = client.post(f"{B}/topups", json=buy_body("minutes_300", pid), headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "purchase_id_used"
    unknown = client.post(f"{B}/topups", json=buy_body("minutes_99"), headers=auth("a_owner"))
    assert unknown.status_code == 422 and unknown.json()["error"]["code"] == "pack_unknown"
    assert len(provider.charges) == 1, "no payment for a pack that does not exist"


def test_a_declined_payment_records_nothing() -> None:
    client, repo, _p = world()
    start(client)
    r = client.post(f"{B}/topups", json=buy_body(ref=fake.DECLINED), headers=auth("a_owner"))
    assert r.status_code == 402 and r.json()["error"]["code"] == "payment_method_declined"
    assert not [c for c in repo.calls if c[0] == "buy_topup"], "the record was never asked for"


def test_no_plan_no_top_up() -> None:
    client, _repo, _p = world()
    r = client.post(f"{B}/topups", json=buy_body(), headers=auth("a_owner"))
    assert r.status_code == 409 and r.json()["error"]["code"] == "no_subscription"


@pytest.mark.parametrize("body", [{"pack_code": "minutes_100", "checkout_ref": OK}, {"purchase_id": "x", "pack_code": "minutes_100", "checkout_ref": OK}, {"purchase_id": str(uuid.uuid4()), "pack_code": "Minutes 100", "checkout_ref": OK},
                                  {"purchase_id": str(uuid.uuid4()), "pack_code": "minutes_100", "checkout_ref": "x"}, {"purchase_id": str(uuid.uuid4()), "pack_code": "minutes_100", "checkout_ref": OK, "extra": 1}])
def test_a_malformed_purchase_is_422(body: dict[str, Any]) -> None:
    client, _repo, provider = world()
    start(client)
    assert client.post(f"{B}/topups", json=body, headers=auth("a_owner")).status_code == 422
    assert provider.charges == {}


def test_the_packs_are_listed_in_order_with_gst() -> None:
    client, _repo, _p = world()
    start(client)
    body = client.get(f"{B}/topups", headers=auth("a_owner")).json()
    assert [p["code"] for p in body["packs"]] == ["minutes_100", "minutes_300", "minutes_1000", "messages_100", "messages_300", "messages_1000"]
    assert body["packs"][1]["gst_paise"] == 19440 and body["packs"][1]["price_is_placeholder"] is True
    assert body["settings"]["auto_minutes_pack"] is None and body["settings"]["overage_minutes"] is False, "both are OFF by default"


# ============================================================================ settings
def test_the_settings_are_saved_and_a_cap_is_needed() -> None:
    client, _repo, _p = world()
    start(client)
    saved = client.put(f"{B}/topups/settings", json=SETTINGS, headers=auth("a_owner"))
    assert saved.status_code == 200 and saved.json()["auto_minutes_pack"] == "minutes_100" and saved.json()["overage_monthly_cap_paise"] == 50000
    no_cap = client.put(f"{B}/topups/settings", json={**SETTINGS, "auto_monthly_cap_paise": 0}, headers=auth("a_owner"))
    assert no_cap.status_code == 422 and no_cap.json()["error"]["code"] == "cap_required"
    wrong_kind = client.put(f"{B}/topups/settings", json={**SETTINGS, "auto_minutes_pack": "messages_100"}, headers=auth("a_owner"))
    assert wrong_kind.status_code == 422 and wrong_kind.json()["error"]["code"] == "pack_unknown"


@pytest.mark.parametrize("patch", [{"auto_monthly_cap_paise": -1}, {"overage_monthly_cap_paise": 2_000_000_000}, {"overage_minutes": "yes"}, {"auto_monthly_cap_paise": 1.5}, {"unknown": 1}])
def test_bad_settings_are_422(patch: dict[str, Any]) -> None:
    client, repo, _p = world()
    start(client)
    assert client.put(f"{B}/topups/settings", json={**SETTINGS, **patch}, headers=auth("a_owner")).status_code == 422
    assert not [c for c in repo.calls if c[0] == "topup_settings"]


def test_all_six_settings_are_required() -> None:
    client, _repo, _p = world()
    start(client)
    assert client.put(f"{B}/topups/settings", json={"auto_minutes_pack": None}, headers=auth("a_owner")).status_code == 422


# ============================================================================ the upgrade
def test_the_preview_and_the_upgrade_during_the_trial_charge_nothing() -> None:
    client, repo, provider = world()
    start(client, "starter")
    pre = client.get(f"{B}/upgrade-preview?plan_id=growth", headers=auth("a_admin"))
    assert pre.status_code == 200 and pre.json()["prorated_paise"] == 0 and pre.json()["effective"] == "now"
    done = client.post(f"{B}/upgrade", json={"plan_id": "growth", "checkout_ref": OK}, headers=auth("a_owner"))
    assert done.status_code == 200 and done.json()["invoice"] is None
    assert provider.charges == {} and repo.subs[A]["plan_id"] == "growth"


def test_an_active_plan_is_charged_the_prorata_then_the_price_at_the_provider_changes() -> None:
    repo = FakeBillingRepository(price_paise=None)
    for plan, price in (("starter", 100000), ("growth", 300000)):
        next(p for p in repo.catalogue["plans"] if p["id"] == plan)["price_paise_monthly"] = price
    provider = FakeBillingProvider()
    client, _ = make_client(billing=BillingService(repo, provider))
    start(client, "starter")
    repo.subs[A]["status"] = "active"
    repo.plan_of[A] = "starter"
    ref = repo.subs[A]["provider_ref"]
    provider._subs.setdefault(ref, fake._Subscription(str(A), OK, 100000, None))   # noqa: SLF001 (the provider knows the subscription the trial created)
    pre = client.get(f"{B}/upgrade-preview?plan_id=growth", headers=auth("a_owner")).json()
    assert pre["prorated_paise"] == 116129 and pre["gst_paise"] == 20903 and pre["total_paise"] == 137032 and pre["price_set"] is True
    done = client.post(f"{B}/upgrade", json={"plan_id": "growth", "checkout_ref": OK}, headers=auth("a_owner"))
    assert done.status_code == 200 and done.json()["invoice"]["kind"] == "upgrade"
    assert [c.amount_paise for c in provider.charges.values()] == [137032]
    assert provider._subs[ref].price_paise == 300000, "from the next charge on, the new monthly price"   # noqa: SLF001
    assert client.post(f"{B}/upgrade", json={"plan_id": "growth", "checkout_ref": OK}, headers=auth("a_owner")).json()["error"]["code"] == "not_an_upgrade"


def test_upgrade_refusals() -> None:
    client, _repo, provider = world()
    no_plan = client.post(f"{B}/upgrade", json={"plan_id": "growth", "checkout_ref": OK}, headers=auth("a_owner"))
    assert no_plan.status_code == 409 and no_plan.json()["error"]["code"] == "no_subscription"
    start(client, "growth")
    same = client.post(f"{B}/upgrade", json={"plan_id": "starter", "checkout_ref": OK}, headers=auth("a_owner"))
    assert same.status_code == 409 and same.json()["error"]["code"] == "not_an_upgrade"
    unknown = client.post(f"{B}/upgrade", json={"plan_id": "platinum", "checkout_ref": OK}, headers=auth("a_owner"))
    assert unknown.status_code == 422 and unknown.json()["error"]["code"] == "plan_unknown"
    assert client.get(f"{B}/upgrade-preview?plan_id=Not%20A%20Plan", headers=auth("a_owner")).status_code == 422
    assert provider.charges == {}


# ============================================================================ invoices
def test_invoices_list_one_and_a_missing_one() -> None:
    client, _repo, _p = world()
    start(client)
    first = client.post(f"{B}/topups", json=buy_body("messages_100"), headers=auth("a_owner")).json()["invoice"]
    listed = client.get(f"{B}/invoices", headers=auth("a_admin")).json()
    assert [i["number"] for i in listed["items"]] == ["S19-2611-000001"] and listed["next_cursor"] is None
    assert client.get(f"{B}/invoices/{first['id']}", headers=auth("a_owner")).json()["total_paise"] == 7080
    assert client.get(f"{B}/invoices/{uuid.uuid4()}", headers=auth("a_owner")).status_code == 404
    assert client.get(f"{B}/invoices?cursor=@@@", headers=auth("a_owner")).status_code == 422


def test_a_broken_data_layer_is_a_502_without_its_words() -> None:
    client, repo, _p = world()
    start(client)

    def boom(*_a: Any, **_k: Any) -> Any:
        raise UpstreamError("down: secret words")

    repo.topups = boom   # type: ignore[method-assign]
    r = client.get(f"{B}/topups", headers=auth("a_owner"))
    assert r.status_code == 502 and "secret" not in r.text


def test_billing_routes_stay_open_in_a_read_only_workspace() -> None:
    client, repo, _p = world()
    start(client)
    repo.read_only.add(A)
    assert client.get(f"{B}/topups", headers=auth("a_owner")).status_code == 200
    assert client.post(f"{B}/topups", json=buy_body(), headers=auth("a_owner")).status_code == 201, "paying is how a workspace gets out of read-only"


# ============================================================================ the fake provider
def test_the_fake_provider_takes_one_payment_per_key_and_refuses_a_declined_method() -> None:
    p = FakeBillingProvider()
    charge = OneOffCharge("t1", OK, 47200, "Top-up", "topup:1")
    a = p.charge_once(charge)
    assert p.charge_once(charge) == a and len(p.charges) == 1
    assert p.charge_once(OneOffCharge("t1", OK, 47200, "Top-up", "topup:2")) != a
    with pytest.raises(PaymentMethodDeclinedError):
        p.charge_once(OneOffCharge("t1", fake.DECLINED, 100, "x", "topup:3"))
    with pytest.raises(PaymentMethodDeclinedError):
        p.charge_once(OneOffCharge("t1", "pm_unknown", 100, "x", "topup:4"))
    p.change_plan("sub_unknown", 1)   # an unknown reference does nothing


# ============================================================================ the alerts
def item(**kw: Any) -> dict[str, Any]:
    return {"tenant_id": str(uuid.uuid4()), "tenant_name": "Lakshmi Sarees", "kind": "call_minutes", "level": 80, "period_start": "2026-10-20", "projected_run_out_on": "2026-11-21", "queued": 0, "language": "en",
            "emails": ["owner@example.test"], "channels": ["email", "whatsapp"], **kw}


class Repo:
    def __init__(self, due: list[dict[str, Any]], closed: int = 0) -> None:
        self.due, self.closed = due, closed
        self.marked: list[tuple[str, int, str, str]] = []

    def alerts_due(self, token: str, limit: int) -> list[dict[str, Any]]:
        return self.due

    def alert_mark(self, token: str, tenant_id: uuid.UUID, kind: str, level: int, period_start: date, channel: str) -> None:
        self.marked.append((kind, level, str(period_start), channel))

    def topup_tick(self, token: str, limit: int) -> dict[str, Any]:
        return {"invoices": self.closed}


def test_the_80_percent_words_carry_the_run_out_date_in_three_languages() -> None:
    en = compose_usage_alert("Lakshmi Sarees", "call_minutes", 80, "2026-11-21", 0, "o@example.test", "en")
    assert en.subject == "Your call minutes are at 80 percent" and "run out on 2026-11-21" in en.body and "Lakshmi Sarees" in en.body
    te = compose_usage_alert("Lakshmi Sarees", "call_minutes", 80, "2026-11-21", 0, "o@example.test", "te")
    hi = compose_usage_alert("Lakshmi Sarees", "whatsapp_messages", 80, None, 0, "o@example.test", "hi")
    assert "80" in te.subject and "2026-11-21" in te.body and te.subject != en.subject
    assert "80" in hi.subject and "{" not in hi.body, "no placeholder is left"
    kn = compose_usage_alert("X", "call_minutes", 80, None, 0, "o@example.test", "kn")
    assert kn.subject == en.subject, "Kannada falls back to English until it is reviewed"


def test_the_100_percent_words_say_how_many_calls_wait() -> None:
    mail = compose_usage_alert("Lakshmi Sarees", "call_minutes", 100, None, 12, "o@example.test")
    assert mail.subject == "Your call minutes are used up" and "12 calls are waiting in a queue" in mail.body
    none = compose_usage_alert("Lakshmi Sarees", "whatsapp_messages", 100, None, 12, "o@example.test")
    assert "waiting in a queue" not in none.body, "the queue is about calls"
    assert "{" not in mail.body and mail.html is not None and "Lakshmi Sarees" in mail.html


def test_a_business_name_with_braces_is_not_read_as_a_placeholder() -> None:
    mail = compose_usage_alert("Odd {what} {date} Shop", "call_minutes", 80, "2026-11-21", 0, "o@example.test")
    assert "Odd {what} {date} Shop" in mail.body


def test_each_channel_is_marked_after_it_went() -> None:
    repo = Repo([item()])
    sender, whatsapp = FakeEmailSender(), FakeOwnerWhatsApp()
    tally = UsageAlerts(repo, sender, whatsapp).run("tok")
    assert tally.emails == 1 and tally.whatsapp == 1
    assert [m[3] for m in repo.marked] == ["email", "whatsapp"] and len(sender.sent) == 1 and len(whatsapp.sent) == 1
    assert sender.sent[0].idempotency_key and "owner@example.test" in sender.sent[0].idempotency_key


def test_only_the_channels_left_are_used_and_a_failed_send_is_not_marked(caplog: pytest.LogCaptureFixture) -> None:
    class Failing(FakeEmailSender):
        def send(self, message: Any) -> bool:
            return False

    repo = Repo([item(channels=["email"]), item(channels=["whatsapp"], kind="whatsapp_messages", level=100)])
    sender, whatsapp = Failing(), FakeOwnerWhatsApp()
    with caplog.at_level(logging.INFO):
        tally = UsageAlerts(repo, sender, whatsapp).run("tok")
    assert tally.emails == 0 and tally.skipped == 1 and tally.whatsapp == 1
    assert repo.marked == [("whatsapp_messages", 100, "2026-10-20", "whatsapp")], "the failed e-mail stays open"
    assert "owner@example.test" not in caplog.text and "Lakshmi" not in caplog.text, "no address, no name, no words in the log"


def test_an_owner_with_no_address_is_left_open_and_a_bad_item_is_skipped() -> None:
    repo = Repo([item(emails=[], channels=["email"]), {"tenant_id": "not-a-uuid"}, item(level=7)])
    tally = UsageAlerts(repo, FakeEmailSender(), FakeOwnerWhatsApp()).run("tok")
    assert tally.emails == 0 and repo.marked == [] and tally.skipped == 1


def test_the_pass_also_closes_the_period() -> None:
    assert UsageAlerts(Repo([], closed=2), FakeEmailSender(), FakeOwnerWhatsApp()).run("tok").closed_invoices == 2


def test_the_whatsapp_text_is_short_and_has_no_placeholder() -> None:
    text = compose_usage_whatsapp("Lakshmi Sarees", "call_minutes", 100, None, 3)
    assert "3 calls" in text and "{" not in text and "Workspace:" not in text


def test_the_worker_runs_the_alerts_and_a_crash_does_not_fail_the_tick(caplog: pytest.LogCaptureFixture) -> None:
    repo = Repo([item()])
    sender = FakeEmailSender()
    worker = Worker(FakeScheduler(), LocalFakeAdapter(), FakeSession(), interval_seconds=60, usage_alerts=UsageAlerts(repo, sender, FakeOwnerWhatsApp()))
    assert worker.tick_once() is not None and len(sender.sent) == 1

    def boom(*_a: Any, **_k: Any) -> Any:
        raise ValueError("nope")

    repo.alerts_due = boom   # type: ignore[method-assign]
    with caplog.at_level(logging.ERROR):
        assert worker.tick_once() is not None
    assert "usage alerts crashed: ValueError" in caplog.text


# ============================================================================ Today
@pytest.mark.parametrize(("kind", "ref", "word"), [("topup_low", "call_minutes", "80 percent"), ("topup_empty", "call_minutes", "queue"), ("topup_low", "whatsapp_messages", "messages"), ("topup_empty", "whatsapp_messages", "outbox")])
def test_todays_usage_items_have_their_words(kind: str, ref: str, word: str) -> None:
    row = {"kind": kind, "id": str(uuid.uuid4()), "customer": "Your plan", "city": None, "agent": "followup_desk", "ref": ref, "amount_paise": None, "at": "2026-11-02T05:30:00+00:00", "target": {"type": "billing", "id": str(A)}}
    got: NeedsYouItem = needs_item(row)
    assert word in got.summary and got.target.type == "billing" and got.customer == "Your plan"
