"""Voice categories (planner brief 23 Nov 2026): every voice says what it sounds like and which businesses it suits; exactly 2 women + 2 men are recommended in Telugu, Hindi, Kannada and English, the defaults among them; GET /voices filters by both."""

# ruff: noqa: E501
from __future__ import annotations

import importlib.util
import json
from collections import Counter
from pathlib import Path
from typing import Any

import pytest

from app.conversation.voices import SOUNDS_LIKE, default_config, parse_config
from tests.fakes import TENANT_A, auth
from tests.test_nv_picker import BASE, world

ROOT = Path(__file__).resolve().parents[3]
RECOMMENDED_LANGS = ("te", "hi", "kn", "en")
EXPECTED_BEST_FOR = {"warm_friendly": {"retail", "clinic"}, "calm_reassuring": {"clinic", "finance", "wholesale"}, "bright_young": {"education", "retail"}, "energetic": {"auto", "retail"}, "deep_confident": {"real_estate", "wholesale", "auto"}}


def voices() -> list[Any]:
    return list(default_config().catalogue.values())


def test_every_voice_has_exactly_one_sounds_like_and_a_best_for_that_follows_it() -> None:
    for v in voices():
        assert v.sounds_like in SOUNDS_LIKE, v.id
        assert v.best_for and set(v.best_for) == EXPECTED_BEST_FOR[v.sounds_like] and set(v.best_for) <= set(default_config().best_for_words), v.id


def test_sounds_like_follows_the_tags_by_the_priority_order() -> None:
    order = [("energetic", "energetic"), ("deep", "deep_confident"), ("bright", "bright_young"), ("young", "bright_young"), ("calm", "calm_reassuring"), ("mature", "calm_reassuring"), ("warm", "warm_friendly")]
    overrides = _script().OVERRIDES
    for v in voices():
        if v.id in overrides:
            continue
        want = next((out for tag, out in order if tag in v.tags), "warm_friendly")
        assert v.sounds_like == want, (v.id, v.tags)


@pytest.mark.parametrize("lang", RECOMMENDED_LANGS)
@pytest.mark.parametrize("gender", ["female", "male"])
def test_exactly_two_recommended_per_gender_in_te_hi_kn_en_with_the_default_inside_and_a_spread(lang: str, gender: str) -> None:
    group = [v for v in voices() if v.language == lang and v.gender == gender]
    rec = [v for v in group if v.recommended]
    assert len(rec) == 2, (lang, gender, [v.id for v in rec])
    assert any(v.default for v in rec), "today's default stays inside the recommended two"
    if len({v.sounds_like for v in group}) >= 2 and not any(v.id in _script().PINNED for v in rec):
        assert len({v.sounds_like for v in rec}) == 2, f"{lang} {gender}: the two recommended voices sound different (a pinned legacy-mapping voice is the reviewed exception)"


def test_the_recommended_voices_cover_most_of_the_styles_across_the_catalogue() -> None:
    styles = {v.sounds_like for v in voices() if v.recommended and v.language in RECOMMENDED_LANGS}
    assert len(styles) >= 3, styles


def test_the_script_is_idempotent_on_the_shipped_file() -> None:
    mod = _script()
    raw = json.loads((ROOT / "services/ai-api/app/conversation/data/voices.json").read_text(encoding="utf-8"))["catalogue"]
    sl = {v["id"]: mod.sounds_like(v) for v in raw}
    assert {v["id"] for v in raw if v["recommended"] and v["language"] in RECOMMENDED_LANGS} == mod.recommended_ids(raw, sl)


def test_a_bad_category_in_a_data_file_is_refused() -> None:
    base = json.loads((ROOT / "services/ai-api/app/conversation/data/voices.json").read_text(encoding="utf-8"))
    bad = json.loads(json.dumps(base))
    bad["catalogue"][0]["sounds_like"] = "shouty"
    with pytest.raises(ValueError, match="sounds_like"):
        parse_config(bad)
    bad = json.loads(json.dumps(base))
    bad["catalogue"][0]["best_for"] = ["space_travel"]
    with pytest.raises(ValueError, match="best_for"):
        parse_config(bad)


def test_the_api_returns_the_fields_and_filters_by_each() -> None:
    client, _ = world()
    allv = client.get(f"{BASE}/voices", headers=auth("a_owner")).json()
    first = allv["languages"][0]["voices"][0]
    assert first["sounds_like"] in SOUNDS_LIKE and set(first["best_for"]) <= set(default_config().best_for_words)
    for sl in SOUNDS_LIKE:
        got = client.get(f"{BASE}/voices", params={"sounds_like": sl}, headers=auth("a_owner")).json()
        rows = [v for lang in got["languages"] for v in lang["voices"]]
        assert rows and all(v["sounds_like"] == sl for v in rows), sl
    got = client.get(f"{BASE}/voices", params={"best_for": "real_estate", "gender": "male"}, headers=auth("a_owner")).json()
    rows = [v for lang in got["languages"] for v in lang["voices"]]
    assert rows and all("real_estate" in v["best_for"] and v["gender"] == "male" for v in rows)
    assert client.get(f"{BASE}/voices", params={"sounds_like": "shouty"}, headers=auth("a_owner")).status_code == 422
    nothing = client.get(f"{BASE}/voices", params={"best_for": "space_travel"}, headers=auth("a_owner")).json()
    assert not [v for lang in nothing["languages"] for v in lang["voices"]], "an unknown business word matches no voice"
    assert sorted(default_config().best_for_words) == ["auto", "clinic", "education", "finance", "real_estate", "retail", "wholesale"]
    assert TENANT_A.id


def test_group_sizes_per_language_are_what_the_report_says() -> None:
    """The thin groups the planner asked about: Telugu 14 voices, Kannada 7, Tamil 12, Malayalam 2 (every voice is listed)."""
    per = Counter(v.language for v in voices())
    assert (per["te"], per["kn"]) == (14, 7) and per["hi"] > 100 and per["en"] > 60


def _script() -> Any:
    spec = importlib.util.spec_from_file_location("voice_categories", ROOT / "scripts" / "voice_categories.py")
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod
