import type {
  CompanyCreate,
  CompanyOut,
  ContactOut,
  LeadOut,
  OpportunityOut,
  ProductOut,
} from "@contracts";

import { ApiContractError, apiRequest } from "./client";

/**
 * Server-side client for the CRM endpoints of OUR API (never PostgREST). Runs on the server with the
 * signed-in user's own token. Responses are validated, not trusted: the fields the page shows must
 * have the contracted shape, otherwise ApiContractError (the page then shows an error, not data).
 *
 * Types come from packages/contracts/crm.ts (generated from the API models).
 */
export const ENTITY_KEYS = [
  "companies",
  "contacts",
  "products",
  "leads",
  "opportunities",
] as const;
export type EntityKey = (typeof ENTITY_KEYS)[number];

export type CompanyRow = Pick<
  CompanyOut,
  | "id"
  | "name"
  | "type"
  | "website"
  | "country"
  | "city"
  | "industry"
  | "created_via"
  | "created_at"
>;
export type ContactRow = Pick<
  ContactOut,
  | "id"
  | "full_name"
  | "email"
  | "phone"
  | "job_title"
  | "email_consent"
  | "whatsapp_consent"
  | "phone_consent"
  | "suppression_reason"
  | "created_via"
>;
export type ProductRow = Pick<
  ProductOut,
  "id" | "sku" | "name" | "unit" | "category" | "active" | "created_via"
>;
export type LeadRow = Pick<
  LeadOut,
  "id" | "status" | "source" | "created_via" | "created_at"
>;
export type OpportunityRow = Pick<
  OpportunityOut,
  "id" | "title" | "status" | "closed_at" | "created_via" | "created_at"
>;

export type CrmPage =
  | { entity: "companies"; items: CompanyRow[]; nextCursor: string | null }
  | { entity: "contacts"; items: ContactRow[]; nextCursor: string | null }
  | { entity: "products"; items: ProductRow[]; nextCursor: string | null }
  | { entity: "leads"; items: LeadRow[]; nextCursor: string | null }
  | {
      entity: "opportunities";
      items: OpportunityRow[];
      nextCursor: string | null;
    };

export const PAGE_SIZE = 25;
const CANONICAL_UUID =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isCanonicalUuid(value: string): boolean {
  return CANONICAL_UUID.test(value);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function bad(what: string): never {
  throw new ApiContractError(`Unexpected ${what} in a CRM response.`);
}

function str(r: Record<string, unknown>, key: string): string {
  const v = r[key];
  return typeof v === "string" ? v : bad(key);
}
function strOrNull(r: Record<string, unknown>, key: string): string | null {
  const v = r[key];
  return v === null ? null : typeof v === "string" ? v : bad(key);
}
function bool(r: Record<string, unknown>, key: string): boolean {
  const v = r[key];
  return typeof v === "boolean" ? v : bad(key);
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
function oneOfOrNull<T extends string>(
  r: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
): T | null {
  return r[key] === null ? null : oneOf(r, key, allowed);
}

const ORIGINS = ["manual", "import", "agent"] as const;
const CONSENT = ["unknown", "granted", "withdrawn"] as const;

const ROW_PARSERS: Record<EntityKey, (r: Record<string, unknown>) => unknown> =
  {
    companies: (r): CompanyRow => ({
      id: str(r, "id"),
      name: str(r, "name"),
      type: oneOf(r, "type", ["prospect", "customer", "supplier", "other"]),
      website: strOrNull(r, "website"),
      country: strOrNull(r, "country"),
      city: strOrNull(r, "city"),
      industry: strOrNull(r, "industry"),
      created_via: oneOf(r, "created_via", ORIGINS),
      created_at: str(r, "created_at"),
    }),
    contacts: (r): ContactRow => ({
      id: str(r, "id"),
      full_name: str(r, "full_name"),
      email: strOrNull(r, "email"),
      phone: strOrNull(r, "phone"),
      job_title: strOrNull(r, "job_title"),
      email_consent: oneOf(r, "email_consent", CONSENT),
      whatsapp_consent: oneOf(r, "whatsapp_consent", CONSENT),
      phone_consent: oneOf(r, "phone_consent", CONSENT),
      suppression_reason: oneOfOrNull(r, "suppression_reason", [
        "opted_out",
        "bounced",
        "complained",
        "legal",
        "manual",
      ]),
      created_via: oneOf(r, "created_via", ORIGINS),
    }),
    products: (r): ProductRow => ({
      id: str(r, "id"),
      sku: str(r, "sku"),
      name: str(r, "name"),
      unit: strOrNull(r, "unit"),
      category: strOrNull(r, "category"),
      active: bool(r, "active"),
      created_via: oneOf(r, "created_via", ORIGINS),
    }),
    leads: (r): LeadRow => ({
      id: str(r, "id"),
      status: oneOf(r, "status", [
        "new",
        "in_review",
        "qualified",
        "disqualified",
      ]),
      source: strOrNull(r, "source"),
      created_via: oneOf(r, "created_via", ORIGINS),
      created_at: str(r, "created_at"),
    }),
    opportunities: (r): OpportunityRow => ({
      id: str(r, "id"),
      title: str(r, "title"),
      status: oneOf(r, "status", ["open", "won", "lost"]),
      closed_at: strOrNull(r, "closed_at"),
      created_via: oneOf(r, "created_via", ORIGINS),
      created_at: str(r, "created_at"),
    }),
  };

export function parsePage(entity: EntityKey, json: unknown): CrmPage {
  if (!isRecord(json) || !Array.isArray(json.items)) bad("page");
  const parse = ROW_PARSERS[entity];
  const items = json.items.map((row: unknown) =>
    isRecord(row) ? parse(row) : bad("row"),
  );
  const next = json.next_cursor;
  if (next !== null && typeof next !== "string") bad("cursor");
  return { entity, items, nextCursor: next } as CrmPage;
}

/** One page of one entity for a tenant. `cursor` is the opaque value the API issued (not PII). */
export async function fetchPage(
  accessToken: string,
  tenantId: string,
  entity: EntityKey,
  cursor?: string | null,
): Promise<CrmPage> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("tenant id");
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) query.set("cursor", cursor);
  const json = await apiRequest(
    `/v1/tenants/${tenantId}/${entity}?${query.toString()}`,
    accessToken,
  );
  return parsePage(entity, json);
}

export type CreateCompanyInput = Pick<
  CompanyCreate,
  "id" | "name" | "type" | "website" | "country" | "city" | "industry"
>;

/** Idempotent on `input.id`: the API answers 200 with the same row for an identical retry. */
export async function createCompany(
  accessToken: string,
  tenantId: string,
  input: CreateCompanyInput,
): Promise<void> {
  if (!isCanonicalUuid(tenantId)) throw new ApiContractError("tenant id");
  await apiRequest(`/v1/tenants/${tenantId}/companies`, accessToken, {
    method: "POST",
    body: JSON.stringify(input),
  });
}
