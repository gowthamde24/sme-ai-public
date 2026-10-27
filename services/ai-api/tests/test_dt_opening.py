"""Job DT (ADR 0116): the opening line, the "mention that I'm an AI assistant" switch and the never-claim-to-be-human rule. Pure rendering, the API with a fake repository, and the honesty eval in every language."""

from __future__ import annotations

import uuid
from typing import Any

from app.assistant_settings import data as settings_data
from app.opening import honesty, render
from tests.fakes import TENANT_A, auth, make_client

BASE = f"/v1/tenants/{TENANT_A.id}/ai-assistant"


# ------------------------------------------------------------------------------------------------ rendering
def test_the_owner_line_is_filled_and_the_switch_decides_whether_the_ai_words_are_added() -> None:
    line = "Hi {customer}, {assistant} here from {business}. Got a minute?"
    on = render.compose_opening("en", owner_line=line, mention_ai=True, assistant="Vijaya", business="Sri Sai Homes", customer="Ravi")
    off = render.compose_opening("en", owner_line=line, mention_ai=False, assistant="Vijaya", business="Sri Sai Homes", customer="Ravi")
    assert off == "Hi Ravi, Vijaya here from Sri Sai Homes. Got a minute?", "OFF: exactly the owner's text"
    assert on == off + " I'm an AI assistant." and render.says_ai(on) and not render.says_ai(off)
    already = render.compose_opening("en", owner_line="Hello {customer}, I'm {assistant}, the AI assistant of {business}.", mention_ai=True, assistant="Vijaya", business="X Ltd", customer="Ravi")
    assert already.count("AI assistant") == 1, "a line that already says it is not told twice"


def test_a_placeholder_without_a_value_is_dropped_never_spoken_as_a_brace() -> None:
    out = render.compose_opening("en", owner_line="Hello {customer}, this is {assistant} from {business}, your {agent_role}.", mention_ai=False, assistant="Vijaya", business="Lakshmi Sarees")
    assert "{" not in out and "  " not in out and " ," not in out and out.startswith("Hello, this is Vijaya from Lakshmi Sarees")


def test_the_defaults_in_every_language_with_and_without_the_disclosure() -> None:
    for lang in render.LANGUAGES:
        plain = render.compose_opening(lang, owner_line=None, mention_ai=False, assistant="Vijaya", business="Sri Sai Homes", customer="Ravi")
        said = render.compose_opening(lang, owner_line=None, mention_ai=True, assistant="Vijaya", business="Sri Sai Homes", customer="Ravi")
        assert "Sri Sai Homes" in plain and "Vijaya" in plain and "{" not in plain and not render.says_ai(plain), lang
        assert render.says_ai(said) and "Sri Sai Homes" in said, lang


def test_validity_and_picking_the_line_and_the_switch_for_a_campaign() -> None:
    assert render.valid_line("Hello {customer}, {assistant} here.") and not render.valid_line("Hello {name}, welcome") and not render.valid_line("short")
    camp = str(uuid.uuid4())
    lines: list[dict[str, Any]] = [{"language": "en", "campaign_id": None, "text": "WORKSPACE line one"}, {"language": "en", "campaign_id": camp, "text": "CAMPAIGN line one"}]
    assert render.pick_line(lines, "en", None) == "WORKSPACE line one" and render.pick_line(lines, "en", camp) == "CAMPAIGN line one"
    assert render.pick_line(lines, "en", str(uuid.uuid4())) == "WORKSPACE line one" and render.pick_line(lines, "te", None) is None
    assert render.pick_mention(True, [{"campaign_id": camp, "mention_ai": False}], camp) is False and render.pick_mention(True, [], camp) is True


# ------------------------------------------------------------------------------------------------ honesty
def test_the_honesty_eval_every_language_asks_and_the_statements_do_not_trigger() -> None:
    data = honesty.eval_set()
    assert set(data["ask"]) == set(render.LANGUAGES)
    for lang, phrases in data["ask"].items():
        assert len(phrases) >= 4, lang
        for phrase in phrases:
            assert honesty.is_identity_question(phrase), (lang, phrase)
    for lang, phrases in data["not_ask"].items():
        for phrase in phrases:
            assert not honesty.is_identity_question(phrase), (lang, phrase)


def test_the_honest_answer_comes_first_says_ai_and_never_claims_to_be_human() -> None:
    for lang in render.LANGUAGES:
        answer = honesty.honest_answer(lang, "Vidya Coaching")
        assert "AI assistant" in answer and "Vidya Coaching" in answer and "{" not in answer, lang
    for lang, phrases in honesty.eval_set()["ask"].items():
        spoken = honesty.guard_reply(phrases[0], "Which class is it for?", lang, "Vidya Coaching")
        assert spoken.startswith(honesty.honest_answer(lang, "Vidya Coaching")) and spoken.endswith("Which class is it for?"), lang
    assert honesty.guard_reply("What are the fees?", "Class 10 is five thousand.", "en", "X") == "Class 10 is five thousand."
    assert honesty.claims_to_be_human("No, I'm a real person.") and honesty.claims_to_be_human("I am not a robot") and not honesty.claims_to_be_human("Yes, I'm an AI assistant.")
    assert not honesty.claims_to_be_human(honesty.honest_answer("en", "X"))
    assert "Never deny being an AI" in honesty.HONESTY_RULE


