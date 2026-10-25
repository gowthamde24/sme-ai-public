"""Job DP part 4: call settings as data. The contract is committed, fresh and strict; the data file holds sensible defaults per business type and a school never gets sales or dues calls; the routes obey the roles
and the second factor; a campaign overrides only what it names; the effective settings are the workspace's with the override on top and the hours resolved. The database's own rules are proved in
supabase/tests/database/121_dp_call_settings.test.sql."""

# ruff: noqa: E501

from __future__ import annotations

import copy
import json
import uuid
from pathlib import Path
from typing import Any

import jsonschema
import pytest

from app.assistant_settings import data as assistant_data
from app.callsettings import contracts, data, models
from app.callsettings.service import CallSettingsService, resolve
from tests.dp_call_fakes import FakeCallSettingsRepository
from tests.fakes import TENANT_A, auth, make_client

CONTRACTS = Path(__file__).resolve().parents[3] / "packages" / "contracts"
SCHEMA = json.loads((CONTRACTS / "call_settings.schema.json").read_text())
EXAMPLES = json.loads((CONTRACTS / "call_settings.examples.json").read_text())
PACKS = Path(__file__).resolve().parents[3] / "packages" / "packs"
A = TENANT_A.id
B = f"/v1/tenants/{A}/call-settings"
CAMPAIGN = uuid.UUID(int=0xCA)
HOURS = {"days": [1, 2, 3, 4, 5, 6], "from_minute": 540, "to_minute": 1140}


def good(**changes: Any) -> dict[str, Any]:
    return {**data.defaults_for("textiles"), **changes}


def world(**kw: Any) -> tuple[Any, FakeCallSettingsRepository]:
    repo = FakeCallSettingsRepository(campaigns={CAMPAIGN}, **kw)
    client, _ = make_client(call_settings=CallSettingsService(repo))
    return client, repo


# ------------------------------------------------------------------------------------------------ the contract
def test_the_schema_and_the_typescript_are_up_to_date() -> None:
    assert (CONTRACTS / "call_settings.schema.json").read_text() == contracts.schema_text(), "run `make contracts`"
    assert (CONTRACTS / "call_settings.ts").read_text() == contracts.ts_text(), "run `make contracts`"


def test_every_shape_forbids_unknown_properties_and_names_no_child() -> None:
    for name, node in SCHEMA["$defs"].items():
        if "properties" in node:
            assert node.get("additionalProperties") is False, name
    names = {p.lower() for node in SCHEMA["$defs"].values() for p in node.get("properties", {})} | {n.lower() for n in SCHEMA["$defs"]}
    assert not [n for n in names if any(w in n for w in ("student", "child", "pupil", "ward", "marks"))]


@pytest.mark.parametrize(
    ("example", "model"),
    [
        ("settings_defaults_textiles", models.CallSettingsOut),
        ("settings_saved_textiles", models.CallSettingsOut),
        ("settings_defaults_school", models.CallSettingsOut),
        ("campaign_with_override", models.CampaignCallSettingsOut),
        ("campaign_inherits_everything", models.CampaignCallSettingsOut),
        ("save_request", models.CallSettings),
        ("override_request", models.CallSettingsOverride),
    ],
)
def test_the_example_payloads_match_the_models_and_the_schema(example: str, model: type) -> None:
    payload = EXAMPLES[example]
    model.model_validate(payload)  # type: ignore[attr-defined]
    jsonschema.validate(payload, {**SCHEMA, "$ref": f"#/$defs/{model.__name__}"})


# ------------------------------------------------------------------------------------------------ the data file
def test_every_pack_has_defaults_that_fit_the_models() -> None:
    packs = {p.name for p in PACKS.iterdir() if p.is_dir()}
    assert packs, "packs found"
    assert set(data.load()["defaults"]) >= packs, "a default for every pack"
    for code in data.load()["defaults"]:
        models.CallSettings.model_validate(data.defaults_for(code))


def test_an_unknown_business_type_gets_the_first_defaults() -> None:
    assert data.business_type("no_such_pack") == next(iter(data.load()["defaults"]))
    assert data.business_type(None) == data.business_type("no_such_pack")


