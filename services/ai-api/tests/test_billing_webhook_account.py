"""The script that makes the billing webhook's own account: what it refuses, the one SQL statement it builds, and that no password can reach a screen, a file or an argument list."""

# ruff: noqa: E501

from __future__ import annotations

import argparse
import importlib.util
import re
import sys
from pathlib import Path
from typing import Any

import pytest

SCRIPTS = Path(__file__).resolve().parents[3] / "scripts"


def load() -> Any:
    spec = importlib.util.spec_from_file_location("billing_webhook_account_under_test", SCRIPTS / "billing_webhook_account.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_it_refuses_without_the_flag_and_for_any_other_project() -> None:
    m = load()
    for bad in (argparse.Namespace(i_know_this_changes_staging=False, project_ref="uiallwgywitryxatcqxf"), argparse.Namespace(i_know_this_changes_staging=True, project_ref="someotherprojectref0")):
        with pytest.raises(m.AccountError):
            m.guard(bad)


def test_the_password_is_random_long_and_meets_the_auth_rule() -> None:
    m = load()
    seen = {m.new_password() for _ in range(50)}
    assert len(seen) == 50 and all(len(p) >= 40 and re.search(r"[a-z]", p) and re.search(r"[A-Z]", p) and re.search(r"\d", p) for p in seen)


def test_the_sql_is_one_statement_for_a_checked_address_only() -> None:
    m = load()
    assert m.register_sql() == "select app.operator_register_billing_webhook('billing-webhook@system.example.test')"
    for bad in ("x'; drop table y;--@a.test", "no-at-sign", "UPPER@system.example.test"):
        with pytest.raises(m.AccountError):
            m.register_sql(bad)


def test_a_password_can_reach_neither_a_screen_nor_a_file_nor_an_argument_list() -> None:
    text = (SCRIPTS / "billing_webhook_account.py").read_text()
    lines = text.splitlines()
    assert not [ln for ln in lines if "print(" in ln and "password" in ln.lower() and "never" not in ln.lower() and "rotated" not in ln.lower() and "unchanged" not in ln.lower() and "is in secret manager" not in ln.lower()]
    assert not re.search(r"(?<![A-Za-z_.])open\(|write_text|os\.environ|getenv|tempfile", text)   # no file, no environment variable
    # the value goes in through stdin, never in the list of arguments
    assert text.count("stdin=value") == 2 and not re.search(r'"--data=|--data-file=[^-]', text)
