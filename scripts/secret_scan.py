#!/usr/bin/env python3
"""A small secret scanner for the tracked files of this repository (job CB, ADR 0082): `make secret-scan`. It looks for the shapes of real credentials (cloud and AI provider keys, private-key blocks,
JWTs that carry the service role, long literal values assigned to a variable named like a secret) and exits 1 listing FILE:LINE and the KIND (never the value). A line that says it is a placeholder or a
synthetic value (it contains one of the ALLOW words) is skipped, so test fixtures can name their fake keys honestly. It reads only files git tracks; it reads no .env file; it prints no secret.
Usage: scripts/secret_scan.py [--root DIR] [--list]"""

from __future__ import annotations

import base64
import json
import re
import subprocess
import sys
from pathlib import Path

PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("aws_access_key", re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b")),
    ("private_key_block", re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----")),
    ("anthropic_key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{20,}")),
    ("openai_style_key", re.compile(r"\bsk-(?:proj-)?[A-Za-z0-9]{32,}\b")),
    ("groq_key", re.compile(r"\bgsk_[A-Za-z0-9]{30,}\b")),
    ("google_api_key", re.compile(r"\bAIza[0-9A-Za-z_-]{35}\b")),
    ("slack_token", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}")),
    ("razorpay_live_key", re.compile(r"\brzp_live_[A-Za-z0-9]{10,}")),
    ("stripe_live_key", re.compile(r"\b[sr]k_live_[A-Za-z0-9]{16,}")),
    ("github_token", re.compile(r"\bgh[pousr]_[A-Za-z0-9]{30,}\b")),
    ("supabase_secret_key", re.compile(r"\bsb_secret_[A-Za-z0-9_-]{20,}")),
    ("generic_assignment", re.compile(r"""(?i)\b[a-z0-9_]*(?:secret|password|passwd|api_?key|auth_?token|private_?key)[a-z0-9_]*\s*[:=]\s*["'][A-Za-z0-9+/_=-]{24,}["']""")),
)
JWT = re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")
ALLOW = ("not-real", "not a real", "placeholder", "synthetic", "example", "dummy", "fake", "test-key", "test_key", "<your", "xxxx", "changeme", "do-not-log", "not-a-secret", "worthless", "published", "canary", "test-only", "-test-", "fixture")
SKIP_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp", ".woff", ".woff2", ".ttf", ".pdf", ".xlsx", ".zip", ".lock", ".svg")
SKIP_DIRS = ("node_modules/", ".next/", "package-lock.json", ".venv/")
MAX_BYTES = 1_000_000


def tracked(root: Path) -> list[str]:
    out = subprocess.run(["git", "ls-files", "-z"], cwd=root, check=True, capture_output=True).stdout  # noqa: S603, S607
    return [p for p in out.decode().split("\0") if p]


def jwt_role(token: str) -> str | None:
    try:
        payload = token.split(".")[1]
        data = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
        role = data.get("role")
        return str(role) if role else None
    except (ValueError, IndexError, UnicodeDecodeError):
        return None


def scan_text(name: str, text: str) -> list[tuple[str, int, str]]:
    findings: list[tuple[str, int, str]] = []
    for number, line in enumerate(text.splitlines(), 1):
        lowered = line.lower()
        if any(word in lowered for word in ALLOW):
            continue
        for kind, pattern in PATTERNS:
            if pattern.search(line):
                findings.append((name, number, kind))
        for match in JWT.finditer(line):
            # a JWT is only a finding when it grants power: the service role, or a signing secret's token. The public (anon) key is meant to be public.
            if jwt_role(match.group(0)) in ("service_role", "supabase_admin"):
                findings.append((name, number, "jwt_service_role"))
    return findings


def scan(root: Path) -> list[tuple[str, int, str]]:
    findings: list[tuple[str, int, str]] = []
    for name in tracked(root):
        if name.endswith(SKIP_SUFFIXES) or any(part in name for part in SKIP_DIRS):
            continue
        path = root / name
        try:
            if not path.is_file() or path.stat().st_size > MAX_BYTES:
                continue
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        findings += scan_text(name, text)
    return findings


def main(argv: list[str]) -> int:
    root = Path(".").resolve()
    if "--root" in argv:
        root = Path(argv[argv.index("--root") + 1]).resolve()
    findings = scan(root)
    if "--list" in argv or findings:
        for name, number, kind in findings:
            print(f"{name}:{number}: {kind}")
    if findings:
        print(f"secret-scan: {len(findings)} possible secret(s) in tracked files (values are not printed). Remove them, rotate the credential, or mark a fake as such on its line.", file=sys.stderr)
        return 1
    print("secret-scan: no secrets found in tracked files")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
