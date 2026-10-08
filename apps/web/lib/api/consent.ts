import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Server-side call of OUR API that records one consent entry for one contact and one channel (T003). It writes down what a person says; the API and the database decide who may, and nothing here
 * judges whether it is enough. The answer is read for the three consent states only: a phone number or an address in it is never read.
 */
export const CHANNELS = ["whatsapp", "phone", "email"] as const;
export type ConsentChannel = (typeof CHANNELS)[number];
export const CHANNEL_LABELS: Record<ConsentChannel, string> = { whatsapp: "WhatsApp", phone: "Phone call", email: "E-mail" };

export const STATUSES = ["granted", "withdrawn"] as const;
export type RecordedStatus = (typeof STATUSES)[number];
export const STATUS_LABELS: Record<RecordedStatus | "unknown", string> = { granted: "Granted", withdrawn: "Withdrawn", unknown: "Nothing recorded" };

/** The API's own four words. */
export const BASES = ["explicit_consent", "contractual", "legitimate_use", "other"] as const;
export type Basis = (typeof BASES)[number];
export const BASIS_LABELS: Record<Basis, string> = { explicit_consent: "Explicit consent", contractual: "Contractual", legitimate_use: "Legitimate use", other: "Other" };

/** The kinds of evidence a person can name (the API also knows `imported`, which is for imports). */
export const EVIDENCE_KINDS = ["verbal", "written", "email_reply", "web_form", "other"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];
export const EVIDENCE_LABELS: Record<EvidenceKind, string> = { verbal: "Spoken (a call or in person)", written: "Written (a message)", email_reply: "E-mail reply", web_form: "Web form", other: "Other" };

/** A short label of the person's own: letters, digits and . _ # / - only (the API and the database refuse anything else). */
export const EVIDENCE_LABEL_PATTERN = /^[A-Za-z0-9._#/-]{1,96}$/;

export type ConsentInput = { channel: ConsentChannel; status: "withdrawn" } | { channel: ConsentChannel; status: "granted"; basis: Basis; evidenceKind: EvidenceKind; evidenceLabel: string };
export type ConsentState = "unknown" | "granted" | "withdrawn";
export type Consents = Record<ConsentChannel, ConsentState>;

const STATES: readonly ConsentState[] = ["unknown", "granted", "withdrawn"];
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
function state(contact: Record<string, unknown>, key: string): ConsentState {
  const v = contact[key];
  if (typeof v !== "string" || !(STATES as readonly string[]).includes(v)) throw new ApiContractError("Unexpected consent state in a response.");
  return v as ConsentState;
}

export function parseConsents(json: unknown): Consents {
  if (!isRecord(json) || !isRecord(json.contact)) throw new ApiContractError("Unexpected consent response.");
  return { whatsapp: state(json.contact, "whatsapp_consent"), phone: state(json.contact, "phone_consent"), email: state(json.contact, "email_consent") };
}

/** Owner, Admin or Sales; no second factor (the API decides). `granted` needs a basis and evidence; the reference is `kind:label`. */
export async function recordConsent(accessToken: string, tenantId: string, contactId: string, input: ConsentInput): Promise<Consents> {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(contactId)) throw new ApiContractError("id");
  const body =
    input.status === "granted"
      ? { channel: input.channel, status: "granted", basis: input.basis, evidence_type: input.evidenceKind, evidence_ref: `${input.evidenceKind}:${input.evidenceLabel}` }
      : { channel: input.channel, status: "withdrawn" };
  return parseConsents(await apiRequest(`/v1/tenants/${tenantId}/contacts/${contactId}/record-consent`, accessToken, { method: "POST", body: JSON.stringify(body) }));
}
