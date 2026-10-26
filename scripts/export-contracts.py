"""Write packages/contracts/{crm,evidence,leads,agents,erasure,packs,materials,campaigns,education,reports,voice_notes,billing,outcomes,assistant_settings,marks_messages}.schema.json and
{crm,evidence,leads,agents,erasure,packs,materials,campaigns,education,reports,voice_notes,billing,outcomes,assistant_settings,marks_messages}.ts from the API models.
Run through `make contracts` (uses the API virtualenv)."""

from pathlib import Path

from app.agent_runs import contracts as agents
from app.assistant_settings import contracts as assistant_settings
from app.billing import contracts as billing
from app.callsettings import contracts as call_settings
from app.campaigns import contracts as campaigns
from app.crm.contracts import schema_text, ts_text
from app.education import contracts as education
from app.erasure import contracts as erasure
from app.evidence import contracts as evidence
from app.leads import contracts as leads
from app.marksmessages import contracts as marks_messages
from app.materials import contracts as materials
from app.outcomes import contracts as outcomes
from app.outreach import contracts as outreach
from app.ownvoice import contracts as own_voice
from app.packs import contracts as packs
from app.reports import contracts as reports
from app.speaking import contracts as speaking
from app.voice_notes import contracts as voice_notes

ROOT = Path(__file__).resolve().parents[1]
(ROOT / "packages/contracts/crm.schema.json").write_text(schema_text())
(ROOT / "packages/contracts/crm.ts").write_text(ts_text())
(ROOT / "packages/contracts/evidence.schema.json").write_text(evidence.schema_text())
(ROOT / "packages/contracts/evidence.ts").write_text(evidence.ts_text())
(ROOT / "packages/contracts/leads.schema.json").write_text(leads.schema_text())
(ROOT / "packages/contracts/leads.ts").write_text(leads.ts_text())
(ROOT / "packages/contracts/agents.schema.json").write_text(agents.schema_text())
(ROOT / "packages/contracts/agents.ts").write_text(agents.ts_text())
(ROOT / "packages/contracts/erasure.schema.json").write_text(erasure.schema_text())
(ROOT / "packages/contracts/erasure.ts").write_text(erasure.ts_text())
(ROOT / "packages/contracts/packs.schema.json").write_text(packs.schema_text())
(ROOT / "packages/contracts/packs.ts").write_text(packs.ts_text())
(ROOT / "packages/contracts/materials.schema.json").write_text(materials.schema_text())
(ROOT / "packages/contracts/materials.ts").write_text(materials.ts_text())
(ROOT / "packages/contracts/campaigns.schema.json").write_text(campaigns.schema_text())
(ROOT / "packages/contracts/campaigns.ts").write_text(campaigns.ts_text())
(ROOT / "packages/contracts/education.schema.json").write_text(education.schema_text())
(ROOT / "packages/contracts/education.ts").write_text(education.ts_text())
(ROOT / "packages/contracts/reports.schema.json").write_text(reports.schema_text())
(ROOT / "packages/contracts/reports.ts").write_text(reports.ts_text())
(ROOT / "packages/contracts/voice_notes.schema.json").write_text(voice_notes.schema_text())
(ROOT / "packages/contracts/voice_notes.ts").write_text(voice_notes.ts_text())
(ROOT / "packages/contracts/own_voice.schema.json").write_text(own_voice.schema_text())
(ROOT / "packages/contracts/own_voice.ts").write_text(own_voice.ts_text())
(ROOT / "packages/contracts/billing.schema.json").write_text(billing.schema_text())
(ROOT / "packages/contracts/billing.ts").write_text(billing.ts_text())
(ROOT / "packages/contracts/call_settings.schema.json").write_text(call_settings.schema_text())
(ROOT / "packages/contracts/call_settings.ts").write_text(call_settings.ts_text())
(ROOT / "packages/contracts/assistant_settings.schema.json").write_text(assistant_settings.schema_text())
(ROOT / "packages/contracts/assistant_settings.ts").write_text(assistant_settings.ts_text())
(ROOT / "packages/contracts/outcomes.schema.json").write_text(outcomes.schema_text())
(ROOT / "packages/contracts/outcomes.ts").write_text(outcomes.ts_text())
(ROOT / "packages/contracts/marks_messages.schema.json").write_text(marks_messages.schema_text())
(ROOT / "packages/contracts/marks_messages.ts").write_text(marks_messages.ts_text())
(ROOT / "packages/contracts/speaking_style.schema.json").write_text(speaking.schema_text())
(ROOT / "packages/contracts/speaking_style.ts").write_text(speaking.ts_text())
(ROOT / "packages/contracts/outreach.schema.json").write_text(outreach.schema_text())
(ROOT / "packages/contracts/outreach.ts").write_text(outreach.ts_text())
print(
    "wrote packages/contracts/{crm,evidence,leads,agents,erasure,packs,materials,campaigns,education,reports,voice_notes,billing,outcomes,assistant_settings,marks_messages}.schema.json "
    "and {crm,evidence,leads,agents,erasure,packs,materials,campaigns,education,reports,voice_notes,billing,outcomes,assistant_settings,marks_messages}.ts"
)
