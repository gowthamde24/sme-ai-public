"""Job DI: the plans and billing contract (packages/contracts/billing.*) is committed, fresh, strict, and shows an owner nothing about AI money."""

from __future__ import annotations

import json
from pathlib import Path

import jsonschema
import pytest

from app.billing import contracts, models

CONTRACTS = Path(__file__).resolve().parents[3] / "packages" / "contracts"
SCHEMA = json.loads((CONTRACTS / "billing.schema.json").read_text())
EXAMPLES = json.loads((CONTRACTS / "billing.examples.json").read_text())


def test_the_schema_and_the_typescript_are_up_to_date() -> None:
    assert (CONTRACTS / "billing.schema.json").read_text() == contracts.schema_text(), "run `make contracts`"
    assert (CONTRACTS / "billing.ts").read_text() == contracts.ts_text(), "run `make contracts`"


def test_every_shape_forbids_unknown_properties() -> None:
    for name, node in SCHEMA["$defs"].items():
        if "properties" in node:
            assert node.get("additionalProperties") is False, name


FORBIDDEN_WORDS = ("token", "micro", "rupee", "cost", "spend", "ledger", "anthropic", "model", "ai_")


def test_no_shape_shows_ai_money_tokens_or_models() -> None:
    names = {prop.lower() for node in SCHEMA["$defs"].values() for prop in node.get("properties", {})}
    names |= {n.lower() for n in SCHEMA["$defs"]}
    bad = sorted(n for n in names if any(w in n for w in FORBIDDEN_WORDS))
    assert bad == []


@pytest.mark.parametrize(
    ("example", "model"),
    [
        ("plans", models.PlansOut),
        ("billing_no_subscription_ok", models.BillingOut),
        ("billing_trialing_notice_at_80", models.BillingOut),
        ("billing_trial_waiting_for_whatsapp", models.BillingOut),
        ("billing_active_messages_stopped", models.BillingOut),
        ("billing_starter_no_minutes_included", models.BillingOut),
        ("billing_pay_as_you_go", models.BillingOut),
        ("billing_payment_failed_in_grace", models.BillingOut),
        ("billing_read_only_trial_ended", models.BillingOut),
        ("access_full", models.AccessOut),
        ("access_read_only", models.AccessOut),
        ("usage_view", models.UsageViewOut),
        ("trial_start_request", models.TrialStartIn),
    ],
)
def test_the_example_payloads_match_the_models_and_the_schema(example: str, model: type) -> None:
    payload = EXAMPLES[example]
    model.model_validate(payload)  # type: ignore[attr-defined]
    validator = jsonschema.Draft202012Validator({**SCHEMA, "$ref": f"#/$defs/{model.__name__}"})
    assert list(validator.iter_errors(payload)) == []


def test_the_example_plans_are_the_catalogue() -> None:
    cat = json.loads((CONTRACTS.parent / "plans" / "plans.json").read_text())
    assert [p["id"] for p in EXAMPLES["plans"]["plans"]] == [p["id"] for p in cat["plans"]]
    assert all(p["price_paise_monthly"] is None for p in EXAMPLES["plans"]["plans"]), "prices are null until the owner sets them"
