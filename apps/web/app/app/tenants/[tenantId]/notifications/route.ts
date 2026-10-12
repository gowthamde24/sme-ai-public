import { type NextRequest } from "next/server";

import { ApiAuthError, ApiRequestError, fetchTenant } from "@/lib/api/client";
import { isCanonicalUuid } from "@/lib/api/crm";
import { requireUser } from "@/lib/auth/session";

import { fromThisSite } from "../ask/ask-response";
import { readNotices } from "./notifications-data";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8" } as const;

/**
 * GET /app/tenants/[tenantId]/notifications (job BU): the bell asks here, about once a minute while the tab is in front. The answer is {items: [{id, code, who, at, href}]} made from reads the app already does with
 * the person's OWN token (which the browser never holds): see notifications-data.ts. Same-site requests only, never cached, and a rejected session is a plain 401 (a fetch cannot follow a sign-in redirect).
 * Nothing is written, and nothing from a customer's message travels: a name, a closed code, a time and a path inside this workspace.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  if (!isCanonicalUuid(tenantId)) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!fromThisSite(request)) return new Response("Forbidden", { status: 403, headers: { "Cache-Control": "no-store" } });
  let user;
  try {
    user = await requireUser();
  } catch {
    return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  try {
    const tenant = await fetchTenant(user.accessToken, tenantId);
    const items = await readNotices(user.accessToken, tenantId, tenant.role);
    return new Response(JSON.stringify({ items }), { status: 200, headers: NO_STORE });
  } catch (error) {
    if (error instanceof ApiAuthError) return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store" } });
    if (error instanceof ApiRequestError && error.status === 404) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
    return new Response("Unavailable", { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
