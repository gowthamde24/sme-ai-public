"""Job DM (C1 part): the AI assistant's settings. The contract is committed, fresh and strict; the data file (defaults per business type, the fixed introduction, the sample lines) always says "AI assistant"; the routes
obey the roles and the second factor; the test call is a simulation that changes nothing. The database's own rules are proved in supabase/tests/database/116_dm_assistant_settings.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import jsonschema
import pytest

from app.assistant_settings import contracts, data, models
from app.assistant_settings.service import AssistantSettingsService
from tests.dm_assistant_fakes import FakeAssistantSettingsRepository
from tests.fakes import TENANT_A, auth, make_client

CONTRACTS = Path(__file__).resolve().parents[3] / "packages" / "contracts"
SCHEMA = json.loads((CONTRACTS / "assistant_settings.schema.json").read_text())
EXAMPLES = json.loads((CONTRACTS / "assistant_settings.examples.json").read_text())
PACKS = Path(__file__).resolve().parents[3] / "packages" / "packs"
A = TENANT_A.id
B = f"/v1/tenants/{A}/ai-assistant"
LANGS = ("en", "te", "hi", "kn", "ta", "ml")
STYLES = ("warm", "respectful", "quick")


# ------------------------------------------------------------------------------------------------ the contract
def test_the_schema_and_the_typescript_are_up_to_date() -> None:
    assert (CONTRACTS / "assistant_settings.schema.json").read_text() == contracts.schema_text(), "run `make contracts`"
    assert (CONTRACTS / "assistant_settings.ts").read_text() == contracts.ts_text(), "run `make contracts`"


def test_every_shape_forbids_unknown_properties() -> None:
    for name, node in SCHEMA["$defs"].items():
        if "properties" in node:
            assert node.get("additionalProperties") is False, name


def test_no_shape_refers_to_a_student_or_a_child() -> None:
    names = {p.lower() for node in SCHEMA["$defs"].values() for p in node.get("properties", {})} | {n.lower() for n in SCHEMA["$defs"]}
    assert not [n for n in names if any(w in n for w in ("student", "child", "pupil", "ward", "marks", "grade"))]


@pytest.mark.parametrize(
    ("example", "model"),
    [
        ("assistant_defaults_textiles", models.AssistantOut),
        ("assistant_saved_construction", models.AssistantOut),
        ("assistant_defaults_education", models.AssistantOut),
        ("preview_telugu_warm", models.PreviewOut),
        ("preview_unsaved_name", models.PreviewOut),
        ("test_call_simulated", models.TestCallOut),
        ("settings_save_request", models.AssistantSettings),
    ],
)
def test_the_example_payloads_match_the_models_and_the_schema(example: str, model: type) -> None:
    payload = EXAMPLES[example]
    model.model_validate(payload)  # type: ignore[attr-defined]
    validator = jsonschema.Draft202012Validator({**SCHEMA, "$ref": f"#/$defs/{model.__name__}"})
    assert list(validator.iter_errors(payload)) == []


# ------------------------------------------------------------------------------------------------ the data file
def test_there_are_defaults_for_every_business_type_and_they_are_valid_settings() -> None:
    d = data.load()
    packs = {p.name for p in PACKS.iterdir() if p.is_dir()}
    assert set(d["defaults"]) == packs, "one set of defaults for each pack (business type)"
    for values in d["defaults"].values():
        models.AssistantSettings.model_validate(values)
        assert values["max_discount_percent"] >= 0
    assert d["defaults"]["education"]["max_discount_percent"] == 0 and d["defaults"]["education"]["may_answer_prices"] is False, "a school has no catalogue to quote and gives no discount"


def test_every_introduction_and_every_sample_states_ai_assistant() -> None:
    d = data.load()
    for lang in LANGS:
        line = d["intro"][lang]
        assert "AI" in line and data.ASSISTANT_WORD[lang] in line and "{name}" in line and "{business}" in line, (lang, line)
    for biz in d["samples"]:
        for lang in LANGS:
            for style in STYLES:
                text = d["samples"][biz][lang][style]
                assert "AI" in text and data.ASSISTANT_WORD[lang] in text, (biz, lang, style, text)
                assert "{name}" in text and "{business}" in text, "the shop's name and the assistant's name fill the line"
                assert not re.findall(r"\{(?!name\}|business\})", text), "no other placeholder"


def test_the_samples_cover_every_language_style_and_business_type() -> None:
    d = data.load()
    # job DR: the nine leads-and-calls types share the "leads" lines; every other type has its own
    assert set(d["samples"]) | {"real_estate", "coaching", "clinic", "insurance_loans", "auto_dealer", "interiors_solar", "travel", "gym", "wholesale_b2b", "general_business"} == set(d["defaults"]) | {"leads"}
    assert "leads" in d["samples"] and all(data.sample(biz, "en", "warm", "Asha", "Shop") for biz in d["defaults"])
    for biz in d["samples"]:
        assert set(d["samples"][biz]) == set(LANGS)
        for lang in LANGS:
            assert set(d["samples"][biz][lang]) == set(STYLES)
    assert [p["id"] for p in d["personas"]] == ["female_warm", "female_clear", "male_calm", "male_lively", "own_voice"]
    assert [s["id"] for s in d["styles"]] == list(STYLES)


def test_no_sample_or_intro_names_a_child() -> None:
    text = json.dumps(data.load(), ensure_ascii=False).lower()
    for word in ("your son", "your daughter", "your child", "marks", "grade card", "report card"):
        assert word not in text


def test_a_name_with_braces_stays_text_when_the_line_is_filled() -> None:
    line = data.sample("textiles", "en", "warm", "{business}", "Shop {name}")
    assert "{" in line and line.count("Shop {name}") >= 1


# ------------------------------------------------------------------------------------------------ the routes
def world(**kw: Any) -> tuple[Any, FakeAssistantSettingsRepository]:
    repo = FakeAssistantSettingsRepository(**kw)
    client, _ = make_client(assistant_settings=AssistantSettingsService(repo))
    return client, repo


def settings(**over: Any) -> dict[str, Any]:
    return {**EXAMPLES["settings_save_request"], **over}


def test_who_may_read_and_who_may_save() -> None:
    for user, may_read, may_save in (("a_owner", True, True), ("a_admin", True, False), ("a_sales", False, False), ("a_viewer", False, False)):
        client, _ = world()
        assert (client.get(B, headers=auth(user)).status_code == 200) is may_read, user
        saved = client.put(B, json=settings(), headers=auth(user))
        assert (saved.status_code == 200) is may_save, (user, saved.status_code)
        assert (client.get(f"{B}/preview", params={"language": "te", "style": "warm"}, headers=auth(user)).status_code == 200) is may_read, user
        assert (client.post(f"{B}/test-call", headers=auth(user)).status_code == 200) is may_save, user
    client, _ = world()
    assert client.get(B, headers=auth("b_owner")).status_code == 404, "another business"
    assert client.get(B).status_code == 401, "no token"


def test_saving_and_the_test_call_need_a_second_factor() -> None:
    client, repo = world()
    assert client.put(B, json=settings(), headers=auth("a_owner", aal="aal1")).status_code == 403
    assert client.post(f"{B}/test-call", headers=auth("a_owner", aal="aal1")).status_code == 403
    assert "save" not in repo.calls
    assert client.get(B, headers=auth("a_owner", aal="aal1")).status_code == 200, "reading needs none"


def test_before_the_first_save_the_defaults_of_the_business_type_are_shown() -> None:
    client, repo = world(business_type="construction_materials", business_name="Sri Ram Pavers")
    out = client.get(B, headers=auth("a_owner")).json()
    assert out["saved"] is False and out["business_type"] == "construction_materials" and out["settings"] == out["defaults"]
    assert out["settings"]["name"] == "Aruna" and out["settings"]["voice_persona"] == "female_clear"
    assert out["intro"]["en"] == "Aruna, the AI assistant of Sri Ram Pavers"
    assert out["wording"] == "draft" and out["updated_at"] is None
    assert repo.row is None, "reading made nothing"


def test_no_default_is_a_male_voice_and_the_catalogue_default_of_every_call_language_is_female() -> None:
    """Owner, 28 Oct: nothing the API pre-fills may be a male voice (the old 'Male · calm' default); the voice that speaks until the owner picks one is the catalogue's default per language (Janvi, Ramya, Sanya, Disha)."""
    from app.conversation.voices import load_config

    for code, defaults in data.load()["defaults"].items():
        assert defaults["voice_persona"].startswith("female_"), code
    cfg = load_config()
    for language in ("en", "te", "hi", "kn"):
        assert cfg.default_for(language).gender == "female", language