def test_a_school_never_gets_sales_or_dues_calls_by_default_and_remembers_nothing() -> None:
    school = data.defaults_for("education")
    assert set(school["allowed_purposes"]) <= {"admission_followup", "visit_reminder", "event_reminder"}
    assert "sales_followup" not in school["allowed_purposes"] and "payment_reminder" not in school["allowed_purposes"]
    assert school["contact_memory"] is False
    assert data.locked_for("education") == {"allowed_purposes": ["admission_followup", "visit_reminder", "event_reminder"]}
    assert data.locked_for("textiles") == {}


def test_the_option_ids_are_exactly_the_closed_words_of_the_models() -> None:
    o = data.load()["options"]
    assert {i["id"] for i in o["voicemail_actions"]} == {"hang_up", "leave_message", "retry_later"}
    assert {i["id"] for i in o["phone_menu_actions"]} == {"hang_up", "retry_later"}
    assert {i["id"] for i in o["sensitivities"]} == {"low", "medium", "high"}
    assert {i["id"] for i in o["topics"]} == {"pricing", "payment", "delivery", "complaint", "visit", "other"}
    assert {i["id"] for i in o["purposes"]} == {"sales_followup", "payment_reminder", "admission_followup", "visit_reminder", "event_reminder"}


def test_the_assistant_word_data_has_the_default_hours_the_effective_settings_fall_back_to() -> None:
    for code in data.load()["defaults"]:
        d = assistant_data.defaults_for(code)
        models.CallHours(days=d["call_days"], from_minute=d["call_from_minute"], to_minute=d["call_to_minute"])


# ------------------------------------------------------------------------------------------------ validation
BAD = [
    ("retry_busy", {"count": 6, "gap_minutes": 30}),
    ("retry_busy", {"count": 1, "gap_minutes": 7}),
    ("retry_busy", {"count": 1, "gap_minutes": 5, "extra": 1}),
    ("retry_no_answer", {"count": 1}),
    ("concurrent_calls", 0),
    ("concurrent_calls", 21),
    ("voicemail_action", "shout"),
    ("phone_menu_action", "leave_message"),
    ("silence_timeout_seconds", 2),
    ("silence_timeout_seconds", 31),
    ("max_call_seconds", 20),
    ("max_call_seconds", 1801),
    ("max_call_seconds", 100),
    ("interruption_sensitivity", "extreme"),
    ("max_calls_per_customer_per_week", 0),
    ("max_calls_per_customer_per_week", 15),
    ("auto_pause_refusals_per_hour", 2),
    ("auto_pause_refusals_per_hour", 101),
    ("hours", {"days": [], "from_minute": 540, "to_minute": 600}),
    ("hours", {"days": [1, 1], "from_minute": 540, "to_minute": 600}),
    ("hours", {"days": [8], "from_minute": 540, "to_minute": 600}),
    ("hours", {"days": [1], "from_minute": 600, "to_minute": 540}),
    ("hours", {"days": [1], "from_minute": 500, "to_minute": 600}),
    ("hours", {"days": [1], "from_minute": 541, "to_minute": 600}),
    ("pronunciations", [{"written": "A", "spoken": "<b>"}]),
    ("pronunciations", [{"written": "Kanchi", "spoken": "x"}, {"written": "kanchi", "spoken": "y"}]),
    ("pronunciations", [{"written": "x" * 41, "spoken": "y"}]),
    ("keywords", ["a"]),
    ("keywords", ["fine", "bad{brace}"]),
    ("keywords", ["x" * 41]),
    ("holidays", ["2026-11-09", "2026-11-09"]),
    ("handover", [{"topic": "pricing", "person_name": "A", "phone": "123"}]),
    ("handover", [{"topic": "pricing", "person_name": "A", "phone": "+919876500001"}, {"topic": "pricing", "person_name": "B", "phone": "+919876500002"}]),
    ("handover", [{"topic": "nonsense", "person_name": "A", "phone": "+919876500001"}]),
    ("handover", [{"topic": "pricing", "person_name": "A@b", "phone": "+919876500001"}]),
    ("allowed_purposes", []),
    ("allowed_purposes", ["sales_followup", "sales_followup"]),
    ("allowed_purposes", ["spam"]),
    ("detect_voicemail", "yes"),
    ("contact_memory", 1),
]


@pytest.mark.parametrize(("field", "value"), BAD)
def test_a_value_out_of_range_or_shape_is_refused_and_nothing_is_saved(field: str, value: Any) -> None:
    client, repo = world()
    r = client.put(B, json=good(**{field: value}), headers=auth("a_owner"))
    assert r.status_code == 422, (field, value, r.text)
    assert repo.settings is None and "save" not in repo.calls


