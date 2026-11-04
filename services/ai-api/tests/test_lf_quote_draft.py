"""A qualified call's quote suggestion -> a DRAFT quote for the Owner's OK (ADR 0119 decision 8; owner, 4 Nov 2026, day 2). Through the real routes, the real Lead Finder service and simulator, and the
quotes' own manual-draft path (the pinned engine) over in-memory fakes. The database's recomputation of a manual draft is pgTAP 68 and tests/integration/test_manual_quote_api.py.

Proven: the preview lists the lines (in-stock items the call pitched, the Owner's exact catalogue price, the quantity the buyer said) and every suggestion left out with its reason; nothing is stored by it;
the button needs the Owner or an Admin with the second factor; it makes one enquiry on the call's lead and one DRAFT (nothing approved, nothing sent); the same button again replays; a price or a quantity is
never made up; a call that did not qualify has no draft; a school has none at all."""

# ruff: noqa: E501

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest

from app.lead_finder.quote_draft import enquiry_id_for, item_type_code, quantity_of, quote_id_for
from app.lead_finder.service import LeadFinderService
from tests.enquiries_fakes import FakeEnquiries
from tests.fakes import TENANT_A, auth, make_client
from tests.lf_fakes import NOW, TEXTILE_STOCK, FakeLeadFinderRepo
from tests.quotes_fakes import FakeQuotes

URL = f"/v1/tenants/{TENANT_A.id}"


class Quotes(FakeQuotes):
    """The quotes fake, with an item type saved through the API listed afterwards (as the real table would)."""

    def save_item_type(self, token: str, args: dict[str, Any]) -> dict[str, Any]:
        out = super().save_item_type(token, args)
        if not any(r["code"] == args["p_code"] for r in self.item_type_rows):
            self.item_type_rows.append({"id": out["id"], "code": args["p_code"], "name": args["p_name"], "position": args["p_position"], "active": args["p_active"],
                                        "min_price_paise": None, "max_price_paise": None})
        return out


def world(*, pack: str = "textiles", stock: list[dict[str, Any]] | None = None, module_on: bool = True) -> tuple[Any, FakeLeadFinderRepo, Quotes, FakeEnquiries]:
    repo = FakeLeadFinderRepo(pack, module_on=module_on, stock=stock)
    quotes, enquiries = Quotes(), FakeEnquiries()
    client, _ = make_client(lead_finder=LeadFinderService(repo, mode="fixture", clock=lambda: NOW), quotes=quotes, enquiries=enquiries)
    return client, repo, quotes, enquiries


def qualified(client: Any, repo: FakeLeadFinderRepo, persona: str = "interested", language: str = "en") -> str:
    plan = client.post(f"{URL}/lead-finder/plan", json={"text": "find saree shops in Jayanagar"}, headers=auth("a_owner")).json()
    client.post(f"{URL}/lead-finder/searches/{plan['id']}/approve", headers=auth("a_owner"))
    target = next(r for r in sorted(repo.rows.values(), key=lambda r: -r["fit_score"]) if r["decision_reason"] == "first_calls")
    client.post(f"{URL}/prospects/actions", json={"ids": [target["id"]], "action": "call"}, headers=auth("a_owner"))
    call = client.post(f"{URL}/prospects/{target['id']}/simulated-call", json={"persona": persona, "language": language}, headers=auth("a_owner"))
    assert call.status_code == 200, call.text
    return str(target["id"])


# ---------------------------------------------------------------------------------------------------------------------------------- the quantity the buyer said
@pytest.mark.parametrize("said, n", [
    ("About forty pieces a month, more in the season.", 40), ("About two hundred bags of cement a month.", 200), ("నెలకి సుమారు నలభై pieces, season లో ఎక్కువ.", 40),
    ("నెలకి సుమారు రెండు వందల bags cement.", 200), ("40 pieces", 40), ("౩౦ pieces", 30), ("two hundred and fifty", 250), ("a hundred sarees", 100), ("twenty-five pieces", 25), ("a dozen", 12),
    ("రెండు వందల యాభై", 250),
])
def test_the_quantity_is_the_number_the_buyer_said(said: str, n: int) -> None:
    assert quantity_of(said) == n


@pytest.mark.parametrize("said", ["", "I don't know yet", "We buy a lot", "depends on the season", "నాకు తెలియదు", "0 pieces", "99999 pieces"])
def test_no_number_said_is_no_quantity_never_a_guess(said: str) -> None:
    assert quantity_of(said) is None