def test_the_name_used_when_nothing_says_one_comes_from_the_data_not_from_code() -> None:
    assert data.default_name() == data.defaults_for(None)["name"]
    for path in ("voicesample/service.py", "browser_voice/routes.py", "opening/routes.py"):
        assert '"Vijaya"' not in (Path(models.__file__).resolve().parents[1] / path).read_text(encoding="utf-8"), path


def test_an_unknown_business_type_falls_back_to_the_first_pack() -> None:
    client, _ = world(business_type="space_travel")
    assert client.get(B, headers=auth("a_owner")).json()["business_type"] == "textiles"


def test_a_save_is_read_back_and_defaults_stay_available_for_reset() -> None:
    client, repo = world()
    out = client.put(B, json=settings(name="Priya", speed=1.1, max_discount_percent=7), headers=auth("a_owner")).json()
    assert out["saved"] is True and out["settings"]["name"] == "Priya" and out["settings"]["speed"] == 1.1 and out["defaults"]["name"] == "Vani"
    assert out["intro"]["te"] == "Sri Lakshmi Silks నుంచి AI assistant Priya", "the words AI assistant are in the introduction whatever the name"
    again = client.get(B, headers=auth("a_admin")).json()
    assert again["settings"] == out["settings"] and repo.row is not None


@pytest.mark.parametrize(
    "over",
    [
        {"name": ""}, {"name": "x" * 25}, {"name": "<b>Vani</b>"}, {"name": "Vani {name}"}, {"name": "a@b"}, {"name": "a/b"}, {"name": "bad\x00name"},
        {"speed": 1.3}, {"speed": 0.7}, {"speed": 1.03},
        {"max_discount_percent": 51}, {"max_discount_percent": -1},
        {"call_days": []}, {"call_days": [8]}, {"call_days": [0, 1]}, {"call_days": [1, 1]},
        {"call_from_minute": 480}, {"call_to_minute": 1275}, {"call_from_minute": 605}, {"call_from_minute": 1020, "call_to_minute": 1020}, {"call_from_minute": 1080, "call_to_minute": 600},
        {"handover_order_above_paise": 0}, {"handover_order_above_paise": -5},
        {"voice_persona": "robot"}, {"main_language": "fr"}, {"style": "angry"},
        {"unknown_key": 1},
    ],
)
def test_a_bad_value_is_refused_and_nothing_is_saved(over: dict[str, Any]) -> None:
    client, repo = world()
    assert client.put(B, json=settings(**over), headers=auth("a_owner")).status_code == 422
    assert repo.row is None and "save" not in repo.calls


