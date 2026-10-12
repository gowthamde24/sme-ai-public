import { apiRequest } from "./client";
import { isCanonicalUuid } from "./crm";
import { bad, bool, int, iso, list, oneOf, optInt, optIso, optStr, rec, str, uuid } from "./shape";

/**
 * The team (job CC, screen 4; ADR 0077, the contract is in job BY's report): who is in the business, who is invited, and the few things the Owner and Admin do about it. Server side only, with the person's own token.
 * An invitation's code is shown ONCE, when it is made (the API keeps only a hash): it is returned to the page that asked and never stored, logged or put in an address by us. There is no way to invite or promote an Owner here.
 */
export const ROLES = ["owner", "admin", "sales", "viewer"] as const;
export type MemberRole = (typeof ROLES)[number];
export const INVITED_ROLES = ["admin", "sales", "viewer"] as const;
export type InvitedRole = (typeof INVITED_ROLES)[number];
export const REMOVE_REASONS = ["left", "role_changed", "no_longer_works_here", "access_no_longer_needed", "security_concern", "other"] as const;
export type RemoveReason = (typeof REMOVE_REASONS)[number];
export const INVITATION_STATUSES = ["pending", "accepted", "revoked", "expired"] as const;

export interface Member {
  user_id: string;
  display_name: string | null;
  role: MemberRole;
  joined_at: string | null;
  is_you: boolean;
}
export interface Team {
  members: Member[];
  /** null for a salesperson or a viewer, who may not see the invitations. */
  pending_invitations: number | null;
}
export interface Invitation {
  id: string;
  role: InvitedRole;
  label: string | null;
  status: (typeof INVITATION_STATUSES)[number];
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_by_name: string | null;
}
/** What `POST /invitations` answers: the invitation, and its code the first time only (`code: null` and `replayed: true` for a retry of the same id: the code cannot be read again). */
export interface NewInvitation extends Omit<Invitation, "created_by_name"> {
  code: string | null;
  replayed: boolean;
}
export interface Joined {
  tenant_id: string;
  tenant_name: string;
  role: MemberRole;
}

export function parseTeam(json: unknown): Team {
  const x = rec(json, "team");
  return {
    members: list(x.members, "members", 500).map((m) => {
      const r = rec(m, "member");
      return { user_id: uuid(r.user_id, "user_id"), display_name: optStr(r.display_name, "display_name", 200), role: oneOf(r.role, ROLES, "role"), joined_at: optIso(r.joined_at, "joined_at"), is_you: bool(r.is_you, "is_you") };
    }),
    pending_invitations: optInt(x.pending_invitations, "pending_invitations", 0, 1000),
  };
}
function invitation(json: unknown): Omit<Invitation, "created_by_name"> {
  const r = rec(json, "invitation");
  return {
    id: uuid(r.id, "id"),
    role: oneOf(r.role, INVITED_ROLES, "role"),
    label: optStr(r.label, "label", 100),
    status: oneOf(r.status, INVITATION_STATUSES, "status"),
    created_at: iso(r.created_at, "created_at"),
    expires_at: iso(r.expires_at, "expires_at"),
    accepted_at: optIso(r.accepted_at, "accepted_at"),
    revoked_at: optIso(r.revoked_at, "revoked_at"),
  };
}
export const parseInvitations = (json: unknown): Invitation[] => list(rec(json, "invitations").invitations, "invitations", 200).map((i) => ({ ...invitation(i), created_by_name: optStr(rec(i, "invitation").created_by_name, "created_by_name", 200) }));
const CODE = /^[A-Za-z0-9-]{8,80}$/;
export function parseNewInvitation(json: unknown): NewInvitation {
  const r = rec(rec(json, "invitation").invitation, "invitation");
  const code = r.code === null || r.code === undefined ? null : str(r.code, "code", 100);
  if (code !== null && !CODE.test(code)) bad("code");
  return { ...invitation(r), code, replayed: bool(r.replayed, "replayed") };
}
export function parseJoined(json: unknown): Joined {
  const r = rec(json, "joined");
  if (r.status !== "joined") bad("status");
  return { tenant_id: uuid(r.tenant_id, "tenant_id"), tenant_name: str(r.tenant_name, "tenant_name", 200), role: oneOf(r.role, ROLES, "role") };
}

