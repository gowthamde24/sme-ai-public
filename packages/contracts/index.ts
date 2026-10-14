/** Mirrors health.schema.json. The JSON schema is the source of truth. */
export interface HealthResponse {
  status: "ok";
  service: string;
  version: string;
  environment: string;
}

/** Mirrors tenancy.schema.json (T002). The JSON schema is the source of truth. */
export type Role = "owner" | "admin" | "sales" | "viewer";

/** Every error the API sends (job CD): one shape for 401/403/404/409/422/429/5xx, from every router and the middleware. `retry_after` is whole seconds (also the Retry-After header) and null when waiting does not help;
 * `request_id` is the response's x-request-id; `fields` (422) are field NAMES only. The new fields are optional here so older mocks still type-check; the API always sends them. */
export interface ApiError {
  error: {
    code: string;
    message: string;
    retry_after?: number | null;
    request_id?: string | null;
    fields?: string[];
    reason?: string;
    until?: string;
  };
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
}

export interface TenantDetail extends Tenant {
  role: Role;
}

/** GET /v1/tenants/{id}: the tenant, the caller's role, and the plan (job AD / D1). Read-only for clients. */
export interface TenantWithPlan extends TenantDetail {
  plan: "free_trial";
  workspace_limit: number;
  /** ISO 8601 */
  trial_started_at: string;
}

/** GET /v1/account/setup (job AD / D2): what a new account still has to do. `needed` carries the business name typed at sign-up. */
export interface AccountSetup {
  state: "none" | "needed" | "done";
  tenant_id: string | null;
  business_name: string | null;
}

/** POST /v1/account/setup body is exactly { business_type: string, language: "en" | "te" | "hi" | "kn", accepted_terms_version?: string, accepted_privacy_version?: string }.
 * `business_type` is a pack id from GET /v1/packs (job CK): sign-up asks the business type and nothing else. A type that is not selectable is a 422 `business_type_unavailable`. */
export interface AccountSetupResult {
  tenant_id: string;
  /** false for a repeat (double click, second tab): the same business, nothing new */
  created: boolean;
}

export interface Me {
  user_id: string;
  memberships: { tenant: Tenant; role: Role }[];
}

export interface MemberList {
  members: { user_id: string; role: Role; display_name: string | null }[];
}

export interface AuditEvent {
  id: number;
  actor_user_id: string | null;
  actor_type: "user" | "system" | "agent";
  action: string;
  entity_type: string;
  entity_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  request_id: string | null;
  created_at: string;
}

export interface AuditEventList {
  events: AuditEvent[];
  /** Pass as ?before_id= for the next (older) page; null when there is no more. */
  next_before_id: number | null;
}

/** CRM contracts (T003): generated from the API models by `make contracts`. */
export * from "./crm";

/** Evidence contracts (T004): generated from the API models by `make contracts`. url, reference and
 * snippet are UNTRUSTED text: render as plain text only, never as a link. */
export * from "./evidence";

/** Leads contracts (T005): generated from the API models by `make contracts`. */
export * from "./leads";

/** Agent-run contracts (T006): generated from the API models by `make contracts`. An agent claim is a
 * SUGGESTION until a human accepts it; claim values are UNTRUSTED text: render as plain text only. */
export * from "./agents";

/** Erasure contracts (T006b, ADR 0014): generated from the API models by `make contracts`. A result holds counts
 * per column and row ids for manual review, never a value. */
export * from "./erasure";

/** Packs, modules, custom fields, example data and sign-up provider contracts (job CK, ADR 0084 parts 1 and 2): generated from the API models by `make contracts`.
 * A pack is DATA: render words from `labels` and gate screens on `modules`; never branch on a pack id. */
export * from "./packs";
export * from "./materials";