def test_every_field_is_required() -> None:
    client, repo = world()
    for key in EXAMPLES["settings_save_request"]:
        body = settings()
        del body[key]
        assert client.put(B, json=body, headers=auth("a_owner")).status_code == 422, key
    assert repo.row is None


EDUCATION_LOCKED = {"may_talk_dues": False, "may_answer_prices": False, "max_discount_percent": 0, "handover_order_above_paise": None}


def test_the_school_rule_the_assistant_never_discusses_dues_fees_or_marks_and_gives_no_discount() -> None:
    client, repo = world(business_type="education", business_name="Little Flower School")
    repo.locked = dict(EDUCATION_LOCKED)
    out = client.get(B, headers=auth("a_owner")).json()
    assert out["locked"] == EDUCATION_LOCKED
    assert all(out["settings"][k] == v for k, v in EDUCATION_LOCKED.items()), "the defaults obey it"
    for over in ({"may_talk_dues": True}, {"may_answer_prices": True}, {"max_discount_percent": 5}, {"handover_order_above_paise": 100}):
        r = client.put(B, json=settings(**{**EDUCATION_LOCKED, **over}), headers=auth("a_owner"))
        assert r.status_code == 422 and r.json()["error"]["code"] == "locked_for_business_type", over
    assert repo.row is None and "save" not in repo.calls, "nothing reached the database"
    ok = client.put(B, json=settings(**EDUCATION_LOCKED), headers=auth("a_owner"))
    assert ok.status_code == 200 and ok.json()["saved"] is True