def test_a_missing_field_or_an_unknown_one_is_refused() -> None:
    client, repo = world()
    body = good()
    del body["keywords"]
    assert client.put(B, json=body, headers=auth("a_owner")).status_code == 422
    assert client.put(B, json=good(surprise=1), headers=auth("a_owner")).status_code == 422
    assert repo.settings is None


def test_a_holiday_must_be_a_real_date() -> None:
    client, _ = world()
    assert client.put(B, json=good(holidays=["2026-02-30"]), headers=auth("a_owner")).status_code == 422
    assert client.put(B, json=good(holidays=["not a date"]), headers=auth("a_owner")).status_code == 422


def test_the_limits_at_their_edges_are_accepted() -> None:
    client, _ = world()
    edge = good(
        retry_busy={"count": 0, "gap_minutes": 5}, retry_no_answer={"count": 5, "gap_minutes": 1440}, concurrent_calls=20, silence_timeout_seconds=3, max_call_seconds=1800,
        max_calls_per_customer_per_week=14, auto_pause_refusals_per_hour=100, hours={"days": [1, 2, 3, 4, 5, 6, 7], "from_minute": 540, "to_minute": 1260},
        pronunciations=[{"written": f"Name {i}", "spoken": "Say"} for i in range(50)], keywords=[f"word{i:03d}" for i in range(100)],
        handover=[{"topic": t, "person_name": "Suresh", "phone": "+919876500001"} for t in ("pricing", "payment", "delivery", "complaint", "visit", "other")],
    )
    assert client.put(B, json=edge, headers=auth("a_owner")).status_code == 200
    over = good(pronunciations=[{"written": f"Name {i}", "spoken": "Say"} for i in range(51)])
    assert client.put(B, json=over, headers=auth("a_owner")).status_code == 422
    assert client.put(B, json=good(keywords=[f"word{i:03d}" for i in range(101)]), headers=auth("a_owner")).status_code == 422


# ------------------------------------------------------------------------------------------------ the routes
def test_roles_and_the_second_factor() -> None:
    client, repo = world()
    for user, may_read in (("a_owner", True), ("a_admin", True), ("a_sales", False), ("a_viewer", False), ("outsider", False)):
        assert (client.get(B, headers=auth(user)).status_code == 200) is may_read, user
    assert client.get(B, headers=auth("b_owner")).status_code == 404, "another business"
    for user in ("a_admin", "a_sales", "a_viewer"):
        assert client.put(B, json=good(), headers=auth(user)).status_code == 403, user
    assert client.put(B, json=good(), headers=auth("a_owner", aal="aal1")).status_code == 403
    assert repo.settings is None
    assert client.put(B, json=good(), headers=auth("a_owner")).status_code == 200


def test_before_the_first_save_the_defaults_are_shown_and_after_it_the_saved_settings() -> None:
    client, _ = world()
    first = client.get(B, headers=auth("a_owner")).json()
    assert first["saved"] is False and first["settings"] == first["defaults"] and first["updated_at"] is None
    assert first["business_type"] == "textiles" and first["wording"] == "draft"
    assert first["effective"]["hours"]["source"] == "assistant" and first["assistant_hours"] == first["effective"]["settings"]["hours"] or first["effective"]["hours"]["source"] == "assistant"
    saved = client.put(B, json=good(max_call_seconds=210, listening_sounds=False), headers=auth("a_owner")).json()
    assert saved["saved"] is True and saved["settings"]["max_call_seconds"] == 210 and saved["settings"]["listening_sounds"] is False
    assert saved["defaults"]["max_call_seconds"] == 300 and saved["updated_at"]
    assert client.get(B, headers=auth("a_admin")).json()["settings"]["max_call_seconds"] == 210


def test_the_options_carry_labels_for_the_closed_words() -> None:
    client, _ = world()
    o = client.get(B, headers=auth("a_owner")).json()["options"]
    assert [x["id"] for x in o["voicemail_actions"]] == ["hang_up", "leave_message", "retry_later"]
    assert all(x["label"] for k in o for x in o[k])


def test_hours_null_follows_the_ai_assistant_and_a_set_hours_wins() -> None:
    client, _ = world(assistant_hours={"days": [1, 2, 3], "from_minute": 600, "to_minute": 900})
    out = client.get(B, headers=auth("a_owner")).json()
    assert out["assistant_hours"] == {"days": [1, 2, 3], "from_minute": 600, "to_minute": 900}
    assert out["effective"]["hours"] == {"days": [1, 2, 3], "from_minute": 600, "to_minute": 900, "source": "assistant"}
    saved = client.put(B, json=good(hours=HOURS), headers=auth("a_owner")).json()
    assert saved["effective"]["hours"]["source"] == "workspace" and saved["effective"]["hours"]["from_minute"] == 540


