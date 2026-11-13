"""The operator script that registers Stack19 staff: what it refuses before touching anything, and the one SQL statement it builds. The prompts, the Auth calls and the database call are not run here."""

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
    spec = importlib.util.spec_from_file_location("admin_staff_register_under_test", SCRIPTS / "admin_staff_register.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def args(**over: Any) -> argparse.Namespace:
    base = {"i_know_this_creates_staff_in_staging": True, "project_ref": "uiallwgywitryxatcqxf", "api_url": "https://api.example.test", "email": "owner@example.test", "name": "Gowtham Reddy", "role": "owner"}
    return argparse.Namespace(**{**base, **over})


def test_it_refuses_without_the_flag_the_right_project_and_https() -> None:
    m = load()
    for bad in (args(i_know_this_creates_staff_in_staging=False), args(project_ref="someotherprojectref0"), args(api_url="http://api.example.test")):
        with pytest.raises(m.StaffError):
            m.guard(bad)


def test_the_inputs_are_checked_and_the_sql_is_one_quoted_statement() -> None:
    m = load()
    assert m.register_sql("owner@example.test", "Gowtham Reddy", "owner") == "select app.operator_register_staff('owner@example.test', 'Gowtham Reddy', 'owner')"
    for email, name, role in (("not-an-email", "Gowtham Reddy", "owner"), ("a@b.test'; drop table x;--", "Gowtham Reddy", "owner"), ("owner@example.test", "G'; drop table x;--", "owner"),
                              ("owner@example.test", "Gowtham Reddy", "admin"), ("owner@example.test", "x", "owner")):
        with pytest.raises(m.StaffError):
            m.register_sql(email, name, role)
    assert m.register_sql("o.brien@example.test", "Sean O'Brien", "support").endswith("'Sean O''Brien', 'support')")   # a real apostrophe is doubled, never raw


def test_a_password_needs_length_a_letter_and_a_digit() -> None:
    m = load()
    assert not m.password_ok("short1") and not m.password_ok("onlyletterslongenough") and not m.password_ok("123456789012345") and m.password_ok("a-long-enough-one-7")


def test_nothing_secret_is_written_anywhere_in_the_script() -> None:
    text = (SCRIPTS / "admin_staff_register.py").read_text()
    assert not re.search(r"(?<![A-Za-z_.])open\(", text) and "write_text" not in text and "environ" not in text   # no file, no environment variable carries the password or the factor secret
    assert text.count("getpass.getpass") >= 3
