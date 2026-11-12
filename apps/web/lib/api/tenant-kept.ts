import { createHash } from "node:crypto";

import type { TenantDetail } from "@contracts";

import { fetchTenant } from "./client";

/**
 * The workspace read (`GET /tenants/{id}`: the person's role and the workspace's name) kept for 15 seconds per person and workspace, in the memory of this server, for the small route handlers the browser calls right after a page loads
 * (`/notifications`, `/live-calls`, `/activity`): each of them asked it again (staging request log, 12 Nov 2026: `tenant` 4.1 times per Today load, three of them from these handlers) only to know the role. They are read-only and the API
 * still authorizes every read they make, so a role or membership that changed is seen by the next ask after 15 seconds; a failed read (a 404 for a person who is not a member, a rejected session) is never kept. SERVER ONLY; pages and actions keep asking the API.
 */
const KEEP_MS = 15_000;
const MAX = 500;
const kept = new Map<string, { until: number; tenant: Promise<TenantDetail> }>();
const keyOf = (token: string, tenantId: string) => `${tenantId}:${createHash("sha256").update(token).digest("hex").slice(0, 24)}`;

export function fetchTenantKept(accessToken: string, tenantId: string, now: number = Date.now()): Promise<TenantDetail> {
  const key = keyOf(accessToken, tenantId);
  const held = kept.get(key);
  if (held && held.until > now) return held.tenant;
  if (kept.size >= MAX) for (const [k, v] of kept) if (v.until <= now || kept.size >= MAX) kept.delete(k);
  const tenant = fetchTenant(accessToken, tenantId);
  const mine = { until: now + KEEP_MS, tenant };
  kept.set(key, mine);
  tenant.catch(() => {
    if (kept.get(key) === mine) kept.delete(key); // (a failure is asked again by the next one who needs it)
  });
  return tenant;
}

/** For tests. */
export const forgetTenants = (): void => kept.clear();