# ------------------------------------------------------------------------------------------------ the API
class FakeOpening:
    def __init__(self) -> None:
        self.row: dict[str, Any] = {"mention_ai": True, "lines": [], "campaign_overrides": []}
        self.calls: list[tuple[str, Any]] = []

    def opening(self, token: str, tenant_id: uuid.UUID) -> dict[str, Any]:
        return {k: list(v) if isinstance(v, list) else v for k, v in self.row.items()}

    def set_opening_line(self, token: str, tenant_id: uuid.UUID, language: str, campaign_id: str | None, text: str | None) -> dict[str, Any]:
        self.calls.append(("line", (language, campaign_id, text)))
        self.row["lines"] = [x for x in self.row["lines"] if not (x["language"] == language and x["campaign_id"] == campaign_id)]
        if text:
            self.row["lines"].append({"language": language, "campaign_id": campaign_id, "text": text})
        return self.opening(token, tenant_id)

    def set_mention_ai(self, token: str, tenant_id: uuid.UUID, campaign_id: str | None, mention_ai: bool | None) -> dict[str, Any]:
        self.calls.append(("mention", (campaign_id, mention_ai)))
        if campaign_id is None:
            self.row["mention_ai"] = bool(mention_ai)
        else:
            self.row["campaign_overrides"] = [x for x in self.row["campaign_overrides"] if x["campaign_id"] != campaign_id]
            if mention_ai is not None:
                self.row["campaign_overrides"].append({"campaign_id": campaign_id, "mention_ai": mention_ai})
        return self.opening(token, tenant_id)


def world() -> tuple[Any, FakeOpening]:
    repo = FakeOpening()
    client, _ = make_client(workspace=repo)
    return client, repo


def test_any_member_reads_the_defaults_and_only_the_owner_edits() -> None:
    client, repo = world()
    r = client.get(f"{BASE}/opening-line", headers=auth("a_viewer"))
    body = r.json()
    assert r.status_code == 200 and body["mention_ai"] is True and body["placeholders"] == ["customer", "assistant", "business", "agent_role"]
    assert set(body["defaults"]) == set(render.LANGUAGES) and "answer honestly" in body["disclosure_notice"] and "advisor" in body["disclosure_notice"]
    put = {"language": "te", "text": "నమస్కారం {customer} గారు, నేను {assistant}, {business} నుంచి."}
    for user in ("a_admin", "a_sales", "a_viewer"):
        assert client.put(f"{BASE}/opening-line", json=put, headers=auth(user)).status_code == 403, user
        assert client.put(f"{BASE}/mention-ai", json={"mention_ai": False}, headers=auth(user)).status_code == 403, user
    assert client.put(f"{BASE}/opening-line", json=put, headers=auth("a_owner")).status_code == 200 and repo.calls[-1][0] == "line"
    assert client.get(f"{BASE}/opening-line", headers=auth("b_owner")).status_code == 404


def test_a_bad_line_is_a_422_and_a_reset_removes_it() -> None:
    client, repo = world()
    h = auth("a_owner")
    for body in ({"language": "en", "text": "Hello {name}, welcome"}, {"language": "en", "text": "short"}, {"language": "xx", "text": "Hello {customer}, welcome."}, {"language": "en"}):
        assert client.put(f"{BASE}/opening-line", json=body, headers=h).status_code == 422, body
    assert not repo.calls
    client.put(f"{BASE}/opening-line", json={"language": "en", "text": "Hello {customer}, {assistant} here."}, headers=h)
    r = client.put(f"{BASE}/opening-line", json={"language": "en", "text": None}, headers=h)
    assert r.status_code == 200 and r.json()["lines"] == []


def test_the_preview_is_the_greeting_a_customer_hears_with_the_live_business_name() -> None:
    client, repo = world()
    h = auth("a_owner")
    q = f"{BASE}/opening-line/preview?language=en&customer=Ravi"
    first = client.get(q, headers=h).json()
    assert first["says_ai"] is True and first["mention_ai"] is True and TENANT_A.name in first["text"]
    client.put(f"{BASE}/opening-line", json={"language": "en", "text": "Hi {customer}, {assistant} from {business} here."}, headers=h)
    client.put(f"{BASE}/mention-ai", json={"mention_ai": False}, headers=h)
    off = client.get(q, headers=auth("a_sales")).json()
    name = settings_data.defaults_for(None)["name"]
    assert off["text"] == f"Hi Ravi, {name} from {TENANT_A.name} here." and off["says_ai"] is False and off["mention_ai"] is False
    camp = str(uuid.uuid4())
    assert client.put(f"{BASE}/mention-ai", json={"mention_ai": True, "campaign_id": camp}, headers=h).status_code == 200
    on = client.get(q + f"&campaign_id={camp}", headers=h).json()
    assert on["says_ai"] is True and on["text"].startswith(f"Hi Ravi, {name}") and on["text"].endswith("I'm an AI assistant.")
    assert client.put(f"{BASE}/mention-ai", json={"mention_ai": None}, headers=h).status_code == 422 and repo.row["mention_ai"] is False


def test_the_call_prompt_always_carries_the_honesty_rule_and_the_voice_preview_speaks_the_owner_line() -> None:
    from app.opening.prompt import call_system_prompt

    for opening in ("Hello {x}", "Hi, this is Vijaya from Sri Sai Homes."):
        prompt = call_system_prompt(business="Sri Sai Homes", assistant="Vijaya", language="te", opening_line=opening, goal="book a site visit", facts=["Open 10 to 7."], caller_memory="Asked about 3 BHK last week.")
        assert honesty.HONESTY_RULE in prompt and "Open 10 to 7." in prompt and "Asked about 3 BHK" in prompt
    from app.voicesample import service as vs

    assert vs.preview_text("en", "warm", "Vijaya", "X Ltd", "Hi Ravi, Vijaya from X Ltd here.").startswith("Hi Ravi, Vijaya from X Ltd here. " + vs.REPLIES["en"][:5])
