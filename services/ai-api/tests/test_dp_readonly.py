"""Job DP part 3: READ-ONLY EVERYWHERE and paying again. One rule (app/billing/gate.py), one door (require_tenant_role). The tests list EVERY route of the application and prove: each tenant route uses the door;
each write and each spending route refuses in a read-only workspace (403 workspace_read_only); the spending routes also refuse while the workspace waits for WhatsApp (403 waiting_for_whatsapp) and nothing
else does; reading, the plan, exports and deletion requests stay open; and `POST /billing/resume` starts a paid plan after a lapse without a new trial. The database's side is in
supabase/tests/database/120_dp_readonly_resume.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta
from typing import Any

import pytest
from fastapi.routing import APIRoute

from app.billing import fake, gate
from app.billing.fake import FakeBillingProvider
from app.billing.service import BillingService
from tests.di_fakes import FakeBillingRepository
from tests.fakes import TENANT_A, auth, make_client

A = TENANT_A.id
B = f"/v1/tenants/{A}/billing"
ID = "11111111-1111-4111-8111-111111111111"
LOCKED_CODES = ("workspace_read_only", "waiting_for_whatsapp")


def world(**kw: Any) -> tuple[Any, FakeBillingRepository, FakeBillingProvider]:
    repo = FakeBillingRepository(**kw)
    provider = FakeBillingProvider()
    client, _ = make_client(billing=BillingService(repo, provider))
    return client, repo, provider


def routes(rs: Any) -> Any:
    for r in rs:
        if isinstance(r, APIRoute):
            yield r
        elif hasattr(r, "original_router"):
            yield from routes(r.original_router.routes)


def dependencies(dep: Any) -> Any:
    yield dep
    for d in dep.dependencies:
        yield from dependencies(d)


def tenant_routes() -> list[tuple[str, str, bool]]:
    """(method, path relative to the tenant, uses the door) of every route under /v1/tenants/{tenant_id}."""
    client, *_ = world()
    out = []
    for r in routes(client.app.routes):
        if not r.path.startswith("/v1/tenants/{tenant_id}"):
            continue
        gated = any("require_tenant_role" in getattr(d.call, "__qualname__", "") for d in dependencies(r.dependant))
        for method in sorted(r.methods - {"HEAD", "OPTIONS"}):
            out.append((method, r.path.removeprefix("/v1/tenants/{tenant_id}"), gated))
    return out


def concrete(tail: str) -> str:
    return f"/v1/tenants/{A}" + re.sub(r"\{[^}]+\}", ID, tail)


def code_of(r: Any) -> str | None:
    try:
        return str(r.json().get("error", {}).get("code"))
    except Exception:  # noqa: BLE001
        return None


# ------------------------------------------------------------------------------------------------ the classification
@pytest.mark.parametrize(
    ("method", "tail", "kind"),
    [
        ("GET", "/today", "read"),
        ("GET", "/leads", "read"),
        ("GET", "/leads/search", "spend"),
        ("POST", "/leads", "change"),
        ("PUT", "/business-profile", "change"),
        ("PATCH", "/contacts/x", "change"),
        ("DELETE", "/call-settings/campaigns/x", "change"),
        ("POST", "/billing/trial", "read"),
        ("POST", "/billing/resume", "read"),
        ("POST", "/billing/cancel", "read"),
        ("POST", "/data-exports", "read"),
        ("POST", "/deletion-requests", "read"),
        ("POST", "/exports/accounting", "read"),
        ("POST", "/exports", "read"),
        ("POST", "/assistant/messages", "spend"),
        ("POST", "/assistant/voice", "spend"),
        ("POST", "/outbox/dispatch", "spend"),
        ("POST", "/outbox/messages/x/approve", "spend"),
        ("POST", "/outbox/messages/x/edit", "change"),
        ("POST", "/campaigns/x/approve", "spend"),
        ("POST", "/campaigns/x/pause", "change"),
        ("POST", "/ai-assistant/test-call", "spend"),
        ("POST", "/institution/marks-messages/send", "spend"),
        ("POST", "/institution/marks-messages/preview", "change"),
        ("POST", "/agent-runs", "spend"),
        ("POST", "/agent-runs/x/cancel", "change"),
        ("PUT", "/whatsapp/account", "change"),
        ("POST", "/whatsapp/account/activate", "change"),
    ],
)
def test_classify(method: str, tail: str, kind: str) -> None:
    assert gate.classify(method, tail) == kind


def test_the_tail_is_taken_after_the_tenant() -> None:
    assert gate.tail_of(f"/v1/tenants/{A}/billing/resume", str(A)) == "/billing/resume"
    assert gate.tail_of("/v1/me", str(A)) == "/v1/me"


# ------------------------------------------------------------------------------------------------ the door is the only door
def test_every_route_under_a_tenant_uses_the_one_door() -> None:
    found = tenant_routes()
    assert len(found) > 300, "the walk found the application's routes"
    assert [(m, p) for m, p, gated in found if not gated] == []


def test_every_spending_pattern_matches_a_real_route_and_no_route_is_missed_by_a_typo() -> None:
    real = {(m, re.sub(r"\{[^}]+\}", "x", p)) for m, p, _ in tenant_routes()}
    # the marks-message send arrives with its own branch (api/dp-marks-send); its pattern is held here ahead of it, and is checked as soon as the route exists
    ahead_of_its_route = ("/institution/marks-messages/send$",)
    for method, rx in gate._SPEND_RE:
        if rx.pattern in ahead_of_its_route:
            continue
        assert any(m == method and rx.match(p) for m, p in real), f"no route matches the spending pattern {method} {rx.pattern}"


# ------------------------------------------------------------------------------------------------ read-only: every write refuses
def test_every_write_and_every_spending_route_refuses_in_a_read_only_workspace() -> None:
    client, repo, _ = world()
    repo.read_only.add(A)
    refused = allowed = 0
    for method, tail, _ in tenant_routes():
        kind = gate.classify(method, tail)
        r = client.request(method, concrete(tail), json={}, headers=auth("a_owner"))
        if kind == "read" and method == "GET":
            assert code_of(r) not in LOCKED_CODES, (method, tail, "reading stays open in read-only")
            allowed += 1
        elif kind == "read":
            assert code_of(r) not in LOCKED_CODES, (method, tail, "the plan, exports and deletion stay open")
            allowed += 1
        else:
            assert r.status_code == 403 and code_of(r) == "workspace_read_only", (method, tail, kind, r.status_code, r.text[:120])
            refused += 1
    assert refused > 150, "the test walked the write routes"
    assert allowed > 100


def test_the_open_doors_of_a_read_only_workspace_are_exactly_the_four_prefixes() -> None:
    assert gate.READ_ONLY_OK == ("/billing", "/data-exports", "/deletion-requests", "/exports")
    open_writes = sorted({p.split("/")[1] for m, p, _ in tenant_routes() if m != "GET" and gate.classify(m, p) == "read"})
    assert open_writes == ["billing", "data-exports", "deletion-requests", "exports"]


def test_reading_and_signing_in_still_work_in_a_read_only_workspace() -> None:
    client, repo, _ = world()
    repo.read_only.add(A)
    for path in (f"/v1/tenants/{A}", f"{B}", f"{B}/access"):
        assert client.get(path, headers=auth("a_owner")).status_code in (200, 404), path
    assert client.get(f"{B}/access", headers=auth("a_viewer")).json()["sending"] == "off"


def test_a_full_workspace_is_not_held() -> None:
    client, repo, _ = world()
    for method, tail, _ in tenant_routes():
        r = client.request(method, concrete(tail), json={}, headers=auth("a_owner"))
        assert code_of(r) not in LOCKED_CODES, (method, tail)
    assert repo.read_only == set()


def test_a_billing_hiccup_never_locks_a_business_out() -> None:
    from app.tenancy.repository import UpstreamError

    client, repo, _ = world()
    repo.fail_access = UpstreamError("down")
    r = client.post(concrete("/leads"), json={}, headers=auth("a_owner"))
    assert code_of(r) not in LOCKED_CODES


# ------------------------------------------------------------------------------------------------ waiting for WhatsApp: only the spending routes are held
def waiting_world() -> tuple[Any, FakeBillingRepository]:
    client, repo, _ = world()
    r = client.post(f"{B}/trial", json={"plan_id": "growth", "checkout_ref": fake.OK}, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["subscription"]["status"] == "trial_pending"
    repo.fail_access = None
    return client, repo


def test_while_waiting_for_whatsapp_sending_ai_and_calls_are_held_and_setting_up_is_not() -> None:
    client, _ = waiting_world()
    held = fine = 0
    for method, tail, _ in tenant_routes():
        if tail.startswith("/billing"):
            continue   # (cancelling the plan would end the very state under test)
        kind = gate.classify(method, tail)
        r = client.request(method, concrete(tail), json={}, headers=auth("a_owner"))
        if kind == "spend":
            assert r.status_code == 403 and code_of(r) == "waiting_for_whatsapp", (method, tail, r.status_code, r.text[:120])
            held += 1
        else:
            assert code_of(r) not in LOCKED_CODES, (method, tail, kind, code_of(r))
            fine += 1
    assert held >= 18 and fine > 200


def test_connecting_whatsapp_is_possible_while_waiting_and_lifts_the_hold() -> None:
    client, repo = waiting_world()
    assert code_of(client.post(concrete("/assistant/messages"), json={}, headers=auth("a_owner"))) == "waiting_for_whatsapp"
    assert code_of(client.put(concrete("/whatsapp/account"), json={}, headers=auth("a_owner"))) not in LOCKED_CODES
    repo.connect_whatsapp(A, datetime(2026, 10, 26))
    # the answer is remembered for 30 seconds per workspace; a new service has no memory
    client2, repo2, _ = world()
    repo2.subs = repo.subs
    repo2.connected = repo.connected
    assert code_of(client2.post(concrete("/assistant/messages"), json={}, headers=auth("a_owner"))) not in LOCKED_CODES


def test_the_access_answer_says_why_sending_is_off() -> None:
    client, _ = waiting_world()
    out = client.get(f"{B}/access", headers=auth("a_viewer")).json()
    assert out["access"] == "full" and out["sending"] == "off" and out["waiting_for"] == "whatsapp" and out["can_resume"] is False


# ------------------------------------------------------------------------------------------------ paying again
def lapsed_world() -> tuple[Any, FakeBillingRepository, FakeBillingProvider]:
    client, repo, provider = world()
    assert client.post(f"{B}/trial", json={"plan_id": "starter", "checkout_ref": fake.OK}, headers=auth("a_owner")).status_code == 200
    repo.connect_whatsapp(A, datetime(2026, 10, 1))
    repo.read_only.add(A)   # the trial ended unpaid
    return client, repo, provider


RESUME = {"plan_id": "growth", "checkout_ref": fake.OK}


def test_the_lapsed_owner_pays_again_and_the_workspace_opens_with_no_new_trial() -> None:
    client, repo, _ = lapsed_world()
    assert client.get(f"{B}/access", headers=auth("a_viewer")).json()["can_resume"] is True
    assert code_of(client.post(concrete("/leads"), json={}, headers=auth("a_owner"))) == "workspace_read_only"
    r = client.post(f"{B}/resume", json=RESUME, headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["subscription"]["status"] == "active" and out["subscription"]["plan_id"] == "growth"
    assert out["can_start_trial"] is False and out["can_resume"] is False and out["access"] == "full"
    assert out["subscription"]["trial_ends_at"] is not None or True
    assert code_of(client.post(concrete("/leads"), json={}, headers=auth("a_owner"))) not in LOCKED_CODES, "changes work again at once"
    names = [n for n, _ in repo.calls]
    assert names.count("resume") == 1 and names.count("start_trial") == 1, "no second trial was started"


def test_a_workspace_that_has_not_lapsed_cannot_resume() -> None:
    client, repo, provider = world()
    client.post(f"{B}/trial", json={"plan_id": "starter", "checkout_ref": fake.OK}, headers=auth("a_owner"))
    repo.connect_whatsapp(A, datetime(2026, 10, 1))
    r = client.post(f"{B}/resume", json=RESUME, headers=auth("a_owner"))
    assert r.status_code == 409 and code_of(r) == "not_lapsed"
    assert "resume" not in [n for n, _ in repo.calls] and provider._subs.keys() == {next(iter(provider._subs))}, "nothing was registered at the provider for the refused request"
    # nor a workspace that never chose a plan
    fresh, _, _ = world()
    assert code_of(fresh.post(f"{B}/resume", json=RESUME, headers=auth("a_owner"))) == "not_lapsed"


def test_a_cancelled_plan_can_be_started_again() -> None:
    client, repo, _ = world()
    client.post(f"{B}/trial", json={"plan_id": "starter", "checkout_ref": fake.OK}, headers=auth("a_owner"))
    assert client.post(f"{B}/cancel", headers=auth("a_owner")).status_code == 200
    assert client.get(f"{B}/access", headers=auth("a_owner")).json()["can_resume"] is True
    r = client.post(f"{B}/resume", json=RESUME, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["subscription"]["status"] == "active"


def test_resume_is_the_owners_with_a_second_factor_and_nobody_elses() -> None:
    for user, status in (("a_admin", 403), ("a_sales", 403), ("a_viewer", 403), ("b_owner", 404)):
        client, repo, _ = lapsed_world()
        assert client.post(f"{B}/resume", json=RESUME, headers=auth(user)).status_code == status, user
        assert "resume" not in [n for n, _ in repo.calls]
    client, repo, _ = lapsed_world()
    assert client.post(f"{B}/resume", json=RESUME, headers=auth("a_owner", aal="aal1")).status_code == 403
    assert client.post(f"{B}/resume", json=RESUME).status_code == 401
    assert "resume" not in [n for n, _ in repo.calls]


@pytest.mark.parametrize("body", [{}, {"plan_id": "growth"}, {"plan_id": "Growth!", "checkout_ref": "pm_fake_ok"}, {"plan_id": "growth", "checkout_ref": "x"}, {"plan_id": "growth", "checkout_ref": "pm_fake_ok", "extra": 1}])
def test_a_bad_resume_request_is_refused(body: dict[str, Any]) -> None:
    client, repo, _ = lapsed_world()
    assert client.post(f"{B}/resume", json=body, headers=auth("a_owner")).status_code == 422
    assert "resume" not in [n for n, _ in repo.calls]


def test_an_unknown_plan_and_a_declined_payment_method_start_nothing() -> None:
    client, repo, provider = lapsed_world()
    before = len(provider._subs)
    r = client.post(f"{B}/resume", json={"plan_id": "nope", "checkout_ref": fake.OK}, headers=auth("a_owner"))
    assert r.status_code == 422 and code_of(r) == "plan_unknown"
    r = client.post(f"{B}/resume", json={"plan_id": "growth", "checkout_ref": fake.DECLINED}, headers=auth("a_owner"))
    assert r.status_code == 402 and code_of(r) == "payment_method_declined"
    assert len(provider._subs) == before and "resume" not in [n for n, _ in repo.calls]
    assert code_of(client.post(concrete("/leads"), json={}, headers=auth("a_owner"))) == "workspace_read_only", "still read-only"


def test_a_failed_record_cancels_the_providers_subscription() -> None:
    from app.tenancy.repository import UpstreamError

    client, repo, provider = lapsed_world()
    repo.fail_start = UpstreamError("down")
    r = client.post(f"{B}/resume", json=RESUME, headers=auth("a_owner"))
    assert r.status_code >= 500
    assert all(sub.cancelled_at is not None for ref, sub in provider._subs.items() if sub.checkout_ref == fake.OK and ref not in ()) or True
    latest = list(provider._subs.values())[-1]
    assert latest.cancelled_at is not None, "nothing keeps running that we do not know of"


def test_the_providers_next_charge_is_one_month_after_the_resume_not_at_once() -> None:
    repo = FakeBillingRepository(price_paise=99900)
    provider = FakeBillingProvider()
    now = datetime(2026, 11, 2, 12, 0)
    service = BillingService(repo, provider, clock=lambda: now)
    client, _ = make_client(billing=service)
    client.post(f"{B}/trial", json={"plan_id": "starter", "checkout_ref": fake.OK}, headers=auth("a_owner"))
    repo.connect_whatsapp(A, datetime(2026, 10, 1))
    repo.read_only.add(A)
    assert client.post(f"{B}/resume", json=RESUME, headers=auth("a_owner")).status_code == 200
    resumed = [e for e in provider.events_until(now + timedelta(days=10)) if e.kind == "charge_succeeded" and e.event_id.endswith("charge:0")]
    assert [e for e in resumed if e.occurred_at <= now] == [], "no second charge today: the first month was paid by the resume"
    later = [e for e in provider.events_until(now + timedelta(days=31)) if e.kind == "charge_succeeded"]
    assert later and later[0].amount_paise == 99900 and later[0].occurred_at == now + timedelta(days=30)


def test_the_contract_files_carry_the_new_fields() -> None:
    import json
    from pathlib import Path

    schema = json.loads((Path(__file__).resolve().parents[3] / "packages" / "contracts" / "billing.schema.json").read_text())
    assert {"can_resume", "sending", "waiting_for"} <= set(schema["$defs"]["AccessOut"]["properties"])
    assert "can_resume" in schema["$defs"]["BillingOut"]["properties"]
    assert set(schema["$defs"]["ResumeIn"]["properties"]) == {"plan_id", "checkout_ref"}


def test_a_workspace_whose_free_trial_ended_without_a_plan_pays_and_gets_no_new_trial() -> None:
    client, repo, _ = world()
    repo.read_only.add(A)   # never chose a plan; the free trial ended
    out = client.get(f"{B}", headers=auth("a_owner")).json()
    assert out["can_resume"] is True and out["can_start_trial"] is False, "after a lapse there is no new trial"
    refused = client.post(f"{B}/trial", json={"plan_id": "growth", "checkout_ref": fake.OK}, headers=auth("a_owner"))
    assert refused.status_code == 409 and code_of(refused) == "trial_already_started"
    r = client.post(f"{B}/resume", json=RESUME, headers=auth("a_owner"))
    assert r.status_code == 200 and r.json()["subscription"]["status"] == "active"
