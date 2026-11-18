"""The first message templates (13 Nov 2026): the data holds Meta's and the database's rules, the Owner seeds them as drafts, submits them, and reads Meta's decision back. Fake Graph only, no network."""

# ruff: noqa: E501

from __future__ import annotations

import re
from typing import Any

import pytest

from app.whatsapp import first_templates
from tests.test_whatsapp_routes import ACCOUNT, T, World

OFFERS = {"new_collection_offer", "festival_offer"}
THREE = OFFERS | {"visit_reminder", "visit_confirmation", "continue_chat"}   # the templates with a third variable: a label (offers) or the visit's date and time


def test_every_first_template_obeys_the_rules_of_meta_and_of_the_database() -> None:
    drafts = first_templates.drafts()
    assert len(drafts) == 26 and {d["language"] for d in drafts} == {"en", "te", "hi", "kn"}   # 4 templates x 4 languages + 5 templates (2 offers, visit reminder and confirmation, continue_chat) x the 2 reviewed languages (en, te)
    assert {d["name"] for d in drafts} == {"visit_reminder", "visit_confirmation", "followup_nudge", "catalogue_share", "missed_call_followup", "lead_ack", "continue_chat"} | OFFERS
    for d in drafts:
        b = d["body"]
        assert re.fullmatch(r"[a-z][a-z0-9_]{0,59}", d["name"]) and 10 <= len(b) <= 1024, d
        assert b.count("{{1}}") == 1 and b.count("{{2}}") == 1 and not re.search(r"\{\{[4-9]\}\}", b), d   # owner, 15 Nov: structured variables, none may hold free message text
        assert (b.count("{{3}}") == 1) == (d["name"] in THREE), d   # the third variable: a short label (the two offers) or the visit's date and time (reminder, confirmation)
        assert not re.match(r"^\s*\{\{", b) and not re.search(r"\}\}[.!?\s]*$", b), d   # words before and after the variables
        assert not re.search(r"\}\}\s*\{\{", b), d   # never two variables side by side
        third = {"new_collection_offer": "Silk sarees", "festival_offer": "Diwali", "continue_chat": "silk sarees"}.get(d["name"], "Sat 22 Nov, 11:00 AM")
        assert first_templates.sample_values(b, d["name"]) == (["Ravi", "Sri Lakshmi Silks", third] if d["name"] in THREE else ["Ravi", "Sri Lakshmi Silks"]), d
        assert not re.search(r"₹|\brs\.?\s?\d|\d\s?%|https?://|www\.|guarantee|promise|discount", b, re.IGNORECASE), "no price, link or promise: " + b
        assert d["category"] in ("utility", "marketing") and d["purpose"] in ("visit", "followup", "info", "lead", "offer")
        if d["name"] in OFFERS:   # a marketing template with its opt-out button (Meta's own), and Reply STOP in its own words
            assert d["category"] == "marketing" and d["purpose"] == "offer" and 2 <= len(d["opt_out_label"]) <= 25 and "STOP" in b, d
        else:
            assert d["opt_out_label"] == "", d


def test_the_offers_and_the_visit_messages_exist_in_english_and_telugu_only_until_a_native_reader_has_checked_hindi_and_kannada() -> None:
    assert {(d["name"], d["language"]) for d in first_templates.drafts() if d["name"] in THREE} == {(n, lang) for n in THREE for lang in ("en", "te")}
    every = first_templates.drafts(include_unreviewed=True)
    assert len(every) == 32 and {(d["name"], d["language"]) for d in every if d["name"] in THREE} == {(n, lang) for n in THREE for lang in ("en", "te", "hi", "kn")}
    by = {(d["name"], d["language"]): d for d in every}
    # the owner's exact words (16 Nov 2026) for English and Telugu
    assert by[("new_collection_offer", "en")]["body"] == "Hello {{1}}, {{2}} has new arrivals: {{3}}. Visit us or reply here to know more. Reply STOP to unsubscribe."
    assert by[("festival_offer", "en")]["body"] == "Hello {{1}}, {{2}} wishes you a happy {{3}}! Our festive collection is ready. Visit us or reply here. Reply STOP to unsubscribe."
    assert by[("festival_offer", "te")]["body"].startswith("నమస్కారం {{1}} గారు! {{2}} తరపున మీకు {{3}} శుభాకాంక్షలు!")
    assert by[("new_collection_offer", "en")]["opt_out_label"] == "Stop promotions"
    assert by[("visit_reminder", "en")]["body"] == "Hello {{1}}, this is a reminder from {{2}} about your visit on {{3}}. Reply here if you would like to confirm or change the time."
    assert by[("visit_confirmation", "te")]["body"] == "నమస్కారం {{1}} గారు! ధన్యవాదాలు. {{3}} న {{2}} కి మీ విజిట్ ఖరారైంది. మీ కోసం ఎదురుచూస్తున్నాం."
    assert by[("missed_call_followup", "te")]["body"].startswith("నమస్కారం {{1}} గారు! {{2}} నుండి మీకు కాల్ చేశాం, కానీ మాట్లాడలేకపోయాం.")


