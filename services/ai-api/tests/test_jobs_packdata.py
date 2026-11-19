"""Job templates per business type (jobs contract section 5): every pack carries packages/packs/<pack>/jobs.json, read by app/jobs/packdata.py, which refuses a whole file that breaks a rule.

The checks below are written on their own, not by calling the loader's own word lists, so a loosened loader is caught here. Every customer-facing text is a DRAFT for a native reader (status "draft").
"""

# ruff: noqa: E501

from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any

import pytest

from app.autoreply.rules import asks_about_money
from app.jobs import packdata

PACKS = Path(__file__).resolve().parents[3] / "packages" / "packs"
IDS = sorted(p.parent.name for p in PACKS.glob("*/pack.json"))
AI_LINE = "{assistant}, the AI assistant of {business}"
KINDS = {"speed_to_lead", "answer_calls", "followups", "store_visits", "offers", "researcher", "custom"}
GOALS = {"answer_every_enquiry", "bring_customers_back", "fill_your_visits", "get_paid", "find_new_customers"}
NEEDS = {"whatsapp", "phone_number", "catalogue_item", "visit_hours", "lead_source"}
FINDS_OUT = {"need", "quantity", "when", "visit", "budget_range", "still_interested"}
SEASONS = {"diwali", "wedding_season", "new_year", "none"}
ALLOWED_PLACEHOLDERS = {"business", "customer", "item", "assistant"}
DIGITS = re.compile(r"[0-9౦-౯०-९೦-೯]|[₹%]")
TELUGU = re.compile(r"[ఀ-౿]")
# what no message or call to a customer may say (price, discount, promise, guarantee, refund, delivery)
FORBIDDEN_EN = re.compile(r"\b(price|prices|discount|offer|offers|free|guarantee|guaranteed|refund|cheap|cost|rate|rates|emi|sale|deal|delivery|deliver|rupees?|rs)\b", re.I)
FORBIDDEN_TE = ("డిస్కౌంట్", "ఆఫర్", "ధర", "రేటు", "రేట్", "ఫ్రీ", "ఉచిత", "గ్యారంటీ", "రిఫండ్", "తక్కువ", "రూపాయ", "ప్రైస్", "డెలివరీ")
# words about payments: allowed only in a get_paid template, and then still without an amount
PAYMENT_EN = re.compile(r"\b(payment|pay|paid|fee|fees|due|bill|invoice|balance|advance|premium|renewal|renew)\b", re.I)
PAYMENT_TE = ("పేమెంట్", "ఫీజు", "ప్రీమియం", "రెన్యువల్", "అడ్వాన్స్", "బాకీ")
# owner's own examples (decision-ai-team.md, 19 Nov): ids the first pack data must carry
OWNER_EXAMPLES = {
    "textiles": {"new_collection_arrived", "festival_collection", "wedding_season_reminder", "blouse_stitching_ready", "store_visit_booking"},
    "clinic": {"appointment_booking", "appointment_reminder_day_before", "follow_up_after_treatment"},
    "coaching": {"demo_class_booking", "admission_follow_up", "fee_reminder"},
    "real_estate": {"site_visit_booking", "new_listing_alert"},
    "wholesale_b2b": {"dealer_reorder_reminder", "new_price_list", "payment_due_reminder"},
}


