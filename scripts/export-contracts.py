"""Write packages/contracts/{crm,evidence}.schema.json and {crm,evidence}.ts from the API models.
Run through `make contracts` (uses the API virtualenv)."""

from pathlib import Path

from app.crm.contracts import schema_text, ts_text
from app.evidence import contracts as evidence

ROOT = Path(__file__).resolve().parents[1]
(ROOT / "packages/contracts/crm.schema.json").write_text(schema_text())
(ROOT / "packages/contracts/crm.ts").write_text(ts_text())
(ROOT / "packages/contracts/evidence.schema.json").write_text(evidence.schema_text())
(ROOT / "packages/contracts/evidence.ts").write_text(evidence.ts_text())
print("wrote packages/contracts/{crm,evidence}.schema.json and {crm,evidence}.ts")