def test_meta_gets_the_body_with_its_samples_and_a_marketing_template_also_its_opt_out_button() -> None:
    plain = first_templates.meta_components({"name": "lead_ack", "body": "Hello {{1}}, thank you for contacting {{2}}. We will call you shortly.", "opt_out_label": None})
    assert plain == [{"type": "BODY", "text": "Hello {{1}}, thank you for contacting {{2}}. We will call you shortly.", "example": {"body_text": [["Ravi", "Sri Lakshmi Silks"]]}}]
    offer = first_templates.meta_components({"name": "festival_offer", "body": "Hello {{1}}, {{2}} wishes you a happy {{3}}! Our festive collection is ready.", "opt_out_label": "Stop promotions"})
    assert offer[0]["example"] == {"body_text": [["Ravi", "Sri Lakshmi Silks", "Diwali"]]} and offer[1] == {"type": "BUTTONS", "buttons": [{"type": "QUICK_REPLY", "text": "Stop promotions"}]}


LABEL_CASES = [
    ("Silk sarees", None), ("Diwali", None), ("దీపావళి", None), ("Silk", None), ("A", "length"), ("a" * 31, "length"), ("a" * 30, None), (" Diwali", "length"), (None, "length"),
    ("Silk\nsarees", "text"), ("Silk  sarees", "text"), ("www.shop.in", "link"), ("https://x.in", "link"), ("shop.com", "link"), ("call@me", "link"),
    ("Sarees ₹999", "price"), ("Sarees Rs 999", "price"), ("Rs.500 sarees", "price"), ("999 rupees", "price"), ("50% sarees", "price"), ("percent", "price"),
    ("50 off", "discount"), ("Flat 20 OFF", "discount"), ("Big discount", "discount"), ("Cashback sarees", "discount"), ("తగ్గింపు", "discount"), ("छूट साड़ी", "discount"), ("Office wear", None), ("Silk 5 sarees", None),
]


@pytest.mark.parametrize(("label", "reason"), LABEL_CASES)
def test_the_label_rule_in_python_gives_the_same_answer_as_the_one_in_the_database(label: str | None, reason: str | None) -> None:
    """supabase/tests/database/175_marketing_templates.test.sql runs the SAME words through app.offer_label_problem."""
    assert first_templates.offer_label_problem(label) == reason


def test_the_ids_are_stable_per_workspace_and_differ_between_them() -> None:
    import uuid

    a, b = uuid.UUID("11111111-1111-4111-8111-111111111111"), uuid.UUID("22222222-2222-4222-8222-222222222222")
    assert first_templates.template_id(a, "visit_reminder", "te") == first_templates.template_id(a, "visit_reminder", "te")
    assert first_templates.template_id(a, "visit_reminder", "te") != first_templates.template_id(b, "visit_reminder", "te")
    assert first_templates.template_id(a, "visit_reminder", "te") != first_templates.template_id(a, "visit_reminder", "hi")


@pytest.fixture
def w() -> World:
    world = World()
    world.call("PUT", T + "/whatsapp/account", "a_owner", ACCOUNT)
    return world


def test_seeding_makes_twenty_drafts_once_and_only_for_owner_and_admin(w: World) -> None:
    assert w.call("POST", T + "/whatsapp/templates/first", "a_sales").status_code == 403
    first = w.call("POST", T + "/whatsapp/templates/first", "a_admin")
    assert first.status_code == 200 and first.json()["created"] == 26 and all(t["status"] == "draft" for t in first.json()["templates"])
    again = w.call("POST", T + "/whatsapp/templates/first", "a_owner")
    assert again.json()["created"] == 0 and len(again.json()["templates"]) == 26
    only = World()
    only.call("PUT", T + "/whatsapp/account", "a_owner", ACCOUNT)
    assert only.call("POST", T + "/whatsapp/templates/first?languages=en,te", "a_owner").json()["created"] == 16


