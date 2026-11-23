"""LOCAL DEVELOPMENT ONLY (job AW, ADR 0068): start the scheduler worker against the local Supabase stack.

The worker has no standing key. It signs in as its OWN account, which this script prepares on the first run:
  1. sign the account up (a fixed fake address on a reserved domain, a constant local password: the same idea as the demo owner in seed_demo.py),
  2. confirm its e-mail address through the local database container (the same `docker exec` local_confirm.py uses),
  3. register it as the scheduler in the database (app.operator_register_scheduler, operator only; it refuses an account that belongs to a workspace),
then runs `python -m app.scheduler.worker` with the account's address and password in its environment (never printed, never written to a file).

It refuses any Supabase URL that is not this machine. Nothing leaves this machine: the only channel is the local fake. Pass --once to run a single tick and exit.
The worker acts only while the global outbox switch is on (`make dev-enable-outbox` / seed-demo-outbox) AND the business has automatic sending on."""

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

SCHEDULER_EMAIL = "scheduler@system.example.test"
SCHEDULER_PASSWORD = "Scheduler-Only-Local-Password-1!"  # noqa: S105 - a local stack account, no workspace


def die(message: str) -> None:
    print(f"dev-worker-local: {message}", file=sys.stderr)  # noqa: T201
    raise SystemExit(1)


def main() -> None:
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    anon = os.environ.get("SUPABASE_PUBLISHABLE_KEY") or os.environ.get("SUPABASE_ANON_KEY") or ""
    if urlparse(url).hostname not in ("127.0.0.1", "localhost") or not anon:
        die("run it with `make dev-worker-local` (it takes the local stack's URL and public key); it refuses any other address")
    creds = {"email": SCHEDULER_EMAIL, "password": SCHEDULER_PASSWORD}
    headers = {"apikey": anon}
    try:
        signed = httpx.post(f"{url}/auth/v1/token?grant_type=password", json=creds, headers=headers, timeout=30)
        if signed.status_code != 200:  # first run: create the account and confirm it (local stack only)
            httpx.post(f"{url}/auth/v1/signup", json=creds, headers=headers, timeout=30)
            confirm_email(SCHEDULER_EMAIL)
            signed = httpx.post(f"{url}/auth/v1/token?grant_type=password", json=creds, headers=headers, timeout=30)
    except httpx.HTTPError:
        die("the local Supabase stack is not reachable. Run `make db-start`.")
    if signed.status_code != 200:
        die("could not sign the scheduler account in on the local stack")
    docker = shutil.which("docker")
    if docker is None:
        die("docker is needed to register the scheduler account in the local database")
    done = subprocess.run(  # noqa: S603 - fixed argv; the address is a constant of this file
        [docker, "exec", "-i", container(), "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-At", "-c",
         f"select app.operator_register_scheduler('{SCHEDULER_EMAIL}')"],  # noqa: S608
        capture_output=True, text=True, timeout=30, check=False,
    )
    if done.returncode != 0:
        die("could not register the scheduler account in the local database")
    env = {**os.environ, "SCHEDULER_EMAIL": SCHEDULER_EMAIL, "SCHEDULER_PASSWORD": SCHEDULER_PASSWORD}
    python = Path(".venv/bin/python")
    os.execve(str(python), [str(python), "-m", "app.scheduler.worker", *sys.argv[1:]], env)  # noqa: S606


if __name__ == "__main__":
    main()
