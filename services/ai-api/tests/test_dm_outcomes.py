"""Job DM (C1 part): outcomes. The contract is committed, fresh, strict and shows nothing about a child; the routes obey the roles; the cautious reply reader gives a suggestion only when a signal is clear; the recorder
never breaks the webhook. The database's own rules are proved in supabase/tests/database/114_dm_outcomes.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import jsonschema
import pytest

from app.outcomes import classify, contracts, models
from app.outcomes.recorder import OutcomeRecorder
from app.tenancy.repository import UpstreamError
from tests.dm_fakes import FakeOutcomesRepository
from tests.fakes import TENANT_A, auth, make_client

CONTRACTS = Path(__file__).resolve().parents[3] / "packages" / "contracts"
SCHEMA = json.loads((CONTRACTS / "outcomes.schema.json").read_text())
EXAMPLES = json.loads((CONTRACTS / "outcomes.examples.json").read_text())
A = TENANT_A.id
B = f"/v1/tenants/{A}/outcomes"
CONTACT = "0b9c1e6a-3d4f-4a52-8c10-5a6b7c8d9e01"


# ------------------------------------------------------------------------------------------------ the contract
def test_the_schema_and_the_typescript_are_up_to_date() -> None:
    assert (CONTRACTS / "outcomes.schema.json").read_text() == contracts.schema_text(), "run `make contracts`"
    assert (CONTRACTS / "outcomes.ts").read_text() == contracts.ts_text(), "run `make contracts`"


def test_every_shape_forbids_unknown_properties() -> None:
    for name, node in SCHEMA["$defs"].items():
        if "properties" in node:
            assert node.get("additionalProperties") is False, name


def test_no_shape_refers_to_a_student_or_a_child() -> None:
    names = {prop.lower() for node in SCHEMA["$defs"].values() for prop in node.get("properties", {})}
    names |= {n.lower() for n in SCHEMA["$defs"]}
    assert not [n for n in names if any(w in n for w in ("student", "child", "pupil", "ward", "admission", "marks", "grade"))]


@pytest.mark.parametrize(
    ("example", "model"),
    [
        ("outcome_positive_by_ai", models.OutcomeOut),
        ("outcome_negative_corrected_by_owner", models.OutcomeOut),
        ("outcome_unclear", models.OutcomeOut),
        ("outcome_education_no_reason", models.OutcomeOut),
        ("outcome_list_page", models.OutcomeListOut),
        ("outcome_list_empty", models.OutcomeListOut),
        ("totals_today", models.OutcomeTotalsOut),
        ("totals_empty_day", models.OutcomeTotalsOut),
        ("record_request", models.OutcomeIn),
        ("correction_request", models.OutcomeCorrectionIn),
        ("customer_correction_request", models.CustomerCorrectionIn),
    ],
)
def test_the_example_payloads_match_the_models_and_the_schema(example: str, model: type) -> None:
    payload = EXAMPLES[example]
    model.model_validate(payload)  # type: ignore[attr-defined]
    validator = jsonschema.Draft202012Validator({**SCHEMA, "$ref": f"#/$defs/{model.__name__}"})
    assert list(validator.iter_errors(payload)) == []


def test_the_customer_page_examples_match_the_model_and_the_schema() -> None:
    validator = jsonschema.Draft202012Validator({**SCHEMA, "$ref": "#/$defs/CustomerOutcomeOut"})
    for item in EXAMPLES["customer_outcomes"]:
        models.CustomerOutcomeOut.model_validate(item)
        assert list(validator.iter_errors(item)) == []
        assert re.fullmatch(r"[a-z0-9-]{1,40}", item["id"]), "C2's screens refuse any other id"


def test_the_category_must_belong_to_the_outcome() -> None:
    base = {"contact_id": CONTACT, "kind": "call", "source_id": str(uuid.uuid4()), "occurred_at": "2026-10-26T10:00:00Z"}
    for outcome, category in (("positive", "not_interested"), ("negative", "interested"), ("positive", None), ("negative", None), ("unclear", "interested")):
        with pytest.raises(ValueError):
            models.OutcomeIn.model_validate({**base, "outcome": outcome, "category": category})
    for outcome, category in (("positive", "visit_booked"), ("negative", "wrong_number"), ("unclear", None), ("unclear", "call_back_later")):
        models.OutcomeIn.model_validate({**base, "outcome": outcome, "category": category})


# ------------------------------------------------------------------------------------------------ the routes
def world(**kw: Any) -> tuple[Any, FakeOutcomesRepository]:
    repo = FakeOutcomesRepository(**kw)
    client, _ = make_client(outcomes=repo)
    return client, repo


def body(source: str | None = None, **over: Any) -> dict[str, Any]:
    return {**EXAMPLES["record_request"], "source_id": source or str(uuid.uuid4()), "occurred_at": datetime.now(UTC).isoformat(), **over}


def test_who_may_read_and_who_may_write() -> None:
    for user, may_read, may_record, may_correct in (("a_owner", True, True, True), ("a_admin", True, True, True), ("a_sales", True, True, False), ("a_viewer", True, False, False)):
        client, _ = world()
        assert (client.get(B, headers=auth(user)).status_code == 200) is may_read, user
        assert (client.get(f"{B}/totals", headers=auth(user)).status_code == 200) is may_read, user
        made = client.post(B, json=body(), headers=auth(user))
        assert (made.status_code == 201) is may_record, (user, made.status_code)
        row = made.json() if may_record else None
        if row is None:
            owner_client, repo = world()
            row = owner_client.post(B, json=body(), headers=auth("a_owner")).json()
            client = owner_client
        fixed = client.patch(f"{B}/{row['id']}", json=EXAMPLES["correction_request"], headers=auth(user))
        assert (fixed.status_code == 200) is may_correct, (user, fixed.status_code)
    client, _ = world()
    assert client.get(B, headers=auth("b_owner")).status_code == 404, "another business"
    assert client.get(B).status_code == 401, "no token"


def test_the_same_source_twice_is_one_outcome() -> None:
    client, repo = world()
    source = str(uuid.uuid4())
    first = client.post(B, json=body(source), headers=auth("a_owner")).json()
    second = client.post(B, json=body(source, outcome="negative", category="not_interested"), headers=auth("a_owner")).json()
    assert first["replayed"] is False and second["replayed"] is True
    assert second["id"] == first["id"] and second["outcome"] == "positive", "the second word changes nothing"
    assert len(repo.rows) == 1


def test_a_correction_is_marked_and_a_bad_pair_is_refused() -> None:
    client, _ = world()
    row = client.post(B, json=body(), headers=auth("a_owner")).json()
    fixed = client.patch(f"{B}/{row['id']}", json={"outcome": "negative", "category": "too_costly", "reason": "Said the price is too high."}, headers=auth("a_owner")).json()
    assert fixed["corrected"] is True and fixed["outcome"] == "negative" and fixed["category"] == "too_costly"
    assert client.patch(f"{B}/{row['id']}", json={"outcome": "negative", "category": "interested"}, headers=auth("a_owner")).status_code == 422
    assert client.patch(f"{B}/{uuid.uuid4()}", json={"outcome": "unclear"}, headers=auth("a_owner")).status_code == 404
    assert client.patch(f"{B}/not-a-uuid", json={"outcome": "unclear"}, headers=auth("a_owner")).status_code == 404


def test_the_timeline_of_a_customer_is_paged_and_newest_first() -> None:
    client, _ = world()
    other = str(uuid.uuid4())
    for i in range(5):
        client.post(B, json=body(occurred_at=f"2026-10-2{i + 1}T10:00:00+00:00"), headers=auth("a_owner"))
    client.post(B, json=body(contact_id=other), headers=auth("a_owner"))
    page = client.get(B, params={"contact_id": CONTACT, "limit": 2}, headers=auth("a_owner")).json()
    assert [i["occurred_at"][:10] for i in page["items"]] == ["2026-10-25", "2026-10-24"] and page["has_more"] is True and page["next_cursor"]
    nxt = client.get(B, params={"contact_id": CONTACT, "limit": 2, "cursor": page["next_cursor"]}, headers=auth("a_owner")).json()
    assert [i["occurred_at"][:10] for i in nxt["items"]] == ["2026-10-23", "2026-10-22"]
    last = client.get(B, params={"contact_id": CONTACT, "limit": 2, "cursor": nxt["next_cursor"]}, headers=auth("a_owner")).json()
    assert [i["occurred_at"][:10] for i in last["items"]] == ["2026-10-21"] and last["has_more"] is False and last["next_cursor"] is None
    assert all(i["contact_id"] == CONTACT for i in page["items"] + nxt["items"] + last["items"])
    assert client.get(B, params={"cursor": "###"}, headers=auth("a_owner")).status_code == 422
    assert client.get(B, params={"contact_id": "nope"}, headers=auth("a_owner")).status_code == 404
    assert client.get(B, params={"limit": 101}, headers=auth("a_owner")).status_code == 422


def test_todays_totals_count_by_word_and_by_category() -> None:
    client, _ = world()
    now = datetime.now(UTC).isoformat()
    for outcome, category in (("positive", "interested"), ("positive", "visit_booked"), ("negative", "not_interested"), ("unclear", None)):
        client.post(B, json=body(outcome=outcome, category=category, occurred_at=now), headers=auth("a_owner"))
    t = client.get(f"{B}/totals", headers=auth("a_viewer")).json()
    assert t["total"] == {"positive": 2, "negative": 1, "unclear": 1} and len(t["days"]) == 1
    assert t["days"][0]["by_category"]["visit_booked"] == 1 and t["days"][0]["by_category"]["not_interested"] == 1


def test_an_education_workspace_stores_no_reason() -> None:
    client, _ = world(education=True)
    row = client.post(B, json=body(reason="Mother says her son Ravi is shy"), headers=auth("a_owner")).json()
    assert row["reason"] is None
    fixed = client.patch(f"{B}/{row['id']}", json={"outcome": "negative", "category": "too_costly", "reason": "fee too high for Ravi"}, headers=auth("a_owner")).json()
    assert fixed["reason"] is None


def test_without_the_service_the_routes_say_so() -> None:
    client, _ = make_client()
    r = client.get(B, headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "outcomes_unavailable"


# ------------------------------------------------------------------------------------------------ the cautious reply reader
@pytest.mark.parametrize(
    ("text", "outcome", "category"),
    [
        ("Not interested, thanks", "negative", "not_interested"),
        ("STOP", "negative", "not_interested"),
        ("आप गलत नंबर पर हैं", "negative", "wrong_number"),
        ("wrong number sir", "negative", "wrong_number"),
        ("ఇది తప్పు నంబర్", "negative", "wrong_number"),
        ("ನನಗೆ ಆಸಕ್ತಿ ಇಲ್ಲ", "negative", "not_interested"),
        ("ఆసక్తి లేదు", "negative", "not_interested"),
        ("This is too expensive for us", "negative", "too_costly"),
        ("बहुत महंगा है", "negative", "too_costly"),
        ("Please call me tomorrow", "unclear", "call_back_later"),
        ("बाद में बात करते हैं", "unclear", "call_back_later"),
        ("Interested, please send photos", "positive", "interested"),
        ("What is the price for 10 pieces?", "positive", "interested"),
        ("ఫోటోలు పంపండి", "positive", "interested"),
        ("ಬೆಲೆ ಎಷ್ಟು", "positive", "interested"),
        ("I will order 20 pieces", "positive", "order_likely"),
        ("Confirm the order please", "positive", "order_likely"),
    ],
)
def test_a_clear_reply_gives_a_suggestion(text: str, outcome: str, category: str) -> None:
    s = classify.classify_reply(text)
    assert s is not None and (s.outcome, s.category) == (outcome, category), text
    assert s.reason in (classify.REASONS[category], classify.STOP_REASON), "the reason is a fixed sentence, never the customer's words"


@pytest.mark.parametrize("text", [None, "", "ok", "Thanks", "hello", "👍", "Who is this?", "Interested but not interested in the blue one at that price, too costly", "x" * 700])
def test_an_unclear_or_mixed_reply_gives_nothing(text: str | None) -> None:
    assert classify.classify_reply(text) is None


def test_not_interested_is_not_read_as_interested() -> None:
    s = classify.classify_reply("not interested")
    assert s is not None and s.category == "not_interested"


def test_the_reason_never_carries_the_customers_words() -> None:
    s = classify.classify_reply("Interested! My son Ravi in class 5 needs it. 9876543210")
    assert s is not None and "Ravi" not in s.reason and "9876543210" not in s.reason


# ------------------------------------------------------------------------------------------------ the recorder
class _Repo:
    def __init__(self, fail: Exception | None = None) -> None:
        self.fail = fail
        self.bodies: list[dict[str, Any]] = []

    def record(self, token: str, tenant_id: uuid.UUID, body: dict[str, Any]) -> dict[str, Any]:
        if self.fail:
            raise self.fail
        self.bodies.append(body)
        return {}


STORED = {"outcome": "stored", "tenant_id": str(A), "contact_id": CONTACT, "lead_id": str(uuid.uuid4()), "enquiry_id": str(uuid.uuid4())}


def test_the_recorder_records_a_clear_reply_as_a_whatsapp_follow_up() -> None:
    repo = _Repo()
    assert OutcomeRecorder(repo).after_inbound("t", STORED, "Interested, send photos", None) is True  # type: ignore[arg-type]
    (sent,) = repo.bodies
    assert sent["kind"] == "whatsapp_followup" and str(sent["source_id"]) == STORED["enquiry_id"] and sent["category"] == "interested"


def test_the_recorder_ignores_an_unclear_reply_and_survives_a_refusal() -> None:
    repo = _Repo()
    assert OutcomeRecorder(repo).after_inbound("t", STORED, "ok", None) is False  # type: ignore[arg-type]
    assert repo.bodies == []
    assert OutcomeRecorder(_Repo(UpstreamError("down"))).after_inbound("t", STORED, "Interested", None) is False  # type: ignore[arg-type]
    assert OutcomeRecorder(_Repo()).after_inbound("t", {"outcome": "stored"}, "Interested", None) is False  # type: ignore[arg-type]


# ------------------------------------------------------------------------------------------------ C2's shapes (the customer page, ?day=, POST .../correct)
LEAD = "7a2d4b63-1a1f-4c7f-8e8b-2b3c4d5e6f02"


def test_the_customer_page_list_is_c2s_shape_newest_first() -> None:
    client, repo = world()
    client.post(B, json=body(lead_id=LEAD, occurred_at="2026-10-20T10:00:00+00:00"), headers=auth("a_owner"))
    client.post(B, json=body(lead_id=LEAD, kind="whatsapp_followup", occurred_at="2026-10-21T10:00:00+00:00", outcome="negative", category="too_costly"), headers=auth("a_owner"))
    client.post(B, json=body(lead_id=str(uuid.uuid4())), headers=auth("a_owner"))
    rows = client.get(f"/v1/tenants/{A}/customers/{LEAD}/outcomes", headers=auth("a_sales")).json()
    assert [r["channel"] for r in rows] == ["whatsapp", "call"] and rows[0]["result"] == "negative" and rows[0]["at"].startswith("2026-10-21")
    assert set(rows[0]) == {"id", "channel", "at", "result", "category", "reason", "corrected", "callback_at", "captured"}
    assert all(re.fullmatch(r"[a-z0-9-]{1,40}", r["id"]) for r in rows)
    assert client.get(f"/v1/tenants/{A}/customers/{LEAD}/outcomes", headers=auth("a_viewer")).status_code == 403, "Owner, Admin and Sales (C2's rule)"
    assert client.get(f"/v1/tenants/{A}/customers/nope/outcomes", headers=auth("a_owner")).status_code == 404


def test_totals_take_one_day_as_c2_asks() -> None:
    client, _ = world()
    now = datetime.now(UTC).isoformat()
    client.post(B, json=body(occurred_at=now), headers=auth("a_owner"))
    one = client.get(f"{B}/totals", params={"day": datetime.now(UTC).date().isoformat()}, headers=auth("a_owner")).json()
    assert one["total"]["positive"] == 1 and len(one["days"]) == 1
    assert client.get(f"{B}/totals", params={"day": "2026-10-26", "from": "2026-10-25"}, headers=auth("a_owner")).status_code == 422


def test_the_correction_can_be_posted_as_c2_asks() -> None:
    client, _ = world()
    row = client.post(B, json=body(reason="Asked for the price list."), headers=auth("a_owner")).json()
    fixed = client.post(f"{B}/{row['id']}/correct", json={"result": "negative", "category": "not_interested"}, headers=auth("a_admin")).json()
    assert fixed["corrected"] is True and fixed["outcome"] == "negative" and fixed["reason"] is None, "the old reason described the old word"
    assert client.post(f"{B}/{row['id']}/correct", json={"result": "negative", "category": "interested"}, headers=auth("a_owner")).status_code == 422
    assert client.post(f"{B}/{row['id']}/correct", json={"result": "unclear"}, headers=auth("a_sales")).status_code == 403