def test_submit_all_sends_each_draft_to_meta_once_and_sync_reads_its_decision_back(w: World) -> None:
    w.call("POST", T + "/whatsapp/templates/first", "a_owner")
    done = w.call("POST", T + "/whatsapp/templates/submit-drafts", "a_owner").json()
    assert done["submitted"] == 26 and done["refused"] == 0 and len(w.graph.templates_created) == 26
    assert all(t["status"] == "submitted" for t in done["templates"])
    assert all(c["components"][0]["example"] == {"body_text": [["Ravi", "Sri Lakshmi Silks"]]} for c in w.graph.templates_created if c["name"].removesuffix("_v2") not in THREE), "Meta's samples: a first name and a business name, never a sample message"
    offers = [c for c in w.graph.templates_created if c["name"] in OFFERS]
    assert len(offers) == 4 and all(c["category"] == "MARKETING" and c["language"] in ("en", "te") and c["components"][1] == {"type": "BUTTONS", "buttons": [{"type": "QUICK_REPLY", "text": "Stop promotions" if c["language"] == "en" else "ప్రమోషన్లు ఆపండి"}]} for c in offers)
    assert {c["components"][0]["example"]["body_text"][0][2] for c in offers} == {"Silk sarees", "Diwali"}, "the third sample is the label"
    visits = [c for c in w.graph.templates_created if c["name"] in ("visit_reminder_v2", "visit_confirmation_v2")]
    assert len(visits) == 4 and all(c["components"][0]["example"] == {"body_text": [["Ravi", "Sri Lakshmi Silks", "Sat 22 Nov, 11:00 AM"]]} and len(c["components"]) == 1 for c in visits), "the visit's date and time is the third sample, and no button"
    assert w.call("POST", T + "/whatsapp/templates/submit-drafts", "a_owner").json()["submitted"] == 0, "nothing is sent twice"
    assert w.call("POST", T + "/whatsapp/templates/sync", "a_owner").json()["changed"] == 0, "still in review"
    w.graph.approve_template("visit_reminder_v2", "en")
    w.graph.approve_template("visit_reminder_v2", "te")
    synced = w.call("POST", T + "/whatsapp/templates/sync", "a_owner").json()
    assert synced["changed"] == 2
    status = {(t["name"], t["language"]): t["status"] for t in synced["templates"]}
    assert status[("visit_reminder", "en")] == "approved" and status[("visit_reminder", "te")] == "approved" and status[("missed_call_followup", "hi")] == "submitted"
    assert w.call("POST", T + "/whatsapp/templates/sync", "a_owner").json()["changed"] == 0, "idempotent"
    assert w.call("POST", T + "/whatsapp/templates/sync", "a_sales").status_code == 403


def test_one_template_can_be_submitted_alone_with_its_samples(w: World) -> None:
    """Owner, 15 Nov 2026: lead_ack in en and te first, the rest after review: the per-template route sends exactly that one."""
    made = w.call("POST", T + "/whatsapp/templates/first", "a_owner").json()
    wanted = [t for t in made["templates"] if t["name"] == "lead_ack" and t["language"] in ("en", "te")]
    assert len(wanted) == 2
    for t in wanted:
        r = w.call("POST", T + f"/whatsapp/templates/{t['id']}/submit", "a_owner")
        assert r.status_code == 200 and r.json()["template"]["status"] == "submitted", r.text
    assert sorted((c["name"], c["language"]) for c in w.graph.templates_created) == [("lead_ack", "en"), ("lead_ack", "te")]
    assert all(c["components"][0]["example"] == {"body_text": [["Ravi", "Sri Lakshmi Silks"]]} for c in w.graph.templates_created)
    assert w.call("POST", T + "/whatsapp/templates/submit-drafts", "a_owner").json()["submitted"] == 22, "the other 22 stay drafts until they are submitted"


def test_without_a_connected_number_nothing_goes_to_meta() -> None:
    bare = World()
    bare.call("POST", T + "/whatsapp/templates/first", "a_owner")
    r: Any = bare.call("POST", T + "/whatsapp/templates/submit-drafts", "a_owner")
    assert r.status_code == 409 and r.json()["error"]["code"] == "whatsapp_not_configured" and bare.graph.templates_created == []
    assert bare.call("POST", T + "/whatsapp/templates/sync", "a_owner").status_code == 409


def test_sending_words_to_meta_needs_the_second_factor_but_reading_meta_s_answer_does_not(w: World) -> None:
    """Owner, 16 Nov 2026: submitting templates is outward-facing, so it is a second-factor action like the number itself; syncing only reads Meta's decision."""
    made = w.call("POST", T + "/whatsapp/templates/first", "a_owner").json()
    some = made["templates"][0]["id"]
    assert w.call("POST", T + "/whatsapp/templates/submit-drafts", "a_owner", aal="aal1").status_code == 403
    assert w.call("POST", T + f"/whatsapp/templates/{some}/submit", "a_admin", aal="aal1").status_code == 403
    assert w.graph.templates_created == [], "nothing reached Meta without the second factor"
    assert w.call("POST", T + "/whatsapp/templates/sync", "a_owner", aal="aal1").status_code == 200


