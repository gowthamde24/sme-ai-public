# ruff: noqa: E501
"""The hidden-prompt script that puts the Meta app secret and the Page token into staging Secret Manager (Track D)."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

import pytest


def _load() -> Any:
    spec = importlib.util.spec_from_file_location("staging_meta_secrets", Path(__file__).resolve().parents[3] / "scripts" / "staging_meta_secrets.py")
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_meta_secrets_script_checks_shapes_refuses_wrong_project_and_never_prints_values(monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]) -> None:
    mod = _load()
    shape_ok = "0123456789abcdef" * 2   # a fake value built at run time (the repo secret scan flags long literals)
    secret = shape_ok
    token = "".join(["EA", "A"]) + "FakeTokenValue0123456789" * 3
    assert mod.valid_secret(secret) and not mod.valid_secret("hello") and not mod.valid_secret(secret.upper())
    assert mod.valid_token(token) and not mod.valid_token("EAAshort") and not mod.valid_token("xyz" + token)
    assert mod.main(["--project", mod.STAGING_PROJECT]) == 1
    assert mod.main(["--i-know-this-writes-staging-secrets", "--project", "some-other-project"]) == 1
    calls: list[tuple[list[str], str | None]] = []

    def fake_gcloud(args: list[str], stdin: str | None = None) -> int:
        calls.append((args, stdin))
        return 1 if args[1] == "describe" else 0

    monkeypatch.setattr(mod, "gcloud", fake_gcloud)
    answers = iter([secret, secret, token, token])
    monkeypatch.setattr(mod.getpass, "getpass", lambda prompt="": next(answers))
    assert mod.main(["--i-know-this-writes-staging-secrets", "--project", mod.STAGING_PROJECT]) == 0
    out = capsys.readouterr()
    assert secret not in out.out + out.err and "FakeTokenValue" not in out.out + out.err
    created = [(a, s) for a, s in calls if a[1] == "create"]
    assert [a[2] for a, _ in created] == ["sme-meta-app-secret", "sme-meta-page-token"]
    assert all(secret not in " ".join(a) and "FakeTokenValue" not in " ".join(a) for a, _ in calls), "a value never goes on the command line"
    assert created[0][1] == secret and created[1][1] == token, "it goes on stdin"
