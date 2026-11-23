"""A tiny Supabase Management API client (job DC): the session of `supabase login`, used in memory only.

Reads the Supabase CLI's access token from the macOS keychain (where `supabase login` stored it), sends it only to https://api.supabase.com, and never prints it. Used for the things the CLI has no
command for: the hosted Auth settings (docs/runbooks/hosted-auth-settings.md) and the short-lived read-only database login role of scripts/staging_backup.py.

  python3 -I scripts/sb_mgmt.py GET /v1/projects/<ref>/config/auth
  python3 -I scripts/sb_mgmt.py PATCH /v1/projects/<ref>/config/auth '{"disable_signup": true}'
Never `PATCH` from a file of local settings (docs/runbooks/hosted-auth-settings.md: no `supabase config push`).
"""

from __future__ import annotations

import base64
import json
import subprocess
import sys
import urllib.error
import urllib.request


def token() -> str:
    raw = subprocess.run(["security", "find-generic-password", "-s", "Supabase CLI", "-w"], capture_output=True, text=True, check=True).stdout.strip()
    if raw.startswith("go-keyring-base64:"):
        raw = base64.b64decode(raw.split(":", 1)[1]).decode()
    return raw


def call(method: str, path: str, body: object | None = None) -> tuple[int, object]:
    if not path.startswith("/v1/"):
        raise ValueError("a Management API path starts with /v1/")
    req = urllib.request.Request(  # noqa: S310 - fixed https host
        "https://api.supabase.com" + path, method=method, data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": "Bearer " + token(), "Content-Type": "application/json", "User-Agent": "stack19-ops"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]


if __name__ == "__main__":
    status, data = call(sys.argv[1], sys.argv[2], json.loads(sys.argv[3]) if len(sys.argv) > 3 else None)
    print(status)
    print(json.dumps(data, indent=1) if not isinstance(data, str) else data)
