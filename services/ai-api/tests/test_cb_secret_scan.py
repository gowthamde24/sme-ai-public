"""Job CB (ADR 0082): the secret scanner. It finds the shape of a real credential in a tracked file, skips a line that says it is fake, treats the public Supabase key as public and the service-role key as a
secret, prints no value, and finds nothing in this repository. The sample credentials below are assembled at run time so this file does not contain one."""

from __future__ import annotations

import base64
import importlib.util
import json
import subprocess
from pathlib import Path
from types import ModuleType

import pytest

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location("secret_scan", ROOT / "scripts" / "secret_scan.py")
assert SPEC is not None and SPEC.loader is not None
scan: ModuleType = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(scan)


def jwt(role: str) -> str:
    def part(doc: dict[str, str]) -> str:
        return base64.urlsafe_b64encode(json.dumps(doc).encode()).decode().rstrip("=")

    return f"{part({'alg': 'HS256', 'typ': 'JWT'})}.{part({'role': role, 'iss': 'x'})}.{'s' * 24}"


REAL_SHAPES = {
    "aws_access_key": "AK" + "IA" + "ABCDEFGHIJKLMNOP",
    "private_key_block": "-----BEGIN " + "RSA PRIVATE KEY-----",
    "anthropic_key": "sk-" + "ant-" + "a1B2c3D4e5F6g7H8i9J0k1L2",
    "openai_style_key": "sk-" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7",
    "groq_key": "gsk" + "_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6",
    "google_api_key": "AI" + "za" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r",
    "slack_token": "xo" + "xb-" + "1234567890-abcdefghij",
    "razorpay_live_key": "rzp_" + "live_" + "A1b2C3d4E5f6G7",
    "github_token": "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7",
    "supabase_secret_key": "sb_" + "secret_" + "A1b2C3d4E5f6G7h8I9j0K1l2",
}


@pytest.mark.parametrize(("kind", "value"), sorted(REAL_SHAPES.items()))
def test_each_credential_shape_is_found(kind: str, value: str) -> None:
    found = scan.scan_text("config.txt", f"key = {value}\n")
    assert [k for _, _, k in found] == [kind]
    assert all(value not in repr(f) for f in found), "a finding never carries the value"


def test_a_long_literal_assigned_to_a_secret_like_name_is_found() -> None:
    assert [k for *_, k in scan.scan_text("a.py", 'API_KEY = "' + "Zq9" * 10 + '"\n')] == ["generic_assignment"]
    assert scan.scan_text("a.py", 'api_key = os.environ["API_KEY"]\n') == []
    assert scan.scan_text("a.py", 'password = ""\n') == []


def test_a_line_that_says_it_is_fake_is_skipped() -> None:
    assert scan.scan_text("t.py", 'KEY = "sk-ant-' + "a1B2c3D4e5F6g7H8i9J0k1L2" + '"  # a placeholder\n') == []
    assert scan.scan_text("t.py", 'SECRET = "' + "Zq9" * 10 + '"  # synthetic\n') == []


def test_the_service_role_jwt_is_a_secret_and_the_public_one_is_not() -> None:
    assert [k for *_, k in scan.scan_text("env.txt", f"KEY={jwt('service_role')}\n")] == ["jwt_service_role"]
    assert scan.scan_text("env.txt", f"KEY={jwt('anon')}\n") == []
    assert scan.scan_text("env.txt", f"KEY={jwt('authenticated')}\n") == []


def test_line_numbers_and_files_are_reported() -> None:
    text = "one\ntwo\nkey = " + REAL_SHAPES["groq_key"] + "\n"
    assert scan.scan_text("x/y.env", text) == [("x/y.env", 3, "groq_key")]


def test_the_repository_holds_none() -> None:
    assert scan.scan(ROOT) == []


def test_the_command_exits_one_on_a_finding_and_prints_no_value(tmp_path: Path) -> None:
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)  # noqa: S607
    (tmp_path / "leak.txt").write_text("token = " + REAL_SHAPES["github_token"] + "\n")
    subprocess.run(["git", "add", "leak.txt"], cwd=tmp_path, check=True)  # noqa: S607
    result = subprocess.run(["python3", str(ROOT / "scripts" / "secret_scan.py"), "--root", str(tmp_path)], capture_output=True, text=True, check=False)  # noqa: S603, S607
    assert result.returncode == 1 and "leak.txt:1: github_token" in result.stdout
    assert REAL_SHAPES["github_token"] not in result.stdout + result.stderr
