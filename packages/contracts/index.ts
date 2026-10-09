/** Mirrors health.schema.json. The JSON schema is the source of truth. */
export interface HealthResponse {
  status: "ok";
  service: string;
  version: string;
  environment: string;
}

/** Mirrors tenancy.schema.json (T002). The JSON schema is the source of truth. */
export type Role = "owner" | "admin" | "sales" | "viewer";

export interface ApiError {
  error: { code: string; message: string };
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

/** POST /v1/account/setup body is exactly { business_type: "textiles" | "construction" | "other", language: "en" | "te" | "hi" | "kn" }. */
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