# ---------------------------------------------------------------------------------------------------------------------------------- the preview
def test_the_preview_lists_the_lines_at_the_owners_prices_and_says_why_others_are_left_out_and_stores_nothing() -> None:
    client, repo, quotes, enquiries = world()
    pid = qualified(client, repo)
    r = client.get(f"{URL}/prospects/{pid}/quote-draft", headers=auth("a_sales"))
    assert r.status_code == 200, r.text
    p = r.json()
    priced = {s["name"]: s["price_paise"] for s in TEXTILE_STOCK if s["stock_status"] == "in_stock" and s["price_paise"]}
    assert p["ready"] is True and p["made"] is False and p["quote_id"] == str(quote_id_for(uuid.UUID(pid)))
    assert p["lines"] and all(line["unit_price_paise"] == priced[line["item"]] for line in p["lines"]), "the Owner's exact catalogue price, nothing else"
    assert all(line["qty"] == 40 and line["quantity_said"].startswith("About forty pieces") for line in p["lines"]), "the quantity the buyer said"
    assert all(line["item_type_code"] == item_type_code(line["item"]) for line in p["lines"])
    pitched = repo.rows[pid]["qualification"]["pitched"]
    assert {line["item"] for line in p["lines"]} | {x["item"] for x in p["left_out"]} == set(pitched), "every pitched item is either a line or left out with a reason"
    assert not any(n in ("save_item_type", "create_manual_draft") for n, _ in quotes.calls) and enquiries.created == [], "the preview stores nothing"


def test_an_item_with_no_exact_price_is_left_out_never_priced() -> None:
    stock = [dict(s) for s in TEXTILE_STOCK]
    stock[1]["price_paise"] = None   # Dharmavaram Silk Classic: in stock, but the Owner set no exact price
    client, repo, _, _ = world(stock=stock)
    pid = qualified(client, repo)
    p = client.get(f"{URL}/prospects/{pid}/quote-draft", headers=auth("a_owner")).json()
    assert {"item": "Dharmavaram Silk Classic", "reason": "no_price"} in p["left_out"]
    assert all(line["item"] != "Dharmavaram Silk Classic" for line in p["lines"])


def test_an_item_out_of_stock_since_the_call_is_left_out() -> None:
    client, repo, _, _ = world()
    pid = qualified(client, repo)
    repo._stock = [dict(s, stock_status="made_to_order") if s["name"] == "Kanchi Pattu Bridal" else dict(s) for s in TEXTILE_STOCK]
    p = client.get(f"{URL}/prospects/{pid}/quote-draft", headers=auth("a_owner")).json()
    assert {"item": "Kanchi Pattu Bridal", "reason": "not_in_stock"} in p["left_out"]


def test_no_quantity_said_means_no_draft() -> None:
    client, repo, _, _ = world()
    pid = qualified(client, repo)
    for s in repo.rows[pid]["qualification"]["quote_suggestion"]:
        s["quantity_said"] = "depends on the season"
    p = client.get(f"{URL}/prospects/{pid}/quote-draft", headers=auth("a_owner")).json()
    assert p["ready"] is False and p["lines"] == [] and {x["reason"] for x in p["left_out"]} == {"no_quantity"}
    r = client.post(f"{URL}/prospects/{pid}/quote-draft", json={}, headers=auth("a_owner"))
    assert r.status_code == 422 and r.json()["error"]["code"] == "nothing_to_quote"


