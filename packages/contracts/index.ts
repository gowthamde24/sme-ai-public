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