def raw_of(pack_id: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((PACKS / pack_id / "jobs.json").read_text(encoding="utf-8"))
    return data


def customer_texts(template: dict[str, Any]) -> list[tuple[str, str]]:
    """(where, text) for every line a customer reads or hears."""
    out: list[tuple[str, str]] = []
    for channel in ("whatsapp", "call"):
        for language, text in template.get("preview", {}).get(channel, {}).items():
            out.append((f"{channel}.{language}", text))
    return out


def all_texts(template: dict[str, Any]) -> list[str]:
    texts = [t for part in ("title", "benefit", "ask") for t in template[part].values()] + [t for _, t in customer_texts(template)]
    for example in template.get("examples", []):
        texts += [example["name"], example["area"], *example["why"].values()]
    return texts


def test_there_is_a_pack_to_test() -> None:
    assert len(IDS) >= 13 and {"wholesale_b2b", "textiles", "clinic", "education"} <= set(IDS)


@pytest.mark.parametrize("pack_id", IDS)
def test_every_pack_has_a_jobs_file_that_the_loader_reads_whole(pack_id: str) -> None:
    assert (PACKS / pack_id / "jobs.json").is_file(), f"{pack_id} has no jobs.json: the New job sheet would have no templates for it"
    data = packdata.for_pack(pack_id, PACKS)
    assert data is not None, f"{pack_id}: jobs.json is refused by the loader (see the log)"
    assert data.status == "draft" and raw_of(pack_id)["status"] == "draft", "every customer-facing text is a draft for a native reader"
    assert 8 <= len(data.templates) <= 12
    assert 3 <= len(data.popular()) <= 4
    ids = [t.id for t in data.templates]
    assert len(set(ids)) == len(ids) and all(re.fullmatch(r"[a-z][a-z0-9_]+", i) for i in ids)
    assert raw_of(pack_id)["pack"] == pack_id


@pytest.mark.parametrize("pack_id", IDS)
def test_closed_words_only(pack_id: str) -> None:
    for t in raw_of(pack_id)["templates"]:
        assert t["kind"] in KINDS and t["goal"] in GOALS, t["id"]
        assert isinstance(t["popular"], bool)
        assert set(t["needs"]) <= NEEDS and len(set(t["needs"])) == len(t["needs"]), t["id"]
        assert set(t["finds_out"]) <= FINDS_OUT and len(set(t["finds_out"])) == len(t["finds_out"]), t["id"]
        assert t.get("season", "none") in SEASONS, t["id"]
        assert set(t) <= {"id", "kind", "goal", "popular", "title", "benefit", "ask", "preview", "examples", "needs", "finds_out", "season"}


@pytest.mark.parametrize("pack_id", IDS)
def test_languages_english_everywhere_and_telugu_for_the_words_a_customer_or_owner_reads(pack_id: str) -> None:
    for t in raw_of(pack_id)["templates"]:
        for part in ("title", "benefit", "ask"):
            assert {"en", "te"} <= set(t[part]), (t["id"], part)
        for channel in ("whatsapp", "call"):
            if channel in t.get("preview", {}):
                assert {"en", "te"} <= set(t["preview"][channel]), (t["id"], channel)
        for example in t.get("examples", []):
            assert {"en", "te"} <= set(example["why"]), t["id"]
        for part in ("title", "benefit", "ask"):
            assert set(t[part]) <= {"en", "te", "hi", "kn"} and all(v and v == v.strip() for v in t[part].values()), (t["id"], part)
        for part in ("title", "benefit", "ask"):
            assert TELUGU.search(t[part]["te"]), f"{t['id']}.{part}.te has no Telugu letters (a Latin-only value is a copy)"
        for where, text in customer_texts(t):
            if where.endswith(".te"):
                assert TELUGU.search(text), (t["id"], where)


@pytest.mark.parametrize("pack_id", IDS)
def test_no_number_price_discount_or_promise_in_any_text(pack_id: str) -> None:
    for t in raw_of(pack_id)["templates"]:
        for text in all_texts(t):
            assert not DIGITS.search(text), (t["id"], text)
        for where, text in customer_texts(t):
            assert not FORBIDDEN_EN.search(text), (t["id"], where, text)
            assert not any(word in text for word in FORBIDDEN_TE), (t["id"], where, text)
            if t["goal"] != "get_paid" and not where.endswith(".te"):
                assert not asks_about_money(text), f"{t['id']} {where}: the autoreply money rule flags this text"
            if t["goal"] != "get_paid":
                assert not PAYMENT_EN.search(text) and not any(word in text for word in PAYMENT_TE), (t["id"], where, text)


@pytest.mark.parametrize("pack_id", IDS)
def test_placeholders_are_only_the_allowed_ones_and_match_across_languages(pack_id: str) -> None:
    for t in raw_of(pack_id)["templates"]:
        preview = t.get("preview", {})
        for channel in ("whatsapp", "call"):
            texts = preview.get(channel, {})
            if not texts:
                continue
            sets = {lang: set(re.findall(r"\{([^{}]*)\}", text)) for lang, text in texts.items()}
            for lang, found in sets.items():
                assert found <= ALLOWED_PLACEHOLDERS, (t["id"], channel, lang, found)
                assert "business" in found, (t["id"], channel, lang)
                assert found == sets["en"], f"{t['id']} {channel}.{lang} uses other placeholders than en"
                assert re.sub(r"\{[a-z_]+\}", "", texts[lang]).count("{") == 0
        for part in ("title", "benefit", "ask"):
            assert all("{" not in v for v in t[part].values()), "owner-facing lines carry no placeholders"


@pytest.mark.parametrize("pack_id", IDS)
def test_every_call_snippet_is_two_lines_and_starts_with_the_ai_line(pack_id: str) -> None:
    seen = 0
    for t in raw_of(pack_id)["templates"]:
        for lang, text in t.get("preview", {}).get("call", {}).items():
            lines = text.split("\n")
            assert len(lines) == 2 and all(line.strip() for line in lines), (t["id"], lang)
            if lang == "en":
                assert lines[0].startswith(AI_LINE), (t["id"], lines[0])
            else:
                assert lines[0].startswith("{assistant}") and "{business}" in lines[0] and re.search(r"\bAI\b", lines[0]), (t["id"], lang, lines[0])
            seen += 1
    assert seen >= 4, "a pack shows several call snippets"


@pytest.mark.parametrize("pack_id", IDS)
def test_voice_sample_is_added_later_so_it_is_null(pack_id: str) -> None:
    for t in raw_of(pack_id)["templates"]:
        if t["kind"] != "researcher":
            assert t["preview"]["sample_audio"] is None, t["id"]


@pytest.mark.parametrize("pack_id", IDS)
def test_researcher_never_calls_or_messages_prospects(pack_id: str) -> None:
    templates = raw_of(pack_id)["templates"]
    researchers = [t for t in templates if t["kind"] == "researcher"]
    assert len(researchers) == 1, "the Lead Finder is visible to every business: one researcher template per pack"
    for t in researchers:
        assert "preview" not in t, "a researcher has no whatsapp or call preview"
        assert t["goal"] == "find_new_customers" and t["finds_out"] == [] and not ({"whatsapp", "phone_number"} & set(t["needs"]))
        assert len(t["examples"]) == 3
        for example in t["examples"]:
            assert example["name"].endswith("(example)") and not DIGITS.search(example["name"] + example["area"]), "an invented prospect is clearly fictional and has no number"
            assert "@" not in example["name"] and "+" not in example["name"]
        assert "you contact them yourself" in (t["benefit"]["en"] + " " + t["ask"]["en"]).lower()
        assert "మీరే" in t["benefit"]["te"] + t["ask"]["te"]
    for t in templates:
        if t["kind"] != "researcher":
            assert "examples" not in t and t["goal"] != "find_new_customers"


@pytest.mark.parametrize("pack_id", IDS)
def test_templates_are_for_enquirers_and_consenting_customers_only(pack_id: str) -> None:
    for t in raw_of(pack_id)["templates"]:
        preview = t.get("preview", {})
        if t["kind"] == "offers":
            assert "call" not in preview, "a campaign-style template never calls"
            assert "whatsapp" in t["needs"], t["id"]
            for lang, text in preview["whatsapp"].items():
                assert "STOP" in text, f"{t['id']}.{lang}: a message to customers who said yes carries the STOP line"
        if t["kind"] == "speed_to_lead":
            assert "lead_source" in t["needs"], "speed to lead starts from a live lead source (people who enquired)"
        if "call" in preview:
            assert "phone_number" in t["needs"]
        if "whatsapp" in preview:
            assert "whatsapp" in t["needs"]
            if t["kind"] != "answer_calls":
                assert all("{customer}" in text for text in preview["whatsapp"].values()), "greet by first name"


@pytest.mark.parametrize("pack_id", IDS)
def test_each_pack_covers_the_core_jobs_and_goals(pack_id: str) -> None:
    kinds = {t["kind"] for t in raw_of(pack_id)["templates"]}
    goals = {t["goal"] for t in raw_of(pack_id)["templates"]}
    assert {"speed_to_lead", "answer_calls", "researcher"} <= kinds
    assert {"answer_every_enquiry", "bring_customers_back", "fill_your_visits", "find_new_customers"} <= goals


@pytest.mark.parametrize("pack_id", sorted(OWNER_EXAMPLES))
def test_the_owner_examples_are_there(pack_id: str) -> None:
    assert OWNER_EXAMPLES[pack_id] <= {t["id"] for t in raw_of(pack_id)["templates"]}


# ---- the loader fails closed ----


def mutate(pack_id: str, change: Any) -> dict[str, Any]:
    raw = copy.deepcopy(raw_of(pack_id))
    change(raw)
    return raw


def first(raw: dict[str, Any], kind: str) -> dict[str, Any]:
    template: dict[str, Any] = next(t for t in raw["templates"] if t["kind"] == kind)
    return template


def with_call(raw: dict[str, Any]) -> dict[str, Any]:
    return next(t for t in raw["templates"] if "call" in t.get("preview", {}))


def with_whatsapp(raw: dict[str, Any]) -> dict[str, Any]:
    return next(t for t in raw["templates"] if "whatsapp" in t.get("preview", {}) and t["goal"] != "get_paid")


BAD: dict[str, Any] = {
    "status is final": lambda r: r.update(status="final"),
    "wrong pack": lambda r: r.update(pack="clinic"),
    "extra top key": lambda r: r.update(surprise=1),
    "seven templates": lambda r: r.update(templates=r["templates"][:7]),
    "thirteen templates": lambda r: r.update(templates=r["templates"] + [dict(r["templates"][0], id=f"extra_{i}") for i in range(13 - len(r["templates"]))]),
    "five popular": lambda r: [t.update(popular=True) for t in r["templates"][:5]],
    "two popular": lambda r: [t.update(popular=False) for t in r["templates"]] or [t.update(popular=True) for t in r["templates"][:2]],
    "duplicate id": lambda r: r["templates"][1].update(id=r["templates"][0]["id"]),
    "id not snake_case": lambda r: r["templates"][0].update(id="Not Snake"),
    "unknown kind": lambda r: r["templates"][0].update(kind="spam_everyone"),
    "unknown goal": lambda r: r["templates"][0].update(goal="get_rich"),
    "unknown need": lambda r: r["templates"][0]["needs"].append("credit_card"),
    "unknown finds_out": lambda r: r["templates"][0]["finds_out"].append("aadhaar"),
    "unknown season": lambda r: r["templates"][0].update(season="holi"),
    "title without te": lambda r: r["templates"][0]["title"].pop("te"),
    "ask without en": lambda r: r["templates"][0]["ask"].pop("en"),
    "te is a copy of en": lambda r: r["templates"][0]["title"].update(te=r["templates"][0]["title"]["en"]),
    "unknown language": lambda r: r["templates"][0]["title"].update(xx="hello"),
    "whatsapp without te": lambda r: with_whatsapp(r)["preview"]["whatsapp"].pop("te"),
    "a price in a message": lambda r: with_whatsapp(r)["preview"]["whatsapp"].update(en="Hi {customer}! Our price at {business} is low. – {business}"),
    "a rupee sign": lambda r: with_whatsapp(r)["preview"]["whatsapp"].update(en="Hi {customer}! {business} has it for ₹ now."),
    "a digit": lambda r: with_whatsapp(r)["preview"]["whatsapp"].update(en="Hi {customer}! {business} opens at 9."),
    "a discount in Telugu": lambda r: with_whatsapp(r)["preview"]["whatsapp"].update(te="హాయ్ {customer}! {business} లో డిస్కౌంట్ ఉంది."),
    "a guarantee": lambda r: with_whatsapp(r)["preview"]["whatsapp"].update(en="Hi {customer}! {business} gives a guarantee."),
    "a refund promise": lambda r: with_whatsapp(r)["preview"]["whatsapp"].update(en="Hi {customer}! {business} will refund you."),
    "a payment word outside get_paid": lambda r: with_whatsapp(r)["preview"]["whatsapp"].update(en="Hi {customer}! Your payment at {business} is pending."),
    "an unknown placeholder": lambda r: with_whatsapp(r)["preview"]["whatsapp"].update(en="Hi {customer}! {business} {price}"),
    "te uses other placeholders": lambda r: with_whatsapp(r)["preview"]["whatsapp"].update(te="హాయ్! {business} లో కలుద్దాం."),
    "no business in a message": lambda r: with_whatsapp(r)["preview"]["whatsapp"].update(en="Hi {customer}! Hello.", te="హాయ్ {customer}! హలో."),
    "a call that hides the AI": lambda r: with_call(r)["preview"]["call"].update(en="Hi {customer}, this is {business}.\nCan we talk?"),
    "a call of three lines": lambda r: with_call(r)["preview"]["call"].update(en=AI_LINE + ".\nOne.\nTwo."),
    "a te call without the AI": lambda r: with_call(r)["preview"]["call"].update(te="హాయ్ {customer}, {business} నుంచి.\nమాట్లాడొచ్చా?"),
    "a voice sample id before it exists": lambda r: with_call(r)["preview"].update(sample_audio="voice_1"),
    "a preview without a channel": lambda r: with_call(r).update(preview={"sample_audio": None}),
    "a researcher with a preview": lambda r: first(r, "researcher").update(preview={"whatsapp": {"en": "Hi {customer}! {business}", "te": "హాయ్ {customer}! {business}"}, "sample_audio": None}),
    "a researcher with two examples": lambda r: first(r, "researcher")["examples"].pop(),
    "a researcher example with a real-looking name": lambda r: first(r, "researcher")["examples"][0].update(name="Sri Lakshmi Sarees"),
    "a researcher example with a phone number": lambda r: first(r, "researcher")["examples"][0].update(name="Shop 9876543210 (example)"),
    "a researcher that does not say the owner contacts": lambda r: first(r, "researcher").update(benefit={"en": "Finds shops near you.", "te": "దగ్గరి షాపులను చూపిస్తుంది."}, ask={"en": "Find shops.", "te": "షాపులను వెతకండి."}),
    "a researcher that needs a number": lambda r: first(r, "researcher")["needs"].append("phone_number"),
    "examples on another kind": lambda r: r["templates"][0].update(examples=first(r, "researcher")["examples"]),
    "a call without a phone need": lambda r: with_call(r).update(needs=[n for n in with_call(r)["needs"] if n != "phone_number"]),
}


@pytest.mark.parametrize("name", sorted(BAD))
def test_the_loader_refuses_a_file_that_breaks_a_rule(name: str) -> None:
    raw = mutate("textiles", BAD[name])
    with pytest.raises(packdata.JobsPackError):
        packdata.parse("textiles", raw)


def test_a_good_file_parses_and_the_mutations_are_not_vacuous() -> None:
    assert packdata.parse("textiles", raw_of("textiles")).pack_id == "textiles"
    assert len(BAD) >= 30


def test_for_pack_answers_no_templates_for_a_broken_or_missing_file(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    (tmp_path / "textiles").mkdir()
    (tmp_path / "textiles" / "jobs.json").write_text(json.dumps(mutate("textiles", BAD["a price in a message"])), encoding="utf-8")
    (tmp_path / "clinic").mkdir()
    (tmp_path / "clinic" / "jobs.json").write_text("{not json", encoding="utf-8")
    (tmp_path / "gym").mkdir()
    with caplog.at_level("ERROR", logger="app.jobs.packdata"):
        assert packdata.for_pack("textiles", tmp_path) is None
        assert packdata.for_pack("clinic", tmp_path) is None
    assert packdata.for_pack("gym", tmp_path) is None
    assert packdata.for_pack("../etc", tmp_path) is None and packdata.for_pack(None, tmp_path) is None and packdata.for_pack("", tmp_path) is None
    assert any("refused" in r.getMessage() for r in caplog.records)


def test_for_pack_reads_the_real_files_and_helpers_work() -> None:
    data = packdata.for_pack("clinic", PACKS)
    assert data is not None and data.get("appointment_booking") is not None and data.get("nope") is None
    assert {t.id for t in data.popular()} <= {t.id for t in data.templates}
    assert all(t.goal == "fill_your_visits" for t in data.by_goal("fill_your_visits"))
    t = data.get("appointment_booking")
    assert t is not None
    assert packdata.text_in(t.title, "te") != t.title["en"] and packdata.text_in(t.title, "hi") == t.title["en"], "a missing language falls back to English"
    filled = packdata.fill(t.whatsapp["en"], business="Sunrise Clinic", customer="Ravi", item="a dental check-up")
    assert "{" not in filled and "Ravi" in filled and "Sunrise Clinic" in filled
    call = data.get("enquiry_call_right_away")
    assert call is not None and packdata.fill(call.call["en"], business="Sunrise Clinic", customer="Ravi", item="x", assistant="Priya").startswith("Priya, the AI assistant of Sunrise Clinic")
