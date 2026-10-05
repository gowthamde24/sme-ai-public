"""The agents the runtime knows. The database holds the matching `agent_definitions` row
(operator-managed ceilings and allow-lists); a name that is not in both places cannot run."""

from __future__ import annotations

from app.agents.research import RESEARCH
from app.agents.selftest import SELFTEST
from app.agents.spec import AgentSpec

AGENTS: dict[str, AgentSpec] = {SELFTEST.name: SELFTEST, RESEARCH.name: RESEARCH}
