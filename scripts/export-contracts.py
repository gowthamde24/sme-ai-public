"""Write packages/contracts/{crm,evidence,leads,agents}.schema.json and {crm,evidence,leads,agents}.ts from the API
models.
Run through `make contracts` (uses the API virtualenv)."""

from pathlib import Path

from app.agent_runs import contracts as agents
from app.crm.contracts import schema_text, ts_text
from app.evidence import contracts as evidence
from app.leads import contracts as leads

ROOT = Path(__file__).resolve().parents[1]
(ROOT / "packages/contracts/crm.schema.json").write_text(schema_text())
(ROOT / "packages/contracts/crm.ts").write_text(ts_text())
(ROOT / "packages/contracts/evidence.schema.json").write_text(evidence.schema_text())
(ROOT / "packages/contracts/evidence.ts").write_text(evidence.ts_text())
(ROOT / "packages/contracts/leads.schema.json").write_text(leads.schema_text())
(ROOT / "packages/contracts/leads.ts").write_text(leads.ts_text())
(ROOT / "packages/contracts/agents.schema.json").write_text(agents.schema_text())
(ROOT / "packages/contracts/agents.ts").write_text(agents.ts_text())
print("wrote packages/contracts/{crm,evidence,leads,agents}.schema.json and {crm,evidence,leads,agents}.ts")