# ---------------------------------------------------------------------------------------------------------------------------------- the button
def test_the_owners_button_makes_one_enquiry_and_one_draft_and_nothing_is_approved_or_sent() -> None:
    client, repo, quotes, enquiries = world()
    pid = qualified(client, repo)
    r = client.post(f"{URL}/prospects/{pid}/quote-draft", json={"customer_kind": "new"}, headers=auth("a_owner"))
    assert r.status_code == 201, r.text
    out = r.json()
    assert out["status"] == "draft" and out["quote_id"] == str(quote_id_for(uuid.UUID(pid))) and out["enquiry_id"] == str(enquiry_id_for(uuid.UUID(pid))) and out["replayed"] is False
    assert out["total_paise"] and out["total_paise"] > 0
    # one enquiry on the Lead Desk lead the call made, in plain words (ours, not the transcript)
    assert len(enquiries.created) == 1
    enquiry = enquiries.created[0]
    assert enquiry["lead_id"] == repo.rows[pid]["lead_id"] and enquiry["channel"] == "other" and enquiry["body"].startswith("Practice call (simulated) by the Lead Finder")
    assert "Nothing was dialled" in enquiry["body"]
    # the item types (one per item), then the draft through the quotes' own path: exactly the three typed keys per line, the Owner's prices
    saved = [a for n, a in quotes.calls if n == "save_item_type"]
    assert [a["p_name"] for a in saved] == [line["item"] for line in out["lines"]]
    made = [a for n, a in quotes.calls if n == "create_manual_draft"]
    assert len(made) == 1 and made[0]["p_lines"] == [{"item_type_code": line["item_type_code"], "qty": line["qty"], "unit_price_paise": line["unit_price_paise"]} for line in out["lines"]]
    assert json.loads(made[0]["p_request_text"])["as_of"]
    assert not any(n in ("approve", "send") for n, _ in quotes.calls), "a draft: the Owner approves it on the quote page"
    # the preview now says it is made
    assert client.get(f"{URL}/prospects/{pid}/quote-draft", headers=auth("a_owner")).json()["made"] is True
    # the same button again: the same enquiry and the same draft, nothing new
    again = client.post(f"{URL}/prospects/{pid}/quote-draft", json={"customer_kind": "new"}, headers=auth("a_owner"))
    assert again.status_code == 200 and again.json()["replayed"] is True and again.json()["quote_id"] == out["quote_id"]
    assert len({uuid.UUID(e["id"]) for e in enquiries.created}) == 1 and len(quotes.rows) == 1
    assert len([1 for n, _ in quotes.calls if n == "save_item_type"]) == len(saved), "an item type is made once"


def test_a_telugu_call_makes_the_same_draft() -> None:
    client, repo, _, _ = world()
    pid = qualified(client, repo, language="te")
    p = client.get(f"{URL}/prospects/{pid}/quote-draft", headers=auth("a_owner")).json()
    assert p["ready"] and all(line["qty"] == 40 for line in p["lines"])
    assert client.post(f"{URL}/prospects/{pid}/quote-draft", json={}, headers=auth("a_owner")).status_code == 201


@pytest.mark.parametrize("user, claims, status", [("a_sales", {}, 403), ("a_viewer", {}, 403), ("a_owner", {"aal": "aal1"}, 403), ("a_admin", {}, 201)])
def test_the_button_is_the_owners_or_an_admins_with_the_second_factor(user: str, claims: dict[str, Any], status: int) -> None:
    client, repo, quotes, enquiries = world()
    pid = qualified(client, repo)
    r = client.post(f"{URL}/prospects/{pid}/quote-draft", json={}, headers=auth(user, **claims))
    assert r.status_code == status, (user, claims, r.text)
    if status == 403:
        assert enquiries.created == [] and not any(n == "create_manual_draft" for n, _ in quotes.calls)


@pytest.mark.parametrize("persona", ["not_interested", "busy_call_later", "rude_hangs_up"])
def test_a_call_that_did_not_qualify_has_no_draft(persona: str) -> None:
    client, repo, _, enquiries = world()
    pid = qualified(client, repo, persona=persona)
    assert repo.rows[pid]["status"] != "qualified"
    assert client.get(f"{URL}/prospects/{pid}/quote-draft", headers=auth("a_owner")).json()["error"]["code"] == "not_qualified"
    assert client.post(f"{URL}/prospects/{pid}/quote-draft", json={}, headers=auth("a_owner")).status_code == 409 and enquiries.created == []


def test_a_school_has_no_quote_draft_route_either() -> None:
    client, _, _, _ = world(pack="education", module_on=False)
    pid = uuid.uuid4()
    for method in ("get", "post"):
        r = getattr(client, method)(f"{URL}/prospects/{pid}/quote-draft", headers=auth("a_owner"), **({"json": {}} if method == "post" else {}))
        assert r.status_code == 403 and r.json()["error"]["code"] == "lead_finder_not_available", method


def test_the_request_is_closed() -> None:
    client, repo, _, _ = world()
    pid = qualified(client, repo)
    bad: dict[str, Any]
    for bad in ({"unit_price_paise": 1}, {"lines": []}, {"customer_kind": "vip"}, {"delivery_state": "Karnataka"}):
        assert client.post(f"{URL}/prospects/{pid}/quote-draft", json=bad, headers=auth("a_owner")).status_code == 422, bad
