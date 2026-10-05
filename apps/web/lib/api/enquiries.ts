import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { type RunOut, parseRun } from "./agents";

/**
 * Server-side client for the enquiry and requirement endpoints of OUR API (T008).
 *
 * An enquiry is UNTRUSTED text (a customer wrote it; contact details were removed before it was stored): the screens render it, its
 * quotes and its fields as PLAIN TEXT only. A requirement field proposed by the agent is a SUGGESTION until a person confirms,
 * corrects or rejects it. Nothing here sends anything: clarifying questions are text for a person to copy.
 */
export const CHANNELS = ["email", "whatsapp", "form", "other"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<Channel, string> = {
  email: "E-mail",
  whatsapp: "WhatsApp",
  form: "Form",
  other: "Other",
};

export const FIELD_KEYS = ["saree_type", "fabric", "colour", "quantity", "budget", "deadline", "delivery_city", "payment_terms"] as const;
export type FieldKey = (typeof FIELD_KEYS)[number];
export const LINE_FIELD_KEYS: readonly FieldKey[] = ["saree_type", "fabric", "colour", "quantity"];
export const FIELD_LABELS: Record<FieldKey, string> = {
  saree_type: "Saree type",
  fabric: "Fabric",
  colour: "Colour",
  quantity: "Quantity",
  budget: "Budget",
  deadline: "Needed by",
  delivery_city: "Delivery city",
  payment_terms: "Payment terms",
};
export const CERTAINTIES = ["stated", "implied", "ambiguous"] as const;
export type Certainty = (typeof CERTAINTIES)[number];
export const FIELD_STATES = ["proposed", "confirmed", "corrected", "rejected"] as const;
export type FieldState = (typeof FIELD_STATES)[number];
/** What a person sees for a state: nothing is "Approved" unless a person did it. */
export const FIELD_STATE_LABELS: Record<FieldState, string> = {
  proposed: "Suggested",
  confirmed: "Approved",
  corrected: "Approved (corrected)",
  rejected: "Rejected",
};
export const CERTAINTY_LABELS: Record<Certainty, string> = {
  stated: "stated in the enquiry",
  implied: "implied: please check",
  ambiguous: "ambiguous: please check",
};
export const REQUIREMENT_STATUSES = ["draft", "confirmed", "superseded", "discarded"] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];
export const REQUIREMENT_STATUS_LABELS: Record<RequirementStatus, string> = {
  draft: "Draft",
  confirmed: "Approved",
  superseded: "Replaced",
  discarded: "Discarded",
};
const ORIGINS = ["manual", "import", "agent"] as const;
const KINDS = ["missing", "low_certainty", "conflicting"] as const;
export const FLAG_LABELS: Record<(typeof KINDS)[number], string> = {
  missing: "missing",
  low_certainty: "please check",
  conflicting: "the enquiry contradicts itself",
};

export interface Enquiry {
  id: string;
  lead_id: string;
  company_id: string | null;
  contact_id: string | null;
  channel: Channel;
  received_at: string;
  subject: string | null;
  body: string;
  truncated_from: number | null;
  created_by: string | null;
  created_at: string;
  archived_at: string | null;
}
export interface Captured {
  enquiry: Enquiry;
  text_changed: boolean;
  truncated: boolean;
}
export interface FieldValue {
  code: string | null;
  int_value: number | null;
  date_value: string | null;
  text: string | null;
  basis: string | null;
}
export interface RequirementField {
  id: string;
  line_no: number | null;
  field_key: FieldKey;
  value: FieldValue;
  display: string;
  certainty: Certainty;
  state: FieldState;
  conflict: boolean;
  created_via: (typeof ORIGINS)[number];
  quote: string | null;
  quote_start: number | null;
  quote_end: number | null;
  decided_by: string | null;
  decided_at: string | null;
}
export interface RequirementSummary {
  id: string;
  status: RequirementStatus;
  created_via: (typeof ORIGINS)[number];
  agent_run_id: string | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  created_at: string;
}
export interface Flag {
  kind: (typeof KINDS)[number];
  field_key: FieldKey;
  line_no: number | null;
}
export interface Question {
  code: string;
  text: string;
  field_key: FieldKey;
  line_no: number | null;
}
export interface RequirementView {
  requirement: RequirementSummary | null;
  fields: RequirementField[];
  lines: number[];
  confirmable: boolean;
  ready_for_quote: boolean;
  flags: Flag[];
  questions: Question[];
}
export interface FieldDecision {
  field_id: string;
  state: FieldState;
  replayed: boolean;
}
export interface FieldAdded {
  field_id: string;
  requirement_id: string;
  replayed: boolean;
}
export interface RequirementAction {
  requirement_id: string;
  status: RequirementStatus;
  replayed: boolean;
}

