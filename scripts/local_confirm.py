"""Confirm the e-mail address of a throwaway account on the LOCAL stack.

The local stack now asks every new account to confirm its e-mail address (job AD / D2: open sign-up). The real path sends a link to the local
mail catcher (http://127.0.0.1:54324) and nothing else. Test, rehearsal and demo tooling signs up accounts by the dozen and has no mailbox to
click in, so it marks its OWN accounts confirmed through the local database container, with the same `docker exec ... psql` that
`seed_demo.local_factor_secret` already uses. It reaches nothing but this machine's stack and needs no key of any kind.

The real confirmation path is exercised separately (tests/integration/test_open_signup.py reads the link out of the mail catcher and uses it).
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

_EMAIL = re.compile(r"^[A-Za-z0-9._+-]{1,64}@[A-Za-z0-9.-]{1,120}$")


def container() -> str:
    config = (Path(__file__).resolve().parents[1] / "supabase" / "config.toml").read_text()
    match = re.search(r'^project_id\s*=\s*"([^"]+)"', config, re.M)
    if match is None:
        raise RuntimeError("supabase/config.toml has no project_id")
    return f"supabase_db_{match.group(1)}"


def confirm_email(email: str) -> None:
    """Mark the account with this e-mail address as confirmed (a no-op if it already is)."""
    docker = shutil.which("docker")
    if docker is None or not _EMAIL.fullmatch(email):
        raise RuntimeError("Cannot confirm the account: docker is missing or the address is unexpected.")
    done = subprocess.run(  # noqa: S603 - fixed argv; the address is validated above
        [docker, "exec", "-i", container(), "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-At", "-c",
         f"update auth.users set email_confirmed_at = coalesce(email_confirmed_at, now()) where lower(email) = lower('{email}')"],  # noqa: S608
        capture_output=True, text=True, timeout=30, check=False,
    )
    if done.returncode != 0:
        raise RuntimeError("Cannot confirm the account on the local database container.")
