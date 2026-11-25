import type { Card, ConnectorsPage } from "@/lib/api/crm-push";

/**
 * Sample cards for review and pictures (CRM_PUSH_SCREENS=mock): nothing is sent or saved and every button is off. The words are the API's own (docs/contracts/crm-push.md); a real workspace reads them from the API.
 */
const OUR = [
  { key: "name", label: "Name" },
  { key: "phone", label: "Phone number" },
  { key: "email", label: "Email" },
  { key: "source", label: "Where the lead came from" },
  { key: "outcome", label: "What came of the call" },
  { key: "summary", label: "Summary of the call" },
  { key: "captured", label: "Details the assistant took down" },
  { key: "duration", label: "Call length" },
  { key: "call_id", label: "Call reference" },
];
const base = { script: null, noteValue: "@note", usesNotes: true, ourFields: OUR, needsSetup: null };
const hubspot: Card = {
  ...base,
  type: "hubspot",
  label: "HubSpot",
  state: "connected",
  credentials: [{ key: "token", label: "Private app access token", help: "HubSpot: Settings, Integrations, Private Apps.", example: "" }],
  settings: [],
  targets: [{ field: "firstname", label: "First name" }, { field: "email", label: "Email" }, { field: "phone", label: "Phone" }],
  defaultMapping: { name: "firstname", phone: "phone", email: "email", source: "", outcome: "@note", summary: "@note", captured: "@note", duration: "@note", call_id: "@note" },
  setupSteps: ["In HubSpot open Settings, Integrations, Private Apps and make a private app."],
  connection: { id: "00000000-0000-4000-8000-0000000000a1", config: {}, mapping: {}, events: ["call.completed", "lead.created"], active: true, failing: false, deadLetters7d: 0, lastDeliveredAt: "2026-11-25T09:30:00Z", lastTest: { at: "2026-11-25T09:00:00Z", ok: true, reason: null } },
};
const leadsquared: Card = {
  ...base,
  type: "leadsquared",
  label: "LeadSquared",
  state: "not_connected",
  credentials: [{ key: "access_key", label: "Access key", help: "", example: "" }, { key: "second_key", label: "Second key", help: "", example: "" }],
  settings: [{ key: "host", label: "API host", help: "Shown next to your keys.", example: "api-in21.leadsquared.com" }],
  targets: [{ field: "FirstName", label: "First name" }, { field: "Phone", label: "Phone" }, { field: "EmailAddress", label: "Email" }],
  defaultMapping: { name: "FirstName", phone: "Phone", email: "EmailAddress", source: "Source", outcome: "@note", summary: "@note", captured: "@note", duration: "@note", call_id: "@note" },
  setupSteps: ["In LeadSquared open My Account, Settings, API and Webhooks.", "Copy the Access key, the Second key and the API host."],
  connection: null,
};
const zoho: Card = { ...leadsquared, type: "zoho_crm", label: "Zoho CRM", state: "needs_setup", credentials: [], settings: [], setupSteps: [], needsSetup: "We still need to register Stack19 with Zoho (one time, by us). Until then this cannot be connected." };
export const SAMPLE_PAGE: ConnectorsPage = {
  items: [hubspot, zoho, leadsquared],
  events: ["call.completed", "call.missed", "lead.created", "lead.updated", "job.outcome"],
  available: true,
};