// ----------------------------------------------------------------------------- parsing (a body that does not match is an error, never rendered)
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in an enquiry response.`);
}
function str(r: Record<string, unknown>, key: string): string {
  const v = r[key];
  return typeof v === "string" ? v : bad(key);
}
function strOrNull(r: Record<string, unknown>, key: string): string | null {
  const v = r[key];
  return v === null ? null : typeof v === "string" ? v : bad(key);
}
function numOrNull(r: Record<string, unknown>, key: string): number | null {
  const v = r[key];
  return v === null ? null : typeof v === "number" && Number.isFinite(v) ? v : bad(key);
}
function bool(r: Record<string, unknown>, key: string): boolean {
  const v = r[key];
  return typeof v === "boolean" ? v : bad(key);
}
function oneOf<T extends string>(r: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const v = r[key];
  return typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : bad(key);
}
function list(v: unknown, what: string): unknown[] {
  return Array.isArray(v) ? v : bad(what);
}

export function parseEnquiry(json: unknown): Enquiry {
  if (!isRecord(json)) return bad("enquiry");
  return {
    id: str(json, "id"),
    lead_id: str(json, "lead_id"),
    company_id: strOrNull(json, "company_id"),
    contact_id: strOrNull(json, "contact_id"),
    channel: oneOf(json, "channel", CHANNELS),
    received_at: str(json, "received_at"),
    subject: strOrNull(json, "subject"),
    body: str(json, "body"),
    truncated_from: numOrNull(json, "truncated_from"),
    created_by: strOrNull(json, "created_by"),
    created_at: str(json, "created_at"),
    archived_at: strOrNull(json, "archived_at"),
  };
}

export function parseCaptured(json: unknown): Captured {
  if (!isRecord(json)) return bad("capture");
  return { enquiry: parseEnquiry(json.enquiry), text_changed: bool(json, "text_changed"), truncated: bool(json, "truncated") };
}

function parseField(json: unknown): RequirementField {
  if (!isRecord(json) || !isRecord(json.value)) return bad("field");
  const value = json.value;
  return {
    id: str(json, "id"),
    line_no: numOrNull(json, "line_no"),
    field_key: oneOf(json, "field_key", FIELD_KEYS),
    value: {
      code: strOrNull(value, "code"),
      int_value: numOrNull(value, "int_value"),
      date_value: strOrNull(value, "date_value"),
      text: strOrNull(value, "text"),
      basis: strOrNull(value, "basis"),
    },
    display: str(json, "display"),
    certainty: oneOf(json, "certainty", CERTAINTIES),
    state: oneOf(json, "state", FIELD_STATES),
    conflict: bool(json, "conflict"),
    created_via: oneOf(json, "created_via", ORIGINS),
    quote: strOrNull(json, "quote"),
    quote_start: numOrNull(json, "quote_start"),
    quote_end: numOrNull(json, "quote_end"),
    decided_by: strOrNull(json, "decided_by"),
    decided_at: strOrNull(json, "decided_at"),
  };
}

function parseSummary(json: unknown): RequirementSummary {
  if (!isRecord(json)) return bad("requirement");
  return {
    id: str(json, "id"),
    status: oneOf(json, "status", REQUIREMENT_STATUSES),
    created_via: oneOf(json, "created_via", ORIGINS),
    agent_run_id: strOrNull(json, "agent_run_id"),
    confirmed_by: strOrNull(json, "confirmed_by"),
    confirmed_at: strOrNull(json, "confirmed_at"),
    created_at: str(json, "created_at"),
  };
}

export function parseRequirementView(json: unknown): RequirementView {
  if (!isRecord(json)) return bad("requirement view");
  return {
    requirement: json.requirement === null ? null : parseSummary(json.requirement),
    fields: list(json.fields, "fields").map(parseField),
    lines: list(json.lines, "lines").map((n) => (typeof n === "number" ? n : bad("line"))),
    confirmable: bool(json, "confirmable"),
    ready_for_quote: bool(json, "ready_for_quote"),
    flags: list(json.flags, "flags").map((f) => {
      if (!isRecord(f)) return bad("flag");
      return { kind: oneOf(f, "kind", KINDS), field_key: oneOf(f, "field_key", FIELD_KEYS), line_no: numOrNull(f, "line_no") };
    }),
    questions: list(json.questions, "questions").map((q) => {
      if (!isRecord(q)) return bad("question");
      return { code: str(q, "code"), text: str(q, "text"), field_key: oneOf(q, "field_key", FIELD_KEYS), line_no: numOrNull(q, "line_no") };
    }),
  };
}

export function parseFieldDecision(json: unknown): FieldDecision {
  if (!isRecord(json)) return bad("decision");
  return { field_id: str(json, "field_id"), state: oneOf(json, "state", FIELD_STATES), replayed: bool(json, "replayed") };
}
export function parseFieldAdded(json: unknown): FieldAdded {
  if (!isRecord(json)) return bad("added field");
  return { field_id: str(json, "field_id"), requirement_id: str(json, "requirement_id"), replayed: bool(json, "replayed") };
}
export function parseRequirementAction(json: unknown): RequirementAction {
  if (!isRecord(json)) return bad("requirement action");
  return { requirement_id: str(json, "requirement_id"), status: oneOf(json, "status", REQUIREMENT_STATUSES), replayed: bool(json, "replayed") };
}

// ----------------------------------------------------------------------------- requests (ids are checked BEFORE they reach a path)
function checked(...ids: string[]): void {
  for (const id of ids) if (!isCanonicalUuid(id)) throw new ApiContractError("id");
}
const base = (tenantId: string) => `/v1/tenants/${tenantId}`;
const post = (body?: unknown): RequestInit => ({ method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export interface CaptureInput {
  id: string;
  channel: Channel;
  receivedAt: string;
  subject: string | null;
  text: string;
}

export async function captureEnquiry(accessToken: string, tenantId: string, leadId: string, input: CaptureInput): Promise<Captured> {
  checked(tenantId, leadId, input.id);
  return parseCaptured(
    await apiRequest(
      `${base(tenantId)}/leads/${leadId}/enquiries`,
      accessToken,
      post({ id: input.id, channel: input.channel, received_at: input.receivedAt, ...(input.subject ? { subject: input.subject } : {}), text: input.text }),
    ),
  );
}

export async function fetchLeadEnquiries(accessToken: string, tenantId: string, leadId: string): Promise<Enquiry[]> {
  checked(tenantId, leadId);
  return list(await apiRequest(`${base(tenantId)}/leads/${leadId}/enquiries`, accessToken), "enquiries").map(parseEnquiry);
}

export async function fetchEnquiry(accessToken: string, tenantId: string, enquiryId: string): Promise<Enquiry> {
  checked(tenantId, enquiryId);
  return parseEnquiry(await apiRequest(`${base(tenantId)}/enquiries/${enquiryId}`, accessToken));
}

export async function fetchRequirement(accessToken: string, tenantId: string, enquiryId: string): Promise<RequirementView> {
  checked(tenantId, enquiryId);
  return parseRequirementView(await apiRequest(`${base(tenantId)}/enquiries/${enquiryId}/requirement`, accessToken));
}

export async function startRequirementRun(accessToken: string, tenantId: string, input: { id: string; enquiryId: string }): Promise<RunOut> {
  checked(tenantId, input.id, input.enquiryId);
  return parseRun(
    await apiRequest(
      `${base(tenantId)}/agent-runs`,
      accessToken,
      post({ id: input.id, agent: "requirement", target_kind: "enquiry", target_id: input.enquiryId }),
    ),
  );
}

export type DecisionInput = { decision: "confirm" | "reject" } | { decision: "correct"; value: string };

export async function decideField(accessToken: string, tenantId: string, fieldId: string, input: DecisionInput): Promise<FieldDecision> {
  checked(tenantId, fieldId);
  return parseFieldDecision(await apiRequest(`${base(tenantId)}/requirement-fields/${fieldId}/decision`, accessToken, post(input)));
}

export interface AddFieldInput {
  line: number | null;
  field: FieldKey;
  value: string;
  quote: string | null;
}

export async function addField(accessToken: string, tenantId: string, enquiryId: string, input: AddFieldInput): Promise<FieldAdded> {
  checked(tenantId, enquiryId);
  return parseFieldAdded(
    await apiRequest(
      `${base(tenantId)}/enquiries/${enquiryId}/requirement-fields`,
      accessToken,
      post({ ...(input.line === null ? {} : { line: input.line }), field: input.field, value: input.value, ...(input.quote ? { quote: input.quote } : {}) }),
    ),
  );
}

export async function confirmRequirement(accessToken: string, tenantId: string, requirementId: string): Promise<RequirementAction> {
  checked(tenantId, requirementId);
  return parseRequirementAction(await apiRequest(`${base(tenantId)}/requirements/${requirementId}/confirm`, accessToken, post()));
}

export async function discardRequirement(accessToken: string, tenantId: string, requirementId: string): Promise<RequirementAction> {
  checked(tenantId, requirementId);
  return parseRequirementAction(await apiRequest(`${base(tenantId)}/requirements/${requirementId}/discard`, accessToken, post()));
}
