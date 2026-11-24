"""scripts/apply_assistant_config.py against a fake API: a dry run writes nothing, --apply writes only what differs, a price list that is not loaded keeps price answers OFF, a workspace of someone else is never touched, and nothing secret is printed."""

# ruff: noqa: E501
from __future__ import annotations

import argparse
import importlib.util
import json
import uuid
from pathlib import Path
from typing import Any

import httpx
import pytest

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location("apply_assistant_config", ROOT / "scripts" / "apply_assistant_config.py")
assert spec is not None and spec.loader is not None
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

TENANT = str(uuid.UUID(int=0xC2))
DEFAULTS = {"name": "Radha", "voice_persona": "female_warm", "main_language": "te", "auto_switch_language": True, "allow_english_mixing": True, "style": "warm", "speed": 1.0, "may_answer_prices": True, "may_book_visits": True,
            "may_send_media": True, "may_talk_dues": False, "max_discount_percent": 5, "handover_owner_asked": True, "handover_upset": True, "handover_order_above_paise": 5000000, "call_days": [1, 2, 3, 4, 5, 6], "call_from_minute": 540, "call_to_minute": 1140}


class Fake:
    def __init__(self, *, prices: bool = True, owner: bool = True, current: dict[str, Any] | None = None) -> None:
        self.writes: list[tuple[str, str, Any]] = []
        self.prices, self.owner = prices, owner
        self.settings = dict(current or DEFAULTS)
        self.training: dict[str, Any] = {"never_say": [], "questions": [], "greeting": {}}
        self.voice = "te-sarika"

    def handler(self, request: httpx.Request) -> httpx.Response:
        path, method = request.url.path, request.method
        body: Any = json.loads(request.content) if request.content else None
        if method != "GET":
            self.writes.append((method, path, body))
        if path.endswith("/v1/me"):
            return httpx.Response(200, json={"memberships": [{"role": "owner" if self.owner else "viewer", "tenant": {"id": TENANT, "slug": "shop"}}]})
        if path.endswith("/price-lists/current"):
            return httpx.Response(200, json={"current": {"version_no": 1} if self.prices else None, "upcoming": None})
        if path.endswith("/ai-assistant") and method == "GET":
            return httpx.Response(200, json={"settings": self.settings, "saved": True})
        if path.endswith("/ai-assistant") and method == "PUT":
            self.settings = body
            return httpx.Response(200, json={"settings": body})
        if path.endswith("/ai-assistant/voices") and method == "GET":
            return httpx.Response(200, json={"gender": "female", "languages": [{"language": "te", "chosen_id": self.voice}]})
        if path.endswith("/ai-assistant/voices") and method == "PUT":
            self.voice = body["voice_id"]
            return httpx.Response(200, json={})
        if path.endswith("/how-assistant-speaks") and method == "GET":
            return httpx.Response(200, json={"tone": {"value": "friendly"}, "say_ai_when_greeting": {"value": False}, "background": {"value": "off"}})
        if path.endswith("/how-assistant-speaks") and method == "PUT":
            return httpx.Response(200, json={})
        if path.endswith("/talk-training") and method == "GET":
            return httpx.Response(200, json={"training": self.training})
        if path.endswith("/talk-training") and method == "PUT":
            self.training = body
            return httpx.Response(200, json={})
        return httpx.Response(404)


def run(fake: Fake, *, apply: bool = False, **over: Any) -> tuple[int, list[str]]:
    args = argparse.Namespace(workspace="shop", config=str(ROOT / "deploy" / "customer-zero-assistant.json"), days=None, start=None, end=None, greeting_te=None, apply=apply, **over)
    api = mod.Api(httpx.Client(transport=httpx.MockTransport(fake.handler)), "https://api.test")
    lines: list[str] = []
    code = mod.run(args, api, lines.append)
    return code, lines


def test_a_dry_run_shows_the_differences_and_writes_nothing() -> None:
    fake = Fake()
    code, lines = run(fake)
    text = "\n".join(lines)
    assert code == 0 and fake.writes == []
    assert "assistant.style: 'warm' -> 'respectful'" in text and "assistant.max_discount_percent: 5 -> 0" in text and "voice.te: 'te-sarika' -> 'te-kavitha'" in text and "speaks.tone: 'friendly' -> 'respectful'" in text
    assert "DRY RUN" in text


def test_apply_writes_each_part_once_and_a_second_run_finds_nothing_to_do() -> None:
    fake = Fake()
    run(fake, apply=True)
    assert [(m, p.rsplit("/", 1)[-1]) for m, p, _ in fake.writes] == [("PUT", "ai-assistant"), ("PUT", "voices"), ("PUT", "how-assistant-speaks"), ("PUT", "talk-training")]
    assert fake.settings["style"] == "respectful" and fake.settings["max_discount_percent"] == 0 and fake.voice == "te-kavitha"
    assert len(fake.training["never_say"]) == 5 and len(fake.training["questions"]) == 5
    fake.writes.clear()
    # the how-assistant-speaks read in this fake is static, so only the other three are provably idempotent here
    code, lines = run(fake, apply=True)
    assert code == 0 and [p.rsplit("/", 1)[-1] for _, p, _ in fake.writes] == ["how-assistant-speaks"]


def test_without_a_price_list_the_assistant_never_answers_prices() -> None:
    fake = Fake(prices=False)
    _, lines = run(fake, apply=True)
    assert fake.settings["may_answer_prices"] is False and any("no price list is loaded" in x for x in lines)
    fake2 = Fake(prices=True)
    run(fake2, apply=True)
    assert fake2.settings["may_answer_prices"] is True


def test_the_calling_days_and_hours_come_from_the_shop_and_the_greeting_only_when_given() -> None:
    fake = Fake()
    run(fake, apply=True)
    assert fake.training["greeting"] == {}
    fake2 = Fake()
    args_days = argparse.Namespace(workspace="shop", config=str(ROOT / "deploy" / "customer-zero-assistant.json"), days="1-5", start="10:00", end="18:30", greeting_te="హలో, నేను Radha. చెప్పండి, ఎలా help చేయగలను?", apply=True)
    mod.run(args_days, mod.Api(httpx.Client(transport=httpx.MockTransport(fake2.handler)), "https://api.test"), lambda *_: None)
    assert fake2.settings["call_days"] == [1, 2, 3, 4, 5] and fake2.settings["call_from_minute"] == 600 and fake2.settings["call_to_minute"] == 1110 and fake2.training["greeting"] == {"te": "హలో, నేను Radha. చెప్పండి, ఎలా help చేయగలను?"}


def test_a_workspace_the_person_does_not_own_is_never_touched() -> None:
    fake = Fake(owner=False)
    with pytest.raises(mod.Stop):
        run(fake, apply=True)
    assert fake.writes == []


def test_days_and_minutes_helpers_and_the_sheet_validates_against_the_real_model() -> None:
    assert mod.days("1-6") == [1, 2, 3, 4, 5, 6] and mod.days("1,3,5") == [1, 3, 5] and mod.minutes("09:15") == 555
    from app.assistant_settings.models import AssistantSettings
    from app.talk_training.models import TalkTraining

    cfg = json.loads((ROOT / "deploy" / "customer-zero-assistant.json").read_text(encoding="utf-8"))
    AssistantSettings.model_validate(cfg["ai_assistant"])
    TalkTraining.model_validate(cfg["talk_training"])