const base = (tenantId: string): string => {
  if (!isCanonicalUuid(tenantId)) bad("workspace id");
  return `/v1/tenants/${tenantId}`;
};
const id = (v: string): string => (isCanonicalUuid(v) ? v : bad("id"));
const post = (path: string, token: string, body?: unknown) => apiRequest(path, token, { method: "POST", ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });

export async function getTeam(token: string, tenantId: string): Promise<Team> {
  return parseTeam(await apiRequest(`${base(tenantId)}/team`, token));
}
export async function listInvitations(token: string, tenantId: string): Promise<Invitation[]> {
  return parseInvitations(await apiRequest(`${base(tenantId)}/invitations`, token));
}
/** Owner or Admin with the second factor. An Admin may invite Sales and Viewer only (the API says 403 role_not_allowed otherwise). */
export async function createInvitation(token: string, tenantId: string, input: { invitationId: string; role: string; days: number; label?: string }): Promise<NewInvitation> {
  const body: Record<string, unknown> = { invitation_id: id(input.invitationId), role: oneOf(input.role, INVITED_ROLES, "role"), days: int(input.days, "days", 1, 30) };
  if (input.label && input.label.trim()) body.label = input.label.trim();
  return parseNewInvitation(await post(`${base(tenantId)}/invitations`, token, body));
}
export async function revokeInvitation(token: string, tenantId: string, invitationId: string): Promise<Invitation> {
  const r = rec(await post(`${base(tenantId)}/invitations/${id(invitationId)}/revoke`, token), "revoke");
  return { ...invitation(r.invitation), created_by_name: null };
}
export interface RoleChange {
  user_id: string;
  role: InvitedRole;
  changed: boolean;
}
export async function changeRole(token: string, tenantId: string, userId: string, role: string): Promise<RoleChange> {
  const r = rec(await post(`${base(tenantId)}/members/${id(userId)}/role`, token, { role: oneOf(role, INVITED_ROLES, "role"), reason: "role_changed" }), "role");
  return { user_id: uuid(r.user_id, "user_id"), role: oneOf(r.role, INVITED_ROLES, "role"), changed: bool(r.changed, "changed") };
}
export interface Removed {
  user_id: string;
  leads_unassigned: number;
  opportunities_unassigned: number;
  runs_cancelled: number;
  invitations_revoked: number;
}
/** Leaving is the person's own (`reason: "left"`, their own id, no second factor); removing another needs Owner or Admin with the second factor. The answer is counts only. */
export async function removeMember(token: string, tenantId: string, userId: string, reason: string): Promise<Removed> {
  const r = rec(await post(`${base(tenantId)}/members/${id(userId)}/remove`, token, { reason: oneOf(reason, REMOVE_REASONS, "reason") }), "removed");
  if (r.removed !== true) bad("removed");
  return { user_id: uuid(r.user_id, "user_id"), leads_unassigned: int(r.leads_unassigned ?? 0, "leads_unassigned"), opportunities_unassigned: int(r.opportunities_unassigned ?? 0, "opportunities_unassigned"), runs_cancelled: int(r.runs_cancelled ?? 0, "runs_cancelled"), invitations_revoked: int(r.invitations_revoked ?? 0, "invitations_revoked") };
}
/** Any signed-in person. The code is sent as typed: the API forgives case, spaces, hyphens and O/0, I/L/1. A wrong, used or expired code is one answer (400 invitation_invalid). */
export async function acceptInvitation(token: string, code: string): Promise<Joined> {
  return parseJoined(await post("/v1/invitations/accept", token, { code: str(code, "code", 100) }));
}