def test_a_name_meta_already_holds_is_refused_with_its_reason_in_the_answer_and_the_new_words_go_under_their_meta_name(w: World) -> None:
    """Owner, 16 Nov 2026: 4 of 10 went to review and 6 stayed drafts without a word. Meta already held visit_reminder, visit_confirmation and missed_call_followup (older words): the new words go under *_v2, and
    when Meta does refuse, the answer says which template and why."""
    made = w.call("POST", T + "/whatsapp/templates/first", "a_owner").json()["templates"]
    by = {(t["name"], t["language"]): t for t in made}
    assert by[("visit_reminder", "en")]["meta_name"] == "visit_reminder_v2" and by[("lead_ack", "en")]["meta_name"] is None
    done = w.call("POST", T + "/whatsapp/templates/submit-drafts", "a_owner").json()
    assert done["refused"] == 0 and done["failed"] == [] and sorted({c["name"] for c in w.graph.templates_created if "_v2" in c["name"]}) == ["missed_call_followup_v2", "visit_confirmation_v2", "visit_reminder_v2"], "Meta is asked under the Meta name"
    # a name Meta already holds in that language: the next suffix is tried, by itself, and shown (owner, 16 Nov 2026: not a manual database step)
    held = World()
    held.call("PUT", T + "/whatsapp/account", "a_owner", ACCOUNT)
    held.graph.meta_has = {("lead_ack", "en"), ("lead_ack", "te")}
    held.call("POST", T + "/whatsapp/templates/first", "a_owner")
    out = held.call("POST", T + "/whatsapp/templates/submit-drafts", "a_owner").json()
    assert out["submitted"] == 26 and out["refused"] == 0 and out["failed"] == []
    assert {(r["name"], r["language"], r["meta_name"]) for r in out["renamed"]} == {("lead_ack", "en", "lead_ack_v2"), ("lead_ack", "te", "lead_ack_v2")}
    by = {(t["name"], t["language"]): t for t in out["templates"]}
    assert by[("lead_ack", "en")]["meta_name"] == "lead_ack_v2" and by[("lead_ack", "en")]["status"] == "submitted", "the accepted name is kept on the template"
    assert ("lead_ack_v2", "en") in {(c["name"], c["language"]) for c in held.graph.templates_created}
    # every suffix taken: it stops after a few tries and says so (and which names were tried)
    stuck = World()
    stuck.call("PUT", T + "/whatsapp/account", "a_owner", ACCOUNT)
    stuck.graph.meta_has = {(n, "en") for n in ("lead_ack", *(f"lead_ack_v{i}" for i in range(2, 8)))}
    stuck.call("POST", T + "/whatsapp/templates/first", "a_owner")
    out = stuck.call("POST", T + "/whatsapp/templates/submit-drafts", "a_owner").json()
    assert out["submitted"] == 23 and out["refused"] == 1 and [(f["name"], f["language"], f["code"]) for f in out["failed"]] == [("lead_ack", "en", "name_exists")]
    assert "lead_ack_v6" in out["failed"][0]["reason"] and out["failed"][0]["meta_message"]
    one = next(t for t in stuck.call("GET", T + "/whatsapp/templates", "a_owner").json()["templates"] if t["name"] == "lead_ack" and t["status"] == "draft")
    r = stuck.call("POST", T + f"/whatsapp/templates/{one['id']}/submit", "a_owner")
    assert r.status_code == 502 and r.json()["error"]["code"] == "whatsapp_refused" and "new name" in r.json()["error"]["message"] and "WhatsApp says" in r.json()["error"]["message"]


def test_continue_the_chat_has_three_structured_variables_and_enough_words_around_them() -> None:
    """Meta refuses a body with too many variables for its length. Its exact limit is not published, so this pins what we know: continue_chat keeps at least 3 plain words per variable in each language
    (the visit reminder, approved, has 7; the offers 5), and the owner's wording (18 Nov 2026) is exactly this."""
    ours = {d["language"]: d["body"] for d in first_templates.drafts() if d["name"] == "continue_chat"}
    assert set(ours) == {"en", "te"}, "only English and Telugu are in the catalogue; Hindi and Kannada wait for a native reader"
    assert ours["en"] == "Hi {{1}}, you contacted {{2}} about {{3}}. Reply here if you would like to continue."
    assert ours["te"] == "నమస్కారం {{1}} గారు! మీరు {{3}} గురించి {{2}} ని అడిగారు. కొనసాగించాలంటే ఇక్కడే reply ఇవ్వండి."
    for lang, body in ours.items():
        plain = [w for w in re.sub(r"\{\{\d\}\}", " ", body).split() if re.search(r"\w", w)]
        assert len(plain) / 3 >= 3, (lang, len(plain))
    assert first_templates.sample_values(ours["en"], "continue_chat") == ["Ravi", "Sri Lakshmi Silks", "silk sarees"]
