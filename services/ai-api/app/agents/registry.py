"""The agents the runtime knows. The database holds the matching `agent_definitions` row
(operator-managed ceilings and allow-lists); a name that is not in both places cannot run."""

from __future__ import annotations

from app.agents.requirement import REQUIREMENT
from app.agents.requirement_materials import REQUIREMENT_MATERIALS
from app.agents.research import RESEARCH
from app.agents.selftest import SELFTEST
from app.agents.spec import AgentSpec

AGENTS: dict[str, AgentSpec] = {
    SELFTEST.name: SELFTEST,
    RESEARCH.name: RESEARCH,
    REQUIREMENT.name: REQUIREMENT,
}


# a second version of an agent under the SAME name (and so the same `agent_definitions` row):
# the requirement agent of a building-materials workspace
VARIANTS: dict[tuple[str, str], AgentSpec] = {
    (REQUIREMENT_MATERIALS.name, REQUIREMENT_MATERIALS.version): REQUIREMENT_MATERIALS,
}


def spec_for(name: str, version: str = "") -> AgentSpec | None:
    return VARIANTS.get((name, version)) or AGENTS.get(name)
