"""Job EE: the profile of a lead. The rules' first guess (pure), the Lead Desk list with its filters and its stored guesses, the owner's fix, "opened", and the model's better guess that may only tidy what the person wrote."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any

import pytest

from app.lead_profile import rules
from app.lead_profile.service import LeadProfileService, ist_day_start
from tests.fakes import TENANT_A, auth, make_client

T = f"/v1/tenants/{TENANT_A.id}"


# ============================================================================ the rules (pure)
def test_a_labelled_requirement_becomes_the_need_quantity_and_city() -> None:
    g = rules.guess("Name: Ravi\nRequirement: 500 paver blocks in Eluru, needed urgently", has_phone=True)
    assert g.fields["need"] == "500 paver blocks in Eluru, needed urgently"
    assert g.fields["quantity"] == "500 paver blocks" and g.confidence["quantity"] == "medium"
    assert g.fields["city"] == "Eluru" and g.fields["urgency"] == "high" and g.fields["language"] == "en"
    assert "high" not in g.confidence.values(), "only the owner makes a field high"
    assert g.junk is None


def test_budget_and_timeline_are_read_as_written() -> None:
    g = rules.guess("Looking for a 3BHK flat, budget 50 lakhs, within 2 months", has_phone=True)
    assert g.fields["budget"] == "50 lakhs" and g.fields["timeline"] == "within 2 months" and g.fields["urgency"] == "normal"
    assert rules.guess("price for 100 bags cement, Rs 5,00,000 total, tomorrow", has_phone=True).fields["budget"].startswith("Rs 5,00,000")


def test_a_message_in_telugu_or_hindi_has_that_language() -> None:
    assert rules.guess("నాకు 200 ఇటుకలు కావాలి వెంటనే", has_phone=True).fields["language"] == "te"
    g = rules.guess("मुझे 50 बैग सीमेंट चाहिए आज", has_phone=True)
    assert g.fields["language"] == "hi" and g.fields["urgency"] == "high"


@pytest.mark.parametrize(
    ("text", "phone", "email", "junk"),
    [
        ("test lead please ignore", True, False, "test"),
        ("Testing 123", True, False, "test"),
        ("Win cash now, click here https://a.example/x https://b.example/y", True, False, "spam"),
        ("buy bitcoin and forex signals", True, False, "spam"),
        ("you are an idiot", True, False, "abuse"),
        ("Need 5 tons of steel", False, False, "no_contact"),
        ("Need 5 tons of steel", False, True, None),
        ("Need 5 tons of steel", True, False, None),
    ],
)
def test_junk_is_flagged_by_reason_and_never_for_a_normal_lead(text: str, phone: bool, email: bool, junk: str | None) -> None:
    assert rules.guess(text, has_phone=phone, has_email=email).junk == junk


def test_a_profile_never_repeats_a_phone_number_or_an_email_address() -> None:
    assert rules.clean_value("call 98765 43210", 100) is None
    assert rules.clean_value("mail me ravi@example.com", 100) is None
    assert rules.clean_value("  60 mm   grey  ", 100) == "60 mm grey"
    assert rules.guess("Need pavers. Call 9876543210", has_phone=True).fields.get("need", "").find("9876543210") == -1


def test_the_rules_are_fast_on_hostile_input() -> None:
    import time

    start = time.perf_counter()
    rules.guess("1 " * 800 + "a" * 3000 + " in " + "Aa " * 500, has_phone=True)
    rules.guess("₹" + "9," * 900 + "x", has_phone=True)
    assert time.perf_counter() - start < 1.0


# ============================================================================ a fake of the database functions
LEAD_A, LEAD_B, LEAD_C = (uuid.UUID(int=0xE0 + i) for i in range(3))


class FakeRepo:
    def __init__(self) -> None:
        base = datetime(2026, 10, 29, 6, 0, tzinfo=UTC)
        self.rows: dict[uuid.UUID, dict[str, Any]] = {}
        for i, (lead, text) in enumerate([(LEAD_A, "Requirement: 500 paver blocks in Eluru urgently"), (LEAD_B, "test lead"), (LEAD_C, "Need cement, budget 2 lakhs")]):
            self.rows[lead] = {
                "id": str(lead), "created_by": None, "created_via": "import", "created_at": (base - timedelta(hours=i)).isoformat(), "updated_at": base.isoformat(), "archived_at": None,
                "company_id": None, "contact_id": None, "owner_user_id": None, "status": "new", "source": "justdial", "disqualified_reason": None, "is_new": True, "needs_profile": True,
                "profile": {"name": f"Lead {i}", "phone_e164": "+919876543210", "email": None, "original_text": text, "confidence": {}, "merged_count": 0, "junk": False, "fixed_by_you": [], "duplicate_of": None},
            }
        self.seeded: list[dict[str, Any]] = []
        self.calls: list[tuple[str, Any]] = []

    def page(self, token: str, tenant_id: uuid.UUID, args: dict[str, Any]) -> dict[str, Any]:
        self.calls.append(("page", args))
        items = [r for r in self.rows.values() if args.get("p_urgency") in (None, (r["profile"].get("urgency")))]
        if args.get("p_junk") == "only":
            items = [r for r in items if r["profile"]["junk"]]
        return {"items": [dict(r) for r in items][: args["p_limit"]], "more": len(items) > args["p_limit"]}

    def get(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> dict[str, Any] | None:
        return dict(self.rows[lead_id]) if lead_id in self.rows else None

    def unseeded(self, token: str, tenant_id: uuid.UUID, limit: int) -> list[dict[str, Any]]:
        return [{"lead_id": r["id"], "source": r["source"], "text": r["profile"]["original_text"], "has_phone": True, "has_email": False} for r in self.rows.values() if r["needs_profile"]][:limit]

    def seed(self, token: str, tenant_id: uuid.UUID, items: list[dict[str, Any]]) -> int:
        self.seeded.extend(items)
        for it in items:
            row = self.rows[uuid.UUID(it["lead_id"])]
            row["needs_profile"] = False
            row["profile"].update(it["fields"])
            row["profile"]["confidence"] = it["confidence"]
            row["profile"]["junk"] = {"reason": it["junk"]} if it["junk"] else False
        return len(items)

    def fix(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, fields: dict[str, Any]) -> dict[str, Any]:
        row = self.rows[lead_id]
        for k, v in fields.items():
            if k == "junk":
                row["profile"]["junk"] = {"reason": v} if v else False
            else:
                row["profile"][k] = v
            row["profile"]["confidence"][k] = "high"
            row["profile"]["fixed_by_you"].append(k)
        return dict(row)

    def apply_ai(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID, fields: dict[str, str], confidence: dict[str, str]) -> dict[str, Any]:
        row = self.rows[lead_id]
        for k, v in fields.items():
            if k not in row["profile"]["fixed_by_you"]:
                row["profile"][k] = v
                row["profile"]["confidence"][k] = confidence[k]
        return dict(row)

    def open(self, token: str, tenant_id: uuid.UUID, lead_id: uuid.UUID) -> bool:
        self.rows[lead_id]["is_new"] = False
        return True


def world() -> tuple[Any, FakeRepo]:
    repo = FakeRepo()
    client, _ = make_client(lead_profiles=LeadProfileService(repo))
    return client, repo


def lead_ids(page: dict[str, Any]) -> list[str]:
    return [i["id"] for i in page["items"]]


# ============================================================================ the list and the one lead
def test_the_list_carries_the_profile_and_stores_the_first_guess_once() -> None:
    client, repo = world()
    r = client.get(f"{T}/leads", headers=auth("a_owner"))
    assert r.status_code == 200
    body = r.json()
    first = next(i for i in body["items"] if i["id"] == str(LEAD_A))
    assert first["profile"]["need"] == "500 paver blocks in Eluru urgently" and first["profile"]["city"] == "Eluru" and first["profile"]["urgency"] == "high"
    assert first["profile"]["confidence"]["city"] == "medium" and first["is_new"] is True and "needs_profile" not in first
    junk = next(i for i in body["items"] if i["id"] == str(LEAD_B))
    assert junk["profile"]["junk"] == {"reason": "test"}
    assert len(repo.seeded) == 3
    client.get(f"{T}/leads", headers=auth("a_owner"))
    assert len(repo.seeded) == 3, "a lead that was guessed is not guessed again"


def test_a_filter_on_the_profile_first_guesses_the_leads_nobody_has_looked_at() -> None:
    client, repo = world()
    r = client.get(f"{T}/leads?urgency=high", headers=auth("a_owner"))
    assert r.status_code == 200 and lead_ids(r.json()) == [str(LEAD_A)]
    assert repo.calls[-1][1]["p_urgency"] == "high"
    assert lead_ids(client.get(f"{T}/leads?junk=only", headers=auth("a_owner")).json()) == [str(LEAD_B)]


def test_the_date_filters_are_india_days_and_the_end_day_is_included() -> None:
    client, repo = world()
    client.get(f"{T}/leads?created_from=2026-10-29&created_to=2026-10-30&status=new&source=justdial&q=paver&new=true", headers=auth("a_owner"))
    args = repo.calls[-1][1]
    assert args["p_from"] == "2026-10-28T18:30:00+00:00" and args["p_to"] == "2026-10-30T18:30:00+00:00"
    assert (args["p_status"], args["p_source"], args["p_q"], args["p_new"]) == ("new", "justdial", "paver", True)
    assert ist_day_start(date(2026, 10, 29)).isoformat() == "2026-10-28T18:30:00+00:00"


def test_bad_filters_are_422_and_a_page_has_a_cursor_only_when_there_is_more() -> None:
    client, _ = world()
    for bad in ("urgency=extreme", "status=bogus", "junk=maybe", "created_from=yesterday", "cursor=%%%"):
        assert client.get(f"{T}/leads?{bad}", headers=auth("a_owner")).status_code == 422, bad
    page = client.get(f"{T}/leads?limit=2", headers=auth("a_owner")).json()
    assert len(page["items"]) == 2 and page["next_cursor"]
    assert client.get(f"{T}/leads?limit=100", headers=auth("a_owner")).json()["next_cursor"] is None


def test_one_lead_has_its_profile_and_an_unknown_one_is_404() -> None:
    client, _ = world()
    r = client.get(f"{T}/leads/{LEAD_A}", headers=auth("a_viewer"))
    assert r.status_code == 200 and r.json()["profile"]["quantity"] == "500 paver blocks"
    assert client.get(f"{T}/leads/{uuid.UUID(int=0x999)}", headers=auth("a_owner")).status_code == 404
    assert client.get(f"{T}/leads/not-a-uuid", headers=auth("a_owner")).status_code == 404


# ============================================================================ fix, opened
def test_the_owner_fixes_fields_and_they_are_marked_fixed_by_you() -> None:
    client, _ = world()
    r = client.patch(f"{T}/leads/{LEAD_A}/profile", json={"city": "Vijayawada", "budget": None, "urgency": "low"}, headers=auth("a_sales"))
    assert r.status_code == 200
    p = r.json()["profile"]
    assert p["city"] == "Vijayawada" and p["urgency"] == "low" and p["confidence"]["city"] == "high" and set(p["fixed_by_you"]) == {"city", "budget", "urgency"}
    assert client.patch(f"{T}/leads/{LEAD_B}/profile", json={"junk": "spam"}, headers=auth("a_owner")).json()["profile"]["junk"] == {"reason": "spam"}


def test_a_fix_refuses_contact_fields_unknown_fields_nothing_and_a_viewer() -> None:
    client, _ = world()
    for body in ({"name": "x"}, {"phone_e164": "+911"}, {"urgency": "extreme"}, {"junk": "rude"}, {"city": ""}, {}):
        assert client.patch(f"{T}/leads/{LEAD_A}/profile", json=body, headers=auth("a_owner")).status_code == 422, body
    assert client.patch(f"{T}/leads/{LEAD_A}/profile", json={"city": "x"}, headers=auth("a_viewer")).status_code == 403
    assert client.patch(f"{T}/leads/{LEAD_A}/profile", json={"city": "x"}).status_code == 401


def test_opening_a_lead_removes_new_for_that_person() -> None:
    client, repo = world()
    assert client.post(f"{T}/leads/{LEAD_A}/seen", headers=auth("a_owner")).status_code == 204
    assert repo.rows[LEAD_A]["is_new"] is False and repo.rows[LEAD_B]["is_new"] is True
    assert client.post(f"{T}/leads/{LEAD_A}/seen", headers=auth("a_viewer")).status_code == 403
    assert client.post(f"{T}/leads/nope/seen", headers=auth("a_owner")).status_code == 404


# ============================================================================ the model's better guess
def test_the_model_may_tidy_but_not_invent_and_never_overwrites_a_fixed_field() -> None:
    repo = FakeRepo()
    service = LeadProfileService(repo)
    entry = {"ref": 1, "need": "paver blocks", "quantity": "500 blocks", "city": "Eluru", "budget": "9 lakhs", "timeline": "next week", "urgency": "high", "language": "en", "area": "call 9876543210"}
    fields = service._verified(entry, "Requirement: 500 paver blocks in Eluru urgently")
    assert fields == {"need": "paver blocks", "quantity": "500 blocks", "city": "Eluru", "timeline": "next week", "urgency": "high", "language": "en"}, "a budget with a number nobody wrote and a field with a phone number are dropped"
    repo.rows[LEAD_A]["profile"]["fixed_by_you"].append("city")
    repo.rows[LEAD_A]["profile"]["city"] = "Vijayawada"
    repo.apply_ai("t", TENANT_A.id, LEAD_A, fields, {k: "low" for k in fields})
    assert repo.rows[LEAD_A]["profile"]["city"] == "Vijayawada" and repo.rows[LEAD_A]["profile"]["need"] == "paver blocks"

