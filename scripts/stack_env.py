"""Which local Supabase stack is this process talking to? (job BG, docs/runbooks/two-local-stacks.md)

There are two: the OWNER's demo stack (supabase/config.toml, project `sme-ai`, API port 54321) and the AGENT test stack (stacks/sme-ai-agent, project `sme-ai-agent`, API port 54421). The agent stack
is the default for everything an agent runs; the owner's stack is chosen on purpose (STACK=owner / SME_STACK=owner) and its destructive actions (reset, stop, pgTAP, a clock pin) need OWNER_OK=1.

`scripts/stack.sh` is the shell twin of this module; tests/test_stacks.py checks that the two agree. Both decide in the same order:
  1. SME_STACK (`agent` or `owner`) when set;
  2. else the port of SUPABASE_URL when it is one of the two stacks' API ports (so a bare `pytest` against the owner's URL is still seen as the owner's);
  3. else `agent`.
"""

from __future__ import annotations

import os
import re
from collections.abc import Mapping
from dataclasses import dataclass
from urllib.parse import urlparse


@dataclass(frozen=True)
class Stack:
    name: str
    project_id: str
    api_port: int
    db_port: int
    workdir: str  # relative to the repository root

    @property
    def db_container(self) -> str:
        return f"supabase_db_{self.project_id}"


OWNER = Stack("owner", "sme-ai", 54321, 54322, ".")
AGENT = Stack("agent", "sme-ai-agent", 54421, 54422, "stacks/sme-ai-agent")
STACKS = {s.name: s for s in (OWNER, AGENT)}


class StackError(RuntimeError):
    pass


def current(env: Mapping[str, str] | None = None) -> Stack:
    env = os.environ if env is None else env
    named = env.get("SME_STACK", "").strip()
    if named:
        if named not in STACKS:
            raise StackError(f"SME_STACK must be 'agent' or 'owner', not {named!r}")
        return STACKS[named]
    port = urlparse(env.get("SUPABASE_URL", "")).port
    for stack in STACKS.values():
        if port == stack.api_port:
            return stack
    return AGENT


def db_container(env: Mapping[str, str] | None = None) -> str:
    """The database container of the current stack (SME_DB_CONTAINER overrides it, for a test that points at a fake)."""
    env = os.environ if env is None else env
    named = env.get("SME_DB_CONTAINER", "").strip()
    if named:
        if not re.fullmatch(r"supabase_db_[A-Za-z0-9._-]{1,64}", named):
            raise StackError("SME_DB_CONTAINER must look like supabase_db_<project>")
        return named
    return current(env).db_container


def owner_ok(env: Mapping[str, str] | None = None) -> bool:
    env = os.environ if env is None else env
    return env.get("OWNER_OK", "") == "1"


def require_owner_ok(action: str, env: Mapping[str, str] | None = None) -> None:
    """Raise unless the current stack is the agent's or the owner said OWNER_OK=1: for anything that resets, stops or pins the clock of a database."""
    env = os.environ if env is None else env
    if current(env) is OWNER and not owner_ok(env):
        raise StackError(
            f"refusing to {action} on the OWNER's stack (project sme-ai, port 54321): it belongs to the owner's demo. Agents use the agent stack (the default: make agent-db-up). "
            "The owner may set OWNER_OK=1 on purpose."
        )
