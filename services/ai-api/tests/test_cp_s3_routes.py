"""Campaigns S3: the offer campaign's API (its label and weekly cap), the marketing-consent list and the record and withdraw calls, an offer's list from the customers who said yes, and the estimated cost on the approval
screen. The database's own rules are proved in supabase/tests/database/227_ms_campaigns_s3_api.test.sql; here: who may call what, the shapes, the closed requests and the fixed sentence for a customer who said STOP."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from typing import Any

from app.campaigns.models import OfferCountsOut
from tests.cp_fakes import FakeCampaigns
from tests.fakes import TENANT_A, auth, make_client

A = TENANT_A.id
U = uuid.UUID
OFFER_TEXT = "Hello {{name}}, {{business}} has new arrivals: {{label}}. Visit us or reply here to know more. Reply STOP to unsubscribe."


def url(tail: str) -> str:
    return f"/v1/tenants/{A}{tail}"


def offer(**over: Any) -> dict[str, Any]:
    return {"name": "Diwali offer", "kind": "offer", "language": "en", "wa_template_id": str(U(int=0x7F)), "message_text": OFFER_TEXT, "steps": [{"offset_days": 0, "time": "11:00"}], "offer_label": "Silk sarees", **over}


def person(n: int, name: str | None, state: str = "unknown", stopped: bool = False) -> dict[str, Any]:
    return {"contact_id": str(U(int=0x500 + n)), "name": name, "phone": f"+00 90000 0000{n}", "state": state, "at": None, "via": None, "by": None, "note": None, "stopped": stopped}


def fake_with_people() -> FakeCampaigns:
    fake = FakeCampaigns()
    fake.consent = [person(1, "Ravi Kumar", "granted"), person(2, "Sita Devi"), person(3, "Latha Kumari", "withdrawn", True), person(4, "Mohan", "granted")]
    return fake


# ============================================================================================================ the offer campaign
def test_an_offer_is_saved_with_its_label_and_cap_through_the_offer_function() -> None:
    fake = FakeCampaigns()
    client, _ = make_client(campaigns=fake)
    cid = U(int=0x91)
    r = client.put(url(f"/campaigns/{cid}"), json=offer(weekly_cap=2), headers=auth("a_sales"))
    assert r.status_code == 200, r.text
    assert r.json()["campaign"]["offer_label"] == "Silk sarees" and r.json()["campaign"]["weekly_cap"] == 2
    assert fake.names() == ["save", "offer_set"]
    assert fake.calls[1][1][2:] == ("Silk sarees", 2)


def test_the_label_is_tidied_and_checked_before_anything_is_saved() -> None:
    fake = FakeCampaigns()
    client, _ = make_client(campaigns=fake)
    cid = U(int=0x92)
    assert client.put(url(f"/campaigns/{cid}"), json=offer(offer_label="  Silk   sarees "), headers=auth("a_owner")).json()["campaign"]["offer_label"] == "Silk sarees"
    for bad in ("50% off", "www.shop.in", "Rs 500 sarees", "x", "", "a" * 31, "Big discount"):
        before = len(fake.calls)
        assert client.put(url(f"/campaigns/{cid}"), json=offer(offer_label=bad), headers=auth("a_owner")).status_code == 422, bad
        assert len(fake.calls) == before, "a refused label never reaches the database"
    assert client.put(url(f"/campaigns/{cid}"), json=offer(offer_label=None), headers=auth("a_owner")).status_code == 422, "an offer needs a label"
    assert client.put(url(f"/campaigns/{cid}"), json=offer(weekly_cap=4), headers=auth("a_owner")).status_code == 422
    assert client.put(url(f"/campaigns/{cid}"), json=offer(weekly_cap=0), headers=auth("a_owner")).status_code == 422


def test_a_label_or_cap_belongs_to_an_offer_only_and_an_offer_has_no_call_step() -> None:
    client, _ = make_client(campaigns=FakeCampaigns())
    cid = U(int=0x93)
    reminder = {"name": "October dues", "kind": "payment_due", "language": "en", "wa_template_id": str(U(int=0x7E)), "message_text": "Dear {{name}}, payment of {{amount}} is due on {{due_date}}.", "steps": [{"offset_days": 0, "time": "10:00"}]}
    assert client.put(url(f"/campaigns/{cid}"), json=reminder, headers=auth("a_owner")).status_code == 200
    assert client.put(url(f"/campaigns/{cid}"), json={**reminder, "offer_label": "Diwali"}, headers=auth("a_owner")).status_code == 422
    assert client.put(url(f"/campaigns/{cid}"), json={**reminder, "weekly_cap": 2}, headers=auth("a_owner")).status_code == 422
    assert client.put(url(f"/campaigns/{U(int=0x94)}"), json=offer(call_after_step=1), headers=auth("a_owner")).status_code == 422


def test_changing_an_approved_offers_label_sends_it_back_to_draft() -> None:
    fake = FakeCampaigns()
    client, _ = make_client(campaigns=fake)
    cid = U(int=0x95)
    client.put(url(f"/campaigns/{cid}"), json=offer(), headers=auth("a_owner"))
    fake.rows[str(cid)]["status"] = "approved"
    r = client.put(url(f"/campaigns/{cid}"), json=offer(offer_label="Diwali"), headers=auth("a_owner"))
    assert r.json()["back_to_draft"] is True and r.json()["campaign"]["status"] == "draft"


def test_the_approval_screen_carries_the_estimated_cost() -> None:
    counts = OfferCountsOut.model_validate({
        "recipients": 5, "will_receive": 2, "left_out": {"stopped": 1, "marketing_withdrawn": 1, "no_marketing_consent": 1, "no_whatsapp": 0},
        "cost": {"messages_at_most": 4, "paise_each": 60, "paise_at_most": 240, "rate_source": "estimate", "before_gst": True},
    })  # fmt: skip
    assert counts.cost.paise_at_most == 240 and counts.cost.rate_source == "estimate"
    no_rate = OfferCountsOut.model_validate({"recipients": 0, "will_receive": 0, "left_out": {}, "cost": {"messages_at_most": 0, "paise_each": None, "paise_at_most": None, "rate_source": None, "before_gst": True}})
    assert no_rate.cost.paise_each is None


# ============================================================================================================ the consent list
def test_the_consent_list_is_by_name_with_counts_and_pages() -> None:
    fake = fake_with_people()
    client, _ = make_client(campaigns=fake)
    r = client.get(url("/marketing-consent?q=ravi"), headers=auth("a_sales"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert [i["name"] for i in body["items"]] == ["Ravi Kumar"] and body["items"][0]["state"] == "granted"
    assert body["counts"] == {"granted": 2, "unknown": 1, "withdrawn": 1} and body["next_cursor"] is None
    page1 = client.get(url("/marketing-consent?state=granted&limit=1"), headers=auth("a_owner")).json()
    assert [i["name"] for i in page1["items"]] == ["Mohan"] and page1["next_cursor"] is not None
    page2 = client.get(url(f"/marketing-consent?state=granted&limit=1&after={page1['next_cursor']}"), headers=auth("a_owner")).json()
    assert [i["name"] for i in page2["items"]] == ["Ravi Kumar"] and page2["next_cursor"] is None
    assert client.get(url("/marketing-consent?after=not-a-cursor"), headers=auth("a_owner")).status_code == 422
    stopped = client.get(url("/marketing-consent?q=latha"), headers=auth("a_owner")).json()["items"][0]
    assert stopped["stopped"] is True and stopped["state"] == "withdrawn"


def test_the_consent_list_is_for_staff_of_this_business_only_and_its_requests_are_closed() -> None:
    client, _ = make_client(campaigns=fake_with_people())
    for who in ("a_owner", "a_admin", "a_sales"):
        assert client.get(url("/marketing-consent"), headers=auth(who)).status_code == 200, who
    assert client.get(url("/marketing-consent"), headers=auth("a_viewer")).status_code == 403
    assert client.get(url("/marketing-consent"), headers=auth("b_owner")).status_code == 404
    assert client.get(url("/marketing-consent?state=maybe"), headers=auth("a_owner")).status_code == 422
    assert client.get(url("/marketing-consent?limit=500"), headers=auth("a_owner")).status_code == 422
    assert client.get(url("/marketing-consent?q=" + "x" * 61), headers=auth("a_owner")).status_code == 422


# ============================================================================================================ record and withdraw
def test_staff_record_a_yes_with_a_note_and_withdraw_it_again() -> None:
    fake = fake_with_people()
    client, _ = make_client(campaigns=fake)
    sita = str(U(int=0x502))
    r = client.put(url(f"/contacts/{sita}/marketing-consent"), json={"note": "said yes in shop"}, headers=auth("a_sales"))
    assert r.status_code == 200, r.text
    assert r.json()["state"] == "granted" and r.json()["via"] == "owner_recorded" and r.json()["note"] == "said yes in shop"
    assert client.get(url(f"/contacts/{sita}/marketing-consent"), headers=auth("a_admin")).json()["state"] == "granted"
    w = client.post(url(f"/contacts/{sita}/marketing-consent/withdraw"), json={}, headers=auth("a_owner"))
    assert w.status_code == 200 and w.json()["state"] == "withdrawn"
    assert client.post(url(f"/contacts/{sita}/marketing-consent/withdraw"), json={"note": "asked at the counter"}, headers=auth("a_owner")).json()["note"] == "asked at the counter"


def test_a_yes_needs_a_short_note_and_a_viewer_cannot_record() -> None:
    client, _ = make_client(campaigns=fake_with_people())
    sita = str(U(int=0x502))
    assert client.put(url(f"/contacts/{sita}/marketing-consent"), json={}, headers=auth("a_owner")).status_code == 422
    assert client.put(url(f"/contacts/{sita}/marketing-consent"), json={"note": "x"}, headers=auth("a_owner")).status_code == 422
    assert client.put(url(f"/contacts/{sita}/marketing-consent"), json={"note": "y" * 161}, headers=auth("a_owner")).status_code == 422
    assert client.put(url(f"/contacts/{sita}/marketing-consent"), json={"note": "said yes", "state": "granted"}, headers=auth("a_owner")).status_code == 422
    assert client.put(url(f"/contacts/{sita}/marketing-consent"), json={"note": "said yes in shop"}, headers=auth("a_viewer")).status_code == 403
    assert client.post(url(f"/contacts/{sita}/marketing-consent/withdraw"), json={}, headers=auth("a_viewer")).status_code == 403
    assert client.get(url(f"/contacts/{sita}/marketing-consent"), headers=auth("a_viewer")).status_code == 403
    assert client.get(url(f"/contacts/{U(int=0x999)}/marketing-consent"), headers=auth("a_owner")).status_code == 404
    assert client.get(url("/contacts/not-a-uuid/marketing-consent"), headers=auth("a_owner")).status_code == 404


def test_a_customer_who_said_stop_cannot_be_recorded_as_a_yes() -> None:
    client, _ = make_client(campaigns=fake_with_people())
    latha = str(U(int=0x503))
    r = client.put(url(f"/contacts/{latha}/marketing-consent"), json={"note": "said yes in shop"}, headers=auth("a_owner"))
    assert r.status_code == 409 or r.status_code == 422 or r.status_code == 403, r.text
    assert r.json()["error"]["code"] == "contact_suppressed", r.text


# ============================================================================================================ an offer's list from the customers who said yes
def test_an_offers_list_is_built_from_the_customers_who_said_yes() -> None:
    fake = fake_with_people()
    client, _ = make_client(campaigns=fake)
    cid = U(int=0x96)
    client.put(url(f"/campaigns/{cid}"), json=offer(), headers=auth("a_owner"))
    r = client.post(url(f"/campaigns/{cid}/recipients/consented"), json={"due_date": "2026-11-20"}, headers=auth("a_sales"))
    assert r.status_code == 200, r.text
    assert r.json() == {"added": 2, "skipped": [], "recipients": 2}
    again = client.post(url(f"/campaigns/{cid}/recipients/consented"), json={"due_date": "2026-11-20"}, headers=auth("a_sales")).json()
    assert again["added"] == 0 and len(again["skipped"]) == 2 and again["recipients"] == 2
    narrow = U(int=0x97)
    client.put(url(f"/campaigns/{narrow}"), json=offer(name="Narrow"), headers=auth("a_owner"))
    assert client.post(url(f"/campaigns/{narrow}/recipients/consented"), json={"due_date": "2026-11-20", "q": "ravi"}, headers=auth("a_owner")).json()["added"] == 1


def test_the_consented_list_checks_who_asks_and_what_is_asked() -> None:
    fake = fake_with_people()
    client, _ = make_client(campaigns=fake)
    cid = U(int=0x98)
    client.put(url(f"/campaigns/{cid}"), json=offer(), headers=auth("a_owner"))
    path = url(f"/campaigns/{cid}/recipients/consented")
    assert client.post(path, json={"due_date": "2026-11-20"}, headers=auth("a_viewer")).status_code == 403
    assert client.post(path, json={"due_date": "2026-11-20"}, headers=auth("b_owner")).status_code == 404
    assert client.post(path, json={}, headers=auth("a_owner")).status_code == 422
    assert client.post(path, json={"due_date": "soon"}, headers=auth("a_owner")).status_code == 422
    assert client.post(path, json={"due_date": "2026-11-20", "q": "x" * 61}, headers=auth("a_owner")).status_code == 422
    assert client.post(path, json={"due_date": "2026-11-20", "everyone": True}, headers=auth("a_owner")).status_code == 422
