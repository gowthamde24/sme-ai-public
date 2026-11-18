"""A business takes and gives back its own phone number (planner, 18 Nov 2026): the adapter against a fake Plivo that follows the documented API, the service with a fake database, the routes and the closed-workspace release."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

import pytest

from app.errors import ApiError
from app.phone_numbers.provider import FakeNumbers, Line, PlivoSubaccountNumbers
from app.phone_numbers.service import PhoneNumbersService
from app.telephony.plivo_admin import PlivoAdmin
from app.telephony.plivo_api import PlivoError
from app.telephony.plivo_onboarding import vault_key
from tests.fake_plivo_numbers import FakePlivoNumbers
from tests.fakes import TENANT_A, auth, make_client

TENANT = uuid.UUID("11111111-1111-4111-8111-111111111111")
BASE = f"/v1/tenants/{TENANT_A.id}/phone-line"
SUB = "SAFAKE00000001"


def plivo_provider(fake: FakePlivoNumbers, *, token: bool = True) -> PlivoSubaccountNumbers:
    main = PlivoAdmin("MAFAKE00000001", "main-token", client=fake.client())
    return PlivoSubaccountNumbers(main, lambda auth_id, token: PlivoAdmin(auth_id, token, client=fake.client()), lambda name: "fake-sub-token" if token and name.startswith("sme-ws-") else None)


# ------------------------------------------------------------------------------------------ the adapter against the documented API
def test_assign_rents_the_number_for_the_business_makes_its_application_and_links_it() -> None:
    fake = FakePlivoNumbers()
    line = plivo_provider(fake).assign(tenant_id=TENANT, number="+918044440101", subaccount_id=SUB, compliance_id="comp-123456", public_base="https://api.example.test")
    assert line == Line("+918044440101", vault_key(TENANT), SUB)
    held = fake.rented["918044440101"]
    assert held["subaccount"] == SUB and held["compliance"] == "comp-123456" and held["app_id"] in fake.apps
    app = fake.apps[held["app_id"]]
    assert app["answer_url"] == "https://api.example.test/v1/telephony/plivo/answer" and app["hangup_url"].endswith("/v1/telephony/plivo/hangup")
    assert app["by"] == SUB, "the Application is made with the sub-account's own credentials"
    assert held["by"] == "MAFAKE00000001", "the rent is paid by the main account"


def test_nothing_is_rented_unless_the_business_application_is_accepted_or_it_has_a_subaccount_and_a_token() -> None:
    fake = FakePlivoNumbers(compliance="submitted")
    with pytest.raises(PlivoError):
        plivo_provider(fake).assign(tenant_id=TENANT, number="+918044440101", subaccount_id=SUB, compliance_id="comp-123456", public_base="https://x.test")
    with pytest.raises(PlivoError):
        plivo_provider(FakePlivoNumbers()).assign(tenant_id=TENANT, number="+918044440101", subaccount_id=None, compliance_id="comp-123456", public_base="https://x.test")
    with pytest.raises(PlivoError):
        plivo_provider(FakePlivoNumbers(), token=False).assign(tenant_id=TENANT, number="+918044440101", subaccount_id=SUB, compliance_id="comp-123456", public_base="https://x.test")
    assert fake.rented == {} and not [c for c in fake.calls if c[0] == "POST" and c[1].startswith("PhoneNumber/9")]


def test_search_returns_what_is_on_offer_and_release_is_safe_to_repeat() -> None:
    fake = FakePlivoNumbers()
    provider = plivo_provider(fake)
    assert provider.search("", 5) == ["+918044440101", "+918044440102", "+918044440103"] and provider.search("0102", 5) == ["+918044440102"]
    line = provider.assign(tenant_id=TENANT, number="+918044440102", subaccount_id=SUB, compliance_id="comp-123456", public_base="https://x.test")
    assert "+918044440102" not in provider.search("", 5), "a rented number is no longer on offer"
    provider.release(line)
    assert fake.rented == {}
    provider.release(line)   # Plivo no longer knows it (404): released, not an error
    fake.down = True
    with pytest.raises(PlivoError):
        provider.release(line)


def test_the_same_number_cannot_be_rented_twice() -> None:
    fake = FakePlivoNumbers()
    provider = plivo_provider(fake)
    provider.assign(tenant_id=TENANT, number="+918044440101", subaccount_id=SUB, compliance_id="comp-123456", public_base="https://x.test")
    with pytest.raises(PlivoError) as caught:
        provider.assign(tenant_id=TENANT, number="+918044440101", subaccount_id=SUB, compliance_id="comp-123456", public_base="https://x.test")
    assert caught.value.reason == "rejected"


# ------------------------------------------------------------------------------------------ the service with a fake database
class FakeRepo:
    def __init__(self, kyc: dict[str, Any] | None = None) -> None:
        self.kyc_row = kyc if kyc is not None else {"status": "accepted", "compliance_id": "comp-123456", "plivo_subaccount": SUB}
        self.line_row: dict[str, Any] | None = None
        self.closed: list[dict[str, Any]] = []
        self.removed_numbers: list[str] = []
        self.attach_fails = False

    def line(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any] | None:
        return self.line_row

    def kyc(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return self.kyc_row

    def attach(self, token: str, tenant_id: uuid.UUID, number: str, account_ref: str | None, external_ref: str | None) -> dict[str, Any]:
        if self.attach_fails:
            raise RuntimeError("db down")
        self.line_row = {"number": number, "inbound_on": False, "account_ref": account_ref, "external_ref": external_ref}
        return {"number": number}

    def detach(self, token: str, tenant_id: uuid.UUID, number: str) -> dict[str, Any]:
        self.line_row = None
        return {"number": number}

    def closed_lines(self, token: str, limit: int) -> list[dict[str, Any]]:
        return list(self.closed)

    def removed(self, token: str, number: str) -> bool:
        self.removed_numbers.append(number)
        return True


def service(fake: FakePlivoNumbers | None = None, repo: FakeRepo | None = None) -> tuple[PhoneNumbersService, FakeRepo, FakePlivoNumbers]:
    fake = fake or FakePlivoNumbers()
    repo = repo or FakeRepo()
    return PhoneNumbersService(repo, plivo_provider(fake), "https://api.example.test"), repo, fake


def test_a_business_takes_a_number_once_and_gives_it_back() -> None:
    svc, repo, fake = service()
    out = svc.take("tok", TENANT, "+918044440101")
    assert out.state == "ready" and out.number == "+918044440101" and out.inbound_on is False, "inbound stays OFF until the first test call"
    assert repo.line_row and repo.line_row["account_ref"] == vault_key(TENANT) and repo.line_row["external_ref"] == SUB
    with pytest.raises(ApiError) as twice:
        svc.take("tok", TENANT, "+918044440102")
    assert twice.value.code == "already_has_number" and set(fake.rented) == {"918044440101"}
    assert svc.give_back("tok", TENANT).state == "none" and fake.rented == {} and repo.line_row is None
    assert svc.give_back("tok", TENANT).state == "none", "giving back again does nothing"


def test_no_number_before_the_business_registration_is_accepted() -> None:
    svc, repo, fake = service(repo=FakeRepo(kyc={"status": "submitted", "compliance_id": "comp-123456", "plivo_subaccount": SUB}))
    with pytest.raises(ApiError) as caught:
        svc.take("tok", TENANT, "+918044440101")
    assert caught.value.code == "kyc_not_accepted" and fake.rented == {} and repo.line_row is None


def test_a_number_that_cannot_be_recorded_is_given_back_and_a_number_gone_is_said() -> None:
    fake = FakePlivoNumbers()
    repo = FakeRepo()
    repo.attach_fails = True
    svc, _, _ = service(fake, repo)
    with pytest.raises(RuntimeError):
        svc.take("tok", TENANT, "+918044440101")
    assert fake.rented == {}, "rented but not recorded: given back, nothing is paid for a number nobody holds"
    svc2, _, _ = service()
    with pytest.raises(ApiError) as caught:
        svc2.take("tok", TENANT, "+919999999999")   # not on offer
    assert caught.value.code == "number_not_available"
    down = FakePlivoNumbers()
    down.down = True
    svc3, _, _ = service(down)
    with pytest.raises(ApiError) as caught3:
        svc3.available("")
    assert caught3.value.code == "number_provider_unavailable"


def test_the_provider_is_released_before_the_record_so_a_number_that_cannot_be_released_stays_on_the_record() -> None:
    svc, repo, fake = service()
    svc.take("tok", TENANT, "+918044440101")
    fake.down = True
    with pytest.raises(ApiError) as caught:
        svc.give_back("tok", TENANT)
    assert caught.value.code == "number_provider_unavailable" and repo.line_row is not None and "918044440101" in fake.rented


def test_the_lines_of_closed_workspaces_are_given_back_and_a_failure_waits_for_the_next_run() -> None:
    svc, repo, fake = service()
    svc.take("tok", TENANT, "+918044440101")
    other = uuid.uuid4()
    repo.closed = [{"tenant_id": str(TENANT), "number": "+918044440101", "account_ref": vault_key(TENANT), "external_ref": SUB}, {"tenant_id": str(other), "number": "+918044440102", "account_ref": vault_key(other), "external_ref": SUB}]
    assert svc.release_closed("sched") == {"released": 2, "failed": 0}   # (the second is not rented any more: Plivo says 404, which counts as released)
    assert fake.rented == {} and repo.removed_numbers == ["+918044440101", "+918044440102"]
    fake.down = True
    repo.removed_numbers.clear()
    assert svc.release_closed("sched") == {"released": 0, "failed": 2} and repo.removed_numbers == []


# ------------------------------------------------------------------------------------------ the routes
def client_with(repo: FakeRepo | None = None) -> tuple[Any, FakeRepo, FakePlivoNumbers]:
    svc, repo, fake = service(repo=repo)
    client, _ = make_client(phone_numbers=svc)
    return client, repo, fake


def test_the_routes_and_who_may_use_them() -> None:
    client, repo, fake = client_with()
    assert client.get(BASE + "/available", headers=auth("a_owner")).json()["items"][0] == "+918044440101"
    assert client.get(BASE + "/available", headers=auth("a_sales")).status_code == 403
    assert client.get(BASE, headers=auth("a_viewer")).json() == {"state": "none", "number": None, "inbound_on": False, "live": True}
    assert client.post(BASE, json={"number": "+918044440101"}, headers=auth("a_admin")).status_code == 403, "an Admin cannot take a number"
    assert client.post(BASE, json={"number": "+918044440101"}, headers=auth("a_owner", aal="aal1")).status_code == 403, "the second factor is needed"
    ok = client.post(BASE, json={"number": "+918044440101"}, headers=auth("a_owner"))
    assert ok.status_code == 200 and ok.json()["number"] == "+918044440101" and ok.json()["inbound_on"] is False
    assert client.post(BASE, json={"number": "+918044440102"}, headers=auth("a_owner")).json()["error"]["code"] == "already_has_number"
    assert client.post(BASE, json={"number": "garbage"}, headers=auth("a_owner")).status_code == 422
    assert client.post(BASE, json={"number": "+918044440102", "plan": "x"}, headers=auth("a_owner")).status_code == 422, "the body is closed"
    assert client.delete(BASE, headers=auth("a_admin")).status_code == 403
    assert client.delete(BASE, headers=auth("a_owner")).json()["state"] == "none" and fake.rented == {} and repo.line_row is None


def test_without_a_provider_the_routes_say_so() -> None:
    client, _ = make_client()
    assert client.get(BASE, headers=auth("a_owner")).status_code == 503


def test_the_fake_numbers_of_staging_rent_nothing_and_cost_nothing() -> None:
    fake = FakeNumbers()
    first = fake.search("", 3)
    assert len(first) == 3 and fake.live is False
    line = fake.assign(tenant_id=TENANT, number=first[0], subaccount_id=None, compliance_id="c", public_base="https://x.test")
    assert first[0] not in fake.search("", 50)
    fake.release(line)
    assert first[0] in fake.search("", 50)