def test_a_business_without_the_rule_has_nothing_locked() -> None:
    client, _ = world()
    assert client.get(B, headers=auth("a_owner")).json()["locked"] == {}


def test_the_education_defaults_obey_the_school_rule() -> None:
    d = data.load()["defaults"]["education"]
    assert all(d[k] == v for k, v in EDUCATION_LOCKED.items())


def test_the_order_amount_may_be_off_and_the_name_may_have_spaces_and_dots() -> None:
    client, _ = world()
    out = client.put(B, json=settings(handover_order_above_paise=None, name="Dr. Sri Devi"), headers=auth("a_owner"))
    assert out.status_code == 200 and out.json()["settings"]["handover_order_above_paise"] is None


def test_the_options_say_which_voices_exist_per_language() -> None:
    client, _ = world()
    options = client.get(B, headers=auth("a_owner")).json()["options"]
    assert [p["id"] for p in options["personas"]] == ["female_warm", "female_clear", "male_calm", "male_lively", "own_voice"]
    assert not any(v["available"] for v in next(p for p in options["personas"] if p["id"] == "own_voice")["languages"].values()), "the own voice is not available until the Owner has made one (job DP part 5)"
    first = options["personas"][0]
    assert first["languages"]["te"] == {"available": True, "synthetic": True}
    assert [s["id"] for s in options["styles"]] == list(STYLES) and [lang["id"] for lang in options["languages"]] == list(LANGS)
    assert {lang["id"]: lang["label"] for lang in options["languages"]}["te"] == "తెలుగు"


def test_the_preview_uses_the_shops_name_and_the_unsaved_name() -> None:
    client, repo = world()
    saved_before = repo.row
    r = client.get(f"{B}/preview", params={"language": "hi", "style": "respectful"}, headers=auth("a_owner")).json()
    assert "Sri Lakshmi Silks" in r["text"] and "Vani" in r["text"] and "AI" in r["text"] and r["wording"] == "draft"
    r2 = client.get(f"{B}/preview", params={"language": "en", "style": "quick", "name": "Lakshmi"}, headers=auth("a_owner")).json()
    assert "Lakshmi here" in r2["text"] and r2["name"] == "Lakshmi"
    assert repo.row is saved_before, "a preview saves nothing"
    assert client.get(f"{B}/preview", params={"language": "fr", "style": "warm"}, headers=auth("a_owner")).status_code == 422
    assert client.get(f"{B}/preview", params={"language": "en", "style": "warm", "name": "<script>"}, headers=auth("a_owner")).status_code == 422


def test_the_test_call_is_a_simulation_that_changes_nothing() -> None:
    client, repo = world()
    r = client.post(f"{B}/test-call", headers=auth("a_owner")).json()
    assert r["mode"] == "fake" and r["status"] == "simulated" and "simulation" in r["note"].lower()
    assert [t["speaker"] for t in r["transcript"]] == ["assistant", "customer", "assistant"]
    assert "AI" in r["transcript"][0]["text"], "even the simulated call opens by saying it is an AI assistant"
    assert r["outcome"]["outcome"] == "positive"
    assert set(repo.calls) <= {"get", "voices"}, "no save, no message, no call: only reads"


def test_without_the_service_the_routes_say_so() -> None:
    client, _ = make_client()
    r = client.get(B, headers=auth("a_owner"))
    assert r.status_code == 503 and r.json()["error"]["code"] == "assistant_settings_unavailable"
