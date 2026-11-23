"""LOCAL DEVELOPMENT ONLY (job CD): prepare the WhatsApp channel principal on the local Supabase stack, for `make dev-api-whatsapp`.

The webhook hands what Meta sends to the database as a channel principal: an account that belongs to no workspace and is registered by the OPERATOR (app.operator_register_channel_agent). This does what
`make dev-worker-local` does for the scheduler: (1) sign the account up (a fixed fake address on a reserved domain, a constant local password), (2) confirm its e-mail address through the local database
container, (3) register it as the channel principal. Idempotent. It prints nothing secret and refuses any Supabase URL that is not this machine. The address and the password are the constants below; the
API gets them as CHANNEL_AGENT_EMAIL / CHANNEL_AGENT_PASSWORD from `scripts/dev-api-whatsapp.sh`."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from local_confirm import confirm_email, container  # noqa: E402

CHANNEL_EMAIL = "channel@system.example.test"
CHANNEL_PASSWORD = "Channel-Only-Local-Password-1!"  # noqa: S105 - a local stack account, no workspace


def die(message: str) -> None:
    print(f"prepare-channel-agent: {message}", file=sys.stderr)  # noqa: T201
    raise SystemExit(1)


def main() -> None:
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    anon = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY") or ""
    if urlparse(url).hostname not in ("127.0.0.1", "localhost") or not anon:
        die("run it through scripts/with-local-supabase-env.sh (it takes the local stack's URL and public key); it refuses any other address")
    creds = {"email": CHANNEL_EMAIL, "password": CHANNEL_PASSWORD}
    headers = {"apikey": anon}
    try:
        signed = httpx.post(f"{url}/auth/v1/token?grant_type=password", json=creds, headers=headers, timeout=30)
        if signed.status_code != 200:  # first run: create the account and confirm it (local stack only)
            httpx.post(f"{url}/auth/v1/signup", json=creds, headers=headers, timeout=30)
            confirm_email(CHANNEL_EMAIL)
            signed = httpx.post(f"{url}/auth/v1/token?grant_type=password", json=creds, headers=headers, timeout=30)
    except httpx.HTTPError:
        die("the local Supabase stack is not reachable. Run `make db-start`.")
    if signed.status_code != 200:
        die("could not sign the channel account in on the local stack")
    docker = shutil.which("docker")
    if docker is None:
        die("docker is needed to register the channel account in the local database")
    done = subprocess.run(  # noqa: S603 - fixed argv; the address is a constant of this file
        [docker, "exec", "-i", container(), "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-At", "-c",
         f"select app.operator_register_channel_agent('{CHANNEL_EMAIL}')"],  # noqa: S608
        capture_output=True, text=True, timeout=30, check=False,
    )
    if done.returncode != 0:
        die("could not register the channel account in the local database")
    print("prepare-channel-agent: the channel account is ready (local stack only).", file=sys.stderr)  # noqa: T201


if __name__ == "__main__":
    main()
