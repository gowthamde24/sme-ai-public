/**
 * The registration (KYC) of the business's phone number: what the browser, the route and the page share (C1's contract: services/ai-api/app/phone_kyc). No server import here, so a client part may use it.
 * ONE of three documents is enough (owner 14 Nov 2026); the API's `options` say which are offered. The document passes through our server in memory only and is never stored.
 */
export const DOC_KINDS = ["gst", "coi", "udyam"] as const;
export type DocKind = (typeof DOC_KINDS)[number];
/** The API's `Status` values. */
export const KYC_STATES = ["not_started", "preparing", "submitted", "accepted", "rejected", "suspended", "expired", "failed"] as const;
export type KycState = (typeof KYC_STATES)[number];
export const FILE_TYPES = ["application/pdf", "image/jpeg", "image/png"] as const;
export type FileType = (typeof FILE_TYPES)[number];
/** Plivo's own limit per file (the API's `max_file_bytes` is what the screen uses; this is the ceiling the route enforces whatever the browser says). */
export const MAX_FILE_BYTES = 5_000_000;
/** A 5 MB file as base64, plus a little room for the JSON around it. */
export const MAX_BODY_BYTES = 7_400_000;

export interface KycStatus {
  state: KycState;
  kycId: string | null;
  docKind: DocKind | null;
  complianceId: string | null;
  /** The phone company's own words for a rejection (Owner and Admin only); shown as text, never as markup. */
  reason: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  checkedAt: string | null;
  /** false = test mode: a filing is checked and answered but nothing is sent to the phone company. */
  live: boolean;
  /** true once the phone company accepted the registration: a number can be chosen next. */
  canChooseNumber: boolean;
}
export interface KycDocOption {
  kind: DocKind;
  numberLabel: string;
  numberExample: string;
}
export interface KycOptions {
  live: boolean;
  documents: KycDocOption[];
  maxFileBytes: number;
  fileTypes: FileType[];
  keptNote: string;
}

/** The states in which the person can send (or send again). Being checked and approved are not: a second filing would only confuse. */
export const CAN_SEND: ReadonlySet<KycState> = new Set<KycState>(["not_started", "rejected", "failed", "suspended", "expired"]);

/** What the number printed on each document looks like (the API checks it too; the browser only saves a round trip). Spaces are ignored and letters are upper-cased, as the API does. */
export const NUMBER_SHAPE: Record<DocKind, RegExp> = {
  gst: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/,
  udyam: /^UDYAM-[A-Z]{2}-[0-9]{2}-[0-9]{7}$/,
  coi: /^([LU][0-9]{5}[A-Z]{2}[0-9]{4}[A-Z]{3}[0-9]{6}|[A-Z]{3}-[0-9]{4})$/,
};
export const normalNumber = (s: string): string => s.toUpperCase().replace(/\s+/g, "");
export const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,120}\.[A-Za-z]{2,}$/;
export const POSTAL = /^[1-9][0-9]{5}$/;
export const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
/** The bytes a base64 string stands for. */
export const b64Bytes = (s: string): number => Math.floor((s.length * 3) / 4) - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0);

export interface KycDocument {
  name: string;
  content_type: FileType;
  data_base64: string;
}
/** The body the browser sends to our route (and the route sends on): the API's `KycIn`. */
export interface KycBody {
  kyc_id: string;
  doc_kind: DocKind;
  legal_name: string;
  registration_number: string;
  email: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  document: KycDocument;
}

export type FieldProblem = "number" | "legal" | "email" | "addr1" | "addr2" | "city" | "state" | "postal" | "file";
const len = (s: string, min: number, max: number): boolean => s.trim().length >= min && s.trim().length <= max;

/** The first problem of each typed field, in the order they are drawn (an empty object = good to send). The file is checked on its own (kind, size) when it is chosen. */
export function fieldProblems(f: { docKind: DocKind; number: string; legal: string; email: string; addr1: string; addr2: string; city: string; state: string; postal: string }): Partial<Record<FieldProblem, true>> {
  const out: Partial<Record<FieldProblem, true>> = {};
  if (!NUMBER_SHAPE[f.docKind].test(normalNumber(f.number))) out.number = true;
  if (!len(f.legal, 2, 100)) out.legal = true;
  if (!len(f.email, 5, 120) || !EMAIL.test(f.email.trim())) out.email = true;
  if (!len(f.addr1, 3, 120)) out.addr1 = true;
  if (f.addr2.trim().length > 120) out.addr2 = true;
  if (!len(f.city, 2, 60)) out.city = true;
  if (!len(f.state, 2, 60)) out.state = true;
  if (!POSTAL.test(f.postal.trim())) out.postal = true;
  return out;
}

/** The kind of file by what the browser says it is, else by its ending (a phone's gallery sometimes sends no type). null = not one of the three. */
export function fileTypeOf(name: string, type: string): FileType | null {
  const t = type.toLowerCase();
  if ((FILE_TYPES as readonly string[]).includes(t)) return t as FileType;
  if (t === "image/jpg" || t === "image/pjpeg") return "image/jpeg";
  if (t !== "" && t !== "application/octet-stream") return null;
  const ext = /\.([A-Za-z0-9]{1,5})$/.exec(name)?.[1]?.toLowerCase();
  return ext === "pdf" ? "application/pdf" : ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "png" ? "image/png" : null;
}

/** The codes of a refusal that mean "this exact filing will not work as it is": the next try is a NEW attempt (a new kyc_id). Anything else (the phone company did not answer, no network) is the same attempt again, so it files once. */
export const DEFINITE_REFUSALS: ReadonlySet<string> = new Set(["kyc_file_too_large", "kyc_file_type", "kyc_file_unreadable", "kyc_not_accepted", "kyc_document_not_offered", "kyc_field_not_supported"]);

/** A refusal as our route reports it (the sentence is already in the person's language). */
export interface KycFailed {
  ok: false;
  kind: "forbidden" | "mfa" | "rate_limited" | "too_big" | "invalid" | "not_found" | "conflict" | "unavailable" | "other";
  error: string;
  code?: string;
  /** The phone company's own words for not accepting the filing (a short text). */
  reason?: string;
  retryAfter?: number;
  mfa?: boolean;
}
export type KycReply = { ok: true; data: KycStatus } | KycFailed;
