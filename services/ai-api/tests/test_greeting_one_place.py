"""ONE greeting (owner decision 13 Nov 2026, decided by C1; the owner can reverse): the Owner writes it in Talk training. It takes the same four placeholders as the opening line. The order of what a call says first:
the campaign's own line, else the Talk training greeting, else the old workspace opening line (read-only fallback), else the default. The AI sentence stays whatever the greeting says."""

# ruff: noqa: E501

from __future__ import annotations

import uuid
from types import SimpleNamespace
from typing import Any

import pytest
from pydantic import ValidationError

from app.opening import render, resolve
from app.talk_training.models import TalkTraining
from app.telephony import persona

CAMPAIGN = str(uuid.uuid4())


def world(*, lines: list[dict[str, Any]], greeting: dict[str, str] | None, readable: bool = True) -> tuple[Any, Any]:
    class Workspace:
        def opening(self, token: str, tenant_id: Any) -> dict[str, Any]:
            return {"mention_ai": True, "lines": lines, "campaign_overrides": []}

    class Training:
        def get(self, token: str, tenant_id: Any) -> dict[str, Any] | None:
            if not readable:
                raise PermissionError("not for this role")
            return {"doc": {"greeting": greeting}} if greeting is not None else None

    runtime = SimpleNamespace(workspace=Workspace(), talk_training=Training(), assistant_settings=None)
    ctx = SimpleNamespace(principal=SimpleNamespace(token="t"), tenant=SimpleNamespace(id=uuid.uuid4(), name="Synthetic Silks"))
    return runtime, ctx


def line(text: str, campaign: str | None = None, language: str = "en") -> dict[str, Any]:
    return {"language": language, "campaign_id": campaign, "text": text}


def test_the_talk_training_greeting_is_used_with_its_placeholders_filled() -> None:
    runtime, ctx = world(lines=[line("Old workspace line, the one before the move.")], greeting={"en": "Welcome to {business}. This is {assistant} calling."})
    got = resolve.resolve(runtime, ctx, "en")
    assert got.text.startswith("Welcome to Synthetic Silks. This is ") and "Old workspace" not in got.text
    assert got.source == "stored"


def test_a_campaigns_own_line_still_wins() -> None:
    runtime, ctx = world(lines=[line("Campaign opening for {business}, a short one.", CAMPAIGN)], greeting={"en": "Greeting from training."})
    assert resolve.resolve(runtime, ctx, "en", CAMPAIGN).text.startswith("Campaign opening for Synthetic Silks")
    assert resolve.resolve(runtime, ctx, "en").text.startswith("Greeting from training.")   # no campaign: the training greeting


def test_without_a_training_greeting_the_old_workspace_line_is_the_fallback_then_the_default() -> None:
    runtime, ctx = world(lines=[line("Old workspace line, the one before the move.")], greeting=None)
    assert resolve.resolve(runtime, ctx, "en").text.startswith("Old workspace line")
    runtime, ctx = world(lines=[], greeting={"te": "తెలుగు గ్రీటింగ్"})
    assert resolve.resolve(runtime, ctx, "en").source == "default"   # a greeting in another language does not count


def test_a_draft_from_the_screen_beats_everything_and_an_unreadable_greeting_is_skipped() -> None:
    runtime, ctx = world(lines=[], greeting={"en": "Greeting from training."})
    assert resolve.resolve(runtime, ctx, "en", line="Typed on the screen for {business}.").source == "draft"
    runtime, ctx = world(lines=[line("Old workspace line, the one before the move.")], greeting={"en": "x"}, readable=False)
    assert resolve.resolve(runtime, ctx, "en").text.startswith("Old workspace line")   # (Sales cannot read training: no error, the next line applies)


def test_the_ai_sentence_is_added_when_the_greeting_does_not_say_it() -> None:
    runtime, ctx = world(lines=[], greeting={"en": "Hello from {business}."})
    got = resolve.resolve(runtime, ctx, "en")
    assert got.says_ai is True and got.text.startswith("Hello from Synthetic Silks.")


def test_the_greeting_takes_the_four_placeholders_and_nothing_else_in_braces() -> None:
    TalkTraining.model_validate({"greeting": {"en": "Hi {customer}, {assistant} from {business}, {agent_role}."}})
    for bad in ("Hi {name}, welcome.", "Hi {customer, welcome.", "Hi } welcome."):
        with pytest.raises(ValidationError):
            TalkTraining.model_validate({"greeting": {"en": bad}})
    with pytest.raises(ValidationError):   # the old rules stay: no price, no promise
        TalkTraining.model_validate({"greeting": {"en": "Welcome, 20% off today."}})


def test_an_inbound_call_fills_every_placeholder_and_leaves_out_a_name_nobody_knows() -> None:
    said = persona.opening_line("en", business="Synthetic Silks", assistant="Asha", customer=None, inbound=True, greeting="Hello {customer}, this is {assistant} of {business}, an AI assistant.")
    assert said == "Hello, this is Asha of Synthetic Silks, an AI assistant."
    assert "{" not in said and render.says_ai(said)


def test_get_talk_training_shows_the_old_opening_line_where_no_greeting_is_saved_and_never_over_a_saved_one() -> None:
    from app.talk_training.routes import get_talk_training

    runtime, ctx = world(
        lines=[line("Old English line, welcome to {business}.", language="en"), line("పాత తెలుగు లైన్, స్వాగతం.", language="te"), line("Campaign only line of ten.", CAMPAIGN, language="hi"),
               line("Too pricey: 20% off today for everyone.", language="kn"), line("Bad {braces line here.", language="ta")],
        greeting={"te": "Saved Telugu greeting"},
    )
    runtime.packs = None
    out = get_talk_training(ctx, runtime)
    assert out.training.greeting == {"en": "Old English line, welcome to {business}.", "te": "Saved Telugu greeting"}
    assert out.saved is True