def test_the_school_rule_a_school_cannot_switch_on_sales_or_dues_calls() -> None:
    client, repo = world(business_type="education")
    out = client.get(B, headers=auth("a_owner")).json()
    assert out["locked"] == {"allowed_purposes": ["admission_followup", "visit_reminder", "event_reminder"]} and out["business_type"] == "education"
    assert out["settings"]["contact_memory"] is False
    for bad in (["sales_followup"], ["payment_reminder"], ["admission_followup", "payment_reminder"]):
        r = client.put(B, json=good(allowed_purposes=bad), headers=auth("a_owner"))
        assert r.status_code == 422 and r.json()["error"]["code"] == "locked_for_business_type", bad
    assert repo.settings is None
    ok = client.put(B, json=good(allowed_purposes=["admission_followup", "event_reminder"]), headers=auth("a_owner"))
    assert ok.status_code == 200
    # a textile shop is not stopped by the school rule
    shop, _ = world()
    assert shop.put(B, json=good(allowed_purposes=["sales_followup", "payment_reminder"]), headers=auth("a_owner")).status_code == 200


# ------------------------------------------------------------------------------------------------ one campaign
def test_a_campaign_overrides_only_what_it_names() -> None:
    client, repo = world()
    client.put(B, json=good(hours=HOURS), headers=auth("a_owner"))
    before = client.get(f"{B}/campaigns/{CAMPAIGN}", headers=auth("a_admin")).json()
    assert before["saved"] is False and before["effective"]["overridden"] == []
    r = client.put(f"{B}/campaigns/{CAMPAIGN}", json={"max_call_seconds": 120, "retry_no_answer": {"count": 1, "gap_minutes": 240}, "hours": {"days": [1, 2], "from_minute": 660, "to_minute": 960}}, headers=auth("a_owner"))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["saved"] is True and out["overrides"]["max_call_seconds"] == 120 and out["overrides"]["listening_sounds"] is None
    eff = out["effective"]
    assert eff["settings"]["max_call_seconds"] == 120 and eff["settings"]["retry_no_answer"] == {"count": 1, "gap_minutes": 240}
    assert eff["settings"]["listening_sounds"] is True, "inherited"
    assert eff["overridden"] == ["hours", "max_call_seconds", "retry_no_answer"]
    assert eff["hours"] == {"days": [1, 2], "from_minute": 660, "to_minute": 960, "source": "campaign"}
    assert repo.overrides[CAMPAIGN] == {"max_call_seconds": 120, "retry_no_answer": {"count": 1, "gap_minutes": 240}, "hours": {"days": [1, 2], "from_minute": 660, "to_minute": 960}}
    # the workspace's own setting is untouched
    assert client.get(B, headers=auth("a_owner")).json()["settings"]["max_call_seconds"] == 300


def test_the_things_that_belong_to_the_business_cannot_be_overridden_per_campaign() -> None:
    client, repo = world()
    bodies: list[dict[str, Any]] = [{"holidays": ["2026-11-09"]}, {"handover": []}, {"allowed_purposes": ["sales_followup"]}, {"surprise": 1}]
    for body in bodies:
        assert client.put(f"{B}/campaigns/{CAMPAIGN}", json=body, headers=auth("a_owner")).status_code == 422, body
    assert repo.overrides == {}


def test_a_campaign_override_is_validated_like_the_workspace() -> None:
    client, _ = world()
    for body in ({"max_call_seconds": 100}, {"concurrent_calls": 99}, {"voicemail_action": "x"}, {"hours": {"days": [1], "from_minute": 900, "to_minute": 600}}, {"keywords": ["a"]}, {"retry_busy": {"count": 9, "gap_minutes": 5}}):
        assert client.put(f"{B}/campaigns/{CAMPAIGN}", json=body, headers=auth("a_owner")).status_code == 422, body


