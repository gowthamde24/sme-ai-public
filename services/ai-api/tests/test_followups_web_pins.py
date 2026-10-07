"""The follow-up screens repeat the API's refusal sentences and closed lists by value (T010 part 2, commit 3)."""

from __future__ import annotations

import re
from pathlib import Path
from typing import get_args

from app.followups.errors import CLIENT_REASON, DB_REASONS, REASONS
from app.followups.messages import FOLLOWUP_REFUSALS
from app.followups.models import (
    Direction,
    DiscardCode,
    DraftChannel,
    DraftStatus,
    QuestionDiscardCode,
    QuestionStatus,
    TouchChannel,
)

LIB = Path(__file__).resolve().parents[3] / "apps" / "web" / "lib" / "api"
TEXT = (LIB / "followup-text.ts").read_text()
CLIENT = (LIB / "followups.ts").read_text()


def _web_refusals() -> dict[str, dict[str, str]]:
    body = TEXT[TEXT.index("export const REFUSAL_TEXT") :]
    body = body[: body.index("\n};")]
    out: dict[str, dict[str, str]] = {}
    for code, inner in re.findall(r"^  ([a-z_]+): \{(.*?)\},?$", body, re.M | re.S):
        out[code] = {
            (quoted or bare): sentence
            for quoted, bare, sentence in re.findall(r'(?:"([^"]+)"|([a-z_]+)): "([^"]*)"', inner)
        }
    return out


def test_the_screens_sentences_are_the_apis_for_every_code_and_reason() -> None:
    expected = {code: reasons for _status, code, reasons in FOLLOWUP_REFUSALS.values()}
    assert _web_refusals() == expected


def test_every_reason_a_client_can_see_has_a_sentence_and_the_erased_key_has_none() -> None:
    web = _web_refusals()
    for sqlstate, (_status, code, _sentences) in FOLLOWUP_REFUSALS.items():
        shown = set(REASONS.get(sqlstate, ())) or {"-"}
        # every reason a client can see has a sentence; the only extra is the "other" fallback for a reason this build does not know
        assert shown <= set(web[code]), code
        assert set(web[code]) - shown <= {"other"}, code
    assert "erased_key" not in web["contact_blocked"]
    # the database's word is hidden from the client by the API; the screens never hold it
    assert CLIENT_REASON[("SM220", "erased_key")] == "key"
    assert "erased_key" in DB_REASONS["SM220"]


def _list(name: str) -> list[str]:
    body = CLIENT[CLIENT.index(f"export const {name}") :]
    return re.findall(r'"([a-z_]+)"', body[: body.index("] as const")])


def test_the_screens_closed_lists_are_the_apis() -> None:
    assert _list("DIRECTIONS") == list(get_args(Direction))
    assert _list("TOUCH_CHANNELS") == list(get_args(TouchChannel))
    assert _list("DRAFT_CHANNELS") == list(get_args(DraftChannel))
    assert _list("DRAFT_STATUSES") == list(get_args(DraftStatus))
    assert _list("DISCARD_CODES") == list(get_args(DiscardCode))
    assert _list("QUESTION_STATUSES") == list(get_args(QuestionStatus))
    assert _list("QUESTION_DISCARD_CODES") == list(get_args(QuestionDiscardCode))
