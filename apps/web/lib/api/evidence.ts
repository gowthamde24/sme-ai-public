import type { EvidenceKind } from "@contracts";

import { ApiContractError, apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";

/**
 * Server-side client for the evidence endpoints of OUR API (T004, ADR 0008 / 0009).
 *
 * Evidence is UNTRUSTED text. This module parses and validates it, and nothing in the web app may
 * fetch, follow, link to, preview or interpret it: it is rendered as plain text only (a guard test
 * enforces that). Types come from packages/contracts/evidence.ts (generated from the API models).
 */
export const EVIDENCE_KINDS = [
  "web_page",
  "document",
  "email",
  "listing",
  "registry",
  "note",
] as const satisfies readonly EvidenceKind[];

// Compile-time check: every kind the API knows is offered (adding one to the contract fails here).
type MissingKinds = Exclude<EvidenceKind, (typeof EVIDENCE_KINDS)[number]>;
export const KINDS_ARE_EXHAUSTIVE: [MissingKinds] extends [never]
  ? true
  : never = true;

export const KIND_LABELS: Record<(typeof EVIDENCE_KINDS)[number], string> = {
  web_page: "Web page",
  document: "Document",
  email: "Email",
  listing: "Listing",
  registry: "Registry",
  note: "Note",
};

export type EvidenceTarget = "companies" | "leads";
const ORIGINS = ["manual", "import", "agent"] as const;
export const EVIDENCE_PAGE_SIZE = 25;

/** What the page shows for one piece of evidence. Every string is untrusted text. */
export type EvidenceItem = {
  linkId: string;
  kind: (typeof EVIDENCE_KINDS)[number];
  provider: string;
  url: string | null;
  reference: string | null;
  snippet: string | null;
  retrievedAt: string;
  publishedAt: string | null;
  createdVia: (typeof ORIGINS)[number];
};
export type EvidencePage = { items: EvidenceItem[]; nextCursor: string | null };

// ----------------------------------------------------------------------------- parsing
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in an evidence response.`);
}
function str(r: Record<string, unknown>, key: string): string {
  const v = r[key];
  return typeof v === "string" ? v : bad(key);
}
function strOrNull(r: Record<string, unknown>, key: string): string | null {
  const v = r[key];
  return v === null ? null : typeof v === "string" ? v : bad(key);
}
function oneOf<T extends string>(
  r: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T {
  const v = r[key];
  return typeof v === "string" && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : bad(key);
}

export function parseEvidencePage(json: unknown): EvidencePage {
  if (!isRecord(json) || !Array.isArray(json.items)) bad("page");
  const items = json.items.map((link: unknown): EvidenceItem => {
    if (!isRecord(link) || !isRecord(link.evidence)) return bad("item");
    const e = link.evidence;
    return {
      linkId: str(link, "id"),
      kind: oneOf(e, "kind", EVIDENCE_KINDS),
      provider: str(e, "provider"),
      url: strOrNull(e, "url"),
      reference: strOrNull(e, "reference"),
      snippet: strOrNull(e, "snippet"),
      retrievedAt: str(e, "retrieved_at"),
      publishedAt: strOrNull(e, "published_at"),
      createdVia: oneOf(e, "created_via", ORIGINS),
    };
  });
  const next = json.next_cursor;
  if (next !== null && typeof next !== "string") bad("cursor");
  return { items, nextCursor: next };
}

/** One page of the evidence attached to a company or a lead. `cursor` is the API's opaque value. */
export async function fetchEvidencePage(
  accessToken: string,
  tenantId: string,
  target: EvidenceTarget,
  targetId: string,
  cursor?: string | null,
): Promise<EvidencePage> {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(targetId))
    throw new ApiContractError("id");
  const query = new URLSearchParams({ limit: String(EVIDENCE_PAGE_SIZE) });
  if (cursor) query.set("cursor", cursor);
  const json = await apiRequest(
    `/v1/tenants/${tenantId}/${target}/${targetId}/evidence?${query.toString()}`,
    accessToken,
  );
  return parseEvidencePage(json);
}

export type CreateEvidenceInput = {
  id: string;
  kind: (typeof EVIDENCE_KINDS)[number];
  url?: string;
  reference?: string;
  snippet?: string;
  published_at?: string;
};

/** Idempotent on `input.id`: the API answers 200 with the same item for an identical retry. */
export async function createEvidence(
  accessToken: string,
  tenantId: string,
  target: EvidenceTarget,
  targetId: string,
  input: CreateEvidenceInput,
): Promise<void> {
  if (!isCanonicalUuid(tenantId) || !isCanonicalUuid(targetId))
    throw new ApiContractError("id");
  await apiRequest(
    `/v1/tenants/${tenantId}/${target}/${targetId}/evidence`,
    accessToken,
    { method: "POST", body: JSON.stringify(input) },
  );
}

// ----------------------------------------------------------------------------- validation
// The same character set as the database function app.text_is_clean (and the API mirror): C0
// controls except tab / LF / CR, DEL and C1 controls, zero-width space, line / paragraph separators,
// bidi embeddings, overrides and isolates, word joiner and invisible operators, BOM, tag characters.
// ZWNJ / ZWJ (U+200C / U+200D) and LRM / RLM stay legal. The API and the database remain the
// authority; this only fails early with a short message.
const BLOCKED = new RegExp(
  "[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f\\u200b\\u2028\\u2029\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff\\u{e0000}-\\u{e007f}]",
  "u",
);
export function isCleanText(value: string): boolean {
  return !BLOCKED.test(value);
}

const URL_PATTERN = /^https?:\/\/[^/?#@\s<>"'\\]+([/?#][^\s<>"'\\]*)?$/i;
// "<kind>:<token>", the same typed reference as consent evidence (lower-case kind of 2-20 chars).
const REFERENCE_PATTERN = /^[a-z][a-z0-9_-]{1,19}:[A-Za-z0-9._#/-]{1,96}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type EvidenceFormValues = {
  kind: string;
  url: string;
  reference: string;
  snippet: string;
  publishedDate: string;
};

/** Returns a short, value-free message for the first problem, or the API input (minus the id). */
export function validateEvidenceForm(
  v: EvidenceFormValues,
  now: Date = new Date(),
): { error: string } | { value: Omit<CreateEvidenceInput, "id"> } {
  if (!(EVIDENCE_KINDS as readonly string[]).includes(v.kind))
    return { error: "Choose what kind of evidence this is." };
  if (!v.url && !v.reference)
    return { error: "Enter a URL or a reference (at least one)." };
  if (v.url) {
    if (v.url.length < 8 || v.url.length > 2048 || !URL_PATTERN.test(v.url))
      return {
        error:
          "Enter a URL that starts with http:// or https:// (up to 2048 characters, no spaces).",
      };
  }
  if (v.reference && !REFERENCE_PATTERN.test(v.reference))
    return {
      error:
        "Use a reference like doc:invoice-12 (a lower-case prefix, a colon, then letters, digits or . _ # / -).",
    };
  if (v.snippet.length > 1000)
    return { error: "The snippet is too long (up to 1000 characters)." };
  if (![v.url, v.reference, v.snippet].every(isCleanText))
    return {
      error: "The text contains invisible or control characters. Remove them.",
    };
  let published: string | undefined;
  if (v.publishedDate) {
    if (!DATE_PATTERN.test(v.publishedDate))
      return { error: "Enter the published date as a date." };
    const at = new Date(`${v.publishedDate}T00:00:00Z`);
    if (Number.isNaN(at.getTime()))
      return { error: "Enter the published date as a date." };
    if (at.getTime() > now.getTime())
      return { error: "The published date cannot be in the future." };
    published = `${v.publishedDate}T00:00:00Z`;
  }
  return {
    value: {
      kind: v.kind as (typeof EVIDENCE_KINDS)[number],
      ...(v.url && { url: v.url }),
      ...(v.reference && { reference: v.reference }),
      ...(v.snippet && { snippet: v.snippet }),
      ...(published && { published_at: published }),
    },
  };
}