def test_a_campaign_list_replaces_the_workspaces_list_and_auto_pause_can_be_switched_off_for_it() -> None:
    client, _ = world()
    client.put(B, json=good(keywords=["Kanchipuram"], pronunciations=[{"written": "Kanchi", "spoken": "Kanchee"}]), headers=auth("a_owner"))
    out = client.put(f"{B}/campaigns/{CAMPAIGN}", json={"keywords": [], "auto_pause_off": True}, headers=auth("a_owner")).json()
    assert out["effective"]["settings"]["keywords"] == [] and out["effective"]["settings"]["pronunciations"] == [{"written": "Kanchi", "spoken": "Kanchee"}]
    assert out["effective"]["settings"]["auto_pause_refusals_per_hour"] is None
    assert out["effective"]["overridden"] == ["auto_pause_refusals_per_hour", "keywords"]


def test_an_empty_override_removes_it_and_clear_removes_it() -> None:
    client, repo = world()
    client.put(f"{B}/campaigns/{CAMPAIGN}", json={"max_call_seconds": 120}, headers=auth("a_owner"))
    assert CAMPAIGN in repo.overrides
    out = client.put(f"{B}/campaigns/{CAMPAIGN}", json={}, headers=auth("a_owner")).json()
    assert out["saved"] is False and CAMPAIGN not in repo.overrides
    client.put(f"{B}/campaigns/{CAMPAIGN}", json={"max_call_seconds": 120}, headers=auth("a_owner"))
    gone = client.post(f"{B}/campaigns/{CAMPAIGN}/clear", headers=auth("a_owner"))
    assert gone.status_code == 200 and gone.json()["saved"] is False and CAMPAIGN not in repo.overrides


def test_campaign_roles_and_unknown_campaigns() -> None:
    client, repo = world()
    url = f"{B}/campaigns/{CAMPAIGN}"
    assert client.get(url, headers=auth("a_admin")).status_code == 200
    for user in ("a_sales", "a_viewer"):
        assert client.get(url, headers=auth(user)).status_code == 403, user
    for headers in (auth("a_admin"), auth("a_owner", aal="aal1")):
        assert client.put(url, json={}, headers=headers).status_code == 403
        assert client.post(f"{url}/clear", headers=headers).status_code == 403
    assert client.get(f"{B}/campaigns/{uuid.uuid4()}", headers=auth("a_owner")).status_code == 404, "a campaign that is not this workspace's"
    assert client.get(f"{B}/campaigns/not-an-id", headers=auth("a_owner")).status_code == 404
    assert client.put(f"{B}/campaigns/{uuid.uuid4()}", json={"max_call_seconds": 60}, headers=auth("a_owner")).status_code == 404
    assert repo.overrides == {}


# ------------------------------------------------------------------------------------------------ the pure merge
def test_resolve_is_pure_and_changes_nothing_it_is_given() -> None:
    base = models.CallSettings.model_validate(good(hours=HOURS))
    override = models.CallSettingsOverride(max_call_seconds=60, keywords=["x1"])
    snapshot = (copy.deepcopy(base), copy.deepcopy(override))
    one = resolve(base, override, models.CallHours.model_validate(HOURS))
    two = resolve(base, override, models.CallHours.model_validate(HOURS))
    assert one == two and (base, override) == snapshot
    assert one.settings.max_call_seconds == 60 and one.settings.keywords == ["x1"] and one.overridden == ["keywords", "max_call_seconds"]
    assert resolve(base, None, models.CallHours.model_validate(HOURS)).overridden == []


def test_the_effective_hours_are_sorted_and_name_their_source() -> None:
    base = models.CallSettings.model_validate(good())
    assistant = models.CallHours(days=[3, 1, 2], from_minute=600, to_minute=900)
    eff = resolve(base, None, assistant)
    assert eff.hours.days == [1, 2, 3] and eff.hours.source == "assistant"
    own = models.CallSettings.model_validate(good(hours=HOURS))
    assert resolve(own, None, assistant).hours.source == "workspace"
    camp = models.CallSettingsOverride(hours=models.CallHours(days=[7], from_minute=600, to_minute=660))
    assert resolve(own, camp, assistant).hours.source == "campaign"


def test_no_module_of_the_model_side_imports_the_call_settings() -> None:
    import ast

    app = Path(__file__).resolve().parents[1] / "app"
    offenders = []
    for folder in ("agents", "agent_runs", "assistant", "voice_notes", "followups", "outbox", "whatsapp", "campaigns"):
        for path in (app / folder).rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("app.callsettings"):
                    offenders.append(str(path.relative_to(app)))
    assert offenders == [], "the settings are data for a dialer, read through the service, not imported by the model side"
