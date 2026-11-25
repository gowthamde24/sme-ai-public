"""Every sentence a lead-source card says has a CODE with its parameters (planner and C2, 18 Nov 2026): the web holds the words in each language, the English fields stay as the fallback."""

# ruff: noqa: E501

from __future__ import annotations

import itertools
from typing import Any

from app.lead_sources import cards
from app.lead_sources.cards import Available, build_cards, text_ref


def _walk(card: dict[str, Any]) -> list[str]:
    out = [card["headline"], card["detail"], (card["action"] or {}).get("label"), card["test_label"]]
    problem = card.get("problem") or {}
    out += [problem.get("message"), (problem.get("fix") or {}).get("label")]
    return [x for x in out if x]


def test_no_sentence_of_any_card_state_is_without_a_code() -> None:
    sources_sets: list[list[dict[str, Any]]] = [[]]
    for kind in ("website_form", "meta_lead_ads", "indiamart", "email_forward", "missed_calls", "google_ads"):
        for status in ("active", "paused"):
            sources_sets.append([{"kind": {"website_form": "website", "meta_lead_ads": "meta_lead_ads"}.get(kind, kind), "status": status}])
    stats_sets = [{}, {"by_tag": {t: {"received_7d": 3, "total": 9, "last_at": "2026-11-17T10:00:00+00:00"} for t in ("website_form", "meta_lead_ads", "indiamart", "email_forward", "missed_calls", "google_ads", "excel_upload", "click_to_whatsapp", "whatsapp")}},
                  {"by_tag": {"website_form": {"received_7d": 1}}, "whatsapp": {"status": "active"}, "sheets": {"total": 2, "needs_attention": 1}},
                  {"whatsapp": {"status": "pending"}, "sheets": {"total": 1}, "imports": {"received_7d": 4}}, {"by_tag": {"website_form": {"received_7d": 0, "last_at": "2026-10-01T10:00:00+00:00"}}},
                  {"indiamart_pull": {"key_state": "expired"}, "by_tag": {"indiamart": {"received_7d": 2, "total": 5, "last_at": "2026-11-17T10:00:00+00:00"}}}]
    unknown: set[str] = set()
    for sources, stats, on in itertools.product(sources_sets, stats_sets, (Available(), Available(True, True, True, True, True, True))):
        for card in build_cards(sources, stats, on):
            assert set(card["text"]) == {"headline", "detail", "action", "test_label", "problem_message", "problem_fix"}
            for sentence in _walk(card):
                ref = text_ref(sentence)
                if ref is None or ref["code"] == "unknown":
                    unknown.add(sentence)
    assert not unknown, f"add a code for: {sorted(unknown)}"


def test_codes_carry_their_numbers_as_params_and_codes_are_unique_names() -> None:
    assert text_ref("3 leads this week") == {"code": "detail.leads_this_week", "params": {"n": 3}}
    assert text_ref("1 lead this week") == {"code": "detail.leads_this_week", "params": {"n": 1}}
    assert text_ref("2 sheets linked") == {"code": "detail.sheets_linked", "params": {"n": 2}}
    assert text_ref("5 new chats this week") == {"code": "detail.chats_this_week", "params": {"n": 5}}
    assert text_ref(None) is None and text_ref("") is None
    values = list(cards.CODES.values())
    assert len(values) == len(set(values)), "one code for one sentence"
    assert all(v.split(".")[0] in {"card", "detail", "off", "problem", "action", "test"} for v in values)
